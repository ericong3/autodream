-- Start Installation: installer_assigned -> in_progress. Requires
-- 20260930010000_garage_work_order_status.sql (work_status) to have run.
--
-- The job's own status stays 'accepted' while work is underway — started_at
-- being set is what separates "assigned" from "in progress" on the job; the
-- work order's work_status carries the stage everyone reads.
alter table garage_installer_jobs add column if not exists started_at timestamptz;

-- Same pattern as accept_garage_installer_job: the UPDATE only matches an
-- accepted job that hasn't been started, so a double tap (or two devices)
-- can't overwrite the first start time — the second call gets
-- JOB_ALREADY_STARTED. Job and work order change in one transaction.
create or replace function start_garage_installer_job(p_job_id text)
returns garage_installer_jobs
language plpgsql
as $$
declare
  result garage_installer_jobs;
begin
  update garage_installer_jobs
  set started_at = now()
  where id = p_job_id
    and status = 'accepted'
    and started_at is null
  returning * into result;

  if not found then
    if exists (select 1 from garage_installer_jobs where id = p_job_id and started_at is not null) then
      raise exception 'JOB_ALREADY_STARTED';
    end if;
    if exists (select 1 from garage_installer_jobs where id = p_job_id) then
      raise exception 'JOB_NOT_ASSIGNED';
    end if;
    raise exception 'JOB_NOT_FOUND';
  end if;

  update garage_invoices
  set work_status = 'in_progress'
  where id = result.invoice_id
    and work_status = 'installer_assigned';

  return result;
end;
$$;
