-- Garage building tint projects — measured scope + immutable quote versions.
--
-- Applied to AutoDream on 19 October 2026 with user approval.
-- Shared access uses the private server bridge and private staff accounts;
-- VITE_GARAGE_BUILDING_STORAGE=online selects that deployed path.
-- See docs/garage-building-online.md for setup and verification status.
--
-- New, building-only table. Nothing here alters users, garage_invoices or
-- any car/invoice table. No pricing: invoices, payments and installation
-- still run through the existing Garage car flow.
--
-- SECURITY NOTE — the legacy client-supplied actor ID does not prove identity.
-- Browser roles have no table access or execute grants in this migration.
-- A trusted server must validate the staff session and derive p_actor_id
-- before calling these functions. Do not put a service-role key in the browser.
--
-- What it does enforce: direct table access is denied (RLS on, no policies,
-- table privileges revoked); all reads/writes go through the functions
-- below; owner-or-manager checks; Garage business access; revision
-- compare-and-swap; saved quote versions can't be edited or removed;
-- structural validation of the JSON document.

-- Independent identity authority: the legacy users table is publicly
-- writable in this deployment and must never confer online Garage access.
-- Staff are provisioned by an admin, with fresh private bcrypt credentials.
create table if not exists garage_building_staff (
  id text primary key references users(id),
  username text not null unique check (length(username) between 1 and 100),
  name text not null,
  password text not null check (password ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
  role text not null check (role in ('garage_salesman','garage_head','director','shareholder')),
  business_access text not null default 'garage' check (business_access in ('garage','both')),
  enabled boolean not null default true
);
alter table garage_building_staff enable row level security;
revoke all on garage_building_staff from public, anon, authenticated;
grant select on garage_building_staff to service_role;

create table if not exists garage_building_projects (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  owner_id text not null references users(id),
  document jsonb not null,
  revision integer not null check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists garage_building_projects_owner_idx on garage_building_projects(owner_id);

alter table garage_building_projects enable row level security;
-- No policies on purpose: anon/authenticated can't touch the table directly.
revoke all on garage_building_projects from public, anon, authenticated;

-- ── Who may act ──────────────────────────────────────────────────────────
-- Returns the actor's role, or raises if they have no Garage access.
create or replace function garage_building_actor_role(p_actor_id text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u record;
begin
  select role, business_access into u from garage_building_staff where id = p_actor_id and enabled;
  if not found or coalesce(u.business_access, '') not in ('garage', 'both') then
    raise exception 'NO_GARAGE_ACCESS';
  end if;
  return u.role;
end $$;

-- Managers (director / shareholder / garage head) edit any project; a
-- Garage salesman only their own.
create or replace function garage_building_can_edit(p_owner_id text, p_role text, p_actor_id text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_role in ('director', 'shareholder', 'garage_head')
      or (p_role = 'garage_salesman' and p_owner_id = p_actor_id);
$$;

-- ── Validation ───────────────────────────────────────────────────────────
create or replace function garage_building_positive(p jsonb, p_max numeric)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_typeof(p) = 'number' and (p #>> '{}')::numeric > 0 and (p #>> '{}')::numeric <= p_max, false);
$$;

-- Rooms + windows for the live document or one version snapshot.
create or replace function garage_building_validate_scope(p_floors jsonb, p_rooms jsonb, p_windows jsonb, p_where text)
returns void language plpgsql immutable set search_path = public, pg_temp as $$
declare
  r jsonb; w jsonb; p jsonb; s jsonb;
  room_floor jsonb := '{}'::jsonb;
  floor_idx jsonb := '{}'::jsonb;
  seen_windows text[] := '{}'; seen_panes text[] := '{}'; cells text[];
  n int; i int := 0; rows_n int; cols_n int; from_i int; to_i int;
begin
  for r in select * from jsonb_array_elements(p_floors) loop
    floor_idx := floor_idx || jsonb_build_object(r->>'id', i); i := i + 1;
  end loop;
  if jsonb_typeof(p_rooms) is distinct from 'array' or jsonb_typeof(p_windows) is distinct from 'array' then
    raise exception 'INVALID_DOCUMENT: % rooms/windows must be lists', p_where;
  end if;
  for r in select * from jsonb_array_elements(p_rooms) loop
    if coalesce(r->>'id', '') !~ '^[A-Za-z0-9_-]{1,64}$' or room_floor ? (r->>'id') then
      raise exception 'INVALID_DOCUMENT: % bad room id', p_where;
    end if;
    if not floor_idx ? coalesce(r->>'floorId', '') then raise exception 'INVALID_DOCUMENT: % room on unknown floor', p_where; end if;
    if not (garage_building_positive(r->'width', 12000) and garage_building_positive(r->'depth', 12000))
       or jsonb_typeof(r->'x') is distinct from 'number' or jsonb_typeof(r->'z') is distinct from 'number' then
      raise exception 'INVALID_DOCUMENT: % room size/position', p_where;
    end if;
    room_floor := room_floor || jsonb_build_object(r->>'id', r->>'floorId');
  end loop;
  for w in select * from jsonb_array_elements(p_windows) loop
    if coalesce(w->>'id', '') !~ '^[A-Za-z0-9_-]{1,64}$' or (w->>'id') = any(seen_windows) then
      raise exception 'INVALID_DOCUMENT: % bad window id', p_where;
    end if;
    seen_windows := seen_windows || (w->>'id');
    if not room_floor ? coalesce(w->>'roomId', '') then raise exception 'INVALID_DOCUMENT: % window in unknown room', p_where; end if;
    if coalesce(w->>'wall', '') not in ('N', 'E', 'S', 'W')
       or coalesce(w->>'kind', '') not in ('window', 'sliding', 'custom')
       or coalesce(w->>'film', '') not in ('eco', 'lite', 'classic', 'majestic', 'unique', 'royal')
       or jsonb_typeof(w->'position') is distinct from 'number' or (w->>'position')::numeric not between 0 and 1 then
      raise exception 'INVALID_DOCUMENT: % window %', p_where, w->>'id';
    end if;
    n := case when jsonb_typeof(w->'panes') = 'array' then jsonb_array_length(w->'panes') else 0 end;
    if n < 1 or n > 24 then raise exception 'INVALID_DOCUMENT: % window needs 1-24 panes', p_where; end if;
    s := w->'span';
    if s is not null and s <> 'null'::jsonb then
      rows_n := (s->>'rows')::int; cols_n := (s->>'cols')::int;
      if rows_n not between 1 and 4 or cols_n not between 1 and 4 or rows_n * cols_n <> n then
        raise exception 'INVALID_DOCUMENT: % tall glass grid', p_where;
      end if;
      from_i := (floor_idx ->> (room_floor ->> (w->>'roomId')))::int;
      to_i := (floor_idx ->> coalesce(s->>'toFloorId', ''))::int;
      if to_i is null or to_i <= from_i then raise exception 'INVALID_DOCUMENT: % tall glass must reach a higher floor', p_where; end if;
      if jsonb_typeof(s->'bottom') is distinct from 'number' or (s->>'bottom')::numeric < 0 then
        raise exception 'INVALID_DOCUMENT: % tall glass bottom', p_where;
      end if;
      cells := '{}';
      for p in select * from jsonb_array_elements(w->'panes') loop
        if jsonb_typeof(p->'row') is distinct from 'number' or jsonb_typeof(p->'col') is distinct from 'number'
           or (p->>'row')::numeric not between 0 and rows_n - 1 or (p->>'col')::numeric not between 0 and cols_n - 1
           or (p->>'row') || ':' || (p->>'col') = any(cells) then
          raise exception 'INVALID_DOCUMENT: % tall glass pane outside grid', p_where;
        end if;
        cells := cells || ((p->>'row') || ':' || (p->>'col'));
      end loop;
    end if;
    for p in select * from jsonb_array_elements(w->'panes') loop
      if coalesce(p->>'id', '') !~ '^[A-Za-z0-9_-]{1,64}$' or (p->>'id') = any(seen_panes) then
        raise exception 'INVALID_DOCUMENT: % bad pane id', p_where;
      end if;
      seen_panes := seen_panes || (p->>'id');
      if not (garage_building_positive(p->'width', 2400) and garage_building_positive(p->'height', 2400))
         or jsonb_typeof(p->'measured') is distinct from 'boolean'
         or coalesce(p->>'shape', '') not in ('rect', 'custom')
         or (p ? 'verifiedArea' and (p->>'shape' <> 'custom' or not garage_building_positive(p->'verifiedArea', 10000))) then
        raise exception 'INVALID_DOCUMENT: % pane %', p_where, p->>'id';
      end if;
    end loop;
  end loop;
end $$;

create or replace function garage_building_validate(p_doc jsonb)
returns void language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v jsonb; i int := 0;
begin
  if jsonb_typeof(p_doc) is distinct from 'object' or octet_length(p_doc::text) > 2000000 then raise exception 'INVALID_DOCUMENT: too large or not an object'; end if;
  if exists (select 1 from jsonb_object_keys(p_doc) k where k not in (
    'schema', 'id', 'ownerId', 'customerId', 'customerName', 'phone', 'title', 'address',
    'floors', 'rooms', 'windows', 'versions', 'revision', 'createdAt', 'updatedAt')) then
    raise exception 'INVALID_DOCUMENT: unexpected field';
  end if;
  if p_doc->'schema' is distinct from '1'::jsonb then raise exception 'INVALID_DOCUMENT: schema'; end if;
  if coalesce(p_doc->>'id', '') !~ '^[A-Za-z0-9_-]{1,64}$' or coalesce(p_doc->>'ownerId', '') !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'INVALID_DOCUMENT: ids';
  end if;
  -- A customer reference, never an IC number.
  if p_doc ? 'customerId' and (p_doc->>'customerId' !~ '^[A-Za-z0-9_-]{1,64}$' or p_doc->>'customerId' ~ '^\d{6}-?\d{2}-?\d{4}$') then
    raise exception 'INVALID_DOCUMENT: customer reference';
  end if;
  if jsonb_typeof(p_doc->'floors') is distinct from 'array' or jsonb_array_length(p_doc->'floors') not between 1 and 20
     or (select count(distinct f->>'id') from jsonb_array_elements(p_doc->'floors') f where f->>'id' ~ '^[A-Za-z0-9_-]{1,64}$') <> jsonb_array_length(p_doc->'floors') then
    raise exception 'INVALID_DOCUMENT: floors';
  end if;
  perform garage_building_validate_scope(p_doc->'floors', p_doc->'rooms', p_doc->'windows', 'project');
  if jsonb_typeof(p_doc->'versions') is distinct from 'array' then raise exception 'INVALID_DOCUMENT: versions'; end if;
  for v in select * from jsonb_array_elements(p_doc->'versions') loop
    i := i + 1;
    if (v->>'number')::int is distinct from i or coalesce(v->>'id', '') !~ '^[A-Za-z0-9_-]{1,64}$'
       or jsonb_typeof(v->'sqft') is distinct from 'number' or (v->>'sqft')::numeric < 0
       or jsonb_typeof(v->'unchecked') is distinct from 'number' or (v->>'unchecked')::numeric < 0
       or jsonb_typeof(v->'windows') is distinct from 'array' or jsonb_array_length(v->'windows') = 0 then
      raise exception 'INVALID_DOCUMENT: version %', i;
    end if;
    perform garage_building_validate_scope(p_doc->'floors', v->'rooms', v->'windows', 'version ' || i);
  end loop;
end $$;

-- ── RPC: list / get / save ───────────────────────────────────────────────
create or replace function garage_building_list(p_actor_id text)
returns table (document jsonb, revision integer, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  actor_role text := garage_building_actor_role(p_actor_id);
begin
  return query
    select g.document, g.revision, g.created_at, g.updated_at
    from garage_building_projects g
    where garage_building_can_edit(g.owner_id, actor_role, p_actor_id)
    order by g.updated_at desc;
end $$;

create or replace function garage_building_get(p_id text, p_actor_id text)
returns table (document jsonb, revision integer, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  actor_role text := garage_building_actor_role(p_actor_id);
  g garage_building_projects;
begin
  select * into g from garage_building_projects where id = p_id;
  if not found then return; end if;
  if not garage_building_can_edit(g.owner_id, actor_role, p_actor_id) then raise exception 'NOT_ALLOWED'; end if;
  return query select g.document, g.revision, g.created_at, g.updated_at;
end $$;

create or replace function garage_building_save(p_document jsonb, p_expected_revision integer, p_actor_id text)
returns table (document jsonb, revision integer, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text := garage_building_actor_role(p_actor_id);
  doc_id text := p_document->>'id';
  g garage_building_projects;
  old_n int; i int;
  ts timestamptz := now();
  stored jsonb;
begin
  perform garage_building_validate(p_document);
  select * into g from garage_building_projects where id = doc_id for update;

  if not found then
    if p_expected_revision <> 0 then raise exception 'REVISION_CONFLICT'; end if;
    if p_document->>'ownerId' <> p_actor_id or not garage_building_can_edit(p_actor_id, actor_role, p_actor_id) then
      raise exception 'NOT_ALLOWED';
    end if;
    stored := p_document || jsonb_build_object('revision', 1, 'createdAt', ts, 'updatedAt', ts);
    insert into garage_building_projects (id, owner_id, document, revision, created_at, updated_at)
    values (doc_id, p_actor_id, stored, 1, ts, ts)
    on conflict (id) do nothing;
    -- Someone created the same id between our check and insert.
    if not found then raise exception 'REVISION_CONFLICT'; end if;
    return query select stored, 1, ts, ts;
    return;
  end if;

  if not garage_building_can_edit(g.owner_id, actor_role, p_actor_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_document->>'ownerId' <> g.owner_id then raise exception 'NOT_ALLOWED'; end if;
  if g.revision <> p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;

  -- Saved quote versions are append-only.
  old_n := jsonb_array_length(g.document->'versions');
  if jsonb_array_length(p_document->'versions') < old_n then raise exception 'VERSION_IMMUTABLE'; end if;
  for i in 0 .. old_n - 1 loop
    if (g.document->'versions'->i) <> (p_document->'versions'->i) then raise exception 'VERSION_IMMUTABLE'; end if;
  end loop;

  stored := p_document || jsonb_build_object('revision', g.revision + 1, 'createdAt', g.created_at, 'updatedAt', ts);
  update garage_building_projects
     set document = stored, revision = g.revision + 1, updated_at = ts
   where id = doc_id;
  return query select stored, g.revision + 1, g.created_at, ts;
end $$;

-- Keep helpers internal and deny direct browser execution. Only a trusted
-- server with a verified staff session may invoke the public building RPCs.
revoke all on function garage_building_actor_role(text) from public, anon, authenticated;
revoke all on function garage_building_can_edit(text, text, text) from public, anon, authenticated;
revoke all on function garage_building_positive(jsonb, numeric) from public, anon, authenticated;
revoke all on function garage_building_validate_scope(jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function garage_building_validate(jsonb) from public, anon, authenticated;
revoke all on function garage_building_list(text) from public, anon, authenticated;
revoke all on function garage_building_get(text, text) from public, anon, authenticated;
revoke all on function garage_building_save(jsonb, integer, text) from public, anon, authenticated;
grant execute on function garage_building_list(text) to service_role;
grant execute on function garage_building_get(text, text) to service_role;
grant execute on function garage_building_save(jsonb, integer, text) to service_role;
