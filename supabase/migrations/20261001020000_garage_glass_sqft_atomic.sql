-- A glass item's film usage (sqft) and the film stock it draws on now
-- change together, in one database transaction. Before, the app saved the
-- sqft and then adjusted stock in a second request — if the second failed,
-- the glass showed usage the stock never accounted for.
--
-- Requires 20261001010000_garage_lifecycle_guards.sql (lifecycle flag and
-- stage checks).

-- set_garage_glass_item_sqft(item, new sqft, actor)
--   1. lock the glass item (so two edits to the same glass queue up)
--   2. read its previous sqft
--   3. delta = new − previous (negative = film handed back to stock)
--   4. the series the film came from: installed series if confirmed,
--      otherwise the requested series
--   5. lock that series' stock row and check it can cover the delta
--   6. update the glass sqft + timestamp
--   7. adjust remaining stock + timestamp
-- Any failure raises, and Postgres rolls back both updates together.
create or replace function set_garage_glass_item_sqft(p_item_id text, p_sqft numeric, p_actor_id text)
returns jsonb
language plpgsql
as $$
declare
  item garage_tint_installation_pieces;
  stock garage_film_stock;
  film_series text;
  prev_sqft numeric;
  new_sqft numeric := p_sqft;
  delta numeric;
begin
  perform garage_lifecycle_begin();

  if new_sqft is null or new_sqft < 0 then
    raise exception 'INVALID_SQFT';
  end if;

  -- 1. lock the glass item
  select * into item from garage_tint_installation_pieces where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;

  -- Film is only logged while the installation is underway.
  perform garage_require_stage(item.invoice_id, array['in_progress'], 'NOT_IN_PROGRESS');

  -- 2-3. previous usage and the change
  prev_sqft := coalesce(item.sqft, 0);
  delta := new_sqft - prev_sqft;

  if delta = 0 then
    select * into stock from garage_film_stock
    where series = coalesce(item.installed_series, item.requested_series);
    return jsonb_build_object('item', to_jsonb(item), 'stock', to_jsonb(stock), 'delta', 0);
  end if;

  -- 4. which film roll it came from
  film_series := coalesce(item.installed_series, item.requested_series);
  if film_series is null then raise exception 'NO_SERIES_FOR_GLASS'; end if;

  -- 5. lock that stock row and make sure it can cover the extra usage
  select * into stock from garage_film_stock where series = film_series for update;
  if not found then raise exception 'NO_FILM_STOCK %', film_series; end if;
  if delta > 0 and stock.remaining_sqft - delta < 0 then
    raise exception 'INSUFFICIENT_FILM_STOCK % has %', film_series, stock.remaining_sqft;
  end if;

  -- 6. the glass
  update garage_tint_installation_pieces
  set sqft = new_sqft, updated_at = now()
  where id = p_item_id
  returning * into item;

  -- 7. the stock (a negative delta returns film)
  update garage_film_stock
  set remaining_sqft = remaining_sqft - delta, updated_at = now()
  where series = film_series
  returning * into stock;

  return jsonb_build_object('item', to_jsonb(item), 'stock', to_jsonb(stock), 'delta', delta);
end;
$$;

-- sqft now goes only through set_garage_glass_item_sqft, so stock can't be
-- bypassed by writing a glass's sqft directly. Installer and remark stay
-- freely editable.
create or replace function garage_glass_item_lifecycle_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not garage_lifecycle_active() then
      new.status := 'pending';
      new.installed_series := null;
      new.sqft := null;
    end if;
    return new;
  end if;
  if not garage_lifecycle_active() and (
       new.status is distinct from old.status
    or new.installed_series is distinct from old.installed_series
    or new.sqft is distinct from old.sqft
  ) then
    raise exception 'LIFECYCLE_DIRECT_WRITE';
  end if;
  return new;
end;
$$;
