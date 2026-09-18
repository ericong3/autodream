-- Work order lifecycle: paid -> installer job board -> job complete ->
-- delivered -> e-warranty registered -> closed (asleep). A work order is
-- "active" until every step is done, "closed" once warranty_registered_at
-- is set. Pay-later orders must reach payment_status = 'paid' before they
-- can be marked delivered.

-- Installer jobs previously vanished from the board once accepted — add a
-- third status so "job done" is a real, trackable step.
alter table garage_installer_jobs drop constraint if exists garage_installer_jobs_status_check;
alter table garage_installer_jobs add constraint garage_installer_jobs_status_check
  check (status in ('pending', 'accepted', 'completed'));
alter table garage_installer_jobs add column if not exists completed_at timestamptz;

alter table garage_invoices add column if not exists delivered_at timestamptz;
alter table garage_invoices add column if not exists warranty_registered_at timestamptz;
