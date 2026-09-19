-- Garage's own appointment calendar — separate from the Used Car side's
-- shared Test Drive calendar (that one is company-wide; this one is each
-- Garage salesman's own booking schedule, viewable in day/week/month with
-- an hourly grid like Google Calendar).
create table if not exists garage_appointments (
  id text primary key,
  customer_id text not null references garage_customers(id) on delete cascade,
  vehicle_id text references garage_vehicles(id) on delete set null,
  service text not null check (service in ('tinted', 'coating', 'ppf', 'spray')),
  title text,
  notes text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create index if not exists garage_appointments_starts_idx on garage_appointments(starts_at);
create index if not exists garage_appointments_created_by_idx on garage_appointments(created_by);

alter table garage_appointments enable row level security;
create policy garage_appointments_all on garage_appointments for all using (true) with check (true);
