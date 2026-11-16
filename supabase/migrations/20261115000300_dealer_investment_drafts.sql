-- Dealer investment: confirm costs, plan as a draft, lock, undo.
-- Follows 20261115000200_dealer_legacy_payouts.sql.
--
-- A payout may only be kept as investment once its costs are final:
--   * Costs confirmed: the Director's tick on one dealer payout. It holds only
--     while the payout keeps the amount it had when ticked, and can be removed
--     until the payout is locked. Payouts approved through the reviewed
--     consignment workflow ("Approve dealer amount") count as confirmed.
--   * Draft: the Director's plan for the next lock: a target (e.g. RM500k) and
--     confirmed payouts in order. Nothing is posted; it can change freely.
--   * Lock: turns the draft into one investment. Payouts are used in the
--     draft's order; the last one may be split (the rest stays a normal payout
--     to transfer). The draft must reach the target exactly.
--   * Undo lock: removes a lock made on provisional numbers. The removed rows
--     are kept in uc_dealer_conversion_reversals and a reversing journal entry
--     is posted. Refused if the investor has already used the money.
-- The old 'convert' (oldest payouts first, any amount) is retired.
-- One transaction: if anything fails, nothing changes.
begin;
do $$ begin
 if to_regprocedure('public.uc_dealer_legacy_eligible(text)') is null or to_regprocedure('public.uc_dealer_view(text)') is null
  or to_regprocedure('public.uc_dealer_account(text,text,jsonb)') is null then
  raise exception 'Apply 20261115000200_dealer_legacy_payouts.sql first';
 end if;
end $$;

create table public.uc_dealer_cost_confirmations(
 payment_id text primary key references payments(id),dealer_id text not null references dealers(id),
 amount_cents bigint not null check(amount_cents>0),confirmed_by text not null references garage_building_staff(id),confirmed_at timestamptz not null default now()
);
create table public.uc_dealer_investment_drafts(
 dealer_id text primary key references dealers(id),target_cents bigint not null check(target_cents between 1 and 1000000000000),
 payment_ids text[] not null check(cardinality(payment_ids)<=200),
 updated_by text not null references garage_building_staff(id),updated_at timestamptz not null default now()
);
create table public.uc_dealer_conversion_reversals(
 conversion_id uuid primary key,dealer_id text not null references dealers(id),pot_id uuid not null,amount_cents bigint not null,
 conversion jsonb not null,allocations jsonb not null,reason text not null check(length(trim(reason)) between 5 and 1000),
 journal_id text not null unique references journal_entries(id),actor_id text not null references garage_building_staff(id),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),reversed_at timestamptz not null default now(),unique(actor_id,request_id)
);
create trigger uc_dealer_conversion_reversals_fixed before update or delete on uc_dealer_conversion_reversals for each row execute function uc_investor_immutable();
create trigger uc_dealer_conversion_reversals_no_truncate before truncate on uc_dealer_conversion_reversals execute function uc_investor_immutable();
do $$ declare t text;begin
 foreach t in array array['uc_dealer_cost_confirmations','uc_dealer_investment_drafts','uc_dealer_conversion_reversals'] loop
  execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

-- Locks stay permanent except for one path: undo_lock, inside its own
-- transaction, for the one lock it names.
create or replace function public.uc_dealer_conversion_fixed() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and current_setting('autodream.dealer_conversion_result',true)=old.id::text and old.result is null
  and (to_jsonb(new)-'result')=(to_jsonb(old)-'result') then return new;end if;
 if tg_op='DELETE' and current_setting('autodream.dealer_conversion_undo',true)=old.id::text then return old;end if;
 raise exception 'IMMUTABLE_HISTORY';
end $$;
create function public.uc_dealer_allocation_fixed() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' and current_setting('autodream.dealer_conversion_undo',true)=old.conversion_id::text then return old;end if;
 raise exception 'IMMUTABLE_HISTORY';
end $$;
drop trigger uc_dealer_conversion_allocations_fixed on uc_dealer_conversion_allocations;
create trigger uc_dealer_conversion_allocations_fixed before update or delete on uc_dealer_conversion_allocations for each row execute function uc_dealer_allocation_fixed();

-- Final payout amount: ticked by the Director at this amount, or approved
-- through the reviewed consignment workflow.
create function public.uc_dealer_payout_confirmed(p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from payments p where p.id=p_payment and (
  exists(select 1 from uc_dealer_cost_confirmations c where c.payment_id=p.id and c.amount_cents=coalesce(uc_commission_cents(to_jsonb(p)->'amount'),0))
  or exists(select 1 from uc_consignment_cases k where k.dealer_payment_id=p.id and k.approved_at is not null))) $$;

