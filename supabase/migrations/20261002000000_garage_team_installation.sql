-- Tinted installation becomes team work, owned per glass.
--
-- A tinted car isn't owned by one installer: several installers work on
-- the same car at once, each on their own glass pieces. So:
--   • the work order belongs to the Garage team (shared queue); its
--     installation record (garage_installer_jobs, one per work order) holds
--     team-level facts — started, submitted for approval, approved/returned,
--     final inspection, overall remark, ETA (managed by management)
--   • each glass piece is owned by whoever claims it (installer_id)
--
-- Work order:  waiting_for_installer → in_progress → pending_approval
--              → payment_due | ready_for_delivery → ready_for_warranty → closed
--              (pending_approval → in_progress when management returns it)
-- Glass:       pending (available) → taken → installed
--
-- Retired for new orders: whole-car Accept / Assign / Complete and the
-- installer_assigned stage. accepted_by / accepted_at / assigned_by stay as
-- read-only history; installer_assigned stays a valid value for old rows.
--
-- Requires 20261001040000_garage_assign_installer.sql. Changes existing
-- data only to convert it to the new model (see the end of the file).

-- ── Schema ───────────────────────────────────────────────────────────────
alter table garage_installer_jobs
  add column if not exists submitted_for_approval_at timestamptz,
  add column if not exists submitted_by text references users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by text references users(id),
  add column if not exists returned_at timestamptz,
  add column if not exists returned_by text references users(id),
  add column if not exists return_reason text;

-- The installation's own status. 'accepted' only exists on old rows.
alter table garage_installer_jobs drop constraint if exists garage_installer_jobs_status_check;
alter table garage_installer_jobs add constraint garage_installer_jobs_status_check
  check (status in ('pending', 'accepted', 'in_progress', 'submitted', 'completed'));

alter table garage_tint_installation_pieces
  add column if not exists claimed_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by text references users(id),
  add column if not exists needs_correction boolean not null default false,
  add column if not exists correction_note text;

alter table garage_tint_installation_pieces drop constraint if exists garage_tint_installation_pieces_status_check;
alter table garage_tint_installation_pieces add constraint garage_tint_installation_pieces_status_check
  check (status in ('pending', 'taken', 'installed'));

create index if not exists garage_tint_installation_pieces_installer_idx
  on garage_tint_installation_pieces(installer_id);

alter table garage_invoices drop constraint if exists garage_invoices_work_status_check;
alter table garage_invoices add constraint garage_invoices_work_status_check check (work_status in (
  'draft', 'waiting_for_installer', 'installer_assigned', 'in_progress', 'pending_approval',
  'installation_completed', 'payment_due', 'ready_for_delivery', 'ready_for_warranty', 'closed'
));

alter table garage_work_order_activity drop constraint if exists garage_work_order_activity_event_type_check;
alter table garage_work_order_activity add constraint garage_work_order_activity_event_type_check
  check (event_type in (
    'WORK_ORDER_CREATED', 'SENT_TO_INSTALLER', 'INSTALLER_ACCEPTED', 'INSTALLER_ASSIGNED',
    'INSTALLATION_STARTED', 'GLASS_ITEM_CLAIMED', 'GLASS_ITEM_RELEASED', 'GLASS_ITEM_ASSIGNED',
    'GLASS_ITEM_COMPLETED', 'GLASS_ITEM_REOPENED', 'INSTALLATION_SUBMITTED', 'INSTALLATION_APPROVED',
    'INSTALLATION_RETURNED', 'INSTALLATION_COMPLETED', 'PAYMENT_COLLECTED', 'VEHICLE_READY',
    'VEHICLE_DELIVERED', 'WARRANTY_REGISTERED', 'WORK_ORDER_CLOSED'
  ));

