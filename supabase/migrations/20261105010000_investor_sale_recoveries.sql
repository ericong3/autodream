-- PREPARED ONLY. Deploy the receipt/refund API and screens before activation.
-- Actual bank money, sale recovery, withheld bills and customer money are distinct.
begin;
do $$ begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' then raise exception 'PRIVATE_FINANCE_RELEASE_NOT_REVIEWED';end if;
 if to_regclass('uc_investor_commission_bills') is null then raise exception 'COMMISSION_PIPELINE_REQUIRED';end if;
end $$;
create function public.uc_recovery_cents(v jsonb) returns bigint language plpgsql immutable set search_path=public,pg_temp as $$
declare n bigint;begin
 if jsonb_typeof(v) is distinct from 'number' or v#>>'{}' !~ '^(0|[1-9][0-9]{0,12})$' then raise exception 'INVALID';end if;
 n:=(v#>>'{}')::bigint;if n>1000000000000 then raise exception 'INVALID';end if;return n;
end $$;
create table public.uc_sale_money_orders (
 id uuid primary key default gen_random_uuid(),car_id text not null references uc_investor_cars(car_id),pot_id uuid not null references uc_investor_pots(id),
 kind text not null check(kind in ('receipt','refund')),state text not null default 'prepared' check(state in ('prepared','posted','cancelled')),
 amount_cents bigint not null check(amount_cents between 0 and 1000000000000),recovery_cents bigint not null default 0,withheld_cents bigint not null default 0,excess_cents bigint not null default 0,
 customer_id text,customer_name text,details jsonb not null,bank_id uuid references uc_investor_banks(id),bank_reference text,paid_on date,
 created_by text not null references garage_building_staff(id),created_at timestamptz not null default now(),posted_by text references garage_building_staff(id),posted_at timestamptz,
 cash_entry_id uuid unique references uc_investor_cash_entries(id),document_id uuid,cancel_reason text,cancelled_by text references garage_building_staff(id),cancelled_at timestamptz,
 check((kind='receipt' and recovery_cents>0 and recovery_cents=amount_cents+withheld_cents-excess_cents and bank_id is not null and paid_on is not null and bank_reference is not null)
  or (kind='refund' and amount_cents>0 and recovery_cents=0 and withheld_cents=0 and excess_cents=0)),
 check((state='posted')=(posted_at is not null)),check((state='posted')=(posted_by is not null)),check((state='cancelled')=(cancelled_at is not null)),check((state='cancelled')=(cancelled_by is not null)),check(state<>'posted' or document_id is not null)
);
create table public.uc_sale_withheld_bills (
 order_id uuid not null references uc_sale_money_orders(id),bill_id uuid not null references uc_investor_car_bills(id),amount_cents bigint not null check(amount_cents between 1 and 1000000000000),primary key(order_id,bill_id)
);
create table public.uc_sale_money_documents (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references uc_sale_money_orders(id),file_name text not null,mime_type text not null check(mime_type in ('image/png','image/jpeg','application/pdf')),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),size_bytes integer not null check(size_bytes between 1 and 1400000),storage_path text not null unique,
 state text not null default 'prepared' check(state in ('prepared','confirmed')),created_by text not null references garage_building_staff(id),created_at timestamptz not null default now(),confirmed_by text references garage_building_staff(id),confirmed_at timestamptz,
 check((state='confirmed')=(confirmed_at is not null)),check((state='confirmed')=(confirmed_by is not null)),check(file_name=trim(file_name) and length(file_name) between 1 and 120 and file_name !~ '[[:cntrl:]/\\]')
);
alter table uc_sale_money_orders add foreign key(document_id) references uc_sale_money_documents(id);
create table public.uc_sale_money_requests (
 actor_id text not null references garage_building_staff(id),request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),payload jsonb not null,result jsonb not null,primary key(actor_id,request_id)
);
create function public.uc_sale_order_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and old.state='prepared' and new.state in ('posted','cancelled') and
  (to_jsonb(old)-array['state','posted_by','posted_at','cash_entry_id','document_id','cancel_reason','cancelled_by','cancelled_at','bank_id','bank_reference','paid_on'])=(to_jsonb(new)-array['state','posted_by','posted_at','cash_entry_id','document_id','cancel_reason','cancelled_by','cancelled_at','bank_id','bank_reference','paid_on'])
  and (old.kind='refund' or (old.bank_id,old.bank_reference,old.paid_on) is not distinct from (new.bank_id,new.bank_reference,new.paid_on)) then return new;end if;
 raise exception 'IMMUTABLE_HISTORY';
