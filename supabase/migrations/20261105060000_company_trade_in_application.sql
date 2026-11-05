-- PREPARED ONLY. Explicit company funding for trade-ins from investor sales.
begin;
create function uc_company_outgoing_change_allowed(p_car text,p_before jsonb,p_after jsonb) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select false$$;
revoke all on function uc_company_outgoing_change_allowed(text,jsonb,jsonb) from public,anon,authenticated,service_role;
do $$ begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' or to_regclass('uc_company_bank_receipts') is null then raise exception 'COMPANY_RECEIPTS_REQUIRED';end if;
end $$;
create table public.uc_company_trade_in_applications (
 id uuid primary key default gen_random_uuid(),choice_id uuid not null unique references uc_trade_in_funding_choices(id),
 incoming_car_id text not null unique references cars(id),outgoing_car_id text not null references uc_investor_cars(car_id),outgoing_pot_id uuid not null references uc_investor_pots(id),
 gross_cents bigint not null check(gross_cents between 1 and 1000000000000),lender_cents bigint not null check(lender_cents between 0 and gross_cents),
 amount_cents bigint generated always as (gross_cents-lender_cents) stored,document_id uuid not null unique references uc_trade_in_documents(id),
 lender_payment_id text unique references payments(id) deferrable initially deferred,
 applied_by text not null references garage_building_staff(id),applied_at timestamptz not null default now(),request_id text not null,payload jsonb not null,
 unique(applied_by,request_id),check(incoming_car_id<>outgoing_car_id),check((lender_cents=0)=(lender_payment_id is null))
);
create index uc_company_trade_in_source_pot on uc_company_trade_in_applications(outgoing_pot_id);
create index uc_company_trade_in_source_car on uc_company_trade_in_applications(outgoing_car_id);
create trigger uc_company_trade_in_fixed before update or delete on uc_company_trade_in_applications for each row execute function uc_investor_immutable();
create trigger uc_company_trade_in_no_truncate before truncate on uc_company_trade_in_applications execute function uc_investor_immutable();
alter table uc_company_trade_in_applications enable row level security;
revoke all on uc_company_trade_in_applications from public,anon,authenticated,service_role;

