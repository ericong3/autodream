-- Investor wallet transactions: buy_in, top_up, withdrawal
create table if not exists investor_transactions (
  id text primary key,
  investor_id text not null references users(id) on delete cascade,
  type text not null check (type in ('buy_in', 'top_up', 'withdrawal')),
  amount numeric not null,
  status text not null default 'completed' check (status in ('completed', 'pending', 'approved', 'rejected', 'transferred')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  due_date timestamptz,
  waiting_months integer,
  approved_by text,
  rejected_by text,
  rejected_at timestamptz
);

-- Enable realtime
alter publication supabase_realtime add table investor_transactions;

-- Index for fast lookup by investor
create index idx_investor_transactions_investor on investor_transactions(investor_id);
