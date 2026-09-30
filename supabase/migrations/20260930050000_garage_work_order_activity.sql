-- Work-order activity history — every important action on a Garage work
-- order (the invoice), who did it, their role, when, plus details. The
-- salesman's pipeline timeline reads from here.
--
-- Why a new table rather than reusing loan_case_activity (the only existing
-- activity log): that one belongs to Used Car loan cases (case_id, a fixed
-- loan-specific type list) and the Used Car store loads every row of it at
-- startup for every user — Garage events don't belong in it.
--
-- Requires 20260930010000 .. 20260930040000 to have run first. Every event
-- is written inside the same database function (or trigger) that makes the
-- change, so an action can never happen without its history entry, and a
-- rolled-back action leaves no event behind.
create table if not exists garage_work_order_activity (
  id text primary key default gen_random_uuid()::text,
  work_order_id text not null references garage_invoices(id) on delete cascade,
  event_type text not null check (event_type in (
    'WORK_ORDER_CREATED', 'SENT_TO_INSTALLER', 'INSTALLER_ACCEPTED', 'INSTALLATION_STARTED',
    'GLASS_ITEM_COMPLETED', 'GLASS_ITEM_REOPENED', 'INSTALLATION_COMPLETED', 'PAYMENT_COLLECTED',
    'VEHICLE_READY', 'VEHICLE_DELIVERED', 'WARRANTY_REGISTERED', 'WORK_ORDER_CLOSED'
  )),
  actor_id text references users(id) on delete set null,
  -- Snapshot of the actor's role at the time (roles can change later).
  actor_role text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists garage_work_order_activity_wo_idx
  on garage_work_order_activity(work_order_id, created_at);

alter table garage_work_order_activity enable row level security;
create policy garage_work_order_activity_all on garage_work_order_activity for all using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table garage_work_order_activity;
exception when duplicate_object then null;
end $$;

-- clock_timestamp(), not now(): events written in the same step (e.g.
-- WARRANTY_REGISTERED then WORK_ORDER_CLOSED) must keep their order, and
-- now() is identical for everything in one transaction.
create or replace function log_garage_work_order_event(
  p_work_order_id text, p_event_type text, p_actor_id text,
  p_metadata jsonb default '{}'::jsonb, p_at timestamptz default clock_timestamp()
)
returns void
language plpgsql
as $$
begin
  insert into garage_work_order_activity (work_order_id, event_type, actor_id, actor_role, metadata, created_at)
  values (
    p_work_order_id, p_event_type, p_actor_id,
    (select role from users where id = p_actor_id),
    coalesce(p_metadata, '{}'::jsonb), p_at
  );
end;
$$;

-- ── Creation: triggers, so the existing insert-based Confirm flow logs
--    without extra client calls (and Confirm's rollback deletes them too).
create or replace function garage_invoice_created_activity()
returns trigger
language plpgsql
as $$
begin
  perform log_garage_work_order_event(new.id, 'WORK_ORDER_CREATED', new.created_by,
    jsonb_build_object('service', new.service, 'payment_status', new.payment_status));
  if new.payment_status = 'paid' then
    perform log_garage_work_order_event(new.id, 'PAYMENT_COLLECTED', coalesce(new.paid_by, new.created_by),
      jsonb_build_object('method', new.payment_method, 'at_confirmation', true));
  end if;
  return new;
end;
$$;

drop trigger if exists garage_invoice_created_activity on garage_invoices;
create trigger garage_invoice_created_activity
  after insert on garage_invoices
  for each row execute function garage_invoice_created_activity();

create or replace function garage_installer_job_created_activity()
returns trigger
language plpgsql
as $$
begin
  perform log_garage_work_order_event(new.invoice_id, 'SENT_TO_INSTALLER',
    (select created_by from garage_invoices where id = new.invoice_id),
    jsonb_build_object('service', new.service));
  return new;
end;
$$;

drop trigger if exists garage_installer_job_created_activity on garage_installer_jobs;
create trigger garage_installer_job_created_activity
  after insert on garage_installer_jobs
  for each row execute function garage_installer_job_created_activity();

-- ── Installer steps (same behaviour as before, now logged) ───────────────

create or replace function accept_garage_installer_job(
  p_job_id text, p_installer_id text, p_estimated_complete_at timestamptz
)
returns garage_installer_jobs
language plpgsql
as $$
declare
  result garage_installer_jobs;
begin
  update garage_installer_jobs
  set status = 'accepted', accepted_by = p_installer_id, accepted_at = now(),
      estimated_complete_at = p_estimated_complete_at
  where id = p_job_id and status = 'pending' and accepted_by is null
  returning * into result;

  if not found then
    if exists (select 1 from garage_installer_jobs where id = p_job_id) then
      raise exception 'JOB_ALREADY_ACCEPTED';
    end if;
    raise exception 'JOB_NOT_FOUND';
  end if;

  update garage_invoices set work_status = 'installer_assigned'
  where id = result.invoice_id and work_status = 'waiting_for_installer';

  perform log_garage_work_order_event(result.invoice_id, 'INSTALLER_ACCEPTED', p_installer_id,
    jsonb_build_object('job_id', result.id, 'estimated_complete_at', p_estimated_complete_at));
  return result;
end;
$$;

-- Now takes who pressed Start, for the history.
drop function if exists start_garage_installer_job(text);
create or replace function start_garage_installer_job(p_job_id text, p_actor_id text)
returns garage_installer_jobs
language plpgsql
as $$
declare
  result garage_installer_jobs;
begin
  update garage_installer_jobs set started_at = now()
  where id = p_job_id and status = 'accepted' and started_at is null
  returning * into result;

  if not found then
    if exists (select 1 from garage_installer_jobs where id = p_job_id and started_at is not null) then
      raise exception 'JOB_ALREADY_STARTED';
    end if;
    if exists (select 1 from garage_installer_jobs where id = p_job_id) then
      raise exception 'JOB_NOT_ASSIGNED';
    end if;
    raise exception 'JOB_NOT_FOUND';
  end if;

  update garage_invoices set work_status = 'in_progress'
  where id = result.invoice_id and work_status = 'installer_assigned';

  perform log_garage_work_order_event(result.invoice_id, 'INSTALLATION_STARTED', p_actor_id,
    jsonb_build_object('job_id', result.id));
  return result;
end;
$$;

-- Confirming (or un-confirming) one glass. Only logs when the status really
-- changes, so a double tap doesn't produce duplicate events. Confirming
-- records installed = requested series, and the confirming installer as the
-- glass's installer if none was set.
create or replace function set_garage_glass_item_status(p_item_id text, p_status text, p_actor_id text)
returns garage_tint_installation_pieces
language plpgsql
as $$
declare
  result garage_tint_installation_pieces;
  actor_role text := (select role from users where id = p_actor_id);
begin
  if p_status not in ('pending', 'installed') then
    raise exception 'INVALID_STATUS';
  end if;

  update garage_tint_installation_pieces
  set status = p_status,
      installed_series = case when p_status = 'installed' then requested_series else null end,
      installer_id = case
        when p_status = 'installed' and installer_id is null and actor_role = 'garage_installer' then p_actor_id
        else installer_id end,
      updated_at = now()
  where id = p_item_id and status <> p_status
  returning * into result;

  if not found then
    select * into result from garage_tint_installation_pieces where id = p_item_id;
    if not found then raise exception 'ITEM_NOT_FOUND'; end if;
    return result;  -- already in that state: no change, no event
  end if;

  perform log_garage_work_order_event(result.invoice_id,
    case when p_status = 'installed' then 'GLASS_ITEM_COMPLETED' else 'GLASS_ITEM_REOPENED' end,
    p_actor_id,
    jsonb_build_object('item_id', result.id, 'glass_position', result.position, 'installed_series', result.installed_series));
  return result;
end;
$$;

create or replace function complete_garage_installer_job(
  p_job_id text, p_completed_by text, p_remark text, p_final_inspection_done boolean
)
returns garage_installer_jobs
language plpgsql
as $$
declare
  j garage_installer_jobs;
  result garage_installer_jobs;
  inv_work_status text;
  inv_payment_status text;
begin
  if p_final_inspection_done is not true then
    raise exception 'FINAL_INSPECTION_REQUIRED';
  end if;

  select * into j from garage_installer_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if j.status = 'completed' then raise exception 'JOB_ALREADY_COMPLETED'; end if;

  select work_status, payment_status into inv_work_status, inv_payment_status
  from garage_invoices where id = j.invoice_id for update;

  if j.status <> 'accepted' or (j.started_at is null and inv_work_status <> 'in_progress') then
    raise exception 'JOB_NOT_STARTED';
  end if;

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
  where id = p_job_id
  returning * into result;

  update garage_invoices
  set work_status = case when inv_payment_status = 'paid' then 'ready_for_delivery' else 'payment_due' end
  where id = j.invoice_id and work_status in ('installer_assigned', 'in_progress');

  perform log_garage_work_order_event(j.invoice_id, 'INSTALLATION_COMPLETED', p_completed_by,
    jsonb_build_object('job_id', j.id, 'remark', result.remark, 'final_inspection', true));
  if inv_payment_status = 'paid' then
    perform log_garage_work_order_event(j.invoice_id, 'VEHICLE_READY', p_completed_by, '{}'::jsonb);
  end if;
  return result;
end;
$$;

-- ── Salesman steps — moved from client-side updates into functions so the
--    change and its history entry are one atomic step. Installers are
--    refused: they never collect payment, deliver, or close a work order.

create or replace function assert_not_installer(p_actor_id text)
returns void
language plpgsql
as $$
begin
  if (select role from users where id = p_actor_id) = 'garage_installer' then
    raise exception 'NOT_ALLOWED_FOR_INSTALLER';
  end if;
end;
$$;

create or replace function mark_garage_work_order_paid(p_invoice_id text, p_actor_id text, p_method text)
returns garage_invoices
language plpgsql
as $$
declare
  result garage_invoices;
  was_payment_due boolean;
begin
  perform assert_not_installer(p_actor_id);

  select work_status = 'payment_due' into was_payment_due
  from garage_invoices where id = p_invoice_id for update;
  if not found then raise exception 'WORK_ORDER_NOT_FOUND'; end if;

  update garage_invoices
  set payment_status = 'paid', paid_at = now(), paid_by = p_actor_id,
      payment_method = coalesce(p_method, payment_method),
      work_status = case when work_status = 'payment_due' then 'ready_for_delivery' else work_status end
  where id = p_invoice_id and payment_status = 'pending'
  returning * into result;
  if not found then raise exception 'ALREADY_PAID'; end if;

  perform log_garage_work_order_event(p_invoice_id, 'PAYMENT_COLLECTED', p_actor_id,
    jsonb_build_object('method', p_method));
  if was_payment_due then
    perform log_garage_work_order_event(p_invoice_id, 'VEHICLE_READY', p_actor_id, '{}'::jsonb);
  end if;
  return result;
end;
$$;

create or replace function deliver_garage_work_order(p_invoice_id text, p_actor_id text)
returns garage_invoices
language plpgsql
as $$
declare
  result garage_invoices;
begin
  perform assert_not_installer(p_actor_id);

  update garage_invoices i
  set delivered_at = now(), delivered_by = p_actor_id, work_status = 'ready_for_warranty'
  where i.id = p_invoice_id
    and i.delivered_at is null
    and i.payment_status = 'paid'
    and (i.service <> 'tinted' or exists (
      select 1 from garage_installer_jobs j where j.invoice_id = i.id and j.status = 'completed'))
  returning * into result;
  if not found then raise exception 'NOT_READY_FOR_DELIVERY'; end if;

  perform log_garage_work_order_event(p_invoice_id, 'VEHICLE_DELIVERED', p_actor_id, '{}'::jsonb);
  return result;
end;
$$;

create or replace function register_garage_work_order_warranty(p_invoice_id text, p_actor_id text)
returns garage_invoices
language plpgsql
as $$
declare
  result garage_invoices;
begin
  perform assert_not_installer(p_actor_id);

  update garage_invoices
  set warranty_registered_at = now(), warranty_registered_by = p_actor_id, work_status = 'closed'
  where id = p_invoice_id and delivered_at is not null and warranty_registered_at is null
  returning * into result;
  if not found then raise exception 'NOT_READY_FOR_WARRANTY'; end if;

  perform log_garage_work_order_event(p_invoice_id, 'WARRANTY_REGISTERED', p_actor_id, '{}'::jsonb);
  perform log_garage_work_order_event(p_invoice_id, 'WORK_ORDER_CLOSED', p_actor_id, '{}'::jsonb);
  return result;
end;
$$;

-- ── Backfill history for existing work orders from what's already
--    recorded, so their timelines aren't empty. Marked backfilled; only
--    for work orders with no history yet, so re-running adds nothing.
do $$
declare
  i record;
  j record;
begin
  for i in
    select * from garage_invoices inv
    where not exists (select 1 from garage_work_order_activity a where a.work_order_id = inv.id)
  loop
    perform log_garage_work_order_event(i.id, 'WORK_ORDER_CREATED', i.created_by,
      jsonb_build_object('service', i.service, 'backfilled', true), i.created_at);
    if i.paid_at is not null then
      perform log_garage_work_order_event(i.id, 'PAYMENT_COLLECTED', i.paid_by,
        jsonb_build_object('method', i.payment_method, 'backfilled', true), i.paid_at);
    end if;

    select * into j from garage_installer_jobs where invoice_id = i.id limit 1;
    if found then
      perform log_garage_work_order_event(i.id, 'SENT_TO_INSTALLER', i.created_by,
        jsonb_build_object('backfilled', true), j.created_at);
      if j.accepted_at is not null then
        perform log_garage_work_order_event(i.id, 'INSTALLER_ACCEPTED', j.accepted_by,
          jsonb_build_object('estimated_complete_at', j.estimated_complete_at, 'backfilled', true), j.accepted_at);
      end if;
      if j.started_at is not null then
        perform log_garage_work_order_event(i.id, 'INSTALLATION_STARTED', j.accepted_by,
          jsonb_build_object('backfilled', true), j.started_at);
      end if;
      if j.completed_at is not null then
        perform log_garage_work_order_event(i.id, 'INSTALLATION_COMPLETED', coalesce(j.completed_by, j.accepted_by),
          jsonb_build_object('remark', j.remark, 'backfilled', true), j.completed_at);
      end if;
    end if;

    if i.delivered_at is not null then
      perform log_garage_work_order_event(i.id, 'VEHICLE_DELIVERED', i.delivered_by,
        jsonb_build_object('backfilled', true), i.delivered_at);
    end if;
    if i.warranty_registered_at is not null then
      perform log_garage_work_order_event(i.id, 'WARRANTY_REGISTERED', i.warranty_registered_by,
        jsonb_build_object('backfilled', true), i.warranty_registered_at);
      perform log_garage_work_order_event(i.id, 'WORK_ORDER_CLOSED', i.warranty_registered_by,
        jsonb_build_object('backfilled', true), i.warranty_registered_at);
    end if;
  end loop;
end $$;
