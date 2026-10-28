# Garage Home shortcuts — live

Request: show each worker's pending jobs/tasks as Home shortcuts. User confirmed balance means the customer's unpaid balance, not pay/commission.

Implemented:
- All authorised Garage sales, manager, workshop and finance roles land on Home. Used Car landing/access is unchanged.
- Home cards link directly to available glass, personal installation/correction/confirmation work, Head inspections, original salesperson final inspections, handover/warranty tasks and customer balance checks.
- Sales only receives its own order cards. Managers receive team order cards and responsible staff names from the private staff directory. Workshop staff receive own/available tint work and no money or payment verification data.
- Customer still to pay is shown separately from collected money awaiting company verification. Balances come from the existing finance RPC, preserving its permission checks. Unavailable balances are marked unavailable, never zero.
- Director/authorised Garage admin receives a payment verification shortcut. Admin does not fetch workshop/customer order lists.
- Refresh on focus and every 15 seconds, plus manual refresh; account changes discard previous-user results. Quick view is bounded to 12 cards with a link to the full workspace. Assigned worker jobs are queried before the shared queue.
- Existing sales pipeline, follow-up/appointment reminders and service job lists remain available. Automated worker cards currently follow the saved car tint workflow; building and other unbuilt workflows are not fabricated.
- New Home reads use the existing tint API router, retaining 11 hosted functions. No database migration, bank transaction, job mutation or permission expansion is required.

Verification:
- 145 automated tests pass, including ownership, workshop money exclusion, manager/Head separation, finance-admin boundaries, confirmation/correction priorities and failed balance lookup handling.
- TypeScript and production/PWA build pass. The temporary circular chunk warning was removed; only the existing large-bundle/advisory warning remains.
- Earlier isolated browser trial verified claim -> personal Home card, sales RM45 order -> RM15 collected/RM30 still payable/RM15 awaiting verification, and admin verification shortcut. No real customer/job/payment records used.
- Final dedicated Garage-layout desktop/mobile preview is pending. The previous local-server restart was rejected because automatic approval review hit its usage limit; that limit has since cleared and restart succeeded. The current browser inventory exposes no browser, so final screenshots could not be captured. The Codex browser preview request is queued for this chat.

Next:
1. Open the in-app browser preview at http://127.0.0.1:5197/tests/home-ui/index.html while the isolated server is running; verify desktop/phone layout and save screenshots.
2. Ask owner approval to publish this Home-only release (prior approval covered the car tint payment/replacement release, not this change).
3. After approval, source-only Vercel build with --prod --skip-domain, then promote and verify signed-in Home reads/navigation. No Supabase changes.

Production remains dpl_D7yvtfv9Vy2zVcXZjH4TFR7qKNHB, source fd55320. All Home changes are local.

Online practice preview — approved 28 October 2026:
- Published a static, separate Preview deployment: https://autodream-qqdoj0bzy-megustaaa95-3177s-projects.vercel.app/#/garage/dashboard
- Deployment dpl_8Uebo4x7rJeVeZppjjtu8gjonjgo. Real CRM remains dpl_D7yvtfv9Vy2zVcXZjH4TFR7qKNHB; its index assets were rechecked unchanged.
- Reuses the actual GarageShell/Home card components with explicitly fictional, browser-only practice fixtures. Role switches: Salesman, Installer, Garage Head, Finance Admin, Director. Shortcut destinations explain their live function without performing any mutations.
- Static output contains no server functions, API integrations, Supabase connections, credentials or production records. A build-time asset scan checks for live integration identifiers. No .env files are used.
- Vercel's existing deployment protection is preserved. Eric may need to sign into his Vercel account from the other PC. No protection token is included in the shared link.
- Preview HTML/assets verified through authenticated Vercel access. Full online visual/browser review still needs an available browser connection. This authorisation was for the separate practice preview; the Home change is not promoted to the live CRM.
- Build script: node tests/home-online-ui/build.mjs. Generated static .vercel/output lives in ../home-online-preview. Release evidence: ../home-online-preview-release.json.


Live CRM rollout — approved 28 October 2026:
- User requested promoting the actual Home changes and will test with real data tonight.
- Source 1c93fe8, deployment dpl_D2uR19gx3gLRKEQpABF8QfNjGYWY, promoted to https://autodream.vercel.app. Previous release dpl_D7yvtfv9Vy2zVcXZjH4TFR7qKNHB preserved.
- 145 automated tests and remote production/PWA build pass. Expected live bundle index-DP9m9VoA.js confirmed. Home/finance/stock/claims endpoints reject anonymous requests with 401 AUTH. No database migration or real production test records.
- Practice preview remains separate. Browser inventory still has no connected browser, so signed-in visual verification is not claimed; real staff trial is pending.
- Evidence: ../home-shortcuts-release-live.json. This LIVE section supersedes earlier local/preview-only checkpoints.
- Next functional gap: building measurements and versioned measured scope exist, but BuildingQuoteVersion contains no monetary price. Building order confirmation, deposits/verified company receipts, scheduling, installer claims, material usage, inspections/handover and after-sales links still need development. Do not claim a full building workflow is ready for tonight.
