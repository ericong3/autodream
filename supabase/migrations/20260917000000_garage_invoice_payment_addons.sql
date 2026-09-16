-- Payment method chosen at work-order confirmation, and any add-on
-- products a salesman tacks onto the order alongside the base service
-- (e.g. a rain repellent, wiper blades) — generic to any GarageService,
-- not tint-specific, so Coating/PPF/Spray can reuse both once built out.
alter table garage_invoices add column if not exists payment_method text
  check (payment_method in ('cash', 'card', 'transfer', 'installment'));

create table if not exists garage_invoice_addons (
  id text primary key,
  invoice_id text not null references garage_invoices(id) on delete cascade,
  name text not null,
  price numeric not null default 0,
  qty integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists garage_invoice_addons_invoice_idx on garage_invoice_addons(invoice_id);

alter table garage_invoice_addons enable row level security;
create policy garage_invoice_addons_all on garage_invoice_addons for all using (true) with check (true);
