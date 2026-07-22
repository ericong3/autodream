-- New liability account for the interest-free credit line from the
-- subsidiary company (short-term, repayable within 1-2 months) — distinct
-- from the owner's own capital, since it still needs to be repaid.
insert into ledger_accounts (id, name, type, notes) values
  ('acct-loan-subsidiary', 'Loan from Subsidiary Company', 'liability', 'Interest-free credit line, repayable within 1-2 months')
on conflict (id) do nothing;
