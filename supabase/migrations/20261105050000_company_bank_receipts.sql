-- PREPARED ONLY. Company cash/loan receipts and invoiced withheld bills.
begin;
do $$ begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' or to_regclass('uc_trade_in_lender_payments') is null then raise exception 'BANK_LENDER_FOUNDATION_REQUIRED';end if;
end $$;
alter table uc_bank_movements drop constraint uc_bank_movements_source_kind_check;
alter table uc_bank_movements add constraint uc_bank_source_kind check(source_kind in ('investor','company','company_receipt'));
create table public.uc_company_bank_receipts (
 id uuid primary key default gen_random_uuid(),payment_id text not null references payments(id),car_id text not null references cars(id),
 bank_id uuid not null references uc_investor_banks(id),amount_cents bigint not null check(amount_cents between 0 and 1000000000000),
 covered_cents bigint not null check(covered_cents between 1 and 1000000000000),withheld_cents bigint not null check(withheld_cents between 0 and 1000000000000),excess_cents bigint not null check(excess_cents between 0 and 1000000000000),
 customer_id text,receipt_document_id uuid not null unique references uc_company_payment_documents(id),paid_on date not null,bank_reference text not null,
 recorded_by text not null references garage_building_staff(id),recorded_at timestamptz not null default now(),request_id text not null,payload jsonb not null,
 check(covered_cents=amount_cents+withheld_cents-excess_cents),check(excess_cents=0 or customer_id is not null),unique(recorded_by,request_id)
);
create unique index uc_company_receipt_reference on uc_company_bank_receipts(bank_id,lower(trim(bank_reference)));
create index uc_company_receipt_payment on uc_company_bank_receipts(payment_id);
create index uc_company_receipt_car on uc_company_bank_receipts(car_id);
create table public.uc_company_withheld_payments (
 receipt_id uuid not null references uc_company_bank_receipts(id),payment_id text not null references payments(id),amount_cents bigint not null check(amount_cents between 1 and 1000000000000),
 receipt_document_id uuid not null unique references uc_company_payment_documents(id),primary key(receipt_id,payment_id)
);
create index uc_company_withheld_payment on uc_company_withheld_payments(payment_id);
do $$ declare t text;begin
 foreach t in array array['uc_company_bank_receipts','uc_company_withheld_payments'] loop
  execute format('create trigger %I before update or delete on %I for each row execute function uc_investor_immutable()',t||'_fixed',t);
  execute format('create trigger %I before truncate on %I execute function uc_investor_immutable()',t||'_no_truncate',t);
  execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
create or replace function public.uc_company_paid_cents(p_payment text) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select (coalesce((select sum(amount_cents) from uc_company_bank_allocations where payment_id=p_payment),0)+coalesce((select sum(covered_cents) from uc_company_bank_receipts where payment_id=p_payment),0)+coalesce((select sum(amount_cents) from uc_company_withheld_payments where payment_id=p_payment),0))::bigint $$;
create function public.uc_company_has_bank_history(p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from uc_company_bank_allocations where payment_id=p_payment) or exists(select 1 from uc_company_bank_receipts where payment_id=p_payment) or exists(select 1 from uc_company_withheld_payments where payment_id=p_payment) $$;
create or replace function public.uc_company_bank_payment_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then if uc_company_has_bank_history(old.id) then raise exception 'BANK_PAYMENT_IMMUTABLE';end if;return old;end if;
 if tg_op='UPDATE' and uc_company_has_bank_history(old.id) and (to_jsonb(new)-array['status','transferred_at','transferred_by','notes','receipt_url','delete_requested_by','delete_requested_at']) is distinct from (to_jsonb(old)-array['status','transferred_at','transferred_by','notes','receipt_url','delete_requested_by','delete_requested_at']) then raise exception 'BANK_PAYMENT_IMMUTABLE';end if;
 if (tg_op='INSERT' and new.status='transferred') or (tg_op='UPDATE' and new.status is distinct from old.status) then
  if current_setting('autodream.company_bank_payment',true) is distinct from txid_current()::text||':'||new.id then raise exception 'USE_COMPANY_BANK_PAYMENT';end if;
 end if;return new;
