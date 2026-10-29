-- Read-only metadata only. No customer values, bank details or passwords.
SELECT jsonb_build_object(
 'checked_at',now(),
 'columns',(SELECT coalesce(jsonb_object_agg(table_name,columns),'{}'::jsonb)
   FROM (SELECT table_name,jsonb_agg(jsonb_build_object('name',column_name,'type',data_type) ORDER BY ordinal_position) columns
     FROM information_schema.columns WHERE table_schema='public'
     AND table_name IN ('external_salesmen','cars','customers','garage_building_staff','garage_invoices','garage_tint_accounts','garage_tint_payments')
     GROUP BY table_name) t),
 'account_constraints',(SELECT coalesce(jsonb_agg(pg_get_constraintdef(oid)),'[]'::jsonb)
   FROM pg_constraint WHERE conrelid=to_regclass('public.garage_building_staff') AND contype='c'),
 'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'signature',p.oid::regprocedure::text,'definition_hash',md5(pg_get_functiondef(p.oid)),
   'private',NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE'))),'[]'::jsonb)
   FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
   ('garage_sale_confirmation','garage_tint_finance','garage_tint_money_snapshot','garage_installation_workflow','deliver_garage_work_order','autodream_account_action','autodream_existing_staff_action'))
);
