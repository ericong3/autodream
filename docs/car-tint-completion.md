# Car tint completion — local work, not deployed

Current live baseline: dpl_9nh72TvyM8ahnQZyqRg1f2QmeYf5. Branch: codex/car-tint-accountability.

User changed priority from building tint to completing car tint. Confirmed: deposits and multiple balance payments; company receipt verified by director or authorised admin. Do not deploy or apply further database updates until approved.

Fresh production metadata audit: zero invoices/jobs; only paid/pending on invoice; no separate payment ledger; no film movement ledger; no replacement count columns. Existing production installation approvals and throttle correction are live.

Acceptance scope:
- Amount-due snapshot, per-payment amounts/method/reference/proof, collector and receipt date, pending company verification, verified/rejected history, amounts collected/verified/outstanding; no duplicate collection after lost response.
- Director/admin verification, explicit Garage business access for admin; no workshop financial access or shareholder/Head verification override.
- Existing quoted amount frozen after confirmation. No new pricing formulas or bank transfers.
- Invoice paid only from verified receipts; delivery blocked until verified balance is zero and both inspections passed.
- Positive film usage required before completion, atomic stock consumption and immutable movements; replacement increments count and starts a new usage attempt without refunding old film.
- Claims after delivery must preserve original delivery evidence; do not silently reopen historical orders. Any remaining unsupported warranty/rework behavior must be stated, not claimed complete.
- UI and API regressions, real disposable PostgreSQL integration, mobile/component checks, migration preflight and approval package.

Building workflow stays deferred. No real financial/customer/job records may be created as part of testing.

Local checkpoint, 27 October:
- 131 existing tests pass; production build passes. No production migration/deployment for these changes.
- Disposable PostgreSQL integration passes deposit/balance, verification permissions, rejected money still counted as customer collection, explicit cancellation of incorrect entries, retry protection, quote freeze, required usage, replacement count/consumption, delivery and legacy write denial.
- Storage integration with existing permissive policies confirms new proof bucket is inaccessible to anonymous/authenticated direct reads/inserts/updates/deletes; legacy bucket behavior preserved.
- Sale retry/status now includes attached initial-payment proof path.
- Remaining: API/proof handler tests, browser screen validation and account-switch checks, post-delivery warranty/paid replacement decision and implementation, final rollout preflight/approval. Do not call full car tint workflow finished yet.

27 October final local verification:
- Confirmed existing route: customer profile -> vehicle -> Purchase History -> past invoice -> After-sales. Kept warranty=supplier, replacement=company; added separately linked customer-paid replacement with agreed charge and mandatory reason.
- After-sales submission creates a new claim-linked invoice/job transactionally, with selected original glass/film and original layout. Original purchase, delivered_at, usage and money history remain intact. Shared Garage sales access is preserved. Normal installer claiming, usage, Head and original creator inspections, verified payment/delivery gates apply to the new job.
- Duplicate open replacements for the same original glass are refused; lost-response retries reuse the saved request. Existing legacy claim records are preserved and identified when no linked job exists. Non-tint claim behavior is unchanged.
- Disposable database test now covers free supplier warranty through installation/delivery, company replacement, paid replacement, initial-proof retry/status, stock receipt/reconciliation idempotency, and private-bucket RLS.
- Browser trial verified deposit (15 of 45), admin not-received investigation and later verification, installer claim, completion disabled before usage, 8 sqft saved before completion, claim form and duplicate-job rejection. Account switching clears financial controls for workshop staff. Phone width 390 has no horizontal overflow.
- API tests cover session actor, finance verification permissions, stock management roles, payment precision, proof signature/ownership/immutability/retries, and after-sales handler.
- Fresh production preflight at 22:19 MYT: installation/layout true; invoices/jobs 0; new finance/usage/after-sales tables and proof bucket absent. Migration ledger latest version 20261014101636 is incomplete compared with actual installed objects: do not bulk replay old migrations.
- Four new migrations combined in ../CAR-TINT-ACTIVATION-REVIEW.sql, manifest SHA256 saved alongside. This is a review artifact, NOT applied. They run in one transaction and refuse conversion when any existing invoice requires review.

Rollout awaiting owner approval:
1. Reconfirm backup and fresh zero-invoice/schema preflight. If orders appear meanwhile, stop for explicit conversion review; do not invent historic receipts/usage.
2. Prepare the matching application deployment, keeping production alias on the current live release while the build is checked.
3. Apply only the reviewed four-migration transaction; verify tables, role grants, storage restriction, function definitions and opening stock movements. Preserve existing data/buckets.
4. Publish the matching application and check production sign-in, notifications, payment review and stock/claim routes without creating real test transactions.
5. Record deployment ID and activation evidence. Do not automatically reverse a ledger after real receipts exist; preserve data and use a reviewed forward fix if needed.

Scope boundaries: records track reported customer collections and company verification; no bank/card transfer is executed. Supplier/company cost responsibility and film quantities are recorded; supplier reimbursement, monetary film valuation, customer refunds and order cancellation are not added by this release. Building workflow remains deferred.

Final release checks: npm test 137/137; full production build succeeded; disposable database workflow suite passed; exact combined activation transaction rehearsal passed. No production application or database changes were made during this work.
