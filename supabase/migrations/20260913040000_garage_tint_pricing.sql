-- Tint pricing — director/shareholder-managed price grids, read by the
-- work order Tint Package screen to auto-calculate totals.
--
-- Full Package: one series applied to the whole car, priced by
-- series + vehicle size (6 series x 3 sizes = 18 combos).
create table if not exists garage_tint_full_prices (
  series text not null,
  vehicle_size text not null,
  price numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (series, vehicle_size)
);

-- Mix & Match: each glass position priced independently by
-- series + vehicle size (4 positions x 6 series x 3 sizes = 72 combos).
create table if not exists garage_tint_position_prices (
  glass_position text not null,
  series text not null,
  vehicle_size text not null,
  price numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (glass_position, series, vehicle_size)
);

-- The tint-specific detail for a GarageInvoice — kept separate from
-- garage_invoices so Coating/PPF/Spray can each get their own detail table
-- later without this one growing unrelated columns.
create table if not exists garage_tint_orders (
  invoice_id text primary key references garage_invoices(id) on delete cascade,
  package_type text not null check (package_type in ('full', 'mix')),
  full_series text,
  selections jsonb not null default '[]'::jsonb,
  discount numeric not null default 0,
  final_total numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table garage_tint_full_prices enable row level security;
create policy garage_tint_full_prices_all on garage_tint_full_prices for all using (true) with check (true);

alter table garage_tint_position_prices enable row level security;
create policy garage_tint_position_prices_all on garage_tint_position_prices for all using (true) with check (true);

alter table garage_tint_orders enable row level security;
create policy garage_tint_orders_all on garage_tint_orders for all using (true) with check (true);
