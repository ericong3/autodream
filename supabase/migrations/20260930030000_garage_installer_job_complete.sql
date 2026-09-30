-- Complete Installation: in_progress -> installation completed, then on to
-- payment_due or ready_for_delivery depending on whether it's been paid.
-- Requires 20260930010000 (work_status) and 20260930020000 (started_at).
--
-- The job's status = 'completed' is the "installation completed" state
-- (the installer's task is done); the work order itself moves straight on
-- to the salesman's next step. The installer can never close the work
-- order — delivery, warranty and closing are salesman steps.
alter table garage_installer_jobs
  add column if not exists completed_by text references users(id),
  add column if not exists final_inspection_at timestamptz;

-- Refuses unless the job is actually underway and every glass item on the
-- order has been confirmed installed — checked here, not just in the app,
-- so a stale screen or second device can't complete a half-done job.
-- Items still carrying the pre-split grouped positions ('door_window',
-- 'rear_panel_window') are ignored; the order's individual glass replaced
-- them.
create or replace function complete_garage_installer_job(
  p_job_id text, p_completed_by text, p_remark text, p_final_inspection_done boolean
)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
  result garage_installer_jobs;
  inv_work_status text;
  inv_payment_status text;
begin
  if p_final_inspection_done is not true then
    raise exception 'FINAL_INSPECTION_REQUIRED';
  end if;

  -- Lock the job so two completes can't interleave.
  select * into j from garage_installer_jobs where id = p_job_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;
  if j.status = 'completed' then
    raise exception 'JOB_ALREADY_COMPLETED';
  end if;

  select work_status, payment_status into inv_work_status, inv_payment_status
  from garage_invoices where id = j.invoice_id for update;

  -- Jobs accepted before Start Installation existed have no started_at but
  -- were backfilled to in_progress.
  if j.status <> 'accepted' or (j.started_at is null and inv_work_status <> 'in_progress') then
    raise exception 'JOB_NOT_STARTED';
  end if;

  if not exists (
    select 1 from garage_tint_installation_pieces
    where invoice_id = j.invoice_id and position not in ('door_window', 'rear_panel_window')
  ) or exists (
    select 1 from garage_tint_installation_pieces
    where invoice_id = j.invoice_id
      and position not in ('door_window', 'rear_panel_window')
      and status <> 'installed'
  ) then
    raise exception 'GLASS_NOT_ALL_CONFIRMED';
  end if;

  update garage_installer_jobs
  set status = 'completed',
      completed_at = now(),
      completed_by = p_completed_by,
      final_inspection_at = now(),
      remark = nullif(trim(p_remark), '')
  where id = p_job_id
  returning * into result;

  update garage_invoices
  set work_status = case when inv_payment_status = 'paid' then 'ready_for_delivery' else 'payment_due' end
  where id = j.invoice_id
    and work_status in ('installer_assigned', 'in_progress');

  return result;
end;
$$;
