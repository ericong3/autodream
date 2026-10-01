-- Two ways an unclaimed installer job gets its installer:
--   • Accept — an installer takes it themselves (accept_garage_installer_job)
--   • Assign — Garage Head / Director / Shareholder gives it to a chosen
--     installer (assign_garage_installer_job)
-- Managers never "accept as themselves"; they assign. Both paths claim the
-- job with the same conditional update (only while it's pending and
-- unassigned), so whichever lands first wins and the other is refused.
-- Requires 20261001030000_garage_installation_permissions.sql.

-- Who assigned the job (a manager), when it wasn't self-accepted.
-- accepted_by is always the installer doing the work either way.
alter table garage_installer_jobs
  add column if not exists assigned_by text references users(id);

alter table garage_work_order_activity drop constraint if exists garage_work_order_activity_event_type_check;
alter table garage_work_order_activity add constraint garage_work_order_activity_event_type_check
  check (event_type in (
    'WORK_ORDER_CREATED', 'SENT_TO_INSTALLER', 'INSTALLER_ACCEPTED', 'INSTALLER_ASSIGNED', 'INSTALLATION_STARTED',
    'GLASS_ITEM_COMPLETED', 'GLASS_ITEM_REOPENED', 'INSTALLATION_COMPLETED', 'PAYMENT_COLLECTED',
    'VEHICLE_READY', 'VEHICLE_DELIVERED', 'WARRANTY_REGISTERED', 'WORK_ORDER_CLOSED'
  ));

-- The claim itself, shared by Accept and Assign: only succeeds while the
-- job is still pending and unassigned (Postgres re-checks that condition
-- after waiting on a concurrent claim's row lock), and moves the work order
-- to installer_assigned in the same transaction.
create or replace function garage_claim_installer_job(
  p_job_id text, p_installer_id text, p_estimated_complete_at timestamptz, p_assigned_by text
)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
  result garage_installer_jobs;
begin
  perform garage_lifecycle_begin();
  if not garage_is_workshop(p_installer_id) then raise exception 'NOT_AN_INSTALLER'; end if;

  select * into j from garage_installer_jobs where id = p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if j.status <> 'pending' or j.accepted_by is not null then raise exception 'JOB_ALREADY_ACCEPTED'; end if;
  perform garage_require_stage(j.invoice_id, array['waiting_for_installer'], 'NOT_WAITING_FOR_INSTALLER');

  update garage_installer_jobs
  set status = 'accepted', accepted_by = p_installer_id, accepted_at = now(),
      estimated_complete_at = p_estimated_complete_at, assigned_by = p_assigned_by
  where id = p_job_id and status = 'pending' and accepted_by is null
  returning * into result;
  if not found then raise exception 'JOB_ALREADY_ACCEPTED'; end if;

  update garage_invoices set work_status = 'installer_assigned'
  where id = result.invoice_id and work_status = 'waiting_for_installer';
  return result;
end;
$$;

-- Accept: the installer takes the job themselves. Installer roles only —
-- a manager assigns instead.
create or replace function accept_garage_installer_job(
  p_job_id text, p_installer_id text, p_estimated_complete_at timestamptz
)
returns garage_installer_jobs
language plpgsql
as $$
declare
  result garage_installer_jobs;
begin
  result := garage_claim_installer_job(p_job_id, p_installer_id, p_estimated_complete_at, null);
  perform log_garage_work_order_event(result.invoice_id, 'INSTALLER_ACCEPTED', p_installer_id,
    jsonb_build_object('job_id', result.id, 'estimated_complete_at', p_estimated_complete_at));
  return result;
end;
$$;

-- Assign: a manager gives an unclaimed job to an installer. The installer
-- becomes accepted_by (so it's their job — they see it under Assigned and
-- own the installation work); the manager is recorded as assigned_by. The
-- estimated completion time is optional here.
create or replace function assign_garage_installer_job(
  p_job_id text, p_installer_id text, p_actor_id text, p_estimated_complete_at timestamptz default null
)
returns garage_installer_jobs
language plpgsql
as $$
declare
  result garage_installer_jobs;
begin
  if not garage_is_manager(p_actor_id) then raise exception 'NOT_A_MANAGER'; end if;
  result := garage_claim_installer_job(p_job_id, p_installer_id, p_estimated_complete_at, p_actor_id);
  perform log_garage_work_order_event(result.invoice_id, 'INSTALLER_ASSIGNED', p_actor_id,
    jsonb_build_object('job_id', result.id, 'installer_id', p_installer_id,
                       'estimated_complete_at', p_estimated_complete_at));
  return result;
end;
$$;

-- assigned_by joins the job fields only the pipeline functions may set.
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
    end if;
    return new;
  end if;

  if not garage_lifecycle_admin() and new.status is distinct from old.status
     and not ((old.status, new.status) in (('pending', 'accepted'), ('accepted', 'completed'))) then
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
  ) then
    raise exception 'LIFECYCLE_DIRECT_WRITE';
  end if;
  return new;
end;
$$;

-- The reconcile safety net only ever makes an allowed forward move. If an
-- order's facts point somewhere the lifecycle doesn't allow from where it
-- is (e.g. an extra job row), it leaves work_status alone rather than
-- making the write that triggered it fail.
create or replace function garage_reconcile_work_status(p_invoice_id text)
returns void
language plpgsql
as $$
declare
  current_status text;
  want text := garage_work_status_from_facts(p_invoice_id);
begin
  select work_status into current_status from garage_invoices where id = p_invoice_id;
  if want is null or want is not distinct from current_status then return; end if;
  if not garage_work_status_transition_allowed(current_status, want) then return; end if;
  perform garage_lifecycle_begin();
  update garage_invoices set work_status = want
  where id = p_invoice_id and work_status = current_status;
end;
$$;
