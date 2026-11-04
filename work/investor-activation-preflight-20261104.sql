-- Read-only production preflight. No customer/staff values, tokens or secrets.
BEGIN READ ONLY;
SELECT jsonb_build_object(
 'checked_at',now(),
 'schema',(SELECT jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'udt',udt_name,'nullable',is_nullable)) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('users','cars','repairs','payments','journal_entries','ledger_accounts','garage_building_staff','autodream_staff_invitations','autodream_email_tokens') AND column_name IN ('id','car_id','role','business_access','registration_status','enabled','purchase_price','investor_id','investor_split','consignment','outgoing_consignment','status','type','amount','lines','date','created_by','voided','target_id','staff_id','invitation_id','used_at','email_verified_at','parts','labour_cost','total_cost','actual_cost','completed_at','location','type_of_repair','receipt_photo')),
 'new_tables',(SELECT coalesce(jsonb_agg(table_name),'[]'::jsonb) FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE 'uc_investor_%' OR table_name LIKE 'uc_finance_%' OR table_name LIKE 'uc_bank_%')),
 'legacy_investors',(SELECT count(*) FROM public.users WHERE role='investor'),
 'legacy_investor_cars',(SELECT count(*) FROM public.cars WHERE investor_id IS NOT NULL),
 'legacy_investor_transactions',(SELECT count(*) FROM public.investor_transactions),
 'finance_row_counts',jsonb_build_object('payments',(SELECT count(*) FROM public.payments),'journal',(SELECT count(*) FROM public.journal_entries),'bank_lines',(SELECT count(*) FROM public.bank_transactions)),
 'investor_ledger_balances',(SELECT jsonb_agg(x) FROM (SELECT l->>'accountId' account,sum((l->>'debit')::numeric-(l->>'credit')::numeric) balance FROM public.journal_entries j CROSS JOIN LATERAL jsonb_array_elements(j.lines) l WHERE NOT j.voided AND l->>'accountId' IN ('acct-investor-payable','acct-inv-investor','acct-rev-investor-share','acct-bank-investor') GROUP BY l->>'accountId') x),
 'public_finance_grants',(SELECT jsonb_agg(jsonb_build_object('table',table_name,'role',grantee,'privilege',privilege_type)) FROM information_schema.table_privileges WHERE table_schema='public' AND table_name IN ('users','payments','payslips','journal_entries','bank_transactions','bank_statement_uploads','investor_transactions') AND grantee IN ('PUBLIC','anon','authenticated')),
 'public_definer_functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'anonymous',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')) AND p.prosrc ~* '(users|payments|payslips|journal_entries|bank_transactions|bank_statement_uploads|investor_transactions)'),
 'latest_recorded_migration',(SELECT max(version) FROM supabase_migrations.schema_migrations)
) AS investor_preflight;
ROLLBACK;
