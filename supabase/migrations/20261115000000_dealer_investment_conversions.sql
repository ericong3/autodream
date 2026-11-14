-- PREPARED ONLY. Dealer accounts and "lock as investment".
--
-- A consignment dealer can also be an investor (2TN = Ting Ping Liang). Money
-- the company owes the dealer for sold consignment cars (unpaid consignment
-- payouts) can be converted, in whole or in part and as many times as needed,
-- into investor capital. No bank money moves: the cash is already in the
-- company bank. Each conversion
--   * settles the oldest unpaid payouts first (the last one may be partial),
--   * counts as paid for those payouts everywhere the company already reads
--     uc_company_paid_cents (bank payments can then only pay the remainder),
--   * credits the linked investor account (cash and available balance),
--   * posts one balanced journal entry: payable cleared, investor capital owed.
-- Conversions are permanent history: they cannot be edited or deleted.
begin;
do $$ begin
 if to_regclass('public.uc_company_withheld_payments') is null or to_regclass('public.uc_investor_profit_transfers') is null
  or to_regprocedure('public.uc_capital_before_bill_adjustments(text,text,jsonb)') is null
  or to_regprocedure('public.uc_position_before_bill_adjustments(uuid)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;
insert into ledger_accounts(id,name,type) values('acct-opening-review','Opening balance waiting for review','equity') on conflict(id) do nothing;

create table public.uc_dealer_investor_links(
 dealer_id text primary key references dealers(id),pot_id uuid not null unique references uc_investor_pots(id),
 linked_by text not null references garage_building_staff(id),linked_at timestamptz not null default now()
);
create table public.uc_dealer_conversions(
 id uuid primary key default gen_random_uuid(),dealer_id text not null references dealers(id),pot_id uuid not null references uc_investor_pots(id),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),converted_on date not null,
 note text not null check(length(trim(note)) between 5 and 1000),
 actor_id text not null references garage_building_staff(id),created_at timestamptz not null default now(),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),payload jsonb not null,result jsonb,unique(actor_id,request_id)
);
create table public.uc_dealer_conversion_allocations(
 conversion_id uuid not null references uc_dealer_conversions(id),payment_id text not null references payments(id),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),primary key(conversion_id,payment_id)
);
create index uc_dealer_conversion_payment on uc_dealer_conversion_allocations(payment_id);
create index uc_dealer_conversion_pot on uc_dealer_conversions(pot_id);
do $$ declare t text;begin
 foreach t in array array['uc_dealer_investor_links','uc_dealer_conversions','uc_dealer_conversion_allocations'] loop
  execute format('create trigger %I before update or delete on %I for each row execute function uc_investor_immutable()',t||'_fixed',t);
  execute format('create trigger %I before truncate on %I execute function uc_investor_immutable()',t||'_no_truncate',t);
  execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

-- A converted amount is a settlement of the payout, like a bank allocation.
create or replace function public.uc_company_paid_cents(p_payment text) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select (coalesce((select sum(amount_cents) from uc_company_bank_allocations where payment_id=p_payment),0)+coalesce((select sum(covered_cents) from uc_company_bank_receipts where payment_id=p_payment),0)+coalesce((select sum(amount_cents) from uc_company_withheld_payments where payment_id=p_payment),0)
  +coalesce((select sum(amount_cents) from uc_dealer_conversion_allocations where payment_id=p_payment),0))::bigint $$;
create or replace function public.uc_company_has_bank_history(p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from uc_company_bank_allocations where payment_id=p_payment) or exists(select 1 from uc_company_bank_receipts where payment_id=p_payment) or exists(select 1 from uc_company_withheld_payments where payment_id=p_payment)
  or exists(select 1 from uc_dealer_conversion_allocations where payment_id=p_payment) $$;

