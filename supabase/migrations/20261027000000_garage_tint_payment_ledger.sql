-- LOCAL CANDIDATE. Apply transactionally only after reviewed preflight/approval.
-- Existing paid flags are not evidence of finance verification. Never invent it.
do $$begin
 if exists(select 1 from garage_invoices where service='tinted') then
  raise exception 'EXISTING_TINT_ORDERS_REQUIRE_BACKFILL_REVIEW';
 end if;
end$$;

do $$declare existing_check text;begin
 select pg_get_expr(conbin,conrelid) into existing_check from pg_constraint
 where conrelid='garage_work_order_activity'::regclass and conname='garage_work_order_activity_event_type_check';
 alter table garage_work_order_activity drop constraint garage_work_order_activity_event_type_check;
 execute format('alter table garage_work_order_activity add constraint garage_work_order_activity_event_type_check check ((%s) or event_type in (''PAYMENT_REPORTED'',''PAYMENT_VERIFIED'',''PAYMENT_REJECTED'',''PAYMENT_PROOF_ATTACHED''))',existing_check);
end$$;

create table garage_tint_accounts(
 invoice_id text primary key references garage_invoices(id) on delete restrict,
 total_amount numeric(16,2) not null check(total_amount>=0),
 created_at timestamptz not null default now()
);
create table garage_tint_payments(
 id text primary key default ('gtp_'||replace(gen_random_uuid()::text,'-','')),
 invoice_id text not null references garage_tint_accounts(invoice_id) on delete restrict,
 amount numeric(16,2) not null check(amount>0),
 method text not null check(method in ('cash','card','transfer','installment')),
 reference text not null default '' check(length(reference)<=200),
 received_at timestamptz not null default now(),
 recorded_by text not null,
 state text not null default 'pending' check(state in ('pending','verified','rejected','voided')),
 reviewed_by text,reviewed_at timestamptz,review_note text,
 receipt_path text,receipt_name text,
 created_at timestamptz not null default now()
);
create index garage_tint_payments_invoice_idx on garage_tint_payments(invoice_id,created_at,id);
create index garage_tint_payments_review_idx on garage_tint_payments(state,created_at);
create table garage_tint_finance_requests(
 actor_id text not null,request_id text not null,payload jsonb not null,result jsonb not null,
 primary key(actor_id,request_id)
);
alter table garage_tint_accounts enable row level security;
alter table garage_tint_payments enable row level security;
alter table garage_tint_finance_requests enable row level security;
revoke all on garage_tint_accounts,garage_tint_payments,garage_tint_finance_requests from public,anon,authenticated;

create function garage_tint_money_actor(p_actor text) returns garage_building_staff
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;begin
 select * into actor from garage_building_staff where id=p_actor;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active'
  and actor.business_access in ('garage','both') and actor.role in ('director','admin','shareholder','garage_head','garage_salesman'),false)
 then raise exception 'NOT_ALLOWED';end if;
 return actor;
end$$;

