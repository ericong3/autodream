# Garage enquiry saving — prepared locally

Not deployed or applied to the live database as of 23 October 2026.

## Behaviour

- Uses shared Garage customer profiles, with no IC/car required for an enquiry.
- Enquiries and next-action notes are visible to their owner; only directors see all.
- Phone matching is serialized for server-created customers. A separate-person confirmation permits family members sharing a phone.
- Each service has New, Discussing and Quoted stages. Booking/orders/payments still use the existing Sales flow; there is no fake Booked toggle.
- Reminder dates are optional. Home reads own due reminders using Malaysia's date.
- Edits use revision checks. A conflict keeps the draft and shows the latest note, asset and date before an explicit choice.
- Lists are paged, 50 at a time. Directors can retrieve older enquiries without a silent 500-record cutoff.

## Required activation order

1. Finish staff account enrollment for the shared login. Do not switch current staff off prematurely.
2. Review and deploy the enquiry API, screen and secure customer adapters while `GARAGE_ENQUIRIES_ONLINE` remains unset.
3. Apply `20261023000000_garage_enquiries.sql` and `20261023010000_garage_customer_access.sql` together with verified shared-login activation (`VITE_AUTODREAM_SECURE_LOGIN=1`). The second migration closes old anonymous customer access; applying it early would break legacy customer screens.
4. Enable server-only `GARAGE_ENQUIRIES_ONLINE=1` and redeploy. Confirm actual staff identity/session mapping and perform an authorized test using explicitly identified test records.

The old Garage customer policy permits unauthenticated reads/writes. Do not enable enquiries on the live system while retaining that customer policy. Enquiry tables themselves have no browser grants. This migration secures customers, not every legacy Garage/Used Car table.

Legacy customer creation still uses its original direct-table path while secure login is off; its phone warning is advisory. After activation, customer creation uses the same server-side matching lock as enquiries. Existing IC values cannot be replaced by the add-missing-IC action.

## Validation

- `node --test tests/garage-enquiries-api.test.mjs tests/garage-navigation.test.mjs`
- `node tests/garage-enquiries-db.integration.mjs <temporary-pglite-package-path>`
- `npm run build`
- Disposable browser test: `node tests/enquiry-ui/server.mjs <temporary-pglite-package-path>`, then open `http://127.0.0.1:5181/tests/enquiry-ui/index.html`.

The browser harness uses a fictional staff identity and in-memory Postgres. It never connects to Supabase, and is not an authentication implementation or production deployment target. Its data lasts only until the test server stops.


## Review candidate — 25 October 2026

Prepared in `C:/Users/ericl/Documents/Codex/autodream-enquiries-release`, based on production commit 9eb5b53. Shared verified login is already active online. This candidate has not been deployed to production and no enquiry migrations have been applied there.

- `GarageFollowUps` replaces the draft list with the approved desktop Kanban and mobile Move sheet.
- Home has Follow-ups navigation and due-reminder links; customer profile / Start sale retains the existing Sales flow.
- The standard layout and My board both belong to the individual staff member. Directors can review enquiries, but arranging their board does not rearrange a salesman's board.
- Board columns, positions, order, product filters and pins save through a private server API. Data never uses demo localStorage keys.
- Board writes queue immediately and are awaited when revisiting the page. Canonical comparison avoids unnecessary writes on load. Expected account ID protects against account switches; stale revisions preserve the screen and require a deliberate reload.
- Enquiry drafts survive revision conflicts. Mobile changes use a column picker instead of drag gestures.
- Current board payload limit is 200 KB / 5,000 ordered IDs; exceptionally large boards receive a visible save error. No silent truncation.

### Activation after review

1. Keep the isolated preview separate from production. It uses fictional staff and an in-memory PostgreSQL database; data disappears when its test server stops.
2. Apply the two 20261023 migrations and `20261025000000_garage_enquiry_boards.sql` in one reviewed transaction. These close direct public access to Garage customer profiles.
3. Deploy this candidate and enable `GARAGE_ENQUIRIES_ONLINE=1` together. Keep `VITE_AUTODREAM_SECURE_LOGIN=1`.
4. Verify director and salesman sessions, existing customer search, customer profile / new-sale creation, private ownership, second-device saves, and mobile Move with approved trial records.
5. Do not deploy the unrelated staff-profile branch or dirty main checkout.

Validation: production build; enquiry and board API tests; disposable database tests covering duplicate/family matching, owner privacy, directors, reminders, stale enquiry/board writes and browser grants; browser checks for saving a note/reminder, reload and second-tab persistence, conflicts, custom columns and 390px mobile Move.

Claude reviewed twice. The second review approved isolated user review and identified two final queue/account-transition concerns; both were corrected before this candidate was delivered.


## LIVE — 25 October 2026

