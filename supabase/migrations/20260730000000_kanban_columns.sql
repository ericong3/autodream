create table if not exists kanban_columns (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  card_ids jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_kanban_columns_user on kanban_columns(user_id);

alter table kanban_columns enable row level security;
create policy kanban_columns_all on kanban_columns for all using (true) with check (true);

alter publication supabase_realtime add table kanban_columns;