-- ── Allowed work_status moves (new team flow + legacy) ───────────────────
create or replace function garage_work_status_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('draft', 'waiting_for_installer'),
    ('waiting_for_installer', 'in_progress'),
    ('in_progress', 'pending_approval'),
    ('pending_approval', 'in_progress'),          -- returned for correction
    ('pending_approval', 'payment_due'),
    ('pending_approval', 'ready_for_delivery'),
    ('payment_due', 'ready_for_delivery'),
    ('ready_for_delivery', 'ready_for_warranty'),
    ('ready_for_warranty', 'closed'),
    -- legacy rows only
    ('installer_assigned', 'in_progress'),
    ('installation_completed', 'payment_due'),
    ('installation_completed', 'ready_for_delivery')
  );
$$;

-- What the recorded facts say the stage is (used by the reconcile safety
-- net, which only ever applies an allowed forward move).
create or replace function garage_work_status_from_facts(p_invoice_id text)
returns text
language plpgsql
stable
as $$
declare
  inv garage_invoices;
  j garage_installer_jobs;
begin
  select * into inv from garage_invoices where id = p_invoice_id;
  if not found then return null; end if;
  if inv.work_status = 'draft' then return 'draft'; end if;
  if inv.warranty_registered_at is not null then return 'closed'; end if;
  if inv.delivered_at is not null then return 'ready_for_warranty'; end if;

  select * into j from garage_installer_jobs where invoice_id = p_invoice_id
  order by created_at desc limit 1;

  if j.status = 'completed' or inv.work_status = 'installation_completed' then
    return case when inv.payment_status = 'paid' then 'ready_for_delivery' else 'payment_due' end;
  end if;
  if j.status = 'submitted' then return 'pending_approval'; end if;
  if j.status = 'in_progress' then return 'in_progress'; end if;
  if j.status = 'accepted' then   -- legacy whole-car claim
    if j.started_at is not null or inv.work_status = 'in_progress' then return 'in_progress'; end if;
    return 'installer_assigned';
  end if;
  return 'waiting_for_installer';
end;
$$;

-- ── Guards: the new fields are pipeline-only too ─────────────────────────
create or replace function garage_job_lifecycle_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not garage_lifecycle_active() then
      new.status := 'pending';
      new.accepted_by := null; new.accepted_at := null; new.estimated_complete_at := null;
      new.assigned_by := null;
      new.started_at := null; new.completed_at := null; new.completed_by := null;
      new.final_inspection_at := null;
      new.submitted_for_approval_at := null; new.submitted_by := null;
      new.approved_at := null; new.approved_by := null;
      new.returned_at := null; new.returned_by := null; new.return_reason := null;
    end if;
    return new;
  end if;

  if not garage_lifecycle_admin() and new.status is distinct from old.status
     and not ((old.status, new.status) in (
       ('pending', 'in_progress'), ('accepted', 'in_progress'), ('accepted', 'submitted'),
       ('in_progress', 'submitted'), ('submitted', 'in_progress'), ('submitted', 'completed')
     )) then
    raise exception 'INVALID_JOB_TRANSITION % -> %', old.status, new.status;
  end if;

  if not garage_lifecycle_active() and (
       new.status is distinct from old.status
    or new.accepted_by is distinct from old.accepted_by
    or new.accepted_at is distinct from old.accepted_at
    or new.estimated_complete_at is distinct from old.estimated_complete_at
    or new.assigned_by is distinct from old.assigned_by
    or new.started_at is distinct from old.started_at
    or new.completed_at is distinct from old.completed_at
    or new.completed_by is distinct from old.completed_by
    or new.final_inspection_at is distinct from old.final_inspection_at
    or new.remark is distinct from old.remark
    or new.submitted_for_approval_at is distinct from old.submitted_for_approval_at
    or new.submitted_by is distinct from old.submitted_by
    or new.approved_at is distinct from old.approved_at
    or new.approved_by is distinct from old.approved_by
    or new.returned_at is distinct from old.returned_at
    or new.returned_by is distinct from old.returned_by
    or new.return_reason is distinct from old.return_reason
  ) then
    raise exception 'LIFECYCLE_DIRECT_WRITE';
  end if;
  return new;
