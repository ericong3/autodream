-- Expense claims (petrol/bills) route through the existing payments table as
-- type 'expense_claim'. Submission alone doesn't make a claim payable — admin
-- has to check the receipt/amount first, which is tracked separately from the
-- existing delete-request columns so a claim can be confirmed and still show
-- as pending (not yet transferred).
alter table payments
  add column if not exists claim_confirmed_by text,
  add column if not exists claim_confirmed_at timestamptz,
  add column if not exists claim_kind text,
  add column if not exists claim_category text;

alter table payments drop constraint if exists payments_claim_kind_check;
alter table payments add constraint payments_claim_kind_check
  check (claim_kind is null or claim_kind = ANY (ARRAY['repair'::text, 'misc'::text]));

alter table payments drop constraint if exists payments_type_check;
alter table payments add constraint payments_type_check
  check (type = ANY (ARRAY[
    'salesman_commission'::text, 'intake_bonus'::text, 'source_commission'::text,
    'repair'::text, 'misc_cost'::text, 'consignment_payout'::text,
    'consignment_collection'::text, 'panel_charge'::text, 'investor_payout'::text,
    'customer_refund'::text, 'customer_collection'::text, 'loan_disbursement'::text,
    'expense_claim'::text
  ]));
