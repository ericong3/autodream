-- Allocate a car to an investor before their capital is in ("capital advance").
--
-- An investor's capital may still be on its way, e.g. 2TN payouts that will be
-- locked as investment once their costs are confirmed. The Director may then
-- allocate a car with a written reason: the company fronts the shortfall as a
-- capital advance. No bank money moves and no journal is posted; it only
-- lets the investor's account cover the car until capital arrives.
--   * Waiting-for-capital = advances minus capital later received or locked.
--   * It counts as the investor's cash while waiting, so the car's purchase
--     and the protections on company money still hold.
--   * No withdrawal can be requested, approved or paid while any is waiting.
-- Advances are permanent history.
begin;
do $$ begin
 if to_regprocedure('public.uc_capital_before_opening_purchases(text,text,jsonb)') is null
  or to_regclass('public.uc_dealer_conversions') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;

create table public.uc_investor_advances(
 id uuid primary key default gen_random_uuid(),pot_id uuid not null references uc_investor_pots(id),car_id text not null references cars(id),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),reason text not null check(length(trim(reason)) between 3 and 500),
 created_by text not null references garage_building_staff(id),created_at timestamptz not null default now(),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),unique(created_by,request_id)
);
create index uc_investor_advances_pot on uc_investor_advances(pot_id);
create trigger uc_investor_advances_fixed before update or delete on uc_investor_advances for each row execute function uc_investor_immutable();
create trigger uc_investor_advances_no_truncate before truncate on uc_investor_advances execute function uc_investor_immutable();
alter table uc_investor_advances enable row level security;
revoke all on uc_investor_advances from public,anon,authenticated,service_role;

create function public.uc_investor_advance_waiting(p_pot uuid) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select greatest(0,coalesce((select sum(amount_cents) from uc_investor_advances where pot_id=p_pot),0)
  -coalesce((select sum(amount_cents) from uc_dealer_conversions where pot_id=p_pot),0)
  -coalesce((select sum(amount_cents) from uc_investor_cash_entries where pot_id=p_pot and kind='capital_in'),0))::bigint $$;

alter function uc_investor_position(uuid) rename to uc_position_before_advances;
create function public.uc_investor_position(p_pot uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;waiting bigint;begin
 r:=uc_position_before_advances(p_pot);waiting:=uc_investor_advance_waiting(p_pot);
 return r||jsonb_build_object('cashCents',(r->>'cashCents')::bigint+waiting,'availableCents',(r->>'availableCents')::bigint+waiting,'advanceWaitingCents',waiting);
end $$;

alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_advances;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;pot uuid;req text;need bigint;r jsonb;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action in ('request_withdrawal','approve_withdrawal','withdrawal_paid') then
  pot:=case when coalesce(p_data->>'potId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (p_data->>'potId')::uuid
   else (select p.id from uc_investor_pots p join uc_investor_profiles f on f.id=p.profile_id where f.linked_staff_id=p_actor) end;
  if pot is not null and uc_investor_advance_waiting(pot)>0 then raise exception 'CAPITAL_ADVANCE_WAITING';end if;
 end if;
 if p_action='fund_car' and p_data ? 'advanceReason' then
  select * into actor from garage_building_staff where id=p_actor for share;
  if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
  if jsonb_typeof(p_data->'advanceReason') is distinct from 'string' or length(trim(p_data->>'advanceReason')) not between 3 and 500
   or coalesce(p_data->>'potId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_data->'carId') is distinct from 'string' or coalesce(p_data->>'purchaseCents','') !~ '^[1-9][0-9]{0,12}$'
   or coalesce(p_data->>'requestId','') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  pot:=(p_data->>'potId')::uuid;req:=p_data->>'requestId';
  perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
  if not exists(select 1 from uc_investor_commands where actor_id=p_actor and request_id=req) then
   perform 1 from uc_investor_pots where id=pot for update;
   if not found then raise exception 'NOT_ALLOWED';end if;
   if not exists(select 1 from cars where id=p_data->>'carId') then raise exception 'CAR_NOT_ELIGIBLE';end if;
   need:=(p_data->>'purchaseCents')::bigint-(uc_investor_position(pot)->>'availableCents')::bigint;
   if need>0 then
    insert into uc_investor_advances(pot_id,car_id,amount_cents,reason,created_by,request_id) values(pot,p_data->>'carId',need,trim(p_data->>'advanceReason'),p_actor,req);
    insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot,p_actor,'capital_advance',jsonb_build_object('requestId',req,'carId',p_data->>'carId','amountCents',need,'reason',trim(p_data->>'advanceReason')));
   end if;
  end if;
  return uc_capital_before_advances(p_actor,p_action,p_data-'advanceReason');
 end if;
 return uc_capital_before_advances(p_actor,p_action,p_data);
end $$;

-- Money history: show each advance, so the investor sees why cash appeared.
alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_advance_history;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;begin
 r:=uc_capital_before_advance_history(p_actor,p_action,p_data);
 if p_action='snapshot' and r->'position'->>'potId' is not null then
  r:=r||jsonb_build_object('entries',coalesce((select jsonb_agg(x.value order by x.value->>'recordedAt' desc,x.value->>'id') from(select value from jsonb_array_elements(r->'entries')
   union all select jsonb_build_object('id',a.id::text,'kind','capital_advance','amountCents',a.amount_cents,'paidOn',(a.created_at at time zone 'Asia/Kuala_Lumpur')::date,'recordedAt',a.created_at,'carId',a.car_id,'note',a.reason)
   from uc_investor_advances a where a.pot_id=(r->'position'->>'potId')::uuid) x),'[]'));
 end if;
 return r;
end $$;
revoke all on function uc_investor_advance_waiting(uuid),uc_position_before_advances(uuid),uc_investor_position(uuid),uc_capital_before_advances(text,text,jsonb),uc_capital_before_advance_history(text,text,jsonb),uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_investor_capital(text,text,jsonb) to service_role;
commit;
