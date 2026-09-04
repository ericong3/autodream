-- Source commission (paid to whoever sourced the car — external or internal
-- salesman) was tracked as a payment but never had a Chart of Accounts entry,
-- so it could never be recognized/paid in the ledger. Same treatment as
-- Salesman Commission / Intake Bonus: a period expense, not capitalized into
-- inventory (it's a selling cost, not a cost of the car itself).
insert into ledger_accounts (id, name, type, investor_tagged) values
  ('acct-exp-source-comm', 'Source Commission Expense', 'expense', null)
on conflict (id) do nothing;