end;
$$;

create or replace function garage_glass_item_lifecycle_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not garage_lifecycle_active() then
      new.status := 'pending';
      new.installed_series := null; new.sqft := null; new.installer_id := null; new.remark := null;
      new.claimed_at := null; new.completed_at := null; new.completed_by := null;
      new.needs_correction := false; new.correction_note := null;
    end if;
    return new;
  end if;
  if not garage_lifecycle_active() and (
       new.status is distinct from old.status
    or new.installed_series is distinct from old.installed_series
    or new.sqft is distinct from old.sqft
    or new.installer_id is distinct from old.installer_id
    or new.remark is distinct from old.remark
    or new.claimed_at is distinct from old.claimed_at
    or new.completed_at is distinct from old.completed_at
    or new.completed_by is distinct from old.completed_by
    or new.needs_correction is distinct from old.needs_correction
    or new.correction_note is distinct from old.correction_note
  ) then
    raise exception 'LIFECYCLE_DIRECT_WRITE';
  end if;
  return new;
end;
$$;

-- ── Helpers ──────────────────────────────────────────────────────────────

-- Glass pieces that count for a work order (the pre-split grouped rows
-- 'door_window' / 'rear_panel_window' were replaced by individual glass).
create or replace function garage_is_required_glass(p_position text)
returns boolean language sql immutable as $$
  select p_position not in ('door_window', 'rear_panel_window');
$$;

-- Only the glass's own installer — or management — may change it.
create or replace function garage_assert_can_work_glass(p_item garage_tint_installation_pieces, p_actor_id text)
returns void
language plpgsql
as $$
begin
  if p_actor_id is null then raise exception 'NOT_YOUR_GLASS'; end if;
  if garage_is_manager(p_actor_id) then return; end if;
  if p_item.installer_id is distinct from p_actor_id then raise exception 'NOT_YOUR_GLASS'; end if;
end;
$$;

-- Move the work order into in_progress (first claim or an explicit Start).
-- Records the team start once.
create or replace function garage_begin_installation(p_invoice_id text, p_actor_id text)
returns void
language plpgsql
as $$
declare
  inv garage_invoices;
  j garage_installer_jobs;
begin
  perform garage_lifecycle_begin();
  inv := garage_require_stage(p_invoice_id,
    array['waiting_for_installer', 'installer_assigned', 'in_progress'], 'NOT_OPEN_FOR_INSTALLATION');
  if inv.work_status = 'in_progress' then return; end if;

  select * into j from garage_installer_jobs where invoice_id = p_invoice_id
  order by created_at desc limit 1 for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;

  update garage_installer_jobs
  set status = 'in_progress', started_at = coalesce(started_at, now())
  where id = j.id;
  update garage_invoices set work_status = 'in_progress'
  where id = p_invoice_id and work_status in ('waiting_for_installer', 'installer_assigned');

  perform log_garage_work_order_event(p_invoice_id, 'INSTALLATION_STARTED', p_actor_id,
    jsonb_build_object('job_id', j.id));
end;
$$;

-- ── Team start ───────────────────────────────────────────────────────────
-- Any installer (or a manager) can start a waiting car. Claiming a glass
-- also starts it. Replaces the old owner-only start.
create or replace function start_garage_installer_job(p_job_id text, p_actor_id text)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
begin
  perform garage_lifecycle_begin();
  if not (garage_is_workshop(p_actor_id) or garage_is_manager(p_actor_id)) then raise exception 'NOT_AN_INSTALLER'; end if;
  select * into j from garage_installer_jobs where id = p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  perform garage_begin_installation(j.invoice_id, p_actor_id);
  select * into j from garage_installer_jobs where id = p_job_id;
  return j;
end;
$$;

-- ── Glass: claim / release / assign ──────────────────────────────────────