User approved online activation. Production deployment `dpl_CZS4QzCKx2ALjHqe3N6T6R4BYzAu` is promoted to https://autodream.vercel.app. Server `GARAGE_ENQUIRIES_ONLINE=1`; shared login remains enabled.

All three enquiry/customer-access/board migrations were applied as one transaction. Production database checks passed follow-up creation/update, board saving and cross-salesman privacy, with every temporary check record rolled back. Unsigned HTTP requests to both new endpoints return 401. A full staff-session browser check awaits the user's phone trial because the agent browser is currently signed out.

Installers/detailers/spray staff retain customer identity lookup for their jobs through `customer_get`; private enquiry reads remain denied. Account profiles/HR preview changes are not part of this release.

Source is preserved in this isolated release directory. The deployment was uploaded directly to Vercel; these changes have not yet been committed/pushed to GitHub. Reconcile this release into the production branch before the next Git-triggered deployment.


### Shared login loop investigation — 25 October 2026

Observed production logs: POST /api/auth/session returned 200, followed by GET 401. A newly issued Eric session remained in the database. This indicates that the following request did not carry that token (cookie missing, stale, or not sent); browser cause is not yet proven. Do not describe this as an incorrect password or a confirmed fix for cookie blocking.

Client patch: no pre-login destructive logout; confirm session with GET after POST before entering the app. Clear previous-account cache immediately after a successful POST without revoking the new cookie. Public login remains mounted during this cache reset. Missing cookie shows instructions to use Safari/Chrome instead of a redirect loop. Return route is preserved and restricted to internal paths. No cookie security settings, passwords or permissions changed.

Validated: three login-flow regression checks plus existing 23 server auth checks, and production build. Actual phone success remains pending user retry; browser type question is pending.

Session-confirmation client fix is LIVE in deployment dpl_DVE6KjJRsdTWTY5qqPXXtqe1Kz2i. Production bundle verification passed; actual phone sign-in retry remains pending.


### Login redirect follow-up — LIVE

Latest live deployment: dpl_9WrmzG2j2RMywzN2eyyEDh2cg35H. Subsequent logs showed GET session 200, so the earlier browser-cookie explanation was incomplete. Login now restores a valid server session before showing the form and uses declarative navigation after sign-in. Late failed reads no longer clear the browser cookie; server revocation and explicit logout remain enforced.

Validation: 27 login/server-auth checks, 22 enquiry/board/account checks, production build. Real Login browser harness passed: fresh login with cache clearing and delayed app loading; existing session automatically enters Choose Business; missing session remains on form with help text. Public deployed bundle verified and invalid-cookie GET returns 401 without Set-Cookie. Phone success still awaits user retry. HTTP page and service worker headers already require revalidation (max-age=0).


### Sign-in performance — LIVE

User confirmed login succeeds but feels slow. Deployment dpl_2yecrrQhr5KXN4fN1RptDWZRRr9W removes the full shared-data wait from the business chooser and Garage screens; Used Car and Team retain route-reactive loading gates. No shared data fetch before sign-in. Server login independent cleanup operations run concurrently; password/session checks unchanged.

Background store fetches and subscriptions now ignore old account generations. Local logout clears immediately, starts session revocation alongside channel cleanup, and new subscriptions wait for previous cleanup. Five regression tests exercise actual loadAll/logout bodies with delayed database and channel responses. Auth/login 27 checks pass; production build passes. Live page verified new bundle, unsigned originless session request returns403 without identity. Phone speed improvement awaits user comparison; no claimed measured latency. Source remains directly uploaded, not GitHub-pushed.


### Enquiry functionality review — 25 October 2026

Verified with disposable PGlite and the real FollowUps component: new enquiry with name/phone/services, saved next action and reminder survive reload, individual service stage changes preserve other services and local draft. DB checks cover duplicate phone matching/family exception, salesman isolation, directors, stale writes and private boards across devices. No production customer records created or edited.

Fixed misleading Follow-up saved feedback after a service-only save; drafts now explicitly show unsaved changes. Customer searches now discard results after details change or account switch; three focused actual-function regression checks pass. API11 checks, disposable DB integration and production build pass. Appointment creation from Ready to book remains unimplemented by this card movement (explicitly stated on board).


### Private appointments — 25 October 2026, LIVE

Deployment dpl_8YeCyFSXVwsLueepc4BBS9tMjKSD. Enquiry → Book appointment opens Calendar with the authorized customer and enquiry link. Customer visit/Installation labels, four car services and building tint, optional vehicle, date/time, notes, revision-protected editing, recoverable cancellation. Creating from an enquiry is restricted to its services by SQL and initial form. Same-draft retries deduplicate via requestId. Reusing an already-saved key with changed contents gets explicit instructions to reopen the existing booking.

