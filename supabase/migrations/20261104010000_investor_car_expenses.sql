-- PREPARED ONLY. Local rehearsal phase; not a production installation bundle.
-- Depends on 20261104000000. Legacy car/payment/journal rows are not rewritten.
-- The car foreign key intentionally prevents deleting funded cars; the existing
-- app's linked-record deletion message covers this. Live types must be checked
-- before preparing an installation bundle.
alter table public.uc_investor_audit add column sequence bigint generated always as identity unique;
revoke all on sequence public.uc_investor_audit_sequence_seq from public,anon,authenticated,service_role;
create table public.uc_investor_cars (
 car_id text primary key references public.cars(id), pot_id uuid not null references public.uc_investor_pots(id),
 purchase_cents bigint not null check(purchase_cents between 1 and 1000000000000),
 investor_basis_points integer not null check(investor_basis_points between 0 and 10000),
 approved_by text not null references public.garage_building_staff(id), approved_at timestamptz not null default now(),
 sale_cents bigint check(sale_cents between 1 and 1000000000000), sale_approved_by text references public.garage_building_staff(id),
 sale_approved_at timestamptz,
 settled_at timestamptz, settled_by text references public.garage_building_staff(id),
 check((sale_cents is null)=(sale_approved_by is null)),check((sale_cents is null)=(sale_approved_at is null)), check((settled_at is null)=(settled_by is null))
);
create table public.uc_investor_car_bills (
 id uuid primary key default gen_random_uuid(), car_id text not null references public.uc_investor_cars(car_id),
 category text not null check(category in ('repair','petrol','transport','invoicing','commission','misc')),
 purpose text not null check(length(trim(purpose)) between 1 and 300), payee text not null check(length(trim(payee)) between 1 and 150),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),
 state text not null default 'pending' check(state in ('pending','approved','voided')),
 created_by text not null references public.garage_building_staff(id), created_at timestamptz not null default now(),
 reviewed_by text references public.garage_building_staff(id), reviewed_at timestamptz, review_note text,
 check((state='pending' and reviewed_by is null and reviewed_at is null) or (state<>'pending' and reviewed_by is not null and reviewed_at is not null))
);
create table public.uc_investor_car_settlements (
 car_id text primary key references public.uc_investor_cars(car_id), purchase_cents bigint not null,
 sale_cents bigint not null, cost_cents bigint not null, profit_cents bigint not null,
 investor_result_cents bigint not null, company_profit_cents bigint not null check(company_profit_cents>=0),
 investor_basis_points integer not null, approved_by text not null references public.garage_building_staff(id),
 approved_at timestamptz not null default now(), check(profit_cents=investor_result_cents+company_profit_cents)
);
-- Internal main-account allocation only. No bank movement is generated here.
create table public.uc_company_investor_profit (
 car_id text primary key references public.uc_investor_car_settlements(car_id), amount_cents bigint not null check(amount_cents>=0),
 created_at timestamptz not null default now()
);

