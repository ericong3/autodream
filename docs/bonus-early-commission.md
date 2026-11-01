# Bonus target and Credit Commission Early correction

Owner correction, 1 November 2026: the year-end monthly target is **5**, and company-owned units credited early must follow the existing **Credit Commission Early** setting and credited month. No new eligibility checkboxes or separate early-credit system are introduced.

For an eligible company-owned car:

- If Credit Commission Early is enabled, use its explicit credited month, even when physical delivery happens later.
- Otherwise use the actual customer delivery date in Malaysia time and require the car to be delivered.
- Dealer consignments and outgoing consignments remain excluded.
- Count a car once, regardless of duplicate customer leads. A unit already stored in another confirmed month of this campaign cannot count again if its credit flag, credited month or delivery date changes later.
- A missing/invalid early-credit month requires review rather than guessing from intake or deal submission dates.
- Confirmed monthly snapshots stay unchanged.

The app labels early-credit units in the qualifying-car list. The year-end template now defaults to five units. The RM500 per qualifying unit and equal allocation among four enrolled salespeople are unchanged.

The published campaign had no confirmed monthly results when reviewed. The guarded correction installs only `20261101020000_bonus_early_commission_units.sql`, changes this campaign's target from six to five, increments its rule revision and records the correction in the private repair audit. It refuses changed baseline functions, changed campaign rules or existing confirmed results. It changes no car status, credit flag, credit month, payment or payslip.

Live read-only preflight found four delivered October company-owned units and **three**, rather than two, undelivered company-owned units credited to October: WB4768P (Axia), VLB6455 (Bezza), VGP3695 (Alza). Source settings are preserved; no forced six-unit count. QS5092N (Aruz) has a missing handover-date warning, which is retained for director review. Monthly confirmation and salary payment are outside this correction.

Validation includes the exact guarded installer in disposable PostgreSQL, target/pool calculations for 5/6/7 units, ownership exclusion, duplicate leads, explicit credited months, later handover, frozen-result protection, stale previews, private function execution and unchanged payments/payslips; full application tests and build.
