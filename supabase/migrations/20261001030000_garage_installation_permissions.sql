-- Installation work belongs to the installer who accepted the job (plus
-- Garage Head / Director / Shareholder). Everyone else is read-only — the
-- database refuses their changes, not just the screen.
-- Requires 20261001010000 (lifecycle guards) and 20261001020000 (atomic
-- sqft).
--
-- Like the rest of the pipeline, the actor is the user id the app passes
-- (the app has its own login, not Supabase Auth), so these checks stop the
-- wrong person in normal use; they can't prove identity against someone
-- forging requests with the public key.

create or replace function garage_is_manager(p_user_id text)
returns boolean language sql stable as $$
  select coalesce((select role in ('director', 'shareholder', 'garage_head') from users where id = p_user_id), false);
$$;

create or replace function garage_is_workshop(p_user_id text)
returns boolean language sql stable as $$
  select coalesce((select role in ('garage_installer', 'garage_detailer', 'garage_spray') from users where id = p_user_id), false);
$$;

-- The one ownership rule for installation work on a work order. Each
-- function checks the stage first ("not started yet" is the clearer answer
-- before anyone has accepted), then ownership.
create or replace function garage_assert_can_work_job(p_invoice_id text, p_actor_id text)
returns void
language plpgsql
as $$
declare
  owner_id text;
begin
  if p_actor_id is null then raise exception 'NOT_YOUR_JOB'; end if;
  if garage_is_manager(p_actor_id) then return; end if;
  select accepted_by into owner_id from garage_installer_jobs
  where invoice_id = p_invoice_id order by created_at desc limit 1;
  if owner_id is null or owner_id <> p_actor_id then
    raise exception 'NOT_YOUR_JOB';
  end if;
end;
$$;

-- ── Accept: workshop roles and managers only ─────────────────────────────
create or replace function accept_garage_installer_job(
  p_job_id text, p_installer_id text, p_estimated_complete_at timestamptz
)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
  result garage_installer_jobs;
begin
  perform garage_lifecycle_begin();
  if not (garage_is_workshop(p_installer_id) or garage_is_manager(p_installer_id)) then
    raise exception 'NOT_AN_INSTALLER';
  end if;
  select * into j from garage_installer_jobs where id = p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if j.status <> 'pending' or j.accepted_by is not null then raise exception 'JOB_ALREADY_ACCEPTED'; end if;
  perform garage_require_stage(j.invoice_id, array['waiting_for_installer'], 'NOT_WAITING_FOR_INSTALLER');

  update garage_installer_jobs
  set status = 'accepted', accepted_by = p_installer_id, accepted_at = now(),
      estimated_complete_at = p_estimated_complete_at
  where id = p_job_id and status = 'pending' and accepted_by is null
  returning * into result;
  if not found then raise exception 'JOB_ALREADY_ACCEPTED'; end if;

  update garage_invoices set work_status = 'installer_assigned'
  where id = result.invoice_id and work_status = 'waiting_for_installer';

  perform log_garage_work_order_event(result.invoice_id, 'INSTALLER_ACCEPTED', p_installer_id,
    jsonb_build_object('job_id', result.id, 'estimated_complete_at', p_estimated_complete_at));
  return result;
end;
$$;

-- ── Start: the accepting installer or a manager ──────────────────────────
create or replace function start_garage_installer_job(p_job_id text, p_actor_id text)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
  result garage_installer_jobs;
begin
  perform garage_lifecycle_begin();
  select * into j from garage_installer_jobs where id = p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if j.started_at is not null then raise exception 'JOB_ALREADY_STARTED'; end if;
  if j.status <> 'accepted' then raise exception 'JOB_NOT_ASSIGNED'; end if;
  perform garage_require_stage(j.invoice_id, array['installer_assigned'], 'NOT_INSTALLER_ASSIGNED');
  perform garage_assert_can_work_job(j.invoice_id, p_actor_id);

  update garage_installer_jobs set started_at = now()
  where id = p_job_id and status = 'accepted' and started_at is null
  returning * into result;
  if not found then raise exception 'JOB_ALREADY_STARTED'; end if;

  update garage_invoices set work_status = 'in_progress'
  where id = result.invoice_id and work_status = 'installer_assigned';

  perform log_garage_work_order_event(result.invoice_id, 'INSTALLATION_STARTED', p_actor_id,
    jsonb_build_object('job_id', result.id));
  return result;
