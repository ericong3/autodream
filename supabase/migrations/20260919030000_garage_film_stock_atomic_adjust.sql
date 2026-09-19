-- Reading remaining_sqft then writing it back from the client is not safe
-- against two pieces of the same series being logged in quick succession —
-- the second write can clobber the first (lost update). Do the decrement
-- as a single atomic UPDATE on the database side instead.
create or replace function adjust_film_stock(p_series text, p_delta numeric)
returns garage_film_stock
language plpgsql
as $$
declare
  result garage_film_stock;
begin
  update garage_film_stock
  set remaining_sqft = remaining_sqft - p_delta, updated_at = now()
  where series = p_series
  returning * into result;
  return result;
end;
$$;