-- Investor balance: converted capital is cash the company holds for the investor.
alter function uc_investor_position(uuid) rename to uc_position_before_dealer_conversions;
create function public.uc_investor_position(p_pot uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;converted bigint;begin
 r:=uc_position_before_dealer_conversions(p_pot);
 select coalesce(sum(amount_cents),0) into converted from uc_dealer_conversions where pot_id=p_pot;
 return r||jsonb_build_object('cashCents',(r->>'cashCents')::bigint+converted,'availableCents',(r->>'availableCents')::bigint+converted,'convertedCapitalCents',converted);
end $$;

-- Money history shows each conversion as capital received from payouts.
alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_dealer_conversions;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;begin
 r:=uc_capital_before_dealer_conversions(p_actor,p_action,p_data);
 if p_action='snapshot' and r->'position'->>'potId' is not null then
  r:=r||jsonb_build_object('entries',coalesce((select jsonb_agg(x.value order by x.value->>'recordedAt' desc,x.value->>'id') from(select value from jsonb_array_elements(r->'entries')
   union all select jsonb_build_object('id',v.id::text,'kind','capital_converted','amountCents',v.amount_cents,'paidOn',v.converted_on,'recordedAt',v.created_at,'note',v.note)
   from uc_dealer_conversions v where v.pot_id=(r->'position'->>'potId')::uuid) x),'[]'));
 end if;
 return r;
end $$;

-- Read model for one dealer: cars, payouts, conversions and totals.
create function public.uc_dealer_view(p_dealer text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d dealers;l uc_dealer_investor_links;investor text;payouts jsonb;cars_json jsonb;begin
 select * into d from dealers where id=p_dealer;if d.id is null then raise exception 'DEALER_NOT_FOUND';end if;
 select * into l from uc_dealer_investor_links where dealer_id=d.id;
 if l.pot_id is not null then select f.name into investor from uc_investor_pots p join uc_investor_profiles f on f.id=p.profile_id where p.id=l.pot_id;end if;
 with p as (
  select p.id,p.car_id,p.status,p.created_at,p.transferred_at,coalesce(uc_commission_cents(to_jsonb(p)->'amount'),0) amount,
   coalesce((select sum(amount_cents) from uc_dealer_conversion_allocations where payment_id=p.id),0) converted,
   coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false) replaced
  from payments p where p.type='consignment_payout' and (p.recipient_id=d.id or lower(p.recipient_name)=lower(d.name))
 ), q as (
  select p.*,case when p.replaced then 0 when p.status='transferred' then greatest(0,p.amount-p.converted) else greatest(0,uc_company_paid_cents(p.id)-p.converted) end paid from p
 )
 select coalesce(jsonb_agg(jsonb_build_object('paymentId',q.id,'carId',q.car_id,'status',q.status,'createdAt',q.created_at,'transferredAt',q.transferred_at,'replaced',q.replaced,
   'amountCents',q.amount,'paidCents',q.paid,'convertedCents',q.converted,'balanceCents',case when q.replaced then 0 else greatest(0,q.amount-q.paid-q.converted) end) order by q.created_at,q.id),'[]'::jsonb)
 into payouts from q;
 select coalesce(jsonb_agg(jsonb_build_object('carId',c.id,'make',c.make,'model',c.model,'year',c.year,'plate',c.car_plate,'photo',c.photo,'status',c.status,
   'dateAdded',c.date_added,'sellingPriceCents',coalesce(uc_commission_cents(to_jsonb(c)->'selling_price'),0),'moneyReceived',coalesce((to_jsonb(c)->>'money_received')::boolean,false),
   'terms',c.consignment-'dealer','deliveredAt',(select max(cu.delivered_at) from customers cu where cu.interested_car_id=c.id and cu.delivered_at is not null),
   'hasPayout',exists(select 1 from jsonb_array_elements(payouts) x where x->>'carId'=c.id),
   'variant',c.variant,'colour',c.colour,'mileage',c.mileage,'transmission',c.transmission,'notes',c.notes,'photos',coalesce(c.photos,'[]'::jsonb),
   'repairCents',(select coalesce(sum(round(coalesce(r.actual_cost,r.total_cost,0)*100)),0)::bigint from repairs r where r.car_id=c.id and coalesce(r.status,'')<>'cancelled'),
   'miscCents',(select coalesce(sum(round(coalesce((m->>'amount')::numeric,0)*100)),0)::bigint from jsonb_array_elements(case when jsonb_typeof(c.misc_costs)='array' then c.misc_costs else '[]'::jsonb end) m where coalesce(m->>'amount','')~'^-?[0-9]+(\.[0-9]+)?$'),
   'editable',coalesce(c.status,'') in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') and (c.final_deal is null or c.final_deal='null'::jsonb) and not exists(select 1 from uc_consignment_cases k where k.car_id=c.id)) order by c.status='delivered',c.date_added desc nulls last,c.id),'[]'::jsonb)
 into cars_json from cars c where lower(c.consignment->>'dealer')=lower(d.name);
 return jsonb_build_object('dealer',jsonb_build_object('id',d.id,'name',d.name,'bankName',d.bank_name,'accountHolder',d.bank_account_holder,
   'accountEnding',right(coalesce(d.bank_account_number,''),4)),
  'investor',case when l.pot_id is null then null else jsonb_build_object('potId',l.pot_id,'name',investor,'linkedAt',l.linked_at) end,
  'cars',cars_json,'payouts',payouts,
  'conversions',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'amountCents',v.amount_cents,'convertedOn',v.converted_on,'note',v.note,'createdAt',v.created_at,'actorName',s.name,
    'allocations',(select jsonb_agg(jsonb_build_object('paymentId',a.payment_id,'amountCents',a.amount_cents) order by a.payment_id) from uc_dealer_conversion_allocations a where a.conversion_id=v.id))
    order by v.created_at,v.id) from uc_dealer_conversions v join garage_building_staff s on s.id=v.actor_id where v.dealer_id=d.id),'[]'::jsonb),
  'totals',jsonb_build_object(
   'payoutCents',(select coalesce(sum((x->>'amountCents')::bigint),0) from jsonb_array_elements(payouts) x where not (x->>'replaced')::boolean),
   'paidCents',(select coalesce(sum((x->>'paidCents')::bigint),0) from jsonb_array_elements(payouts) x),
   'convertedCents',(select coalesce(sum(amount_cents),0) from uc_dealer_conversions where dealer_id=d.id),
   'owedCents',(select coalesce(sum((x->>'balanceCents')::bigint),0) from jsonb_array_elements(payouts) x),
   'carsInStock',(select count(*) from jsonb_array_elements(cars_json) x where x->>'status' not in ('delivered','sold')),
   'carsDelivered',(select count(*) from jsonb_array_elements(cars_json) x where x->>'status'='delivered'),
   'deliveredWithoutPayout',(select count(*) from jsonb_array_elements(cars_json) x where x->>'status'='delivered' and not (x->>'hasPayout')::boolean),
   'deliveredNotDisbursed',(select count(*) from jsonb_array_elements(cars_json) x where x->>'status'='delivered' and not (x->>'moneyReceived')::boolean)));
