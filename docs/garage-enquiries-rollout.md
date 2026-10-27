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


### Connection-loss confirmation recovery — 25 October 2026

New compatible migration 20261025040000_garage_atomic_confirmation.sql adds a private staff/request ledger and a single transaction for the current car-tint sale: invoice, tint order, each glass item, add-ons, installer job and optional booking linkage. Any child/booking failure rolls all those writes back. This supersedes the previous multi-step-confirmation limitation for this updated route, after its deployment is live. Existing old client routes remain unchanged until the update loads.

Confirm/status/abandon share a namespaced advisory lock. Replayed requests return the same invoice; changed payloads cannot overwrite it. Abandonment leaves a tombstone, blocking delayed requests, and returns a stable replacement key for deliberate edits. Removed invoices never cause the old request to create a new sale. The API derives staff from the verified session; raw ledger reads and RPC access remain closed to browsers.

Client freezes a durable intent before its first network write. Pending intent is scoped to staff/customer/vehicle in localStorage; completion markers are per tab/history route in sessionStorage. Same quote carries a stable confirmationId through Summary/Back/Payment; new quote gets a new ID. A namespaced Web Lock prevents another tab replacing pending details, and the stored payload cannot be silently changed. Unfinished attempts on the same browser survive tab closure. Recovery on another PC/browser is not automatic; use existing work orders to check outcomes. Fresh independent quotes remain independent sales.

Receipt storage is separate from committed sale data. A failed attachment never deletes the saved invoice/job. Receipt retry uses invoice+recovery key+content SHA-256; identical upload409 is accepted before retrying invoice receipt metadata. It does not require storage UPDATE/upsert grants. Replacement files get distinct content paths. Refresh requires selecting the original file again when it has not uploaded. API status reports authoritative payment/receipt state.

Validation: Claude found no definite must-fix in the initial transaction/replay design; verified the existing booking function raises, enforces ownership/customer/vehicle/service and is invoked with server actor. readJson is synchronous. Prices/totals remain the existing user-entered quote arithmetic; no new pricing model or server repricing added. Applied namespaced locks, durable scoped recovery, corruption checks, stable quote keys and controlled successor references afterward with focused regression checks.

17 focused API/client/receipt tests pass, plus disposable Postgres integration for all-or-none writes, replay, cross-staff recovery privacy, changed payload, abandoned requests, child/booking conflict and receipt status. Real Payment screen against disposable Postgres passed: reply lost AFTER commit → one invoice/job/booking retained and retry recovered it; refresh rechecked same saved sale; drop BEFORE commit → unsaved status/abandon/new confirmation safe; receipt failure → sale kept, refresh/reselect/retry attached without another invoice/job. Final stable-quote abandonment/reconfirmation check also passed. Tests excluded from deployments; no production financial records were created by these checks. Live production metadata preflight found all required columns. Production rollback-only check exercises status/abandon/late-request rejection without creating invoices or consuming invoice sequence values.

Remaining: installer team receiving/execution still needs workflow review. Other product confirmation flows not claimed ready. Legacy invoice/receipt APIs outside the new confirm route retain their existing security model. Source remains directly deployed from this isolated directory, not GitHub-reconciled. No Used Car workflow or staff HR changes included.

Confirmation recovery is LIVE in dpl_mVrg7YGxxA9qbFF8H4ZerTc5Y9Td. Production setup and rollback-only status/abandon/late-request checks passed; private grants remain closed, temporary recovery rows0, and no production invoices or invoice sequence values were used. Main bundle contains the recovery client and unsigned sales API returns401. Scope remains current car-tint confirmation.

### Installer workflow audit — 25 October 2026 (review only)

Added tests/garage-installation-db.integration.mjs using disposable PGlite and the actual legacy migrations. Passed shared team claims, claim ownership, usage delta accounting, unfinished-submission rejection, correction reasons and return flow, final inspection requirement, approved-job locking and paid/unpaid routing. No production installation or financial records were changed. Known business gap: pieces can be completed without recorded film usage.

Reproduced an identity weakness on a fictional disposable job: an anonymous caller with the legacy browser grants can supply a manager ID to approve. Read-only production metadata confirms anon EXECUTE on approve_garage_installation, supplied actor checks, anon users SELECT, jobs/invoices UPDATE and activity INSERT; installer-job policy is ALL USING(true) WITH CHECK(true). Production has zero installer jobs and zero approved installer jobs at audit time. No live exploit was attempted.

