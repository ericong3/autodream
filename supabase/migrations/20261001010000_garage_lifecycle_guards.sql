-- Enforce the work-order lifecycle inside the database, not just the UI.
-- Requires 20261001000000_garage_work_status_reconcile.sql.
--
--   waiting_for_installer → installer_assigned → in_progress
--   → payment_due | ready_for_delivery → ready_for_delivery
--   → ready_for_warranty → closed          (closed is final)
--
-- 1. Every pipeline function checks the work order is in the right stage
--    before acting.
-- 2. Lifecycle fields (work_status, payment/delivery/warranty facts, the
--    installer job's progress, a glass item's completion) can only change
--    inside those functions. A direct UPDATE from a client — an out-of-date
--    cached copy of the app, or anyone with the public API key — is refused.
--    Ordinary edits (receipt upload, a glass's installer / sqft / remark)
--    stay open.
-- 3. Every work_status change must follow the path above, whoever makes it.
--
-- Hand corrections in the SQL Editor: run them in a transaction after
--   select set_config('garage.lifecycle_admin', 'on', true);
-- which lifts both the direct-write block and the transition check for
-- that transaction only. (Clients can't call set_config through the API.)
--
-- No existing data is changed.

-- ── Who is allowed to touch lifecycle fields ─────────────────────────────
create or replace function garage_lifecycle_begin()
returns void language sql as $$
  select set_config('garage.lifecycle', 'on', true);
$$;

create or replace function garage_lifecycle_active()
returns boolean language sql stable as $$
  select coalesce(current_setting('garage.lifecycle', true), '') = 'on'
      or coalesce(current_setting('garage.lifecycle_admin', true), '') = 'on';
$$;

create or replace function garage_lifecycle_admin()
returns boolean language sql stable as $$
  select coalesce(current_setting('garage.lifecycle_admin', true), '') = 'on';
$$;

-- The only work_status moves that exist.
create or replace function garage_work_status_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('draft', 'waiting_for_installer'),
    ('waiting_for_installer', 'installer_assigned'),
    ('installer_assigned', 'in_progress'),
    ('in_progress', 'installation_completed'),
    ('in_progress', 'payment_due'),
    ('in_progress', 'ready_for_delivery'),
    ('installation_completed', 'payment_due'),
    ('installation_completed', 'ready_for_delivery'),
    ('payment_due', 'ready_for_delivery'),
    ('ready_for_delivery', 'ready_for_warranty'),
    ('ready_for_warranty', 'closed')
  );
$$;

-- ── Guards on garage_invoices ────────────────────────────────────────────
create or replace function garage_invoice_lifecycle_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not garage_lifecycle_active() then
      -- A new work order always starts at the beginning, whatever a client sends.
      if new.work_status is distinct from 'draft' then new.work_status := 'waiting_for_installer'; end if;
      new.delivered_at := null; new.delivered_by := null;
      new.warranty_registered_at := null; new.warranty_registered_by := null;
      if new.payment_status is distinct from 'paid' then new.paid_at := null; new.paid_by := null; end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Only an order nobody has started on can be removed (Confirm's own
    -- rollback, straight after creating it).
    if not garage_lifecycle_admin() and old.work_status not in ('waiting_for_installer', 'draft') then
      raise exception 'WORK_ORDER_ALREADY_STARTED';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.work_status is distinct from old.work_status and not garage_lifecycle_admin() then
    if old.work_status = 'closed' then
      raise exception 'WORK_ORDER_CLOSED';
    end if;
    if not garage_work_status_transition_allowed(old.work_status, new.work_status) then
      raise exception 'INVALID_TRANSITION % -> %', old.work_status, new.work_status;
    end if;
  end if;

  if not garage_lifecycle_active() and (
       new.work_status is distinct from old.work_status
    or new.payment_status is distinct from old.payment_status
    or new.payment_method is distinct from old.payment_method
    or new.paid_at is distinct from old.paid_at
    or new.paid_by is distinct from old.paid_by
    or new.delivered_at is distinct from old.delivered_at
    or new.delivered_by is distinct from old.delivered_by
    or new.warranty_registered_at is distinct from old.warranty_registered_at
    or new.warranty_registered_by is distinct from old.warranty_registered_by
  ) then
    raise exception 'LIFECYCLE_DIRECT_WRITE';
  end if;
  return new;
end;
$$;

drop trigger if exists garage_invoice_lifecycle_guard on garage_invoices;
create trigger garage_invoice_lifecycle_guard
  before insert or update or delete on garage_invoices
  for each row execute function garage_invoice_lifecycle_guard();

-- ── Guards on garage_installer_jobs ──────────────────────────────────────
create or replace function garage_job_lifecycle_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not garage_lifecycle_active() then
      new.status := 'pending';
      new.accepted_by := null; new.accepted_at := null; new.estimated_complete_at := null;
      new.started_at := null; new.completed_at := null; new.completed_by := null;
      new.final_inspection_at := null;
    end if;
    return new;
  end if;

  -- UPDATE: a job only moves forward.
  if not garage_lifecycle_admin() and new.status is distinct from old.status
     and not ((old.status, new.status) in (('pending', 'accepted'), ('accepted', 'completed'))) then
    raise exception 'INVALID_JOB_TRANSITION % -> %', old.status, new.status;
  end if;

  if not garage_lifecycle_active() and (
       new.status is distinct from old.status
    or new.accepted_by is distinct from old.accepted_by
    or new.accepted_at is distinct from old.accepted_at
    or new.estimated_complete_at is distinct from old.estimated_complete_at
    or new.started_at is distinct from old.started_at
    or new.completed_at is distinct from old.completed_at
    or new.completed_by is distinct from old.completed_by
    or new.final_inspection_at is distinct from old.final_inspection_at
    or new.remark is distinct from old.remark
  ) then
    raise exception 'LIFECYCLE_DIRECT_WRITE';
  end if;
  return new;
end;
$$;

drop trigger if exists garage_job_lifecycle_guard on garage_installer_jobs;
create trigger garage_job_lifecycle_guard
  before insert or update on garage_installer_jobs
  for each row execute function garage_job_lifecycle_guard();

-- ── Guards on glass items ────────────────────────────────────────────────
-- Completion (status / installed series) goes through
-- set_garage_glass_item_status; installer, sqft and remark stay editable.
create or replace function garage_glass_item_lifecycle_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not garage_lifecycle_active() then
      new.status := 'pending';
      new.installed_series := null;
    end if;
    return new;
  end if;
  if not garage_lifecycle_active() and (
       new.status is distinct from old.status
    or new.installed_series is distinct from old.installed_series
  ) then
    raise exception 'LIFECYCLE_DIRECT_WRITE';
  end if;
  return new;
end;
$$;

drop trigger if exists garage_glass_item_lifecycle_guard on garage_tint_installation_pieces;
create trigger garage_glass_item_lifecycle_guard
  before insert or update on garage_tint_installation_pieces
  for each row execute function garage_glass_item_lifecycle_guard();

-- ── The reconcile helper is a sanctioned path too ────────────────────────
create or replace function garage_reconcile_work_status(p_invoice_id text)
returns void
language plpgsql
as $$
declare
  want text := garage_work_status_from_facts(p_invoice_id);
begin
  if want is not null then
    perform garage_lifecycle_begin();
    update garage_invoices set work_status = want
    where id = p_invoice_id and work_status is distinct from want;
  end if;
end;
$$;

-- Stage check used by every pipeline step.
create or replace function garage_require_stage(p_invoice_id text, p_expected text[], p_error text)
returns garage_invoices
language plpgsql
as $$
declare
  inv garage_invoices;
begin
  select * into inv from garage_invoices where id = p_invoice_id for update;
  if not found then raise exception 'WORK_ORDER_NOT_FOUND'; end if;
  if not (inv.work_status = any (p_expected)) then
    raise exception '% (work order is %)', p_error, inv.work_status;
  end if;
  return inv;
end;
$$;

-- ── Installer steps ──────────────────────────────────────────────────────

-- Accept: only while the work order is waiting for an installer.
create or replace function accept_garage_installer_job(
  p_job_id text, p_installer_id text, p_estimated_complete_at timestamptz
)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
  result garage_installer_jobs;
begin
  perform garage_lifecycle_begin();
  select * into j from garage_installer_jobs where id = p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if j.status <> 'pending' or j.accepted_by is not null then raise exception 'JOB_ALREADY_ACCEPTED'; end if;
  perform garage_require_stage(j.invoice_id, array['waiting_for_installer'], 'NOT_WAITING_FOR_INSTALLER');

  update garage_installer_jobs
  set status = 'accepted', accepted_by = p_installer_id, accepted_at = now(),
      estimated_complete_at = p_estimated_complete_at
  where id = p_job_id and status = 'pending' and accepted_by is null
  returning * into result;
  -- Lost a race to another installer between the check and the update.
  if not found then raise exception 'JOB_ALREADY_ACCEPTED'; end if;

  update garage_invoices set work_status = 'installer_assigned'
  where id = result.invoice_id and work_status = 'waiting_for_installer';

  perform log_garage_work_order_event(result.invoice_id, 'INSTALLER_ACCEPTED', p_installer_id,
    jsonb_build_object('job_id', result.id, 'estimated_complete_at', p_estimated_complete_at));
  return result;
end;
$$;

-- Start: only from installer_assigned.
create or replace function start_garage_installer_job(p_job_id text, p_actor_id text)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
  result garage_installer_jobs;
begin
  perform garage_lifecycle_begin();
  select * into j from garage_installer_jobs where id = p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if j.started_at is not null then raise exception 'JOB_ALREADY_STARTED'; end if;
  if j.status <> 'accepted' then raise exception 'JOB_NOT_ASSIGNED'; end if;
  perform garage_require_stage(j.invoice_id, array['installer_assigned'], 'NOT_INSTALLER_ASSIGNED');

  update garage_installer_jobs set started_at = now()
  where id = p_job_id and status = 'accepted' and started_at is null
  returning * into result;
  if not found then raise exception 'JOB_ALREADY_STARTED'; end if;

  update garage_invoices set work_status = 'in_progress'
  where id = result.invoice_id and work_status = 'installer_assigned';

  perform log_garage_work_order_event(result.invoice_id, 'INSTALLATION_STARTED', p_actor_id,
    jsonb_build_object('job_id', result.id));
  return result;
end;
$$;

-- Confirm / reopen one glass: only while the installation is in progress.
create or replace function set_garage_glass_item_status(p_item_id text, p_status text, p_actor_id text)
returns garage_tint_installation_pieces
language plpgsql
as $$
declare
  item garage_tint_installation_pieces;
  result garage_tint_installation_pieces;
  actor_role text := (select role from users where id = p_actor_id);
begin
  perform garage_lifecycle_begin();
  if p_status not in ('pending', 'installed') then raise exception 'INVALID_STATUS'; end if;
  select * into item from garage_tint_installation_pieces where id = p_item_id;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  perform garage_require_stage(item.invoice_id, array['in_progress'], 'NOT_IN_PROGRESS');

  update garage_tint_installation_pieces
  set status = p_status,
      installed_series = case when p_status = 'installed' then requested_series else null end,
      installer_id = case
        when p_status = 'installed' and installer_id is null and actor_role = 'garage_installer' then p_actor_id
        else installer_id end,
      updated_at = now()
  where id = p_item_id and status <> p_status
  returning * into result;

  if not found then
    return item;  -- already in that state: no change, no event
  end if;

  perform log_garage_work_order_event(result.invoice_id,
    case when p_status = 'installed' then 'GLASS_ITEM_COMPLETED' else 'GLASS_ITEM_REOPENED' end,
    p_actor_id,
    jsonb_build_object('item_id', result.id, 'glass_position', result.position, 'installed_series', result.installed_series));
  return result;
end;
$$;

-- Complete: only from in_progress. Paid → ready_for_delivery,
-- unpaid → payment_due.
create or replace function complete_garage_installer_job(
  p_job_id text, p_completed_by text, p_remark text, p_final_inspection_done boolean
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
  if p_final_inspection_done is not true then raise exception 'FINAL_INSPECTION_REQUIRED'; end if;

  select * into j from garage_installer_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if j.status = 'completed' then raise exception 'JOB_ALREADY_COMPLETED'; end if;

  select * into inv from garage_invoices where id = j.invoice_id for update;
  if j.status <> 'accepted' or inv.work_status <> 'in_progress' then
    raise exception 'JOB_NOT_STARTED';
  end if;

  if not exists (
    select 1 from garage_tint_installation_pieces
    where invoice_id = j.invoice_id and position not in ('door_window', 'rear_panel_window')
  ) or exists (
    select 1 from garage_tint_installation_pieces
    where invoice_id = j.invoice_id and position not in ('door_window', 'rear_panel_window') and status <> 'installed'
  ) then
    raise exception 'GLASS_NOT_ALL_CONFIRMED';
  end if;

  update garage_installer_jobs
  set status = 'completed', completed_at = now(), completed_by = p_completed_by,
      final_inspection_at = now(), remark = nullif(trim(p_remark), '')
  where id = p_job_id
  returning * into result;

  update garage_invoices
  set work_status = case when inv.payment_status = 'paid' then 'ready_for_delivery' else 'payment_due' end
  where id = j.invoice_id and work_status = 'in_progress';

  perform log_garage_work_order_event(j.invoice_id, 'INSTALLATION_COMPLETED', p_completed_by,
    jsonb_build_object('job_id', j.id, 'remark', result.remark, 'final_inspection', true));
  if inv.payment_status = 'paid' then
    perform log_garage_work_order_event(j.invoice_id, 'VEHICLE_READY', p_completed_by, '{}'::jsonb);
  end if;
  return result;
end;
$$;

-- ── Salesman steps ───────────────────────────────────────────────────────

-- Payment: allowed any time before delivery. From payment_due it moves the
-- order to ready_for_delivery; earlier (Pay Later settled up front) it only
-- records the payment — the installation still has to happen.
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
  -- Already paid is the clearer answer, whatever stage the order is in.
  if (select payment_status from garage_invoices where id = p_invoice_id) = 'paid' then
    raise exception 'ALREADY_PAID';
  end if;
  inv := garage_require_stage(p_invoice_id,
    array['waiting_for_installer', 'installer_assigned', 'in_progress', 'payment_due'], 'CANNOT_TAKE_PAYMENT');

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

-- Delivery: only from ready_for_delivery (installed and paid).
create or replace function deliver_garage_work_order(p_invoice_id text, p_actor_id text)
returns garage_invoices
language plpgsql
as $$
declare
  result garage_invoices;
begin
  perform garage_lifecycle_begin();
  perform assert_not_installer(p_actor_id);
  perform garage_require_stage(p_invoice_id, array['ready_for_delivery'], 'NOT_READY_FOR_DELIVERY');

  update garage_invoices
  set delivered_at = now(), delivered_by = p_actor_id, work_status = 'ready_for_warranty'
  where id = p_invoice_id and work_status = 'ready_for_delivery'
  returning * into result;

  perform log_garage_work_order_event(p_invoice_id, 'VEHICLE_DELIVERED', p_actor_id, '{}'::jsonb);
  return result;
end;
$$;

-- Warranty: only from ready_for_warranty; closes the work order for good.
create or replace function register_garage_work_order_warranty(p_invoice_id text, p_actor_id text)
returns garage_invoices
language plpgsql
as $$
declare
  result garage_invoices;
begin
  perform garage_lifecycle_begin();
  perform assert_not_installer(p_actor_id);
  perform garage_require_stage(p_invoice_id, array['ready_for_warranty'], 'NOT_READY_FOR_WARRANTY');

  update garage_invoices
  set warranty_registered_at = now(), warranty_registered_by = p_actor_id, work_status = 'closed'
  where id = p_invoice_id and work_status = 'ready_for_warranty'
  returning * into result;

  perform log_garage_work_order_event(p_invoice_id, 'WARRANTY_REGISTERED', p_actor_id, '{}'::jsonb);
  perform log_garage_work_order_event(p_invoice_id, 'WORK_ORDER_CLOSED', p_actor_id, '{}'::jsonb);
  return result;
end;
$$;
