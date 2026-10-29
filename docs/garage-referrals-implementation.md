# Garage sales ownership, referrals and interdepartment collections

Status: requirements confirmed 29 October 2026. Read-only live metadata checked at 12:25 UTC. External registration/account code prepared and tested locally; no migration or deployment authorised by this document. Sales ownership, commission and department-transfer integration below remain outstanding.

## Confirmed rules

- Every Garage deal requires one active Garage salesman or Director as person in charge. This is separate from who entered the order. Preserve the original creation audit.
- An order has zero or one commission recipient: an internal Used Car salesman or an external salesman. Do not pay both.
- Tint and coating commission is 30% of the final qualifying service price after discount, excluding tax. Generic products and unrelated services must not silently become commissionable. PPF, spray and building tint have no configured rate yet; unset is distinct from zero.
- Commission becomes payable only after Garage verifies full receipt of the order amount. Payable and actually paid are separate states. Preserve payout date, reference, amount and actor; annual statements use actual payments, not pending commissions.
- Used Car deals are filtered by month, but persist an exact deal reference and the referring staff identity. Do not link a whole month's total or infer ownership from a person's display name.
- Selecting a deal can suggest customer/vehicle details; never silently overwrite a Garage customer or merge records by name. Revalidate ownership and eligibility on save.
- Used Car collections are not Garage receipts. Track amount due from Used Car, transfer reported and transfer verified separately. Prevent duplicate recognition of the customer payment and internal transfer.
- An authorised Used Car staff member can request release of a linked vehicle before Garage receives the transfer. Retain actual requester, time and reason. Garage still completes installation, Head/sales inspections and damage review. Do not fake paid status to bypass delivery.
- Do not enable that exception for ordinary direct-pay or external-referral orders. Do not make the exception accessible merely by supplying a car ID.
- Full verified Garage receipt remains the commission eligibility condition even if delivery was permitted on a Used Car request.

## External registration

- One salesman profile has an inline choice: **Remain accountless** (default) or **Create account**. These are modes of the same profile, not separate business records or separate onboarding products.
- Staff can save a profile without a login, email, password, SMTP configuration or verification email. Name, phone, dealership brand and branch are required; tax/payment details can be added later.
- Staff-created accountless profiles have business profile approval, not login approval. External self-submitted accountless profiles require management profile approval, without email verification.
- Staff choosing Create account save the same profile and generate an optional setup link. Staff do not choose the external salesman's password. Upgrading an existing profile passes its permanent profile ID.
- Login setup retains the original profile and external directory payee IDs. Historical referrals, earnings and payouts must use these stable IDs, never a username, login creation date or email as their history key.
- Blank setup fields do not erase saved private tax/bank details. Invite inspection returns only basic contact/dealership fields; saved government identifiers, TIN, address and bank details are withheld.
- Future referral/commission eligibility must not require a login. History remains attached if setup is cancelled, login is disabled or an account is created later.
- Staff can edit the same profile to add tax/payment details later. Edits use a revision check, preserve private previous versions and never change the profile ID or directory payee ID. Saving Remain accountless cancels pending setup links atomically; it cannot silently delete an already-created login.
- Reuse an existing external salesman profile when safely identified and approved; do not create duplicate recipients automatically.
- Store legal name, individual/business recipient classification, IC/passport or business registration, TIN, address, phone, email, dealership brand and branch, and bank/payment recipient details.
- A dealership affiliation is not necessarily the payee. The profile must identify the person/entity actually receiving commission.
- Invite/setup, identity verification and management approval are separate states. Creating a profile alone does not grant login access or approve commission payment.
- Reuse secure account setup where safe, or isolate partner authentication; never grant an external salesman an internal Garage or Used Car staff role to obtain a login.
- Partner access is limited to their own referral summaries, commissions, payouts and annual statements. No customer ICs, other partners' tax/bank information, company profit or staff tools.
- Tax and bank fields are management/self scoped. Changes require attribution and must not rewrite historical payout recipient snapshots.
- CP58 is a statement of relevant incentive payments, not a substitute for the recipient's income tax return. Store sufficient records for an accountant-reviewed export; do not claim tax compliance solely from having an account.

