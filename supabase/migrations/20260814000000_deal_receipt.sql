alter table cars
  add column if not exists deal_receipt_url text,
  add column if not exists deal_receipt_generated_at timestamptz;
