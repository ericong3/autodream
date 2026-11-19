-- Company cars bought with an investor's money ("investor deals").
--
-- Many cars were bought with an investor's money before the app was used for
-- payments, and are kept as ordinary company cars (often already sold). The
-- Director marks such a car as an investor deal: which investor and their
-- profit share. While a DRAFT it can be changed or removed at any time. When
-- the car's profit is final, the Director confirms the investor's share:
--   * profit = the car's own income-statement result in the ledger
--     (sale revenue minus cost of sale, commissions and other car expenses);
--   * the Director may adjust the share amount before confirming;
--   * confirming posts Dr investor profit share expense / Cr investor capital
--     owed, and credits the investor's account. No bank money moves.
-- Confirmed deals are permanent history.
begin;
do $$ begin
 if to_regprocedure('public.uc_capital_before_transfers(text,text,jsonb)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;
insert into ledger_accounts(id,name,type) values('acct-exp-investor-profit-share','Investor Share of Company Car Profit','expense') on conflict(id) do nothing;

create table public.uc_investor_deals(
 car_id text primary key references cars(id),pot_id uuid not null references uc_investor_pots(id),
 investor_basis_points integer not null check(investor_basis_points between 0 and 10000),note text not null default '' check(length(note)<=500),
 state text not null default 'draft' check(state in ('draft','confirmed')),
 profit_cents bigint,share_cents bigint,confirm_note text,confirmed_by text references garage_building_staff(id),confirmed_at timestamptz,
 created_by text not null references garage_building_staff(id),created_at timestamptz not null default now(),updated_by text not null references garage_building_staff(id),updated_at timestamptz not null default now(),
 check((state='confirmed')=(confirmed_at is not null and share_cents is not null and profit_cents is not null and confirmed_by is not null))
);
create index uc_investor_deals_pot on uc_investor_deals(pot_id);
create function public.uc_investor_deal_fixed() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.state='confirmed' then raise exception 'DEAL_CONFIRMED';end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
create trigger uc_investor_deal_fixed before update or delete on uc_investor_deals for each row execute function uc_investor_deal_fixed();
create trigger uc_investor_deals_no_truncate before truncate on uc_investor_deals execute function uc_investor_immutable();
alter table uc_investor_deals enable row level security;
revoke all on uc_investor_deals from public,anon,authenticated,service_role;

-- A car's own profit in the ledger, excluding the investor share itself.
create function public.uc_car_book_profit_cents(p_car text) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(round(sum((l->>'credit')::numeric-(l->>'debit')::numeric)*100),0)::bigint
 from journal_entries j cross join lateral jsonb_array_elements(j.lines) l join ledger_accounts a on a.id=l->>'accountId'
 where j.car_id=p_car and not coalesce(j.voided,false) and j.id not like 'uc:deal:%' and a.type in ('revenue','expense','cogs') $$;
create function public.uc_car_is_sold(p_car text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from journal_entries where car_id=p_car and source_type='car_sold' and not coalesce(voided,false)) $$;
create function public.uc_investor_deal_view(d uc_investor_deals) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('carId',c.id,'make',c.make,'model',c.model,'year',c.year,'plate',c.car_plate,'photo',c.photo,'status',c.status,
  'sold',uc_car_is_sold(c.id),'profitCents',case when d.state='confirmed' then d.profit_cents else uc_car_book_profit_cents(c.id) end,
  'investorBasisPoints',d.investor_basis_points,'note',d.note,'state',d.state,
  'estimatedShareCents',case when uc_car_is_sold(c.id) then round(uc_car_book_profit_cents(c.id)::numeric*d.investor_basis_points/10000)::bigint end,
  'shareCents',d.share_cents,'confirmNote',d.confirm_note,'confirmedAt',d.confirmed_at,'updatedAt',d.updated_at)
 from cars c where c.id=d.car_id $$;

-- Confirmed shares are the investor's money (owed by the company).
alter function uc_investor_position(uuid) rename to uc_position_before_deals;
create function public.uc_investor_position(p_pot uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;shares bigint;begin
 r:=uc_position_before_deals(p_pot);
 select coalesce(sum(share_cents),0) into shares from uc_investor_deals where pot_id=p_pot and state='confirmed';
 if shares=0 then return r;end if;
 return r||jsonb_build_object('cashCents',(r->>'cashCents')::bigint+shares,'availableCents',(r->>'availableCents')::bigint+shares,'dealProfitCents',shares);
end $$;

alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_deals;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;pot uuid;req text;c cars;d uc_investor_deals;prior uc_investor_commands;r jsonb;q text;bp integer;profit bigint;share bigint;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action not in ('deal_search','deals_list','save_deal','remove_deal','confirm_deal') then
  r:=uc_capital_before_deals(p_actor,p_action,p_data);
  if p_action='snapshot' and r->'position'->>'potId' is not null then
   r:=r||jsonb_build_object('entries',coalesce((select jsonb_agg(x.value order by x.value->>'recordedAt' desc,x.value->>'id') from(select value from jsonb_array_elements(r->'entries')
    union all select jsonb_build_object('id','deal:'||d2.car_id,'kind','deal_profit_in','amountCents',d2.share_cents,'paidOn',(d2.confirmed_at at time zone 'Asia/Kuala_Lumpur')::date,'recordedAt',d2.confirmed_at,'carId',d2.car_id,'note',d2.confirm_note)
    from uc_investor_deals d2 where d2.pot_id=(r->'position'->>'potId')::uuid and d2.state='confirmed') x),'[]'));
  end if;
  return r;
 end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if coalesce(p_data->>'potId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID';end if;
 pot:=(p_data->>'potId')::uuid;
 if not exists(select 1 from uc_investor_pots where id=pot) then raise exception 'NOT_ALLOWED';end if;
 if p_action='deal_search' then
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('potId','query')) or jsonb_typeof(p_data->'query') is distinct from 'string' or length(trim(p_data->>'query')) not between 2 and 60 then raise exception 'INVALID';end if;
  q:='%'||replace(replace(replace(lower(trim(p_data->>'query')),'\','\\'),'%','\%'),'_','\_')||'%';
  return jsonb_build_object('cars',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'make',x.make,'model',x.model,'year',x.year,'plate',x.car_plate,'photo',x.photo,'status',x.status,
    'sold',uc_car_is_sold(x.id),'profitCents',uc_car_book_profit_cents(x.id),'dealPotId',(select pot_id from uc_investor_deals where car_id=x.id)) order by x.make,x.model,x.id)
   from (select * from cars c2 where not coalesce(c2.investor_funded,false) and c2.investor_id is null
     and (c2.consignment is null or c2.consignment='null'::jsonb) and (c2.outgoing_consignment is null or c2.outgoing_consignment='null'::jsonb)
     and (lower(coalesce(c2.car_plate,'')) like q or lower(coalesce(c2.make,'')||' '||coalesce(c2.model,'')) like q or lower(coalesce(c2.model,'')) like q)
    order by c2.make,c2.model,c2.id limit 20) x),'[]'::jsonb));
 end if;
 if p_action='deals_list' then
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('potId')) then raise exception 'INVALID';end if;
  return jsonb_build_object('deals',coalesce((select jsonb_agg(uc_investor_deal_view(d2) order by d2.state,d2.updated_at desc) from uc_investor_deals d2 where d2.pot_id=pot),'[]'::jsonb));
 end if;
 req:=p_data->>'requestId';
 if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' or jsonb_typeof(p_data->'carId') is distinct from 'string' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
 select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
 if found then if prior.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return prior.result;end if;
 perform 1 from uc_investor_pots where id=pot for update;
 select * into c from cars where id=p_data->>'carId' for update;
 if c.id is null then raise exception 'NOT_ALLOWED';end if;
 select * into d from uc_investor_deals where car_id=c.id for update;
 if d.car_id is not null and d.pot_id<>pot then raise exception 'DEAL_OTHER_INVESTOR';end if;
 if p_action='save_deal' then
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('potId','carId','investorBasisPoints','note','requestId'))
   or jsonb_typeof(p_data->'investorBasisPoints') is distinct from 'number' or coalesce(p_data->>'investorBasisPoints','') !~ '^[0-9]{1,5}$' or (p_data->>'investorBasisPoints')::integer>10000
   or (p_data ? 'note' and (jsonb_typeof(p_data->'note') is distinct from 'string' or length(p_data->>'note')>500)) then raise exception 'INVALID';end if;
  if coalesce(c.investor_funded,false) or c.investor_id is not null or (c.consignment is not null and c.consignment<>'null'::jsonb) or (c.outgoing_consignment is not null and c.outgoing_consignment<>'null'::jsonb) then raise exception 'CAR_NOT_ELIGIBLE';end if;
  if d.state='confirmed' then raise exception 'DEAL_CONFIRMED';end if;
  bp:=(p_data->>'investorBasisPoints')::integer;
  if d.car_id is null then
   insert into uc_investor_deals(car_id,pot_id,investor_basis_points,note,created_by,updated_by) values(c.id,pot,bp,trim(coalesce(p_data->>'note','')),p_actor,p_actor) returning * into d;
  else
   update uc_investor_deals set investor_basis_points=bp,note=trim(coalesce(p_data->>'note','')),updated_by=p_actor,updated_at=now() where car_id=c.id returning * into d;
  end if;
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot,p_actor,'save_deal',jsonb_build_object('requestId',req,'carId',c.id,'basisPoints',bp));
  r:=jsonb_build_object('deal',uc_investor_deal_view(d));
 elsif p_action='remove_deal' then
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('potId','carId','requestId')) then raise exception 'INVALID';end if;
  if d.car_id is null then raise exception 'NOT_ALLOWED';end if;
  if d.state='confirmed' then raise exception 'DEAL_CONFIRMED';end if;
  delete from uc_investor_deals where car_id=c.id;
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot,p_actor,'remove_deal',jsonb_build_object('requestId',req,'carId',c.id));
  r:=jsonb_build_object('removed',c.id);
 else
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('potId','carId','shareCents','note','requestId'))
   or jsonb_typeof(p_data->'shareCents') is distinct from 'number' or coalesce(p_data->>'shareCents','') !~ '^-?[0-9]{1,13}$'
   or jsonb_typeof(p_data->'note') is distinct from 'string' or length(trim(p_data->>'note')) not between 3 and 500 then raise exception 'INVALID';end if;
  if d.car_id is null then raise exception 'NOT_ALLOWED';end if;
  if d.state='confirmed' then raise exception 'DEAL_CONFIRMED';end if;
  if not uc_car_is_sold(c.id) then raise exception 'CAR_NOT_SOLD';end if;
  profit:=uc_car_book_profit_cents(c.id);share:=(p_data->>'shareCents')::bigint;
  if (profit>=0 and share not between 0 and profit) or (profit<0 and share not between profit and 0) then raise exception 'SHARE_OUT_OF_RANGE';end if;
  update uc_investor_deals set state='confirmed',profit_cents=profit,share_cents=share,confirm_note=trim(p_data->>'note'),confirmed_by=p_actor,confirmed_at=now(),updated_by=p_actor,updated_at=now() where car_id=c.id returning * into d;
  if share<>0 then
   perform uc_post_journal('deal:'||c.id,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Investor share of car profit',c.id,p_actor,case when share>0 then jsonb_build_array(
    jsonb_build_object('accountId','acct-exp-investor-profit-share','debit',share::numeric/100,'credit',0),jsonb_build_object('accountId','acct-investor-payable','debit',0,'credit',share::numeric/100))
   else jsonb_build_array(jsonb_build_object('accountId','acct-investor-payable','debit',(-share)::numeric/100,'credit',0),jsonb_build_object('accountId','acct-exp-investor-profit-share','debit',0,'credit',(-share)::numeric/100)) end);
  end if;
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot,p_actor,'confirm_deal',jsonb_build_object('requestId',req,'carId',c.id,'profitCents',profit,'shareCents',share));
  r:=jsonb_build_object('deal',uc_investor_deal_view(d),'position',uc_investor_position(pot));
 end if;
 insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,p_data,r);
 return r;
end $$;

-- A car with an investor deal cannot also be moved or allocated, and vice versa.
create function public.uc_investor_deal_car_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from uc_investor_deals where car_id=new.car_id) then raise exception 'CAR_HAS_INVESTOR_DEAL';end if;
 return new;
end $$;
create trigger uc_investor_deal_car_guard before insert on uc_investor_cars for each row execute function uc_investor_deal_car_guard();
create function public.uc_investor_deal_funded_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from uc_investor_cars where car_id=new.car_id) then raise exception 'CAR_NOT_ELIGIBLE';end if;
 return new;
end $$;
create trigger uc_investor_deal_funded_guard before insert on uc_investor_deals for each row execute function uc_investor_deal_funded_guard();

revoke all on function uc_investor_deal_fixed(),uc_car_book_profit_cents(text),uc_car_is_sold(text),uc_investor_deal_view(uc_investor_deals),uc_position_before_deals(uuid),uc_investor_position(uuid),
 uc_capital_before_deals(text,text,jsonb),uc_investor_capital(text,text,jsonb),uc_investor_deal_car_guard(),uc_investor_deal_funded_guard() from public,anon,authenticated,service_role;
grant execute on function uc_investor_capital(text,text,jsonb) to service_role;
commit;
