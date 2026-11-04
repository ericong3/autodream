-- PREPARED ONLY. Install before enabling the private finance release.
begin;
-- Admin may confirm a real expense claim, never supply arbitrary journal lines.
-- The original bill, amount, car and confirmer determine this posting.
create function public.uc_confirm_claim_journal(p_actor text,p_claim text,p_entry text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;claim payments;car cars;existing journal_entries;entry journal_entries;debit_account text;lines jsonb;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role in ('director','admin') and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_claim is null or length(p_claim) not between 1 and 180 or p_entry is null or length(p_entry) not between 1 and 180 then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('claim-journal:'||p_claim,0));
 select * into claim from payments where id=p_claim for update;
 if claim.id is null or claim.type<>'expense_claim' or claim.claim_confirmed_by is null or claim.claim_confirmed_at is null or claim.amount<=0 or claim.amount*100<>trunc(claim.amount*100) then raise exception 'CLAIM_REVIEW_REQUIRED';end if;
 if claim.car_id is not null then
  select * into car from cars where id=claim.car_id for update;
  if car.id is null then raise exception 'INVALID';end if;
  if exists(select 1 from uc_investor_cars where car_id=car.id) then raise exception 'USE_INVESTOR_CAR_BILLS';end if;
  debit_account:=case when car.investor_id is null then 'acct-inv-own' else 'acct-inv-investor' end;
 else debit_account:='acct-exp-general';end if;
 lines:=jsonb_build_array(jsonb_build_object('accountId',debit_account,'debit',claim.amount,'credit',0),jsonb_build_object('accountId','acct-ap','debit',0,'credit',claim.amount));
 if (select count(*) from journal_entries where source_type='expense_claim_confirmed' and source_id=claim.id and not voided)>1 then raise exception 'CLAIM_REVIEW_REQUIRED';end if;
 select * into existing from journal_entries where source_type='expense_claim_confirmed' and source_id=claim.id and not voided;
 if existing.id is not null then
  if existing.lines is distinct from lines or existing.car_id is distinct from claim.car_id then raise exception 'CLAIM_REVIEW_REQUIRED';end if;
  return to_jsonb(existing);
 end if;
 insert into journal_entries(id,date,description,lines,source_type,source_id,car_id,created_by)
 values(p_entry,(claim.claim_confirmed_at at time zone 'Asia/Kuala_Lumpur')::date,'Claim confirmed — '||coalesce(nullif(claim.description,''),claim.recipient_name,'Expense claim'),lines,'expense_claim_confirmed',claim.id,claim.car_id,claim.claim_confirmed_by)
 returning * into entry;
 return to_jsonb(entry);
end $$;
revoke all on function public.uc_confirm_claim_journal(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.uc_confirm_claim_journal(text,text,text) to service_role;

commit;
