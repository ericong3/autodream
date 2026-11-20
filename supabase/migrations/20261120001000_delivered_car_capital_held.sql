-- A delivered car bought with an investor's money, still waiting for its sale
-- money (e.g. loan disbursement): the investor's capital in the car (purchase
-- plus repairs, misc and other car costs) is held in the car and is not free
-- to withdraw. When the Director confirms the final result the capital comes
-- back first and only the remaining profit is shared (net: + share, or the
-- whole loss). If the investor's capital is not in yet, the company fronts it
-- (shown as waiting for capital), like other allocated cars.
begin;
do $$ begin
 if to_regprocedure('public.uc_capital_before_delivered_view(text,text,jsonb)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;
alter table uc_investor_deals add column capital_cents bigint not null default 0 check(capital_cents between 0 and 1000000000000);

create function public.uc_deal_capital_held(p_pot uuid) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(sum(capital_cents),0)::bigint from uc_investor_deals where pot_id=p_pot and state='draft' $$;

alter function uc_investor_position(uuid) rename to uc_position_before_deal_capital;
create function public.uc_investor_position(p_pot uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;held bigint;avail bigint;short bigint;begin
 r:=uc_position_before_deal_capital(p_pot);
 held:=uc_deal_capital_held(p_pot);
 if held=0 then return r;end if;
 avail:=(r->>'availableCents')::bigint-held;short:=greatest(0,-avail);
 return r||jsonb_build_object('availableCents',greatest(0,avail),'investedCents',coalesce((r->>'investedCents')::bigint,0)+held,
  'advanceWaitingCents',coalesce((r->>'advanceWaitingCents')::bigint,0)+short,'deliveredCapitalCents',held);
end $$;

create or replace function public.uc_investor_deal_view(d uc_investor_deals) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('carId',c.id,'make',c.make,'model',c.model,'year',c.year,'plate',c.car_plate,'photo',c.photo,'status',c.status,
  'sold',uc_car_delivered(c.id),'saleRecorded',uc_car_is_sold(c.id),
  'profitCents',case when d.state='confirmed' then d.profit_cents else uc_car_book_profit_cents(c.id) end,
  'breakdown',uc_car_book_breakdown(c.id),'capitalCents',d.capital_cents,
  'investorBasisPoints',d.investor_basis_points,'note',d.note,'state',d.state,
  'estimatedShareCents',case when uc_car_is_sold(c.id) then uc_deal_investor_result(uc_car_book_profit_cents(c.id),d.investor_basis_points) end,
  'shareCents',d.share_cents,'confirmNote',d.confirm_note,'confirmedAt',d.confirmed_at,'updatedAt',d.updated_at)
 from cars c where c.id=d.car_id $$;

alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_deal_capital;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;cap bigint;d uc_investor_deals;pot uuid;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action='save_deal' then
  if not (p_data ? 'capitalCents') or jsonb_typeof(p_data->'capitalCents') is distinct from 'number' or coalesce(p_data->>'capitalCents','') !~ '^[0-9]{1,13}$' then raise exception 'INVALID';end if;
  cap:=(p_data->>'capitalCents')::bigint;
  r:=uc_capital_before_deal_capital(p_actor,p_action,p_data-'capitalCents');
  update uc_investor_deals set capital_cents=cap where car_id=p_data->>'carId' and state='draft' returning * into d;
  return r||jsonb_build_object('deal',uc_investor_deal_view(d));
 end if;
 r:=uc_capital_before_deal_capital(p_actor,p_action,p_data);
 if p_action='snapshot' and r->'position'->>'potId' is not null and jsonb_typeof(r->'deliveredCars')='array' then
  pot:=(r->'position'->>'potId')::uuid;
  r:=r||jsonb_build_object('deliveredCars',coalesce((select jsonb_agg(x.value||jsonb_build_object('capitalCents',(select case when d2.state='draft' then d2.capital_cents end from uc_investor_deals d2 where d2.car_id=x.value->>'carId' and d2.pot_id=pot))) from jsonb_array_elements(r->'deliveredCars') x),'[]'::jsonb));
 end if;
 return r;
end $$;

revoke all on function uc_deal_capital_held(uuid),uc_position_before_deal_capital(uuid),uc_investor_position(uuid),uc_investor_deal_view(uc_investor_deals),
 uc_capital_before_deal_capital(text,text,jsonb),uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_investor_capital(text,text,jsonb) to service_role;
commit;