-- An installer takes an available glass. Race-safe: the UPDATE only
-- matches while the glass is still untaken; if two installers tap at the
-- same moment, Postgres row-locks it, the second UPDATE re-checks the
-- condition after the first commits, matches nothing, and is refused.
create or replace function claim_garage_glass_item(p_item_id text, p_actor_id text)
returns garage_tint_installation_pieces
language plpgsql
as $$
declare
  item garage_tint_installation_pieces;
  result garage_tint_installation_pieces;
begin
  perform garage_lifecycle_begin();
  if not garage_is_workshop(p_actor_id) then raise exception 'NOT_AN_INSTALLER'; end if;
  select * into item from garage_tint_installation_pieces where id = p_item_id;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if not garage_is_required_glass(item.position) then raise exception 'ITEM_NOT_FOUND'; end if;
  perform garage_begin_installation(item.invoice_id, p_actor_id);

  update garage_tint_installation_pieces
  set status = 'taken', installer_id = p_actor_id, claimed_at = now(), updated_at = now()
  where id = p_item_id and status = 'pending' and installer_id is null
  returning * into result;
  if not found then
    select * into item from garage_tint_installation_pieces where id = p_item_id;
    raise exception 'GLASS_ALREADY_TAKEN %', coalesce(item.installer_id, '');
  end if;

  perform log_garage_work_order_event(result.invoice_id, 'GLASS_ITEM_CLAIMED', p_actor_id,
    jsonb_build_object('item_id', result.id, 'glass_position', result.position));
  return result;
end;
$$;

-- Hand a taken (not yet installed) glass back to the pool. Film already
-- logged on it has to be cleared first so stock stays right.
create or replace function release_garage_glass_item(p_item_id text, p_actor_id text)
returns garage_tint_installation_pieces
language plpgsql
as $$
declare
  item garage_tint_installation_pieces;
  result garage_tint_installation_pieces;
begin
  perform garage_lifecycle_begin();
  select * into item from garage_tint_installation_pieces where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  perform garage_require_stage(item.invoice_id, array['in_progress'], 'NOT_IN_PROGRESS');
  perform garage_assert_can_work_glass(item, p_actor_id);
  if item.status <> 'taken' then raise exception 'GLASS_NOT_TAKEN'; end if;
  if coalesce(item.sqft, 0) > 0 then raise exception 'GLASS_HAS_FILM_LOGGED'; end if;

  update garage_tint_installation_pieces
  set status = 'pending', installer_id = null, claimed_at = null, updated_at = now()
  where id = p_item_id returning * into result;

  perform log_garage_work_order_event(result.invoice_id, 'GLASS_ITEM_RELEASED', p_actor_id,
    jsonb_build_object('item_id', result.id, 'glass_position', result.position, 'from_installer', item.installer_id));
  return result;
end;
$$;

-- Management assigns, reassigns or clears a glass's installer. An installed
-- glass keeps its status (the credit moves); an available one becomes taken.
create or replace function assign_garage_glass_item(p_item_id text, p_installer_id text, p_actor_id text)
returns garage_tint_installation_pieces
language plpgsql
as $$
declare
  item garage_tint_installation_pieces;
  result garage_tint_installation_pieces;
begin
  perform garage_lifecycle_begin();
  if not garage_is_manager(p_actor_id) then raise exception 'NOT_A_MANAGER'; end if;
  if p_installer_id is not null and not garage_is_workshop(p_installer_id) then raise exception 'NOT_AN_INSTALLER'; end if;
  select * into item from garage_tint_installation_pieces where id = p_item_id for update;
  if not found or not garage_is_required_glass(item.position) then raise exception 'ITEM_NOT_FOUND'; end if;
  perform garage_begin_installation(item.invoice_id, p_actor_id);
  perform garage_require_stage(item.invoice_id, array['in_progress'], 'NOT_IN_PROGRESS');
  if p_installer_id is null and coalesce(item.sqft, 0) > 0 and item.status <> 'installed' then
    raise exception 'GLASS_HAS_FILM_LOGGED';
  end if;

  update garage_tint_installation_pieces
  set installer_id = p_installer_id,
      status = case when p_installer_id is null and status = 'taken' then 'pending'
                    when p_installer_id is not null and status = 'pending' then 'taken'
                    else status end,
      claimed_at = case when p_installer_id is null then null
                        when installer_id is distinct from p_installer_id then now()
                        else claimed_at end,
      updated_at = now()
  where id = p_item_id returning * into result;

  perform log_garage_work_order_event(result.invoice_id, 'GLASS_ITEM_ASSIGNED', p_actor_id,
    jsonb_build_object('item_id', result.id, 'glass_position', result.position,
                       'from_installer', item.installer_id, 'to_installer', p_installer_id));
  return result;
