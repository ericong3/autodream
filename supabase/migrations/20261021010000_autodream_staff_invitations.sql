-- PREPARED ONLY. Apply after 20261021000000; no public signup or browser grants.
begin;
alter table public.garage_building_staff add column if not exists email text;
alter table public.garage_building_staff add column if not exists phone text;
alter table public.garage_building_staff add column if not exists email_verified_at timestamptz;
alter table public.garage_building_staff add column if not exists registration_status text not null default 'active' check (registration_status in ('active','pending'));
alter table public.garage_building_staff add column if not exists session_version integer not null default 0;
create unique index if not exists private_staff_email_unique on public.garage_building_staff(lower(email)) where email is not null;
create table public.autodream_staff_invitations (
 id text primary key, token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
 created_by text not null references public.garage_building_staff(id),
 target_id text references public.garage_building_staff(id),
 role text not null, business_access text not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '48 hours',
 consumed_at timestamptz, revoked_at timestamptz,
 check (expires_at>created_at and expires_at<=created_at+interval '48 hours')
);
create table public.autodream_email_tokens (
 token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'), staff_id text not null references public.garage_building_staff(id),
 pending_password_hash text, pending_name text, pending_phone text,
 purpose text not null check (purpose in ('verify','reset')), email text not null,
 invitation_id text references public.autodream_staff_invitations(id),
 session_version integer not null, created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 minutes', used_at timestamptz,
 check (expires_at>created_at and expires_at<=created_at+interval '30 minutes')
);
alter table public.autodream_staff_invitations enable row level security;
alter table public.autodream_email_tokens enable row level security;
revoke all on public.autodream_staff_invitations, public.autodream_email_tokens from public, anon, authenticated;