end $$;
create function public.uc_sale_document_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and old.state='prepared' and new.state='confirmed' and (to_jsonb(old)-array['state','confirmed_by','confirmed_at'])=(to_jsonb(new)-array['state','confirmed_by','confirmed_at']) then return new;end if;
 raise exception 'IMMUTABLE_HISTORY';
end $$;
create trigger uc_sale_orders_fixed before update or delete on uc_sale_money_orders for each row execute function uc_sale_order_guard();
create trigger uc_sale_documents_fixed before update or delete on uc_sale_money_documents for each row execute function uc_sale_document_guard();
create trigger uc_sale_withheld_fixed before update or delete on uc_sale_withheld_bills for each row execute function uc_investor_immutable();
create trigger uc_sale_requests_fixed before update or delete on uc_sale_money_requests for each row execute function uc_investor_immutable();
create trigger uc_sale_orders_no_truncate before truncate on uc_sale_money_orders execute function uc_investor_immutable();
create trigger uc_sale_documents_no_truncate before truncate on uc_sale_money_documents execute function uc_investor_immutable();
create trigger uc_sale_withheld_no_truncate before truncate on uc_sale_withheld_bills execute function uc_investor_immutable();
create trigger uc_sale_requests_no_truncate before truncate on uc_sale_money_requests execute function uc_investor_immutable();

create function public.uc_bill_withheld(p_bill uuid) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(sum(w.amount_cents),0)::bigint from uc_sale_withheld_bills w join uc_sale_money_orders o on o.id=w.order_id where w.bill_id=p_bill and o.state='posted' $$;
create function public.uc_customer_refund_owing(p_car text,p_customer text default null) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(sum(case when kind='receipt' then excess_cents else -amount_cents end),0)::bigint from uc_sale_money_orders where car_id=p_car and state='posted' and (p_customer is null or customer_id=p_customer) $$;

alter table uc_investor_cash_entries add column customer_refund_id uuid unique references uc_sale_money_orders(id);
do $$ declare expression text;begin
 select pg_get_expr(conbin,conrelid) into expression from pg_constraint where conrelid='uc_investor_cash_entries'::regclass and conname='uc_cash_kind';
 if expression is null then raise exception 'CASH_CONSTRAINT_REVIEW_REQUIRED';end if;
 alter table uc_investor_cash_entries drop constraint uc_cash_kind;
 execute 'alter table uc_investor_cash_entries add constraint uc_cash_kind check (('||expression||') or (kind=''customer_refund_out'' and amount_cents<0 and car_id is not null and customer_refund_id is not null and bill_id is null and withdrawal_id is null))';
end $$;
alter table uc_investor_cash_entries add constraint uc_refund_source_only check(kind='customer_refund_out' or customer_refund_id is null);
insert into ledger_accounts(id,name,type,investor_tagged) values('acct-uc-customer-refunds','Investor car customer money awaiting refund','liability',true) on conflict(id) do nothing;
drop trigger uc_cash_to_journal on uc_investor_cash_entries;
create trigger uc_cash_to_journal after insert on uc_investor_cash_entries for each row when(new.kind<>'customer_refund_out') execute function uc_investor_post_event();
create function public.uc_customer_refund_cash() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare o uc_sale_money_orders;d uc_sale_money_documents;
begin
 select * into o from uc_sale_money_orders where id=new.customer_refund_id;
 if o.id is null or o.kind<>'refund' or o.state<>'prepared' or o.car_id is distinct from new.car_id or o.pot_id<>new.pot_id or o.amount_cents<>-new.amount_cents
  or current_setting('autodream.uc_customer_refund',true) is distinct from txid_current()::text||':'||o.id::text then raise exception 'REFUND_APPROVAL_REQUIRED';end if;
 select * into d from uc_sale_money_documents where id=nullif(current_setting('autodream.uc_customer_refund_document',true),'')::uuid and order_id=o.id and state='confirmed';
 if d.id is null then raise exception 'PAYMENT_RECEIPT_REQUIRED';end if;
 insert into ledger_accounts(id,name,type,investor_tagged) values('acct-bank-uc-'||md5(new.bank_account),'Bank account '||right(new.bank_account,8),'asset',null) on conflict(id) do nothing;
 perform uc_post_journal(new.id::text,new.paid_on,'Customer excess refunded',new.car_id,new.recorded_by,jsonb_build_array(
  jsonb_build_object('accountId','acct-uc-customer-refunds','debit',o.amount_cents::numeric/100,'credit',0),
  jsonb_build_object('accountId','acct-bank-uc-'||md5(new.bank_account),'debit',0,'credit',o.amount_cents::numeric/100)));
 return new;
