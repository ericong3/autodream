-- PREPARED ONLY. Requires the private finance application release FIRST.
-- The installer must set this marker only after private session/API checks.
begin;
do $$ begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' then
  raise exception 'PRIVATE_FINANCE_RELEASE_NOT_REVIEWED: deploy and verify the private finance bridge before revoking browser access';
 end if;
end $$;

-- A public publishable key cannot identify staff in this application. All
-- finance reads/writes must pass through the existing private staff session.
revoke all on table public.users,public.payments,public.payslips,public.journal_entries,
 public.bank_transactions,public.bank_statement_uploads,public.investor_transactions,public.ledger_accounts
 from public,anon,authenticated;
grant select,insert,update,delete on table public.users,public.payments,public.payslips,public.journal_entries,
 public.bank_transactions,public.bank_statement_uploads,public.investor_transactions,public.ledger_accounts
 to service_role;
commit;
