-- Bank check, "Before 1 Nov": the Director's answers about books entries that no
-- old statement line stands for are kept on the history upload row. Drafts only:
-- nothing here changes the books.
alter table public.bank_statement_uploads add column if not exists details jsonb not null default '{}'::jsonb;
notify pgrst, 'reload schema';
