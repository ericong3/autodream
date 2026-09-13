-- Completed jobs (invoices) for a vehicle, and any warranty/replacement
-- claims filed against one afterward. Warranty claims are the supplier's
-- cost; replacements are the company's — fixed by claim type, enforced by
-- the check constraint below rather than chosen freely per claim.
create sequence if not exists garage_invoice_seq;

create table if not exists garage_invoices (
  id text primary key,
  invoice_number text not null unique default ('INV-' || lpad(nextval('garage_invoice_seq')::text, 6, '0')),
  customer_id text not null references garage_customers(id) on delete cascade,
  vehicle_id text not null references garage_vehicles(id) on delete cascade,
  service text not null,
  invoice_date date not null default current_date,
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create index if not exists garage_invoices_vehicle_idx on garage_invoices(vehicle_id);
create index if not exists garage_invoices_customer_idx on garage_invoices(customer_id);

create table if not exists garage_invoice_claims (
  id text primary key,
  invoice_id text not null references garage_invoices(id) on delete cascade,
  type text not null check (type in ('warranty', 'replacement')),
  bear_by text not null check (
    (type = 'warranty' and bear_by = 'supplier') or
    (type = 'replacement' and bear_by = 'company')
  ),
  reason text,
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create index if not exists garage_invoice_claims_invoice_idx on garage_invoice_claims(invoice_id);

alter table garage_invoices enable row level security;
create policy garage_invoices_all on garage_invoices for all using (true) with check (true);

alter table garage_invoice_claims enable row level security;
create policy garage_invoice_claims_all on garage_invoice_claims for all using (true) with check (true);