end;
$$;

-- Old name for "set a glass's installer" — management only now.
create or replace function set_garage_glass_item_installer(p_item_id text, p_installer_id text, p_actor_id text)
returns garage_tint_installation_pieces
language sql
as $$ select assign_garage_glass_item(p_item_id, p_installer_id, p_actor_id); $$;

-- ── Glass: confirm installed / reopen ────────────────────────────────────
-- 'installed'  — the glass's installer (or management) confirms it.
-- 'taken'      — undo / reopen: back to its installer for more work
--                ('pending' is accepted as the old name for this).
create or replace function set_garage_glass_item_status(p_item_id text, p_status text, p_actor_id text)
returns garage_tint_installation_pieces
language plpgsql
as $$
declare
  item garage_tint_installation_pieces;
  result garage_tint_installation_pieces;
  target text := case when p_status = 'pending' then 'taken' else p_status end;
begin
  perform garage_lifecycle_begin();
  if target not in ('taken', 'installed') then raise exception 'INVALID_STATUS'; end if;
  select * into item from garage_tint_installation_pieces where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  perform garage_require_stage(item.invoice_id, array['in_progress'], 'NOT_IN_PROGRESS');
  perform garage_assert_can_work_glass(item, p_actor_id);

  if target = 'installed' then
    if item.installer_id is null then raise exception 'GLASS_NOT_TAKEN'; end if;
    if item.status = 'installed' then return item; end if;
    update garage_tint_installation_pieces
    set status = 'installed', installed_series = requested_series,
        completed_at = now(), completed_by = p_actor_id,
        needs_correction = false, correction_note = null, updated_at = now()
    where id = p_item_id returning * into result;
    perform log_garage_work_order_event(result.invoice_id, 'GLASS_ITEM_COMPLETED', p_actor_id,
      jsonb_build_object('item_id', result.id, 'glass_position', result.position,
                         'installed_series', result.installed_series, 'installer_id', result.installer_id));
  else
    if item.status <> 'installed' then return item; end if;
    update garage_tint_installation_pieces
    set status = 'taken', installed_series = null, completed_at = null, completed_by = null, updated_at = now()
    where id = p_item_id returning * into result;
    perform log_garage_work_order_event(result.invoice_id, 'GLASS_ITEM_REOPENED', p_actor_id,
      jsonb_build_object('item_id', result.id, 'glass_position', result.position));
  end if;
  return result;
end;
$$;

-- ── Glass: film usage (atomic with stock) and remark ─────────────────────
create or replace function set_garage_glass_item_sqft(p_item_id text, p_sqft numeric, p_actor_id text)
returns jsonb
language plpgsql
as $$
declare
  item garage_tint_installation_pieces;
  stock garage_film_stock;
  film_series text;
  delta numeric;
