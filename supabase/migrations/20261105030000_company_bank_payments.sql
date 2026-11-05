-- PREPARED ONLY. Install with the bank-payment API and screens. Never import
-- old transfers as new cash: their bank statements will be reconciled later.
begin;
do $$ begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' then raise exception 'PRIVATE_FINANCE_RELEASE_NOT_REVIEWED';end if;
 if to_regclass('uc_trade_in_applications') is null then raise exception 'TRADE_IN_APPLICATION_REQUIRED';end if;
end $$;
create table public.uc_bank_movements (
 id uuid primary key default gen_random_uuid(),bank_id uuid not null references uc_investor_banks(id),
 amount_cents bigint not null check(abs(amount_cents::numeric) between 1 and 1000000000000),paid_on date not null,bank_reference text not null check(length(trim(bank_reference)) between 1 and 200),
 source_kind text not null check(source_kind in ('investor','company')),source_id uuid not null,
 recorded_by text not null references garage_building_staff(id),recorded_at timestamptz not null default now(),unique(source_kind,source_id)
);
create unique index uc_bank_movement_reference on uc_bank_movements(bank_id,lower(trim(bank_reference)));
create index uc_bank_movement_kind_date on uc_bank_movements(source_kind,paid_on);
create table public.uc_company_bank_payments (
 id uuid primary key default gen_random_uuid(),bank_id uuid not null references uc_investor_banks(id),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),paid_on date not null,bank_reference text not null,
 recorded_by text not null references garage_building_staff(id),recorded_at timestamptz not null default now(),notes text not null default '' check(length(notes)<=2000),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),payload jsonb not null,unique(recorded_by,request_id)
);
create table public.uc_company_bank_allocations (
 id uuid primary key default gen_random_uuid(),bank_payment_id uuid not null references uc_company_bank_payments(id),payment_id text not null references payments(id),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),receipt_document_id uuid not null unique references uc_company_payment_documents(id),
 unique(bank_payment_id,payment_id)
);
create index uc_company_bank_allocation_payment on uc_company_bank_allocations(payment_id);
do $$ declare t text;begin
 foreach t in array array['uc_bank_movements','uc_company_bank_payments','uc_company_bank_allocations'] loop
  execute format('create trigger %I before update or delete on %I for each row execute function uc_investor_immutable()',t||'_fixed',t);
  execute format('create trigger %I before truncate on %I execute function uc_investor_immutable()',t||'_no_truncate',t);
  execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
-- One physical-bank registry spans investor and company money. Internal profit
-- allocations and trade-in ownership changes never enter this registry.
create function public.uc_investor_bank_movement() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.bank_id is not null then insert into uc_bank_movements(bank_id,amount_cents,paid_on,bank_reference,source_kind,source_id,recorded_by)
  values(new.bank_id,new.amount_cents,new.paid_on,new.bank_reference,'investor',new.id,new.recorded_by);end if;return new;
end $$;
create trigger uc_investor_actual_bank after insert on uc_investor_cash_entries for each row execute function uc_investor_bank_movement();
-- Source-linked projection only: importing these rows does not post journals
-- or change investor capital. Existing rows already represent actual cash.
insert into uc_bank_movements(bank_id,amount_cents,paid_on,bank_reference,source_kind,source_id,recorded_by,recorded_at)
 select bank_id,amount_cents,paid_on,bank_reference,'investor',id,recorded_by,recorded_at from uc_investor_cash_entries where bank_id is not null;
create function public.uc_company_paid_cents(p_payment text) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(sum(amount_cents),0)::bigint from uc_company_bank_allocations where payment_id=p_payment $$;
create function public.uc_registered_bank_position(p_bank uuid) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select b.opening_cents+coalesce((select sum(m.amount_cents) from uc_bank_movements m where m.bank_id=b.id),0)::bigint from uc_investor_banks b where b.id=p_bank $$;
create function public.uc_company_refund_receipt_source(p_journal text,p_car text) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if to_regclass('uc_company_bank_receipts') is null then return false;end if;
 return exists(select 1 from uc_company_bank_receipts r where r.car_id=p_car and p_journal='company-receipt:'||r.id::text);