alter function uc_investor_car_summary(text) rename to uc_car_summary_before_company_trade_ins;
create function public.uc_investor_car_summary(p_car text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;credit bigint;begin
 r:=uc_car_summary_before_company_trade_ins(p_car);if r is null then return null;end if;
 select coalesce(sum(amount_cents),0) into credit from uc_company_trade_in_applications where outgoing_car_id=p_car;
 return r||jsonb_build_object('receivedCents',(r->>'receivedCents')::bigint+credit,'tradeInReceivedCents',(r->>'tradeInReceivedCents')::bigint+credit);
end $$;
alter function uc_investor_position(uuid) rename to uc_position_before_company_trade_ins;
create function public.uc_investor_position(p_pot uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;credit bigint;begin
 r:=uc_position_before_company_trade_ins(p_pot);select coalesce(sum(amount_cents),0) into credit from uc_company_trade_in_applications where outgoing_pot_id=p_pot;
 return r||jsonb_build_object('cashCents',(r->>'cashCents')::bigint+credit,'tradeInOwnershipCents',(r->>'tradeInOwnershipCents')::bigint+credit,'availableCents',(r->>'availableCents')::bigint+credit);
end $$;
alter function uc_company_cash_position() rename to uc_company_position_before_customer_holds;
create function public.uc_company_cash_position() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;held bigint;refund_extra bigint;begin
 r:=uc_company_position_before_customer_holds();
 -- New receipt-backed customer deposits remain customer money until the sale.
 -- Include only new workflow cars; historical statement matching is deferred.
 select coalesce(sum(greatest(0,-x.balance)),0)::bigint into held from (
  select j.car_id,sum(((l->>'debit')::numeric-(l->>'credit')::numeric)*100) balance
  from journal_entries j cross join lateral jsonb_array_elements(j.lines) l
  where not coalesce(j.voided,false) and l->>'accountId'='acct-ar' and exists(select 1 from uc_company_bank_receipts where car_id=j.car_id) group by j.car_id
 ) x;
 select coalesce(sum(greatest(0,x.liability-coalesce(p.pending,0))),0)::bigint into refund_extra from (
  select j.car_id,sum(((l->>'credit')::numeric-(l->>'debit')::numeric)*100) liability
  from journal_entries j cross join lateral jsonb_array_elements(j.lines) l
  where not coalesce(j.voided,false) and l->>'accountId'='acct-customer-refunds' and exists(select 1 from uc_company_bank_receipts where car_id=j.car_id) group by j.car_id
 ) x left join lateral (select sum(greatest(0,uc_commission_cents(to_jsonb(p)->'amount')-uc_company_paid_cents(p.id))) pending from payments p where p.car_id=x.car_id and p.type='customer_refund' and p.status='pending' and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false)) p on true;
 return r||jsonb_build_object('customerHeldCents',held+refund_extra,'availableCents',(r->>'availableCents')::bigint-held-refund_extra);
end $$;

alter function uc_trade_in_choice_view(uuid) rename to uc_choice_before_company_trade_ins;
create function public.uc_trade_in_choice_view(p_choice uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;a uc_company_trade_in_applications;begin
 r:=uc_choice_before_company_trade_ins(p_choice);select * into a from uc_company_trade_in_applications where choice_id=p_choice;
 if a.id is null then return r;end if;
 return r||jsonb_build_object('financiallyApplied',true,'status','funded','appliedAt',a.applied_at,'appliedBy',(select name from garage_building_staff where id=a.applied_by),
  'applicationId',a.id,'lenderPaymentId',a.lender_payment_id,'lenderPaidCents',coalesce(uc_company_paid_cents(a.lender_payment_id),0));
end $$;

create function public.uc_company_trade_in_car_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and uc_company_outgoing_change_allowed(old.id,to_jsonb(old),to_jsonb(new)) then return new;end if;
 if exists(select 1 from uc_company_trade_in_applications where incoming_car_id=old.id) then
  if tg_op='DELETE' then raise exception 'TRADE_IN_FUNDING_LOCKED';end if;
  if (to_jsonb(new)-array['status','selling_price','final_deal','misc_costs']) is distinct from (to_jsonb(old)-array['status','selling_price','final_deal','misc_costs']) and
   exists(select 1 from unnest(array['purchase_price','settlement_amount','trade_in_source_car_id','investor_id','investor_split','investor_funded','investor_tagged','consignment','outgoing_consignment']) k where to_jsonb(new)->k is distinct from to_jsonb(old)->k) then raise exception 'TRADE_IN_FUNDING_LOCKED';end if;
 end if;if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger uc_company_trade_in_car_fixed before update or delete on cars for each row execute function uc_company_trade_in_car_guard();
create function public.uc_company_trade_in_journal_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op<>'DELETE' and new.source_type in ('trade_in_acquired','car_purchased','purchase_settlement_recognized') and exists(select 1 from uc_company_trade_in_applications where incoming_car_id=new.car_id) then raise exception 'TRADE_IN_ALREADY_FUNDED';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger uc_company_trade_in_journal_fixed before insert or update on journal_entries for each row execute function uc_company_trade_in_journal_guard();

alter function uc_apply_investor_trade_in(text,text,jsonb) rename to uc_apply_before_company_trade_ins;
create function public.uc_apply_investor_trade_in(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;c uc_trade_in_funding_choices;a uc_company_trade_in_applications;source uc_investor_cars;incoming cars;d uc_trade_in_documents;latest uuid;req text;result jsonb;
begin
 if p_action<>'apply' then return uc_apply_before_company_trade_ins(p_actor,p_action,p_data);end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access='both',false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('choiceId','documentId','requestId')) then raise exception 'INVALID';end if;
 req:=p_data->>'requestId';if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('trade-in-apply:'||p_actor||':'||req,0));
 select * into a from uc_company_trade_in_applications where applied_by=p_actor and request_id=req;
 if found then
  if a.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;
 else
  if exists(select 1 from uc_trade_in_applications where applied_by=p_actor and request_id=req and payload is distinct from p_data) then raise exception 'REQUEST_CHANGED';end if;
  select * into c from uc_trade_in_funding_choices where id=(p_data->>'choiceId')::uuid;
  if c.id is null then raise exception 'NOT_ALLOWED';end if;
  if c.funding_kind='investor' then
   result:=uc_apply_before_company_trade_ins(p_actor,p_action,p_data);
   return result||jsonb_build_object('car',(select to_jsonb(v) from cars v where id=c.incoming_car_id),'payments','[]'::jsonb,'journals','[]'::jsonb);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
  select * into source from uc_investor_cars where car_id=c.outgoing_car_id;
  if source.car_id is null then raise exception 'OUTGOING_INVESTOR_CAR_REQUIRED';end if;
  perform 1 from uc_investor_pots where id=source.pot_id for update;
  perform 1 from cars where id in (c.incoming_car_id,c.outgoing_car_id) order by id for update;
  select * into incoming from cars where id=c.incoming_car_id;
  select * into source from uc_investor_cars where car_id=c.outgoing_car_id;
  select id into latest from uc_trade_in_funding_choices where incoming_car_id=c.incoming_car_id order by revision desc limit 1;
  if latest is distinct from c.id then raise exception 'CHOICE_CHANGED';end if;
  if incoming.trade_in_source_car_id is distinct from c.outgoing_car_id or uc_commission_cents(to_jsonb(incoming)->'purchase_price') is distinct from c.gross_cents or coalesce(uc_commission_cents(to_jsonb(incoming)->'settlement_amount'),0)<>c.lender_cents then raise exception 'TRADE_IN_VALUE_CHANGED';end if;
  if source.sale_cents is null or source.settled_at is not null then raise exception 'SALE_PRICE_REQUIRED';end if;
  if c.gross_cents-c.lender_cents>source.sale_cents-(uc_investor_car_summary(source.car_id)->>'receivedCents')::bigint then raise exception 'TRADE_IN_CREDIT_EXCEEDS_SALE';end if;
  if exists(select 1 from uc_investor_cars where car_id=incoming.id) or exists(select 1 from uc_company_trade_in_applications where incoming_car_id=incoming.id) then raise exception 'TRADE_IN_FUNDING_LOCKED';end if;
  if coalesce(incoming.status,'') not in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') or incoming.investor_id is not null or coalesce(to_jsonb(incoming)->>'investor_tagged','false')='true'
   or incoming.consignment is not null and incoming.consignment<>'null'::jsonb or incoming.outgoing_consignment is not null and incoming.outgoing_consignment<>'null'::jsonb
   or exists(select 1 from journal_entries where car_id=incoming.id and not coalesce(voided,false)) or exists(select 1 from payments where car_id=incoming.id) then raise exception 'TRADE_IN_HISTORY_REVIEW_REQUIRED';end if;
  select * into d from uc_trade_in_documents where id=(p_data->>'documentId')::uuid and choice_id=c.id and confirmed_at is not null;
  if d.id is null then raise exception 'TRADE_IN_INVOICE_REQUIRED';end if;
  if (uc_company_cash_position()->>'availableCents')::bigint<c.gross_cents then raise exception 'INSUFFICIENT_FUNDING_POT';end if;
  update cars set investor_split=null where id=incoming.id;
  insert into uc_company_trade_in_applications(choice_id,incoming_car_id,outgoing_car_id,outgoing_pot_id,gross_cents,lender_cents,document_id,lender_payment_id,applied_by,request_id,payload)
  values(c.id,incoming.id,source.car_id,source.pot_id,c.gross_cents,c.lender_cents,d.id,case when c.lender_cents>0 then 'company-trade-in-lender:'||c.id::text end,p_actor,req,p_data) returning * into a;
  if a.lender_cents>0 then
   insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,description,created_at)
   values(a.lender_payment_id,incoming.id,'purchase_settlement','pending',a.lender_cents::numeric/100,'merchant',incoming.id,'Trade-in lender','Trade-in lender balance. Confirm lender details and attach its statement before payment.',now());
  end if;
  perform uc_post_journal('company-trade-in:'||a.id::text,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Company funded trade-in; no bank transfer',incoming.id,p_actor,jsonb_build_array(
   jsonb_build_object('accountId','acct-inv-own','debit',a.gross_cents::numeric/100,'credit',0),jsonb_build_object('accountId','acct-uc-sale-clearing','debit',0,'credit',a.amount_cents::numeric/100),jsonb_build_object('accountId','acct-ap','debit',0,'credit',a.lender_cents::numeric/100)));
  if (uc_company_cash_position()->>'availableCents')::bigint<0 then raise exception 'INSUFFICIENT_FUNDING_POT';end if;
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(source.pot_id,p_actor,'trade_in_sale_credit',jsonb_build_object('carId',source.car_id,'incomingCarId',incoming.id,'amountCents',a.amount_cents,'applicationId',a.id,'fundingKind','company'));
 end if;
 return jsonb_build_object('choice',uc_trade_in_choice_view(a.choice_id),'car',(select to_jsonb(v) from cars v where id=a.incoming_car_id),
  'payments',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(p.id))) from payments p where id=a.lender_payment_id),'[]'::jsonb),
  'journals',(select jsonb_agg(to_jsonb(j)) from journal_entries j where id='uc:company-trade-in:'||a.id::text));
