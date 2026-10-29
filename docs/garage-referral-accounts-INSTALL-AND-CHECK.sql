-- Prepared only. Requires approval before installation.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
DO $preflight$
BEGIN
 IF to_regclass('public.garage_referral_profiles') IS NOT NULL OR to_regprocedure('public.garage_referral_account(text,text,jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'STOP: Referral account setup already exists. Check its version before continuing.';
 END IF;
 IF to_regclass('public.garage_building_staff') IS NULL OR NOT EXISTS(
  SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='external_salesmen' AND column_name='id' AND data_type='uuid'
 ) THEN RAISE EXCEPTION 'STOP: Staff or external salesman baseline differs. No changes made.'; END IF;
END
$preflight$;
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
 profile_submitted_at timestamptz,
 profile_approved_by text references public.garage_building_staff(id),
 profile_approved_at timestamptz,
 profile_revision integer not null default 1,
 enabled boolean not null default true,
 session_version integer not null default 0,
 registered_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index garage_referral_email on public.garage_referral_profiles(lower(email)) where email is not null;
create unique index garage_referral_identity on public.garage_referral_profiles
 ((profile->>'recipientType'),(upper(regexp_replace(profile->>'identityNumber','[^[:alnum:]]','','g')))) where length(regexp_replace(coalesce(profile->>'identityNumber',''),'[^[:alnum:]]','','g'))>0;
create table public.garage_referral_profile_requests (
 request_key text primary key,
 profile_id uuid not null references public.garage_referral_profiles(id),
 payload jsonb not null,
 created_at timestamptz not null default now()
);
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
create table public.garage_referral_profile_versions (
 id bigint generated always as identity primary key,
 profile_id uuid not null references public.garage_referral_profiles(id),
 profile jsonb not null,
 revision integer not null,
 actor_id text not null,
 created_at timestamptz not null default now()
);

create function public.garage_referral_manager(p_actor text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from garage_building_staff where id=p_actor and enabled
 and registration_status='active' and business_access in ('garage','both') and role in ('director','garage_head'));
$$;

-- Called only by the trusted server, never directly by a browser role.
create function public.garage_referral_profile_valid(details jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
begin
 if jsonb_typeof(details) is distinct from 'object' then return false;end if;
 if details-array['legalName','recipientType','identityNumber','tin','address','phone','brand','branch','bank','bankAccount','bankHolder']<>'{}'::jsonb
 or coalesce(details->>'recipientType','') not in ('individual','business') then return false;end if;
 if exists(select 1 from unnest(array['legalName','phone','brand','branch']) k
  where jsonb_typeof(details->k) is distinct from 'string' or length(trim(details->>k)) not between 1 and 500) then return false;end if;
 return not exists(select 1 from jsonb_each(details) f where jsonb_typeof(f.value) is distinct from 'string' or length(f.value#>>'{}')>500);
end$$;
create function public.garage_referral_account(p_action text,p_actor text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p garage_referral_profiles;inv garage_referral_invites;t garage_referral_email_tokens;s garage_referral_sessions;details jsonb;pid uuid;request_key_value text;prior garage_referral_profile_requests;
begin
 if p_action in ('list','create_profile','update_profile','invite','cancel_invite','approve','disable','enable') then
  perform 1 from garage_building_staff where id=p_actor for share;
  if not garage_referral_manager(p_actor) then raise exception 'NOT_ALLOWED';end if;
  if p_action='list' then
   return jsonb_build_object('profiles',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'externalSalesmanId',external_salesman_id,'email',email,'profile',profile,
    'registeredAt',registered_at,'emailVerifiedAt',email_verified_at,'approvedAt',approved_at,'enabled',enabled,
    'profileSavedAt',profile_submitted_at,'profileApprovedAt',profile_approved_at,'profileRevision',profile_revision,
    'hasInvite',exists(select 1 from garage_referral_invites v where v.profile_id=garage_referral_profiles.id and v.used_at is null and v.expires_at>now())))
    from garage_referral_profiles),'[]'::jsonb));
  elsif p_action in ('create_profile','update_profile') then
   if coalesce(p_data->>'requestId','') !~ '^[A-Za-z0-9_-]{16,80}$' or not garage_referral_profile_valid(p_data->'profile') then raise exception 'INVALID';end if;
   request_key_value:='staff:'||p_action||':'||p_actor||':'||(p_data->>'requestId');
   perform pg_advisory_xact_lock(hashtext(request_key_value));
   select * into prior from garage_referral_profile_requests r where r.request_key=request_key_value;
   if found then
    if prior.payload is distinct from p_data-'requestId' then raise exception 'REQUEST_CHANGED';end if;
    return jsonb_build_object('profileId',prior.profile_id);
   end if;
   if p_action='update_profile' then
    select * into p from garage_referral_profiles where id=(p_data->>'id')::uuid for update;
    if not found then raise exception 'NOT_ALLOWED';end if;
    if coalesce(p_data->>'revision','') !~ '^[0-9]{1,10}$' or p.profile_revision is distinct from (p_data->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
    if coalesce((p_data->>'remainAccountless')::boolean,false) then
     if p.registered_at is not null then raise exception 'ALREADY_REGISTERED';end if;
     update garage_referral_invites set expires_at=now() where profile_id=p.id and used_at is null;
    end if;
    insert into garage_referral_profile_versions(profile_id,profile,revision,actor_id) values(p.id,p.profile,p.profile_revision,p_actor);
    update garage_referral_profiles set profile=p_data->'profile',profile_revision=profile_revision+1,
     profile_submitted_at=coalesce(profile_submitted_at,now()),profile_approved_at=now(),profile_approved_by=p_actor where id=p.id;
   else
   if nullif(p_data->>'externalSalesmanId','') is not null then
    select id into pid from external_salesmen where id=(p_data->>'externalSalesmanId')::uuid for share;
    if not found then raise exception 'INVALID';end if;
   else
    insert into external_salesmen(name) values(p_data->'profile'->>'legalName') returning id into pid;
   end if;
   insert into garage_referral_profiles(external_salesman_id,profile,profile_submitted_at,profile_approved_by,profile_approved_at)
    values(pid,p_data->'profile',now(),p_actor,now()) returning * into p;
   end if;
   insert into garage_referral_profile_requests(request_key,profile_id,payload) values(request_key_value,p.id,p_data-'requestId');
   insert into garage_referral_profile_audit(profile_id,actor_id,action) values(p.id,p_actor,p_action);
   return jsonb_build_object('profileId',p.id);
  elsif p_action='invite' then
   if coalesce(p_data->>'tokenHash','') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID';end if;
   if nullif(p_data->>'profileId','') is not null then
    if nullif(p_data->>'externalSalesmanId','') is not null then raise exception 'INVALID';end if;
    select * into p from garage_referral_profiles where id=(p_data->>'profileId')::uuid for update;
    if not found then raise exception 'NOT_ALLOWED';end if;
   elsif nullif(p_data->>'externalSalesmanId','') is not null then
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
  if p_action='cancel_invite' then
   if p.registered_at is not null then raise exception 'ALREADY_REGISTERED';end if;
   update garage_referral_invites set expires_at=now() where profile_id=p.id and used_at is null;
  elsif p_action='approve' then
   if p.profile_submitted_at is null or not garage_referral_profile_valid(p.profile) or not p.enabled
    or (p.registered_at is not null and p.email_verified_at is null) then raise exception 'PROFILE_NOT_READY';end if;
   -- Approval is explicit. Do not import sensitive tax details into the legacy directory.
   if p.external_salesman_id is null then
    insert into external_salesmen(name) values(p.profile->>'legalName') returning id into pid;
   else pid:=p.external_salesman_id;end if;
   update garage_referral_profiles set external_salesman_id=pid,profile_approved_by=p_actor,profile_approved_at=now(),
    approved_by=case when registered_at is not null then p_actor else null end,
    approved_at=case when registered_at is not null then now() else null end where id=p.id;
  elsif p_action='disable' then
   update garage_referral_profiles set enabled=false,session_version=session_version+1 where id=p.id;
  else
   update garage_referral_profiles set enabled=true,session_version=session_version+1 where id=p.id;
  end if;
  insert into garage_referral_profile_audit(profile_id,actor_id,action) values(p.id,p_actor,p_action);
  return jsonb_build_object('ok',true);
 elsif p_action in ('inspect','register','save_profile') then
  select * into inv from garage_referral_invites where token_hash=p_data->>'tokenHash';
  if not found or inv.expires_at<=now() or not garage_referral_manager(inv.created_by) then raise exception 'INVALID_LINK';end if;
  select * into p from garage_referral_profiles where id=inv.profile_id for update;
  select * into inv from garage_referral_invites where token_hash=p_data->>'tokenHash' for update;
  if inv.expires_at<=now() then raise exception 'INVALID_LINK';end if;
  if inv.used_at is not null then
   if p_action='save_profile' then
    select * into prior from garage_referral_profile_requests r where r.request_key='invite:'||inv.token_hash;
    if found then
     if prior.payload is distinct from p_data->'profile' then raise exception 'REQUEST_CHANGED';end if;
     return jsonb_build_object('profileId',prior.profile_id);
    end if;
   end if;
   raise exception 'INVALID_LINK';
  end if;
  if p.registered_at is not null or not p.enabled then raise exception 'INVALID_LINK';end if;
  if p_action='inspect' then return jsonb_build_object('valid',true,'profile',p.profile-array['identityNumber','tin','address','bank','bankAccount','bankHolder']);end if;
  if not garage_referral_profile_valid(p_data->'profile') then raise exception 'INVALID';end if;
  -- Account setup extends the original profile; blank fields cannot erase earlier tax/payment details.
  select p.profile||coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into details from jsonb_each(p_data->'profile') where length(trim(value#>>'{}'))>0;
  if details is distinct from p.profile then
   insert into garage_referral_profile_versions(profile_id,profile,revision,actor_id) values(p.id,p.profile,p.profile_revision,p.id::text);
  end if;
  if p_action='save_profile' then
   update garage_referral_profiles set profile=details,profile_submitted_at=now(),profile_revision=profile_revision+case when details is distinct from profile then 1 else 0 end,
    profile_approved_at=case when details=profile then profile_approved_at else null end,
    profile_approved_by=case when details=profile then profile_approved_by else null end where id=p.id;
   update garage_referral_invites set used_at=now() where token_hash=inv.token_hash;
   insert into garage_referral_profile_requests(request_key,profile_id,payload) values('invite:'||inv.token_hash,p.id,p_data->'profile');
   insert into garage_referral_profile_audit(profile_id,actor_id,action) values(p.id,p.id::text,'profile_saved_accountless');
   return jsonb_build_object('profileId',p.id);
  end if;
  if coalesce(p_data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_data->>'email')>254 or
   coalesce(p_data->>'emailTokenHash','') !~ '^[a-f0-9]{64}$' or p_data->>'passwordHash' is null then raise exception 'INVALID';end if;
  update garage_referral_profiles set email=lower(trim(p_data->>'email')),password_hash=p_data->>'passwordHash',profile=details,registered_at=now(),profile_submitted_at=coalesce(profile_submitted_at,now()),profile_revision=profile_revision+case when details is distinct from profile then 1 else 0 end,
   profile_approved_at=case when details=profile then profile_approved_at else null end,
   profile_approved_by=case when details=profile then profile_approved_by else null end where id=p.id;
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
 foreach tab in array array['garage_referral_profiles','garage_referral_profile_requests','garage_referral_invites','garage_referral_email_tokens','garage_referral_sessions','garage_referral_profile_audit','garage_referral_profile_versions'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
 end loop;
end$$;
revoke all on function public.garage_referral_manager(text),public.garage_referral_profile_valid(jsonb),public.garage_referral_account(text,text,jsonb) from public,anon,authenticated;
revoke all on sequence public.garage_referral_profile_audit_id_seq from public,anon,authenticated;
revoke all on sequence public.garage_referral_profile_versions_id_seq from public,anon,authenticated;
grant execute on function public.garage_referral_account(text,text,jsonb) to service_role;

NOTIFY pgrst, 'reload schema';
SELECT jsonb_build_object(
 'external_accounts_ready',to_regprocedure('public.garage_referral_account(text,text,jsonb)') IS NOT NULL,
 'account_function_private',NOT has_function_privilege('anon','public.garage_referral_account(text,text,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','public.garage_referral_account(text,text,jsonb)','EXECUTE'),
 'profile_table_private',NOT has_table_privilege('anon','public.garage_referral_profiles','SELECT') AND NOT has_table_privilege('authenticated','public.garage_referral_profiles','SELECT'),
 'checked_at',now());
COMMIT;
