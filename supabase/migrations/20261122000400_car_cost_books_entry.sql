-- Repair and car-cost bills get their books entry from the bill itself.
--
-- Since private finance went online (around 12 Nov 2026), an admin finishing a
-- repair saved the bill but the books entry was refused (only claim entries
-- were allowed for admins). The admin saw an error and pressed again, which
-- also made the duplicate bills. This function lets an admin (or Director)
-- post exactly one books entry for one saved repair or car-cost bill. The
-- amount, car, accounts and date all come from the saved bill, never from the
-- browser, and asking twice returns the same entry.
begin;

create or replace function public.uc_post_car_cost_journal(p_actor text, p_bill text, p_entry text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor garage_building_staff; bill payments; car cars; existing journal_entries; entry journal_entries;
  debit_account text; lines jsonb; entry_text text;
begin
  select * into actor from garage_building_staff where id = p_actor for share;
  if actor.id is null or not coalesce(actor.enabled and actor.registration_status = 'active' and actor.role in ('director','admin') and actor.business_access in ('used_car','both'), false) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_bill is null or length(p_bill) not between 1 and 180 or p_entry is null or length(p_entry) not between 1 and 180 then
    raise exception 'INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('car-cost-journal:' || p_bill, 0));

  select * into bill from payments where id = p_bill for update;
  if bill.id is null or bill.type not in ('repair','misc_cost') or bill.car_id is null
     or bill.amount is null or bill.amount <= 0 or bill.amount * 100 <> trunc(bill.amount * 100)
     or coalesce((to_jsonb(bill)->>'obligation_replaced')::boolean, false) then
    raise exception 'BOOKS_REVIEW_REQUIRED';
  end if;

  select * into car from cars where id = bill.car_id for share;
  if car.id is null then raise exception 'INVALID'; end if;
  -- Investor-funded cars keep their own bills and books; they never come here.
  if coalesce((to_jsonb(car)->>'investor_funded')::boolean, false) or exists (select 1 from uc_investor_cars where car_id = car.id) then
    raise exception 'USE_INVESTOR_CAR_BILLS';
  end if;

  debit_account := case when car.investor_id is null then 'acct-inv-own' else 'acct-inv-investor' end;
  lines := jsonb_build_array(
    jsonb_build_object('accountId', debit_account, 'debit', bill.amount, 'credit', 0),
    jsonb_build_object('accountId', 'acct-ap', 'debit', 0, 'credit', bill.amount));

  if (select count(*) from journal_entries where source_type = bill.type and source_id = bill.id and not coalesce(voided, false)) > 1 then
    raise exception 'BOOKS_REVIEW_REQUIRED';
  end if;
  select * into existing from journal_entries where source_type = bill.type and source_id = bill.id and not coalesce(voided, false);
  if existing.id is not null then
    if existing.lines is distinct from lines or existing.car_id is distinct from bill.car_id then
      raise exception 'BOOKS_REVIEW_REQUIRED';
    end if;
    return to_jsonb(existing);
  end if;

  if bill.type = 'repair' then
    select nullif(trim(r.type_of_repair), '') into entry_text from repairs r where r.id = bill.repair_job_id;
    entry_text := 'Repair recognized — ' || coalesce(entry_text, nullif(regexp_replace(coalesce(bill.description, ''), ' repair$', ''), ''), 'Repair');
  else
    entry_text := 'Misc cost recognized — ' || coalesce(nullif(trim(bill.description), ''), 'Misc cost');
  end if;

  insert into journal_entries(id, date, description, lines, source_type, source_id, car_id, created_by, created_at)
  values (p_entry, (bill.created_at::timestamptz at time zone 'Asia/Kuala_Lumpur')::date, left(entry_text, 300), lines, bill.type, bill.id, bill.car_id, actor.id, now())
  returning * into entry;
  return to_jsonb(entry);
end $$;

revoke all on function public.uc_post_car_cost_journal(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.uc_post_car_cost_journal(text, text, text) to service_role;

commit;
