-- Allocate a car: search shows EVERY matching car (plate spaces ignored) and
-- says why a car cannot be allocated, instead of hiding it. A delivered car
-- with only the old "investor" field set (cars.investor_id, not funded through
-- investor accounts) can now be allocated; empty consignment values ({} / false)
-- no longer count as consignment.
begin;
do $$ begin
 if to_regprocedure('public.uc_capital_before_any_car(text,text,jsonb)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;

create function public.uc_json_present(j jsonb) returns boolean language sql immutable as $$
 select j is not null and j not in ('null'::jsonb,'{}'::jsonb,'false'::jsonb,'[]'::jsonb,'""'::jsonb) $$;

-- Why a delivered car cannot become an investor's car (null = it can).
create function public.uc_deal_car_blocker(p_car text) returns text language sql stable security definer set search_path=public,pg_temp as $$
 select case
  when c.id is null then 'CAR_NOT_ELIGIBLE'
  when coalesce(c.investor_funded,false) or exists(select 1 from uc_investor_cars where car_id=c.id) then 'ALREADY_INVESTOR_CAR'
  when uc_json_present(c.consignment) or exists(select 1 from uc_consignment_cases where car_id=c.id) then 'CONSIGNMENT_CAR'
  when uc_json_present(c.outgoing_consignment) then 'OUTGOING_CONSIGNMENT_CAR'
 end from (select 1) one left join cars c on c.id=p_car $$;

alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_search_all;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;q text;pot uuid;c cars;d uc_investor_deals;prior uc_investor_commands;req text;bp integer;r jsonb;blocker text;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action not in ('deal_search','save_deal') then return uc_capital_before_search_all(p_actor,p_action,p_data);end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if coalesce(p_data->>'potId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID';end if;
 pot:=(p_data->>'potId')::uuid;
 if not exists(select 1 from uc_investor_pots where id=pot) then raise exception 'NOT_ALLOWED';end if;
 if p_action='deal_search' then
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('potId','query')) or jsonb_typeof(p_data->'query') is distinct from 'string' or length(trim(p_data->>'query')) not between 2 and 60 then raise exception 'INVALID';end if;
  q:='%'||replace(replace(replace(replace(lower(trim(p_data->>'query')),' ',''),'\','\\'),'%','\%'),'_','\_')||'%';
  return jsonb_build_object('cars',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'make',x.make,'model',x.model,'year',x.year,'plate',x.car_plate,'photo',x.photo,'status',x.status,
    'sold',x.sold,'saleRecorded',uc_car_is_sold(x.id),'profitCents',uc_car_book_profit_cents(x.id),'breakdown',uc_car_book_breakdown(x.id),
    'dealPotId',(select pot_id from uc_investor_deals where car_id=x.id),
    'purchaseCents',round(coalesce(x.purchase_price,0)::numeric*100)::bigint,'stockCents',uc_company_stock_cents(x.id),
    'blocker',case when x.sold then uc_deal_car_blocker(x.id) else coalesce(uc_deal_car_blocker(x.id),uc_car_transfer_blocker(x.id)) end) order by x.sold,x.make,x.model,x.id)
   from (select c2.*,uc_car_delivered(c2.id) sold from cars c2
    where replace(lower(coalesce(c2.car_plate,'')),' ','') like q or replace(lower(coalesce(c2.make,'')||coalesce(c2.model,'')),' ','') like q or replace(lower(coalesce(c2.model,'')),' ','') like q
    order by c2.make,c2.model,c2.id limit 30) x),'[]'::jsonb));
 end if;
 -- save_deal (a delivered car becomes the investor's car, as a draft)
 req:=p_data->>'requestId';
 if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' or jsonb_typeof(p_data->'carId') is distinct from 'string' then raise exception 'INVALID';end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('potId','carId','investorBasisPoints','note','requestId'))
  or jsonb_typeof(p_data->'investorBasisPoints') is distinct from 'number' or coalesce(p_data->>'investorBasisPoints','') !~ '^[0-9]{1,5}$' or (p_data->>'investorBasisPoints')::integer>10000
  or (p_data ? 'note' and (jsonb_typeof(p_data->'note') is distinct from 'string' or length(p_data->>'note')>500)) then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
 select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
 if found then if prior.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return prior.result;end if;
 perform 1 from uc_investor_pots where id=pot for update;
 select * into c from cars where id=p_data->>'carId' for update;
 if c.id is null then raise exception 'NOT_ALLOWED';end if;
 if not uc_car_delivered(c.id) then raise exception 'CAR_IN_STOCK';end if;
 select * into d from uc_investor_deals where car_id=c.id for update;
 if d.car_id is not null and d.pot_id<>pot then raise exception 'DEAL_OTHER_INVESTOR';end if;
 if d.state='confirmed' then raise exception 'DEAL_CONFIRMED';end if;
 blocker:=uc_deal_car_blocker(c.id);
 if blocker is not null then raise exception 'CAR_NOT_ELIGIBLE';end if;
 bp:=(p_data->>'investorBasisPoints')::integer;
 if d.car_id is null then
  insert into uc_investor_deals(car_id,pot_id,investor_basis_points,note,created_by,updated_by) values(c.id,pot,bp,trim(coalesce(p_data->>'note','')),p_actor,p_actor) returning * into d;
 else
  update uc_investor_deals set investor_basis_points=bp,note=trim(coalesce(p_data->>'note','')),updated_by=p_actor,updated_at=now() where car_id=c.id returning * into d;
 end if;
 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot,p_actor,'save_deal',jsonb_build_object('requestId',req,'carId',c.id,'basisPoints',bp));
 r:=jsonb_build_object('deal',uc_investor_deal_view(d));
 insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,p_data,r);
 return r;
end $$;

revoke all on function uc_json_present(jsonb),uc_deal_car_blocker(text),uc_capital_before_search_all(text,text,jsonb),uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_investor_capital(text,text,jsonb) to service_role;
commit;
