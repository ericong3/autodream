-- ROLLOUT GATE: apply only alongside verified shared-login activation.
-- Deploy the server customer adapters first. Staff must finish enrollment.
-- Applying this early deliberately stops legacy customer reads and writes.
drop policy if exists garage_customers_all on public.garage_customers;
revoke all on public.garage_customers from public,anon,authenticated;
alter table public.garage_customers enable row level security;