Claude reviewed the findings and agrees identity enforcement should precede film-usage changes. Proposed fix must cover the complete installer read/write surface and old RPC/direct-write bypasses, derive actor from verified server session, use authoritative protected roles and pin definer search_path. Do not merely wrap approval while leaving legacy mutations open. Rollout must preserve existing sales/receipts and refresh cached old clients. Business decision on final approver roles is pending; no live installer permission, UI or deployment changes made in this audit. This security gap remains open.


### Installer / Head / salesman review — local implementation, 26 October 2026

NOT LIVE. Production SQL and Vercel were not changed. New migration 20261025050000_garage_installation_review.sql and /api/garage/installation are prepared in this isolated source directory. Source is still not GitHub-reconciled.

Car tint flow: required glass pieces belong to their claiming installer; each installer explicitly confirms their own completed contribution. All pieces complete and all contributors confirmed automatically submits to Garage Head. Only private authoritative garage_head role may approve/return; directors/shareholders cannot bypass. Head approval moves invoice into sales_inspection. Only original invoice creator can pass that final check. Sales rejection enters head_correction_review. Head selects affected glass and correction/replacement reason; pieces return to the SAME installers, with evidence history retained and confirmations reset. All involved workers reconfirm, then Head reapproves, then salesman rechecks. Delivery requires both checks and payment. No sub-head, reassignment or delegation added.

In-app actionable Head/sales notices refresh every 15 seconds/focus while Garage is open; no background push, SMS or email. UI is included in existing job/invoice screens and top-level Garage shell. Separate state labels and salesman pipeline node distinguish workshop approval from customer inspection. Piece mutations trigger review refresh so immediate confirmation uses current revision.

Verified-session server derives actor; SQL checks private staff role/active state. Service-only RPC serializes invoice -> job -> review -> piece/stock, validates revision, and persists idempotent request results. Old mutation RPCs and direct Garage invoice/job/piece/order/activity writes are revoked for browser roles. Receipt metadata moved to authenticated action, retaining content-hash storage retry semantics. Finance permissions for private managers and owner remain; payment is allowed during both review stages. Installation history omits receipt paths/payment values. Public legacy staff/storage/general Garage read policies outside this feature still need separate review; do not claim whole app secure.

Read-only snapshots do not lock or create review rows. Migration backfills existing submitted, approved and delivered jobs; historical deliveries remain ready without fabricated salesman timestamps. Legacy completed-but-unapproved jobs preserve completion evidence then require Head review. New jobs get review rows through a trigger. Migration must be applied once in a transaction, coordinated with API/client release and old-client refresh. No production migration has been applied.

Validation: 44 focused API/client/login/sale/appointment/receipt tests passed; disposable Postgres workflow tests passed original-installer corrections, personal confirmations, Head-only role checks, salesman rejection, repeated/stale requests, delivery gate, unauthorized old RPC/table/receipt writes, read-only snapshot, atomic sale creation after lockdown, manager finance permissions and payments during new review stages. Separate historical migration tests passed submitted/approved/delivered/legacy-completed handling. Final TypeScript/Vite production build passed including the item-refresh wiring. Claude reviewed changes in a disposable accessible source copy in three rounds, found no new implementation blockers in the final migration/client-cache review. Claude did not run tests. Temporary review source copy was removed after review; the isolated release source remains intact. Visual QA is NOT complete: browser connection returned unavailable/no browsers. Isolated fictional trial runs at http://127.0.0.1:5192/tests/installation-ui/index.html; user can select sample installer/head/sales roles, no real login needed.

Known deliberate limits: original salesman or installer unavailable/disabled blocks their step; no manager override or reassignment was authorized. Head must return at least one piece after salesman rejection; no dismiss-complaint path. No damage/check-in, multi-service, building planner, stock-business-rule or HR changes. Workshop legacy financial/read/storage paths outside this workflow are not fully audited. Test data are local in-memory only and restart resets trial.

### Phone-accessible installation demo — 26 October 2026

Published a separate static fictional screen demo at https://autodream-garage-review.vercel.app/installation/index.html, existing review project only, deployment dpl_3bENWXjkGeMGEwwW3CKPQwSyjXAP promoted READY. Main autodream.vercel.app and production database unchanged. Existing enquiry review files preserved; rewrite excludes installation assets. HTTPS checks returned 200 for demo HTML/JS/CSS and existing /garage/enquiries review. Bundle contains demo-only copy and no Supabase URL or live Garage API reference.