end $$;
create function public.uc_company_receipt_journal_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op<>'INSERT' and old.id like 'company-receipt:%' then raise exception 'BANK_PAYMENT_IMMUTABLE';end if;
 if tg_op<>'INSERT' and old.source_type='car_sold' and exists(select 1 from uc_company_bank_receipts where car_id=old.car_id) then raise exception 'BANK_PAYMENT_IMMUTABLE';end if;
 if tg_op<>'INSERT' and exists(select 1 from uc_company_withheld_payments w join payments p on p.id=w.payment_id where old.source_type=p.type and old.source_id=p.id) then raise exception 'BANK_PAYMENT_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger uc_company_receipt_journal_guard before update or delete on journal_entries for each row execute function uc_company_receipt_journal_guard();
create function public.uc_company_receipt_document_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from uc_company_withheld_payments where receipt_document_id=new.receipt_document_id) then raise exception 'RECEIPT_ALREADY_USED';end if;return new;
end $$;
create trigger uc_company_cash_receipt_once before insert on uc_company_bank_allocations for each row execute function uc_company_receipt_document_guard();

create function public.uc_company_bank_receipt(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;pay payments;bill payments;car cars;bank uc_investor_banks;receipt uc_company_bank_receipts;doc uc_company_payment_documents;customer jsonb;
 req text;allowed text[];ids text[]:='{}';item jsonb;amount bigint;fees bigint:=0;excess bigint;covered bigint;owing bigint;bill_paid bigint;bill_amount bigint;credit numeric;day date;reference text;
 counter text;v_source_id text;v_source_type text;v_lines jsonb;doc_id uuid;name text;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if p_action='balance' then
  if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role in ('director','admin','shareholder','salesperson') and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
  if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k<>'carId') or coalesce(length(p_data->>'carId'),0) not between 1 and 180 then raise exception 'INVALID';end if;
  select * into car from cars where id=p_data->>'carId';
  if car.id is null or car.investor_id is not null or coalesce(to_jsonb(car)->>'investor_tagged','false')='true' or exists(select 1 from uc_investor_cars where car_id=car.id) or car.consignment is not null and car.consignment<>'null'::jsonb or car.outgoing_consignment is not null and car.outgoing_consignment<>'null'::jsonb then raise exception 'NOT_ALLOWED';end if;
  if actor.role='salesperson' and (to_jsonb(car)->>'assigned_salesperson') is distinct from p_actor then
   execute 'select to_jsonb(c) from customers c where to_jsonb(c)->>''interested_car_id''=$1 and to_jsonb(c)->>''assigned_sales_id''=$2 limit 1' into customer using car.id,p_actor;
   if customer is null then raise exception 'NOT_ALLOWED';end if;
  end if;
  return jsonb_build_object('carId',car.id,
   'customerCoveredCents',(select coalesce(sum(case when p.status='transferred' and not uc_company_has_bank_history(p.id) then uc_commission_cents(to_jsonb(p)->'amount') else uc_company_paid_cents(p.id) end),0) from payments p where p.car_id=car.id and p.type='customer_collection'),
   'loanCoveredCents',(select coalesce(sum(case when p.status='transferred' and not uc_company_has_bank_history(p.id) then uc_commission_cents(to_jsonb(p)->'amount') else uc_company_paid_cents(p.id) end),0) from payments p where p.car_id=car.id and p.type='loan_disbursement'));
 end if;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 allowed:=case p_action when 'record' then array['paymentId','amountCents','excessCents','customerId','withheldBills','receiptDocumentId','bankAccountId','bankReference','paidOn','requestId'] end;
 if allowed is null or jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'INVALID';end if;
 req:=p_data->>'requestId';if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-receipt:'||p_actor||':'||req,0));
 select * into receipt from uc_company_bank_receipts where recorded_by=p_actor and request_id=req;
 if found then if receipt.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;
 else
  amount:=uc_recovery_cents(p_data->'amountCents');excess:=uc_recovery_cents(coalesce(p_data->'excessCents','0'::jsonb));
  if jsonb_typeof(coalesce(p_data->'withheldBills','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_data->'withheldBills','[]'::jsonb))>20 then raise exception 'INVALID';end if;
  ids:=array[p_data->>'paymentId'];
  for item in select value from jsonb_array_elements(coalesce(p_data->'withheldBills','[]'::jsonb)) loop
   if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('paymentId','amountCents','documentId')) or jsonb_typeof(item->'paymentId') is distinct from 'string' or item->>'paymentId'=any(ids) then raise exception 'INVALID';end if;
   ids:=array_append(ids,item->>'paymentId');fees:=fees+uc_recovery_cents(item->'amountCents');if uc_recovery_cents(item->'amountCents')<=0 then raise exception 'INVALID';end if;
  end loop;
  perform 1 from payments where id=any(ids) order by id for update;
  select * into pay from payments where id=p_data->>'paymentId';
  if pay.id is null or pay.car_id is null or coalesce(pay.type,'') not in ('customer_collection','loan_disbursement') then raise exception 'COLLECTION_WORKFLOW_REQUIRED';end if;
  select * into car from cars where id=pay.car_id for update;
  if car.id is null or car.investor_id is not null or coalesce(to_jsonb(car)->>'investor_tagged','false')='true' or exists(select 1 from uc_investor_cars where car_id=car.id) then raise exception 'USE_INVESTOR_CAR_BILLS';end if;
  if car.consignment is not null and car.consignment<>'null'::jsonb or car.outgoing_consignment is not null and car.outgoing_consignment<>'null'::jsonb then raise exception 'COLLECTION_WORKFLOW_REQUIRED';end if;
  if pay.type='loan_disbursement' and (exists(select 1 from journal_entries where source_type='disbursement_received' and source_id=car.id and not coalesce(voided,false) and id not like 'company-receipt:%')
   or coalesce((to_jsonb(car)->>'money_received')::boolean,false) and not exists(select 1 from uc_company_bank_receipts where payment_id=pay.id)) then raise exception 'COLLECTION_HISTORY_REVIEW_REQUIRED';end if;
  covered:=amount+fees-excess;owing:=uc_commission_cents(to_jsonb(pay)->'amount')-uc_company_paid_cents(pay.id);
  if pay.status is distinct from 'pending' or coalesce(owing,0)<=0 or covered<=0 or covered>owing or fees>1000000000000 then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
  select * into bank from uc_investor_banks where id=(p_data->>'bankAccountId')::uuid;day:=(p_data->>'paidOn')::date;reference:=trim(p_data->>'bankReference');
  if bank.id is null or day is null or day<bank.opening_date or day>(now() at time zone 'Asia/Kuala_Lumpur')::date or coalesce(length(reference),0) not between 1 and 200 then raise exception 'INVALID_BANK_PAYMENT';end if;
  select * into doc from uc_company_payment_documents where id=(p_data->>'receiptDocumentId')::uuid and payment_id=pay.id and kind='payment' and state='confirmed';
  if doc.id is null then raise exception 'PAYMENT_RECEIPT_REQUIRED';end if;
  if exists(select 1 from uc_company_bank_receipts where receipt_document_id=doc.id) then raise exception 'RECEIPT_ALREADY_USED';end if;
  if excess>0 then
   execute 'select to_jsonb(c) from customers c where c.id=$1 and to_jsonb(c)->>''interested_car_id''=$2' into customer using p_data->>'customerId',car.id;
   if customer is null then raise exception 'CUSTOMER_REQUIRED';end if;
  end if;
  counter:='acct-ar';v_source_type:=case pay.type when 'loan_disbursement' then 'disbursement_received' else 'customer_collection_received' end;v_source_id:=case pay.type when 'loan_disbursement' then car.id else pay.id end;
  -- Older cash-sale entries already booked Bank Operating. Reclassify that
  -- same cash to its real bank instead of recognising it for a second time.
  if pay.type='customer_collection' and exists(select 1 from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.source_type='car_sold' and j.source_id=car.id and not coalesce(j.voided,false) and l->>'accountId'='acct-bank-operating' and (l->>'debit')::numeric>0) then counter:='acct-bank-operating';end if;
  insert into uc_company_bank_receipts(payment_id,car_id,bank_id,amount_cents,covered_cents,withheld_cents,excess_cents,customer_id,receipt_document_id,paid_on,bank_reference,recorded_by,request_id,payload)
  values(pay.id,car.id,bank.id,amount,covered,fees,excess,case when excess>0 then p_data->>'customerId' end,doc.id,day,reference,p_actor,req,p_data) returning * into receipt;
  v_lines:='[]'::jsonb;
  if amount>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId','acct-bank-uc-'||md5('bank:'||bank.id::text),'debit',amount::numeric/100,'credit',0));end if;
  for item in select value from jsonb_array_elements(coalesce(p_data->'withheldBills','[]'::jsonb)) loop
   select * into bill from payments where id=item->>'paymentId';bill_amount:=uc_recovery_cents(item->'amountCents');bill_paid:=uc_company_paid_cents(bill.id);
   if bill.id is null or bill.car_id is distinct from car.id or coalesce(bill.type,'') not in ('repair','misc_cost','panel_charge') or bill.status is distinct from 'pending' or coalesce(uc_commission_cents(to_jsonb(bill)->'amount'),0)<=0 or bill_amount>uc_commission_cents(to_jsonb(bill)->'amount')-bill_paid then raise exception 'WITHHELD_BILL_REQUIRED';end if;
   if not exists(select 1 from uc_company_payment_documents where payment_id=bill.id and kind='invoice' and state='confirmed') then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
   select * into doc from uc_company_payment_documents where id=(item->>'documentId')::uuid and payment_id=bill.id and kind='payment' and state='confirmed';if doc.id is null then raise exception 'PAYMENT_RECEIPT_REQUIRED';end if;
   if exists(select 1 from uc_company_bank_allocations where receipt_document_id=doc.id) or exists(select 1 from uc_company_withheld_payments where receipt_document_id=doc.id) then raise exception 'RECEIPT_ALREADY_USED';end if;
   perform 1 from journal_entries j where j.source_type=bill.type and j.source_id=bill.id and not coalesce(j.voided,false) order by j.id for update;
   select coalesce(sum(((l->>'credit')::numeric-(l->>'debit')::numeric)*100),0) into credit from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.source_type=bill.type and j.source_id=bill.id and not coalesce(j.voided,false) and l->>'accountId'='acct-ap';
   if bill_amount>credit-bill_paid then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
   insert into uc_company_withheld_payments(receipt_id,payment_id,amount_cents,receipt_document_id) values(receipt.id,bill.id,bill_amount,doc.id);
   perform set_config('autodream.company_bank_payment',txid_current()::text||':'||bill.id,true);
   update payments set status=case when bill_paid+bill_amount=uc_commission_cents(to_jsonb(bill)->'amount') then 'transferred' else 'pending' end,
    transferred_at=case when bill_paid+bill_amount=uc_commission_cents(to_jsonb(bill)->'amount') then (day::text||'T12:00:00+08:00')::timestamptz else null end,transferred_by=case when bill_paid+bill_amount=uc_commission_cents(to_jsonb(bill)->'amount') then p_actor else null end where id=bill.id;
   v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId','acct-ap','debit',bill_amount::numeric/100,'credit',0));
  end loop;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',counter,'debit',0,'credit',covered::numeric/100));
  if excess>0 then
   v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId','acct-customer-refunds','debit',0,'credit',excess::numeric/100));
   insert into payments(id,type,car_id,recipient_type,recipient_id,recipient_name,amount,description,status,created_at)
   values('company-excess:'||receipt.id::text,'customer_refund',car.id,'customer',p_data->>'customerId',coalesce(customer->>'name','Customer'),excess::numeric/100,'Customer excess received: '||reference,'pending',now());
  end if;
  perform set_config('autodream.company_bank_payment',txid_current()::text||':'||v_source_id,true);
  insert into journal_entries(id,date,description,lines,source_type,source_id,car_id,created_by) values('company-receipt:'||receipt.id::text,day,'Company money received: '||coalesce(pay.recipient_name,pay.id),v_lines,v_source_type,v_source_id,car.id,p_actor);
  perform set_config('autodream.company_bank_payment',txid_current()::text||':'||pay.id,true);
  update payments set status=case when covered=owing then 'transferred' else 'pending' end,transferred_at=case when covered=owing then (day::text||'T12:00:00+08:00')::timestamptz else null end,transferred_by=case when covered=owing then p_actor else null end where id=pay.id;
  perform set_config('autodream.company_bank_payment','',true);
  if amount>0 then insert into uc_bank_movements(bank_id,amount_cents,paid_on,bank_reference,source_kind,source_id,recorded_by) values(bank.id,amount,day,reference,'company_receipt',receipt.id,p_actor);end if;
  if pay.type='loan_disbursement' then
   update cars set money_received=(covered=owing),disbursement_status=case when covered=owing then 'disbursed' else 'processing' end,
    disbursement_amount=(select sum(amount_cents)::numeric/100 from uc_company_bank_receipts where payment_id=pay.id),disbursement_expected_amount=pay.amount,disbursement_date=day where id=car.id;
  end if;
 end if;
 return jsonb_build_object('receiptId',receipt.id,'payments',(select jsonb_agg(to_jsonb(p)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(p.id))) from payments p where p.id=receipt.payment_id or p.id in (select payment_id from uc_company_withheld_payments where receipt_id=receipt.id) or p.id='company-excess:'||receipt.id::text),
  'journals',(select jsonb_agg(to_jsonb(j)) from journal_entries j where j.id='company-receipt:'||receipt.id::text),'car',(select to_jsonb(c) from cars c where c.id=receipt.car_id));
