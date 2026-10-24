-- Existing staff join the private setup directory without copying old passwords.
begin;
create or replace function public.autodream_existing_staff_action(p_action text,p_actor text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare actor garage_building_staff; legacy users; r text; access text;
begin
 perform pg_advisory_xact_lock(hashtextextended('autodream-account-lifecycle',0));
 select * into actor from garage_building_staff where id=p_actor for share;
 if not found or not actor.enabled or actor.role<>'director' or actor.registration_status<>'active' then raise exception 'NOT_DIRECTOR'; end if;
 if p_action='list' then
  return jsonb_build_object('accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'username',u.username,'email',null,'verified',false,'role',u.role,'businessAccess',coalesce(u.business_access,case when u.role in ('director','shareholder') then 'both' when u.role like 'garage_%' then 'garage' else 'used_car' end),'enabled',true,'status','not_registered','existingOnly',true) order by u.name),'[]') from users u where not exists(select 1 from garage_building_staff s where s.id=u.id or lower(s.username)=lower(u.username))));
 elsif p_action='connect' then
  r:=p_data->>'role';access:=p_data->>'businessAccess';
  if r is null or r not in ('director','shareholder','salesperson','mechanic','admin','investor','banker','garage_head','garage_salesman','garage_installer','garage_detailer','garage_spray') or access is null or access not in ('used_car','garage','both') or (r in ('director','shareholder') and access<>'both') or (r like 'garage_%' and access<>'garage') then raise exception 'INVALID_ACCESS'; end if;
  select * into legacy from users where id=p_data->>'targetId' for share;
  if not found or exists(select 1 from garage_building_staff where id=legacy.id or lower(username)=lower(legacy.username)) then raise exception 'INVALID_ACCOUNT'; end if;
  insert into garage_building_staff(id,name,username,password,role,business_access,registration_status,enabled)
  values(legacy.id,legacy.name,legacy.username,extensions.crypt(encode(extensions.gen_random_bytes(32),'hex'),extensions.gen_salt('bf')),r,access,'pending',true);
  return public.autodream_account_action('invite',p_actor,jsonb_build_object('id',p_data->>'id','tokenHash',p_data->>'tokenHash','targetId',legacy.id));
 end if;
 raise exception 'INVALID_ACTION';
end $$;
revoke all on function public.autodream_existing_staff_action(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.autodream_existing_staff_action(text,text,jsonb) to service_role;
-- Private verified identity is authoritative for compatibility display/access.
create or replace function public.autodream_sync_verified_staff_access()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.users set role=new.role,business_access=new.business_access where id=new.id;
 return new;
end $$;
revoke all on function public.autodream_sync_verified_staff_access() from public,anon,authenticated,service_role;
drop trigger if exists autodream_verified_staff_access on public.garage_building_staff;
create trigger autodream_verified_staff_access after update of email_verified_at on public.garage_building_staff
for each row when (old.email_verified_at is null and new.email_verified_at is not null and new.registration_status='active') execute function public.autodream_sync_verified_staff_access();
commit;
