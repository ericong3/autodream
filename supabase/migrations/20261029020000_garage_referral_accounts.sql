-- PREPARED ONLY: isolated external accounts. Does not grant internal staff access.
create table public.garage_referral_profiles (
 id uuid primary key default gen_random_uuid(),
 external_salesman_id uuid unique references public.external_salesmen(id),
 email text,
 password_hash text check(password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
 profile jsonb not null default '{}' check(jsonb_typeof(profile)='object'),
 email_verified_at timestamptz,
 approved_by text references public.garage_building_staff(id),
 approved_at timestamptz,
 enabled boolean not null default true,
 session_version integer not null default 0,
 registered_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index garage_referral_email on public.garage_referral_profiles(lower(email)) where email is not null;
create unique index garage_referral_identity on public.garage_referral_profiles
 ((profile->>'recipientType'),(upper(regexp_replace(profile->>'identityNumber','[^[:alnum:]]','','g')))) where registered_at is not null;
create table public.garage_referral_invites (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 profile_id uuid not null references public.garage_referral_profiles(id),
 created_by text not null references public.garage_building_staff(id),
 expires_at timestamptz not null default now()+interval '7 days',
 used_at timestamptz
);
create table public.garage_referral_email_tokens (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 profile_id uuid not null references public.garage_referral_profiles(id),
 purpose text not null default 'verify' check(purpose in ('verify','reset')),
 expires_at timestamptz not null default now()+interval '30 minutes',
 used_at timestamptz
);
create table public.garage_referral_sessions (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 profile_id uuid not null references public.garage_referral_profiles(id),
 version integer not null,
 created_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '8 hours'
);
create table public.garage_referral_profile_audit (
 id bigint generated always as identity primary key,
 profile_id uuid not null references public.garage_referral_profiles(id),
 actor_id text not null,
 action text not null,
 created_at timestamptz not null default now()
);

create function public.garage_referral_manager(p_actor text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from garage_building_staff where id=p_actor and enabled
 and registration_status='active' and business_access in ('garage','both') and role in ('director','garage_head'));
$$;

-- Called only by the trusted server, never directly by a browser role.
create function public.garage_referral_account(p_action text,p_actor text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p garage_referral_profiles;inv garage_referral_invites;t garage_referral_email_tokens;s garage_referral_sessions;details jsonb;pid uuid;
begin
 if p_action in ('list','invite','approve','disable','enable') then
  perform 1 from garage_building_staff where id=p_actor for share;
  if not garage_referral_manager(p_actor) then raise exception 'NOT_ALLOWED';end if;
  if p_action='list' then
   return jsonb_build_object('profiles',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'externalSalesmanId',external_salesman_id,'email',email,'profile',profile,
    'registeredAt',registered_at,'emailVerifiedAt',email_verified_at,'approvedAt',approved_at,'enabled',enabled))
    from garage_referral_profiles),'[]'::jsonb));
  elsif p_action='invite' then
   if coalesce(p_data->>'tokenHash','') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID';end if;
   if nullif(p_data->>'externalSalesmanId','') is not null then
    perform 1 from external_salesmen where id=(p_data->>'externalSalesmanId')::uuid for share;
    if not found then raise exception 'INVALID';end if;
    insert into garage_referral_profiles(external_salesman_id) values((p_data->>'externalSalesmanId')::uuid)
     on conflict(external_salesman_id) do nothing;
    select * into p from garage_referral_profiles where external_salesman_id=(p_data->>'externalSalesmanId')::uuid for update;
   else
    insert into garage_referral_profiles default values returning * into p;
   end if;
   if p.registered_at is not null or not p.enabled then raise exception 'ALREADY_REGISTERED';end if;
   update garage_referral_invites set expires_at=now() where profile_id=p.id and used_at is null;
   insert into garage_referral_invites(token_hash,profile_id,created_by) values(p_data->>'tokenHash',p.id,p_actor);
   insert into garage_referral_profile_audit(profile_id,actor_id,action) values(p.id,p_actor,'invite_created');
   return jsonb_build_object('profileId',p.id);
  end if;
  select * into p from garage_referral_profiles where id=(p_data->>'id')::uuid for update;
  if not found then raise exception 'NOT_ALLOWED';end if;
  if p_action='approve' then
   if p.registered_at is null or p.email_verified_at is null or not p.enabled then raise exception 'PROFILE_NOT_READY';end if;
   -- Approval is explicit. Do not import sensitive tax details into the legacy directory.
   if p.external_salesman_id is null then
    insert into external_salesmen(name) values(p.profile->>'legalName') returning id into pid;
   else pid:=p.external_salesman_id;end if;
   update garage_referral_profiles set external_salesman_id=pid,approved_by=p_actor,approved_at=now() where id=p.id;
  elsif p_action='disable' then
   update garage_referral_profiles set enabled=false,session_version=session_version+1 where id=p.id;
  else
   update garage_referral_profiles set enabled=true,session_version=session_version+1 where id=p.id;
  end if;
  insert into garage_referral_profile_audit(profile_id,actor_id,action) values(p.id,p_actor,p_action);
  return jsonb_build_object('ok',true);
 elsif p_action in ('inspect','register') then
  select * into inv from garage_referral_invites where token_hash=p_data->>'tokenHash';
  if not found or inv.used_at is not null or inv.expires_at<=now() or not garage_referral_manager(inv.created_by) then raise exception 'INVALID_LINK';end if;
  select * into p from garage_referral_profiles where id=inv.profile_id for update;
  select * into inv from garage_referral_invites where token_hash=p_data->>'tokenHash' for update;
  if inv.used_at is not null or inv.expires_at<=now() then raise exception 'INVALID_LINK';end if;
  if p.registered_at is not null or not p.enabled then raise exception 'INVALID_LINK';end if;
  if p_action='inspect' then return jsonb_build_object('valid',true);end if;
  details:=p_data->'profile';
  if jsonb_typeof(details) is distinct from 'object' or
   details-array['legalName','recipientType','identityNumber','tin','address','phone','brand','branch','bank','bankAccount','bankHolder']<>'{}'::jsonb then raise exception 'INVALID';end if;
  if coalesce(details->>'recipientType','') not in ('individual','business') or
   exists(select 1 from unnest(array['legalName','identityNumber','tin','address','phone','brand','branch','bank','bankAccount','bankHolder']) k
    where jsonb_typeof(details->k) is distinct from 'string' or length(trim(details->>k)) not between 1 and 500) or
   coalesce(p_data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_data->>'email')>254 or
   coalesce(p_data->>'emailTokenHash','') !~ '^[a-f0-9]{64}$' or p_data->>'passwordHash' is null then raise exception 'INVALID';end if;
  update garage_referral_profiles set email=lower(trim(p_data->>'email')),password_hash=p_data->>'passwordHash',profile=details,registered_at=now() where id=p.id;
  update garage_referral_invites set used_at=now() where token_hash=inv.token_hash;
  insert into garage_referral_email_tokens(token_hash,profile_id) values(p_data->>'emailTokenHash',p.id);
  insert into garage_referral_profile_audit(profile_id,actor_id,action) values(p.id,p.id::text,'registered');
  return jsonb_build_object('email',lower(trim(p_data->>'email')));
 elsif p_action in ('resend','forgot') then
  select * into p from garage_referral_profiles where email=lower(trim(p_data->>'email')) for update;
  if not found or not p.enabled or p.registered_at is null then return null;end if;
  if (p_action='resend' and p.email_verified_at is not null) or (p_action='forgot' and (p.email_verified_at is null or p.approved_at is null)) then return null;end if;
  update garage_referral_email_tokens set expires_at=now() where profile_id=p.id and used_at is null and purpose=case when p_action='forgot' then 'reset' else 'verify' end;
  insert into garage_referral_email_tokens(token_hash,profile_id,purpose) values(p_data->>'emailTokenHash',p.id,case when p_action='forgot' then 'reset' else 'verify' end);
  return jsonb_build_object('email',p.email);
 elsif p_action in ('verify','reset') then
  select * into t from garage_referral_email_tokens where token_hash=p_data->>'tokenHash';
  if not found or t.used_at is not null or t.expires_at<=now() or t.purpose<>(case when p_action='reset' then 'reset' else 'verify' end) then raise exception 'INVALID_LINK';end if;
  perform 1 from garage_referral_profiles where id=t.profile_id and enabled for update;
  if not found then raise exception 'INVALID_LINK';end if;
  select * into t from garage_referral_email_tokens where token_hash=p_data->>'tokenHash' for update;
  if t.used_at is not null or t.expires_at<=now() or t.purpose<>(case when p_action='reset' then 'reset' else 'verify' end) then raise exception 'INVALID_LINK';end if;
  if p_action='reset' then
   if p_data->>'passwordHash' is null then raise exception 'INVALID';end if;
   update garage_referral_profiles set password_hash=p_data->>'passwordHash',session_version=session_version+1 where id=t.profile_id;
  else
   update garage_referral_profiles set email_verified_at=now() where id=t.profile_id;
  end if;
  update garage_referral_email_tokens set used_at=now() where profile_id=t.profile_id and purpose=t.purpose and used_at is null;
  insert into garage_referral_profile_audit(profile_id,actor_id,action) values(t.profile_id,t.profile_id::text,p_action);
  return jsonb_build_object('ok',true);
 elsif p_action='login_lookup' then
  select * into p from garage_referral_profiles where email=lower(trim(p_data->>'email')) and enabled
   and email_verified_at is not null and approved_at is not null;
  if not found then return null;end if;
  return jsonb_build_object('id',p.id,'passwordHash',p.password_hash,'version',p.session_version);
 elsif p_action='new_session' then
  select * into p from garage_referral_profiles where id=(p_data->>'id')::uuid for share;
  if not found or not p.enabled or p.email_verified_at is null or p.approved_at is null or
   p.session_version is distinct from (p_data->>'version')::integer or p.password_hash is distinct from p_data->>'passwordHash' then raise exception 'NOT_ALLOWED';end if;
  delete from garage_referral_sessions where profile_id=p.id and expires_at<=now();
  insert into garage_referral_sessions(token_hash,profile_id,version) values(p_data->>'tokenHash',p.id,p.session_version);
  return jsonb_build_object('ok',true);
 elsif p_action='logout' then
  delete from garage_referral_sessions where token_hash=p_data->>'tokenHash';return jsonb_build_object('ok',true);
 elsif p_action='session' then
  select * into s from garage_referral_sessions where token_hash=p_data->>'tokenHash';
  if not found or s.expires_at<=now() or s.last_seen_at<=now()-interval '2 hours' then raise exception 'SESSION_REQUIRED';end if;
  select * into p from garage_referral_profiles where id=s.profile_id;
  if not found or not p.enabled or p.approved_at is null or p.email_verified_at is null or s.version<>p.session_version then raise exception 'SESSION_REQUIRED';end if;
  update garage_referral_sessions set last_seen_at=now() where token_hash=s.token_hash;
  return jsonb_build_object('id',p.id,'email',p.email,'profile',p.profile);
 else raise exception 'INVALID';end if;
end$$;

do $$ declare tab text;begin
 foreach tab in array array['garage_referral_profiles','garage_referral_invites','garage_referral_email_tokens','garage_referral_sessions','garage_referral_profile_audit'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
 end loop;
end$$;
revoke all on function public.garage_referral_manager(text),public.garage_referral_account(text,text,jsonb) from public,anon,authenticated;
revoke all on sequence public.garage_referral_profile_audit_id_seq from public,anon,authenticated;
grant execute on function public.garage_referral_account(text,text,jsonb) to service_role;
