-- Paperwork can follow the money. Supplier invoices and the dealer agreement
-- are admin work that can be uploaded later:
--  * A bill can be approved, checked and paid before its supplier invoice is
--    uploaded (every "invoice before payment" gate is lifted). The amounts
--    and bills themselves are still checked exactly as before, and the
--    transfer slip is still needed when a bank payment is recorded, because
--    it is how bank payments are matched.
--  * The Director can approve a consignment dealer amount with the dealer
--    agreement marked "to follow".
--  * Director and admin get one list of everything still missing: supplier
--    invoices, payment slips for money already marked paid or received, and
--    consignment agreements. Uploading works as before (invoices & receipts).
begin;
do $$ begin
 if to_regprocedure('public.uc_company_evidence(text,text,jsonb)') is null or to_regprocedure('public.uc_consignment_finance(text,text,jsonb)') is null
  or to_regprocedure('public.uc_consignment_contract_current(text)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;

-- 1. Invoice gates: "no confirmed invoice -> stop" becomes "no invoice -> carry on".
do $$
declare f record;src text;patched text;n int:=0;
begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace s on s.oid=p.pronamespace
  where s.nspname='public' and p.prosrc like '%SUPPLIER_INVOICE_REQUIRED%' loop
  src:=pg_get_functiondef(f.oid);
  patched:=regexp_replace(src,$r$(kind='invoice' and (d\.)?state='confirmed'\)( and uc_supplier_adjustment_invoice\([a-z_.]+\) is null)?) then raise exception 'SUPPLIER_INVOICE_REQUIRED'$r$,'\1 then null','g');
  if patched<>src then execute patched;n:=n+1;end if;
 end loop;
 -- n can be 0: databases installed without the company invoice gates have nothing to lift.
 raise notice 'invoice gates lifted in % functions',n;
 if exists(select 1 from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public'
  and p.prosrc ~ $r$kind='invoice' and (d\.)?state='confirmed'\)( and uc_supplier_adjustment_invoice\([a-z_.]+\) is null)? then raise exception 'SUPPLIER_INVOICE_REQUIRED'$r$) then raise exception 'PATCH_NOT_APPLIED';end if;
end $$;

-- 2. Dealer agreement to follow (Director only, recorded).
create table public.uc_consignment_documents_to_follow(
 car_id text primary key references uc_consignment_cases(car_id),
 approved_by text not null references garage_building_staff(id),
 approved_at timestamptz not null default now());
alter table public.uc_consignment_documents_to_follow enable row level security;
revoke all on public.uc_consignment_documents_to_follow from public,anon,authenticated;
create trigger uc_consignment_to_follow_fixed before update or delete on public.uc_consignment_documents_to_follow for each row execute function uc_company_evidence_immutable();