end;
$$;

-- ── Confirm / reopen a glass ─────────────────────────────────────────────
create or replace function set_garage_glass_item_status(p_item_id text, p_status text, p_actor_id text)
returns garage_tint_installation_pieces
language plpgsql
as $$
declare
  item garage_tint_installation_pieces;
  result garage_tint_installation_pieces;
  actor_role text := (select role from users where id = p_actor_id);
begin
  perform garage_lifecycle_begin();
  if p_status not in ('pending', 'installed') then raise exception 'INVALID_STATUS'; end if;
  select * into item from garage_tint_installation_pieces where id = p_item_id;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  perform garage_require_stage(item.invoice_id, array['in_progress'], 'NOT_IN_PROGRESS');
  perform garage_assert_can_work_job(item.invoice_id, p_actor_id);

  update garage_tint_installation_pieces
  set status = p_status,
      installed_series = case when p_status = 'installed' then requested_series else null end,
      installer_id = case
        when p_status = 'installed' and installer_id is null and actor_role = 'garage_installer' then p_actor_id
        else installer_id end,
      updated_at = now()
  where id = p_item_id and status <> p_status
  returning * into result;

  if not found then return item; end if;

  perform log_garage_work_order_event(result.invoice_id,
    case when p_status = 'installed' then 'GLASS_ITEM_COMPLETED' else 'GLASS_ITEM_REOPENED' end,
    p_actor_id,
    jsonb_build_object('item_id', result.id, 'glass_position', result.position, 'installed_series', result.installed_series));
  return result;
end;
$$;

-- ── Film usage (atomic with stock) ───────────────────────────────────────
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
  if new_sqft is null or new_sqft < 0 then raise exception 'INVALID_SQFT'; end if;

  select * into item from garage_tint_installation_pieces where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  perform garage_require_stage(item.invoice_id, array['in_progress'], 'NOT_IN_PROGRESS');
  perform garage_assert_can_work_job(item.invoice_id, p_actor_id);

  prev_sqft := coalesce(item.sqft, 0);
  delta := new_sqft - prev_sqft;
  if delta = 0 then
    select * into stock from garage_film_stock
    where series = coalesce(item.installed_series, item.requested_series);
    return jsonb_build_object('item', to_jsonb(item), 'stock', to_jsonb(stock), 'delta', 0);
  end if;

  film_series := coalesce(item.installed_series, item.requested_series);
  if film_series is null then raise exception 'NO_SERIES_FOR_GLASS'; end if;

  select * into stock from garage_film_stock where series = film_series for update;
  if not found then raise exception 'NO_FILM_STOCK %', film_series; end if;
  if delta > 0 and stock.remaining_sqft - delta < 0 then
    raise exception 'INSUFFICIENT_FILM_STOCK % has %', film_series, stock.remaining_sqft;
  end if;

  update garage_tint_installation_pieces set sqft = new_sqft, updated_at = now()
  where id = p_item_id returning * into item;

  update garage_film_stock set remaining_sqft = remaining_sqft - delta, updated_at = now()
  where series = film_series returning * into stock;

  return jsonb_build_object('item', to_jsonb(item), 'stock', to_jsonb(stock), 'delta', delta);
end;
$$;

-- ── Installer and remark for a glass (were direct writes) ────────────────
create or replace function set_garage_glass_item_installer(p_item_id text, p_installer_id text, p_actor_id text)
returns garage_tint_installation_pieces
language plpgsql
as $$
declare
  item garage_tint_installation_pieces;
