select to_regclass('public.garage_installation_reviews') as installation_reviews,exists(select 1 from information_schema.columns where table_schema='public' and table_name='garage_tint_orders' and column_name='vehicle_layout') as vehicle_layout_column;
select count(*) as existing_installer_jobs from public.garage_installer_jobs;
select role,count(*) as active_accounts from public.garage_building_staff where enabled and registration_status='active' and business_access in ('garage','both') group by role order by role;
