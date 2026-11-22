-- Paying a trade-in's settlement (its old loan) was refused with
-- BILL_LEDGER_REVIEW_REQUIRED. The payment check only counted a
-- 'car_purchased' entry (or a company purchase / company trade-in) as the
-- amount owed, but an ordinary trade-in car is booked by:
--   * 'trade_in_acquired' on the trade-in car: owes the lender up to the
--     trade-in value; and
--   * 'trade_in_topup' on the car that was sold: when the old loan is bigger
--     than the trade-in value, the customer's top-up is moved out of sales
--     and owed to the same lender.
-- Count both, so the settlement bill can be paid up to exactly what is owed.
-- Used by the bank payment and the paid-before-opening payment checks.
begin;

create or replace function public.uc_company_trade_in_source(p_journal text,p_car text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from uc_company_trade_in_applications a where a.incoming_car_id=p_car and p_journal='uc:company-trade-in:'||a.id::text)
 or exists(select 1 from uc_company_car_purchases a where a.car_id=p_car and p_journal='uc:company-purchase:'||a.car_id)
 or exists(select 1 from journal_entries j join cars c on c.id=p_car
   where j.id=p_journal
     and (j.source_type='trade_in_acquired' and j.source_id=c.id
       or j.source_type='trade_in_topup' and c.trade_in_source_car_id is not null and j.source_id=c.trade_in_source_car_id)) $$;
revoke all on function uc_company_trade_in_source(text,text) from public,anon,authenticated,service_role;

commit;

-- Check (read only): what is owed to the bank for the Persona QPC3347.
-- Expect two rows: trade_in_acquired 20000 and trade_in_topup 12910.94.
select j.source_type, j.date, (l->>'credit')::numeric as owed_to_bank
from cars c
join journal_entries j on (j.source_type='trade_in_acquired' and j.source_id=c.id)
  or (j.source_type='trade_in_topup' and j.source_id=c.trade_in_source_car_id)
cross join lateral jsonb_array_elements(j.lines) l
where replace(upper(c.car_plate),' ','')='QPC3347' and not coalesce(j.voided,false) and l->>'accountId'='acct-ap';
