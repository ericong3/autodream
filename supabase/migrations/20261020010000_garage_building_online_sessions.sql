-- Garage building online saving — server session + sign-in throttle storage.
--
-- PREPARED, NOT APPLIED. Apply only together with
-- 20261020000000_garage_building_projects.sql and the server deployment in
-- docs/garage-building-online.md.
--
-- Used only by the trusted server bridge (api/garage-building/*) through
-- the service role. Browser roles get no table or function access. Nothing
-- here alters `users` or any used-car / invoice table.

-- ── Sessions ─────────────────────────────────────────────────────────────
-- Only a SHA-256 of the cookie token is stored, never the token itself.
-- credential_fingerprint is an HMAC (server secret) over the user's id,
-- username and stored password value, so changing a password or username
-- invalidates every session issued before the change.
create table if not exists garage_building_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id text not null references garage_building_staff(id) on delete cascade,
  credential_fingerprint text not null check (length(credential_fingerprint) between 32 and 128),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '1 day')
);

create index if not exists garage_building_sessions_user_idx on garage_building_sessions(user_id);
create index if not exists garage_building_sessions_expires_idx on garage_building_sessions(expires_at);

alter table garage_building_sessions enable row level security;
revoke all on garage_building_sessions from public, anon, authenticated;
grant select, insert, update (last_seen_at), delete on garage_building_sessions to service_role;

-- ── Sign-in throttle ─────────────────────────────────────────────────────
-- Keys are HMACs of the username / client IP, never the raw values.
create table if not exists garage_building_auth_throttle (
  key text primary key check (key ~ '^[a-z]{1,8}:[A-Za-z0-9_-]{16,128}$'),
  window_start timestamptz not null,
  attempts integer not null check (attempts >= 1)
);

alter table garage_building_auth_throttle enable row level security;
revoke all on garage_building_auth_throttle from public, anon, authenticated;

-- Counts one attempt (atomically, so parallel guesses can't race past the
-- limit) and says whether it's allowed. Fixed window per key.
create or replace function garage_building_auth_throttle_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t timestamptz := clock_timestamp();
  w interval;
  r garage_building_auth_throttle;
begin
  if p_key is null or p_key !~ '^[a-z]{1,8}:[A-Za-z0-9_-]{16,128}$'
     or p_limit is null or p_limit not between 1 and 1000
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'INVALID_THROTTLE';
  end if;
  w := make_interval(secs => p_window_seconds);
  insert into garage_building_auth_throttle as g (key, window_start, attempts)
  values (p_key, t, 1)
  on conflict (key) do update set
    window_start = case when g.window_start + w <= t then t else g.window_start end,
    attempts     = case when g.window_start + w <= t then 1 else least(g.attempts + 1, 1000000) end
  returning * into r;
  -- Housekeeping: drop stale keys now and then.
  if random() < 0.02 then
    delete from garage_building_auth_throttle where window_start < t - interval '2 days';
    delete from garage_building_sessions where expires_at < t;
  end if;
  return query select r.attempts <= p_limit,
    greatest(0, ceil(extract(epoch from (r.window_start + w - t))))::integer;
end $$;

create or replace function garage_building_auth_throttle_clear(p_key text)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from garage_building_auth_throttle where key = p_key;
$$;

revoke all on function garage_building_auth_throttle_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function garage_building_auth_throttle_clear(text) from public, anon, authenticated;
grant execute on function garage_building_auth_throttle_hit(text, integer, integer) to service_role;
grant execute on function garage_building_auth_throttle_clear(text) to service_role;

-- Admin: end every Garage online session (e.g. after a suspected leak):
--   delete from garage_building_sessions;
-- End one person's sessions:
--   delete from garage_building_sessions where user_id = '<user id>';
