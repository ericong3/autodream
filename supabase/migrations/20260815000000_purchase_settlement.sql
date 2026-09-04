-- Settlement is the portion of a car's purchase price paid directly to a
-- lender (clearing an existing loan) instead of the seller/consignor — not an
-- extra cost, just a split of where the purchase price money goes.
alter table cars
  add column if not exists settlement_amount numeric,
  add column if not exists settlement_recipient text;

alter table payments drop constraint if exists payments_type_check;
alter table payments add constraint payments_type_check
  check (type = ANY (ARRAY[
    'salesman_commission'::text, 'intake_bonus'::text, 'source_commission'::text,
    'repair'::text, 'misc_cost'::text, 'consignment_payout'::text,
    'consignment_collection'::text, 'panel_charge'::text, 'investor_payout'::text,
    'customer_refund'::text, 'customer_collection'::text, 'loan_disbursement'::text,
    'expense_claim'::text, 'purchase_settlement'::text
  ]));