Actual review/notification components reused with static fictional adapter, four role choices, sample glass pieces, both inspection stages and correction/replacement loop. This phone demo uses browser-local state, NOT the actual SQL/server backend. Separate adapter test passed completion, approvals, correction, original-installer attribution and reset. Mobile demo build passed. No real login, payments, staff/customer information or backend access included. Screen interaction/visual QA still pending because browser connection unavailable; user reviewing phone trial next. Demo source tests/installation-mobile-preview; build outputs outputs/installation-mobile-public copied to separate public review directory. Production implementation/migration remains NOT LIVE.

### Car diagram and pipeline preview — 26 October 2026

User rejected staff-switching/form-like trial and approved a top-down tappable car with pipeline. Design direction: actual black #000, graphite #17191b, muted glass #53616b, warm gold #ddc58f for claimed work, green #74b991 for completed pieces, orange #db936b for correction. System sans type, quiet text, one central car illustration. Layout: car identity -> four-step pipeline -> diagram plus contextual actions; stacked on phone, side-by-side on desktop. Glass itself is the control; no prominent demo-role selector or free-text form. This is a reusable SVG/code component, not generated raster art.

Added src/components/GarageCarGlassMap.tsx and replaced the static public demo entry/CSS/adapter. Six individually tappable glass sections, claim/complete details sheet, per-piece state, personal confirmation and automatic role progression ONLY inside the fictional demo. Pipeline Installing -> Head check -> Salesman check -> Handover. Head/sales issue flow begins by tapping specific glass, then issue chips; returned piece keeps original installer. Mobile primary actions stay in reach. Modal focus/Tab/Escape/restore and keyboard-operable glass; excluded quarter glass hidden/noninteractive. Actual main app not integrated with this new diagram yet; underlying production SQL still not deployed.

Claude read-only reviewed exact file copies twice; functional concerns addressed. Review copies' four SHA-256 hashes matched actual build sources (paths differ because review folder is only a copy). Adapter flow/ownership/replacement/reset checks passed and shared component TypeScript check passed. Browser at phone viewport tested all six claims/completions, personal confirm, Head approval, salesman issue on rear windscreen, Head replacement back to original installer, re-completion/reapproval and final handover-ready. Dialog autofocus and restored pane focus verified from accessibility state. Phone screenshot saved outputs/car-diagram-phone.png; public page visibly shows new car and pipeline, no old role selectors.

Review deployment dpl_Ejcjjpx3pNJLkcLBHdLx9CoKADtw promoted READY at https://autodream-garage-review.vercel.app/installation/index.html. Existing user tab reloaded and verified. Only static review project updated; no live AutoDream app or database modification. Original demo state key superseded by diagram-demo-v2. Last artifact JS index-BFKoSN_7.js / CSS index-Dw9gDssl.css. Local preview server port5193 may be stopped after review; public link remains available.


## MPV and optional roof review — 26 October 2026
- Preview only; main application/database unchanged. Review deployment dpl_3G32NoU6ucS9trwWdyzrbnqSYFRc promoted to https://autodream-garage-review.vercel.app/installation/index.html.
- Added generic Alphard/Vellfire-style MPV, sliding-door and quarter glass, none/single/split/panoramic roof samples (8/9/10/9 pieces). Each sample persists separately; roof pieces participate in installation/Head/Sales gates. Exact vehicle specification still requires human confirmation.
- Claude reviewed exact source copies in work/mpv-review. Fixed unused accessible label and wrong MPV subtitle; final review no code blockers. Copies are not a build tree; actual isolated tree TypeScript check, Vite build, sedan/coupe and all four MPV workflow tests passed. Browser verified MPV count, split roof claim/completion, and phone layout. Screenshot outputs/mpv-roof-phone.png.
- Built-in image_gen generated transparent MPV body; project asset tests/installation-mobile-preview/assets/mpv.png. Original exec-43da8bd9-f0e3-42d4-87e2-a8d0bb1e7148.png in Codex generated_images. Prompt: Production UI asset, premium silver luxury MPV similar proportions to Alphard/Vellfire, no logos, exact overhead front up, sliding doors, plain silver roof without sunroof (coded separately), transparent background, portrait with generous margins, studio lighting. All tappable glass is native SVG over artwork.