end $$;

-- Extend the existing private history without exposing other allocations in
-- a batch or the total of a separate salary transaction.
alter function uc_company_bank_money(text,text,jsonb) rename to uc_company_bank_before_receipts;
create function public.uc_company_bank_money(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 if p_action='month' then
  perform 1 from garage_building_staff where id=p_actor and enabled and registration_status='active' and role='director' and business_access in ('used_car','both') for share;
  if not found then raise exception 'NOT_ALLOWED';end if;
  if p_data is distinct from '{}'::jsonb then raise exception 'INVALID';end if;
  return jsonb_build_object('month',jsonb_build_object('receivedCents',coalesce((select sum(amount_cents) from uc_bank_movements where source_kind='company_receipt' and paid_on>=date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date),0),
   'paidCents',coalesce((select -sum(amount_cents) from uc_bank_movements where source_kind='company' and paid_on>=date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date),0)));
 end if;
 result:=uc_company_bank_before_receipts(p_actor,p_action,p_data);
 if p_action='history' then result:=result||jsonb_build_object('entries',coalesce(result->'entries','[]'::jsonb)||coalesce((select jsonb_agg(x.entry) from (
  select jsonb_build_object('id',r.id,'kind','received','amountCents',r.amount_cents,'coveredCents',r.covered_cents,'withheldCents',r.withheld_cents,'excessCents',r.excess_cents,'paidOn',r.paid_on,'bankName',b.name,'reference',r.bank_reference,'recordedAt',r.recorded_at,'recordedBy',s.name,'documentId',r.receipt_document_id) entry
   from uc_company_bank_receipts r join uc_investor_banks b on b.id=r.bank_id join garage_building_staff s on s.id=r.recorded_by where r.payment_id=p_data->>'paymentId'
  union all select jsonb_build_object('id',r.id::text||':'||w.payment_id,'kind','deducted','amountCents',w.amount_cents,'paidOn',r.paid_on,'bankName',b.name,'reference',r.bank_reference,'recordedAt',r.recorded_at,'recordedBy',s.name,'documentId',w.receipt_document_id)
   from uc_company_withheld_payments w join uc_company_bank_receipts r on r.id=w.receipt_id join uc_investor_banks b on b.id=r.bank_id join garage_building_staff s on s.id=r.recorded_by where w.payment_id=p_data->>'paymentId'
 ) x),'[]'::jsonb));end if;return result;
end $$;
revoke all on function uc_company_has_bank_history(text),uc_company_receipt_journal_guard(),uc_company_receipt_document_guard(),uc_company_bank_receipt(text,text,jsonb),uc_company_bank_before_receipts(text,text,jsonb),uc_company_bank_money(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_company_bank_receipt(text,text,jsonb),uc_company_bank_money(text,text,jsonb) to service_role;
commit;
