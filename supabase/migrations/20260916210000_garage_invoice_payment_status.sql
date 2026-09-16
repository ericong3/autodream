-- Whether payment has actually been collected for an invoice. Some
-- customers pay up front before the installer starts, others pay after the
-- job is done — but always before the car is delivered back to them. New
-- invoices set this explicitly at confirmation time; existing rows default
-- to 'paid' since they predate this distinction (payment was always
-- collected up front before this feature existed).
alter table garage_invoices add column if not exists payment_status text not null default 'paid'
  check (payment_status in ('paid', 'pending'));
