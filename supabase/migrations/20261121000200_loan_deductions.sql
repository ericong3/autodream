-- Bank loan money with deductions.
-- The bank (or the panel that receives the loan for us) takes charges out
-- before the money reaches us: panel fees, bank processing fee, insurance,
-- JPJ and road tax, runner. "Mark received" on the bank loan now records the
-- money that arrived plus each deduction, so the loan counts as fully covered.
--  * A deduction that matches a car bill already waiting (Panel charge, an
--    insurance misc bill) pays that bill.
--  * Any other deduction becomes a misc cost on the car, already paid, so the
--    profit includes it and dealer approval sees it like any other car bill.
--  * Ledger: the cost is recognised (Dr inventory / Cr payable) and paid from
--    the loan money (Dr payable / Cr "Money received - to match"; before the
--    bank's opening date Cr "Opening balance waiting for review").
--  * The panel's statement attached to the money (its slip) is the proof for
--    every deduction, so none of them shows as a missing invoice or receipt.
-- Director only; permanent history.
begin;
do $$ begin
 if to_regclass('public.uc_money_received') is null or to_regprocedure('public.uc_money_received_action(text,text,jsonb)') is null
  or to_regprocedure('public.uc_company_paid_cents(text)') is null or to_regprocedure('public.uc_company_has_bank_history(text)') is null
  or to_regprocedure('public.uc_car_cases()') is null or to_regprocedure('public.uc_company_evidence(text,text,jsonb)') is null
  or to_regprocedure('public.uc_company_payment_evidence()') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;
insert into ledger_accounts(id,name,type) values('acct-opening-review','Opening balance waiting for review','equity') on conflict(id) do nothing;

create table public.uc_money_deduction_sets(
 money_id uuid primary key references uc_money_received(id),
 loan_payment_id text not null references payments(id),
 payload jsonb not null,
 recorded_by text not null references garage_building_staff(id),recorded_at timestamptz not null default now());
create table public.uc_money_deductions(
 id uuid primary key default gen_random_uuid(),
 money_id uuid not null references uc_money_deduction_sets(money_id),
 car_id text not null references cars(id),
 payment_id text not null references payments(id),
 label text not null check(length(label) between 1 and 120),
 grp text not null check(grp in ('panel_fee','bank_fee','insurance','jpj_road_tax','runner','other')),
 amount_cents bigint not null check(amount_cents between 1 and 100000000000),
 new_bill boolean not null,
 position int not null,
 unique(money_id,position));
create index uc_money_deductions_payment on uc_money_deductions(payment_id);
create index uc_money_deductions_car on uc_money_deductions(car_id);
do $$ declare t text;begin
 foreach t in array array['uc_money_deduction_sets','uc_money_deductions'] loop
  execute format('create trigger %I before update or delete on %I for each row execute function uc_investor_immutable()',t||'_fixed',t);
  execute format('create trigger %I before truncate on %I execute function uc_investor_immutable()',t||'_no_truncate',t);
  execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

-- A deduction counts as paid wherever bills are checked.
alter function uc_company_paid_cents(text) rename to uc_company_paid_cents_before_deductions;
create function public.uc_company_paid_cents(p_payment text) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select uc_company_paid_cents_before_deductions(p_payment)+coalesce((select sum(amount_cents) from uc_money_deductions where payment_id=p_payment),0)::bigint $$;
alter function uc_company_has_bank_history(text) rename to uc_company_has_bank_history_before_deductions;
create function public.uc_company_has_bank_history(p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select uc_company_has_bank_history_before_deductions(p_payment) or exists(select 1 from uc_money_deductions where payment_id=p_payment) $$;

-- A bill paid from the loan has its proof on the money record, not on the bill.
do $$ declare src text;patched text;begin
 src:=pg_get_functiondef('public.uc_company_payment_evidence()'::regprocedure);
 patched:=regexp_replace(src,E'\nbegin\r?\n',E'\nbegin\n if current_setting(''autodream.loan_deduction'',true)=txid_current()::text||'':''||new.id then return new;end if;\n');
 if patched=src then raise exception 'PATCH_NOT_APPLIED';end if;
 execute patched;
end $$;

create or replace function public.uc_money_received_view(r uc_money_received) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',r.id,'carId',r.car_id,'amountCents',r.amount_cents,'receivedOn',r.received_on,'bankName',(select name from uc_investor_banks where id=r.bank_id),
  'bankReference',r.bank_reference,'beforeOpening',r.before_opening,'note',r.note,'state',r.state,'hasSlip',r.slip_at is not null,'slipName',r.slip_name,
  'recordedBy',(select name from garage_building_staff where id=r.recorded_by),'recordedAt',r.recorded_at,'matchedAt',r.matched_at,
  'loanPaymentId',(select loan_payment_id from uc_money_deduction_sets where money_id=r.id),
  'deductionsCents',coalesce((select sum(amount_cents) from uc_money_deductions where money_id=r.id),0)::bigint,
  'deductions',coalesce((select jsonb_agg(jsonb_build_object('label',d.label,'group',d.grp,'amountCents',d.amount_cents,'paymentId',d.payment_id,'newBill',d.new_bill) order by d.position) from uc_money_deductions d where d.money_id=r.id),'[]'::jsonb)) $$;

alter function uc_money_received_action(text,text,jsonb) rename to uc_money_received_before_deductions;
create function public.uc_money_received_action(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare res jsonb;m uc_money_received;s uc_money_deduction_sets;c cars;loan payments;bill payments;item jsonb;total bigint:=0;amt bigint;v_label text;v_grp text;loan_left bigint;
 pid text;misc_id text;ded_id uuid;counter text;credit numeric;bill_left bigint;n int:=0;new_bill boolean;bill_type text;
begin
 if p_action<>'record' or not (jsonb_typeof(p_data)='object' and (p_data ? 'deductions' or p_data ? 'loanPaymentId')) then return uc_money_received_before_deductions(p_actor,p_action,p_data);end if;
 if jsonb_typeof(p_data->'deductions') is distinct from 'array' or jsonb_array_length(p_data->'deductions') not between 1 and 30
  or jsonb_typeof(p_data->'loanPaymentId') is distinct from 'string' then raise exception 'INVALID';end if;
 for item in select value from jsonb_array_elements(p_data->'deductions') loop
  if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) x where x not in ('label','group','amountCents','paymentId'))
   or jsonb_typeof(item->'label') is distinct from 'string' or length(trim(item->>'label')) not between 1 and 120
   or coalesce(item->>'group','') not in ('panel_fee','bank_fee','insurance','jpj_road_tax','runner','other')
   or jsonb_typeof(item->'amountCents') is distinct from 'number' or coalesce(item->>'amountCents','')!~'^[1-9][0-9]{0,10}$'
   or item ? 'paymentId' and jsonb_typeof(item->'paymentId') is distinct from 'string' then raise exception 'INVALID';end if;
  total:=total+(item->>'amountCents')::bigint;
 end loop;

 -- The money itself: same checks and history as any money received.
 res:=uc_money_received_before_deductions(p_actor,'record',p_data-'deductions'-'loanPaymentId');
 select * into m from uc_money_received where id=(res->'entry'->>'id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('loan-deduction:'||m.car_id,0));
 select * into s from uc_money_deduction_sets where money_id=m.id;
 if s.money_id is not null then
  if s.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;
  return jsonb_build_object('entry',uc_money_received_view(m));
 end if;
 if m.recorded_at<now()-interval '1 minute' then raise exception 'REQUEST_CHANGED';end if;

 select * into c from cars where id=m.car_id for update;
 if c.investor_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true' or exists(select 1 from uc_investor_cars where car_id=c.id) then raise exception 'USE_INVESTOR_CAR_BILLS';end if;
 if c.outgoing_consignment is not null and c.outgoing_consignment<>'null'::jsonb then raise exception 'COLLECTION_WORKFLOW_REQUIRED';end if;
 if exists(select 1 from uc_consignment_cases k where k.car_id=c.id and k.approved_at is not null) then raise exception 'CONSIGNMENT_COST_CORRECTION_REQUIRED';end if;
 select * into loan from payments where id=p_data->>'loanPaymentId' for update;
 if loan.id is null or loan.car_id is distinct from c.id or loan.type is distinct from 'loan_disbursement' or loan.status is distinct from 'pending' then raise exception 'LOAN_PAYMENT_REQUIRED';end if;
 loan_left:=coalesce(uc_commission_cents(to_jsonb(loan)->'amount'),0)-uc_company_paid_cents(loan.id)
  -coalesce((select sum(x.amount_cents+coalesce((select sum(d.amount_cents) from uc_money_deductions d where d.money_id=x.id),0)) from uc_money_received x join uc_money_deduction_sets ss on ss.money_id=x.id where ss.loan_payment_id=loan.id and x.state='to_match'),0);
 if m.amount_cents+total>loan_left then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;

 insert into uc_money_deduction_sets(money_id,loan_payment_id,payload,recorded_by) values(m.id,loan.id,p_data,p_actor);
 counter:=case when m.before_opening then 'acct-opening-review' else 'acct-money-to-match' end;
 perform set_config('autodream.consignment_write',txid_current()::text||':'||c.id,true);
 for item in select value from jsonb_array_elements(p_data->'deductions') loop
  n:=n+1;amt:=(item->>'amountCents')::bigint;v_label:=trim(item->>'label');v_grp:=item->>'group';
  if item ? 'paymentId' then
   select * into bill from payments where id=item->>'paymentId' for update;
   bill_left:=coalesce(uc_commission_cents(to_jsonb(bill)->'amount'),0)-uc_company_paid_cents(bill.id);
   if bill.id is null or bill.car_id is distinct from c.id or coalesce(bill.type,'') not in ('repair','misc_cost','panel_charge') or bill.status is distinct from 'pending'
    or coalesce((to_jsonb(bill)->>'obligation_replaced')::boolean,false) or amt>bill_left then raise exception 'WITHHELD_BILL_REQUIRED';end if;
   if bill.type='panel_charge' and not uc_consignment_payment_allowed(bill.id) then raise exception 'PAYMENT_WORKFLOW_REQUIRED';end if;
   if uc_consignment_payment_needs_review(bill.id) then raise exception 'CONSIGNMENT_COST_CORRECTION_REQUIRED';end if;
   select coalesce(sum(((l->>'credit')::numeric-(l->>'debit')::numeric)*100),0) into credit from journal_entries j cross join lateral jsonb_array_elements(j.lines) l
    where (j.source_type=bill.type and j.source_id=bill.id or uc_consignment_journal_source(j.id,bill.id)) and not coalesce(j.voided,false) and l->>'accountId'='acct-ap';
   if amt>credit-uc_company_paid_cents(bill.id) then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
   pid:=bill.id;bill_type:=bill.type;new_bill:=false;
  else
   misc_id:='loan-ded-'||replace(gen_random_uuid()::text,'-','');pid:='pay-'||misc_id;bill_type:='misc_cost';new_bill:=true;
   update cars set misc_costs=coalesce(nullif(misc_costs,'null'::jsonb),'[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',misc_id,'description',v_label,'amount',amt::numeric/100,
    'category',case v_grp when 'panel_fee' then 'Panel fee' when 'bank_fee' then 'Bank fee' when 'insurance' then 'Insurance' when 'jpj_road_tax' then 'JPJ & road tax' when 'runner' then 'Runner' else 'Other' end,
    'merchant','Loan deduction','createdAt',now(),'createdBy',p_actor,'loanDeduction',true)) where id=c.id;
   insert into payments(id,type,car_id,misc_cost_id,recipient_type,recipient_id,recipient_name,amount,description,status,created_at)
    values(pid,'misc_cost',c.id,misc_id,'merchant','loan-deduction','Loan deduction',amt::numeric/100,v_label,'pending',now());
   insert into journal_entries(id,date,description,lines,source_type,source_id,car_id,created_by) values('loan-deduction-cost:'||pid,m.received_on,'Loan deduction: '||v_label,
    jsonb_build_array(jsonb_build_object('accountId','acct-inv-own','debit',amt::numeric/100,'credit',0),jsonb_build_object('accountId','acct-ap','debit',0,'credit',amt::numeric/100)),'misc_cost',pid,c.id,p_actor);
  end if;
  insert into uc_money_deductions(money_id,car_id,payment_id,label,grp,amount_cents,new_bill,position) values(m.id,c.id,pid,v_label,v_grp,amt,new_bill,n) returning id into ded_id;
  perform set_config('autodream.company_bank_payment',txid_current()::text||':'||pid,true);
  insert into journal_entries(id,date,description,lines,source_type,source_id,car_id,created_by) values('loan-deduction:'||ded_id::text,m.received_on,'Paid from the loan money: '||v_label,
   jsonb_build_array(jsonb_build_object('accountId','acct-ap','debit',amt::numeric/100,'credit',0),jsonb_build_object('accountId',counter,'debit',0,'credit',amt::numeric/100)),bill_type||'_paid',pid,c.id,p_actor);
  if uc_company_paid_cents(pid)>=coalesce(uc_commission_cents((select to_jsonb(p)->'amount' from payments p where p.id=pid)),0) then
   perform set_config('autodream.loan_deduction',txid_current()::text||':'||pid,true);
   update payments set status='transferred',transferred_at=(m.received_on::text||'T12:00:00+08:00')::timestamptz,transferred_by=p_actor where id=pid;
   perform set_config('autodream.loan_deduction','',true);
  end if;
  perform set_config('autodream.company_bank_payment','',true);
 end loop;
 perform set_config('autodream.consignment_write','',true);
 return jsonb_build_object('entry',uc_money_received_view(m));
