-- A car whose salesperson field was cleared is saved as an empty text, not
-- null. Opening a consignment deal then used the empty value instead of the
-- customer's salesperson and stopped with COMMISSION_RECIPIENT_REQUIRED.
-- Treat a blank salesperson as not set.
begin;
do $$
declare f record;src text;n int:=0;
begin
 for f in select p.oid from pg_proc p join pg_namespace s on s.oid=p.pronamespace
  where s.nspname='public' and p.prosrc like '%coalesce(to_jsonb(c)->>''assigned_salesperson'',(select assigned_sales_id::text from customers where id=k.customer_id))%' loop
  src:=pg_get_functiondef(f.oid);
  src:=replace(src,'coalesce(to_jsonb(c)->>''assigned_salesperson'',(select assigned_sales_id::text from customers where id=k.customer_id))',
   'coalesce(nullif(trim(to_jsonb(c)->>''assigned_salesperson''),''''),(select nullif(trim(assigned_sales_id::text),'''') from customers where id=k.customer_id))');
  src:=replace(src,'then to_jsonb(c)->>''external_salesman_id'' else to_jsonb(c)->>''source_salesman_id'' end',
   'then nullif(trim(to_jsonb(c)->>''external_salesman_id''),'''') else nullif(trim(to_jsonb(c)->>''source_salesman_id''),'''') end');
  execute src;n:=n+1;
 end loop;
 if n=0 then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;
commit;
