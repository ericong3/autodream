-- PREPARED ONLY. Install with the reviewed, guarded bundle, never migrate-all.
alter table public.garage_invoices add column sales_owner_id text references public.garage_building_staff(id);
create index garage_invoices_sales_owner on public.garage_invoices(sales_owner_id);
create table public.garage_sales_assignments (
 invoice_id text primary key references public.garage_invoices(id) on delete restrict,
 actor_id text not null references public.garage_building_staff(id),
 request_id text not null,
 payload jsonb not null,
 owner_id text not null references public.garage_building_staff(id),
 referrer_kind text not null check(referrer_kind in ('none','used_car','external')),
 referrer_staff_id text references public.garage_building_staff(id),
 referrer_profile_id uuid references public.garage_referral_profiles(id),
 used_car_deal jsonb,
 recipient_snapshot jsonb not null default '{}',
 basis numeric(16,2) not null check(basis>=0),
 rate numeric(5,4),
 created_at timestamptz not null default now(),
 unique(actor_id,request_id),
 check((referrer_kind='none' and referrer_staff_id is null and referrer_profile_id is null and rate is null)
  or (referrer_kind='used_car' and referrer_staff_id is not null and referrer_profile_id is null and rate=0.30)
  or (referrer_kind='external' and referrer_staff_id is null and referrer_profile_id is not null and rate=0.30)),
 check(used_car_deal is null or referrer_kind='used_car')
);
alter table public.garage_sales_assignments enable row level security;
revoke all on public.garage_sales_assignments from public,anon,authenticated;

-- Preserve the actual creator. New ownership affects tasks/permissions, not audit.
create function public.garage_effective_sales_owner(p_invoice text,p_creator text) returns text
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select sales_owner_id from garage_invoices where id=p_invoice),p_creator);
$$;
revoke all on function public.garage_effective_sales_owner(text,text) from public,anon,authenticated;

-- Restrict substitutions to the invoice variables in known workshop functions.
-- Never alter created_by in account invitations, insert statements or audit logs.
do $patch$
declare f record;definition text;changed text;patched integer:=0;
begin
 for f in select p.oid,p.proname from pg_proc p where p.pronamespace='public'::regnamespace
 and p.proname in ('garage_installation_workflow','garage_installation_before_usage_ledger','garage_installation_before_damage',
 'garage_tint_money_snapshot','garage_tint_finance','garage_tint_damage','garage_tint_stock','garage_appointment_invoice_action') loop
  definition:=pg_get_functiondef(f.oid);changed:=definition;
  if definition ~* 'inv[[:space:]]+(public\.)?garage_invoices' then
   changed:=replace(changed,'inv.created_by','public.garage_effective_sales_owner(inv.id,inv.created_by)');
  end if;
  if f.proname='garage_appointment_invoice_action' then
   changed:=replace(changed,'invoice.created_by is distinct from p_actor','public.garage_effective_sales_owner(invoice.id,invoice.created_by) is distinct from p_actor');
  end if;
  if f.proname in ('garage_installation_workflow','garage_installation_before_usage_ledger','garage_installation_before_damage') then
   changed:=replace(changed,'i.created_by=p_actor','public.garage_effective_sales_owner(i.id,i.created_by)=p_actor');
  end if;
  if changed<>definition then execute changed;patched:=patched+1;end if;
 end loop;
 if patched<3 then raise exception 'STOP: Ownership function baseline differs. Review live definitions.';end if;
end $patch$;