end $$;

create function public.uc_dealer_account(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a garage_building_staff;d dealers;l uc_dealer_investor_links;v uc_dealer_conversions;prior uc_dealer_conversions;
 amount bigint;day date;remaining bigint;take bigint;open_total bigint;rec record;lines jsonb:='[]'::jsonb;ap bigint:=0;review bigint:=0;req text;payload jsonb;result jsonb;begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 select * into a from garage_building_staff where id=p_actor;
 if a.id is null or not coalesce(a.enabled and a.registration_status='active' and a.business_access in('used_car','both') and a.role in('director','investor'),false) then raise exception 'NOT_ALLOWED';end if;
 -- Investor: only the dealer linked to their own investor account.
 if a.role='investor' then
  if p_action not in('mine','add_car','edit_car') then raise exception 'NOT_ALLOWED';end if;
  select k.* into l from uc_dealer_investor_links k join uc_investor_pots p on p.id=k.pot_id join uc_investor_profiles f on f.id=p.profile_id where f.linked_staff_id=a.id;
  if l.dealer_id is null then if p_action='mine' then return jsonb_build_object('dealer',null);end if;raise exception 'NOT_ALLOWED';end if;
  if p_action<>'mine' then perform uc_dealer_stock(a.id,l.dealer_id,p_action,p_data);end if;
  return uc_dealer_view(l.dealer_id);
 end if;
 if p_action='list' then
  return jsonb_build_object('dealers',coalesce((select jsonb_agg(jsonb_build_object('id',d2.id,'name',d2.name,'potId',k.pot_id,'investorName',f.name,
    'cars',(select count(*) from cars c where lower(c.consignment->>'dealer')=lower(d2.name))) order by lower(d2.name),d2.id)
   from dealers d2 left join uc_dealer_investor_links k on k.dealer_id=d2.id left join uc_investor_pots p on p.id=k.pot_id left join uc_investor_profiles f on f.id=p.profile_id),'[]'::jsonb),
   'investors',coalesce((select jsonb_agg(jsonb_build_object('potId',p.id,'name',f.name,'linkedDealerId',k.dealer_id) order by lower(f.name),p.id)
   from uc_investor_pots p join uc_investor_profiles f on f.id=p.profile_id left join uc_dealer_investor_links k on k.pot_id=p.id),'[]'::jsonb));
 end if;
 if p_action='view' then return uc_dealer_view(p_data->>'dealerId');end if;
 req:=p_data->>'requestId';
 if req is null or req!~'^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 select * into d from dealers where id=p_data->>'dealerId' for update;if d.id is null then raise exception 'DEALER_NOT_FOUND';end if;
 if p_action='link' then
  if jsonb_typeof(p_data->'potId') is distinct from 'string' or p_data->>'potId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID';end if;
  select * into l from uc_dealer_investor_links where dealer_id=d.id;
  if l.dealer_id is not null then if l.pot_id=(p_data->>'potId')::uuid then return uc_dealer_view(d.id);end if;raise exception 'ALREADY_LINKED';end if;
  if not exists(select 1 from uc_investor_pots where id=(p_data->>'potId')::uuid) then raise exception 'INVALID';end if;
  if exists(select 1 from uc_dealer_investor_links where pot_id=(p_data->>'potId')::uuid) then raise exception 'ALREADY_LINKED';end if;
  insert into uc_dealer_investor_links(dealer_id,pot_id,linked_by) values(d.id,(p_data->>'potId')::uuid,a.id);
  return uc_dealer_view(d.id);
 end if;
 if p_action<>'convert' then raise exception 'INVALID';end if;
 if jsonb_typeof(p_data->'amountCents') is distinct from 'number' or p_data->>'amountCents'!~'^[1-9][0-9]{0,12}$'
  or jsonb_typeof(p_data->'convertedOn') is distinct from 'string' or p_data->>'convertedOn'!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(p_data->'note') is distinct from 'string' or length(trim(p_data->>'note')) not between 5 and 1000 or p_data->>'note'~'[[:cntrl:]]' then raise exception 'INVALID';end if;
 amount:=(p_data->>'amountCents')::bigint;day:=(p_data->>'convertedOn')::date;
 if day>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'FUTURE_DATE';end if;
 payload:=p_data-'requestId';
 select * into prior from uc_dealer_conversions where actor_id=a.id and request_id=req;
 if prior.id is not null then if prior.payload=payload then return prior.result;end if;raise exception 'REQUEST_CHANGED';end if;
 select * into l from uc_dealer_investor_links where dealer_id=d.id;if l.dealer_id is null then raise exception 'INVESTOR_LINK_REQUIRED';end if;
 -- Oldest unpaid payouts first. Lock them so a bank payment cannot race this.
 perform 1 from payments p where p.type='consignment_payout' and (p.recipient_id=d.id or lower(p.recipient_name)=lower(d.name)) order by p.id for update;
 select coalesce(sum(greatest(0,coalesce(uc_commission_cents(to_jsonb(p)->'amount'),0)-uc_company_paid_cents(p.id))),0) into open_total from payments p
  where p.type='consignment_payout' and p.status='pending' and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false) and (p.recipient_id=d.id or lower(p.recipient_name)=lower(d.name));
 if amount>open_total then raise exception 'CONVERSION_EXCEEDS_OWED';end if;
 insert into uc_dealer_conversions(dealer_id,pot_id,amount_cents,converted_on,note,actor_id,request_id,payload) values(d.id,l.pot_id,amount,day,trim(p_data->>'note'),a.id,req,payload) returning * into v;
 remaining:=amount;
 for rec in select p.id,greatest(0,coalesce(uc_commission_cents(to_jsonb(p)->'amount'),0)-uc_company_paid_cents(p.id)) open,
   exists(select 1 from uc_consignment_cases k where k.dealer_payment_id=p.id) on_ledger
  from payments p where p.type='consignment_payout' and p.status='pending' and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false) and (p.recipient_id=d.id or lower(p.recipient_name)=lower(d.name))
  order by p.created_at nulls last,p.id loop
  exit when remaining=0;continue when rec.open<=0;
  take:=least(remaining,rec.open);remaining:=remaining-take;
  insert into uc_dealer_conversion_allocations(conversion_id,payment_id,amount_cents) values(v.id,rec.id,take);
  if rec.on_ledger then ap:=ap+take;else review:=review+take;end if;
 end loop;
 if remaining<>0 then raise exception 'CONVERSION_EXCEEDS_OWED';end if;
 -- Payouts from the reviewed consignment workflow are already in accounts payable.
 -- Older payouts were never posted; their cash sits in the bank opening difference.
 if ap>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-ap','debit',ap::numeric/100,'credit',0));end if;
 if review>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-opening-review','debit',review::numeric/100,'credit',0));end if;
 lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-investor-payable','debit',0,'credit',amount::numeric/100));
 perform uc_post_journal('dealer-conversion:'||v.id::text,day,'Dealer payouts converted to investor capital ('||d.name||')',null,a.id,lines);
 result:=uc_dealer_view(d.id)||jsonb_build_object('conversionId',v.id);
 -- Store the reply for an idempotent retry. Only the result column is written once.
 perform set_config('autodream.dealer_conversion_result',v.id::text,true);
 update uc_dealer_conversions set result=jsonb_build_object('conversionId',v.id,'dealerId',d.id,'amountCents',amount) where id=v.id;
 return result;
end $$;

-- The immutable guard allows exactly one write: storing the retry reply.
drop trigger uc_dealer_conversions_fixed on uc_dealer_conversions;
create function public.uc_dealer_conversion_fixed() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and current_setting('autodream.dealer_conversion_result',true)=old.id::text and old.result is null
  and (to_jsonb(new)-'result')=(to_jsonb(old)-'result') then return new;end if;
 raise exception 'IMMUTABLE_HISTORY';
end $$;
create trigger uc_dealer_conversions_fixed before update or delete on uc_dealer_conversions for each row execute function uc_dealer_conversion_fixed();

revoke all on function uc_dealer_view(text),uc_dealer_account(text,text,jsonb),uc_dealer_conversion_fixed(),uc_position_before_dealer_conversions(uuid),uc_investor_position(uuid),uc_capital_before_dealer_conversions(text,text,jsonb),uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
-- uc_company_paid_cents and uc_company_has_bank_history were replaced in place,
-- so they keep their existing privileges.
grant execute on function uc_dealer_account(text,text,jsonb),uc_investor_capital(text,text,jsonb) to service_role;
commit;
