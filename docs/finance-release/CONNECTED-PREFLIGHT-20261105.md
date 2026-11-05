# Connected production check — 5 November 2026

Read-only Supabase checks confirmed project `ayvbagxashasdqgwncbf`, PostgreSQL 17.6, 200 cars, 1,132 payments and 1,132 journals. None of the prepared `uc_` tables is installed. There are no investor-owned cars. No production changes were made.

The three outgoing consignment cars are delivered, each with a pending dealer collection matching its saved fixed amount. Six repair bills remain pending across those cars. No sale journals were found for those cars. The new receipt workflow currently blocks their collections, so an outgoing collection and accounting review path remains required before activation. Existing entries must be preserved.

Production schema checks caught and corrected these local compatibility issues:

- Dealer bank columns use snake_case. Panel approvals now support these names and the earlier camelCase fixture.
- Supplier refunds need an additional payment type. The prepared migration extends the existing check without removing payroll or other allowed types.
- Company trade-in lender payments used the unsupported recipient type `other`. They now use `merchant`, consistent with ordinary purchase lender payments.

Claude independently reviewed panel approval authorization, accounting, source locks, retries and shared locking. Its trade-in recipient finding is fixed and covered by the production recipient constraint in database tests. Review polling and approval now have separate rate-limit allowances.

Local validation: full disposable PostgreSQL 17.11 finance chain, real concurrent receipt/payment checks, company trade-in lender test, and isolated Chrome interactions for consignment, withdrawals and panel approval all pass. Browser APIs are mocked; production sign-in and activation remain unverified. No bank account is marked matched.

Remaining release work includes outgoing collections, general company/investor paid-bill correction coverage, exact production-schema rehearsal, staged private API verification, installation and production deployment. Historical bank matching remains deferred by the user. Opening balances are entered in the app, not inferred from the old ledger.