begin
  perform garage_lifecycle_begin();
  if p_sqft is null or p_sqft < 0 then raise exception 'INVALID_SQFT'; end if;
  select * into item from garage_tint_installation_pieces where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  perform garage_require_stage(item.invoice_id, array['in_progress'], 'NOT_IN_PROGRESS');
  if item.installer_id is null and not garage_is_manager(p_actor_id) then raise exception 'GLASS_NOT_TAKEN'; end if;
  perform garage_assert_can_work_glass(item, p_actor_id);

  delta := p_sqft - coalesce(item.sqft, 0);
  film_series := coalesce(item.installed_series, item.requested_series);
  if delta = 0 then
    select * into stock from garage_film_stock where series = film_series;
    return jsonb_build_object('item', to_jsonb(item), 'stock', to_jsonb(stock), 'delta', 0);
  end if;
  if film_series is null then raise exception 'NO_SERIES_FOR_GLASS'; end if;

  select * into stock from garage_film_stock where series = film_series for update;
  if not found then raise exception 'NO_FILM_STOCK %', film_series; end if;
  if delta > 0 and stock.remaining_sqft - delta < 0 then
    raise exception 'INSUFFICIENT_FILM_STOCK % has %', film_series, stock.remaining_sqft;
  end if;

  update garage_tint_installation_pieces set sqft = p_sqft, updated_at = now()
  where id = p_item_id returning * into item;
  update garage_film_stock set remaining_sqft = remaining_sqft - delta, updated_at = now()
  where series = film_series returning * into stock;
  return jsonb_build_object('item', to_jsonb(item), 'stock', to_jsonb(stock), 'delta', delta);
end;
$$;

create or replace function set_garage_glass_item_remark(p_item_id text, p_remark text, p_actor_id text)
returns garage_tint_installation_pieces
language plpgsql
as $$
declare
  item garage_tint_installation_pieces;
begin
  perform garage_lifecycle_begin();
  select * into item from garage_tint_installation_pieces where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  perform garage_require_stage(item.invoice_id, array['in_progress'], 'NOT_IN_PROGRESS');
  if item.installer_id is null and not garage_is_manager(p_actor_id) then raise exception 'GLASS_NOT_TAKEN'; end if;
  perform garage_assert_can_work_glass(item, p_actor_id);
  update garage_tint_installation_pieces set remark = nullif(trim(p_remark), ''), updated_at = now()
  where id = p_item_id returning * into item;
  return item;
end;
$$;

-- ── Estimated completion: management only, optional ──────────────────────
create or replace function set_garage_installation_eta(p_job_id text, p_eta timestamptz, p_actor_id text)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
begin
  perform garage_lifecycle_begin();
  if not garage_is_manager(p_actor_id) then raise exception 'NOT_A_MANAGER'; end if;
  select * into j from garage_installer_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  perform garage_require_stage(j.invoice_id,
    array['waiting_for_installer', 'installer_assigned', 'in_progress', 'pending_approval'], 'INSTALLATION_FINISHED');
  update garage_installer_jobs set estimated_complete_at = p_eta where id = p_job_id returning * into j;
  return j;
end;
$$;

-- ── Submit for approval ──────────────────────────────────────────────────
-- Every required glass installed; submitted by an installer who worked on
-- at least one glass of this car, or by management. Locks the glass.
create or replace function submit_garage_installation(p_job_id text, p_actor_id text)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
  result garage_installer_jobs;
begin
  perform garage_lifecycle_begin();
  select * into j from garage_installer_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  perform garage_require_stage(j.invoice_id, array['in_progress'], 'NOT_IN_PROGRESS');

  if not garage_is_manager(p_actor_id) and not exists (
    select 1 from garage_tint_installation_pieces
    where invoice_id = j.invoice_id and installer_id = p_actor_id and garage_is_required_glass(position)
  ) then
    raise exception 'NOT_ON_THIS_JOB';
  end if;

  if not exists (
    select 1 from garage_tint_installation_pieces where invoice_id = j.invoice_id and garage_is_required_glass(position)
  ) or exists (
    select 1 from garage_tint_installation_pieces
    where invoice_id = j.invoice_id and garage_is_required_glass(position) and status <> 'installed'
  ) then
    raise exception 'GLASS_NOT_ALL_CONFIRMED';
  end if;

  update garage_installer_jobs
  set status = 'submitted', submitted_for_approval_at = now(), submitted_by = p_actor_id
  where id = p_job_id returning * into result;
  update garage_invoices set work_status = 'pending_approval'
  where id = j.invoice_id and work_status = 'in_progress';

  perform log_garage_work_order_event(j.invoice_id, 'INSTALLATION_SUBMITTED', p_actor_id,
    jsonb_build_object('job_id', j.id));
  return result;
