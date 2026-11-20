-- Opening a consignment deal failed with error 42804 when the car has a
-- source or intake commission: the live cars table stores the salesperson
-- ids with different types (e.g. uuid and text), and the deal code mixed
-- them in one CASE/COALESCE. Read them as text, like the commission bills do.
-- Patches only these exact expressions in the existing functions.
begin;
do $$
declare f record;src text;n int:=0;
begin
 for f in select p.oid from pg_proc p join pg_namespace s on s.oid=p.pronamespace
  where s.nspname='public' and p.prosrc like '%c.external_salesman_id else c.source_salesman_id%' loop
  src:=pg_get_functiondef(f.oid);
  src:=replace(src,'then c.external_salesman_id else c.source_salesman_id end',
   'then to_jsonb(c)->>''external_salesman_id'' else to_jsonb(c)->>''source_salesman_id'' end');
  src:=replace(src,'coalesce(c.assigned_salesperson,(select assigned_sales_id from customers where id=k.customer_id))',
   'coalesce(to_jsonb(c)->>''assigned_salesperson'',(select assigned_sales_id::text from customers where id=k.customer_id))');
  if src like '%c.external_salesman_id else c.source_salesman_id%' or src like '%coalesce(c.assigned_salesperson,%' then raise exception 'PATCH_NOT_APPLIED';end if;
  execute src;n:=n+1;
 end loop;
 if n=0 then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;
commit;
