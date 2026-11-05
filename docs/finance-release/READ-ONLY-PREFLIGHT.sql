-- READ ONLY. Aggregate/schema checks; does not install or activate anything.
begin read only;
select jsonb_build_object(
 'checked_at',now(),'server_version',current_setting('server_version'),
 'rows',jsonb_build_object('cars',(select count(*) from cars),'payments',(select count(*) from payments),'journals',(select count(*) from journal_entries)),
 'car_ownership',jsonb_build_object('legacy_investor',(select count(*) from cars where investor_id is not null),'incoming_consign',(select count(*) from cars where consignment is not null and consignment<>'null'::jsonb),'outgoing_consign',(select count(*) from cars where outgoing_consignment is not null and outgoing_consignment<>'null'::jsonb)),
 'new_tables',(select coalesce(jsonb_agg(table_name order by table_name),'[]'::jsonb) from information_schema.tables where table_schema='public' and left(table_name,3)='uc_'),
 'column_contract',(select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'udt',udt_name,'nullable',is_nullable,'default',column_default) order by table_name,column_name) from information_schema.columns where table_schema='public' and (table_name='cars' and column_name in ('id','photos','green_card','investor_id','investor_split','consignment','outgoing_consignment','panel_dealer_id','panel_charge_amount') or table_name='payments' and column_name in ('id','type','status','amount','car_id','repair_job_id','misc_cost_id','recipient_id','bank_name','account_number','account_holder') or table_name='repairs' and column_name in ('id','car_id','actual_cost','total_cost','completed_at') or table_name='dealers')),
 'payment_constraints',(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='payments'::regclass),
 'ledger_review_balances',(select jsonb_object_agg(account,cents) from(select l->>'accountId' account,round(sum((l->>'debit')::numeric-(l->>'credit')::numeric)*100)::bigint cents from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where not coalesce(j.voided,false) and l->>'accountId' in ('acct-bank-operating','acct-bank-investor','acct-investor-payable','acct-inv-investor','acct-rev-investor-share','acct-uc-sale-clearing') group by l->>'accountId') q),
 'finance_base',jsonb_build_object('staff',to_regclass('public.garage_building_staff'),'sessions',to_regclass('public.garage_building_sessions'),'bank_statements',to_regclass('public.bank_statement_uploads'))
) as release_preflight;
rollback;