create function public.garage_sales_referrals(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;inv garage_invoices;assignment garage_sales_assignments;verified numeric;total numeric;items jsonb;
begin
 select * into actor from garage_building_staff where id=p_actor;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('garage','both')
 and actor.role in ('director','shareholder','garage_head','garage_salesman'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_action='options' then
  return jsonb_build_object('enabled',true,
   'owners',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from garage_building_staff where enabled and registration_status='active' and business_access in ('garage','both') and role in ('garage_salesman','director')),'[]'::jsonb),
   'usedCarStaff',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from garage_building_staff where enabled and registration_status='active' and business_access in ('used_car','both') and role='salesperson'),'[]'::jsonb),
   'external',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',profile->>'legalName','brand',profile->>'brand','branch',profile->>'branch') order by profile->>'legalName',id) from garage_referral_profiles where profile_approved_at is not null and external_salesman_id is not null),'[]'::jsonb));
 elsif p_action='orders' then
  return jsonb_build_object('enabled',true,'invoices',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc)
   from garage_invoices i where coalesce(i.sales_owner_id,i.created_by)=p_actor),'[]'::jsonb));
 elsif p_action='deals' then
  if coalesce(p_data->>'month','') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID';end if;
  if not exists(select 1 from garage_building_staff where id=p_data->>'staffId' and enabled and registration_status='active' and role='salesperson' and business_access in ('used_car','both')) then raise exception 'NOT_ALLOWED';end if;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into items from
   (select cu.id "customerId",c.id "carId",c.final_deal->>'submittedAt' "submittedAt",
    concat_ws(' · ',c.car_plate,c.make,c.model) vehicle,cu.name customer
    from customers cu join cars c on c.id=cu.interested_car_id
    where cu.assigned_sales_id=p_data->>'staffId' and c.assigned_salesperson=p_data->>'staffId'
    and c.final_deal->>'approvalStatus'='approved'
    and substring(c.final_deal->>'submittedAt',1,7)=p_data->>'month'
    order by c.final_deal->>'submittedAt' desc,cu.id,c.id limit 101) q;
  return jsonb_build_object('deals',(select coalesce(jsonb_agg(value),'[]'::jsonb) from jsonb_array_elements(items) with ordinality a(value,n) where n<=100),'hasMore',jsonb_array_length(items)>100);
 elsif p_action='snapshot' then
  select * into inv from garage_invoices where id=p_data->>'invoiceId';
  if inv.id is null or (actor.role='garage_salesman' and garage_effective_sales_owner(inv.id,inv.created_by) is distinct from p_actor) then raise exception 'NOT_ALLOWED';end if;
  select * into assignment from garage_sales_assignments where invoice_id=inv.id;
  if not found then return jsonb_build_object('assignment',null);end if;
  select total_amount into total from garage_tint_accounts where invoice_id=inv.id;
  select coalesce(sum(amount),0) into verified from garage_tint_payments where invoice_id=inv.id and state='verified';
  return jsonb_build_object('assignment',jsonb_build_object('ownerId',assignment.owner_id,
   'ownerName',(select name from garage_building_staff where id=assignment.owner_id),
   'referrerKind',assignment.referrer_kind,'recipient',assignment.recipient_snapshot,
   'linkedDeal',assignment.used_car_deal,'basis',assignment.basis,'rate',assignment.rate,
   'commission',case when assignment.rate is not null then round(assignment.basis*assignment.rate,2) else null end,
   'payable',assignment.rate is not null and total is not null and total>0 and verified>=total,
   'createdBy',assignment.actor_id,'createdAt',assignment.created_at));
 end if;
 raise exception 'INVALID';
end $$;