## SUV / van / bus and job glass setup — 26 October 2026
- Review-only deployment dpl_GCGrEDKDFTJkeYTr4JWfkDmXeWAn promoted to https://autodream-garage-review.vercel.app/installation/index.html. Main application and database unchanged. No GitHub reconciliation performed.
- Six generic templates: sedan, coupe, MPV, SUV, van (0–6 passenger windows/side), bus (1–10/side). Roof choices on non-bus templates. Exact model/year geometry still needs vehicle confirmation.
- Separate Set up glass panel: local draft roof/rows/checkboxes, atomic Apply, Cancel leaves saved sample unchanged. Map/pipeline hidden during setup. Only selected pieces render and participate in workflow. Configuration locks after any claim; roof/rows helpers enforce same lock. Each body saves independently under v5 demo keys; older demo keys retained.
- Claude reviewed exact source copies in work/vehicle-templates-review. First review identified configuration lock trap, overlapping roof targets and stretched caps; fixed with one job per body, atomic configuration, separated roof hit areas and three SVG image slices (front/rear fixed, middle extends). Second review no blockers. Also added invalid-review recovery, aria-controls/Escape/focus restoration and rear-cap margin.
- Validation: TypeScript check, Vite build, comprehensive adapter integration tests passed (six templates/roof variants/row bounds/selected subsets/reload/corrupt saves/setup locks/excluded claims/two installers/Head-Sales gates/original installer correction). Browser checked public SUV roof and included counts, locked setup on claim, panel van and six-window van, and bus ten-window layout. Public screenshot outputs/vehicle-templates-phone.png.
- Artwork generated by built-in image_gen, transparent requested, no external model/API keys. Project assets tests/installation-mobile-preview/assets/{suv,van,bus}.png. Original outputs respectively exec-c9a2f5d2-c486-4130-a5c5-e2a96bdbea3e.png, exec-4a8e6deb-3d72-4b9e-81ce-c2ef2416b828.png, exec-eb479fd4-5aa1-47e1-ab5a-a850a9149af1.png under Codex generated_images.
- Image prompt template: Production automotive UI illustration: [silver five-door SUV / silver long passenger van with sliding doors / silver midsize passenger coach bus]. Exactly orthographic overhead top view, front upward, single complete realistic centered vehicle on portrait transparent canvas. Refined silver bodywork, dark blue-grey windows, studio lighting, no logos/text/UI/labels. Plain closed metal roof, interactive glass coded separately, generous margins, premium realistic 3D workshop-app rendering.


## Live vehicle glass integration — 27 October 2026 — PREPARED, NOT DEPLOYED
User explicitly authorized going live because Garage is unused and team will key existing data for trial. Pricing clarified: sunroof/moonroof separately agreed-price addons at closing; van/bus agreed base job price, often based on sqft/case. Do not invent rates.

New src/utils/vehicleGlass.ts; GarageGlassSetup.tsx; GarageJobGlassMap.tsx + scoped CSS. Actual GarageTintPackage configures body/roof/sideRows and included selections. New roof prices required explicitly; van/bus base price required; quote calculations round to cents in tintQuoteTotal.ts. Existing grids for other bodies retained. Selection/prices survive Summary Back; Payment JSON copies all pending fields. Summary and invoice glass rows show roof addon amount. Saved order mapper validates vehicle_layout. Installer diagram calls verified installation API for claim/complete; additional legacy extras have their own tappable buttons, detailed cards collapsed under Film usage and glass details. Portal sheet/focus/scroll lock. Invoice shows same saved diagram. Generated assets copied to public/garage-vehicles. Used Car pages/workflows unmodified.

New migration 20261026000000_garage_vehicle_glass_layout.sql adds nullable order vehicle_layout and service-only validated layout helper; replaces atomic confirmation RPC with allowed chosen positions (max32) and stores config in same sale transaction. Missing config backwards compatible. MUST APPLY existing prepared installation-review migration 20261025050000 first, then this migration, before new client. Neither has been applied to production. Need production schema preflight to confirm either already exists before running; migrations not rerunnable. Previous main release still dpl_mVrg7YGxxA9qbFF8H4ZerTc5Y9Td (verified Vercel inspect).

Validation: TypeScript passes; production build passes after extracting dedicated garage-glass chunk to stay under PWA 2MiB precache cap (no raised limit). 26 API/client/recovery tests pass including actual authenticated sales API preserving layout/agreed pricing; 5 quote tests pass roof charges only once, case-price base replacing grid, discount/cents. New tests/garage-vehicle-layout-db.integration.mjs passes entire existing workflow + actual layout migration, bus24/van18/SUV roof/coupe persisted pieces, replay and invalid configs with no partial invoices. Legacy DB migration test passes historical queues and delivered jobs untouched. No test production records created. Last source modifications are small display labels/guards/helper; final build launched session27417.