end $$;
create function public.uc_company_cash_position() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare physical bigint;investor bigint;reserved bigint;begin
 select coalesce(sum(uc_registered_bank_position(id)),0) into physical from uc_investor_banks;
 select coalesce(sum((uc_investor_position(id)->>'cashCents')::bigint),0) into investor from uc_investor_pots;
 select coalesce(sum(greatest(0,uc_commission_cents(to_jsonb(p)->'amount')-uc_company_paid_cents(p.id))),0) into reserved from payments p
 where p.status='pending' and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false) and p.type in ('salesman_commission','intake_bonus','source_commission','repair','misc_cost','expense_claim','purchase_settlement','salary','allowance','campaign_bonus','customer_refund')
  and (p.type<>'expense_claim' or p.claim_confirmed_by is not null) and not exists(select 1 from uc_investor_cars a where a.car_id=p.car_id);
 return jsonb_build_object('bankCents',physical,'investorOwnedCents',investor,'companyCashCents',physical-investor,'unpaidCompanyCents',reserved,'availableCents',physical-investor-reserved,'bankMatched',false);
end $$;
create function public.uc_company_trade_in_source(p_journal text,p_car text) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if to_regclass('uc_company_trade_in_applications') is null then return false;end if;
 return exists(select 1 from uc_company_trade_in_applications a where a.incoming_car_id=p_car and p_journal='uc:company-trade-in:'||a.id::text);
