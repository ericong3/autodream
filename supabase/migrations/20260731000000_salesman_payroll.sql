alter table users add column if not exists employment_type text;
alter table users add column if not exists basic_salary numeric;
alter table users add column if not exists allowance numeric;

insert into ledger_accounts (id, name, type, investor_tagged) values
  ('acct-exp-salary',    'Basic Salary Expense', 'expense', null),
  ('acct-exp-allowance', 'Allowance Expense',    'expense', null)
on conflict (id) do nothing;
