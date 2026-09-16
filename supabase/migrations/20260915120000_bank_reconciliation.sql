-- Bank statement reconciliation: upload a statement, extract its transactions
-- (via Claude, client-side — see src/utils/bankReconciliation.ts), then match
-- each one against an existing pending Payment. Kept as its own pair of
-- tables rather than fields on `payments`, since reconciliation state doesn't
-- apply to every payment.

create table if not exists bank_statement_uploads (
  id text primary key,
  file_path text not null,           -- path in the 'bank-statements' storage bucket (create manually, private, like workshop-documents)
  file_name text not null,
  uploaded_by text not null references users(id),
  uploaded_at timestamptz not null default now(),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed'))
);

create table if not exists bank_transactions (
  id text primary key,
  upload_id text not null references bank_statement_uploads(id) on delete cascade,
  txn_date date not null,
  description text not null,
  amount numeric not null,
  direction text not null check (direction in ('debit', 'credit')),
  suggested_payment_id text references payments(id) on delete set null,
  matched_payment_id text references payments(id) on delete set null,
  status text not null default 'unmatched' check (status in ('unmatched', 'matched', 'ignored')),
  resolved_by text references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_bank_transactions_upload on bank_transactions(upload_id);

-- Matches this app's existing trust model (RLS on, blanket allow — see
-- claim_categories/kanban_columns) rather than a stricter rule that can't
-- actually be enforced without real per-user Supabase auth in place.
alter table bank_statement_uploads enable row level security;
create policy "bank_statement_uploads_all" on bank_statement_uploads for all using (true) with check (true);
alter table bank_transactions enable row level security;
create policy "bank_transactions_all" on bank_transactions for all using (true) with check (true);
