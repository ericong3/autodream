-- Bills paid before the bank account's opening date (the finance cut-off).
--
-- Until 31 Oct 2026 most bills were paid outside the app. The registered bank
-- starts from its real statement balance on its opening date, so that balance
-- already reflects those older transfers. Recording them as ordinary bank
-- payments is refused (the date is before the opening) and would take the money
-- out of the bank a second time.
--
-- "Paid before opening" settles such a bill with its bank slip and the real
-- date, under the same checks as a bank payment, but with no bank movement:
-- the payable is cleared against acct-opening-review (the opening-balance
-- difference waiting for review), which those older transfers explain. It
-- counts as paid everywhere uc_company_paid_cents is read, and fixes the bill
-- like any bank history. Director only; permanent history.
begin;
do $$ begin
 if to_regclass('public.uc_dealer_legacy_payouts') is null or to_regclass('public.uc_dealer_conversion_allocations') is null
  or to_regclass('public.uc_company_withheld_payments') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;
insert into ledger_accounts(id,name,type) values('acct-opening-review','Opening balance waiting for review','equity') on conflict(id) do nothing;

create table public.uc_company_before_opening_payments(
 id uuid primary key default gen_random_uuid(),payment_id text not null unique references payments(id),bank_id uuid not null references uc_investor_banks(id),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),paid_on date not null,bank_reference text not null check(length(trim(bank_reference)) between 1 and 200),
 receipt_document_id uuid not null unique references uc_company_payment_documents(id),notes text not null default '' check(length(notes)<=2000),
 recorded_by text not null references garage_building_staff(id),recorded_at timestamptz not null default now(),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),payload jsonb not null,unique(recorded_by,request_id)
);
create trigger uc_company_before_opening_fixed before update or delete on uc_company_before_opening_payments for each row execute function uc_investor_immutable();
create trigger uc_company_before_opening_no_truncate before truncate on uc_company_before_opening_payments execute function uc_investor_immutable();
alter table uc_company_before_opening_payments enable row level security;
revoke all on uc_company_before_opening_payments from public,anon,authenticated,service_role;

-- Settled before opening counts as paid, like a bank allocation.
create or replace function public.uc_company_paid_cents(p_payment text) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select (coalesce((select sum(amount_cents) from uc_company_bank_allocations where payment_id=p_payment),0)+coalesce((select sum(covered_cents) from uc_company_bank_receipts where payment_id=p_payment),0)+coalesce((select sum(amount_cents) from uc_company_withheld_payments where payment_id=p_payment),0)
  +coalesce((select sum(amount_cents) from uc_dealer_conversion_allocations where payment_id=p_payment),0)
  +coalesce((select sum(amount_cents) from uc_company_before_opening_payments where payment_id=p_payment),0))::bigint $$;
create or replace function public.uc_company_has_bank_history(p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from uc_company_bank_allocations where payment_id=p_payment) or exists(select 1 from uc_company_bank_receipts where payment_id=p_payment) or exists(select 1 from uc_company_withheld_payments where payment_id=p_payment)
  or exists(select 1 from uc_dealer_conversion_allocations where payment_id=p_payment) or exists(select 1 from uc_dealer_legacy_payouts where payment_id=p_payment)
  or exists(select 1 from uc_company_before_opening_payments where payment_id=p_payment) $$;