alter table public.uc_investor_cash_entries add column car_id text references public.uc_investor_cars(car_id);
alter table public.uc_investor_cash_entries add column bill_id uuid references public.uc_investor_car_bills(id);
-- Replace generated check names deliberately by discovering their definitions.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.uc_investor_cash_entries'::regclass and contype='c' loop
  execute format('alter table public.uc_investor_cash_entries drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.uc_investor_cash_entries alter column bank_account drop not null;
alter table public.uc_investor_cash_entries alter column bank_reference drop not null;
alter table public.uc_investor_cash_entries alter column paid_on drop not null;
alter table public.uc_investor_cash_entries add constraint uc_cash_amount check(abs(amount_cents::numeric) between 1 and 1000000000000);
alter table public.uc_investor_cash_entries add constraint uc_cash_kind check(
 (kind='capital_in' and amount_cents>0 and withdrawal_id is null and car_id is null and bill_id is null) or
 (kind='withdrawal_out' and amount_cents<0 and withdrawal_id is not null and car_id is null and bill_id is null) or
 (kind='car_purchase' and amount_cents<0 and car_id is not null and withdrawal_id is null and bill_id is null) or
 (kind='car_expense' and amount_cents<0 and car_id is not null and bill_id is not null and withdrawal_id is null) or
 (kind='car_sale' and amount_cents>0 and car_id is not null and withdrawal_id is null and bill_id is null) or
 (kind='company_profit' and amount_cents<0 and car_id is not null and withdrawal_id is null and bill_id is null));
alter table public.uc_investor_cash_entries add constraint uc_cash_bank_evidence check(
 (kind='company_profit' and bank_account is null and bank_reference is null and paid_on is null) or
 (kind<>'company_profit' and bank_account is not null and length(trim(bank_account)) between 1 and 150 and bank_reference is not null and length(trim(bank_reference)) between 1 and 200 and paid_on is not null));
create unique index uc_one_car_purchase on public.uc_investor_cash_entries(car_id) where kind='car_purchase';
create unique index uc_one_company_profit on public.uc_investor_cash_entries(car_id) where kind='company_profit';
create index uc_car_bills_by_car on public.uc_investor_car_bills(car_id,state);
create index uc_cash_by_car on public.uc_investor_cash_entries(car_id,kind);
create index uc_cash_by_bill on public.uc_investor_cash_entries(bill_id) where bill_id is not null;
create trigger uc_car_settlement_fixed before update or delete on public.uc_investor_car_settlements for each row execute function public.uc_investor_immutable();
create trigger uc_company_profit_fixed before update or delete on public.uc_company_investor_profit for each row execute function public.uc_investor_immutable();
create trigger uc_car_settlement_no_truncate before truncate on public.uc_investor_car_settlements execute function public.uc_investor_immutable();
create trigger uc_company_profit_no_truncate before truncate on public.uc_company_investor_profit execute function public.uc_investor_immutable();

create function public.uc_investor_car_summary(p_car text) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('carId',a.car_id,'potId',a.pot_id,'make',c.make,'model',c.model,'year',c.year,'plate',c.car_plate,'photo',c.photo,
 'purchaseCents',a.purchase_cents,'purchasePaidCents',p.paid,'investorBasisPoints',a.investor_basis_points,
 'saleCents',a.sale_cents,'receivedCents',r.received,'costCents',b.cost,'unpaidBillCents',b.unpaid,'pendingBills',b.pending,
 'profitCents',case when a.sale_cents is not null then a.sale_cents-a.purchase_cents-b.cost end,
 'settledAt',a.settled_at,'settlement',to_jsonb(s),
 'state',case when a.settled_at is not null then 'settled' when a.sale_cents is not null then 'sold' when p.paid=a.purchase_cents then 'in_stock' else 'reserved' end)
 from uc_investor_cars a join cars c on c.id=a.car_id left join uc_investor_car_settlements s on s.car_id=a.car_id
 cross join lateral (select coalesce(-sum(amount_cents),0) paid from uc_investor_cash_entries where car_id=a.car_id and kind='car_purchase') p
 cross join lateral (select coalesce(sum(amount_cents),0) received from uc_investor_cash_entries where car_id=a.car_id and kind='car_sale') r
 cross join lateral (select coalesce(sum(x.amount_cents) filter(where x.state='approved'),0) cost,
 coalesce(sum(x.amount_cents-coalesce(v.paid,0)) filter(where x.state='approved'),0) unpaid,count(*) filter(where x.state='pending') pending
 from uc_investor_car_bills x left join lateral (select -sum(e.amount_cents) paid from uc_investor_cash_entries e where e.bill_id=x.id and e.kind='car_expense') v on true where x.car_id=a.car_id) b
 where a.car_id=p_car;
$$;

create or replace function public.uc_investor_position(p_pot uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with amounts as (
 select coalesce((select sum(amount_cents) from uc_investor_cash_entries where pot_id=p_pot),0) cash,
 coalesce((select sum(amount_cents) from uc_investor_withdrawals where pot_id=p_pot and state='approved'),0) withdrawals,
 coalesce((select sum(a.purchase_cents) from uc_investor_cars a where a.pot_id=p_pot and not exists(select 1 from uc_investor_cash_entries e where e.car_id=a.car_id and e.kind='car_purchase')),0) purchases,
 coalesce((select sum(b.amount_cents-coalesce(p.paid,0)) from uc_investor_car_bills b join uc_investor_cars a on a.car_id=b.car_id
 left join lateral (select -sum(e.amount_cents) paid from uc_investor_cash_entries e where e.bill_id=b.id and e.kind='car_expense') p on true
 where a.pot_id=p_pot and b.state='approved'),0) bills,
 -- Hold every still-unconfirmed positive profit, including the investor share.
 -- Conservatively hold receipts up to the estimated profit first; the rest of
 -- cost recovery can be available. Profit is released only after final review.
 coalesce((select sum(least((j->>'receivedCents')::numeric,greatest(0,(j->>'profitCents')::numeric)))
 from uc_investor_cars a cross join lateral (select uc_investor_car_summary(a.car_id) j) x where a.pot_id=p_pot and a.sale_cents is not null and a.settled_at is null),0) profit,
 coalesce((select sum((j->>'purchasePaidCents')::numeric+(j->>'costCents')::numeric-(j->>'unpaidBillCents')::numeric)
 from uc_investor_cars a cross join lateral (select uc_investor_car_summary(a.car_id) j) x where a.pot_id=p_pot and a.sale_cents is null),0) invested)
 select jsonb_build_object('potId',p_pot,'cashCents',cash,'reservedCents',withdrawals+purchases+bills+profit,
 'availableCents',cash-withdrawals-purchases-bills-profit,'purchaseReservedCents',purchases,'billReservedCents',bills,'profitHeldCents',profit,'investedCents',invested) from amounts;
$$;

alter function public.uc_investor_capital(text,text,jsonb) rename to uc_investor_capital_base;
revoke all on function public.uc_investor_capital_base(text,text,jsonb) from public,anon,authenticated,service_role;

create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; car uc_investor_cars; bill uc_investor_car_bills; pot uc_investor_pots;
 prior uc_investor_commands; source cars; allowed text[]; req text:=p_data->>'requestId';
 payload jsonb:=jsonb_build_object('action',p_action,'data',p_data); result jsonb; summary jsonb; position jsonb;
 amount bigint; paid bigint; cost bigint; profit bigint; investor_result bigint; company_share bigint; day date; entry_id uuid;
begin
 if p_action in ('create_profile','link_account','snapshot','capital_received','request_withdrawal','approve_withdrawal','reject_withdrawal','cancel_withdrawal','withdrawal_paid') then
  if p_action in ('approve_withdrawal','withdrawal_paid') then
   select * into actor from garage_building_staff where id=p_actor for share;
   if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
   if req is null or req !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
   perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
   select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
   if found then if prior.payload is distinct from payload then raise exception 'REQUEST_CHANGED';end if;return prior.result;end if;
   perform 1 from uc_investor_pots where id=(p_data->>'potId')::uuid for update;
   if exists(select 1 from uc_investor_car_bills b join uc_investor_cars a on a.car_id=b.car_id where a.pot_id=(p_data->>'potId')::uuid and b.state='pending') then raise exception 'CAR_BILLS_REVIEW_REQUIRED';end if;
  end if;
  result:=uc_investor_capital_base(p_actor,p_action,p_data);
  if p_action='snapshot' then
   return result||jsonb_build_object('cars',coalesce((select jsonb_agg(uc_investor_car_summary(a.car_id) order by a.approved_at desc,a.car_id) from uc_investor_cars a where a.pot_id=(result->'position'->>'potId')::uuid),'[]'::jsonb));
  end if;
  return result;
 end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and actor.role in ('director','admin','investor'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 allowed:=case p_action when 'fund_car' then array['carId','potId','purchaseCents','investorBasisPoints','requestId']
 when 'car_snapshot' then array['carId'] when 'purchase_paid' then array['carId','bankAccount','bankReference','paidOn','requestId']
 when 'add_car_bill' then array['carId','category','purpose','payee','amountCents','requestId']
 when 'approve_car_bill' then array['carId','billId','requestId'] when 'void_car_bill' then array['carId','billId','note','requestId']
 when 'pay_car_bill' then array['carId','billId','amountCents','bankAccount','bankReference','paidOn','requestId']
 when 'agree_sale' then array['carId','amountCents','requestId']
 when 'sale_received' then array['carId','amountCents','bankAccount','bankReference','paidOn','requestId']
 when 'settle_car' then array['carId','confirmCosts','requestId'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'INVALID';end if;
 if actor.role='investor' and p_action<>'car_snapshot' or actor.role='admin' and p_action not in ('add_car_bill','car_snapshot') then raise exception 'NOT_ALLOWED';end if;
 if p_action<>'car_snapshot' then
  if req is null or req !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
  select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
  if found then if prior.payload is distinct from payload then raise exception 'REQUEST_CHANGED';end if;return prior.result;end if;
 end if;
 if p_action='fund_car' then
  select * into pot from uc_investor_pots where id=(p_data->>'potId')::uuid for update;
  if pot.id is null then raise exception 'NOT_ALLOWED';end if;
  select * into source from cars where id=p_data->>'carId' for update;
  if source.id is null or coalesce(source.status,'') not in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') or source.investor_id is not null or source.investor_split is not null or source.trade_in_source_car_id is not null or
   coalesce(to_jsonb(source)->>'investor_tagged','false')='true' or
   (source.consignment is not null and source.consignment<>'null'::jsonb) or
   (source.outgoing_consignment is not null and source.outgoing_consignment<>'null'::jsonb) then raise exception 'CAR_NOT_ELIGIBLE';end if;
  if exists(select 1 from uc_investor_cars where car_id=source.id) then raise exception 'CAR_ALREADY_FUNDED';end if;
  if jsonb_typeof(p_data->'purchaseCents') is distinct from 'number' or coalesce(p_data->>'purchaseCents','') !~ '^[1-9][0-9]{0,12}$'
   or (p_data ? 'investorBasisPoints' and jsonb_typeof(p_data->'investorBasisPoints') is distinct from 'number')
   or coalesce(p_data->>'investorBasisPoints','4000') !~ '^[0-9]{1,5}$' then raise exception 'INVALID';end if;
  amount:=(p_data->>'purchaseCents')::bigint;
  if amount>1000000000000 or coalesce((p_data->>'investorBasisPoints')::integer,4000)>10000 then raise exception 'INVALID';end if;
  if source.purchase_price is null or source.purchase_price*100<>amount then raise exception 'PURCHASE_PRICE_CHANGED';end if;
  insert into uc_investor_cars(car_id,pot_id,purchase_cents,investor_basis_points,approved_by)
  values(source.id,pot.id,amount,coalesce((p_data->>'investorBasisPoints')::integer,4000),p_actor) returning * into car;
 else
  -- Every write locks the account first, then its car/bill. Capital withdrawals
  -- use the same account lock and therefore include car commitments.
  select p.* into pot from uc_investor_pots p join uc_investor_cars a on a.pot_id=p.id where a.car_id=p_data->>'carId';
  if pot.id is null then raise exception 'NOT_ALLOWED';end if;
  if p_action<>'car_snapshot' then perform 1 from uc_investor_pots where id=pot.id for update;end if;
  if actor.role='investor' and not exists(select 1 from uc_investor_profiles f where f.id=pot.profile_id and f.linked_staff_id=p_actor) then raise exception 'NOT_ALLOWED';end if;
  select * into car from uc_investor_cars where car_id=p_data->>'carId';
  if p_action='car_snapshot' then
   summary:=uc_investor_car_summary(car.car_id);
   if actor.role='admin' then summary:=jsonb_build_object('carId',car.car_id,'make',summary->'make','model',summary->'model','year',summary->'year','plate',summary->'plate','photo',summary->'photo');end if;
   return summary||jsonb_build_object('bills',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'category',b.category,'purpose',b.purpose,'payee',b.payee,'amountCents',b.amount_cents,'state',b.state,
    'paidCents',coalesce((select -sum(e.amount_cents) from uc_investor_cash_entries e where e.bill_id=b.id and e.kind='car_expense'),0),'createdAt',b.created_at,'reviewedAt',b.reviewed_at) order by b.created_at,b.id) from uc_investor_car_bills b where b.car_id=car.car_id),'[]'::jsonb));
  end if;
  if p_action in ('purchase_paid','agree_sale','settle_car') then
   select * into source from cars where id=car.car_id for update;
   if source.purchase_price*100 is distinct from car.purchase_cents::numeric then raise exception 'PURCHASE_PRICE_CHANGED';end if;
   if source.investor_id is not null or source.investor_split is not null or source.trade_in_source_car_id is not null or
    (source.consignment is not null and source.consignment<>'null'::jsonb) or (source.outgoing_consignment is not null and source.outgoing_consignment<>'null'::jsonb) or
    coalesce(to_jsonb(source)->>'investor_tagged','false')='true' then raise exception 'CAR_NOT_ELIGIBLE';end if;
   if p_action='purchase_paid' and coalesce(source.status,'') not in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') then raise exception 'CAR_NOT_ELIGIBLE';end if;
  end if;
  if car.settled_at is not null and p_action<>'pay_car_bill' then raise exception 'CAR_SETTLED_ADJUSTMENT_REQUIRED';end if;
  summary:=uc_investor_car_summary(car.car_id);
  if p_action in ('pay_car_bill','sale_received','agree_sale','add_car_bill') then
   if jsonb_typeof(p_data->'amountCents') is distinct from 'number' or coalesce(p_data->>'amountCents','') !~ '^[1-9][0-9]{0,12}$' then raise exception 'INVALID';end if;
   amount:=(p_data->>'amountCents')::bigint;if amount>1000000000000 then raise exception 'INVALID';end if;
  end if;
  if p_action='purchase_paid' then
   if (summary->>'purchasePaidCents')::numeric<>0 then raise exception 'PURCHASE_ALREADY_PAID';end if;
   amount:=-car.purchase_cents;
  elsif p_action='add_car_bill' then
   if coalesce(p_data->>'category','') not in ('repair','petrol','transport','invoicing','commission','misc') or
    jsonb_typeof(p_data->'purpose') is distinct from 'string' or length(trim(p_data->>'purpose')) not between 1 and 300 or
    jsonb_typeof(p_data->'payee') is distinct from 'string' or length(trim(p_data->>'payee')) not between 1 and 150 then raise exception 'INVALID';end if;
   insert into uc_investor_car_bills(car_id,category,purpose,payee,amount_cents,created_by) values(car.car_id,p_data->>'category',trim(p_data->>'purpose'),trim(p_data->>'payee'),amount,p_actor) returning * into bill;
  elsif p_action in ('approve_car_bill','void_car_bill','pay_car_bill') then
   select * into bill from uc_investor_car_bills where id=(p_data->>'billId')::uuid and car_id=car.car_id for update;
   if bill.id is null then raise exception 'NOT_ALLOWED';end if;
   select coalesce(-sum(amount_cents),0) into paid from uc_investor_cash_entries where bill_id=bill.id and kind='car_expense';
   if p_action='approve_car_bill' then
    if bill.state<>'pending' then raise exception 'ALREADY_REVIEWED';end if;
    update uc_investor_car_bills set state='approved',reviewed_by=p_actor,reviewed_at=now() where id=bill.id;
   elsif p_action='void_car_bill' then
    if bill.state='voided' or paid<>0 then raise exception 'PAID_BILL_ADJUSTMENT_REQUIRED';end if;
    if jsonb_typeof(p_data->'note') is distinct from 'string' or length(trim(p_data->>'note')) not between 1 and 500 then raise exception 'REASON_REQUIRED';end if;
    update uc_investor_car_bills set state='voided',reviewed_by=p_actor,reviewed_at=now(),review_note=trim(p_data->>'note') where id=bill.id;
   else
    if bill.state<>'approved' then raise exception 'APPROVAL_REQUIRED';end if;
    if amount>bill.amount_cents-paid then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
    amount:=-amount;
   end if;
  elsif p_action='agree_sale' then
   if car.sale_cents is not null or (summary->>'purchasePaidCents')::numeric<>car.purchase_cents then raise exception 'SALE_AGREEMENT_LOCKED';end if;
   update uc_investor_cars set sale_cents=amount,sale_approved_by=p_actor,sale_approved_at=now() where car_id=car.car_id;
  elsif p_action='sale_received' then
   if car.sale_cents is null then raise exception 'SALE_PRICE_REQUIRED';end if;
   if amount>car.sale_cents-(summary->>'receivedCents')::numeric then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
  elsif p_action='settle_car' then
   if p_data->'confirmCosts' is distinct from 'true'::jsonb or car.sale_cents is null or (summary->>'purchasePaidCents')::numeric<>car.purchase_cents or
    (summary->>'receivedCents')::numeric<>car.sale_cents or (summary->>'pendingBills')::numeric<>0 then raise exception 'SETTLEMENT_NOT_READY';end if;
   cost:=(summary->>'costCents')::bigint;profit:=car.sale_cents-car.purchase_cents-cost;
   investor_result:=case when profit>0 then round(profit::numeric*car.investor_basis_points/10000)::bigint else profit end;
   company_share:=case when profit>0 then profit-investor_result else 0 end;
   insert into uc_investor_car_settlements(car_id,purchase_cents,sale_cents,cost_cents,profit_cents,investor_result_cents,company_profit_cents,investor_basis_points,approved_by)
   values(car.car_id,car.purchase_cents,car.sale_cents,cost,profit,investor_result,company_share,car.investor_basis_points,p_actor);
   insert into uc_company_investor_profit(car_id,amount_cents) values(car.car_id,company_share);
   if company_share>0 then insert into uc_investor_cash_entries(pot_id,kind,amount_cents,car_id,recorded_by) values(pot.id,'company_profit',-company_share,car.car_id,p_actor);end if;
   update uc_investor_cars set settled_at=now(),settled_by=p_actor where car_id=car.car_id;
  end if;
  if p_action in ('purchase_paid','pay_car_bill','sale_received') then
   if jsonb_typeof(p_data->'bankAccount') is distinct from 'string' or length(trim(p_data->>'bankAccount')) not between 1 and 150 or
    jsonb_typeof(p_data->'bankReference') is distinct from 'string' or length(trim(p_data->>'bankReference')) not between 1 and 200 or
    coalesce(p_data->>'paidOn','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID';end if;
   day:=(p_data->>'paidOn')::date;
   if day>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'FUTURE_PAYMENT';end if;
   if day<(car.approved_at at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'PAYMENT_BEFORE_APPROVAL';end if;
   if p_action='sale_received' and day<(car.sale_approved_at at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'PAYMENT_BEFORE_APPROVAL';end if;
   if p_action='pay_car_bill' and day<(bill.reviewed_at at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'PAYMENT_BEFORE_APPROVAL';end if;
   insert into uc_investor_cash_entries(pot_id,kind,amount_cents,car_id,bill_id,bank_account,bank_reference,paid_on,recorded_by)
   values(pot.id,case p_action when 'purchase_paid' then 'car_purchase' when 'pay_car_bill' then 'car_expense' else 'car_sale' end,amount,car.car_id,
    case when p_action='pay_car_bill' then bill.id end,trim(p_data->>'bankAccount'),trim(p_data->>'bankReference'),day,p_actor) returning id into entry_id;
  end if;
 end if;
 position:=uc_investor_position(pot.id);
 if (position->>'availableCents')::numeric<0 then raise exception 'INSUFFICIENT_FUNDS';end if;
 if (position->>'cashCents')::numeric>1000000000000 then raise exception 'BALANCE_LIMIT';end if;
 result:=jsonb_build_object('car',uc_investor_car_summary(car.car_id),'position',position,'billId',bill.id,'entryId',entry_id);
 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot.id,p_actor,p_action,jsonb_build_object('requestId',req,'carId',car.car_id,'billId',bill.id,'entryId',entry_id));
 insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,payload,result);
 return result;
end $$;

alter table public.uc_investor_cars enable row level security;
alter table public.uc_investor_car_bills enable row level security;
alter table public.uc_investor_car_settlements enable row level security;
alter table public.uc_company_investor_profit enable row level security;
revoke all on table public.uc_investor_cars,public.uc_investor_car_bills,public.uc_investor_car_settlements,public.uc_company_investor_profit from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_car_summary(text) from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_investor_capital(text,text,jsonb) to service_role;
