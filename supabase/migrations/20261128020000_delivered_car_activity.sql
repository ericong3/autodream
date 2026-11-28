-- Delivered cars in the investor's Activity.
--
-- A delivered car bought with the investor's money (e.g. Veloz VLM6465) never
-- had a money line, so Activity showed nothing for it while Home already
-- counted its money in the car and the company's fronting. Activity now lists,
-- for each delivered car with money in it:
--   * "Delivered car bought with your money"  - the money in the car,
--     dated the day the car was bought;
--   * "Company fronted money for a car"        + the part the company covered
--     because the investor's own money was not enough. Worked out each time
--     the draft is saved and kept as history, like other fronted money;
--   * once the final result is confirmed,
--     "Your money back from delivered car"     + the part that was the
--     investor's own money (the fronted part goes back to the company),
--     next to the existing "Delivered car result" line.
-- Reading only: no bank money moves, no books entry is posted, and balances,
-- waiting for capital and withdrawals work exactly as before.
begin;
do $$ begin
 if to_regprocedure('public.uc_capital_before_deal_capital(text,text,jsonb)') is null
  or to_regprocedure('public.uc_position_before_deal_capital(uuid)') is null
  or to_regprocedure('public.uc_deal_capital_held(uuid)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;

alter table uc_investor_deals add column fronted_cents bigint not null default 0 check(fronted_cents between 0 and 1000000000000);

-- How much of the delivered cars' money the company is fronting right now
-- (the same figure Home adds to "waiting for capital").
create function public.uc_deal_capital_fronted(p_pot uuid) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select case when uc_deal_capital_held(p_pot)=0 then 0
  else greatest(0,uc_deal_capital_held(p_pot)-coalesce((uc_position_before_deal_capital(p_pot)->>'availableCents')::bigint,0)) end::bigint $$;

-- The day the car was bought, from its purchase entry in the books.
create function public.uc_deal_bought_on(p_car text) returns date language sql stable security definer set search_path=public,pg_temp as $$
 select min(left(j.date::text,10)::date) from journal_entries j
 where (j.car_id=p_car or j.source_id=p_car) and not coalesce(j.voided,false)
  and j.source_type in ('car_purchased','trade_in_acquired','purchase_settlement_recognized') and j.date::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' $$;

-- Drafts already saved with money in them: share the investor's free money
-- over them, oldest first; the rest is what the company fronted.
do $$ declare p uuid;free bigint;d record;own bigint;begin
 for p in select distinct pot_id from uc_investor_deals where state='draft' and capital_cents>0 loop
  free:=greatest(0,coalesce((uc_position_before_deal_capital(p)->>'availableCents')::bigint,0));
  for d in select car_id,capital_cents from uc_investor_deals where pot_id=p and state='draft' and capital_cents>0 order by created_at,car_id loop
   own:=least(d.capital_cents,free);free:=free-own;
   update uc_investor_deals set fronted_cents=d.capital_cents-own where car_id=d.car_id;
  end loop;
 end loop;
end $$;

alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_deal_activity;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;pot uuid;s0 bigint;s1 bigint;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action='save_deal' and coalesce(p_data->>'potId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and coalesce(p_data->>'requestId','') ~ '^[A-Za-z0-9_-]{16,80}$' and jsonb_typeof(p_data->'carId')='string' then
  pot:=(p_data->>'potId')::uuid;
  -- Same locks the save takes, taken first so nothing changes between the two readings.
  perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||(p_data->>'requestId'),0));
  perform 1 from uc_investor_pots where id=pot for update;
  s0:=uc_deal_capital_fronted(pot);
  r:=uc_capital_before_deal_activity(p_actor,p_action,p_data);
  s1:=uc_deal_capital_fronted(pot);
  update uc_investor_deals set fronted_cents=greatest(0,least(capital_cents,fronted_cents+(s1-s0)))
   where car_id=p_data->>'carId' and pot_id=pot and state='draft' and fronted_cents<>greatest(0,least(capital_cents,fronted_cents+(s1-s0)));
  return r;
 end if;
 r:=uc_capital_before_deal_activity(p_actor,p_action,p_data);
 if p_action='snapshot' and r->'position'->>'potId' is not null then
  pot:=(r->'position'->>'potId')::uuid;
  r:=r||jsonb_build_object('entries',coalesce((select jsonb_agg(x.value order by x.value->>'recordedAt' desc,x.value->>'id') from(
   select value from jsonb_array_elements(r->'entries')
   union all select jsonb_build_object('id','deal-capital:'||d.car_id,'kind','deal_capital_out','amountCents',-d.capital_cents,
     'paidOn',coalesce(uc_deal_bought_on(d.car_id),(d.created_at at time zone 'Asia/Kuala_Lumpur')::date),'recordedAt',d.created_at,'carId',d.car_id)
    from uc_investor_deals d where d.pot_id=pot and d.capital_cents>0
   union all select jsonb_build_object('id','deal-advance:'||d.car_id,'kind','capital_advance','amountCents',least(d.fronted_cents,d.capital_cents),
     'paidOn',coalesce(uc_deal_bought_on(d.car_id),(d.created_at at time zone 'Asia/Kuala_Lumpur')::date),'recordedAt',d.created_at,'carId',d.car_id)
    from uc_investor_deals d where d.pot_id=pot and d.capital_cents>0 and d.fronted_cents>0
   union all select jsonb_build_object('id','deal-back:'||d.car_id,'kind','deal_capital_back','amountCents',d.capital_cents-least(d.fronted_cents,d.capital_cents),
     'paidOn',(d.confirmed_at at time zone 'Asia/Kuala_Lumpur')::date,'recordedAt',d.confirmed_at,'carId',d.car_id)
    from uc_investor_deals d where d.pot_id=pot and d.state='confirmed' and d.capital_cents>d.fronted_cents
  ) x),'[]'::jsonb));
 end if;
 return r;
end $$;

revoke all on function uc_deal_capital_fronted(uuid),uc_deal_bought_on(text),uc_capital_before_deal_activity(text,text,jsonb),uc_investor_capital(text,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function uc_investor_capital(text,text,jsonb) to service_role;
commit;
