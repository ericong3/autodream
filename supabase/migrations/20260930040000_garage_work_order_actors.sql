-- Who did each salesman-side step, and when — so the work order's pipeline
-- and activity timeline can show "Payment collected · Nicholas · 4:10 PM"
-- the same way the installer steps already do. Additive only.
alter table garage_invoices
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by text references users(id),
  add column if not exists delivered_by text references users(id),
  add column if not exists warranty_registered_by text references users(id);

-- Existing paid orders: a Pay Now order was paid at confirmation by whoever
-- created it (it has a payment method). A Pay Later order that was marked
-- paid afterwards has no method and no record of when — left blank rather
-- than guessed.
update garage_invoices
set paid_at = created_at,
    paid_by = created_by
where payment_status = 'paid'
  and payment_method is not null
  and paid_at is null;