## Existing source findings

- `src/types/index.ts` ExternalSalesman has contact/bank fields but no TIN/address, partner account or dealership fields.
- `src/pages/Data.tsx` manages existing Used Car external profiles; payment recipients already reference those IDs.
- `src/pages/GarageWorkOrderPayment.tsx` sends an atomic, replayable sale intent. Ownership/referral must join that same transaction and frozen retry payload, not a best-effort second write.
- `server/sales/core.mjs` strictly validates accepted sale fields; extend server and database together.
- Garage permissions, final inspection, notifications and home tasks currently depend on invoice `created_by`. An explicit person-in-charge field requires coordinated updates and historical fallback, not replacing the original audit creator.
- `garage_tint_payments` is the verified receipt authority. Internal transfers must integrate without duplicate settlement, and work after authorised early delivery.
- Live function definitions may differ from migration files. Check live schema/function signatures before generating guarded patches. Do not apply all historical migrations.
- Existing deferred warranty/refund/staff-handover changes remain postponed; this feature must not activate them incidentally.

## Prepared account implementation

- Migration `20261029020000_garage_referral_accounts.sql` and exact guarded activation bundle `garage-referral-accounts-INSTALL-AND-CHECK.sql` create private profiles, invites, verification/recovery tokens, separate sessions and audit records. Existing staff roles and permissions are not expanded.
- `server/referrals/accounts.mjs` is multiplexed through the existing sales endpoint without adding a hosted function. The new scope is off unless `GARAGE_REFERRALS_ONLINE=1`.
- Account setup invitation requires Garage Head or Director. Creating login access requires a one-use invite, hashed password, email verification and management approval. Saving an accountless profile does not require email infrastructure. Partner sessions cannot authenticate internal staff endpoints. Password resets invalidate existing partner sessions.
- Optional existing external profile ID is reused, with no private tax/bank information copied into the old directory. Duplicate new-account email and normalised identity are rejected.
- Public partner routes do not require an internal staff login or load the staff directory. Only the partner's own profile is returned through the partner session.
- One shared profile form offers Remain accountless by default or Create account. Manager UI supports profile creation/editing, later account setup on the existing profile, invitation cancellation, private profile review, approval and disabling/re-enabling logins. It does not send invitations automatically to other people.
- Partner UI supports the same account choice, optional email verification/sign-in, own profile, sign-out and password recovery. Deal/commission/payout displays and monthly income screens are not yet implemented.
- The isolated `tests/referral-ui` page previews the real registration component but refuses writes. It is labelled as a design preview. The normal localhost preview on port 5198 has not been replaced.
- Disposable PostgreSQL tests cover the exact activation bundle, accountless saving, stale-edit rejection, repeat-safe saves, private old versions, cancellation, profile/recipient identity preservation, two sample historic months after login upgrade, verification/approval, password reset and browser-role denial. The history rows in this test are fixtures; they do not implement the pending commission ledger or monthly portal.
- API and form tests cover optional credentials, no email infrastructure in accountless mode, manager permissions, CSRF, actor forgery, hashed credentials, cookie separation, generic recovery, duplicate-click/retry safety and private errors.
- Email transport is mocked in tests. No real invitation, verification email or account was created, and no live migration or deployment was applied by this work.

## Delivery sequence and acceptance checks

1. Read-only live metadata preflight, then reviewed private schema and permission design.
2. Local staff selectors, external profile/setup and per-order referral summaries.
3. Atomic persistence, exact Used Car deal linking, scoped partner portal and manager approval.
4. Used Car collection/transfer ledger, authorised delivery request, and commission payout records.
5. Disposable database and API tests: cross-user access, disabled staff, duplicate registration, idempotent sale retry, one recipient, rounding/discount/tax, partial payments, transfer verification, early delivery without paid status, unchanged inspection/damage gates, post-delivery transfer, payout retries and annual actual-paid totals.
6. User reviews localhost; explicit approval before live installation and deployment. Record separate database and application release results.