alter function public.garage_sale_confirmation(text,text,text,jsonb) rename to garage_sale_confirmation_before_referrals;
create function public.garage_sale_confirmation(p_actor text,p_action text,p_request text,p_sale jsonb default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;data jsonb;r jsonb;owner garage_building_staff;referrer garage_building_staff;partner garage_referral_profiles;
 prior garage_sales_assignments;iid text;basis numeric;recipient jsonb:='{}';deal jsonb;car cars;customer customers;
begin
 if p_action<>'confirm' or not (p_sale?'salesAssignment') then return garage_sale_confirmation_before_referrals(p_actor,p_action,p_request,p_sale);end if;
 -- Match existing sale lock ordering. All additions are in the same transaction.
 perform pg_advisory_xact_lock(104025,hashtext(p_actor||':'||p_request));
 select * into prior from garage_sales_assignments where actor_id=p_actor and request_id=p_request;
 if found then
  if prior.payload is distinct from p_sale then raise exception 'REQUEST_CHANGED';end if;
  return garage_sale_confirmation_before_referrals(p_actor,p_action,p_request,p_sale);
 end if;
 data:=p_sale->'salesAssignment';r:=data->'referrer';
 if jsonb_typeof(data) is distinct from 'object' or data-array['ownerId','referrer']<>'{}'::jsonb
 or jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'kind','') not in ('none','used_car','external') then raise exception 'INVALID';end if;
 select * into owner from garage_building_staff where id=data->>'ownerId' for share;
 if owner.id is null or not coalesce(owner.enabled and owner.registration_status='active' and owner.role in ('director','garage_salesman') and owner.business_access in ('garage','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if r->>'kind'='none' then
  if r-array['kind']<>'{}'::jsonb then raise exception 'INVALID';end if;
 elsif r->>'kind'='used_car' then
  if r-array['kind','staffId','deal']<>'{}'::jsonb then raise exception 'INVALID';end if;
  select * into referrer from garage_building_staff where id=r->>'staffId' for share;
  if referrer.id is null or not coalesce(referrer.enabled and referrer.registration_status='active' and referrer.role='salesperson' and referrer.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
  recipient:=jsonb_build_object('id',referrer.id,'name',referrer.name);
  deal:=r->'deal';
  if deal is not null then
   if jsonb_typeof(deal) is distinct from 'object' or deal-array['customerId','carId','submittedAt']<>'{}'::jsonb then raise exception 'INVALID';end if;
   select * into customer from customers where id=deal->>'customerId' for share;
   select * into car from cars where id=deal->>'carId' for share;
   if customer.id is null or car.id is null or customer.interested_car_id is distinct from car.id
   or customer.assigned_sales_id is distinct from referrer.id or car.assigned_salesperson is distinct from referrer.id
   or car.final_deal->>'submittedAt' is distinct from deal->>'submittedAt' or car.final_deal->>'approvalStatus' is distinct from 'approved' then raise exception 'DEAL_CHANGED';end if;
  end if;
 else
  if r-array['kind','profileId']<>'{}'::jsonb then raise exception 'INVALID';end if;
  select * into partner from garage_referral_profiles where id=(r->>'profileId')::uuid for share;
  if partner.id is null or partner.profile_approved_at is null or partner.external_salesman_id is null then raise exception 'NOT_ALLOWED';end if;
  recipient:=jsonb_build_object('id',partner.id,'externalSalesmanId',partner.external_salesman_id,'name',partner.profile->>'legalName','brand',partner.profile->>'brand','branch',partner.profile->>'branch');
 end if;
 -- Tint total is after its discount. Only explicitly typed coating add-ons qualify;
 -- names, generic products, PPF and spray do not configure a rate accidentally.
 if exists(select 1 from jsonb_array_elements(p_sale->'addons') a where a?'serviceKey' and coalesce(a->>'serviceKey','') not in ('coating','ppf','spray')) then raise exception 'INVALID';end if;
 result:=garage_sale_confirmation_before_referrals(p_actor,p_action,p_request,p_sale);iid:=result->>'invoiceId';
 if result->>'state'<>'saved' or iid is null then return result;end if;
 -- Never attach new referral details to a replayed old sale.
 if coalesce((result->>'replayed')::boolean,false) then raise exception 'REQUEST_CHANGED';end if;
 select final_total into basis from garage_tint_orders where invoice_id=iid;
 basis:=basis+coalesce((select sum((a->>'price')::numeric*(a->>'qty')::numeric) from jsonb_array_elements(p_sale->'addons') a where a->>'serviceKey'='coating'),0);
 if basis is null or basis<0 or basis<>round(basis,2) then raise exception 'INVALID';end if;
 perform garage_lifecycle_begin();
 update garage_invoices set sales_owner_id=owner.id where id=iid;
 insert into garage_sales_assignments(invoice_id,actor_id,request_id,payload,owner_id,referrer_kind,referrer_staff_id,referrer_profile_id,used_car_deal,recipient_snapshot,basis,rate)
 values(iid,p_actor,p_request,p_sale,owner.id,r->>'kind',referrer.id,partner.id,deal,recipient,basis,case when r->>'kind'<>'none' then 0.30 end);
 return result;
end $$;
revoke all on function public.garage_sales_referrals(text,text,jsonb),public.garage_sale_confirmation(text,text,text,jsonb),public.garage_sale_confirmation_before_referrals(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.garage_sales_referrals(text,text,jsonb),public.garage_sale_confirmation(text,text,text,jsonb) to service_role;