end $$;

alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_company_trade_ins;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;pot uuid;begin
 if p_action not in ('snapshot','car_snapshot','list_profiles','car_billing_list') then perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));end if;
 if p_action in ('fund_car','void_funding','purchase_paid') and exists(select 1 from uc_company_trade_in_applications where incoming_car_id=p_data->>'carId') then raise exception 'TRADE_IN_ALREADY_FUNDED';end if;
 r:=uc_capital_before_company_trade_ins(p_actor,p_action,p_data);
 if p_action='snapshot' then
  pot:=(r->'position'->>'potId')::uuid;
  r:=r||jsonb_build_object('entries',coalesce((select jsonb_agg(e.value order by e.value->>'recordedAt' desc,e.value->>'id') from (
   select value from jsonb_array_elements(r->'entries') union all
   select jsonb_build_object('id',a.id::text||':company-in','kind','trade_in_value_in','amountCents',a.amount_cents,'paidOn',null,'recordedAt',a.applied_at) from uc_company_trade_in_applications a where a.outgoing_pot_id=pot
  ) e),'[]'::jsonb));
 end if;return r;
end $$;
-- The shared ownership calculation must not race another company allocation,
-- a bank receipt or an actual outgoing payment. Acquire this before row locks.
alter function uc_company_bank_money(text,text,jsonb) rename to uc_bank_money_before_company_trade_ins;
create function public.uc_company_bank_money(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;page_no integer;stock jsonb;
begin
 if p_action='company' then
  select * into actor from garage_building_staff where id=p_actor;
  if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
  if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k<>'page') or coalesce(p_data->>'page','0') !~ '^\d{1,6}$' then raise exception 'INVALID';end if;
  page_no:=coalesce((p_data->>'page')::integer,0);
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb) into stock from (
   select c.id,c.make,c.model,c.year,c.car_plate,c.photo,c.status,uc_commission_cents(to_jsonb(c)->'purchase_price') "purchaseCents"
   from cars c where c.investor_id is null and not coalesce(c.investor_funded,false) and coalesce(to_jsonb(c)->>'investor_tagged','false')<>'true'
    and (c.consignment is null or c.consignment='null'::jsonb) and (c.outgoing_consignment is null or c.outgoing_consignment='null'::jsonb)
    and not exists(select 1 from uc_investor_cars a where a.car_id=c.id) and c.status not in ('sold','delivered')
   order by c.id limit 26 offset page_no*25
  ) q;
  return jsonb_build_object('company',uc_company_cash_position(),'cars',(select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) from jsonb_array_elements(stock) with ordinality where ordinality<=25),'hasMore',jsonb_array_length(stock)>25);
 end if;
 if p_action='record' then perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));end if;
 return uc_bank_money_before_company_trade_ins(p_actor,p_action,p_data);