end $$;

-- Active / Closed: the money plus its deductions covers the loan; deduction
-- bills carry their proof on the money record.
create or replace function public.uc_car_cases() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with base as (
  select c.id,
   exists(select 1 from uc_investor_cars where car_id=c.id) or c.investor_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true' as investor
  from cars c
  where c.status in ('sold','delivered') or exists(select 1 from uc_money_received m where m.car_id=c.id) or exists(select 1 from uc_investor_deals d where d.car_id=c.id)),
 pay as (
  select p.car_id,p.id,p.type,p.status,coalesce(uc_commission_cents(to_jsonb(p)->'amount'),0)-uc_company_paid_cents(p.id) balance,
   p.type in ('customer_collection','loan_disbursement','consignment_collection','supplier_credit_collection') inbound,
   not exists(select 1 from uc_money_deductions dd where dd.payment_id=p.id) and (
   uc_company_invoice_type(p.type) and not exists(select 1 from uc_company_payment_documents d where d.payment_id=p.id and d.kind='invoice' and d.state='confirmed') and uc_supplier_adjustment_invoice(p.id) is null) need_invoice,
   not exists(select 1 from uc_money_deductions dd where dd.payment_id=p.id) and
   p.status='transferred' and not exists(select 1 from uc_company_payment_documents d where d.payment_id=p.id and d.kind='payment' and d.state='confirmed') need_receipt
  from payments p join base b on b.id=p.car_id and not b.investor
  where p.status in ('pending','transferred') and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false) and p.id not like 'uc_commission_%'),
 per as (
  select b.id,
   (select count(*) from pay where pay.car_id=b.id and (need_invoice or need_receipt))::int missing_docs,
   (select count(*) from pay where pay.car_id=b.id and not inbound and status='pending' and balance>0)::int to_pay,
   (select coalesce(sum(balance),0) from pay where pay.car_id=b.id and not inbound and status='pending' and balance>0)::bigint to_pay_cents,
   greatest(0,(select coalesce(sum(balance),0) from pay where pay.car_id=b.id and inbound and status='pending' and balance>0)
    -(select coalesce(sum(m.amount_cents+coalesce((select sum(d.amount_cents) from uc_money_deductions d where d.money_id=m.id),0)),0) from uc_money_received m where m.car_id=b.id and m.state='to_match'))::bigint to_collect_cents,
   (select count(*) from uc_money_received m where m.car_id=b.id and m.slip_at is null)::int money_no_slip,
   exists(select 1 from uc_consignment_cases k where k.car_id=b.id and not uc_contract_current_before_follow(k.car_id)) agreement_missing,
   exists(select 1 from uc_consignment_cases k where k.car_id=b.id and k.approved_at is null) dealer_not_approved,
   (select count(*) from uc_doc_returns r where r.car_id=b.id and r.state='open')::int sent_back,
   exists(select 1 from uc_investor_deals d where d.car_id=b.id and d.state='draft') investor_open
  from base b)
 select coalesce(jsonb_object_agg(id,jsonb_build_object(
   'state',case when missing_docs+to_pay+money_no_slip+sent_back=0 and to_collect_cents=0 and not agreement_missing and not dealer_not_approved and not investor_open then 'closed' else 'active' end,
   'missingDocs',missing_docs,'toPay',to_pay,'toPayCents',to_pay_cents,'toCollectCents',to_collect_cents,'moneyNoSlip',money_no_slip,
   'agreementMissing',agreement_missing,'dealerNotApproved',dealer_not_approved,'sentBack',sent_back,'investorOpen',investor_open)),'{}'::jsonb)
 from per $$;