end;
$$;

-- ── Garage Head review ───────────────────────────────────────────────────
-- Approve: final inspection confirmed; installation records locked (the
-- work order leaves in_progress for good); paid → ready_for_delivery,
-- unpaid → payment_due.
create or replace function approve_garage_installation(
  p_job_id text, p_actor_id text, p_final_inspection_done boolean, p_remark text default null
)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
  inv garage_invoices;
  result garage_installer_jobs;
begin
  perform garage_lifecycle_begin();
  if not garage_is_manager(p_actor_id) then raise exception 'NOT_A_MANAGER'; end if;
  if p_final_inspection_done is not true then raise exception 'FINAL_INSPECTION_REQUIRED'; end if;
  select * into j from garage_installer_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  inv := garage_require_stage(j.invoice_id, array['pending_approval'], 'NOT_PENDING_APPROVAL');

  update garage_installer_jobs
  set status = 'completed', approved_at = now(), approved_by = p_actor_id,
      completed_at = now(), completed_by = p_actor_id, final_inspection_at = now(),
      remark = coalesce(nullif(trim(p_remark), ''), remark)
  where id = p_job_id returning * into result;
  update garage_invoices
  set work_status = case when inv.payment_status = 'paid' then 'ready_for_delivery' else 'payment_due' end
  where id = j.invoice_id and work_status = 'pending_approval';

  perform log_garage_work_order_event(j.invoice_id, 'INSTALLATION_APPROVED', p_actor_id,
    jsonb_build_object('job_id', j.id, 'remark', result.remark, 'final_inspection', true));
  if inv.payment_status = 'paid' then
    perform log_garage_work_order_event(j.invoice_id, 'VEHICLE_READY', p_actor_id, '{}'::jsonb);
  end if;
  return result;
end;
$$;

-- Return for correction: reason required; back to in_progress; the glass
-- unlocks. Optionally names the pieces that need work — those go back to
-- 'taken' (same installer) and are flagged needs_correction.
create or replace function return_garage_installation(
  p_job_id text, p_actor_id text, p_reason text, p_item_ids text[] default null
)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
  result garage_installer_jobs;
begin
  perform garage_lifecycle_begin();
  if not garage_is_manager(p_actor_id) then raise exception 'NOT_A_MANAGER'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'RETURN_REASON_REQUIRED'; end if;
  select * into j from garage_installer_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  perform garage_require_stage(j.invoice_id, array['pending_approval'], 'NOT_PENDING_APPROVAL');

  update garage_installer_jobs
  set status = 'in_progress', returned_at = now(), returned_by = p_actor_id, return_reason = trim(p_reason)
  where id = p_job_id returning * into result;
  update garage_invoices set work_status = 'in_progress'
  where id = j.invoice_id and work_status = 'pending_approval';

  if p_item_ids is not null and array_length(p_item_ids, 1) > 0 then
    update garage_tint_installation_pieces
    set status = case when installer_id is null then 'pending' else 'taken' end,
        installed_series = null, completed_at = null, completed_by = null,
        needs_correction = true, correction_note = trim(p_reason), updated_at = now()
    where invoice_id = j.invoice_id and id = any (p_item_ids);
  end if;

  perform log_garage_work_order_event(j.invoice_id, 'INSTALLATION_RETURNED', p_actor_id,
    jsonb_build_object('job_id', j.id, 'reason', trim(p_reason), 'item_ids', to_jsonb(coalesce(p_item_ids, array[]::text[]))));
  return result;
end;
$$;

