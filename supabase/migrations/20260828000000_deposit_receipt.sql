-- Booking-fee deposits now lock once submitted with proof of payment, and
-- auto-generate a customer-facing deposit receipt PDF at that point.
alter table customers
  add column if not exists booking_fee_locked boolean,
  add column if not exists booking_fee_deposit_receipt_url text;