-- All account mutations are atomic and independently enforce director authority.
create function public.autodream_account_action(p_action text,p_actor text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare actor garage_building_staff; staff garage_building_staff; inv autodream_staff_invitations; tok autodream_email_tokens;
 r text; access text; new_staff_id text; result jsonb; email_value text;
begin
 perform pg_advisory_xact_lock(hashtextextended('autodream-account-lifecycle',0));
 if p_action in ('invite','list','revoke','update') then
   perform pg_advisory_xact_lock(hashtextextended('autodream-director-account-controls',0));
   select * into actor from garage_building_staff where id=p_actor for share;
   if not found or not actor.enabled or actor.role<>'director' or actor.registration_status<>'active' then raise exception 'NOT_DIRECTOR'; end if;
 end if;
 if p_action='invite' then
   r:=p_data->>'role';access:=p_data->>'businessAccess';
   if p_data->>'targetId' is not null then
     select * into staff from garage_building_staff where id=p_data->>'targetId' for update;
     if not found or not staff.enabled or staff.email_verified_at is not null then raise exception 'INVALID_ENROLLMENT'; end if;
     r:=staff.role;access:=staff.business_access;
   end if;
   if r not in ('director','shareholder','salesperson','mechanic','admin','investor','banker','garage_head','garage_salesman','garage_installer','garage_detailer','garage_spray')
      or access not in ('used_car','garage','both') or r is null or access is null
      or (r in ('director','shareholder') and access<>'both')
      or (r like 'garage_%' and access<>'garage') then raise exception 'INVALID_ACCESS'; end if;
   if p_data->>'targetId' is not null then
     update autodream_staff_invitations set revoked_at=now() where target_id=p_data->>'targetId' and revoked_at is null;
   end if;
   insert into autodream_staff_invitations(id,token_hash,created_by,target_id,role,business_access)
   values(p_data->>'id',p_data->>'tokenHash',p_actor,p_data->>'targetId',r,access) returning * into inv;
   return jsonb_build_object('id',inv.id,'role',r,'businessAccess',access,'expiresAt',inv.expires_at);
 elsif p_action='list' then
   return jsonb_build_object('accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'username',s.username,'email',s.email,'verified',s.email_verified_at is not null,'role',s.role,'businessAccess',s.business_access,'enabled',s.enabled,'status',s.registration_status) order by s.name),'[]') from garage_building_staff s),
    'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'role',i.role,'businessAccess',i.business_access,'expiresAt',i.expires_at,'used',i.consumed_at is not null,'revoked',i.revoked_at is not null) order by i.created_at desc),'[]') from (select * from autodream_staff_invitations order by created_at desc limit 100)i));
 elsif p_action='revoke' then
   update autodream_staff_invitations set revoked_at=now() where id=p_data->>'id';return '{}'::jsonb;
 elsif p_action='update' then
   select * into staff from garage_building_staff where id=p_data->>'id' for update;
   if not found then raise exception 'INVALID_ACCOUNT'; end if;
   r:=p_data->>'role';access:=p_data->>'businessAccess';
   if r not in ('director','shareholder','salesperson','mechanic','admin','investor','banker','garage_head','garage_salesman','garage_installer','garage_detailer','garage_spray')
      or access not in ('used_car','garage','both') or r is null or access is null
      or (r in ('director','shareholder') and access<>'both') or (r like 'garage_%' and access<>'garage') then raise exception 'INVALID_ACCESS'; end if;
   if staff.enabled and staff.registration_status='active' and staff.role='director' and (r<>'director' or not (p_data->>'enabled')::boolean)
      and (select count(*) from garage_building_staff where enabled and role='director' and registration_status='active')<=1 then raise exception 'LAST_DIRECTOR'; end if;
   update garage_building_staff set role=r,business_access=access,enabled=(p_data->>'enabled')::boolean,session_version=session_version+1 where id=staff.id;
   delete from garage_building_sessions where user_id=staff.id;
   update users set role=r,business_access=access where id=staff.id;
   return '{}'::jsonb;
 elsif p_action='invite_info' then
   select * into inv from autodream_staff_invitations where token_hash=p_data->>'tokenHash' and expires_at>now() and consumed_at is null and revoked_at is null;
   if not found or not exists(select 1 from garage_building_staff where id=inv.created_by and enabled and role='director' and registration_status='active') then raise exception 'INVALID_LINK'; end if;
   return jsonb_build_object('role',inv.role,'businessAccess',inv.business_access,'username',(select username from garage_building_staff where id=inv.target_id));
 elsif p_action='register' then
   select * into inv from autodream_staff_invitations where token_hash=p_data->>'tokenHash' for update;
   if not found or inv.expires_at<=now() or inv.consumed_at is not null or inv.revoked_at is not null then raise exception 'INVALID_LINK'; end if;
   select * into actor from garage_building_staff where id=inv.created_by for share;
   if not found or not actor.enabled or actor.role<>'director' or actor.registration_status<>'active' then raise exception 'INVALID_LINK'; end if;
   email_value:=lower(p_data->>'email');
   if inv.target_id is not null then
     select * into staff from garage_building_staff where id=inv.target_id for update;
     if not found or not staff.enabled or staff.email_verified_at is not null or staff.username<>p_data->>'username' or staff.role<>inv.role or staff.business_access<>inv.business_access then raise exception 'INVALID_ENROLLMENT'; end if;
     new_staff_id:=staff.id;
     -- Preserve the existing account until the new email is proven. This also
     -- lets the sole director enroll themselves without locking everyone out.
     update autodream_staff_invitations set revoked_at=now() where target_id=inv.target_id and id<>inv.id and revoked_at is null;
   else
     new_staff_id:=p_data->>'staffId';
     if exists(select 1 from users where lower(username)=lower(p_data->>'username')) then raise exception 'INVALID_USERNAME_UNAVAILABLE'; end if;
     -- Legacy rows receive a discarded random password, never the staff password.
     insert into users(id,name,username,password,role,business_access,phone,monthly_target,cars_in_month)
     values(new_staff_id,p_data->>'name',p_data->>'username',extensions.crypt(encode(extensions.gen_random_bytes(32),'hex'),extensions.gen_salt('bf')),inv.role,inv.business_access,'',0,0);
     insert into garage_building_staff(id,name,username,password,role,business_access,email,registration_status,phone)
     values(new_staff_id,p_data->>'name',p_data->>'username',p_data->>'passwordHash',inv.role,inv.business_access,email_value,'pending',p_data->>'phone');
   end if;
   update autodream_staff_invitations set consumed_at=now() where id=inv.id;
   insert into autodream_email_tokens(token_hash,staff_id,purpose,email,invitation_id,session_version,pending_password_hash,pending_name,pending_phone)
   select p_data->>'emailTokenHash',new_staff_id,'verify',email_value,inv.id,s.session_version,case when inv.target_id is not null then p_data->>'passwordHash' else null end,p_data->>'name',p_data->>'phone' from garage_building_staff s where s.id=new_staff_id;
   return jsonb_build_object('email',email_value,'name',p_data->>'name');
 elsif p_action='request_email' then
   if p_data->>'purpose'='verify' then
     select * into tok from autodream_email_tokens where lower(email)=lower(p_data->>'email') and purpose='verify' and used_at is null order by created_at desc limit 1 for update;
     if not found then return null; end if;
     select * into staff from garage_building_staff where id=tok.staff_id for update;
     if not found or not staff.enabled or staff.email_verified_at is not null or staff.session_version<>tok.session_version then return null; end if;
     select * into inv from autodream_staff_invitations where id=tok.invitation_id for share;
     if not found or inv.revoked_at is not null or not exists(select 1 from garage_building_staff where id=inv.created_by and enabled and role='director' and registration_status='active') then return null; end if;
     email_value:=tok.email;
   else
     select * into staff from garage_building_staff where lower(email)=lower(p_data->>'email') and enabled for update;
     if not found or staff.email_verified_at is null or staff.registration_status<>'active' then return null; end if;
     email_value:=staff.email;
   end if;
   update autodream_email_tokens set used_at=now() where staff_id=staff.id and purpose=p_data->>'purpose' and used_at is null;
   insert into autodream_email_tokens(token_hash,staff_id,purpose,email,invitation_id,session_version,pending_password_hash,pending_name,pending_phone)
   values(p_data->>'emailTokenHash',staff.id,p_data->>'purpose',email_value,case when p_data->>'purpose'='verify' then inv.id else null end,staff.session_version,case when p_data->>'purpose'='verify' then tok.pending_password_hash else null end,tok.pending_name,tok.pending_phone);
   return jsonb_build_object('email',email_value,'name',staff.name);
 elsif p_action in ('verify','reset','check_email_token') then
   select * into tok from autodream_email_tokens where token_hash=p_data->>'tokenHash' for update;
   if not found or tok.expires_at<=now() or tok.used_at is not null then raise exception 'INVALID_LINK'; end if;
   select * into staff from garage_building_staff where id=tok.staff_id for update;
   if not found or not staff.enabled or (tok.purpose='reset' and staff.email<>tok.email) or (tok.purpose='verify' and staff.email_verified_at is not null) or staff.session_version<>tok.session_version then raise exception 'INVALID_LINK'; end if;
   if p_action='check_email_token' then
     if tok.purpose<>p_data->>'purpose' then raise exception 'INVALID_LINK'; end if;
     return '{}'::jsonb;
   elsif p_action='verify' then
     if tok.purpose<>'verify' or (staff.registration_status<>'pending' and tok.pending_password_hash is null) then raise exception 'INVALID_LINK'; end if;
     select * into inv from autodream_staff_invitations where id=tok.invitation_id for share;
     if not found or inv.revoked_at is not null or not exists(select 1 from garage_building_staff where id=inv.created_by and enabled and role='director' and registration_status='active') then raise exception 'INVALID_LINK'; end if;
     update garage_building_staff set registration_status='active',email=tok.email,email_verified_at=now(),password=coalesce(tok.pending_password_hash,password),name=coalesce(tok.pending_name,name),phone=coalesce(tok.pending_phone,phone),session_version=session_version+1 where id=staff.id;
     delete from garage_building_sessions where user_id=staff.id;
     update users set name=coalesce(tok.pending_name,name) where id=staff.id;
   else
     if tok.purpose<>'reset' or staff.email_verified_at is null or staff.registration_status<>'active' then raise exception 'INVALID_LINK'; end if;
     update garage_building_staff set password=p_data->>'passwordHash',session_version=session_version+1 where id=staff.id;
     delete from garage_building_sessions where user_id=staff.id;
   end if;
   update autodream_email_tokens set used_at=now() where staff_id=staff.id and used_at is null;
   return '{}'::jsonb;
 end if;
 raise exception 'INVALID_ACTION';
end $$;
revoke all on function public.autodream_account_action(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.autodream_account_action(text,text,jsonb) to service_role;
-- Initial director setup requires a database administrator, never a public
-- profile or an unauthenticated request. Returns a token once; do not log it.
create function public.autodream_bootstrap_director_invitation(p_director_id text)
returns text language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare code text:=encode(extensions.gen_random_bytes(32),'hex');
begin
 perform public.autodream_account_action('invite',p_director_id,jsonb_build_object(
   'id',encode(extensions.gen_random_bytes(16),'hex'),'tokenHash',encode(sha256(convert_to(code,'UTF8')),'hex'),
   'targetId',p_director_id));
 return code;
end $$;
revoke all on function public.autodream_bootstrap_director_invitation(text) from public,anon,authenticated,service_role;
commit;
