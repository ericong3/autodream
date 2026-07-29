-- The investor_transactions table (20260619_investor_transactions.sql) came up with
-- RLS enabled by default and no policy, which fails closed (queries succeed but return
-- zero rows) — matching the allow-all convention already used by every other table in
-- this app (payments_all, journal_entries_all, ledger_accounts_all, etc.) so the
-- Investor Portal feature actually works. Same security exposure as those tables.
create policy investor_transactions_all on investor_transactions for all using (true) with check (true);
