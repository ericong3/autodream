-- One stored status per work order (the invoice IS the work order), instead
-- of deriving it on the fly from the installer job + invoice timestamps.
-- Salesman, installer and management all read this same value.
--
-- Full lifecycle, so later steps don't need another constraint change:
--   draft -> waiting_for_installer -> installer_assigned -> in_progress
--   -> installation_completed -> payment_due | ready_for_delivery
--   -> ready_for_warranty -> closed
-- Only waiting_for_installer -> installer_assigned is driven by this
-- status so far (accept_garage_installer_job below); the later steps still
-- come from the existing job/invoice fields until they're moved over.
alter table garage_invoices
  add column if not exists work_status text not null default 'waiting_for_installer';

-- Existing orders: map what each one's data says today onto the new status.
-- Jobs accepted before "Start Installation" existed were already being
-- worked on, so they land in in_progress rather than installer_assigned.
update garage_invoices i
set work_status = case
  when i.warranty_registered_at is not null then 'closed'
  when i.delivered_at is not null then 'ready_for_warranty'
  when j.status = 'completed' and i.payment_status = 'paid' then 'ready_for_delivery'
  when j.status = 'completed' then 'payment_due'
  when j.status = 'accepted' then 'in_progress'
  else 'waiting_for_installer'
end
from garage_invoices i2
left join garage_installer_jobs j on j.invoice_id = i2.id
where i2.id = i.id;

alter table garage_invoices
  add constraint garage_invoices_work_status_check check (work_status in (
    'draft', 'waiting_for_installer', 'installer_assigned', 'in_progress',
    'installation_completed', 'payment_due', 'ready_for_delivery',
    'ready_for_warranty', 'closed'
  ));

create index if not exists garage_invoices_work_status_idx on garage_invoices(work_status);

-- What the installer needs to know before accepting — entered by the
-- salesman at Confirm. Both optional.
alter table garage_invoices
  add column if not exists appointment_at timestamptz,
  add column if not exists remark text;

-- Accepting a job: claim it for one installer and move the work order to
-- installer_assigned, in one transaction. The UPDATE only matches while the
-- job is still pending and unassigned — if two installers accept at the
-- same moment, Postgres row-locks the job, the second UPDATE re-checks that
-- condition after the first commits, matches nothing, and gets
-- JOB_ALREADY_ACCEPTED instead of silently overwriting the first.
create or replace function accept_garage_installer_job(
  p_job_id text, p_installer_id text, p_estimated_complete_at timestamptz
)
returns garage_installer_jobs
language plpgsql
as $$
declare
  result garage_installer_jobs;
begin
  update garage_installer_jobs
  set status = 'accepted',
      accepted_by = p_installer_id,
      accepted_at = now(),
      estimated_complete_at = p_estimated_complete_at
  where id = p_job_id
    and status = 'pending'
    and accepted_by is null
  returning * into result;

  if not found then
    if exists (select 1 from garage_installer_jobs where id = p_job_id) then
      raise exception 'JOB_ALREADY_ACCEPTED';
    end if;
    raise exception 'JOB_NOT_FOUND';
  end if;

  update garage_invoices
  set work_status = 'installer_assigned'
  where id = result.invoice_id
    and work_status = 'waiting_for_installer';

  return result;
end;
$$;

-- Lets the salesman's screens update the moment an installer accepts.
do $$
begin
  alter publication supabase_realtime add table garage_installer_jobs;
exception when duplicate_object then null;
end $$;
