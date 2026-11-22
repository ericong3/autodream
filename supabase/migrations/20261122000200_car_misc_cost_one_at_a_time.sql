-- Car costs were saved by writing the car's whole cost list from the device's own
-- copy of the car. When that copy was older than the database (someone else had
-- just added a cost, or the device had an old saved copy), the save quietly
-- wiped out the other cost while its bill stayed in Payments. That is how the
-- S70 and VMP6880 petrol costs went missing.
--
-- These two functions add or remove ONE cost inside the database, against the
-- list as it is right now, so a save can never drop someone else's cost.
-- They run with the caller's own rights (security invoker), so they can do
-- nothing the app could not already do with a direct update of cars.
begin;

create or replace function public.uc_car_misc_cost_add(p_car_id text, p_misc jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if jsonb_typeof(p_misc) is distinct from 'object' or coalesce(p_misc->>'id', '') = ''
     or jsonb_typeof(p_misc->'amount') is distinct from 'number' then
    raise exception 'INVALID_COST';
  end if;
  update cars c
     set misc_costs = coalesce(nullif(c.misc_costs, 'null'::jsonb), '[]'::jsonb) || jsonb_build_array(p_misc)
   where c.id = p_car_id
     and not exists (select 1 from jsonb_array_elements(coalesce(nullif(c.misc_costs, 'null'::jsonb), '[]'::jsonb)) m
                      where m->>'id' = p_misc->>'id')
  returning c.misc_costs into v;
  if v is null then
    -- Already on the car (a retry), or no such car.
    select coalesce(nullif(c.misc_costs, 'null'::jsonb), '[]'::jsonb) into v from cars c where c.id = p_car_id;
    if v is null then raise exception 'CAR_NOT_FOUND'; end if;
  end if;
  return v;
end $$;

create or replace function public.uc_car_misc_cost_remove(p_car_id text, p_misc_id text) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v jsonb;
begin
  update cars c
     set misc_costs = coalesce((select jsonb_agg(m order by o)
                                  from jsonb_array_elements(coalesce(nullif(c.misc_costs, 'null'::jsonb), '[]'::jsonb)) with ordinality t(m, o)
                                 where m->>'id' is distinct from p_misc_id), '[]'::jsonb)
   where c.id = p_car_id
  returning c.misc_costs into v;
  if v is null then raise exception 'CAR_NOT_FOUND'; end if;
  return v;
end $$;

revoke all on function public.uc_car_misc_cost_add(text, jsonb), public.uc_car_misc_cost_remove(text, text) from public;
grant execute on function public.uc_car_misc_cost_add(text, jsonb), public.uc_car_misc_cost_remove(text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
