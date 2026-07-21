-- Chart of Accounts — the foundation for real double-entry bookkeeping.
-- Admin-managed (Finance -> Chart of Accounts), seeded with the structure
-- agreed on for this business: accrual on payables, investor floor-plan
-- treatment (separate inventory + capital payable, profit split on sale),
-- and cost capitalization driven by car-linkage, not category label.
create table if not exists ledger_accounts (
  id text primary key,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'cogs', 'expense')),
  investor_tagged boolean,
  notes text,
  created_at timestamptz not null default now()
);

insert into ledger_accounts (id, name, type, investor_tagged) values
  ('acct-bank-operating',        'Bank — Operating',                    'asset',     false),
  ('acct-bank-investor',         'Bank — Investor',                     'asset',     true),
  ('acct-inv-own',               'Inventory — Own Stock',               'asset',     false),
  ('acct-inv-investor',          'Inventory — Investor Stock',          'asset',     true),
  ('acct-ar',                    'Accounts Receivable',                 'asset',     null),
  ('acct-ap',                    'Accounts Payable',                    'liability', null),
  ('acct-investor-payable',      'Investor Capital Payable',            'liability', true),
  ('acct-customer-refunds',      'Customer Refunds Payable',            'liability', null),
  ('acct-equity',                'Owner''s Capital / Retained Earnings','equity',    null),
  ('acct-rev-car-sales',         'Car Sales Revenue',                   'revenue',   false),
  ('acct-rev-investor-share',    'Company Share of Investor Car Profit','revenue',   true),
  ('acct-rev-commission',        'Commission / Panel Charge Income',    'revenue',   null),
  ('acct-cogs-own',              'COGS — Own Stock',                    'cogs',      false),
  ('acct-exp-general',           'General & Admin Expense',             'expense',   null),
  ('acct-exp-salesman-comm',     'Salesman Commission Expense',         'expense',   null),
  ('acct-exp-intake-bonus',      'Intake Bonus Expense',                'expense',   null)
on conflict (id) do nothing;

-- This project enables RLS on new tables by default with no policies (fully
-- locked). Matching every other table in this app (RLS either off or a
-- blanket allow-all policy) rather than a one-off stricter rule that can't
-- actually be enforced without real per-user auth in place yet.
alter table ledger_accounts enable row level security;
create policy "ledger_accounts_all" on ledger_accounts for all using (true) with check (true);
