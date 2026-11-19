-- One "Allocate a car" flow for any company car bought with an investor's money.
--   * Car still in stock  -> moved into the investor account (transfer_car).
--   * Car already sold/delivered -> becomes the investor's car on paper: the
--     breakdown (purchase, costs, sale) comes from the car's accounts, and the
--     investor gets their % of a profit or the WHOLE loss (same rule as other
--     investor cars). It stays a draft (% editable, removable) until the
--     Director confirms the final result.
-- deal_search now returns every company car with what can be done with it.
begin;
do $$ begin
 if to_regprocedure('public.uc_capital_before_deals(text,text,jsonb)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;

create function public.uc_car_delivered(p_car text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select uc_car_is_sold(p_car) or exists(select 1 from cars where id=p_car and status in ('sold','delivered')) $$;

-- Car breakdown from its own accounting entries (investor share excluded).
create function public.uc_car_book_breakdown(p_car text) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with l as (
  select a.type,(x->>'debit')::numeric d,(x->>'credit')::numeric c
  from journal_entries j cross join lateral jsonb_array_elements(j.lines) x join ledger_accounts a on a.id=x->>'accountId'
  where j.car_id=p_car and not coalesce(j.voided,false) and j.id not like 'uc:deal:%' and a.type in ('revenue','expense','cogs'))
 select jsonb_build_object(
  'saleCents',coalesce(round(sum(case when type='revenue' then c-d end)*100),0)::bigint,
  'costOfCarCents',coalesce(round(sum(case when type='cogs' then d-c end)*100),0)::bigint,
  'expenseCents',coalesce(round(sum(case when type='expense' then d-c end)*100),0)::bigint,
  'purchaseCents',(select round(coalesce(purchase_price,0)::numeric*100)::bigint from cars where id=p_car)) from l $$;

-- Investor result: % of a profit, the whole loss.
create function public.uc_deal_investor_result(p_profit bigint,p_bp integer) returns bigint language sql immutable as $$
 select case when p_profit>0 then round(p_profit::numeric*p_bp/10000)::bigint else p_profit end $$;

create or replace function public.uc_investor_deal_view(d uc_investor_deals) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('carId',c.id,'make',c.make,'model',c.model,'year',c.year,'plate',c.car_plate,'photo',c.photo,'status',c.status,
  'sold',uc_car_delivered(c.id),'saleRecorded',uc_car_is_sold(c.id),
  'profitCents',case when d.state='confirmed' then d.profit_cents else uc_car_book_profit_cents(c.id) end,
  'breakdown',uc_car_book_breakdown(c.id),
  'investorBasisPoints',d.investor_basis_points,'note',d.note,'state',d.state,
  'estimatedShareCents',case when uc_car_is_sold(c.id) then uc_deal_investor_result(uc_car_book_profit_cents(c.id),d.investor_basis_points) end,
  'shareCents',d.share_cents,'confirmNote',d.confirm_note,'confirmedAt',d.confirmed_at,'updatedAt',d.updated_at)
 from cars c where c.id=d.car_id $$;

alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_any_car;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;q text;pot uuid;c cars;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action not in ('deal_search','save_deal') then return uc_capital_before_any_car(p_actor,p_action,p_data);end if;
 select * into actor from garage_building_staff where id=p_actor;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_action='save_deal' then
  select * into c from cars where id=p_data->>'carId';
  if c.id is not null and not uc_car_delivered(c.id) then raise exception 'CAR_IN_STOCK';end if;
  return uc_capital_before_any_car(p_actor,p_action,p_data);
 end if;
 if coalesce(p_data->>'potId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID';end if;
 pot:=(p_data->>'potId')::uuid;
 if not exists(select 1 from uc_investor_pots where id=pot) then raise exception 'NOT_ALLOWED';end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('potId','query')) or jsonb_typeof(p_data->'query') is distinct from 'string' or length(trim(p_data->>'query')) not between 2 and 60 then raise exception 'INVALID';end if;
 q:='%'||replace(replace(replace(lower(trim(p_data->>'query')),'\','\\'),'%','\%'),'_','\_')||'%';
 return jsonb_build_object('cars',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'make',x.make,'model',x.model,'year',x.year,'plate',x.car_plate,'photo',x.photo,'status',x.status,
   'sold',uc_car_delivered(x.id),'saleRecorded',uc_car_is_sold(x.id),'profitCents',uc_car_book_profit_cents(x.id),'breakdown',uc_car_book_breakdown(x.id),
   'dealPotId',(select pot_id from uc_investor_deals where car_id=x.id),
   'purchaseCents',round(coalesce(x.purchase_price,0)::numeric*100)::bigint,'stockCents',uc_company_stock_cents(x.id),
   'blocker',case when uc_car_delivered(x.id) then null else uc_car_transfer_blocker(x.id) end) order by x.make,x.model,x.id)
  from (select * from cars c2 where not coalesce(c2.investor_funded,false) and c2.investor_id is null
    and (c2.consignment is null or c2.consignment='null'::jsonb) and (c2.outgoing_consignment is null or c2.outgoing_consignment='null'::jsonb)
    and not exists(select 1 from uc_investor_cars ic where ic.car_id=c2.id)
    and (lower(coalesce(c2.car_plate,'')) like q or lower(coalesce(c2.make,'')||' '||coalesce(c2.model,'')) like q or lower(coalesce(c2.model,'')) like q)
   order by c2.make,c2.model,c2.id limit 20) x),'[]'::jsonb));
end $$;

revoke all on function uc_car_delivered(text),uc_car_book_breakdown(text),uc_deal_investor_result(bigint,integer),uc_investor_deal_view(uc_investor_deals),
 uc_capital_before_any_car(text,text,jsonb),uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_investor_capital(text,text,jsonb) to service_role;
commit;