alter function uc_dealer_view(text) rename to uc_dealer_view_before_drafts;
create function public.uc_dealer_view(p_dealer text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;begin
 r:=uc_dealer_view_before_drafts(p_dealer);
 return r||jsonb_build_object(
  'payouts',coalesce((select jsonb_agg(x||jsonb_build_object('costsConfirmed',uc_dealer_payout_confirmed(x->>'paymentId'),
    'confirmedVia',case when exists(select 1 from uc_consignment_cases k where k.dealer_payment_id=x->>'paymentId' and k.approved_at is not null) then 'case'
     when uc_dealer_payout_confirmed(x->>'paymentId') then 'director' end,
    'confirmedAt',(select c.confirmed_at from uc_dealer_cost_confirmations c where c.payment_id=x->>'paymentId')) order by o)
   from jsonb_array_elements(r->'payouts') with ordinality t(x,o)),'[]'::jsonb),
  'draft',(select jsonb_build_object('targetCents',g.target_cents,'paymentIds',to_jsonb(g.payment_ids),'updatedAt',g.updated_at) from uc_dealer_investment_drafts g where g.dealer_id=p_dealer),
  'reversals',coalesce((select jsonb_agg(jsonb_build_object('conversionId',v.conversion_id,'amountCents',v.amount_cents,'reason',v.reason,'reversedAt',v.reversed_at,
    'convertedOn',v.conversion->>'converted_on','actorName',s.name) order by v.reversed_at,v.conversion_id)
   from uc_dealer_conversion_reversals v join garage_building_staff s on s.id=v.actor_id where v.dealer_id=p_dealer),'[]'::jsonb));
end $$;

alter function uc_dealer_account(text,text,jsonb) rename to uc_dealer_account_before_drafts;
create function public.uc_dealer_account(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a garage_building_staff;d dealers;l uc_dealer_investor_links;p payments;g uc_dealer_investment_drafts;v uc_dealer_conversions;prior uc_dealer_conversions;
 r jsonb;req text;payload jsonb;ids text[];pid text;day date;remaining bigint;take bigint;open_cents bigint;ap bigint:=0;review bigint:=0;lines jsonb:='[]'::jsonb;
 today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;begin
 if p_action='convert' then raise exception 'USE_DRAFT';end if;
 if p_action not in('confirm_costs','unconfirm_costs','save_draft','lock_draft','undo_lock') then
  r:=uc_dealer_account_before_drafts(p_actor,p_action,p_data);
  -- The investor sees their dealer account, never the Director's draft.
  if p_action in('mine','add_car','edit_car') then return r-'draft';end if;
  return r;
 end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 select * into a from garage_building_staff where id=p_actor;
 if a.id is null or not coalesce(a.enabled and a.registration_status='active' and a.business_access in('used_car','both') and a.role='director',false) then raise exception 'NOT_ALLOWED';end if;
 req:=p_data->>'requestId';
 if req is null or req!~'^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 select * into d from dealers where id=p_data->>'dealerId' for update;if d.id is null then raise exception 'DEALER_NOT_FOUND';end if;

 if p_action in('confirm_costs','unconfirm_costs') then
  select * into p from payments where id=p_data->>'paymentId' for update;
  if p.id is null or p.type<>'consignment_payout' or not(p.recipient_id=d.id or lower(p.recipient_name)=lower(d.name)) then raise exception 'NOT_ALLOWED';end if;
  if exists(select 1 from uc_dealer_conversion_allocations where payment_id=p.id) then raise exception 'PAYOUT_LOCKED';end if;
  if p_action='confirm_costs' then
   if p.status<>'pending' or coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false) or coalesce(uc_commission_cents(to_jsonb(p)->'amount'),0)<=0 then raise exception 'PAYOUT_NOT_OPEN';end if;
   insert into uc_dealer_cost_confirmations(payment_id,dealer_id,amount_cents,confirmed_by) values(p.id,d.id,uc_commission_cents(to_jsonb(p)->'amount'),a.id)
    on conflict(payment_id) do update set amount_cents=excluded.amount_cents,confirmed_by=excluded.confirmed_by,confirmed_at=now();
  else
   delete from uc_dealer_cost_confirmations where payment_id=p.id;
   update uc_dealer_investment_drafts set payment_ids=array_remove(payment_ids,p.id),updated_by=a.id,updated_at=now() where dealer_id=d.id;
  end if;
  return uc_dealer_view(d.id);
 end if;

 if p_action='save_draft' then
  if jsonb_typeof(p_data->'targetCents') is distinct from 'number' or p_data->>'targetCents'!~'^[1-9][0-9]{0,12}$'
   or jsonb_typeof(p_data->'paymentIds') is distinct from 'array' or jsonb_array_length(p_data->'paymentIds')>200
   or exists(select 1 from jsonb_array_elements(p_data->'paymentIds') x where jsonb_typeof(x)<>'string') then raise exception 'INVALID';end if;
  select coalesce(array_agg(x order by o),'{}') into ids from jsonb_array_elements_text(p_data->'paymentIds') with ordinality t(x,o);
  if (select count(distinct x) from unnest(ids) x)<>cardinality(ids) then raise exception 'INVALID';end if;
  if exists(select 1 from unnest(ids) x where not exists(select 1 from payments q where q.id=x and q.type='consignment_payout' and (q.recipient_id=d.id or lower(q.recipient_name)=lower(d.name))))
   then raise exception 'NOT_ALLOWED';end if;
  if exists(select 1 from unnest(ids) x where not uc_dealer_payout_confirmed(x)) then raise exception 'COSTS_NOT_CONFIRMED';end if;
  insert into uc_dealer_investment_drafts(dealer_id,target_cents,payment_ids,updated_by) values(d.id,(p_data->>'targetCents')::bigint,ids,a.id)
   on conflict(dealer_id) do update set target_cents=excluded.target_cents,payment_ids=excluded.payment_ids,updated_by=excluded.updated_by,updated_at=now();
  return uc_dealer_view(d.id);
 end if;

 if p_action='lock_draft' then
  if jsonb_typeof(p_data->'convertedOn') is distinct from 'string' or p_data->>'convertedOn'!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
   or jsonb_typeof(p_data->'note') is distinct from 'string' or length(trim(p_data->>'note')) not between 5 and 1000 or p_data->>'note'~'[[:cntrl:]]' then raise exception 'INVALID';end if;
  day:=(p_data->>'convertedOn')::date;if day>today then raise exception 'FUTURE_DATE';end if;
  payload:=p_data-'requestId';
  -- Idempotent retry: same request, same reply; changed request refused.
  select * into prior from uc_dealer_conversions where actor_id=a.id and request_id=req;
  if prior.id is not null then
   if (prior.payload-'targetCents'-'paymentIds')=payload then return uc_dealer_view(d.id)||jsonb_build_object('conversionId',prior.id);end if;
   raise exception 'REQUEST_CHANGED';
  end if;
  if exists(select 1 from uc_dealer_conversion_reversals x where x.conversion->>'actor_id'=a.id and x.conversion->>'request_id'=req) then raise exception 'REQUEST_CHANGED';end if;
  select * into l from uc_dealer_investor_links where dealer_id=d.id;if l.dealer_id is null then raise exception 'INVESTOR_LINK_REQUIRED';end if;
  select * into g from uc_dealer_investment_drafts where dealer_id=d.id for update;
  if g.dealer_id is null or cardinality(g.payment_ids)=0 then raise exception 'DRAFT_EMPTY';end if;
  perform 1 from payments q where q.id=any(g.payment_ids) order by q.id for update;
  insert into uc_dealer_conversions(dealer_id,pot_id,amount_cents,converted_on,note,actor_id,request_id,payload)
   values(d.id,l.pot_id,g.target_cents,day,trim(p_data->>'note'),a.id,req,payload||jsonb_build_object('targetCents',g.target_cents,'paymentIds',to_jsonb(g.payment_ids))) returning * into v;
  remaining:=g.target_cents;
  foreach pid in array g.payment_ids loop
   exit when remaining=0;
   select * into p from payments where id=pid;
   if p.status<>'pending' or coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false) or not uc_dealer_payout_confirmed(pid) then raise exception 'COSTS_NOT_CONFIRMED';end if;
   open_cents:=greatest(0,coalesce(uc_commission_cents(to_jsonb(p)->'amount'),0)-uc_company_paid_cents(pid));
   continue when open_cents<=0;
   take:=least(remaining,open_cents);remaining:=remaining-take;
   insert into uc_dealer_conversion_allocations(conversion_id,payment_id,amount_cents) values(v.id,pid,take);
   -- Reviewed and prepared payouts are already in accounts payable; older
   -- ones were never posted and sit in the bank opening difference.
   if exists(select 1 from uc_consignment_cases k where k.dealer_payment_id=pid) or exists(select 1 from uc_dealer_legacy_payouts x where x.payment_id=pid) then ap:=ap+take;else review:=review+take;end if;
  end loop;
  if remaining<>0 then raise exception 'DRAFT_SHORT';end if;
  if ap>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-ap','debit',ap::numeric/100,'credit',0));end if;
  if review>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-opening-review','debit',review::numeric/100,'credit',0));end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-investor-payable','debit',0,'credit',g.target_cents::numeric/100));
  perform uc_post_journal('dealer-conversion:'||v.id::text,day,'Dealer payouts converted to investor capital ('||d.name||')',null,a.id,lines);
  perform set_config('autodream.dealer_conversion_result',v.id::text,true);
  update uc_dealer_conversions set result=jsonb_build_object('conversionId',v.id,'dealerId',d.id,'amountCents',g.target_cents) where id=v.id;
  delete from uc_dealer_investment_drafts where dealer_id=d.id;
  return uc_dealer_view(d.id)||jsonb_build_object('conversionId',v.id);
 end if;

 -- undo_lock
 if jsonb_typeof(p_data->'conversionId') is distinct from 'string' or p_data->>'conversionId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_data->'reason') is distinct from 'string' or length(trim(p_data->>'reason')) not between 5 and 1000 or p_data->>'reason'~'[[:cntrl:]]' then raise exception 'INVALID';end if;
 if exists(select 1 from uc_dealer_conversion_reversals where actor_id=a.id and request_id=req) then
  if exists(select 1 from uc_dealer_conversion_reversals where actor_id=a.id and request_id=req and conversion_id=(p_data->>'conversionId')::uuid) then return uc_dealer_view(d.id);end if;
  raise exception 'REQUEST_CHANGED';
 end if;
 select * into v from uc_dealer_conversions where id=(p_data->>'conversionId')::uuid and dealer_id=d.id for update;
 if v.id is null then raise exception 'LOCK_NOT_FOUND';end if;
 perform 1 from payments q where q.id in(select payment_id from uc_dealer_conversion_allocations where conversion_id=v.id) order by q.id for update;
 -- The investor must still hold this money (not already in cars or withdrawn).
 if (uc_investor_position(v.pot_id)->>'availableCents')::bigint<v.amount_cents then raise exception 'INVESTMENT_IN_USE';end if;
 select coalesce(jsonb_agg(jsonb_build_object('accountId',x->>'accountId','debit',coalesce((x->>'credit')::numeric,0),'credit',coalesce((x->>'debit')::numeric,0))),'[]'::jsonb) into lines
  from journal_entries j,jsonb_array_elements(j.lines) x where j.id='uc:dealer-conversion:'||v.id::text;
 if jsonb_array_length(lines)=0 then raise exception 'INVALID';end if;
 perform uc_post_journal('dealer-conversion-undo:'||v.id::text,today,'Investment lock undone ('||d.name||')',null,a.id,lines);
 insert into uc_dealer_conversion_reversals(conversion_id,dealer_id,pot_id,amount_cents,conversion,allocations,reason,journal_id,actor_id,request_id)
  values(v.id,d.id,v.pot_id,v.amount_cents,to_jsonb(v),coalesce((select jsonb_agg(to_jsonb(x)) from uc_dealer_conversion_allocations x where x.conversion_id=v.id),'[]'::jsonb),
   trim(p_data->>'reason'),'uc:dealer-conversion-undo:'||v.id::text,a.id,req);
 perform set_config('autodream.dealer_conversion_undo',v.id::text,true);
 delete from uc_dealer_conversion_allocations where conversion_id=v.id;
 delete from uc_dealer_conversions where id=v.id;
 perform set_config('autodream.dealer_conversion_undo','',true);
 return uc_dealer_view(d.id);
end $$;

revoke all on function uc_dealer_allocation_fixed(),uc_dealer_conversion_fixed(),uc_dealer_payout_confirmed(text),uc_dealer_view_before_drafts(text),uc_dealer_view(text),
 uc_dealer_account_before_drafts(text,text,jsonb),uc_dealer_account(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_dealer_account(text,text,jsonb) to service_role;
commit;
