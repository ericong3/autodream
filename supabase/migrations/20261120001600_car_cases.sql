-- Active / Closed per sold or delivered car. A car stays Active while
-- anything is open; it becomes Closed by itself once everything is done:
--  missing invoice or slip, bill still to pay, money still to collect (money
--  recorded under "Money received" counts as collected), money received
--  without a slip, dealer agreement missing or dealer amount not approved,
--  an item sent back to the Director, or an investor result not confirmed.
begin;
do $$ begin
 if to_regprocedure('public.uc_doc_todo(text,text,jsonb)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;

create function public.uc_car_cases() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with base as (
  select c.id,
   exists(select 1 from uc_investor_cars where car_id=c.id) or c.investor_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true' as investor
  from cars c
  where c.status in ('sold','delivered') or exists(select 1 from uc_money_received m where m.car_id=c.id) or exists(select 1 from uc_investor_deals d where d.car_id=c.id)),
 pay as (
  select p.car_id,p.id,p.type,p.status,coalesce(uc_commission_cents(to_jsonb(p)->'amount'),0)-uc_company_paid_cents(p.id) balance,
   p.type in ('customer_collection','loan_disbursement','consignment_collection','supplier_credit_collection') inbound,
   uc_company_invoice_type(p.type) and not exists(select 1 from uc_company_payment_documents d where d.payment_id=p.id and d.kind='invoice' and d.state='confirmed') and uc_supplier_adjustment_invoice(p.id) is null need_invoice,
   p.status='transferred' and not exists(select 1 from uc_company_payment_documents d where d.payment_id=p.id and d.kind='payment' and d.state='confirmed') need_receipt
  from payments p join base b on b.id=p.car_id and not b.investor
  where p.status in ('pending','transferred') and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false) and p.id not like 'uc_commission_%'),
 per as (
  select b.id,
   (select count(*) from pay where pay.car_id=b.id and (need_invoice or need_receipt))::int missing_docs,
   (select count(*) from pay where pay.car_id=b.id and not inbound and status='pending' and balance>0)::int to_pay,
   (select coalesce(sum(balance),0) from pay where pay.car_id=b.id and not inbound and status='pending' and balance>0)::bigint to_pay_cents,
   greatest(0,(select coalesce(sum(balance),0) from pay where pay.car_id=b.id and inbound and status='pending' and balance>0)
    -(select coalesce(sum(amount_cents),0) from uc_money_received m where m.car_id=b.id and m.state='to_match'))::bigint to_collect_cents,
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

alter function uc_doc_todo(text,text,jsonb) rename to uc_doc_todo_before_cases;
create function public.uc_doc_todo(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_action<>'cases' then return uc_doc_todo_before_cases(p_actor,p_action,p_data);end if;
 if not exists(select 1 from garage_building_staff s where s.id=p_actor and s.enabled and s.registration_status='active' and s.business_access in ('used_car','both') and s.role in ('director','admin','shareholder')) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or p_data<>'{}'::jsonb then raise exception 'INVALID';end if;
 return jsonb_build_object('cars',uc_car_cases());
end $$;
revoke all on function uc_car_cases(),uc_doc_todo_before_cases(text,text,jsonb),uc_doc_todo(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_doc_todo(text,text,jsonb) to service_role;
commit;