end $$;
create trigger uc_customer_refund_journal after insert on uc_investor_cash_entries for each row when(new.kind='customer_refund_out') execute function uc_customer_refund_cash();
create function public.uc_customer_refund_linked() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from uc_sale_money_orders where id=new.customer_refund_id and state='posted' and cash_entry_id=new.id and document_id is not null) then raise exception 'REFUND_APPROVAL_REQUIRED';end if;return null;
end $$;
create constraint trigger uc_customer_refund_linked after insert on uc_investor_cash_entries deferrable initially deferred for each row when(new.kind='customer_refund_out') execute function uc_customer_refund_linked();
create function public.uc_sale_receipt_cash_linked() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from uc_sale_money_orders o join uc_sale_money_documents d on d.id=o.document_id and d.order_id=o.id and d.state='confirmed'
  where o.kind='receipt' and o.state='posted' and o.cash_entry_id=new.id and o.amount_cents=new.amount_cents and o.car_id=new.car_id and o.pot_id=new.pot_id and o.bank_id=new.bank_id and o.paid_on=new.paid_on) then raise exception 'SALE_RECEIPT_REQUIRED';end if;return null;
end $$;
create constraint trigger uc_sale_receipt_cash_linked after insert on uc_investor_cash_entries deferrable initially deferred for each row when(new.kind='car_sale') execute function uc_sale_receipt_cash_linked();

