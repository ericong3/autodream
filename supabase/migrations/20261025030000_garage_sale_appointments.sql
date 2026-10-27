-- Compatible addition: existing calendar clients and sales keep working.
alter table public.garage_appointments add column invoice_id text references public.garage_invoices(id) on delete set null;
create unique index garage_appointment_invoice on public.garage_appointments(invoice_id) where invoice_id is not null;
create index garage_appointment_customer on public.garage_appointments(customer_id,starts_at);

create function public.garage_appointment_invoice_sync() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare invoice public.garage_invoices; validate_link boolean; sync_time boolean;
begin
 if tg_op='UPDATE' and old.invoice_id is not null and new.invoice_id is distinct from old.invoice_id then
  if exists(select 1 from public.garage_invoices where id=old.invoice_id) then raise exception 'INVALID'; end if;
  -- Failed sale rollback cancels only appointments created by that sale. A
  -- pre-existing booking stays available for another confirmation attempt.
  if old.request_id='sale_'||old.invoice_id then new.cancelled_at:=now();new.revision:=old.revision+1; end if;
 end if;
 if tg_op='INSERT' then validate_link:=true;sync_time:=true;
 else
  validate_link:=old.invoice_id is distinct from new.invoice_id or old.customer_id is distinct from new.customer_id or old.vehicle_id is distinct from new.vehicle_id or old.service is distinct from new.service or old.appointment_kind is distinct from new.appointment_kind;
  sync_time:=old.invoice_id is distinct from new.invoice_id or old.starts_at is distinct from new.starts_at or old.cancelled_at is distinct from new.cancelled_at;
 end if;
 if new.invoice_id is not null and (validate_link or sync_time) then
  select * into invoice from public.garage_invoices where id=new.invoice_id for update;
  if invoice.id is null then raise exception 'INVALID'; end if;
  if validate_link and (new.customer_id is distinct from invoice.customer_id or new.vehicle_id is distinct from invoice.vehicle_id
   or new.service is distinct from invoice.service or new.appointment_kind<>'installation') then raise exception 'INVALID'; end if;
  if sync_time then update public.garage_invoices set appointment_at=case when new.cancelled_at is null then new.starts_at else null end where id=invoice.id;end if;
 end if;
 return new;
end $$;
revoke all on function public.garage_appointment_invoice_sync() from public,anon,authenticated;
create trigger garage_appointment_invoice_sync before insert or update on public.garage_appointments
 for each row execute function public.garage_appointment_invoice_sync();

create function public.garage_appointment_invoice_action(p_actor text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.garage_building_staff; invoice public.garage_invoices; booking public.garage_appointments;
 result jsonb; cid text; vid text; svc text; st timestamptz; en timestamptz;
begin
 select * into actor from public.garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('garage','both')
 and actor.role in ('director','shareholder','garage_head','garage_salesman'),false) then raise exception 'NOT_ALLOWED'; end if;
 if p_action='sale_options' then
  cid:=p_data->>'customerId';vid:=p_data->>'vehicleId';svc:=p_data->>'service';
  if not exists(select 1 from public.garage_vehicles where id=vid and customer_id=cid) or coalesce(svc,'') not in ('tinted','coating','ppf','spray') then raise exception 'INVALID'; end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by abs(extract(epoch from (a.starts_at-now()))),a.id),'[]') into result from (
   select * from public.garage_appointments where customer_id=cid and (vehicle_id is null or vehicle_id=vid) and service=svc
   and appointment_kind='installation' and cancelled_at is null and invoice_id is null and (created_by=p_actor or actor.role='director')
   order by abs(extract(epoch from (starts_at-now()))),id limit 201
  ) a;
  return jsonb_build_object('appointments',case when jsonb_array_length(result)>200 then result-200 else result end,'hasMore',jsonb_array_length(result)>200);
 end if;
 if p_action<>'confirm_sale' or coalesce(p_data->>'invoiceId','')='' then raise exception 'INVALID'; end if;
 -- Existing-booking locks precede invoice locks, matching calendar update/cancel.
 if nullif(p_data->>'appointmentId','') is not null then
  select * into booking from public.garage_appointments where id=p_data->>'appointmentId' for update;
  if booking.id is null or (booking.created_by is distinct from p_actor and actor.role<>'director') then raise exception 'NOT_ALLOWED'; end if;
 else
  select * into booking from public.garage_appointments where invoice_id=p_data->>'invoiceId' for update;
 end if;
 if booking.id is not null and booking.created_by is distinct from p_actor and actor.role<>'director' then raise exception 'NOT_ALLOWED'; end if;
 select * into invoice from public.garage_invoices where id=p_data->>'invoiceId' for update;
 if invoice.id is null or (invoice.created_by is distinct from p_actor and actor.role<>'director') then raise exception 'NOT_ALLOWED'; end if;
 if booking.id is not null then
  if booking.cancelled_at is not null or booking.appointment_kind<>'installation' or booking.customer_id is distinct from invoice.customer_id
   or booking.service is distinct from invoice.service or (booking.vehicle_id is not null and booking.vehicle_id<>invoice.vehicle_id) then raise exception 'INVALID'; end if;
  if booking.invoice_id=invoice.id then return jsonb_build_object('saved',to_jsonb(booking)); end if;
  if booking.invoice_id is not null or exists(select 1 from public.garage_appointments where invoice_id=invoice.id) then raise exception 'ALREADY_LINKED'; end if;
  if (p_data->>'revision')::integer is distinct from booking.revision then raise exception 'REVISION_CONFLICT'; end if;
  update public.garage_appointments set invoice_id=invoice.id,vehicle_id=invoice.vehicle_id,revision=revision+1 where id=booking.id returning * into booking;
 else
  -- Another identical confirmation may have completed while this request waited.
  select * into booking from public.garage_appointments where invoice_id=invoice.id;
  if booking.id is not null then
   if booking.cancelled_at is not null or (booking.created_by is distinct from p_actor and actor.role<>'director') then raise exception 'NOT_ALLOWED'; end if;
   return jsonb_build_object('saved',to_jsonb(booking));
  end if;
  st:=(p_data->>'startsAt')::timestamptz;en:=(p_data->>'endsAt')::timestamptz;
  if st is null or en is null or not isfinite(st) or not isfinite(en) or en<=st or en-st>interval '7 days' then raise exception 'INVALID'; end if;
  insert into public.garage_appointments(id,customer_id,vehicle_id,invoice_id,appointment_kind,service,title,starts_at,ends_at,created_by,request_id)
  values('ga_'||replace(gen_random_uuid()::text,'-',''),invoice.customer_id,invoice.vehicle_id,invoice.id,'installation',invoice.service,invoice.invoice_number,st,en,coalesce(invoice.created_by,p_actor),'sale_'||invoice.id) returning * into booking;
 end if;
 return jsonb_build_object('saved',to_jsonb(booking));
end $$;
revoke all on function public.garage_appointment_invoice_action(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.garage_appointment_invoice_action(text,text,jsonb) to service_role;
