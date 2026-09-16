-- Jobs handed to an installer once a salesman confirms a Tint work order.
-- Other services (coating/ppf/spray) don't have worker queues yet — those
-- get built out later per the same pattern.
create table if not exists garage_installer_jobs (
  id text primary key,
  invoice_id text not null references garage_invoices(id) on delete cascade,
  service text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_by text references users(id),
  accepted_at timestamptz
);

create index if not exists garage_installer_jobs_invoice_idx on garage_installer_jobs(invoice_id);
create index if not exists garage_installer_jobs_status_idx on garage_installer_jobs(status);

alter table garage_installer_jobs enable row level security;
create policy garage_installer_jobs_all on garage_installer_jobs for all using (true) with check (true);
