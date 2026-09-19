-- Per-glass-piece execution tracking for an in-progress tint job — which
-- installer worked each piece (front windscreen, door window, rear panel
-- window, rear windscreen, plus any toggled extras) and how much film
-- (sqft) it used. One row per position per invoice; positions are seeded
-- lazily from the tint order's own selections/extras when the job's
-- execution page is first opened, not at job-accept time.
create table if not exists garage_tint_installation_pieces (
  id text primary key,
  invoice_id text not null references garage_invoices(id) on delete cascade,
  position text not null,
  installer_id text references users(id),
  sqft numeric,
  updated_at timestamptz not null default now(),
  unique (invoice_id, position)
);

create index if not exists garage_tint_installation_pieces_invoice_idx on garage_tint_installation_pieces(invoice_id);

alter table garage_tint_installation_pieces enable row level security;
create policy garage_tint_installation_pieces_all on garage_tint_installation_pieces for all using (true) with check (true);

-- Film roll stock, one row per tint series — remaining_sqft is decremented
-- as installers log sqft used per piece, so managers get a low-stock signal
-- before a roll actually runs out mid-job.
create table if not exists garage_film_stock (
  series text primary key check (series in ('royal', 'unique', 'majestic', 'classic', 'lite', 'eco')),
  roll_sqft numeric not null default 500,
  remaining_sqft numeric not null default 0,
  low_stock_threshold numeric not null default 200,
  updated_at timestamptz not null default now()
);

insert into garage_film_stock (series, roll_sqft, remaining_sqft, low_stock_threshold) values
  ('royal', 500, 500, 200),
  ('unique', 500, 500, 200),
  ('majestic', 500, 500, 200),
  ('classic', 500, 500, 200),
  ('lite', 500, 500, 200),
  ('eco', 500, 500, 200)
on conflict (series) do nothing;

alter table garage_film_stock enable row level security;
create policy garage_film_stock_all on garage_film_stock for all using (true) with check (true);

-- Optional note the installer can leave when completing the job.
alter table garage_installer_jobs add column if not exists remark text;