begin
  perform garage_lifecycle_begin();
  select * into item from garage_tint_installation_pieces where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  perform garage_require_stage(item.invoice_id, array['in_progress'], 'NOT_IN_PROGRESS');
  perform garage_assert_can_work_job(item.invoice_id, p_actor_id);
  if p_installer_id is not null and not garage_is_workshop(p_installer_id) then
    raise exception 'NOT_AN_INSTALLER';
  end if;

  update garage_tint_installation_pieces set installer_id = p_installer_id, updated_at = now()
  where id = p_item_id returning * into item;
  return item;
end;
$$;

create or replace function set_garage_glass_item_remark(p_item_id text, p_remark text, p_actor_id text)
returns garage_tint_installation_pieces
language plpgsql
as $$
declare
  item garage_tint_installation_pieces;
begin
  perform garage_lifecycle_begin();
  select * into item from garage_tint_installation_pieces where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  perform garage_require_stage(item.invoice_id, array['in_progress'], 'NOT_IN_PROGRESS');
  perform garage_assert_can_work_job(item.invoice_id, p_actor_id);

  update garage_tint_installation_pieces set remark = nullif(trim(p_remark), ''), updated_at = now()
  where id = p_item_id returning * into item;
  return item;
end;
$$;

-- ── Complete: the accepting installer or a manager ───────────────────────
create or replace function complete_garage_installer_job(
  p_job_id text, p_completed_by text, p_remark text, p_final_inspection_done boolean
)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
  inv garage_invoices;
  result garage_installer_jobs;
begin
  perform garage_lifecycle_begin();
  if p_final_inspection_done is not true then raise exception 'FINAL_INSPECTION_REQUIRED'; end if;

  select * into j from garage_installer_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if j.status = 'completed' then raise exception 'JOB_ALREADY_COMPLETED'; end if;
  select * into inv from garage_invoices where id = j.invoice_id for update;
  if j.status <> 'accepted' or inv.work_status <> 'in_progress' then raise exception 'JOB_NOT_STARTED'; end if;
  perform garage_assert_can_work_job(j.invoice_id, p_completed_by);

  if not exists (
    select 1 from garage_tint_installation_pieces
    where invoice_id = j.invoice_id and position not in ('door_window', 'rear_panel_window')
  ) or exists (
    select 1 from garage_tint_installation_pieces
    where invoice_id = j.invoice_id and position not in ('door_window', 'rear_panel_window') and status <> 'installed'
  ) then
    raise exception 'GLASS_NOT_ALL_CONFIRMED';
  end if;

  update garage_installer_jobs
  set status = 'completed', completed_at = now(), completed_by = p_completed_by,
      final_inspection_at = now(), remark = nullif(trim(p_remark), '')
  where id = p_job_id returning * into result;

  update garage_invoices
  set work_status = case when inv.payment_status = 'paid' then 'ready_for_delivery' else 'payment_due' end
  where id = j.invoice_id and work_status = 'in_progress';

  perform log_garage_work_order_event(j.invoice_id, 'INSTALLATION_COMPLETED', p_completed_by,
    jsonb_build_object('job_id', j.id, 'remark', result.remark, 'final_inspection', true));
  if inv.payment_status = 'paid' then
    perform log_garage_work_order_event(j.invoice_id, 'VEHICLE_READY', p_completed_by, '{}'::jsonb);
  end if;
  return result;
end;
$$;

-- ── Glass items: every execution field is now function-only ──────────────
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
      new.installer_id := null;
      new.remark := null;
    end if;
    return new;
  end if;
  if not garage_lifecycle_active() and (
       new.status is distinct from old.status
    or new.installed_series is distinct from old.installed_series
    or new.sqft is distinct from old.sqft
    or new.installer_id is distinct from old.installer_id
    or new.remark is distinct from old.remark
  ) then
    raise exception 'LIFECYCLE_DIRECT_WRITE';
  end if;
  return new;
end;
$$;