-- The to-do list leaves out bills paid from the loan (their proof is the money's slip).
alter function uc_company_evidence(text,text,jsonb) rename to uc_company_evidence_before_deductions;
create function public.uc_company_evidence(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare res jsonb;kept jsonb;before_n int;
begin
 res:=uc_company_evidence_before_deductions(p_actor,p_action,p_data);
 if p_action<>'missing' or jsonb_typeof(res->'items') is distinct from 'array' then return res;end if;
 before_n:=jsonb_array_length(res->'items');
 select coalesce(jsonb_agg(x order by o),'[]'::jsonb) into kept from jsonb_array_elements(res->'items') with ordinality t(x,o)
  where not exists(select 1 from uc_money_deductions d where d.payment_id=x->>'paymentId');
 return res||jsonb_build_object('items',kept,'total',greatest(0,(res->>'total')::int-(before_n-jsonb_array_length(kept))));
end $$;

revoke all on function uc_company_paid_cents_before_deductions(text),uc_company_paid_cents(text),uc_company_has_bank_history_before_deductions(text),uc_company_has_bank_history(text),
 uc_money_received_view(uc_money_received),uc_money_received_before_deductions(text,text,jsonb),uc_money_received_action(text,text,jsonb),uc_car_cases(),
 uc_company_evidence_before_deductions(text,text,jsonb),uc_company_evidence(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_money_received_action(text,text,jsonb),uc_company_evidence(text,text,jsonb) to service_role;
commit;
