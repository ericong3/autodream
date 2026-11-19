-- Move a company stock car to an investor, with its accounting.
--
-- A car already in company stock has company history: its purchase journal and
-- any repair / misc costs, all carried in company stock (acct-inv-own). The
-- Director can move such a car into an investor account:
--   * every company bill on the car must already be paid (or marked paid
--     before the bank opening), so nothing is left owing on the company side;
--   * the whole book value moves in one journal: Dr investor car stock /
--     Cr company stock (purchase price + costs already on the car);
--   * no bank money moves: the investor pays the company for the car out of
--     the investor's account (cash down by the full book value), and the
--     company fronts any shortfall as a capital advance (with a reason);
--   * the car counts as bought (purchase paid) and the carried costs count as
--     car costs, so its profit and settlement include them.
-- Moves are permanent history.
begin;
do $$ begin
 if to_regclass('public.uc_investor_advances') is null or to_regprocedure('public.uc_capital_before_advance_history(text,text,jsonb)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;

create table public.uc_investor_car_transfers(
 car_id text primary key references uc_investor_cars(car_id),pot_id uuid not null references uc_investor_pots(id),
 purchase_cents bigint not null check(purchase_cents between 1 and 1000000000000),carried_cost_cents bigint not null check(carried_cost_cents between 0 and 1000000000000),
 reason text not null check(length(trim(reason)) between 3 and 500),
 created_by text not null references garage_building_staff(id),created_at timestamptz not null default now(),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),unique(created_by,request_id)
);
create index uc_investor_car_transfers_pot on uc_investor_car_transfers(pot_id);
create trigger uc_investor_car_transfers_fixed before update or delete on uc_investor_car_transfers for each row execute function uc_investor_immutable();
create trigger uc_investor_car_transfers_no_truncate before truncate on uc_investor_car_transfers execute function uc_investor_immutable();
alter table uc_investor_car_transfers enable row level security;
revoke all on uc_investor_car_transfers from public,anon,authenticated,service_role;

-- History guards on funding: a reviewed move (flag set only below) may fund a
-- car that has company history. Every other path is unchanged.
create function public.uc_car_transfer_active(p_car text) returns boolean language sql stable set search_path=public,pg_temp as $$
 select coalesce(current_setting('autodream.uc_car_transfer',true),'')=txid_current()::text||'|'||coalesce(p_car,'') $$;
create or replace function public.uc_funded_car_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if TG_TABLE_NAME='uc_investor_cars' then
  -- Existing paid/posted history needs an explicit opening-balance conversion.
  -- Refuse it rather than purchasing the same car a second time.
  if not uc_car_transfer_active(new.car_id) and (exists(select 1 from journal_entries where car_id=new.car_id and not coalesce(voided,false))
    or exists(select 1 from payments where car_id=new.car_id))
  then raise exception 'CAR_HISTORY_REVIEW_REQUIRED';end if;
  update cars set investor_funded=true where id=new.car_id;
 else
  if TG_OP='INSERT' then
   if new.investor_id is not null then raise exception 'USE_INVESTOR_ACCOUNTS';end if;
   if new.investor_funded then raise exception 'FUNDING_ACCOUNT_REQUIRED';end if;
   return new;
  end if;
  if new.investor_funded is distinct from old.investor_funded and not exists(select 1 from uc_investor_cars where car_id=new.id) then raise exception 'FUNDING_ACCOUNT_REQUIRED';end if;
  if new.investor_id is distinct from old.investor_id and new.investor_id is not null then raise exception 'USE_INVESTOR_ACCOUNTS';end if;
  if old.investor_funded and (not new.investor_funded or new.purchase_price is distinct from old.purchase_price or new.investor_id is distinct from old.investor_id or new.investor_split is distinct from old.investor_split or new.consignment is distinct from old.consignment or new.outgoing_consignment is distinct from old.outgoing_consignment) then raise exception 'FUNDING_AGREEMENT_LOCKED';end if;
 end if;
 return new;
