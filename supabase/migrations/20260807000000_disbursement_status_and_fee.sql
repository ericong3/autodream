alter table cars add column if not exists disbursement_status text;
alter table cars add column if not exists disbursement_processing_fee numeric;

insert into ledger_accounts (id, name, type, investor_tagged) values
  ('acct-exp-bank-processing-fee', 'Bank Processing Fee Expense', 'expense', null)
on conflict (id) do nothing;