end $$;
create function uc_company_panel_allowed(p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select false $$;
revoke all on function uc_company_panel_allowed(text) from public,anon,authenticated,service_role;
create function public.uc_consignment_payment_allowed(p_payment text) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if uc_company_panel_allowed(p_payment) then return true;end if;
 if to_regclass('uc_consignment_bill_sources') is null then return false;end if;
 return exists(select 1 from uc_consignment_bill_sources where payment_id=p_payment);
end $$;
create function public.uc_consignment_journal_source(p_journal text,p_payment text) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if to_regclass('uc_consignment_bill_sources') is null then return false;end if;
 return exists(select 1 from uc_consignment_bill_sources where payment_id=p_payment and source_journal_id=p_journal);
end $$;
create function public.uc_consignment_payment_needs_review(p_payment text) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if to_regclass('uc_consignment_cases') is null then return false;end if;
 return exists(select 1 from payments p join uc_consignment_cases c on c.car_id=p.car_id where p.id=p_payment and c.approved_at is not null and p.type in ('repair','misc_cost','panel_charge','expense_claim','salesman_commission','intake_bonus','source_commission','consignment_payout','purchase_settlement') and not exists(select 1 from uc_consignment_bill_sources s where s.payment_id=p.id));
end $$;
create function public.uc_consignment_bill_limit(p_payment text) returns bigint language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if to_regclass('uc_consignment_bill_sources') is null then return null;end if;
 return (select amount_cents from uc_consignment_bill_sources where payment_id=p_payment);
end $$;
create function uc_consignment_replacement_allowed(p_before jsonb,p_after jsonb) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select false $$;
revoke all on function uc_consignment_replacement_allowed(jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.uc_company_bank_payment_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then if exists(select 1 from uc_company_bank_allocations where payment_id=old.id) then raise exception 'BANK_PAYMENT_IMMUTABLE';end if;return old;end if;
 if tg_op='UPDATE' and exists(select 1 from uc_company_bank_allocations where payment_id=old.id)
  and (to_jsonb(new)-array['status','transferred_at','transferred_by','notes','receipt_url','delete_requested_by','delete_requested_at']) is distinct from (to_jsonb(old)-array['status','transferred_at','transferred_by','notes','receipt_url','delete_requested_by','delete_requested_at']) then raise exception 'BANK_PAYMENT_IMMUTABLE';end if;
 if (tg_op='INSERT' and new.status='transferred') or (tg_op='UPDATE' and new.status is distinct from old.status) then
  if current_setting('autodream.company_bank_payment',true) is distinct from txid_current()::text||':'||new.id then raise exception 'USE_COMPANY_BANK_PAYMENT';end if;
 end if;return new;
end $$;
create trigger uc_company_bank_payment_guard before insert or update or delete on payments for each row execute function uc_company_bank_payment_guard();
-- Once a payment uses this workflow, browser catch-up must not create a
-- second payout or modify its source journals. Corrections require reversal.
create function public.uc_company_bank_journal_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op<>'INSERT' and old.id like 'company-bank:%' then raise exception 'BANK_PAYMENT_IMMUTABLE';end if;
 if tg_op<>'DELETE' and exists(select 1 from jsonb_array_elements(new.lines) l where l->>'accountId' like 'acct-bank-uc-%')
  and not coalesce(new.source_type='investor_finance' and current_setting('autodream.uc_posting',true)='on',false)
  and current_setting('autodream.company_bank_payment',true) is distinct from txid_current()::text||':'||coalesce(new.source_id,'') then raise exception 'USE_COMPANY_BANK_PAYMENT';end if;
 if tg_op<>'INSERT' and exists(select 1 from uc_company_bank_allocations a join payments p on p.id=a.payment_id
  where old.source_type=case p.type when 'expense_claim' then 'expense_claim_confirmed' when 'customer_refund' then 'car_sold' when 'purchase_settlement' then 'car_purchased' else p.type end
   and old.source_id=case when p.type in ('salesman_commission','intake_bonus','source_commission','customer_refund','purchase_settlement') then p.car_id else p.id end) then raise exception 'BANK_PAYMENT_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;
 if new.source_type like '%_paid' and exists(select 1 from uc_company_bank_allocations a where a.payment_id=new.source_id)
  and current_setting('autodream.company_bank_payment',true) is distinct from txid_current()::text||':'||new.source_id then raise exception 'USE_COMPANY_BANK_PAYMENT';end if;
 return new;
end $$;
create trigger uc_company_bank_journal_guard before insert or update or delete on journal_entries for each row execute function uc_company_bank_journal_guard();

create function public.uc_company_bank_money(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;b uc_investor_banks;batch uc_company_bank_payments;pay payments;doc uc_company_payment_documents;allocation uc_company_bank_allocations;
 allowed text[];item jsonb;ids text[]:='{}';req text;day date;reference text;total bigint:=0;v_amount bigint;paid bigint;owed bigint;v_source_type text;v_source_id text;counter text;
 result jsonb;bank_account text;journal_id text;bonus jsonb;old_bonus text;source_lines jsonb;source_credit numeric;source_paid bigint;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and (actor.role='director' or actor.role='admin' and p_action='history') and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 allowed:=case p_action when 'banks' then array[]::text[] when 'history' then array['paymentId'] when 'record' then array['bankAccountId','paidOn','bankReference','notes','allocations','requestId'] end;
 if allowed is null or jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'INVALID';end if;
 if p_action='banks' then return jsonb_build_object('banks',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'openingDate',opening_date,'openingCents',opening_cents,'balanceCents',uc_registered_bank_position(id)) order by name) from uc_investor_banks),'[]'::jsonb),'company',uc_company_cash_position());end if;
 if p_action='history' then
  select * into pay from payments where id=p_data->>'paymentId';
  if pay.id is null or actor.role='admin' and uc_company_payroll_type(pay.type) then raise exception 'NOT_ALLOWED';end if;
  return jsonb_build_object('paymentId',pay.id,'entries',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'amountCents',a.amount_cents,'paidOn',movement.paid_on,'bankName',bank.name,'reference',movement.bank_reference,'recordedAt',movement.recorded_at,'recordedBy',s.name,'documentId',a.receipt_document_id) order by movement.recorded_at desc,a.id)
   from uc_company_bank_allocations a join uc_company_bank_payments movement on movement.id=a.bank_payment_id join uc_investor_banks bank on bank.id=movement.bank_id join garage_building_staff s on s.id=movement.recorded_by where a.payment_id=pay.id),'[]'::jsonb));
 end if;
 req:=p_data->>'requestId';if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-bank:'||p_actor||':'||req,0));
 select * into batch from uc_company_bank_payments where recorded_by=p_actor and request_id=req;
 if found then
  if batch.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;
 else
  if jsonb_typeof(p_data->'allocations') is distinct from 'array' or jsonb_array_length(p_data->'allocations') not between 1 and 50 then raise exception 'INVALID';end if;
  for item in select value from jsonb_array_elements(p_data->'allocations') loop
   if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('paymentId','amountCents','documentId')) or jsonb_typeof(item->'paymentId') is distinct from 'string' or length(item->>'paymentId') not between 1 and 180 then raise exception 'INVALID';end if;
   if item->>'paymentId'=any(ids) then raise exception 'DUPLICATE_PAYMENT';end if;ids:=array_append(ids,item->>'paymentId');total:=total+uc_recovery_cents(item->'amountCents');
   if uc_recovery_cents(item->'amountCents')<=0 then raise exception 'INVALID';end if;
  end loop;
  if total>1000000000000 then raise exception 'INVALID';end if;
  perform 1 from payments where id=any(ids) order by id for update;
  if (select count(*) from payments where id=any(ids))<>cardinality(ids) then raise exception 'NOT_ALLOWED';end if;
  if exists(select 1 from payments where id=any(ids) and uc_company_payroll_type(type)) and exists(select 1 from payments where id=any(ids) and not uc_company_payroll_type(type)) then raise exception 'SEPARATE_SALARY_PAYMENTS';end if;
  perform 1 from cars where id in (select car_id from payments where id=any(ids)) order by id for update;
  select * into b from uc_investor_banks where id=(p_data->>'bankAccountId')::uuid;
  day:=(p_data->>'paidOn')::date;reference:=trim(p_data->>'bankReference');
  if b.id is null or day is null or day<b.opening_date or day>(now() at time zone 'Asia/Kuala_Lumpur')::date or coalesce(length(reference),0) not between 1 and 200
   or jsonb_typeof(coalesce(p_data->'notes','""'::jsonb))<>'string' or length(coalesce(p_data->>'notes',''))>2000 then raise exception 'INVALID_BANK_PAYMENT';end if;
  bank_account:='acct-bank-uc-'||md5('bank:'||b.id::text);
  insert into uc_company_bank_payments(bank_id,amount_cents,paid_on,bank_reference,recorded_by,notes,request_id,payload)
  values(b.id,total,day,reference,p_actor,coalesce(p_data->>'notes',''),req,p_data) returning * into batch;
  for item in select value from jsonb_array_elements(p_data->'allocations') loop
   select * into pay from payments where id=item->>'paymentId';v_amount:=uc_recovery_cents(item->'amountCents');paid:=uc_company_paid_cents(pay.id);owed:=uc_commission_cents(to_jsonb(pay)->'amount');
   if coalesce(owed,0)<=0 then raise exception 'INVALID';end if;
   if coalesce((to_jsonb(pay)->>'obligation_replaced')::boolean,false) then raise exception 'PAYMENT_WORKFLOW_REQUIRED';end if;
   if pay.status is distinct from 'pending' or v_amount>owed-paid then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
   if pay.type not in ('salesman_commission','intake_bonus','source_commission','repair','misc_cost','expense_claim','purchase_settlement','salary','allowance','campaign_bonus','customer_refund','consignment_payout','panel_charge') then raise exception 'PAYMENT_WORKFLOW_REQUIRED';end if;
   if pay.type in ('consignment_payout','panel_charge') and not uc_consignment_payment_allowed(pay.id) then raise exception 'PAYMENT_WORKFLOW_REQUIRED';end if;
   if uc_consignment_payment_needs_review(pay.id) then raise exception 'CONSIGNMENT_COST_CORRECTION_REQUIRED';end if;
   if uc_consignment_bill_limit(pay.id) is not null and paid+v_amount>uc_consignment_bill_limit(pay.id) then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
   if exists(select 1 from uc_investor_cars where car_id=pay.car_id) or exists(select 1 from cars c where c.id=pay.car_id and (c.investor_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true')) or pay.id like 'uc_commission_%' then raise exception 'USE_INVESTOR_CAR_BILLS';end if;
   if pay.type='expense_claim' and pay.claim_confirmed_by is null then raise exception 'CLAIM_NOT_APPROVED';end if;
   if uc_company_payroll_type(pay.type) and v_amount<>owed-paid then raise exception 'PAYROLL_FULL_PAYMENT_REQUIRED';end if;
   if pay.type='purchase_settlement' and exists(select 1 from cars c where c.id=pay.car_id and (c.consignment is not null and c.consignment<>'null'::jsonb or c.outgoing_consignment is not null and c.outgoing_consignment<>'null'::jsonb)) and not uc_consignment_payment_allowed(pay.id) then raise exception 'PAYMENT_WORKFLOW_REQUIRED';end if;
   select * into doc from uc_company_payment_documents where id=(item->>'documentId')::uuid and payment_id=pay.id and kind='payment' and state='confirmed';
   if doc.id is null then raise exception 'PAYMENT_RECEIPT_REQUIRED';end if;
   if exists(select 1 from uc_company_bank_allocations where receipt_document_id=doc.id) then raise exception 'RECEIPT_ALREADY_USED';end if;
   if uc_company_invoice_type(pay.type) and not exists(select 1 from uc_company_payment_documents where payment_id=pay.id and kind='invoice' and state='confirmed') and uc_supplier_adjustment_invoice(pay.id) is null then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
   v_source_type:=case pay.type when 'expense_claim' then 'expense_claim_confirmed' when 'customer_refund' then 'car_sold' when 'purchase_settlement' then 'car_purchased' else pay.type end;
   v_source_id:=case when pay.type in ('salesman_commission','intake_bonus','source_commission','customer_refund','purchase_settlement') then pay.car_id else pay.id end;
   counter:=case when pay.type='customer_refund' then 'acct-customer-refunds' else 'acct-ap' end;
   -- Do not silently recognise another expense. Existing invoice/accrual is
   -- required; historical omissions are reviewed separately before payout.
   if pay.type<>'campaign_bonus' then
    perform 1 from journal_entries j where (j.source_type=v_source_type and j.source_id=v_source_id or pay.type='customer_refund' and uc_company_refund_receipt_source(j.id,pay.car_id) or pay.type='purchase_settlement' and uc_company_trade_in_source(j.id,pay.car_id) or uc_consignment_journal_source(j.id,pay.id)) and not coalesce(j.voided,false) order by j.id for update;
    select coalesce(sum((l->>'credit')::numeric-(l->>'debit')::numeric),0)*100 into source_credit from journal_entries j cross join lateral jsonb_array_elements(j.lines) l
     where (j.source_type=v_source_type and j.source_id=v_source_id or pay.type='customer_refund' and uc_company_refund_receipt_source(j.id,pay.car_id) or pay.type='purchase_settlement' and uc_company_trade_in_source(j.id,pay.car_id) or uc_consignment_journal_source(j.id,pay.id)) and not coalesce(j.voided,false) and l->>'accountId'=counter;
    select coalesce(sum(a.amount_cents),0) into source_paid from uc_company_bank_allocations a join payments p on p.id=a.payment_id
     where p.type=pay.type and (case when p.type in ('salesman_commission','intake_bonus','source_commission','customer_refund','purchase_settlement') then p.car_id else p.id end)=v_source_id;
    source_paid:=source_paid+coalesce((select sum(((l->>'debit')::numeric-(l->>'credit')::numeric)*100) from payments p join journal_entries j on j.source_id=p.id and j.source_type=p.type||'_paid' cross join lateral jsonb_array_elements(j.lines) l
     where p.type=pay.type and (case when p.type in ('salesman_commission','intake_bonus','source_commission','customer_refund','purchase_settlement') then p.car_id else p.id end)=v_source_id
      and not coalesce(j.voided,false) and j.id not like 'company-bank:%' and l->>'accountId'=counter),0)::bigint;
    if uc_consignment_bill_limit(pay.id) is not null then source_credit:=uc_consignment_bill_limit(pay.id);source_paid:=uc_company_paid_cents(pay.id);end if;
    if source_credit-source_paid<v_amount then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
   end if;
   if exists(select 1 from journal_entries j where j.source_type=pay.type||'_paid' and j.source_id=pay.id and not coalesce(j.voided,false) and j.id not like 'company-bank:%') then raise exception 'PAYMENT_HISTORY_REVIEW_REQUIRED';end if;
   insert into uc_company_bank_allocations(bank_payment_id,payment_id,amount_cents,receipt_document_id) values(batch.id,pay.id,v_amount,doc.id) returning * into allocation;
   perform set_config('autodream.company_bank_payment',txid_current()::text||':'||pay.id,true);
   if pay.type='campaign_bonus' then
    bonus:=used_car_bonus_campaign(p_actor,'settle_bonus',jsonb_build_object('paymentId',pay.id,'transferredAt',day::text||'T12:00:00+08:00','notes',coalesce(p_data->>'notes','')));
    journal_id:=bonus->'journal'->>'id';
    old_bonus:=current_setting('app.used_car_bonus_posting',true);perform set_config('app.used_car_bonus_posting','1',true);
    select lines into source_lines from journal_entries where id=journal_id;
    if source_lines is null or (select count(*) from jsonb_array_elements(source_lines) l where l->>'accountId'='acct-bank-operating' and (l->>'credit')::numeric=v_amount::numeric/100)<>1 then raise exception 'PAYMENT_HISTORY_REVIEW_REQUIRED';end if;
    update journal_entries set lines=(select jsonb_agg(case when l->>'accountId'='acct-bank-operating' then l||jsonb_build_object('accountId',bank_account) else l end) from jsonb_array_elements(source_lines) l) where id=journal_id;
    perform set_config('app.used_car_bonus_posting',coalesce(old_bonus,''),true);
   else
    insert into journal_entries(id,date,description,lines,source_type,source_id,car_id,created_by)
    values('company-bank:'||allocation.id::text,day,'Payment recorded: '||coalesce(pay.recipient_name,pay.id),jsonb_build_array(
     jsonb_build_object('accountId',counter,'debit',v_amount::numeric/100,'credit',0),jsonb_build_object('accountId',bank_account,'debit',0,'credit',v_amount::numeric/100)),pay.type||'_paid',pay.id,pay.car_id,p_actor);
    update payments set status=case when paid+v_amount=owed then 'transferred' else 'pending' end,
     transferred_at=case when paid+v_amount=owed then (day::text||'T12:00:00+08:00')::timestamptz else null end,
     transferred_by=case when paid+v_amount=owed then p_actor else null end where id=pay.id;
   end if;
   perform set_config('autodream.company_bank_payment','',true);
  end loop;
  insert into uc_bank_movements(bank_id,amount_cents,paid_on,bank_reference,source_kind,source_id,recorded_by) values(b.id,-total,day,reference,'company',batch.id,p_actor);
 end if;
 return jsonb_build_object('bankPaymentId',batch.id,'payments',(select jsonb_agg(to_jsonb(p)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(p.id))) from payments p where p.id in (select payment_id from uc_company_bank_allocations where bank_payment_id=batch.id)),
  'journals',coalesce((select jsonb_agg(to_jsonb(j)) from journal_entries j where j.id in (select 'company-bank:'||a.id::text from uc_company_bank_allocations a where a.bank_payment_id=batch.id) or j.id in (select 'bonus-paid:'||a.payment_id from uc_company_bank_allocations a where a.bank_payment_id=batch.id)),'[]'::jsonb));
end $$;
-- Extend the private projection without exposing salary/bank information to
-- broader roles; its existing server-side row restrictions remain mandatory.
create or replace view public.uc_private_payment_rows as
 select p.*,case when p.status='transferred' then coalesce(uc_commission_cents(to_jsonb(p)->'amount'),0) else uc_company_paid_cents(p.id) end bank_paid_cents from payments p
 union all select (jsonb_populate_record(null::public.payments,r.row_data)).*,case when r.row_data->>'status'='transferred' then uc_commission_cents(r.row_data->'amount') else 0 end bank_paid_cents from uc_investor_commission_bills c
 cross join lateral(select uc_commission_payment_row(c.bill_id) row_data) r where r.row_data is not null;
revoke all on function uc_company_refund_receipt_source(text,text),uc_investor_bank_movement(),uc_company_paid_cents(text),uc_registered_bank_position(uuid),uc_company_cash_position(),uc_company_bank_payment_guard(),uc_company_bank_journal_guard(),uc_company_bank_money(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function uc_consignment_payment_allowed(text),uc_consignment_journal_source(text,text),uc_consignment_payment_needs_review(text),uc_consignment_bill_limit(text) from public,anon,authenticated,service_role;
grant execute on function uc_company_bank_money(text,text,jsonb) to service_role;
revoke all on function uc_company_trade_in_source(text,text) from public,anon,authenticated,service_role;
-- The protected view calls these helpers in its expressions.
grant execute on function uc_company_paid_cents(text),uc_commission_cents(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
