# Used Car Bonus Campaigns

Prepared locally on 1 November 2026. Not installed, pushed or deployed. Garage development remains paused. The Noah recon commission and PPU7298 delivered-status correction remain separate unfinished work.

## Confirmed campaign rule

- Monthly calculation for October, November and December 2026.
- At least six actual company-owned deliveries unlocks RM500 for every qualifying unit that month.
- The whole pool is split equally among the campaign's enrolled Used Car salespeople. Whole cents are allocated deterministically so the shares add back to the pool.
- Dealer consignments and consignments out do not qualify as company stock. Recon classification alone does not establish ownership.
- Uses actual customer handover dates in Malaysia time. Early commission credit, deal submission date and intake date are not handover evidence. Duplicate leads do not count a unit twice.

## Management and history

- Payroll has a separate Bonus Campaigns section with Active, Upcoming and Completed views.
- Directors create/edit drafts, choose the month range, minimum deliveries, bonus per unit and enrolled salespeople, then publish. The year-end template pre-fills the confirmed rule; it does not create a real campaign automatically.
- Published rules and enrolment stay fixed. Copy creates an independent draft for new rules. Published campaigns are additive; the publish review states this explicitly.
- Shareholders retain Payroll oversight but cannot change rules, enrolment or confirm months. Other roles cannot read this management endpoint.
- Monthly figures remain estimates until the month ends and a director reviews and confirms the breakdown. A preview hash detects changed deliveries before confirmation. Conflicting/missing delivery evidence blocks confirmation.
- Confirmed results contain their own rule, qualifying cars, participant names, pool, allocations, actor and timestamp. Later car/staff changes do not rewrite them.
- Confirmation records a campaign bonus breakdown only. It does not issue payments or create/recalculate existing payslips. Integration into actual bonus payments/payslip adjustments is outside this tab milestone; the UI says this explicitly.
- Existing campaign saves use version checks, durable browser retry references and private database idempotency records. Unknown outcomes retry the original payload; old-account responses cannot populate a switched account.

## Activation

1. Read-only live preflight confirmed at `2026-11-01T06:57:41.222745+00:00`: campaign table and RPC absent; existing cars/customers/staff column types match the reviewed baseline.
2. Obtain explicit approval for `used-car-bonus-campaigns-INSTALL-AND-CHECK.sql` and the Used Car production deployment.
3. Run only the guarded script. It creates four private tables and two service-only functions. No campaign, employee enrolment, bonus, salary payment or customer/car change is seeded. Repeated installation stops before changes.
4. Deploy the application with `USED_CAR_BONUS_CAMPAIGNS_ONLINE=1`. The endpoint is multiplexed through the existing sales handler and adds no hosted function. Existing Garage dispatch stays intact.
5. Verify the private API, page permissions and live release. The director can then create a campaign, review enrolled people and publish it.

No migration or production deployment is authorised by this document. While the flag is off, the page reports pending activation and refuses writes.

## Verification

- Full application build and 230 automated tests passed.
- Exact guarded script rehearsed in a disposable PostgreSQL database: privacy, repeated-install stop, immutable published rules, stale edits, eligible enrolment, request replay, 5/6-unit threshold, all-unit pool, own-stock criteria, Malaysian month boundary, duplicate lead handling, cent allocation, changed-preview rejection, unresolved delivery blockers, frozen confirmed history, current/future-month confirmation rejection, and unchanged existing payslips/payments.
- API tests cover session-derived actors, role/department access, CSRF, inactive rollout, input precision/ranges, server-calculated amounts and private errors.
- UI tests cover status categories, the year-end template, duplicate clicks, durable retry/reload, old-account responses and shareholder read-only access.
- Sample-only preview: `http://localhost:5203/tests/bonus-campaigns-ui/index.html#/payroll/bonus-campaigns`. It uses mocked people and campaigns and refuses all writes. Desktop and 390px mobile views were inspected; mobile document width equals scroll width.
