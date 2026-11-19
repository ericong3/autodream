-- The investor's own app lists their delivered cars (cars bought with their
-- money that were sold before being in their account). A draft shows only
-- "result being finalised"; amounts appear after the Director confirms.
begin;
do $$ begin
 if to_regprocedure('public.uc_capital_before_app_profit(text,text,jsonb)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;
alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_delivered_view;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;pot uuid;
begin
 r:=uc_capital_before_delivered_view(p_actor,p_action,p_data);
 if p_action<>'snapshot' or r->'position'->>'potId' is null then return r;end if;
 pot:=(r->'position'->>'potId')::uuid;
 return r||jsonb_build_object('deliveredCars',coalesce((select jsonb_agg(jsonb_build_object('carId',c.id,'make',c.make,'model',c.model,'year',c.year,'plate',c.car_plate,'photo',c.photo,
   'state',d.state,'investorBasisPoints',case when d.state='confirmed' then d.investor_basis_points end,
   'profitCents',case when d.state='confirmed' then d.profit_cents end,'shareCents',case when d.state='confirmed' then d.share_cents end,'confirmedAt',d.confirmed_at)
   order by d.state desc,d.updated_at desc)
  from uc_investor_deals d join cars c on c.id=d.car_id where d.pot_id=pot),'[]'::jsonb));
end $$;
revoke all on function uc_capital_before_delivered_view(text,text,jsonb),uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_investor_capital(text,text,jsonb) to service_role;
commit;
