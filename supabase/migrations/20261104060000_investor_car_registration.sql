-- PREPARED ONLY. Install after 20261104030000_investor_journal_integration.
-- Registers a NEW car and funds it from one investor account atomically.
-- This transaction never posts a legacy purchase journal or payment; the
-- investor_funded flag is set by the uc_mark_funded_car trigger, and the bank
-- purchase payment is recorded later with purchase_paid.
begin;
create or replace function public.uc_register_investor_car(p_actor text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor garage_building_staff%rowtype;
 prior uc_investor_commands%rowtype;
 req text:=p_data->>'requestId';
 car_in jsonb:=p_data->'car';
 v_car_id text;
 allowed text[]:=array['id','make','model','variant','car_plate','colour','condition','transmission','notes','current_location',
  'assigned_salesperson','photo_taken_by','source_salesman','source_type','external_salesman_id','source_salesman_id',
  'coming_soon_type','panel_dealer_id','shipment_id','year','mileage','purchase_price','selling_price','price_floor',
  'sales_commission','source_commission','intake_commission','panel_charge_amount','green_card','thumbprint_done',
  'intake_complete','is_recon','is_staff_sale','waive_commission','seller_thumbprint_saved','date_added','car_in_date',
  'status','photo','photos','checklist_items'];
 cols text;
 price numeric;
 funded jsonb;
 row_out jsonb;
 result jsonb;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(array['car','potId','investorBasisPoints','requestId']))) then raise exception 'INVALID';end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if req is null or req !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
 -- Replay: identical original payload (including the whole car) returns the
 -- stored result; nothing new is written and no bank movement is added.
 select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
 if found then if prior.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return prior.result;end if;

 if jsonb_typeof(car_in) is distinct from 'object' or (p_data->>'potId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_data->'investorBasisPoints') is distinct from 'number' or (p_data->>'investorBasisPoints') !~ '^[0-9]{1,5}$'
  or (p_data->>'investorBasisPoints')::integer>10000 then raise exception 'INVALID';end if;
 if exists(select 1 from jsonb_object_keys(car_in) k where not(k=any(allowed))) then raise exception 'INVALID';end if;
 v_car_id:=car_in->>'id';
 if jsonb_typeof(car_in->'id') is distinct from 'string' or v_car_id !~ '^[A-Za-z0-9_-]{1,100}$'
  or coalesce(car_in->>'status','') not in ('available','coming_soon','in_workshop','ready','photo_complete','submitted')
  or jsonb_typeof(car_in->'purchase_price') is distinct from 'number' then raise exception 'INVALID';end if;
 price:=(car_in->>'purchase_price')::numeric;
 if price<=0 or price>10000000000 or price*100<>trunc(price*100) then raise exception 'INVALID';end if;

 -- One pot per car: serialize on the account and on the new car id.
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':fund_'||md5(p_actor||':'||req),0));
 perform pg_advisory_xact_lock(hashtextextended('uc-pot:'||(p_data->>'potId'),0));
 perform pg_advisory_xact_lock(hashtextextended('uc-car:'||v_car_id,0));
 perform 1 from uc_investor_pots where id=(p_data->>'potId')::uuid for update;
 if not found then raise exception 'NOT_ALLOWED';end if;
 if exists(select 1 from cars c where c.id=v_car_id) or exists(select 1 from uc_investor_cars a where a.car_id=v_car_id) then raise exception 'CAR_EXISTS';end if;

 -- Insert only the supplied whitelisted columns so table defaults apply to the rest.
 -- investor_id/investor_split/consignment/trade-in are never in the list, so stay NULL/default.
 car_in:=car_in||jsonb_build_object('investor_id',null,'investor_split',null,'consignment',null,'outgoing_consignment',null,'trade_in_source_car_id',null);
 select string_agg(quote_ident(k),',' order by k) into cols from jsonb_object_keys(car_in) k;
 execute format('insert into public.cars(%s) select %s from jsonb_populate_record(null::public.cars,$1)',cols,cols) using car_in;

 funded:=public.uc_investor_capital(p_actor,'fund_car',jsonb_build_object(
  'carId',v_car_id,'potId',p_data->>'potId','purchaseCents',(price*100)::bigint,
  'investorBasisPoints',(p_data->>'investorBasisPoints')::integer,
  'requestId','fund_'||md5(p_actor||':'||req)));

 select to_jsonb(c) into row_out from cars c where c.id=v_car_id;
 if row_out is null or coalesce((row_out->>'investor_funded')::boolean,false) is not true then raise exception 'INVALID';end if;
 result:=jsonb_build_object('car',row_out,'account',funded);
 insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,p_data,result);
 return result;
end $$;

revoke all on function public.uc_register_investor_car(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_register_investor_car(text,jsonb) to service_role;
commit;
