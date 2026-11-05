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

## Subsequent local outgoing collection work

The CLI-generated migration `20261105141201_outgoing_consignment_collections.sql` adds a Director review of a fixed dealer collection, with the dealer statement retained in the immutable approval. Approval posts a receivable to a named review clearing account and creates no bank movement. Partial receipts use the existing proof-backed registered-bank flow. Profit remains pending until a separate cost review.

Cost review checks completed repairs, matching bills and accruals, invoices, recorded inventory and car expenses. It uses the existing inventory once. If exactly the entire old purchase entry is missing, a Director must choose its purchase invoice and explicitly acknowledge the missing history. The stock cost is booked against `acct-opening-review`, then cleared to COGS as part of the sale. It creates no purchase payment. Other inventory differences require investigation. Sale revenue and COGS are recorded only once; the original entries and bank receipts remain unchanged. Closed costs are protected against later edits and require an audited adjustment workflow.

Local PostgreSQL checks cover missing history, existing stock plus a repair bill, receipts before and after cost finalisation, balanced final stock/AR/clearing, exact replay, source/invoice/role gates and history locks. Isolated Chrome checks cover cancellation, selecting the purchase invoice, acknowledging missing history and final confirmation. APIs are mocked in browser tests. All 457 automated tests and the build pass. No production SQL or deployment has occurred. Claude's session limit prevented its review of this outgoing module; a separate Codex review and independent local checks were used.

That review found and verified fixes for three concrete issues: cost review now remains available from the car page after full collection; duplicate car-scoped commission bills are rejected; and stale retail work orders cannot overwrite a recorded dealer sale. A real two-connection PostgreSQL race confirms that the dealer sale and competing retail work order cannot both persist.

New company stock uses a private, replay-safe dealer-sale action. A transaction-bound exact before/after audit allows only that sale transition through existing purchase/trade-in locks. Company ownership and original seller/lender obligations remain unchanged. Dealer receipts update the actual collection state, while backfill no longer generates a fictional loan receivable from the dealer label. Ordinary purchase and trade-in regression checks pass. Browser checks also exercise the actual CarDetail sale form and its permanent dealer account entry. Recorded financial amounts are omitted from the committed production preflight artifact.

Remaining release checks include general paid-bill amendments, post-close outgoing cost amendments, the full production-schema rehearsal and staged private-session activation/deployment. The historical bank matching work remains deferred.
