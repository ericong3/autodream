# Confirmed campaign bonuses in payroll and accounting

Approved by the owner on 1 November 2026. Garage remains paused. This change connects the existing campaign result to Used Car payroll and its operating ledger; it does not transfer money or connect to a bank.

## Director workflow

- Confirm monthly result now freezes the reviewed result and, in the same database transaction, creates the pending campaign bonus for each recipient and one department-level Staff Bonus Expense accrual.
- Example: October's six qualifying units create a RM3,000 expense and four pending gross bonuses of RM750. This is separate from basic salary and each car's commission/profit.
- A result confirmed by an older client can be explicitly added through Add confirmed bonus to payroll. The stored snapshot is used, not current rules, car status or enrolment.
- A zero bonus creates no money or journal entries, but records that the confirmed month has been processed.
- Recording a bonus payment through Accounting clears Accounts Payable against the operating bank. It cannot recognise Staff Bonus Expense again. Repeated recordings return the already-recorded payment.
- Amounts, recipients, campaign/month links and the associated journal entries are fixed. Corrections need separate accounting adjustments; they cannot be hidden by deleting the original records.

## Payroll and payslips

Campaign bonuses have their own payment type, exact earned month and campaign reference. Payroll shows a Campaign bonus line, includes it in monthly totals and groups it with the person's pending salary/allowance/commission entries. New payslip drafts include it in the existing Performance Bonus earnings field, even for commission-only staff; the earned share is not prorated again. Existing payslip snapshots are never recalculated or replaced. Existing statutory deduction calculations remain approximate previews and require the existing payslip deduction review; this feature does not implement statutory remittance or a new net-pay payment engine.

The live preflight found the existing payment type constraint omitted salary and allowance despite the app already generating them. Installation preserves its full old expression and adds salary, allowance and campaign_bonus.

## Accounting and integrity

- Recognition is dated to the earned month's last day: debit Used Car Staff Bonus Expense, credit Accounts Payable. It has no car reference, so it does not change individual car profit or consignor settlement calculations.
- Settlement uses the recorded payment date: debit Accounts Payable, credit Bank Operating.
- A private posting row, deterministic IDs and a unique recipient/campaign/month index prevent duplicate payroll entries. The campaign row serializes concurrent posting attempts.
- Browser writes cannot forge, change, delete or void campaign bonus payments or journals. Director identity comes from the existing authenticated private endpoint. Helper/core functions and posting tables are not browser-executable/readable.
- The old confirm_month operation remains snapshot-only for old clients; the new confirm_and_post action makes the financial effect explicit. Failed posting rolls the snapshot, request, payments and journal back together.
- The guarded installer compares the existing campaign function, checks the ledger baseline and verifies it created no payments, journals, payslips or monthly results. It does not auto-confirm or backfill live months.

## Verification

Full application tests/build, endpoint role and forged-field tests, UI confirmation wording/action tests, frozen payment-month/payroll earnings and payslip tests. Disposable PostgreSQL rehearsals cover the exact installer with LF/Windows CRLF, mid-posting rollback, four shares, repeat confirmation/posting/settlement, zero bonus, old-client confirmation, immutable protected records, private helpers, no duplicate expense on settlement, and unchanged existing financial records.