-- ── Retired whole-car steps ──────────────────────────────────────────────
-- Refused with a clear code so an out-of-date copy of the app can't use
-- the one-installer-owns-the-car model.
create or replace function accept_garage_installer_job(
  p_job_id text, p_installer_id text, p_estimated_complete_at timestamptz
)
returns garage_installer_jobs language plpgsql as $$
begin raise exception 'WHOLE_CAR_ACCEPT_RETIRED'; end;
$$;

create or replace function assign_garage_installer_job(
  p_job_id text, p_installer_id text, p_actor_id text, p_estimated_complete_at timestamptz default null
)
returns garage_installer_jobs language plpgsql as $$
begin raise exception 'WHOLE_CAR_ACCEPT_RETIRED'; end;
$$;

create or replace function complete_garage_installer_job(
  p_job_id text, p_completed_by text, p_remark text, p_final_inspection_done boolean
)
returns garage_installer_jobs language plpgsql as $$
begin raise exception 'USE_SUBMIT_FOR_APPROVAL'; end;
$$;

-- ── Convert existing data to the team model ──────────────────────────────
-- Run with the admin override (this transaction only) so the conversions
-- below get past the direct-write guards.
select set_config('garage.lifecycle_admin', 'on', true);

-- Glass that already has an installer but isn't installed was, in effect,
-- taken by them.
update garage_tint_installation_pieces
set status = 'taken', claimed_at = coalesce(claimed_at, updated_at)
where status = 'pending' and installer_id is not null and garage_is_required_glass(position);

-- Installed glass: record who/when it was completed from what we have.
update garage_tint_installation_pieces
set completed_at = coalesce(completed_at, updated_at), completed_by = coalesce(completed_by, installer_id)
where status = 'installed' and completed_at is null;

-- Legacy whole-car claims that never started go back to the team queue —
-- accepted_by stays as history.
update garage_invoices i
set work_status = 'waiting_for_installer'
where i.work_status = 'installer_assigned'
  and exists (select 1 from garage_installer_jobs j where j.invoice_id = i.id and j.started_at is null);
update garage_installer_jobs j
set status = 'pending'
where j.status = 'accepted'
  and exists (select 1 from garage_invoices i where i.id = j.invoice_id and i.work_status = 'waiting_for_installer');

-- Legacy accepted jobs that are underway carry on as team installations.
update garage_installer_jobs j
set status = 'in_progress'
where j.status = 'accepted'
  and exists (select 1 from garage_invoices i where i.id = j.invoice_id and i.work_status = 'in_progress');

select set_config('garage.lifecycle_admin', '', true);

-- ── Payment can also be collected while the installation awaits approval ─
create or replace function mark_garage_work_order_paid(p_invoice_id text, p_actor_id text, p_method text)
returns garage_invoices
language plpgsql
as $$
declare
  inv garage_invoices;
  result garage_invoices;
begin
  perform garage_lifecycle_begin();
  perform assert_not_installer(p_actor_id);
  if (select payment_status from garage_invoices where id = p_invoice_id) = 'paid' then
    raise exception 'ALREADY_PAID';
  end if;
  inv := garage_require_stage(p_invoice_id,
    array['waiting_for_installer', 'installer_assigned', 'in_progress', 'pending_approval', 'payment_due'],
    'CANNOT_TAKE_PAYMENT');

  update garage_invoices
  set payment_status = 'paid', paid_at = now(), paid_by = p_actor_id,
      payment_method = coalesce(p_method, payment_method),
      work_status = case when work_status = 'payment_due' then 'ready_for_delivery' else work_status end
  where id = p_invoice_id and payment_status = 'pending'
  returning * into result;
  if not found then raise exception 'ALREADY_PAID'; end if;

  perform log_garage_work_order_event(p_invoice_id, 'PAYMENT_COLLECTED', p_actor_id,
    jsonb_build_object('method', p_method));
  if inv.work_status = 'payment_due' then
    perform log_garage_work_order_event(p_invoice_id, 'VEHICLE_READY', p_actor_id, '{}'::jsonb);
  end if;
  return result;
end;
$$;
