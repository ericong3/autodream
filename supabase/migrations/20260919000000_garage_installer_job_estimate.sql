-- Installer keys in an estimated completion time the moment they accept a
-- job, so the salesman/customer know roughly when the car will be ready.
alter table garage_installer_jobs add column if not exists estimated_complete_at timestamptz;
