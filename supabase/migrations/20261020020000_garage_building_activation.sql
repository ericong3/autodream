-- Garage-only first-time password setup. Never trusts legacy users roles.
create table if not exists public.garage_building_invites (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  staff_id text not null unique references public.garage_building_staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '72 hours')
);
alter table public.garage_building_invites enable row level security;
revoke all on public.garage_building_invites from public, anon, authenticated;
create unique index if not exists garage_building_staff_username_lower_idx on public.garage_building_staff(lower(username));

-- Only a database administrator can issue/reissue codes. The app server
-- cannot mint access for anyone. New codes replace old ones for that staff.
create or replace function public.garage_building_issue_invite(p_staff_id text, p_ttl interval default interval '72 hours')
returns text language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare code text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if p_ttl is null or p_ttl <= interval '0' or p_ttl > interval '72 hours' then raise exception 'BAD_TTL'; end if;
  perform 1 from garage_building_staff where id = p_staff_id and enabled;
  if not found then raise exception 'NO_STAFF'; end if;
  insert into garage_building_invites(token_hash, staff_id, created_at, expires_at)
  values(encode(sha256(convert_to(code,'UTF8')),'hex'), p_staff_id, now(), now()+p_ttl)
  on conflict(staff_id) do update set token_hash=excluded.token_hash, created_at=excluded.created_at, expires_at=excluded.expires_at, used_at=null;
  return code;
end $$;
revoke all on function public.garage_building_issue_invite(text,interval) from public, anon, authenticated, service_role;

create or replace function public.garage_building_check_invite(p_token_hash text, p_username text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from garage_building_invites i join garage_building_staff s on s.id=i.staff_id
    where i.token_hash=p_token_hash and s.username=p_username and s.enabled and i.used_at is null and i.expires_at>now());
$$;
revoke all on function public.garage_building_check_invite(text,text) from public, anon, authenticated;
grant execute on function public.garage_building_check_invite(text,text) to service_role;

create or replace function public.garage_building_activate_staff(p_token_hash text, p_username text, p_password_hash text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare inv garage_building_invites; staff garage_building_staff;
begin
  if p_password_hash is null or p_password_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception 'INVALID_PASSWORD_HASH';
  end if;
  select * into inv from garage_building_invites where token_hash = p_token_hash for update;
  if not found or inv.used_at is not null or inv.expires_at <= now() then return false; end if;
  select * into staff from garage_building_staff where id = inv.staff_id and username = p_username and enabled for update;
  if not found then return false; end if;
  update garage_building_staff set password = p_password_hash where id = staff.id;
  update garage_building_invites set used_at = now() where token_hash = inv.token_hash;
  delete from garage_building_sessions where user_id = staff.id;
  return true;
end $$;
revoke all on function public.garage_building_activate_staff(text,text,text) from public, anon, authenticated;
grant execute on function public.garage_building_activate_staff(text,text,text) to service_role;
