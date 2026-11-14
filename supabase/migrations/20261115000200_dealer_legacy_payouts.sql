-- Pay older dealer payouts through the company bank payment screen.
-- Follows 20261115000100_dealer_stock.sql.
--
-- Consignment payouts made before the reviewed consignment workflow were never
-- recorded in the books, so the bank payment screen refused them
-- (PAYMENT_WORKFLOW_REQUIRED). The Director now "prepares" a dealer's older
-- unpaid payouts once on the Dealer accounts page. Each unpaid balance is
-- recorded as a bill (Dr opening balance review, Cr accounts payable), and the
-- bank payment screen then pays it like any reviewed bill: receipt and invoice
-- required, never more than the bill, and the payout is locked from edits.
-- One transaction: if anything fails, nothing changes.
begin;
do $$ begin
 if to_regprocedure('public.uc_dealer_stock(text,text,text,jsonb)') is null or to_regprocedure('public.uc_consignment_payment_allowed(text)') is null
  or to_regprocedure('public.uc_consignment_journal_source(text,text)') is null or to_regprocedure('public.uc_consignment_bill_limit(text)') is null then
  raise exception 'Apply 20261115000100_dealer_stock.sql and the company bank payment migrations first';
 end if;
end $$;

create table public.uc_dealer_legacy_payouts(
 payment_id text primary key references payments(id),dealer_id text not null references dealers(id),
 bill_cents bigint not null check(bill_cents>0),prepared_cents bigint not null check(prepared_cents>0 and prepared_cents<=bill_cents),
 journal_id text not null unique references journal_entries(id),prepared_by text not null references garage_building_staff(id),prepared_at timestamptz not null default now()
);
create trigger uc_dealer_legacy_payouts_fixed before update or delete on uc_dealer_legacy_payouts for each row execute function uc_investor_immutable();
create trigger uc_dealer_legacy_payouts_no_truncate before truncate on uc_dealer_legacy_payouts execute function uc_investor_immutable();
alter table uc_dealer_legacy_payouts enable row level security;revoke all on uc_dealer_legacy_payouts from public,anon,authenticated,service_role;

-- The bank payment screen reads these three helpers. Prepared payouts join the
-- reviewed consignment bills: allowed, their bill journal is the source, and
-- the bill amount is the most that can be settled (bank, receipts and locks).
alter function uc_consignment_payment_allowed(text) rename to uc_payment_allowed_before_legacy_dealer;
create function public.uc_consignment_payment_allowed(p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select uc_payment_allowed_before_legacy_dealer(p_payment) or exists(select 1 from uc_dealer_legacy_payouts where payment_id=p_payment) $$;
alter function uc_consignment_journal_source(text,text) rename to uc_journal_source_before_legacy_dealer;
create function public.uc_consignment_journal_source(p_journal text,p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select uc_journal_source_before_legacy_dealer(p_journal,p_payment) or exists(select 1 from uc_dealer_legacy_payouts where payment_id=p_payment and journal_id=p_journal) $$;
alter function uc_consignment_bill_limit(text) rename to uc_bill_limit_before_legacy_dealer;
create function public.uc_consignment_bill_limit(p_payment text) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(uc_bill_limit_before_legacy_dealer(p_payment),(select bill_cents from uc_dealer_legacy_payouts where payment_id=p_payment)) $$;

-- An older payout that can be prepared: pending, not replaced, not already
-- payable through a reviewed workflow, its car has no consignment case, and it
-- has no accounting history of its own.
create function public.uc_dealer_legacy_eligible(p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from payments p where p.id=p_payment and p.type='consignment_payout' and p.status='pending'
  and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false)
  and not exists(select 1 from uc_dealer_legacy_payouts g where g.payment_id=p.id)
  and not uc_consignment_payment_allowed(p.id)
  and (p.car_id is null or not exists(select 1 from uc_consignment_cases k where k.car_id=p.car_id))
  and not exists(select 1 from journal_entries j where j.source_id=p.id and not coalesce(j.voided,false))) $$;

-- A prepared payout is fixed like one with bank history: no deletes or amount edits.
create or replace function public.uc_company_has_bank_history(p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from uc_company_bank_allocations where payment_id=p_payment) or exists(select 1 from uc_company_bank_receipts where payment_id=p_payment) or exists(select 1 from uc_company_withheld_payments where payment_id=p_payment)
  or exists(select 1 from uc_dealer_conversion_allocations where payment_id=p_payment) or exists(select 1 from uc_dealer_legacy_payouts where payment_id=p_payment) $$;

create or replace function public.uc_dealer_view(p_dealer text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
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
   'amountCents',q.amount,'paidCents',q.paid,'convertedCents',q.converted,'bankReady',q.status='pending' and not q.replaced and uc_consignment_payment_allowed(q.id),'needsPreparing',uc_dealer_legacy_eligible(q.id),'balanceCents',case when q.replaced then 0 else greatest(0,q.amount-q.paid-q.converted) end) order by q.created_at,q.id),'[]'::jsonb)
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
   'needsPreparingCents',(select coalesce(sum((x->>'balanceCents')::bigint),0) from jsonb_array_elements(payouts) x where (x->>'needsPreparing')::boolean),
   'needsPreparingCount',(select count(*) from jsonb_array_elements(payouts) x where (x->>'needsPreparing')::boolean and (x->>'balanceCents')::bigint>0),
   'carsInStock',(select count(*) from jsonb_array_elements(cars_json) x where x->>'status' not in ('delivered','sold')),
   'carsDelivered',(select count(*) from jsonb_array_elements(cars_json) x where x->>'status'='delivered'),
   'deliveredWithoutPayout',(select count(*) from jsonb_array_elements(cars_json) x where x->>'status'='delivered' and not (x->>'hasPayout')::boolean),
   'deliveredNotDisbursed',(select count(*) from jsonb_array_elements(cars_json) x where x->>'status'='delivered' and not (x->>'moneyReceived')::boolean)));
