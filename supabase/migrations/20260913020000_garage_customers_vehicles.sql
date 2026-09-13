-- Garage's own customer/vehicle records — separate tables from Used Car's
-- `customers`/`cars`. IC number is the business-unique key a salesman
-- searches by to pull up an existing customer.
create table if not exists garage_customers (
  id text primary key,
  name text not null,
  ic_number text not null unique,
  phone text not null,
  email text,
  created_at timestamptz not null default now(),
  created_by text references users(id)
);

create table if not exists garage_vehicles (
  id text primary key,
  customer_id text not null references garage_customers(id) on delete cascade,
  make text not null,
  model text not null,
  year integer not null,
  colour text,
  registration_no text not null,
  size text not null default 'standard',
  created_at timestamptz not null default now(),
  created_by text references users(id)
);

create index if not exists garage_vehicles_customer_idx on garage_vehicles(customer_id);

alter table garage_customers enable row level security;
create policy garage_customers_all on garage_customers for all using (true) with check (true);

alter table garage_vehicles enable row level security;
create policy garage_vehicles_all on garage_vehicles for all using (true) with check (true);
