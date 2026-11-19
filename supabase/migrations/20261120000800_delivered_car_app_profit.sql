-- Delivered cars sold before the accounts started have no car journals, so
-- their profit is the app's own car profit (sale, purchase, repairs, misc,
-- commissions), which the Director's screen sends when confirming.
-- Also: refusing a car now says exactly why (blocker code) instead of a
-- general "cannot be funded".
begin;
do $$ begin
 if to_regprocedure('public.uc_capital_before_search_all(text,text,jsonb)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;

alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_app_profit;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;pot uuid;c cars;d uc_investor_deals;prior uc_investor_commands;req text;r jsonb;blocker text;profit bigint;share bigint;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action not in ('save_deal','confirm_deal') then return uc_capital_before_app_profit(p_actor,p_action,p_data);end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_action='save_deal' then
  if jsonb_typeof(p_data->'carId')='string' then
   blocker:=uc_deal_car_blocker(p_data->>'carId');
   if blocker is not null and blocker<>'CAR_NOT_ELIGIBLE' then raise exception '%',blocker;end if;
  end if;
  return uc_capital_before_app_profit(p_actor,p_action,p_data);
 end if;
 -- confirm_deal with the app's car profit
 if coalesce(p_data->>'potId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID';end if;
 pot:=(p_data->>'potId')::uuid;
 req:=p_data->>'requestId';
 if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' or jsonb_typeof(p_data->'carId') is distinct from 'string'
  or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('potId','carId','shareCents','profitCents','note','requestId'))
  or jsonb_typeof(p_data->'shareCents') is distinct from 'number' or coalesce(p_data->>'shareCents','') !~ '^-?[0-9]{1,13}$'
  or jsonb_typeof(p_data->'profitCents') is distinct from 'number' or coalesce(p_data->>'profitCents','') !~ '^-?[0-9]{1,13}$'
  or jsonb_typeof(p_data->'note') is distinct from 'string' or length(trim(p_data->>'note')) not between 3 and 500 then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
 select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
 if found then if prior.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return prior.result;end if;
 if not exists(select 1 from uc_investor_pots where id=pot) then raise exception 'NOT_ALLOWED';end if;
 perform 1 from uc_investor_pots where id=pot for update;
 select * into c from cars where id=p_data->>'carId' for update;
 if c.id is null then raise exception 'NOT_ALLOWED';end if;
 select * into d from uc_investor_deals where car_id=c.id for update;
 if d.car_id is null or d.pot_id<>pot then raise exception 'NOT_ALLOWED';end if;
 if d.state='confirmed' then raise exception 'DEAL_CONFIRMED';end if;
 if not uc_car_delivered(c.id) then raise exception 'CAR_NOT_SOLD';end if;
 profit:=(p_data->>'profitCents')::bigint;share:=(p_data->>'shareCents')::bigint;
 if (profit>=0 and share not between 0 and profit) or (profit<0 and share not between profit and 0) then raise exception 'SHARE_OUT_OF_RANGE';end if;
 update uc_investor_deals set state='confirmed',profit_cents=profit,share_cents=share,confirm_note=trim(p_data->>'note'),confirmed_by=p_actor,confirmed_at=now(),updated_by=p_actor,updated_at=now() where car_id=c.id returning * into d;
 if share<>0 then
  perform uc_post_journal('deal:'||c.id,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Investor result on delivered car',c.id,p_actor,case when share>0 then jsonb_build_array(
   jsonb_build_object('accountId','acct-exp-investor-profit-share','debit',share::numeric/100,'credit',0),jsonb_build_object('accountId','acct-investor-payable','debit',0,'credit',share::numeric/100))
  else jsonb_build_array(jsonb_build_object('accountId','acct-investor-payable','debit',(-share)::numeric/100,'credit',0),jsonb_build_object('accountId','acct-exp-investor-profit-share','debit',0,'credit',(-share)::numeric/100)) end);
 end if;
 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot,p_actor,'confirm_deal',jsonb_build_object('requestId',req,'carId',c.id,'profitCents',profit,'shareCents',share));
 r:=jsonb_build_object('deal',uc_investor_deal_view(d),'position',uc_investor_position(pot));
 insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,p_data,r);
 return r;
end $$;

revoke all on function uc_capital_before_app_profit(text,text,jsonb),uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_investor_capital(text,text,jsonb) to service_role;
commit;
