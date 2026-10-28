# Garage Home shortcuts — local, not published

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
