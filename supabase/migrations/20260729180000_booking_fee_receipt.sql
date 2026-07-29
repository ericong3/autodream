alter table customers
  add column if not exists booking_fee_receipt_url text,
  add column if not exists booking_fee_recorded_at timestamptz;
