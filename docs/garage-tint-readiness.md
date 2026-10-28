# Garage car tint readiness — 28 October 2026

Scope: car tint only. Used Car consignment and building workflows are deferred.

## Existing online release

Production: https://autodream.vercel.app
Last recorded production deployment: dpl_D2uR19gx3gLRKEQpABF8QfNjGYWY; source 1c93fe8 (Garage Home shortcuts). This candidate has NOT been deployed.

Existing installed functionality:
- Installer glass-piece claim, personal work confirmation, film usage, Garage Head inspection and original salesperson inspection before handover.
- Deposit and multiple balance payments; customer collection separated from company receipt verification by director or authorised admin; unpaid/verification balances and payment evidence.
- Stock consumption based on recorded film usage, incremental usage and replacement attempts; replacement counts and history.
- Claims from customer vehicle purchase history: supplier warranty, company replacement and customer-paid replacement, with a reason; separate replacement job preserves the original delivered invoice.
- Role-based Home shortcuts and payment verification queue. Workshop staff do not receive customer payment amounts.

Manufacturer e-warranty registration remains a staff-confirmed external step, not an automated manufacturer integration. Supplier reimbursement and customer refunds are not new features in this release.

## Prepared locally, awaiting database and release approval

1. Clearly separate damage already present on arrival from incidents discovered or caused during installation.
2. Record affected area, description, reporter, time and optional private photos (four maximum, 2 MB each).
3. Garage Head records acknowledgement of arrival damage or resolution of an installation incident, with a mandatory outcome note. Reporting does not automatically assign liability or compensation.
4. Block handover while any report remains open. Reviewed records stay unchanged; delivered jobs retain their history. New after-sales damage belongs on the replacement job.
5. Show open damage in Home shortcuts and work orders, within existing permissions.
6. Allow the original collector or authorised finance staff to attach missing payment proof after verification, without changing payment amount or verification status.

## Validation

- npm test: 151 passed, zero failed.
- npm run build: passed. Existing large-chunk and stale Browserslist warnings remain.
- Existing installation-review database integration: passed.
- Full accountability plus damage database integration: passed, including the exact transaction bundle below, deposit/balance verification, ownership, claim/replacement stock consumption, installer inspections, damage handover block, private storage, retry protection and proof attachment after verification.
- No production transactions or sample customer records were created.
- Signed-in visual and real-staff acceptance testing remains outstanding: the browser automation inventory exposed no accessible browser.

## Live database status and limits of verification

Read-only public API schema check at 2026-10-28T07:13:27.032Z (15:13 MYT): invoices/jobs are present; installation reviews, tint payments, usage attempts and reworks returned permission denied; damage reports returned PGRST205 (absent from API schema cache). No customer row content was requested. Public visibility counts are NOT proof of total production record counts.

The previous privileged check on 27 October confirmed the four car-tint updates installed. The migration history ledger was incomplete and must not be bulk replayed. Fresh privileged function definitions and the migration ledger could not be inspected: the available production environment export supplied no usable server configuration. The schema check does not replace that check.

## Reviewable activation bundle — not executed

- docs/garage-tint-readiness-activation.sql
- SHA256: 05c77457beb19ed46717b7ba881042aae2a64f3e16a06e898f0d76653c24e141
- Contains only 20261028000000_garage_damage_reports.sql and 20261028010000_garage_verified_payment_evidence.sql inside one transaction, with lock/statement timeouts and schema reload.
- Additive tables/private storage and a delivery guard; no historical reports, invoices, stock or payments are fabricated or backfilled.
- App Home now queries damage reports: apply the database update successfully BEFORE publishing this app version.

## Proposed rollout sequence

1. Obtain owner approval for these two database updates and matching production release.
2. With privileged access restored, check current function definitions and migration state, storage policies and backup availability. Stop if drift makes this reviewed bundle unsuitable; never replay unrelated migrations.
3. Apply the reviewed transaction once; verify function permissions, damage bucket privacy and existing payment/installation checks.
4. Deploy the matching candidate, check the staged release, then promote to production.
5. User acceptance with an actual test order: deposit, installer claim/usage/confirmation, arrival and installation report, Head resolution, both inspections, verified balance, handover, warranty claim and replacement usage. Do not mark this real-staff trial completed until performed.

If deployment fails after the database update, keep the old app online and recover the matching release. The new handover guard intentionally remains active; do not drop evidence tables to roll back. Existing workflows without open damage reports remain delegated to the prior installation function.