create function garage_tint_money_snapshot(p_actor text,p_invoice text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;inv garage_invoices;account garage_tint_accounts;reported numeric;verified numeric;
begin
 actor:=garage_tint_money_actor(p_actor);
 select * into inv from garage_invoices where id=p_invoice;
 if inv.id is null or inv.service<>'tinted' or (actor.role='garage_salesman' and inv.created_by is distinct from p_actor) then raise exception 'NOT_ALLOWED';end if;
 select * into account from garage_tint_accounts where invoice_id=p_invoice;
 if account.invoice_id is null then raise exception 'FINANCE_NOT_READY';end if;
 select coalesce(sum(amount) filter(where state in ('pending','rejected','verified')),0),coalesce(sum(amount) filter(where state='verified'),0)
 into reported,verified from garage_tint_payments where invoice_id=p_invoice;
 return jsonb_build_object('invoiceId',p_invoice,'invoiceNumber',inv.invoice_number,'total',account.total_amount,
  'collected',reported,'verified',verified,'awaitingVerification',reported-verified,
  'toCollect',greatest(0,account.total_amount-reported),'verifiedBalance',greatest(0,account.total_amount-verified),
  'canVerify',actor.role in ('director','admin'),
  'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at,p.id) from garage_tint_payments p where invoice_id=p_invoice),'[]'::jsonb));
end$$;

create function garage_tint_finance(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;inv garage_invoices;account garage_tint_accounts;payment garage_tint_payments;
 prior garage_tint_finance_requests;amount numeric;reported numeric;verified numeric;result jsonb;iid text;request text;page_no integer;
begin
 if p_action not in ('snapshot','queue') then perform 1 from garage_building_staff where id=p_actor for share;end if;
 actor:=garage_tint_money_actor(p_actor);
 if p_action not in ('snapshot','queue','record','verify','reject','void','receipt') then raise exception 'INVALID';end if;
 if p_action='queue' then
  if actor.role not in ('director','admin') then raise exception 'NOT_ALLOWED';end if;
  if coalesce(p_data->>'page','0') !~ '^\d{1,6}$' then raise exception 'INVALID';end if;
  page_no:=coalesce((p_data->>'page')::integer,0);
  return jsonb_build_object('payments',coalesce((select jsonb_agg(to_jsonb(q)) from
   (select p.*,i.invoice_number from garage_tint_payments p join garage_invoices i on i.id=p.invoice_id
    where p.state in ('pending','rejected') order by p.created_at,p.id limit 50 offset page_no*50) q),'[]'::jsonb),
   'hasMore',(select count(*)> (page_no+1)*50 from garage_tint_payments where state in ('pending','rejected')));
 end if;
 iid:=p_data->>'invoiceId';
 if p_action='snapshot' then return garage_tint_money_snapshot(p_actor,iid);end if;
 -- All finance and workshop transitions serialize on the invoice first.
 perform 1 from garage_building_staff where id=p_actor for share;
 select * into inv from garage_invoices where id=iid for update;
 if inv.id is null or inv.service<>'tinted' or (actor.role='garage_salesman' and inv.created_by is distinct from p_actor) then raise exception 'NOT_ALLOWED';end if;
 select * into account from garage_tint_accounts where invoice_id=iid;
 if account.invoice_id is null then raise exception 'FINANCE_NOT_READY';end if;
 request:=p_data->>'requestId';
 if request is null or request !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 select * into prior from garage_tint_finance_requests where actor_id=p_actor and request_id=request;
 if found then
  if prior.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;
  return prior.result;
 end if;
 if p_action='record' then
  if inv.delivered_at is not null then raise exception 'ORDER_DELIVERED';end if;
  if jsonb_typeof(p_data->'amount') is distinct from 'number' or (p_data->>'amount') !~ '^\d{1,12}(\.\d{1,2})?$'
   or coalesce(p_data->>'method','') not in ('cash','card','transfer','installment')
   or length(coalesce(p_data->>'reference',''))>200 then raise exception 'INVALID';end if;
  amount:=(p_data->>'amount')::numeric;
  select coalesce(sum(p.amount),0) into reported from garage_tint_payments p where invoice_id=iid and state in ('pending','rejected','verified');
  if amount<=0 or amount>account.total_amount-reported then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
  insert into garage_tint_payments(invoice_id,amount,method,reference,recorded_by)
   values(iid,amount,p_data->>'method',trim(coalesce(p_data->>'reference','')),p_actor) returning * into payment;
 elsif p_action in ('verify','reject','void') then
  if actor.role not in ('director','admin') then raise exception 'NOT_ALLOWED';end if;
  select * into payment from garage_tint_payments where id=p_data->>'paymentId' and invoice_id=iid for update;
  if payment.id is null then raise exception 'NOT_ALLOWED';end if;
  if payment.state not in ('pending','rejected') then raise exception 'PAYMENT_ALREADY_REVIEWED';end if;
  if length(coalesce(p_data->>'note',''))>2000 or (p_action in ('reject','void') and nullif(trim(p_data->>'note'),'') is null) then raise exception 'REASON_REQUIRED';end if;
  update garage_tint_payments set state=case when p_action='verify' then 'verified' when p_action='void' then 'voided' else 'rejected' end,
   reviewed_by=p_actor,reviewed_at=now(),review_note=trim(coalesce(p_data->>'note','')) where id=payment.id;
 else
  select * into payment from garage_tint_payments where id=p_data->>'paymentId' and invoice_id=iid for update;
  if payment.id is null or payment.state not in ('pending','rejected') or (payment.recorded_by<>p_actor and actor.role not in ('director','admin')) then raise exception 'NOT_ALLOWED';end if;
  if payment.receipt_path is not null then raise exception 'RECEIPT_ALREADY_ATTACHED';end if;
  if coalesce(p_data->>'path','') not like iid||'/%' or coalesce(p_data->>'path','') like '%..%'
   or length(coalesce(p_data->>'name','')) not between 1 and 255 then raise exception 'INVALID';end if;
  update garage_tint_payments set receipt_path=p_data->>'path',receipt_name=p_data->>'name' where id=payment.id;
 end if;
 select coalesce(sum(p.amount),0) into verified from garage_tint_payments p where invoice_id=iid and state='verified';
 perform garage_lifecycle_begin();
 update garage_invoices set payment_status=case when verified>=account.total_amount then 'paid' else 'pending' end,
  paid_by=case when verified>=account.total_amount then coalesce(paid_by,p_actor) else null end,
  paid_at=case when verified>=account.total_amount then coalesce(paid_at,now()) else null end,
  payment_method=case when p_action='verify' then payment.method else payment_method end,
  work_status=case when verified>=account.total_amount and work_status='payment_due' then 'ready_for_delivery' else work_status end
 where id=iid;
 insert into garage_work_order_activity(work_order_id,event_type,actor_id,actor_role,metadata)
 values(iid,case p_action when 'record' then 'PAYMENT_REPORTED' when 'verify' then 'PAYMENT_VERIFIED' when 'reject' then 'PAYMENT_REJECTED' when 'void' then 'PAYMENT_REJECTED' else 'PAYMENT_PROOF_ATTACHED' end,p_actor,actor.role,
  jsonb_build_object('payment_id',payment.id,'action',p_action));
 result:=garage_tint_money_snapshot(p_actor,iid)||jsonb_build_object('paymentId',payment.id);
 insert into garage_tint_finance_requests values(p_actor,request,jsonb_build_object('action',p_action,'data',p_data),result);
 return result;
end$$;

-- The sale, amount-due snapshot and optional reported deposit are one transaction.
alter function garage_sale_confirmation(text,text,text,jsonb) rename to garage_sale_confirmation_before_ledger;
create function garage_sale_confirmation(p_actor text,p_action text,p_request text,p_sale jsonb default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;normal jsonb;prior garage_tint_finance_requests;existing garage_sale_confirmations;
 iid text;total numeric;initial jsonb;money jsonb;
begin
 perform garage_tint_money_actor(p_actor);
 if p_action<>'confirm' then
  result:=garage_sale_confirmation_before_ledger(p_actor,p_action,p_request,p_sale);
  select * into prior from garage_tint_finance_requests where actor_id=p_actor and request_id=p_request;
  if prior.request_id is not null then return prior.result||result||jsonb_build_object('receiptPath',(select receipt_path from garage_tint_payments where id=prior.result->>'paymentId'));else return result;end if;
 end if;
 perform pg_advisory_xact_lock(104025,hashtext(p_actor||':'||p_request));
 select * into prior from garage_tint_finance_requests where actor_id=p_actor and request_id=p_request;
 if found and prior.payload is distinct from jsonb_build_object('action','sale','data',p_sale) then raise exception 'REQUEST_CHANGED';end if;
 select * into existing from garage_sale_confirmations where actor_id=p_actor and request_id=p_request;
 if existing.request_id is not null and prior.request_id is null then
  if existing.sale is distinct from p_sale then raise exception 'REQUEST_CHANGED';end if;
  return garage_sale_confirmation_before_ledger(p_actor,p_action,p_request,p_sale);
 end if;
 normal:=(p_sale-'initialPayment')||jsonb_build_object('paymentStatus','pending','paymentMethod',null);
 result:=garage_sale_confirmation_before_ledger(p_actor,p_action,p_request,normal);iid:=result->>'invoiceId';
 if prior.request_id is not null then return prior.result||result||jsonb_build_object('receiptPath',(select receipt_path from garage_tint_payments where id=prior.result->>'paymentId'));end if;
 select t.final_total+coalesce((select sum(a.price*a.qty) from garage_invoice_addons a where a.invoice_id=iid),0)
  into total from garage_tint_orders t where t.invoice_id=iid;
 if total is null or total<0 or total<>round(total,2) then raise exception 'INVALID_TOTAL';end if;
 insert into garage_tint_accounts(invoice_id,total_amount) values(iid,total);
 initial:=p_sale->'initialPayment';
 -- Compatibility for an older open client: a Paid selection reports collection,
 -- it no longer substitutes for company verification.
 if (initial is null or initial='null'::jsonb) and p_sale->>'paymentStatus'='paid' and total>0 then
  initial:=jsonb_build_object('amount',total,'method',p_sale->>'paymentMethod','reference','');
 end if;
 if initial is not null and initial<>'null'::jsonb then
  if jsonb_typeof(initial) is distinct from 'object' or initial-array['amount','method','reference']<>'{}'::jsonb then raise exception 'INVALID';end if;
  money:=garage_tint_finance(p_actor,'record',initial||jsonb_build_object('invoiceId',iid,'requestId','initial_'||md5(p_request)));
  result:=result||jsonb_build_object('paymentId',money->>'paymentId','collectionPending',true);
 elsif total=0 then
  perform garage_lifecycle_begin();update garage_invoices set payment_status='paid' where id=iid;
  result:=result||jsonb_build_object('paymentStatus','paid');
 end if;
 insert into garage_tint_finance_requests values(p_actor,p_request,jsonb_build_object('action','sale','data',p_sale),result);
 return result;
end$$;

-- Quotes cannot be silently edited after finance starts tracking their balance.
create function garage_tint_quote_locked() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from garage_tint_accounts where invoice_id=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end)
 then raise exception 'QUOTE_LOCKED';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end$$;
create trigger garage_tint_quote_locked before update or delete on garage_tint_orders for each row execute function garage_tint_quote_locked();
create trigger garage_tint_addon_locked before insert or update or delete on garage_invoice_addons for each row execute function garage_tint_quote_locked();

-- Direct paid toggles no longer represent money reaching the company.
alter function mark_garage_work_order_paid(text,text,text) rename to garage_mark_paid_before_ledger;
create function mark_garage_work_order_paid(p_invoice_id text,p_actor_id text,p_method text) returns garage_invoices language plpgsql as $$
begin
 if exists(select 1 from garage_tint_accounts where invoice_id=p_invoice_id) then raise exception 'PAYMENT_LEDGER_REQUIRED';end if;
 return garage_mark_paid_before_ledger(p_invoice_id,p_actor_id,p_method);
end$$;

revoke all on function garage_tint_money_actor(text),garage_tint_money_snapshot(text,text),garage_tint_finance(text,text,jsonb),garage_sale_confirmation(text,text,text,jsonb),garage_sale_confirmation_before_ledger(text,text,text,jsonb),garage_mark_paid_before_ledger(text,text,text),mark_garage_work_order_paid(text,text,text),garage_tint_quote_locked() from public,anon,authenticated;
grant execute on function garage_tint_money_snapshot(text,text),garage_tint_finance(text,text,jsonb),garage_sale_confirmation(text,text,text,jsonb),mark_garage_work_order_paid(text,text,text) to service_role;