Claude reviewed exact copies in main-repo work/live-glass-review twice. Initial dependencies requested then supplied; mapper null/shape validation added, extra panes action buttons, money rounding, portal; review found no other definite blocker. Reviewer mistakenly described public write policy as unclosed: actual prepared installation migration revokes table mutations and DB tests verify denial. Import resolution in review copies intentionally not a build tree.

BLOCKER: browser CUA browser2 unavailable; inventory returned zero browsers. Requested user asynchronously reopen in-app browser and Supabase dashboard and reply done. Open_in_codex Supabase SQL URL returned queued, no dashboard access confirmed. Need UI QA of actual production components/harness and live metadata/setup. Do not claim live or deploy main client until production DB setup succeeds. All code in isolated C:/Users/ericl/Documents/Codex/autodream-enquiries-release, not GitHub reconciled. Original repo only has disposable review copies.


### Phone activation handoff — 27 October 2026
User is on phone; phone Supabase login does not connect desktop browser. CUA inventory no browsers and create iab failed, no UI mutation performed. User ran preflight in phone Supabase and supplied screenshot showing installation_ready=false,layout_ready=false.
Prepared outputs/garage-activation.sql (both migrations wrapped in one BEGIN/COMMIT, checks both uninstalled, schema reload notification, final booleans). Exact combined script tested by tests/garage-activation-script.integration.mjs on disposable database: installs both, closes legacy browser table/approval access, second run refuses and rolls back. SHA256 of normalized LF script: ff62162968a2fa990dbbc3c8765588458909751c6bd1127f3d078749f8b2d08d.
Phone copy-only page https://autodream-garage-review.vercel.app/setup/garage-activation.html published as review deployment dpl_6vdHwwkC3STJQPiEJZDCERNBEbkW. Contains escaped SQL in pre, external same-origin copy script with long-press fallback; no credentials/database connection/execution. Existing CSP unchanged; rewrite now excludes setup/. HTTPS fetch verified rendered page script text EXACTLY equals tested SQL and JS/CSS 200. Main AutoDream still NOT DEPLOYED; no database changes by agent. Await user run result screenshot; both true means deploy prepared main app next. If error, do not repeat blindly; entire script transaction should roll back. Remove temporary setup page after successful activation when practical.


### Garage installation and saved vehicle layouts — LIVE, 27 October 2026

User approved database activation and main-app deployment in recovery chat. Both migrations 20261025050000 and 20261026000000 installed together using exact tested activation SHA-256 ff62162968a2fa990dbbc3c8765588458909751c6bd1127f3d078749f8b2d08d. Fresh readiness booleans true; service-only workflow grants and legacy anonymous approval/invoice/order-write denial verified. No existing invoices or installer jobs at activation. Existing schema/ACL snapshot preserved, scheduled backup confirmed.

Production deployment dpl_4XoeTSy9zzswJcKFyrMBXYXqX51G promoted to https://autodream.vercel.app after successful database verification. Built by Vercel with existing production variables, shared secure login retained. Source-only export of recovery revision 49839c0; local recovery branch retains original ancestry and exact live baseline.

Live checks: new installation API present and unsigned POST401; sales POST401; new glass chunk and five vehicle artwork files200; sign-in screen renders. Service-only bus24/van18 layout functions and active Head notice read pass. Local 130 tests, disposable database workflows and phone component/real-handler correction loop passed before deployment. No real customer/job/payment test records created. Live browser signed out; end-to-end staff trial still required. Other services, HR and full building workflow not claimed complete.


### Production request-limit contract correction — 27 October 2026

Signed-in user reported workshop notification refresh warning. Production logs confirmed repeated installation endpoint500. The installation throttle key used a prefix longer than the existing database limit and a raw staff ID rather than a fixed-format hash. API fixture previously mocked throttleHit unconditionally, so initial tests missed the production contract.

Changed installation to install:SHA256(staff ID); discovered same overlong prefix in existing sale-confirm and appointments handlers, corrected to sale:SHA256 and appt:SHA256 respectively. Limits/windows/authentication/permissions unchanged; no database migration. New regression initially reproduced500, then passed; actual PostgreSQL throttle migration exercised through authenticated installation, appointment-list and sale-status handlers for short, punctuated and long staff IDs. All131 automated checks pass.

First fix deployment dpl_DsYKCjtCMtEYDwRb9ziEf3WYoDkd verified on signed-in production page: warning absent and repeated notification POST200. Follow-up booking/sale correction deployment is recorded in the recovery release manifest. No customer, job, appointment or financial records were created during this verification.
