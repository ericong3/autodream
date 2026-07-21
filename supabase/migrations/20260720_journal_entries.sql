-- General ledger — balanced double-entry postings. 'lines' holds the debit/
-- credit rows as JSON (same convention as repairs.parts, work order
-- additionalItems elsewhere in this schema) rather than a separate child
-- table, since entries here are small and always read/written as a whole.
--
-- Never hard-deleted once posted — corrections use voided/voided_by/
-- voided_at/void_reason so there's always a trail of what was recorded and
-- why it was reversed, matching standard bookkeeping practice.
create table if not exists journal_entries (
  id text primary key,
  date date not null,
  description text not null,
  lines jsonb not null default '[]'::jsonb,
  source_type text,
  source_id text,
  car_id text references cars(id),
  created_by text,
  created_at timestamptz not null default now(),
  voided boolean not null default false,
  voided_by text,
  voided_at timestamptz,
  void_reason text
);

create index if not exists journal_entries_source_idx on journal_entries (source_type, source_id);
create index if not exists journal_entries_car_idx on journal_entries (car_id);

alter table journal_entries enable row level security;
create policy "journal_entries_all" on journal_entries for all using (true) with check (true);