alter function uc_consignment_contract_current(text) rename to uc_contract_current_before_follow;
create function public.uc_consignment_contract_current(p_car text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select uc_contract_current_before_follow(p_car) or coalesce(current_setting('autodream.agreement_to_follow',true),'')=p_car $$;

alter function uc_consignment_finance(text,text,jsonb) rename to uc_consignment_finance_before_follow;
create function public.uc_consignment_finance(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;cid text;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action='approve' and p_data ? 'documentsToFollow' then
  if p_data->'documentsToFollow' is distinct from 'true'::jsonb then raise exception 'INVALID';end if;
  if not exists(select 1 from garage_building_staff s where s.id=p_actor and s.role='director' and s.enabled and s.registration_status='active' and s.business_access in ('used_car','both')) then raise exception 'NOT_ALLOWED';end if;
  cid:=p_data->>'carId';
  perform set_config('autodream.agreement_to_follow',coalesce(cid,''),true);
  r:=uc_consignment_finance_before_follow(p_actor,p_action,p_data-'documentsToFollow');
  perform set_config('autodream.agreement_to_follow','',true);
  if not uc_contract_current_before_follow(cid) then insert into uc_consignment_documents_to_follow(car_id,approved_by) values(cid,p_actor) on conflict(car_id) do nothing;end if;
  return r;
 end if;
 r:=uc_consignment_finance_before_follow(p_actor,p_action,p_data);
 if p_action='snapshot' and jsonb_typeof(r)='object' and r ? 'carId' then
  r:=r||jsonb_build_object('agreementToFollow',(select jsonb_build_object('approvedAt',t.approved_at,'approvedByName',(select name from garage_building_staff where id=t.approved_by)) from uc_consignment_documents_to_follow t where t.car_id=r->>'carId' and not uc_contract_current_before_follow(t.car_id)));
 end if;
 return r;
end $$;

-- 3. Everything still missing, for Director and admin.
alter function uc_company_evidence(text,text,jsonb) rename to uc_company_evidence_before_missing;
create function public.uc_company_evidence(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;tier text;items jsonb;agreements jsonb;total int;
begin
 if p_action<>'missing' then return uc_company_evidence_before_missing(p_actor,p_action,p_data);end if;
 if jsonb_typeof(p_data) is distinct from 'object' or p_data<>'{}'::jsonb then raise exception 'INVALID';end if;
 select * into actor from garage_building_staff where id=p_actor;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and actor.role in ('director','admin'),false) then raise exception 'NOT_ALLOWED';end if;
 tier:=actor.role;
 with m as (
  select p.id,p.type,p.status,p.car_id,p.recipient_name,uc_commission_cents(to_jsonb(p)->'amount') amount_cents,coalesce(to_jsonb(p)->>'transferred_at',to_jsonb(p)->>'created_at') at,
   uc_company_invoice_type(p.type) and not exists(select 1 from uc_company_payment_documents d where d.payment_id=p.id and d.kind='invoice' and d.state='confirmed') and uc_supplier_adjustment_invoice(p.id) is null need_invoice,
   p.status='transferred' and not exists(select 1 from uc_company_payment_documents d where d.payment_id=p.id and d.kind='payment' and d.state='confirmed') need_receipt
  from payments p
  where p.status in ('pending','transferred') and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false)
   and uc_company_evidence_allows(tier,actor.id,p.type,p.recipient_id,null)
   and not (p.car_id is not null and (exists(select 1 from uc_investor_cars where car_id=p.car_id) or exists(select 1 from cars c where c.id=p.car_id and (c.investor_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true'))))
   and p.id not like 'uc_commission_%')
 select count(*)::int,coalesce(jsonb_agg(x.j order by x.at desc nulls last,x.id) filter (where x.rn<=500),'[]'::jsonb) into total,items from (
  select m.id,m.at,row_number() over(order by m.at desc nulls last,m.id) rn,jsonb_build_object('paymentId',m.id,'type',m.type,'status',m.status,'carId',m.car_id,'recipientName',m.recipient_name,'amountCents',m.amount_cents,'date',m.at,
   'car',(select concat_ws(' ',c.make,c.model,c.car_plate) from cars c where c.id=m.car_id),'needInvoice',m.need_invoice,'needReceipt',m.need_receipt) j
  from m where m.need_invoice or m.need_receipt) x;
 select coalesce(jsonb_agg(jsonb_build_object('carId',k.car_id,'car',(select concat_ws(' ',c.make,c.model,c.car_plate) from cars c where c.id=k.car_id),'dealer',k.dealer->>'name','approved',k.approved_at is not null) order by k.opened_at desc),'[]'::jsonb) into agreements
  from uc_consignment_cases k where not uc_contract_current_before_follow(k.car_id);
 return jsonb_build_object('items',items,'total',total,'agreements',agreements);
end $$;

revoke all on function uc_contract_current_before_follow(text),uc_consignment_contract_current(text),uc_consignment_finance_before_follow(text,text,jsonb),uc_consignment_finance(text,text,jsonb),
 uc_company_evidence_before_missing(text,text,jsonb),uc_company_evidence(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_consignment_finance(text,text,jsonb),uc_company_evidence(text,text,jsonb) to service_role;
commit;
