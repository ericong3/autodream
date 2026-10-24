-- PREVIEW ONLY: not applied to production. Payroll/claims bank readers and legacy public data/login must be migrated before activation.
-- Private employment and payment details. Existing work records retain staff IDs.
begin;
create table public.autodream_staff_profiles (
 staff_id text primary key references public.users(id) on delete restrict, data jsonb not null default '{}', revision integer not null default 1,
 employment_status text not null default 'current' check(employment_status in ('current','former')),
 last_working_date date, updated_at timestamptz not null default now(), updated_by text not null
);
create table public.autodream_staff_profile_history (
 id bigint generated always as identity primary key, staff_id text not null references public.users(id) on delete restrict, actor_id text not null,
 action text not null, recorded_at timestamptz not null default now(), snapshot jsonb not null
);
alter table public.autodream_staff_profiles enable row level security;
alter table public.autodream_staff_profile_history enable row level security;
revoke all on public.autodream_staff_profiles,public.autodream_staff_profile_history from public,anon,authenticated;
alter table public.users add column if not exists staff_employment_status text not null default 'current';
alter table public.users add column if not exists staff_last_working_date date;
create or replace function public.autodream_staff_profile_action(p_action text,p_actor text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare actor garage_building_staff; target garage_building_staff; profile autodream_staff_profiles;
 legacy jsonb; identity jsonb; result jsonb; details jsonb; k text; v text; join_date date; end_date date; target_id text; old_details jsonb; audit jsonb; old_end_date date;
begin
 perform pg_advisory_xact_lock(hashtextextended('autodream-account-lifecycle',0));
 select * into actor from garage_building_staff where id=p_actor for share;
 if not found or not actor.enabled or actor.registration_status<>'active' or (actor.email_verified_at is null and p_action<>'directory') or actor.role not in ('director','admin') then raise exception 'PROFILE_FORBIDDEN'; end if;
 if p_action='directory' then
  return jsonb_build_object('accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(s.name,u.name),'username',coalesce(s.username,u.username),'role',coalesce(s.role,u.role),'businessAccess',coalesce(s.business_access,u.business_access,'used_car'),'enabled',coalesce(s.enabled,true),'verified',s.email_verified_at is not null,'existingOnly',s.id is null,'status',coalesce(s.registration_status,'not_registered'),'employmentStatus',coalesce(p.employment_status,'current'),'lastWorkingDate',p.last_working_date) order by u.name),'[]') from users u left join garage_building_staff s on s.id=u.id left join autodream_staff_profiles p on p.staff_id=u.id));
 end if;
 target_id:=p_data->>'id';
 select to_jsonb(u) into legacy from users u where id=target_id;
 select * into target from garage_building_staff where id=target_id;
 if legacy is null then raise exception 'PROFILE_NOT_FOUND'; end if;
 identity:=jsonb_build_object('id',target_id,'name',coalesce(target.name,legacy->>'name'),'username',coalesce(target.username,legacy->>'username'),'role',coalesce(target.role,legacy->>'role'),'businessAccess',coalesce(target.business_access,legacy->>'business_access','used_car'));
 select * into profile from autodream_staff_profiles where staff_id=target_id for update;
 old_end_date:=profile.last_working_date;
 details:=jsonb_build_object('phone',coalesce(target.phone,legacy->>'phone',''),'joiningDate',coalesce(legacy->>'joining_date',''),'bankName',coalesce(legacy->>'bank_name',''),'bankAccountNumber',coalesce(legacy->>'bank_account_number',''),'bankAccountHolder',coalesce(legacy->>'bank_account_holder',''),'employeeId',coalesce(legacy->>'employee_id',''),'position',coalesce(legacy->>'position',''),'emergencyName','','emergencyPhone','','skills','','notes','')||coalesce(profile.data,'{}');
 old_details:=details;
 -- Old free-text dates/account formatting must not block unrelated profile edits.
 if coalesce(details->>'joiningDate','')<>'' then
  begin
   if (details->>'joiningDate')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then details:=jsonb_set(details,'{joiningDate}','""');else join_date:=(details->>'joiningDate')::date;end if;
  exception when invalid_datetime_format or datetime_field_overflow then details:=jsonb_set(details,'{joiningDate}','""');end;
 end if;
 if coalesce(details->>'bankAccountNumber','')<>'' and (details->>'bankAccountNumber')!~'^[0-9 -]{6,30}$' then details:=jsonb_set(details,'{bankAccountNumber}','""');end if;
 if p_action='save' then
  if coalesce((p_data->>'revision')::integer,-1)<>coalesce(profile.revision,0) then raise exception 'PROFILE_CONFLICT'; end if;
  if jsonb_typeof(p_data->'data') is distinct from 'object' then raise exception 'PROFILE_INVALID'; end if;
  for k,v in select key,value from jsonb_each_text(p_data->'data') loop
   if k not in ('phone','joiningDate','bankName','bankAccountNumber','bankAccountHolder','employeeId','position','emergencyName','emergencyPhone','skills','notes') or v is null or length(v)>(case when k in ('notes','skills') then 2000 else 200 end) then raise exception 'PROFILE_INVALID'; end if;
  end loop;
  if exists(select 1 from jsonb_each(p_data->'data') e where jsonb_typeof(e.value)<>'string') then raise exception 'PROFILE_INVALID'; end if;
  details:=details||(p_data->'data');
  if coalesce(details->>'joiningDate','')<>'' then
   if (details->>'joiningDate')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'PROFILE_INVALID';end if;
   join_date:=(details->>'joiningDate')::date;if join_date>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'PROFILE_INVALID';end if;
  end if;
  if coalesce(details->>'bankAccountNumber','')<>'' and (details->>'bankAccountNumber')!~'^[0-9 -]{6,30}$' then raise exception 'PROFILE_INVALID';end if;
  if profile.last_working_date is not null and join_date>profile.last_working_date then raise exception 'PROFILE_INVALID';end if;
  insert into autodream_staff_profiles(staff_id,data,updated_by) values(target_id,details,p_actor)
  on conflict(staff_id) do update set data=excluded.data,revision=autodream_staff_profiles.revision+1,updated_at=now(),updated_by=p_actor returning * into profile;
  audit:=jsonb_build_object('revision',profile.revision,'changedFields',(select coalesce(jsonb_agg(e.key),'[]') from jsonb_each(details) e where old_details->e.key is distinct from e.value));
  if old_details->>'joiningDate' is distinct from details->>'joiningDate' then audit:=audit||jsonb_build_object('joiningDateBefore',old_details->>'joiningDate','joiningDateAfter',details->>'joiningDate');end if;
  if old_details->>'bankAccountNumber' is distinct from details->>'bankAccountNumber' then audit:=audit||jsonb_build_object('bankBefore',right(coalesce(old_details->>'bankAccountNumber',''),4),'bankAfter',right(coalesce(details->>'bankAccountNumber',''),4));end if;
  insert into autodream_staff_profile_history(staff_id,actor_id,action,snapshot)values(target_id,p_actor,'details_updated',audit);
 elsif p_action in ('leave','restore') then
  if actor.role<>'director' then raise exception 'PROFILE_FORBIDDEN'; end if;
  if coalesce((p_data->>'revision')::integer,-1)<>coalesce(profile.revision,0) then raise exception 'PROFILE_CONFLICT'; end if;
  if p_action='leave' then
   end_date:=(p_data->>'lastWorkingDate')::date;
   if end_date is null or end_date>(now() at time zone 'Asia/Kuala_Lumpur')::date or (nullif(details->>'joiningDate','')::date)>end_date then raise exception 'PROFILE_INVALID'; end if;
   if target.id is not null then perform public.autodream_account_action('update',p_actor,jsonb_build_object('id',target_id,'role',target.role,'businessAccess',target.business_access,'enabled',false));end if;
   update autodream_staff_invitations set revoked_at=now() where autodream_staff_invitations.target_id=p_data->>'id' and revoked_at is null;
   update autodream_email_tokens set used_at=now() where staff_id=target_id and used_at is null;
   delete from garage_building_sessions where user_id=target_id;
  end if;
  insert into autodream_staff_profiles(staff_id,data,employment_status,last_working_date,updated_by)values(target_id,details,case when p_action='leave' then 'former' else 'current' end,end_date,p_actor)
  on conflict(staff_id) do update set employment_status=excluded.employment_status,last_working_date=excluded.last_working_date,revision=autodream_staff_profiles.revision+1,updated_by=p_actor,updated_at=now() returning * into profile;
  update users set staff_employment_status=profile.employment_status,staff_last_working_date=profile.last_working_date where id=target_id;
  insert into autodream_staff_profile_history(staff_id,actor_id,action,snapshot)values(target_id,p_actor,p_action,jsonb_build_object('lastWorkingDate',coalesce(end_date,old_end_date),'joiningDate',details->>'joiningDate','revision',profile.revision));
 elsif p_action<>'get' then raise exception 'PROFILE_INVALID';
 end if;
 return jsonb_build_object('identity',identity,'data',details,'revision',coalesce(profile.revision,0),'employmentStatus',coalesce(profile.employment_status,'current'),'lastWorkingDate',profile.last_working_date,'email',target.email,'verified',target.email_verified_at is not null,'history',(select coalesce(jsonb_agg(x),'[]') from(select h.action,h.recorded_at,h.snapshot,coalesce(s.name,h.actor_id) actor_name from autodream_staff_profile_history h left join garage_building_staff s on s.id=h.actor_id where h.staff_id=target_id order by h.id desc limit 30)x));
end $$;
revoke all on function public.autodream_staff_profile_action(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.autodream_staff_profile_action(text,text,jsonb) to service_role;
-- Former staff cannot be activated again through invitations or account controls.
create or replace function public.autodream_block_former_staff_login()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.enabled and exists(select 1 from autodream_staff_profiles where staff_id=new.id and employment_status='former') then raise exception 'INVALID_FORMER_STAFF';end if;
 return new;
end $$;
revoke all on function public.autodream_block_former_staff_login() from public,anon,authenticated,service_role;
create trigger autodream_former_staff_guard before insert or update of enabled on garage_building_staff for each row execute function autodream_block_former_staff_login();
commit;