end $$;

create or replace function public.uc_dealer_account(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a garage_building_staff;d dealers;l uc_dealer_investor_links;v uc_dealer_conversions;prior uc_dealer_conversions;
 amount bigint;day date;remaining bigint;take bigint;open_total bigint;rec record;lines jsonb:='[]'::jsonb;ap bigint:=0;review bigint:=0;req text;payload jsonb;result jsonb;jid text;today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;begin
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
 -- Older payouts (made before the reviewed consignment workflow) were never in
 -- the books. Record each unpaid balance as a bill so the bank payment screen
 -- can pay it: Dr opening balance review, Cr accounts payable. No money moves.
 if p_action='prepare_payouts' then
  perform 1 from payments p where p.type='consignment_payout' and (p.recipient_id=d.id or lower(p.recipient_name)=lower(d.name)) order by p.id for update;
  for rec in select p.id,p.car_id,uc_commission_cents(to_jsonb(p)->'amount') owed,uc_company_paid_cents(p.id) paid from payments p
   where p.type='consignment_payout' and (p.recipient_id=d.id or lower(p.recipient_name)=lower(d.name)) and uc_dealer_legacy_eligible(p.id) order by p.created_at nulls last,p.id loop
   continue when coalesce(rec.owed,0)-rec.paid<=0;
   jid:='dealer-legacy-payout:'||rec.id;
   perform uc_post_journal(jid,today,'Older dealer payout recorded as a bill ('||d.name||')',rec.car_id,a.id,jsonb_build_array(
    jsonb_build_object('accountId','acct-opening-review','debit',(rec.owed-rec.paid)::numeric/100,'credit',0),
    jsonb_build_object('accountId','acct-ap','debit',0,'credit',(rec.owed-rec.paid)::numeric/100)));
   insert into uc_dealer_legacy_payouts(payment_id,dealer_id,bill_cents,prepared_cents,journal_id,prepared_by) values(rec.id,d.id,rec.owed,rec.owed-rec.paid,'uc:'||jid,a.id);
  end loop;
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
   (exists(select 1 from uc_consignment_cases k where k.dealer_payment_id=p.id) or exists(select 1 from uc_dealer_legacy_payouts g where g.payment_id=p.id)) on_ledger
  from payments p where p.type='consignment_payout' and p.status='pending' and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false) and (p.recipient_id=d.id or lower(p.recipient_name)=lower(d.name))
  order by p.created_at nulls last,p.id loop
  exit when remaining=0;continue when rec.open<=0;
  take:=least(remaining,rec.open);remaining:=remaining-take;
  insert into uc_dealer_conversion_allocations(conversion_id,payment_id,amount_cents) values(v.id,rec.id,take);
  if rec.on_ledger then ap:=ap+take;else review:=review+take;end if;
 end loop;
 if remaining<>0 then raise exception 'CONVERSION_EXCEEDS_OWED';end if;
 -- Payouts from the reviewed consignment workflow, and older payouts prepared
 -- for the bank, are already in accounts payable.
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

revoke all on function uc_dealer_legacy_eligible(text),uc_payment_allowed_before_legacy_dealer(text),uc_consignment_payment_allowed(text),uc_journal_source_before_legacy_dealer(text,text),uc_consignment_journal_source(text,text),
 uc_bill_limit_before_legacy_dealer(text),uc_consignment_bill_limit(text),uc_dealer_view(text),uc_dealer_account(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_dealer_account(text,text,jsonb) to service_role;
commit;
