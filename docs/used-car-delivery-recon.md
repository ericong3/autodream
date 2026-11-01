# Used Car delivery repair and recon commission

Owner approved on 1 November 2026. Garage work remains paused.

PPU7298 had a delivered customer (30 October) and collection confirmation, but its car status was available. Restore only its car status to delivered. The historical actor that reverted it is unknown; cancellation screens contained direct writes that bypassed the existing client lock. Database triggers now refuse status regression or cancellation of delivered car/customer deals, including writes from old browser tabs. Normal stock edits, work orders before delivery and delivery date corrections remain possible.

Noah is recon with RM2,000 sales commission. Recon classification is independent of incoming consignment or company ownership. Its existing ownership, price and delivery date stay unchanged. The guarded installation updates its per-unit commission and matching customer commission; no commission payment existed at preflight. No payment or payslip is generated or changed.

Directors can edit vehicle type and per-unit commission in Edit Car, or adjust the amount in Commission. Precedence: waived/staff/outgoing = zero; explicit per-unit amount; saved customer deal rate; recon default RM2,000; otherwise incoming consignment/below explicit price floor RM1,000, standard RM1,500. An existing deal rate is retained when the per-unit field is blank. Payment records are historical records; changing a rate does not rewrite an existing payment. New delivery/backfill/monthly payroll entries and profit/commission displays use the shared calculation.

Installation: `used-car-delivery-recon-INSTALL-AND-CHECK.sql`, not all pending migrations. It checks exact current target records and refuses if their delivery or payment state changed. Schema and three record corrections commit together; a private RLS audit stores before/after state. Re-running stops rather than applying twice.

Validation: full application tests and build; targeted commission/payroll/backfill cases; PostgreSQL rehearsal of both guards and the exact installer, including stale cancellation rejection, ordinary edits, unchanged payments/ownership/delivery dates and repeat refusal.

Bonus Campaigns remains separate from payments. Publishing the October–December campaign requires its enrolment to be confirmed; confirming a monthly bonus does not pay salaries.