create function public.uc_company_pay_before_opening(p_actor text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;pay payments;b uc_investor_banks;doc uc_company_payment_documents;r uc_company_before_opening_payments;req text;day date;reference text;
 owed bigint;paid bigint;v_amount bigint;v_source_type text;v_source_id text;counter text;source_credit numeric;source_paid bigint;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('paymentId','bankAccountId','paidOn','bankReference','notes','documentId','requestId')) then raise exception 'INVALID';end if;
 req:=p_data->>'requestId';if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-bank:'||p_actor||':'||req,0));
 select * into r from uc_company_before_opening_payments where recorded_by=p_actor and request_id=req;
 if found then
  if r.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;
 else
  perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
  select * into pay from payments where id=p_data->>'paymentId' for update;
  if pay.id is null then raise exception 'NOT_ALLOWED';end if;
  perform 1 from cars where id=pay.car_id for update;
  select * into b from uc_investor_banks where id=case when coalesce(p_data->>'bankAccountId','')~'^[0-9a-fA-F-]{36}$' then (p_data->>'bankAccountId')::uuid end;
  day:=case when coalesce(p_data->>'paidOn','')~'^\d{4}-\d{2}-\d{2}$' then (p_data->>'paidOn')::date end;reference:=trim(p_data->>'bankReference');
  if b.id is null or day is null or day<date '2000-01-01' or coalesce(length(reference),0) not between 1 and 200
   or jsonb_typeof(coalesce(p_data->'notes','""'::jsonb))<>'string' or length(coalesce(p_data->>'notes',''))>2000 then raise exception 'INVALID_BANK_PAYMENT';end if;
  if day>=b.opening_date then raise exception 'AFTER_BANK_OPENING';end if;
  owed:=uc_commission_cents(to_jsonb(pay)->'amount');paid:=uc_company_paid_cents(pay.id);v_amount:=coalesce(owed,0)-paid;
  if coalesce(owed,0)<=0 then raise exception 'INVALID';end if;
  if coalesce((to_jsonb(pay)->>'obligation_replaced')::boolean,false) then raise exception 'PAYMENT_WORKFLOW_REQUIRED';end if;
  if pay.status is distinct from 'pending' or v_amount<=0 then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
  if pay.type not in ('salesman_commission','intake_bonus','source_commission','repair','misc_cost','expense_claim','purchase_settlement','salary','allowance','customer_refund','consignment_payout','panel_charge') then raise exception 'PAYMENT_WORKFLOW_REQUIRED';end if;
  if pay.type in ('consignment_payout','panel_charge') and not uc_consignment_payment_allowed(pay.id) then raise exception 'PAYMENT_WORKFLOW_REQUIRED';end if;
  if uc_consignment_payment_needs_review(pay.id) then raise exception 'CONSIGNMENT_COST_CORRECTION_REQUIRED';end if;
  if uc_consignment_bill_limit(pay.id) is not null and paid+v_amount>uc_consignment_bill_limit(pay.id) then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
  if exists(select 1 from uc_investor_cars where car_id=pay.car_id) or exists(select 1 from cars c where c.id=pay.car_id and (c.investor_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true')) or pay.id like 'uc_commission_%' then raise exception 'USE_INVESTOR_CAR_BILLS';end if;
  if pay.type='expense_claim' and pay.claim_confirmed_by is null then raise exception 'CLAIM_NOT_APPROVED';end if;
  if pay.type='purchase_settlement' and exists(select 1 from cars c where c.id=pay.car_id and (c.consignment is not null and c.consignment<>'null'::jsonb or c.outgoing_consignment is not null and c.outgoing_consignment<>'null'::jsonb)) and not uc_consignment_payment_allowed(pay.id) then raise exception 'PAYMENT_WORKFLOW_REQUIRED';end if;
  select * into doc from uc_company_payment_documents where id=case when coalesce(p_data->>'documentId','')~'^[0-9a-fA-F-]{36}$' then (p_data->>'documentId')::uuid end and payment_id=pay.id and kind='payment' and state='confirmed';
  if doc.id is null then raise exception 'PAYMENT_RECEIPT_REQUIRED';end if;
  if exists(select 1 from uc_company_bank_allocations where receipt_document_id=doc.id) or exists(select 1 from uc_company_before_opening_payments where receipt_document_id=doc.id) then raise exception 'RECEIPT_ALREADY_USED';end if;
  -- The bill must already be owed in the ledger, exactly as for a bank payment.
  v_source_type:=case pay.type when 'expense_claim' then 'expense_claim_confirmed' when 'customer_refund' then 'car_sold' when 'purchase_settlement' then 'car_purchased' else pay.type end;
  v_source_id:=case when pay.type in ('salesman_commission','intake_bonus','source_commission','customer_refund','purchase_settlement') then pay.car_id else pay.id end;
  counter:=case when pay.type='customer_refund' then 'acct-customer-refunds' else 'acct-ap' end;
  perform 1 from journal_entries j where (j.source_type=v_source_type and j.source_id=v_source_id or pay.type='customer_refund' and uc_company_refund_receipt_source(j.id,pay.car_id) or pay.type='purchase_settlement' and uc_company_trade_in_source(j.id,pay.car_id) or uc_consignment_journal_source(j.id,pay.id)) and not coalesce(j.voided,false) order by j.id for update;
  select coalesce(sum((l->>'credit')::numeric-(l->>'debit')::numeric),0)*100 into source_credit from journal_entries j cross join lateral jsonb_array_elements(j.lines) l
   where (j.source_type=v_source_type and j.source_id=v_source_id or pay.type='customer_refund' and uc_company_refund_receipt_source(j.id,pay.car_id) or pay.type='purchase_settlement' and uc_company_trade_in_source(j.id,pay.car_id) or uc_consignment_journal_source(j.id,pay.id)) and not coalesce(j.voided,false) and l->>'accountId'=counter;
  select coalesce(sum(uc_company_paid_cents(p.id)),0) into source_paid from payments p
   where p.type=pay.type and (case when p.type in ('salesman_commission','intake_bonus','source_commission','customer_refund','purchase_settlement') then p.car_id else p.id end)=v_source_id;
  source_paid:=source_paid+coalesce((select sum(((l->>'debit')::numeric-(l->>'credit')::numeric)*100) from payments p join journal_entries j on j.source_id=p.id and j.source_type=p.type||'_paid' cross join lateral jsonb_array_elements(j.lines) l
   where p.type=pay.type and (case when p.type in ('salesman_commission','intake_bonus','source_commission','customer_refund','purchase_settlement') then p.car_id else p.id end)=v_source_id
    and not coalesce(j.voided,false) and j.id not like 'company-bank:%' and j.id not like 'company-before-opening:%' and l->>'accountId'=counter),0)::bigint;
  if uc_consignment_bill_limit(pay.id) is not null then source_credit:=uc_consignment_bill_limit(pay.id);source_paid:=paid;end if;
  if source_credit-source_paid<v_amount then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
  if exists(select 1 from journal_entries j where j.source_type=pay.type||'_paid' and j.source_id=pay.id and not coalesce(j.voided,false) and j.id not like 'company-bank:%' and j.id not like 'company-before-opening:%') then raise exception 'PAYMENT_HISTORY_REVIEW_REQUIRED';end if;
  insert into uc_company_before_opening_payments(payment_id,bank_id,amount_cents,paid_on,bank_reference,receipt_document_id,notes,recorded_by,request_id,payload)
   values(pay.id,b.id,v_amount,day,reference,doc.id,coalesce(p_data->>'notes',''),p_actor,req,p_data) returning * into r;
  perform set_config('autodream.company_bank_payment',txid_current()::text||':'||pay.id,true);
  insert into journal_entries(id,date,description,lines,source_type,source_id,car_id,created_by)
  values('company-before-opening:'||r.id::text,day,'Paid before the bank opening date (no bank movement): '||coalesce(pay.recipient_name,pay.id),jsonb_build_array(
   jsonb_build_object('accountId',counter,'debit',v_amount::numeric/100,'credit',0),jsonb_build_object('accountId','acct-opening-review','debit',0,'credit',v_amount::numeric/100)),pay.type||'_paid',pay.id,pay.car_id,p_actor);
  update payments set status='transferred',transferred_at=(day::text||'T12:00:00+08:00')::timestamptz,transferred_by=p_actor where id=pay.id;
  perform set_config('autodream.company_bank_payment','',true);
 end if;
 return jsonb_build_object('beforeOpeningId',r.id,'paymentId',r.payment_id,'amountCents',r.amount_cents,'paidOn',r.paid_on,
  'payments',(select jsonb_agg(to_jsonb(p)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(p.id))) from payments p where p.id=r.payment_id),
  'journals',coalesce((select jsonb_agg(to_jsonb(j)) from journal_entries j where j.id='company-before-opening:'||r.id::text),'[]'::jsonb));
end $$;

alter function uc_company_bank_money(text,text,jsonb) rename to uc_bank_money_before_opening_payments;
create function public.uc_company_bank_money(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_action='record_before_opening' then return uc_company_pay_before_opening(p_actor,p_data);end if;
 return uc_bank_money_before_opening_payments(p_actor,p_action,p_data);
end $$;
revoke all on function uc_company_pay_before_opening(text,jsonb),uc_bank_money_before_opening_payments(text,text,jsonb),uc_company_bank_money(text,text,jsonb),uc_company_has_bank_history(text) from public,anon,authenticated,service_role;
grant execute on function uc_company_bank_money(text,text,jsonb),uc_company_paid_cents(text) to service_role;
commit;