end $$;
create or replace function public.uc_check_repair_history() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended('uc-car:'||new.car_id,0))then raise exception 'REPAIR_BUSY';end if;
 if not uc_car_transfer_active(new.car_id) and exists(select 1 from repairs where car_id=new.car_id and (status='done' or completed_at is not null or coalesce(actual_cost,0)<>0))then raise exception 'CAR_REPAIR_HISTORY_REVIEW_REQUIRED';end if;
 return new;
end $$;
create or replace function public.uc_check_misc_history() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
 select c.misc_costs into v from cars c where c.id=new.car_id for update;
 if not found then raise exception 'CAR_MISC_HISTORY_REVIEW_REQUIRED';end if;
 if uc_car_transfer_active(new.car_id) and (v is null or jsonb_typeof(v)='array') then return new;end if;
 if v is null or jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)<>0 then raise exception 'CAR_MISC_HISTORY_REVIEW_REQUIRED';end if;
 return new;
end $$;

-- Company stock value of a car in cents (purchase + capitalised costs).
create function public.uc_company_stock_cents(p_car text) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(round(sum((l->>'debit')::numeric-(l->>'credit')::numeric)*100),0)::bigint from journal_entries j cross join lateral jsonb_array_elements(j.lines) l
 where j.car_id=p_car and not coalesce(j.voided,false) and l->>'accountId'='acct-inv-own' $$;
-- Why a car cannot move (null when it can).
create function public.uc_car_transfer_blocker(p_car text) returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c cars;stock bigint;begin
 select * into c from cars where id=p_car;
 if c.id is null then return 'CAR_NOT_ELIGIBLE';end if;
 if coalesce(c.status,'') not in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') or c.investor_id is not null
  or c.trade_in_source_car_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true' or coalesce(c.investor_funded,false)
  or (c.consignment is not null and c.consignment<>'null'::jsonb) or (c.outgoing_consignment is not null and c.outgoing_consignment<>'null'::jsonb)
  or exists(select 1 from uc_investor_cars where car_id=c.id) or exists(select 1 from uc_consignment_cases where car_id=c.id)
  or exists(select 1 from uc_company_car_purchases where car_id=c.id) or exists(select 1 from uc_company_trade_in_applications where incoming_car_id=c.id)
  or exists(select 1 from uc_trade_in_applications where incoming_car_id=c.id) then return 'CAR_NOT_ELIGIBLE';end if;
 if c.purchase_price is null or c.purchase_price<=0 or c.purchase_price*100<>trunc(c.purchase_price*100) or c.purchase_price*100>1000000000000 then return 'PURCHASE_PRICE_REQUIRED';end if;
 if not exists(select 1 from journal_entries where car_id=c.id and source_type='car_purchased' and not coalesce(voided,false)) then return 'COMPANY_PURCHASE_NOT_RECORDED';end if;
 if exists(select 1 from payments p where p.car_id=c.id and p.status='pending' and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false)) then return 'COMPANY_BILLS_UNPAID';end if;
 if exists(select 1 from repairs r where r.car_id=c.id and coalesce(r.status,'') not in ('done','cancelled') and r.completed_at is null) then return 'REPAIR_IN_PROGRESS';end if;
 stock:=uc_company_stock_cents(c.id);
 if stock<(c.purchase_price*100)::bigint then return 'COMPANY_STOCK_REVIEW_REQUIRED';end if;
 return null;
end $$;

