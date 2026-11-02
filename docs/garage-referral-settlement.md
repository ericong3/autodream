# Garage referral settlement

Owner decisions confirmed 2 November 2026:

- Garage is owed the full bill. The 30% qualifying tint/coating referral commission is separate.
- Customers can pay Garage directly; Used Car can transfer all or part of the bill. Both settle the same native Garage payment account.
- A Used Car salesman can authorise early release only for their own exact linked, approved deal. A Director with Used Car access can authorise any linked deal. Admin is excluded.
- Release never changes payment status or makes commission payable. Installation, Head/sales inspections and open car-condition reports still gate handover.

## Prepared behaviour

Staff open **Garage → Sales → Referrals**, or **Used Car → Garage referrals**. Salespeople see only their own linked referrals. Garage salespeople see their PIC orders; Garage management can review department referrals. A Garage Director verifies transfers and records commission payouts. This does not expand existing admin permissions.

Used Car reports a transfer already sent, with an amount and reference. Reporting alone does not count as Garage receipt. A Director confirms actual receipt: the transaction creates and verifies one native payment, linked to the transfer report. Existing reported direct customer payments reserve their balance too. Partial direct payments and transfers can coexist; the same outstanding amount cannot be counted twice. A rejected report records reviewer, time and reason.

After authorised early delivery, Used Car referral bills can still receive direct payments or transfers. Other delivered orders retain their existing payment restriction. The exact linked deal and authoriser remain locked while early-release authority is checked at handover. Changing the deal or disabling the authoriser invalidates the unpaid-release exception.

Commission remains 30% of the already-frozen qualifying basis. It is payable only after full verified Garage receipt. The Director records an actual payout date, amount and reference; partial payouts cannot exceed the unpaid commission. Payouts retain private payee details as they existed at recording. They are records of payments already made, not bank-transfer instructions.

The staff month screen shows actual commission paid during the selected month, that month's orders/payouts, and all older outstanding referrals. Partner Home shows only the signed-in partner's monthly referrals and actual payments. It derives the profile from the separate private partner session, not an ID sent by the browser. Accountless profiles use the same permanent ID, so their older referrals remain visible when login is created later.

New audit tables are private, with no browser table/RPC grants. Mutations lock the invoice and use actor-scoped durable retry IDs. Unknown responses and expired sessions retain the original request. No new hosted function is required; the existing sales endpoint multiplexes this scope.

## Installation review

Live database was inspected read-only on 2 November 2026. Existing profiles, assignments, native payments and installation functions are present. The migration ledger remains older than installed objects; do not run all pending migrations.

Exact bundle: `garage-referral-settlement-INSTALL-AND-CHECK.sql`. It verifies the live fingerprints of the three functions it changes before creating four private tables and the new private helpers. It stops if already installed or if a fingerprint differs. No historical order, receipt, payout, release request or partner account is fabricated or backfilled.

After explicit owner approval:

1. Recheck the live baseline and apply only the guarded transaction.
2. Verify its readiness/privacy flags and review-stage trigger.
3. Enable `GARAGE_REFERRAL_SETTLEMENT_ONLINE=1`, build the matching application on Vercel, verify it, then promote the canonical production domain.
4. Check authenticated role access without creating production test payments. Owner/staff perform their first real transaction and review it.

Unrelated warranty approval, cancellation/refund, replacement-lineage and other deferred Garage changes are excluded. No bank transfer, supplier reimbursement, tax filing, Used Car salary posting or company-wide accounting entry is executed by this feature. Annual tax-form generation is not implemented here.

## Validation

- 252 automated tests, including the new API tests: session actor, forged identity, admin exclusion, validation, role restrictions, separate partner cookie and rollout-off behaviour.
- Disposable PostgreSQL rehearsal runs the exact activation bundle (fixture-only baseline substitution), rejects drift and repeat installation, and exercises actual installation/inspection, damage block, exact-deal release, post-delivery split receipts, duplicate transfer protection, partial payout limits, monthly actual payment dates, accountless history and browser-role denial.
- Production build passes. Sample-only browser trial verifies transfer acceptance, commission eligibility, partial payout and partner income. No real data was written.
- Local preview: `node tests/referral-settlement-ui/server.mjs`, then `http://localhost:5206/tests/referral-settlement-ui/index.html`.

Owner approval was received on 3 November 2026. The exact database transaction is installed, its privacy/readiness checks passed, and the matching application is live. Runtime revision: `78c35cc`; Vercel deployment: `dpl_9E54yQR6hWs3CiDcQVNwWsALmkam`; canonical asset: `/assets/index-BJf0ef08.js`. The production flag `GARAGE_REFERRAL_SETTLEMENT_ONLINE=1` is enabled. Both settlement and existing referrer selection now use the installed private request-limiter contract. No production transfer, release or payout was created during rollout. Authenticated staff/partner acceptance with real data remains an owner test.
