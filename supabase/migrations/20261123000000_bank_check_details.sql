-- Bank check: each statement line keeps its details with it: who was paid, the
-- bills ticked for a transfer, the Director's answer, and how it was recorded.
-- Rows are only read and written by the Director through the private finance API.
alter table public.bank_transactions add column if not exists details jsonb not null default '{}'::jsonb;
notify pgrst, 'reload schema';
