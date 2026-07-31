insert into ledger_accounts (id, name, type, investor_tagged) values
  ('acct-exp-director-fee', 'Director Fee Expense', 'expense', null)
on conflict (id) do nothing;