end $$;
alter function uc_company_bank_receipt(text,text,jsonb) rename to uc_receipts_before_company_trade_ins;
create function public.uc_company_bank_receipt(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_action='record' then perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));end if;
 return uc_receipts_before_company_trade_ins(p_actor,p_action,p_data);
end $$;
revoke all on function uc_bank_money_before_company_trade_ins(text,text,jsonb),uc_receipts_before_company_trade_ins(text,text,jsonb),uc_company_bank_money(text,text,jsonb),uc_company_bank_receipt(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_company_bank_money(text,text,jsonb),uc_company_bank_receipt(text,text,jsonb) to service_role;
revoke all on function uc_car_summary_before_company_trade_ins(text),uc_position_before_company_trade_ins(uuid),uc_company_position_before_customer_holds(),uc_choice_before_company_trade_ins(uuid),uc_apply_before_company_trade_ins(text,text,jsonb),uc_capital_before_company_trade_ins(text,text,jsonb),uc_company_trade_in_car_guard(),uc_company_trade_in_journal_guard(),uc_investor_car_summary(text),uc_investor_position(uuid),uc_company_cash_position(),uc_trade_in_choice_view(uuid),uc_apply_investor_trade_in(text,text,jsonb),uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_apply_investor_trade_in(text,text,jsonb),uc_investor_capital(text,text,jsonb) to service_role;
commit;
