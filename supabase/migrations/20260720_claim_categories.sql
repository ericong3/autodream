-- Admin-managed list of expense claim categories, replacing the hardcoded
-- list in the app. 'kind' decides which car cost bucket a confirmed claim
-- in that category writes into (repair job vs misc cost).
create table if not exists claim_categories (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('repair', 'misc')),
  created_at timestamptz not null default now()
);

-- Seed with the categories the app already shipped with, so existing claims
-- and the Claims form keep working exactly as before until admin edits the list.
insert into claim_categories (id, name, kind) values
  ('seed-petrol', 'Petrol', 'misc'),
  ('seed-puspakom', 'Puspakom', 'misc'),
  ('seed-road-tax', 'Road Tax', 'misc'),
  ('seed-office-supplies', 'Office Supplies', 'misc'),
  ('seed-invoicing-charge', 'Invoicing Charge', 'misc'),
  ('seed-repair', 'Repair', 'repair'),
  ('seed-paint-job', 'Paint Job', 'repair'),
  ('seed-parts', 'Parts', 'repair'),
  ('seed-other', 'Other', 'misc')
on conflict (id) do nothing;

-- This project enables RLS on new tables by default with no policies (fully
-- locked). Matching every other table in this app (RLS either off or a
-- blanket allow-all policy) rather than introducing a one-off stricter rule
-- that can't actually be enforced without real per-user auth in place yet.
create policy "claim_categories_all" on claim_categories for all using (true) with check (true);
