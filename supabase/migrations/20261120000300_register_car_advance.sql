-- Add Car: register a car for an investor before their capital is in.
-- The Director gives a reason; the company fronts the shortfall exactly as for
-- Allocate car (20261120000200). The reason reaches the funding step through a
-- transaction-local flag set only by uc_register_investor_car.
begin;
do $$ begin
 if to_regclass('public.uc_investor_advances') is null or to_regprocedure('public.uc_capital_before_advance_history(text,text,jsonb)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;

create or replace function public.uc_capital_before_advance_history(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;pot uuid;req text;need bigint;r jsonb;flag text:=coalesce(current_setting('autodream.uc_advance_reason',true),'');data jsonb:=p_data;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action in ('request_withdrawal','approve_withdrawal','withdrawal_paid') then
  pot:=case when coalesce(p_data->>'potId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (p_data->>'potId')::uuid
   else (select p.id from uc_investor_pots p join uc_investor_profiles f on f.id=p.profile_id where f.linked_staff_id=p_actor) end;
  if pot is not null and uc_investor_advance_waiting(pot)>0 then raise exception 'CAPITAL_ADVANCE_WAITING';end if;
 end if;
 -- A car registered from Add Car passes its reason through this transaction-local flag.
 if p_action='fund_car' and not(p_data ? 'advanceReason') and split_part(flag,'|',1)=txid_current()::text then
  data:=p_data||jsonb_build_object('advanceReason',substr(flag,length(split_part(flag,'|',1))+2));
 end if;
 if p_action='fund_car' and data ? 'advanceReason' then
  select * into actor from garage_building_staff where id=p_actor for share;
  if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
  if jsonb_typeof(data->'advanceReason') is distinct from 'string' or length(trim(data->>'advanceReason')) not between 3 and 500
   or coalesce(data->>'potId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(data->'carId') is distinct from 'string' or coalesce(data->>'purchaseCents','') !~ '^[1-9][0-9]{0,12}$'
   or coalesce(data->>'requestId','') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  pot:=(data->>'potId')::uuid;req:=data->>'requestId';
  perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
  if not exists(select 1 from uc_investor_commands where actor_id=p_actor and request_id=req) then
   perform 1 from uc_investor_pots where id=pot for update;
   if not found then raise exception 'NOT_ALLOWED';end if;
   if not exists(select 1 from cars where id=data->>'carId') then raise exception 'CAR_NOT_ELIGIBLE';end if;
   need:=(data->>'purchaseCents')::bigint-(uc_investor_position(pot)->>'availableCents')::bigint;
   if need>0 then
    insert into uc_investor_advances(pot_id,car_id,amount_cents,reason,created_by,request_id) values(pot,data->>'carId',need,trim(data->>'advanceReason'),p_actor,req);
    insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot,p_actor,'capital_advance',jsonb_build_object('requestId',req,'carId',data->>'carId','amountCents',need,'reason',trim(data->>'advanceReason')));
   end if;
  end if;
  return uc_capital_before_advances(p_actor,p_action,data-'advanceReason');
 end if;
 return uc_capital_before_advances(p_actor,p_action,p_data);
end $$;

alter function uc_register_investor_car(text,jsonb) rename to uc_register_before_advances;
create function public.uc_register_investor_car(p_actor text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;begin
 if jsonb_typeof(p_data)='object' and p_data ? 'advanceReason' then
  if jsonb_typeof(p_data->'advanceReason') is distinct from 'string' or length(trim(p_data->>'advanceReason')) not between 3 and 500 or position('|' in p_data->>'advanceReason')>0 then raise exception 'INVALID';end if;
  perform set_config('autodream.uc_advance_reason',txid_current()::text||'|'||trim(p_data->>'advanceReason'),true);
  r:=uc_register_before_advances(p_actor,p_data-'advanceReason');
  perform set_config('autodream.uc_advance_reason','',true);
  return r;
 end if;
 return uc_register_before_advances(p_actor,p_data);
end $$;
revoke all on function uc_register_before_advances(text,jsonb),uc_register_investor_car(text,jsonb),uc_capital_before_advance_history(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_register_investor_car(text,jsonb) to service_role;
commit;