API actor comes from the shared verified session. Sales staff/head/shareholder see own appointments; directors see all. No browser appointment-table reads/writes remain. All Calendar and Today widgets use the server endpoint. Invalid inputs, explicit timestamp offsets, null-safe staff permissions, pagination, safe failures tested. No Used Car feature code changed.

Rollout: initial deployment attempt was rejected by automatic approval review due to migration/client ordering. Resolved with a compatible two-phase rollout: phase1 added columns/RPC and preserved old table access; after confirmed production setup, built/promoted the API-backed client; phase2 then revoked browser grants. Both migrations applied. Production had zero existing appointments. A rollback-only production check passed visit/create, installation/update, duplicate retry, another active Garage role privacy and cancellation history; zero test customer/appointment rows remain. Local disposable DB additionally checks two-salesman isolation, stale edits, cross-customer linkage and permissions. Six API checks and production build pass. Real-component browser test carried customer from enquiry into booking, saved installation and customer visit at selected times, and recovered the saved installation after remounting the test app. Date/time inputs now handle input events as well as changes.

Not included: linking an invoice/order to an existing booking, automatic synchronization of invoice appointment_at, staff/bay capacity, multi-service appointments. These need the next workflow step; do not claim payment/install booking synchronization is complete. Do not create a second appointment blindly when a sale is confirmed.

Source is still preserved in this isolated non-git directory and directly uploaded to Vercel. GitHub reconciliation remains necessary before the next Git-triggered release. Staff HR migrations remain unapplied/unincluded.


### Car-tint sale → installation booking — 25 October 2026, LIVE

Deployment dpl_H3FigTaAyaXai1ZcHfHisZXNw7qN; compatible migration 20261025030000_garage_sale_appointments.sql applied before deploying client/API. This supersedes the earlier invoice-sync pending note for the current car-tint payment flow only. Shared Used Car features unchanged.

Payment checks matching private installation bookings by customer/vehicle/service; one match is preselected, multiple matches require choice. An existing booking is reused after all invoice, tint items/addons, receipt and installer-job steps succeed; a new entered appointment creates exactly one booking per invoice, with an explicit editable end datetime defaulting to one hour. No appointment remains an explicit option, including during lookup failures. The final link action derives identity from session, validates invoice and booking ownership/customer/vehicle/service, rejects stale changes and other-sale linkage; a unique invoice index and idempotent RPC prevent booking duplication within the same invoice. Retryable transaction errors retry once, same payload.

Calendar changes sync starts_at/cancellation to installer invoice appointment_at. Linked identity/service/kind are fixed in the form and validated if changed. Cancelling the appointment leaves the invoice and installer job intact, clearing its appointment date. A failed confirmation discards a known partial invoice and reloads bookings. Existing bookings survive invoice rollback; bookings generated solely by a rolled-back sale are cancelled. Failed rollback disables repeated confirmation until manager recovery. Outdated confirmation UI results are guarded across route/account generations.

Claude reviewed SQL/API lock ordering and idempotency. Applied revision validation, null-safe permissions, explicit timezone validation inherited from appointment API, precise retry/conflict mappings, conditional trigger writes so note edits do not touch invoices, and failed-sale generated-booking cleanup. New bookings created by directors for an existing salesman's invoice are owned by the invoice creator. Legacy invoice deletion can deadlock with rescheduling; Postgres aborts one side, mapped to a bounded retry or explicit recovery error.

Validation: disposable DB suite with booking reuse/idempotency, cross-staff privacy, installer date synchronization, cancellation keeps sale, rollback behavior; nine appointment API checks; three actual-client bounded-retry checks; TypeScript/Vite production build. Isolated real Payment UI: simulated installer failure produced zero invoices and kept original booking; successful retry produced one invoice/one linked existing booking; new manual date produced one additional invoice/booking and defaulted end time correctly. Invoice/tint/job operations were isolated test adapters, not real production transactions. Production rollback-only check passed reuse, sync/reschedule/cancel and generated-booking cleanup, with zero test customer/invoice/booking records left. Explicit TEST invoice numbers avoided consuming the live invoice sequence. Deployed client strings and unsigned API401 verified.

Remaining limits: full legacy multi-step invoice creation is not globally idempotent if the invoice-create response itself is lost before its ID is known; this feature's deduplication is per known invoice. Do not promise fully atomic order confirmation. No multi-service/bay capacity scheduling or cancelled-sale rebooking UI added. Calendar edit UI still has one start date/end time; multi-day reschedule UX needs improvement. Other product sale flows and Building invoice linkage remain unverified/unimplemented, not claimed ready. Installer screens fetch the synchronized date on load; no new live push notification was added.

Source remains in this isolated directory, directly uploaded to Vercel, not yet reconciled/pushed to GitHub. Do that before a future Git-triggered deployment. No staff HR migration included.