alter function public.uc_investor_car_summary(text) rename to uc_car_summary_before_recoveries;
create function public.uc_investor_car_summary(p_car text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;adjustment bigint;withheld bigint;begin
 result:=uc_car_summary_before_recoveries(p_car);if result is null then return null;end if;
 select coalesce(sum(withheld_cents-excess_cents),0),coalesce(sum(withheld_cents),0) into adjustment,withheld from uc_sale_money_orders where car_id=p_car and kind='receipt' and state='posted';
 return result||jsonb_build_object('actualReceivedCents',result->'receivedCents','receivedCents',(result->>'receivedCents')::bigint+adjustment,'unpaidBillCents',(result->>'unpaidBillCents')::bigint-withheld,'withheldCents',withheld,'refundOwingCents',uc_customer_refund_owing(p_car));
end $$;
alter function public.uc_investor_position(uuid) rename to uc_position_before_recoveries;
create function public.uc_investor_position(p_pot uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;withheld bigint;refunds bigint;begin
 result:=uc_position_before_recoveries(p_pot);
 select coalesce(sum(withheld_cents),0) into withheld from uc_sale_money_orders where pot_id=p_pot and kind='receipt' and state='posted';
 select coalesce(sum(case when kind='receipt' then excess_cents else -amount_cents end),0) into refunds from uc_sale_money_orders where pot_id=p_pot and state='posted';
 return result||jsonb_build_object('billReservedCents',(result->>'billReservedCents')::bigint-withheld,'customerRefundReservedCents',refunds,'reservedCents',(result->>'reservedCents')::bigint-withheld+refunds,'availableCents',(result->>'availableCents')::bigint+withheld-refunds);
end $$;

create function public.uc_sale_money_snapshot(p_actor text,p_car text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;car uc_investor_cars;begin
 select * into actor from garage_building_staff where id=p_actor;
 select * into car from uc_investor_cars where car_id=p_car;
 if car.car_id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and (actor.role='director' or actor.role='investor' and exists(select 1 from uc_investor_pots p join uc_investor_profiles f on f.id=p.profile_id where p.id=car.pot_id and f.linked_staff_id=p_actor)),false) then raise exception 'NOT_ALLOWED';end if;
 return jsonb_build_object('carId',p_car,'refundOwingCents',uc_customer_refund_owing(p_car),'orders',coalesce((select jsonb_agg(jsonb_build_object(
  'id',o.id,'kind',o.kind,'state',o.state,'amountCents',o.amount_cents,'recoveryCents',o.recovery_cents,'withheldCents',o.withheld_cents,'excessCents',o.excess_cents,'customerId',o.customer_id,'customerName',o.customer_name,
  'recipientName',o.details->>'accountHolder','recipientBank',case when actor.role='director' then o.details->>'bankName' end,'recipientAccount',case when actor.role='director' then o.details->>'accountNumber' end,'accountLast4',right(o.details->>'accountNumber',4),'createdAt',o.created_at,'postedAt',o.posted_at,'paidOn',o.paid_on,
  'createdBy',(select s.name from garage_building_staff s where s.id=o.created_by),'postedBy',(select s.name from garage_building_staff s where s.id=o.posted_by),'cancelReason',o.cancel_reason,'cancelledAt',o.cancelled_at,'cancelledBy',(select s.name from garage_building_staff s where s.id=o.cancelled_by),
  'bankName',case when actor.role='director' then (select b.name from uc_investor_banks b where b.id=o.bank_id) end,
  'proofConfirmed',exists(select 1 from uc_sale_money_documents d where d.order_id=o.id and d.state='confirmed')) order by o.created_at desc,o.id) from (select * from uc_sale_money_orders where car_id=p_car order by created_at desc,id limit 100) o),'[]'::jsonb),
  'refundCustomers',coalesce((select jsonb_agg(jsonb_build_object('id',c.customer_id,'name',coalesce(c.name,'Customer'),'owingCents',uc_customer_refund_owing(p_car,c.customer_id),'pendingCents',coalesce((select sum(r.amount_cents) from uc_sale_money_orders r where r.car_id=p_car and r.customer_id=c.customer_id and r.kind='refund' and r.state='prepared'),0))) from (select customer_id,max(customer_name) name from uc_sale_money_orders where car_id=p_car and kind='receipt' and state='posted' and excess_cents>0 group by customer_id) c),'[]'::jsonb),
  'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'orderId',d.order_id,'name',d.file_name,'uploadedAt',d.confirmed_at) order by d.confirmed_at,d.id) from uc_sale_money_documents d join uc_sale_money_orders o on o.id=d.order_id where o.car_id=p_car and d.state='confirmed'),'[]'::jsonb));
end $$;

create function public.uc_investor_recoveries(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;car uc_investor_cars;o uc_sale_money_orders;d uc_sale_money_documents;prior uc_sale_money_requests;bank uc_investor_banks;
 allowed text[];req text;payload jsonb;result jsonb;customer jsonb;item jsonb;bill uc_investor_car_bills;ids uuid[]:='{}';amount bigint;fee bigint:=0;excess bigint:=0;recovery bigint;unpaid bigint;owing bigint;pending bigint;entry uuid;document uuid;day date;v_bank uuid;reference text;path text;stored boolean;lines jsonb:='[]';
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and actor.role in ('director','investor'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 allowed:=case p_action
  when 'snapshot' then array['carId'] when 'prepare_receipt' then array['carId','amountCents','withheldBills','excessCents','customerId','bankAccountId','bankReference','paidOn','requestId']
  when 'prepare_refund' then array['carId','customerId','amountCents','bankName','accountNumber','accountHolder','note','requestId']
  when 'post' then array['orderId','documentId','bankAccountId','bankReference','paidOn','requestId'] when 'cancel' then array['orderId','note','requestId']
  when 'proof_prepare' then array['orderId','fileName','mimeType','sizeBytes','sha256','requestId'] when 'proof_confirm' then array['documentId'] when 'proof_read' then array['documentId'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'INVALID';end if;
 if p_action='snapshot' then return uc_sale_money_snapshot(p_actor,p_data->>'carId');end if;
 if actor.role<>'director' and p_action<>'proof_read' then raise exception 'NOT_ALLOWED';end if;
 if p_action in ('prepare_receipt','prepare_refund','post','cancel','proof_prepare') then
  req:=p_data->>'requestId';if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  payload:=jsonb_build_object('action',p_action,'data',p_data);perform pg_advisory_xact_lock(hashtextextended('recovery:'||p_actor||':'||req,0));
  select * into prior from uc_sale_money_requests where actor_id=p_actor and request_id=req;
  if found then if prior.payload is distinct from payload then raise exception 'REQUEST_CHANGED';end if;
   if p_action='proof_prepare' then select * into d from uc_sale_money_documents where id=(prior.result->>'documentId')::uuid;return jsonb_build_object('documentId',d.id,'path',d.storage_path,'state',d.state);end if;
   return prior.result;
  end if;
 end if;
 if p_action in ('prepare_receipt','prepare_refund') then select * into car from uc_investor_cars where car_id=p_data->>'carId';
 elsif p_action in ('proof_confirm','proof_read') then
  select * into d from uc_sale_money_documents where id=(p_data->>'documentId')::uuid;select * into o from uc_sale_money_orders where id=d.order_id;select * into car from uc_investor_cars where car_id=o.car_id;
 else select * into o from uc_sale_money_orders where id=(p_data->>'orderId')::uuid;select * into car from uc_investor_cars where car_id=o.car_id;end if;
 if car.car_id is null then raise exception 'NOT_ALLOWED';end if;
 if p_action='proof_read' then
  perform uc_sale_money_snapshot(p_actor,car.car_id);if d.state<>'confirmed' then raise exception 'NOT_ALLOWED';end if;
  return jsonb_build_object('documentId',d.id,'path',d.storage_path,'fileName',d.file_name,'mimeType',d.mime_type);
 end if;
 perform 1 from uc_investor_pots where id=car.pot_id for update;
 select * into car from uc_investor_cars where car_id=car.car_id;
 if p_action in ('prepare_receipt','prepare_refund') then
  if car.sale_cents is null then raise exception 'SALE_PRICE_REQUIRED';end if;
  if p_action='prepare_receipt' and car.settled_at is not null then raise exception 'CAR_SETTLED_ADJUSTMENT_REQUIRED';end if;
  amount:=uc_recovery_cents(p_data->'amountCents');
  if (select count(*) from uc_sale_money_orders where car_id=car.car_id and state='prepared')>=20 then raise exception 'REVIEW_WAITING_ORDERS';end if;
  if p_data ? 'customerId' then
   if jsonb_typeof(p_data->'customerId') is distinct from 'string' or length(p_data->>'customerId') not between 1 and 180 then raise exception 'INVALID';end if;
   execute 'select to_jsonb(c) from customers c where c.id=$1 and to_jsonb(c)->>''interested_car_id''=$2' into customer using p_data->>'customerId',car.car_id;
   if customer is null then raise exception 'CUSTOMER_REQUIRED';end if;
  end if;
  if p_action='prepare_receipt' then
   excess:=uc_recovery_cents(coalesce(p_data->'excessCents','0'::jsonb));
   if excess>0 and customer is null then raise exception 'CUSTOMER_REQUIRED';end if;
   if jsonb_typeof(coalesce(p_data->'withheldBills','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_data->'withheldBills','[]'::jsonb))>20 then raise exception 'INVALID';end if;
   for item in select value from jsonb_array_elements(coalesce(p_data->'withheldBills','[]'::jsonb)) loop
    if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('billId','amountCents')) then raise exception 'INVALID';end if;
    if (item->>'billId')::uuid=any(ids) then raise exception 'DUPLICATE_WITHHELD_BILL';end if;ids:=array_append(ids,(item->>'billId')::uuid);
    select * into bill from uc_investor_car_bills where id=(item->>'billId')::uuid and car_id=car.car_id for update;
    if bill.id is null or bill.state<>'approved' or bill.category='commission' or exists(select 1 from uc_investor_staff_claims where bill_id=bill.id) then raise exception 'WITHHELD_BILL_REQUIRED';end if;
    if not exists(select 1 from uc_investor_documents where bill_id=bill.id and kind='bill' and state='confirmed') then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
    select bill.amount_cents-coalesce(-sum(amount_cents),0)-uc_bill_withheld(bill.id) into unpaid from uc_investor_cash_entries where bill_id=bill.id and kind='car_expense';
    if uc_recovery_cents(item->'amountCents')<=0 or uc_recovery_cents(item->'amountCents')>unpaid then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
    fee:=fee+uc_recovery_cents(item->'amountCents');
   end loop;
   recovery:=amount+fee-excess;
   if fee>1000000000000 or recovery<=0 or recovery>car.sale_cents-(uc_investor_car_summary(car.car_id)->>'receivedCents')::bigint then raise exception 'SALE_RECOVERY_EXCEEDS_BALANCE';end if;
   v_bank:=(p_data->>'bankAccountId')::uuid;day:=(p_data->>'paidOn')::date;reference:=trim(p_data->>'bankReference');
   select * into bank from uc_investor_banks where id=v_bank;
   if bank.id is null or day is null or day<bank.opening_date or day<(car.sale_approved_at at time zone 'Asia/Kuala_Lumpur')::date or day>(now() at time zone 'Asia/Kuala_Lumpur')::date or coalesce(length(reference),0) not between 1 and 200 then raise exception 'INVALID_BANK_PAYMENT';end if;
   insert into uc_sale_money_orders(car_id,pot_id,kind,amount_cents,recovery_cents,withheld_cents,excess_cents,customer_id,customer_name,details,bank_id,bank_reference,paid_on,created_by)
   values(car.car_id,car.pot_id,'receipt',amount,recovery,fee,excess,p_data->>'customerId',customer->>'name',p_data,v_bank,reference,day,p_actor) returning * into o;
   for item in select value from jsonb_array_elements(coalesce(p_data->'withheldBills','[]'::jsonb)) loop insert into uc_sale_withheld_bills values(o.id,(item->>'billId')::uuid,uc_recovery_cents(item->'amountCents'));end loop;
  else
   if amount<=0 or customer is null then raise exception 'CUSTOMER_REQUIRED';end if;
   if exists(select 1 from unnest(array['bankName','accountNumber','accountHolder','note']) k where jsonb_typeof(p_data->k) is distinct from 'string' or length(trim(p_data->>k)) not between 1 and 200 or p_data->>k ~ '[[:cntrl:]]') then raise exception 'REFUND_RECIPIENT_REQUIRED';end if;
   select coalesce(sum(amount_cents),0) into pending from uc_sale_money_orders where car_id=car.car_id and kind='refund' and state='prepared' and customer_id=p_data->>'customerId';
   owing:=uc_customer_refund_owing(car.car_id,p_data->>'customerId');if amount>owing-pending then raise exception 'REFUND_EXCEEDS_BALANCE';end if;
   insert into uc_sale_money_orders(car_id,pot_id,kind,amount_cents,customer_id,customer_name,details,created_by) values(car.car_id,car.pot_id,'refund',amount,p_data->>'customerId',customer->>'name',p_data,p_actor) returning * into o;
  end if;
  result:=jsonb_build_object('orderId',o.id,'carId',o.car_id);
 elsif p_action='proof_prepare' then
  if o.state<>'prepared' or jsonb_typeof(p_data->'fileName') is distinct from 'string' or p_data->>'fileName'<>trim(p_data->>'fileName') or length(p_data->>'fileName') not between 1 and 120 or p_data->>'fileName' ~ '[[:cntrl:]/\\]'
   or coalesce(p_data->>'mimeType','') not in ('image/png','image/jpeg','application/pdf') or coalesce(p_data->>'sha256','') !~ '^[0-9a-f]{64}$' or uc_recovery_cents(p_data->'sizeBytes') not between 1 and 1400000 then raise exception 'INVALID';end if;
  path:='sale-money/'||o.id::text||'/'||(p_data->>'sha256')||case p_data->>'mimeType' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' else '.pdf' end;
  select * into d from uc_sale_money_documents where storage_path=path;
  if d.id is null then insert into uc_sale_money_documents(order_id,file_name,mime_type,sha256,size_bytes,storage_path,created_by) values(o.id,p_data->>'fileName',p_data->>'mimeType',p_data->>'sha256',(p_data->>'sizeBytes')::integer,path,p_actor) returning * into d;end if;
  result:=jsonb_build_object('documentId',d.id);
 elsif p_action='proof_confirm' then
  select * into o from uc_sale_money_orders where id=o.id for update;select * into d from uc_sale_money_documents where id=d.id for update;
  if d.state='confirmed' then return jsonb_build_object('documentId',d.id,'state','confirmed');end if;
  if o.state<>'prepared' then raise exception 'ORDER_ALREADY_REVIEWED';end if;
  if to_regclass('storage.objects') is not null then execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into stored using 'finance-evidence',d.storage_path;if not stored then raise exception 'UPLOAD_MISSING';end if;end if;
  update uc_sale_money_documents set state='confirmed',confirmed_by=p_actor,confirmed_at=now() where id=d.id;return jsonb_build_object('documentId',d.id,'state','confirmed');
 else
  select * into o from uc_sale_money_orders where id=o.id for update;if o.state<>'prepared' then raise exception 'ORDER_ALREADY_REVIEWED';end if;
  if p_action='cancel' then
   if jsonb_typeof(p_data->'note') is distinct from 'string' or length(trim(p_data->>'note')) not between 3 and 500 then raise exception 'REASON_REQUIRED';end if;
   update uc_sale_money_orders set state='cancelled',cancel_reason=trim(p_data->>'note'),cancelled_by=p_actor,cancelled_at=now() where id=o.id;
  else
   select * into d from uc_sale_money_documents where id=(p_data->>'documentId')::uuid and order_id=o.id and state='confirmed';if d.id is null then raise exception 'PAYMENT_RECEIPT_REQUIRED';end if;
   if o.kind='receipt' then
    if (p_data ? 'bankAccountId' and (p_data->>'bankAccountId')::uuid is distinct from o.bank_id) or (p_data ? 'bankReference' and trim(p_data->>'bankReference') is distinct from o.bank_reference) or (p_data ? 'paidOn' and (p_data->>'paidOn')::date is distinct from o.paid_on) then raise exception 'REQUEST_CHANGED';end if;
    if car.settled_at is not null then raise exception 'CAR_SETTLED_ADJUSTMENT_REQUIRED';end if;
    if o.recovery_cents>car.sale_cents-(uc_investor_car_summary(car.car_id)->>'receivedCents')::bigint then raise exception 'SALE_RECOVERY_EXCEEDS_BALANCE';end if;
    for item in select jsonb_build_object('billId',w.bill_id,'amountCents',w.amount_cents) from uc_sale_withheld_bills w where w.order_id=o.id loop
     select * into bill from uc_investor_car_bills where id=(item->>'billId')::uuid for update;
     select bill.amount_cents-coalesce(-sum(amount_cents),0)-uc_bill_withheld(bill.id) into unpaid from uc_investor_cash_entries where bill_id=bill.id and kind='car_expense';
     if bill.state<>'approved' or (item->>'amountCents')::bigint>unpaid then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
    end loop;
    if o.amount_cents>0 then insert into uc_investor_cash_entries(pot_id,kind,amount_cents,car_id,bank_account,bank_reference,paid_on,recorded_by)
     values(o.pot_id,'car_sale',o.amount_cents,o.car_id,'bank:'||o.bank_id::text,o.bank_reference,o.paid_on,p_actor) returning id into entry;end if;
    if o.withheld_cents>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-ap','debit',o.withheld_cents::numeric/100,'credit',0),jsonb_build_object('accountId','acct-uc-sale-clearing','debit',0,'credit',o.withheld_cents::numeric/100));end if;
    if o.excess_cents>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-uc-sale-clearing','debit',o.excess_cents::numeric/100,'credit',0),jsonb_build_object('accountId','acct-uc-customer-refunds','debit',0,'credit',o.excess_cents::numeric/100));end if;
    if jsonb_array_length(lines)>0 then perform uc_post_journal('recovery:'||o.id::text,o.paid_on,'Bank deductions and customer excess',o.car_id,p_actor,lines);end if;
    v_bank:=o.bank_id;reference:=o.bank_reference;day:=o.paid_on;
   else
    if o.amount_cents>uc_customer_refund_owing(car.car_id,o.customer_id) then raise exception 'REFUND_EXCEEDS_BALANCE';end if;
    v_bank:=(p_data->>'bankAccountId')::uuid;reference:=trim(p_data->>'bankReference');day:=(p_data->>'paidOn')::date;
    select * into bank from uc_investor_banks where id=v_bank;
    if bank.id is null or day is null or day<bank.opening_date or day<(o.created_at at time zone 'Asia/Kuala_Lumpur')::date or day>(now() at time zone 'Asia/Kuala_Lumpur')::date or coalesce(length(reference),0) not between 1 and 200 then raise exception 'INVALID_BANK_PAYMENT';end if;
    perform set_config('autodream.uc_customer_refund',txid_current()::text||':'||o.id::text,true);perform set_config('autodream.uc_customer_refund_document',d.id::text,true);
    insert into uc_investor_cash_entries(pot_id,kind,amount_cents,car_id,customer_refund_id,bank_account,bank_reference,paid_on,recorded_by)
     values(o.pot_id,'customer_refund_out',-o.amount_cents,o.car_id,o.id,'bank:'||v_bank::text,reference,day,p_actor) returning id into entry;
    perform set_config('autodream.uc_customer_refund','',true);perform set_config('autodream.uc_customer_refund_document','',true);
   end if;
   update uc_sale_money_orders set state='posted',posted_by=p_actor,posted_at=now(),cash_entry_id=entry,document_id=d.id,bank_id=v_bank,bank_reference=reference,paid_on=day where id=o.id;
   if o.kind='refund' and (uc_investor_position(o.pot_id)->>'availableCents')::numeric<0 then raise exception 'INSUFFICIENT_FUNDS';end if;
  end if;
  result:=jsonb_build_object('orderId',o.id,'carId',o.car_id);
 end if;
 insert into uc_sale_money_requests(actor_id,request_id,payload,result) values(p_actor,req,payload,result);
 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(car.pot_id,p_actor,'sale_money_'||p_action,jsonb_build_object('carId',car.car_id,'orderId',o.id,'documentId',d.id));
 if p_action='proof_prepare' then return result||jsonb_build_object('path',d.storage_path,'state',d.state);end if;
 return result;
end $$;

alter function public.uc_investor_capital(text,text,jsonb) rename to uc_capital_before_recoveries;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;bill uc_investor_car_bills;pot uuid;paid bigint;
begin
 if p_action in ('pay_car_bill','void_car_bill') and not exists(select 1 from garage_building_staff where id=p_actor and enabled and registration_status='active' and role='director' and business_access in ('used_car','both')) then raise exception 'NOT_ALLOWED';end if;
 if p_action='sale_received' and not exists(select 1 from uc_investor_commands where actor_id=p_actor and request_id=p_data->>'requestId') then raise exception 'SALE_RECEIPT_REQUIRED';end if;
 if p_action in ('pay_car_bill','void_car_bill') then
  if coalesce(p_data->>'requestId','') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||(p_data->>'requestId'),0));
  perform 1 from garage_building_staff where id=p_actor for share;
  select a.pot_id into pot from uc_investor_cars a where a.car_id=p_data->>'carId';perform 1 from uc_investor_pots where id=pot for update;
  if p_action='void_car_bill' and uc_bill_withheld((p_data->>'billId')::uuid)>0 then raise exception 'PAID_BILL_ADJUSTMENT_REQUIRED';end if;
 end if;
 if p_action='pay_car_bill' then
  if not exists(select 1 from uc_investor_commands where actor_id=p_actor and request_id=p_data->>'requestId') then
   select * into bill from uc_investor_car_bills where id=(p_data->>'billId')::uuid and car_id=p_data->>'carId';
   select coalesce(-sum(amount_cents),0)+uc_bill_withheld(bill.id) into paid from uc_investor_cash_entries where bill_id=bill.id and kind='car_expense';
   if bill.id is not null and uc_recovery_cents(p_data->'amountCents')>bill.amount_cents-paid then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
  end if;
 end if;
 result:=uc_capital_before_recoveries(p_actor,p_action,p_data);
 if p_action='car_snapshot' then result:=result||jsonb_build_object('bills',coalesce((select jsonb_agg(b.value||jsonb_build_object('paidCents',(b.value->>'paidCents')::bigint+uc_bill_withheld((b.value->>'id')::uuid),'withheldCents',uc_bill_withheld((b.value->>'id')::uuid)) order by b.ordinality) from jsonb_array_elements(result->'bills') with ordinality b),'[]'::jsonb));end if;
 return result;
end $$;

alter table uc_sale_money_orders enable row level security;alter table uc_sale_money_documents enable row level security;alter table uc_sale_withheld_bills enable row level security;alter table uc_sale_money_requests enable row level security;
revoke all on uc_sale_money_orders,uc_sale_money_documents,uc_sale_withheld_bills,uc_sale_money_requests from public,anon,authenticated,service_role;
revoke all on function uc_recovery_cents(jsonb),uc_sale_order_guard(),uc_sale_document_guard(),uc_bill_withheld(uuid),uc_customer_refund_owing(text,text),uc_customer_refund_cash(),uc_customer_refund_linked(),uc_sale_receipt_cash_linked(),uc_car_summary_before_recoveries(text),uc_position_before_recoveries(uuid),uc_investor_car_summary(text),uc_investor_position(uuid),uc_sale_money_snapshot(text,text),uc_investor_recoveries(text,text,jsonb),uc_capital_before_recoveries(text,text,jsonb),uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_investor_recoveries(text,text,jsonb),uc_investor_capital(text,text,jsonb) to service_role;
commit;
