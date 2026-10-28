# Garage pipeline preview

This branch contains the exact local UI tested on 28 October 2026, based on release 626226b.

- Front three pieces / half car tint selection with existing per-piece prices.
- Garage Head may install their own tint glass.
- Invoice-page claim, film usage and completion controls with immediate pending feedback and server-confirmed row updates.
- Unclaim below Close, requiring a second explicit confirmation.
- Original eight-stage Live Job Pipeline contains the appropriate functions; Installation contains the glass map with the duplicate tracker hidden.
- Payment shortcut permits early deposits without advancing job stages.
- Existing ownership, inspections, payment verification and damage checks remain authoritative.

Validation: 172 automated tests and TypeScript/Vite/PWA production build passed. User is testing locally against the existing live backend.

Database: the owner ran docs/garage-head-tint-INSTALL-AND-CHECK.sql and reported all three flags true at 2026-10-28T14:35:19.871003Z. No additional database change is required for the local pipeline merge. Do not replay all historical migrations.

Production: the main website remains on the Garage Head permission release (dpl_qK5pMDbCuZyfNqYyT92zDjUgYp9E). Invoice-page, smooth-claim, unclaim and pipeline-merge UI changes are local only until separately approved for publication. Pushing this branch is not approval to promote it to production.

Deferred finance/cancellation/lineage/staff-handover/warranty updates are preserved separately on codex/garage-tint-gap-fixes and deliberately excluded from this branch.
