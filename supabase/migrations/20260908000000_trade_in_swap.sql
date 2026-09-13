-- Links a Coming Soon car back to the deal that produced it as a trade-in
-- (comingSoonType = 'trade_in'), and gives the ledger somewhere to book the
-- non-cash side of a trade-in/swap instead of pretending it was a cash sale
-- and a cash purchase that never happened.
alter table cars
  add column if not exists trade_in_source_car_id text references cars(id) on delete set null;

insert into ledger_accounts (id, name, type, investor_tagged) values
  ('acct-trade-in-clearing', 'Trade-In Clearing', 'asset', false)
on conflict (id) do nothing;