-- The moved car counts as bought, with the carried costs as car costs.
alter function uc_investor_car_summary(text) rename to uc_car_summary_before_transfers;
create function public.uc_investor_car_summary(p_car text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;t uc_investor_car_transfers;paid bigint;begin
 r:=uc_car_summary_before_transfers(p_car);if r is null then return null;end if;
 select * into t from uc_investor_car_transfers where car_id=p_car;
 if t.car_id is null then return r;end if;
 paid:=(r->>'purchasePaidCents')::bigint+t.purchase_cents;
 return r||jsonb_build_object('purchasePaidCents',paid,'costCents',(r->>'costCents')::bigint+t.carried_cost_cents,
  'profitCents',case when r->>'profitCents' is not null then (r->>'profitCents')::bigint-t.carried_cost_cents end,
  'state',case when r->>'state'='reserved' and paid=(r->>'purchaseCents')::bigint then 'in_stock' else r->>'state' end,
  'movedFromCompany',true,'carriedCostCents',t.carried_cost_cents,'movedAt',t.created_at);
end $$;
-- The investor paid the company for each moved car out of their account.
alter function uc_investor_position(uuid) rename to uc_position_before_transfers;
create function public.uc_investor_position(p_pot uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;purchases bigint;total bigint;begin
 r:=uc_position_before_transfers(p_pot);
 select coalesce(sum(purchase_cents),0),coalesce(sum(purchase_cents+carried_cost_cents),0) into purchases,total from uc_investor_car_transfers where pot_id=p_pot;
 if total=0 then return r;end if;
 return r||jsonb_build_object('cashCents',(r->>'cashCents')::bigint-total,'availableCents',(r->>'availableCents')::bigint-total+purchases,
  'reservedCents',(r->>'reservedCents')::bigint-purchases,'purchaseReservedCents',(r->>'purchaseReservedCents')::bigint-purchases);
end $$;

alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_transfers;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;pot uuid;req text;c cars;blocker text;price bigint;stock bigint;carried bigint;need bigint;bp integer;r jsonb;prior uc_investor_commands;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action in ('transferable_cars','transfer_car') then
  select * into actor from garage_building_staff where id=p_actor for share;
  if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 end if;
 if p_action='transferable_cars' then
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('potId')) then raise exception 'INVALID';end if;
  return jsonb_build_object('cars',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'make',x.make,'model',x.model,'year',x.year,'car_plate',x.car_plate,'photo',x.photo,
    'purchaseCents',(x.purchase_price*100)::bigint,'stockCents',uc_company_stock_cents(x.id),'blocker',x.blocker) order by x.make,x.model,x.id)
   from (select c2.*,uc_car_transfer_blocker(c2.id) blocker from cars c2
    where coalesce(c2.status,'') in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') and not coalesce(c2.investor_funded,false)
     and (c2.consignment is null or c2.consignment='null'::jsonb) and (c2.outgoing_consignment is null or c2.outgoing_consignment='null'::jsonb)
     and exists(select 1 from journal_entries j where j.car_id=c2.id and j.source_type='car_purchased' and not coalesce(j.voided,false))
    order by c2.make,c2.model,c2.id limit 200) x where x.blocker is null or x.blocker in ('COMPANY_BILLS_UNPAID','REPAIR_IN_PROGRESS')),'[]'::jsonb));
 end if;
 if p_action='transfer_car' then
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('carId','potId','investorBasisPoints','reason','advanceReason','requestId'))
   or jsonb_typeof(p_data->'carId') is distinct from 'string' or coalesce(p_data->>'potId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_data->'investorBasisPoints') is distinct from 'number' or coalesce(p_data->>'investorBasisPoints','') !~ '^[0-9]{1,5}$' or (p_data->>'investorBasisPoints')::integer>10000
   or jsonb_typeof(p_data->'reason') is distinct from 'string' or length(trim(p_data->>'reason')) not between 3 and 500
   or (p_data ? 'advanceReason' and (jsonb_typeof(p_data->'advanceReason') is distinct from 'string' or length(trim(p_data->>'advanceReason')) not between 3 and 500))
   or coalesce(p_data->>'requestId','') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  req:=p_data->>'requestId';pot:=(p_data->>'potId')::uuid;bp:=(p_data->>'investorBasisPoints')::integer;
  perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
  select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
  if found then if prior.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return prior.result;end if;
  perform 1 from uc_investor_pots where id=pot for update;
  if not found then raise exception 'NOT_ALLOWED';end if;
  select * into c from cars where id=p_data->>'carId' for update;
  blocker:=uc_car_transfer_blocker(c.id);
  if blocker is not null then raise exception '%',blocker;end if;
  price:=(c.purchase_price*100)::bigint;stock:=uc_company_stock_cents(c.id);carried:=stock-price;
  need:=stock-(uc_investor_position(pot)->>'availableCents')::bigint;
  if need>0 then
   if not(p_data ? 'advanceReason') then raise exception 'INSUFFICIENT_FUNDS';end if;
   insert into uc_investor_advances(pot_id,car_id,amount_cents,reason,created_by,request_id) values(pot,c.id,need,trim(p_data->>'advanceReason'),p_actor,req);
   insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot,p_actor,'capital_advance',jsonb_build_object('requestId',req,'carId',c.id,'amountCents',need,'reason',trim(p_data->>'advanceReason')));
  end if;
  -- The old tagging column defaults to 50 on every car; with no investor set it means nothing.
  update cars set investor_split=null where id=c.id and investor_id is null and investor_split is not null;
  perform set_config('autodream.uc_car_transfer',txid_current()::text||'|'||c.id,true);
  r:=uc_capital_before_transfers(p_actor,'fund_car',jsonb_build_object('carId',c.id,'potId',pot,'purchaseCents',price,'investorBasisPoints',bp,'requestId','move_'||md5(p_actor||':'||req)));
  perform set_config('autodream.uc_car_transfer','',true);
  insert into uc_investor_car_transfers(car_id,pot_id,purchase_cents,carried_cost_cents,reason,created_by,request_id) values(c.id,pot,price,carried,trim(p_data->>'reason'),p_actor,req);
  perform uc_post_journal('move:'||c.id,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Car moved from company stock to investor',c.id,p_actor,jsonb_build_array(
   jsonb_build_object('accountId','acct-inv-investor','debit',stock::numeric/100,'credit',0),jsonb_build_object('accountId','acct-inv-own','debit',0,'credit',stock::numeric/100)));
  if (uc_investor_position(pot)->>'availableCents')::bigint<0 then raise exception 'INSUFFICIENT_FUNDS';end if;
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot,p_actor,'transfer_car',jsonb_build_object('requestId',req,'carId',c.id,'purchaseCents',price,'carriedCostCents',carried,'reason',trim(p_data->>'reason')));
  r:=jsonb_build_object('car',uc_investor_car_summary(c.id),'position',uc_investor_position(pot),'carriedCostCents',carried);
  insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,p_data,r);
  return r;
 end if;
 r:=uc_capital_before_transfers(p_actor,p_action,p_data);
 if p_action='snapshot' and r->'position'->>'potId' is not null then
  r:=r||jsonb_build_object('entries',coalesce((select jsonb_agg(x.value order by x.value->>'recordedAt' desc,x.value->>'id') from(select value from jsonb_array_elements(r->'entries')
   union all select jsonb_build_object('id','move:'||t.car_id,'kind','car_moved_in','amountCents',-(t.purchase_cents+t.carried_cost_cents),'paidOn',(t.created_at at time zone 'Asia/Kuala_Lumpur')::date,'recordedAt',t.created_at,'carId',t.car_id,'note',t.reason)
   from uc_investor_car_transfers t where t.pot_id=(r->'position'->>'potId')::uuid) x),'[]'));
 end if;
 return r;
end $$;
revoke all on function uc_car_transfer_active(text),uc_company_stock_cents(text),uc_car_transfer_blocker(text),uc_car_summary_before_transfers(text),uc_investor_car_summary(text),
 uc_position_before_transfers(uuid),uc_investor_position(uuid),uc_capital_before_transfers(text,text,jsonb),uc_investor_capital(text,text,jsonb),uc_funded_car_guard(),uc_check_repair_history(),uc_check_misc_history() from public,anon,authenticated,service_role;
grant execute on function uc_investor_capital(text,text,jsonb) to service_role;
commit;
