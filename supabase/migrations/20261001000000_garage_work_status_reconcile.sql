-- garage_invoices.work_status becomes the one place every screen reads a
-- work order's lifecycle stage from. The pipeline functions (accept / start
-- / complete / paid / deliver / warranty) already set it; this makes it
-- hold no matter who writes the underlying facts — an out-of-date copy of
-- the app cached on a phone (the PWA) or a hand edit in the table editor
-- would otherwise change job.status / delivered_at / … and leave
-- work_status behind.
--
-- Timestamps and job.status are untouched and keep their meaning (who did
-- what, when); work_status says where the work order is now.

-- The stage a work order's recorded facts put it in. One definition, in
-- the database. `current` only matters for one legacy case: jobs accepted
-- before Start Installation existed have no started_at but are genuinely
-- in progress, so an accepted job already at in_progress stays there.
create or replace function garage_work_status_from_facts(p_invoice_id text)
returns text
language plpgsql
stable
as $$
declare
  inv garage_invoices;
  j garage_installer_jobs;
begin
  select * into inv from garage_invoices where id = p_invoice_id;
  if not found then return null; end if;
  if inv.work_status = 'draft' then return 'draft'; end if;

  if inv.warranty_registered_at is not null then return 'closed'; end if;
  if inv.delivered_at is not null then return 'ready_for_warranty'; end if;

  select * into j from garage_installer_jobs where invoice_id = p_invoice_id
  order by created_at desc limit 1;

  if j.status = 'completed' or inv.work_status = 'installation_completed' then
    return case when inv.payment_status = 'paid' then 'ready_for_delivery' else 'payment_due' end;
  end if;
  if j.status = 'accepted' then
    if j.started_at is not null or inv.work_status = 'in_progress' then return 'in_progress'; end if;
    return 'installer_assigned';
  end if;
  return 'waiting_for_installer';
end;
$$;

create or replace function garage_reconcile_work_status(p_invoice_id text)
returns void
language plpgsql
as $$
declare
  want text := garage_work_status_from_facts(p_invoice_id);
begin
  if want is not null then
    update garage_invoices set work_status = want
    where id = p_invoice_id and work_status is distinct from want;
  end if;
end;
$$;

-- Fire only on the facts that decide the stage (not on work_status itself,
-- so reconciling can't re-trigger). Runs after the pipeline functions' own
-- writes too, where it simply agrees and changes nothing.
create or replace function garage_invoice_reconcile_trigger()
returns trigger
language plpgsql
as $$
begin
  perform garage_reconcile_work_status(new.id);
  return new;
end;
$$;

drop trigger if exists garage_invoice_reconcile_work_status on garage_invoices;
create trigger garage_invoice_reconcile_work_status
  after update of payment_status, delivered_at, warranty_registered_at on garage_invoices
  for each row execute function garage_invoice_reconcile_trigger();

create or replace function garage_job_reconcile_trigger()
returns trigger
language plpgsql
as $$
begin
  perform garage_reconcile_work_status(new.invoice_id);
  return new;
end;
$$;

drop trigger if exists garage_job_reconcile_work_status on garage_installer_jobs;
create trigger garage_job_reconcile_work_status
  after insert or update of status, accepted_by, started_at, completed_at on garage_installer_jobs
  for each row execute function garage_job_reconcile_trigger();

-- One-time pass so every existing work order starts consistent (none are
-- out of step as of writing; this only guards against drift since).
do $$
declare r record;
begin
  for r in select id from garage_invoices loop
    perform garage_reconcile_work_status(r.id);
  end loop;
end $$;
