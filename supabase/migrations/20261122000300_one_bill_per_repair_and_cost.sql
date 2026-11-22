-- One bill per repair job, and one bill per car cost.
--
-- Since 7 Nov 2026, 28 repair jobs got 2 or 3 identical bills in To pay (31 extra,
-- none paid). The app decided "does this repair already have a bill?" from its own
-- in-memory list of bills, which can be old or not loaded yet (a second tap on
-- "finish repair", the auto "add missing repair bill" step, the Payments page's
-- one-time backfill on a new device). The bank paid each job once.
--
-- This trigger asks the database itself, right before a new bill is saved:
--   * a new 'repair' bill is refused if any bill already points at the same repair job;
--   * a new 'misc_cost' bill is refused if any bill already points at the same car cost.
-- Bill corrections are not affected: their replacement bills (ids starting
-- 'company-bill-adjustment:' or 'supplier-adjustment:') mark the old bill replaced
-- and are always allowed. Deleted bills no longer count, so a removed bill can be
-- made again. Existing bills are not changed by this migration.
begin;

create or replace function public.uc_one_bill_per_source() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id like 'company-bill-adjustment:%' or new.id like 'supplier-adjustment:%' then
    return new;
  end if;
  if new.type = 'repair' and coalesce(new.repair_job_id, '') <> '' then
    -- Wait for any other save for the same job, so two taps cannot both get through.
    perform pg_advisory_xact_lock(hashtext('uc_one_bill:repair:' || new.repair_job_id));
    if exists (select 1 from payments p where p.repair_job_id = new.repair_job_id and p.id <> new.id) then
      raise exception 'BILL_ALREADY_EXISTS' using detail = 'This repair job already has a bill.';
    end if;
  elsif new.type = 'misc_cost' and coalesce(new.misc_cost_id, '') <> '' then
    perform pg_advisory_xact_lock(hashtext('uc_one_bill:misc:' || new.misc_cost_id));
    if exists (select 1 from payments p where p.misc_cost_id = new.misc_cost_id and p.id <> new.id) then
      raise exception 'BILL_ALREADY_EXISTS' using detail = 'This car cost already has a bill.';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.uc_one_bill_per_source() from public, anon, authenticated;

drop trigger if exists uc_one_bill_per_source on public.payments;
create trigger uc_one_bill_per_source before insert on public.payments
  for each row execute function public.uc_one_bill_per_source();

commit;
