-- Keep existing appointments; introduce explicit purpose and private server-only access.
alter table public.garage_appointments
 add column appointment_kind text not null default 'visit' check(appointment_kind in ('visit','installation')),
 add column enquiry_id text references public.garage_enquiries(id) on delete set null,
 add column revision integer not null default 1,
 add column cancelled_at timestamptz,
 add column request_id text;
alter table public.garage_appointments drop constraint garage_appointments_service_check;
alter table public.garage_appointments add constraint garage_appointments_service_check check(service in ('tinted','coating','ppf','spray','building_tint'));
create unique index garage_appointment_request on public.garage_appointments(created_by,request_id) where request_id is not null;
-- Browser grants are closed in phase 2, after the API-backed client is live.

create function public.garage_appointment_action(p_actor text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.garage_building_staff; entry public.garage_appointments; enquiry public.garage_enquiries;
 st timestamptz; en timestamptz; page_no integer; result jsonb; cid text; vid text; eid text; service_name text;
begin
 select * into actor from public.garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('garage','both') and actor.role in ('director','shareholder','garage_head','garage_salesman'),false) then raise exception 'NOT_ALLOWED'; end if;
 if p_action='list' then
  st:=(p_data->>'rangeStart')::timestamptz; en:=(p_data->>'rangeEnd')::timestamptz;
  page_no:=coalesce((p_data->>'page')::integer,0);
  if st is null or en is null or not isfinite(st) or not isfinite(en) or en<=st or en-st>interval '62 days' or page_no not between 0 and 100000 then raise exception 'INVALID'; end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.starts_at,a.id),'[]') into result from (
   select * from public.garage_appointments where cancelled_at is null and starts_at<en and ends_at>st
   and (created_by=p_actor or actor.role='director') order by starts_at,id limit 201 offset page_no*200
  ) a;
  return jsonb_build_object('appointments',case when jsonb_array_length(result)>200 then result-200 else result end,'hasMore',jsonb_array_length(result)>200);
 end if;
 if p_action not in ('create','update','cancel') then raise exception 'INVALID'; end if;
 if p_action in ('update','cancel') then
  select * into entry from public.garage_appointments where id=p_data->>'id' for update;
  if entry.id is null or entry.cancelled_at is not null or (entry.created_by is distinct from p_actor and actor.role<>'director') then raise exception 'NOT_ALLOWED'; end if;
  if (p_data->>'revision')::integer is distinct from entry.revision then raise exception 'REVISION_CONFLICT'; end if;
  if p_action='cancel' then
   update public.garage_appointments set cancelled_at=now(),revision=revision+1 where id=entry.id returning * into entry;
   return jsonb_build_object('saved',to_jsonb(entry));
  end if;
 end if;
 cid:=p_data->>'customerId';vid:=nullif(p_data->>'vehicleId','');eid:=nullif(p_data->>'enquiryId','');
 st:=(p_data->>'startsAt')::timestamptz; en:=(p_data->>'endsAt')::timestamptz;
 if cid is null or not exists(select 1 from public.garage_customers where id=cid)
 or st is null or en is null or not isfinite(st) or not isfinite(en) or en<=st or en-st>interval '7 days'
 or coalesce(p_data->>'kind','') not in ('visit','installation') or coalesce(p_data->>'service','') not in ('tinted','coating','ppf','spray','building_tint')
 or length(coalesce(p_data->>'title',''))>200 or length(coalesce(p_data->>'notes',''))>2000 then raise exception 'INVALID'; end if;
 if vid is not null and not exists(select 1 from public.garage_vehicles where id=vid and customer_id=cid) then raise exception 'INVALID'; end if;
 if eid is not null then
  select * into enquiry from public.garage_enquiries where id=eid;
  if enquiry.id is null or (enquiry.owner_id is distinct from p_actor and actor.role<>'director') then raise exception 'NOT_ALLOWED'; end if;
  if enquiry.customer_id is distinct from cid then raise exception 'INVALID'; end if;
  service_name:=case p_data->>'service' when 'tinted' then 'Tint' when 'coating' then 'Coating' when 'ppf' then 'PPF' when 'spray' then 'Spray' else 'Building tint' end;
  if not exists(select 1 from public.garage_enquiry_services where enquiry_id=eid and service=service_name) then raise exception 'INVALID'; end if;
 end if;
 if p_action='create' then
  if coalesce(p_data->>'requestId','') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID'; end if;
  perform pg_advisory_xact_lock(hashtext(p_actor||':'||(p_data->>'requestId')));
  select * into entry from public.garage_appointments where created_by=p_actor and request_id=p_data->>'requestId';
  if entry.id is not null then
   if entry.customer_id<>cid or entry.vehicle_id is distinct from vid or entry.enquiry_id is distinct from eid or entry.appointment_kind<>p_data->>'kind'
    or entry.service<>p_data->>'service' or entry.starts_at<>st or entry.ends_at<>en or coalesce(entry.title,'')<>coalesce(p_data->>'title','') or coalesce(entry.notes,'')<>coalesce(p_data->>'notes','') or entry.cancelled_at is not null then raise exception 'REQUEST_REUSED'; end if;
  else
   insert into public.garage_appointments(id,customer_id,vehicle_id,enquiry_id,appointment_kind,service,title,notes,starts_at,ends_at,created_by,request_id)
   values('ga_'||replace(gen_random_uuid()::text,'-',''),cid,vid,eid,p_data->>'kind',p_data->>'service',p_data->>'title',p_data->>'notes',st,en,p_actor,p_data->>'requestId') returning * into entry;
  end if;
 else
  update public.garage_appointments set customer_id=cid,vehicle_id=vid,enquiry_id=eid,appointment_kind=p_data->>'kind',service=p_data->>'service',title=p_data->>'title',notes=p_data->>'notes',starts_at=st,ends_at=en,revision=revision+1 where id=entry.id returning * into entry;
 end if;
 return jsonb_build_object('saved',to_jsonb(entry));
end $$;
revoke all on function public.garage_appointment_action(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.garage_appointment_action(text,text,jsonb) to service_role;
