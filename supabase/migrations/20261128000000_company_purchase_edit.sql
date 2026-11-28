-- Company car purchases: record and change while nothing is paid.
--
-- 1. Record purchase on a car already in stock was refused ("This car is already
--    registered") when the car had ANY bill or books entry, e.g. a trailer cost.
--    Only purchase money should block it: an old seller/lender bill, or a
--    purchase entry in the books.
-- 2. A recorded purchase (price, seller, loan) can be changed until any money or
--    proof of payment is on its seller or lender bill. Then it locks, and a
--    mistake needs a reviewed correction instead.
begin;
do $$ begin
 if to_regclass('public.uc_company_car_purchases') is null or to_regclass('public.bank_transactions') is null or to_regclass('public.uc_company_bill_adjustments') is null or to_regclass('public.uc_money_deductions') is null
  or to_regprocedure('public.uc_company_paid_cents(text)') is null or to_regprocedure('public.uc_post_journal(text,date,text,text,text,jsonb)') is null then raise exception 'COMPANY_PURCHASE_FOUNDATION_REQUIRED';end if;
end $$;

-- 1. Record purchase: only purchase money blocks a car already in stock.
create or replace function public.uc_register_company_car(p_actor text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;prior uc_company_car_purchases;existing cars;car_in jsonb;v_car_id text;req text;cols text;price bigint;lender bigint;seller text;lender_name text;seller_id text;lender_id text;result jsonb;
 allowed text[]:=array['id','make','model','variant','car_plate','colour','condition','transmission','notes','current_location','assigned_salesperson','photo_taken_by','source_salesman','source_type','external_salesman_id','source_salesman_id','coming_soon_type','panel_dealer_id','shipment_id','year','mileage','purchase_price','selling_price','price_floor','sales_commission','source_commission','intake_commission','panel_charge_amount','green_card','thumbprint_done','intake_complete','is_recon','is_staff_sale','waive_commission','seller_thumbprint_saved','date_added','car_in_date','status','photo','photos','checklist_items'];
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role in ('director','salesperson') and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('car','sellerName','lenderCents','lenderName','requestId')) then raise exception 'INVALID';end if;
 req:=p_data->>'requestId';if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 perform pg_advisory_xact_lock(hashtextextended('company-purchase:'||p_actor||':'||req,0));
 select * into prior from uc_company_car_purchases where created_by=p_actor and request_id=req;
 if found then
  if prior.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;
  return prior.result||jsonb_build_object('car',(select to_jsonb(c) from cars c where c.id=prior.car_id),
   'payments',case when actor.role='director' then coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(p.id)) order by id) from payments p where p.id in (prior.seller_payment_id,prior.lender_payment_id)),'[]'::jsonb) else '[]'::jsonb end);
 end if;
 car_in:=p_data->'car';if jsonb_typeof(car_in) is distinct from 'object' or exists(select 1 from jsonb_object_keys(car_in) k where not(k=any(allowed))) then raise exception 'INVALID';end if;
 v_car_id:=car_in->>'id';if coalesce(v_car_id,'') !~ '^[A-Za-z0-9_-]{1,100}$' or coalesce(car_in->>'status','') not in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') or exists(select 1 from unnest(array['make','model','colour']) k where jsonb_typeof(car_in->k) is distinct from 'string' or coalesce(length(trim(car_in->>k)),0)=0) then raise exception 'INVALID';end if;
 price:=uc_commission_cents(car_in->'purchase_price');lender:=uc_recovery_cents(coalesce(p_data->'lenderCents','0'::jsonb));seller:=trim(p_data->>'sellerName');lender_name:=nullif(trim(p_data->>'lenderName'),'');
 if jsonb_typeof(car_in->'purchase_price') is distinct from 'number' or price is null or price<=0 or price>1000000000000 or (car_in->>'purchase_price')::numeric*100<>price or lender>price or jsonb_typeof(p_data->'sellerName') is distinct from 'string' or coalesce(length(seller),0) not between 1 and 150 or seller ~ '[[:cntrl:]]' or lender>0 and (coalesce(length(lender_name),0) not between 1 and 150 or lender_name ~ '[[:cntrl:]]') then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('uc-car:'||v_car_id,0));
 select * into existing from cars c where c.id=v_car_id for update;
 if existing.id is not null then
  if actor.role<>'director' or coalesce(existing.purchase_price,0)<>0 or coalesce(existing.company_purchase_recorded,false) or coalesce(existing.investor_funded,false) or existing.investor_id is not null
   or existing.trade_in_source_car_id is not null or coalesce(to_jsonb(existing)->>'investor_tagged','false')='true' or existing.consignment is not null and existing.consignment<>'null'::jsonb or existing.outgoing_consignment is not null and existing.outgoing_consignment<>'null'::jsonb
   or coalesce(existing.status,'') not in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') then raise exception 'CAR_EXISTS';end if;
  -- Only purchase money blocks this. A trailer, repair or commission bill is a car cost, not the purchase.
  if exists(select 1 from payments where payments.car_id=v_car_id and payments.type='purchase_settlement')
   or exists(select 1 from journal_entries j where (j.car_id=v_car_id or j.source_id=v_car_id) and not coalesce(j.voided,false) and j.source_type in ('car_purchased','trade_in_acquired','purchase_settlement_recognized')) then raise exception 'PURCHASE_ALREADY_BOOKED';end if;
  -- Completing a price-pending draft changes only the purchase basis. Other
  -- car details stay as currently saved, rather than replaying an old form.
  update cars c set purchase_price=price::numeric/100,settlement_amount=lender::numeric/100,settlement_recipient=lender_name,investor_split=null where c.id=v_car_id;
 else
 car_in:=car_in||jsonb_build_object('investor_id',null,'investor_split',null,'investor_funded',false,'consignment',null,'outgoing_consignment',null,'trade_in_source_car_id',null,'settlement_amount',lender::numeric/100,'settlement_recipient',lender_name);
 select string_agg(quote_ident(k),',' order by k) into cols from jsonb_object_keys(car_in) k;
 execute format('insert into public.cars(%s) select %s from jsonb_populate_record(null::public.cars,$1)',cols,cols) using car_in;
 end if;
 seller_id:=case when price>lender then 'company-purchase-seller:'||v_car_id end;lender_id:=case when lender>0 then 'company-purchase-lender:'||v_car_id end;
 -- Purchase is an accrual, not proof that any bank money has moved.
 perform uc_post_journal('company-purchase:'||v_car_id,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Company car purchase; payment still owing',v_car_id,p_actor,jsonb_build_array(jsonb_build_object('accountId','acct-inv-own','debit',price::numeric/100,'credit',0),jsonb_build_object('accountId','acct-ap','debit',0,'credit',price::numeric/100)));
 if seller_id is not null then insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,description,created_at) values(seller_id,v_car_id,'purchase_settlement','pending',(price-lender)::numeric/100,'merchant',v_car_id,seller,'Car purchase — seller balance',now());end if;
 if lender_id is not null then insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,description,created_at) values(lender_id,v_car_id,'purchase_settlement','pending',lender::numeric/100,'merchant',v_car_id,lender_name,'Car purchase — lender balance',now());end if;
 -- The marker is derived from the authoritative purchase row. First assemble
 -- the exact replay result, then insert it and mark the car without changing basis.
 result:=jsonb_build_object('companyPurchase',true,'car',(select to_jsonb(c)||jsonb_build_object('company_purchase_recorded',true) from cars c where c.id=v_car_id),
  'payments',case when actor.role='director' then coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('bank_paid_cents',0) order by id) from payments p where p.id in (seller_id,lender_id)),'[]'::jsonb) else '[]'::jsonb end,
  'journals',case when actor.role='director' then (select jsonb_agg(to_jsonb(j)) from journal_entries j where id='uc:company-purchase:'||v_car_id) else '[]'::jsonb end);
 insert into uc_company_car_purchases(car_id,purchase_cents,seller_name,lender_cents,lender_name,seller_payment_id,lender_payment_id,created_by,request_id,payload,result) values(v_car_id,price,seller,lender,lender_name,seller_id,lender_id,p_actor,req,p_data,result);
 update cars c set company_purchase_recorded=true where c.id=v_car_id;
 return result;
end $$;

-- 2. Changing a recorded company purchase while nothing is paid.
--    Price, seller name and loan can change until any money or proof of payment
--    is on the seller or lender bill. One save changes the car, the bills and the
--    books together: a correcting books entry moves the difference between stock
--    (acct-inv-own) and money owed (acct-ap), so bills and books always match.

-- Who changed what, before and after. Rows are never changed or removed.
create table public.uc_company_purchase_edits (
 id bigint generated always as identity primary key,
 car_id text not null references cars(id),
 actor_id text not null references garage_building_staff(id),
 request_id text not null,
 payload jsonb not null,
 before_purchase jsonb not null,
 after_purchase jsonb not null,
 journal_id text unique references journal_entries(id) deferrable initially deferred,
 created_at timestamptz not null default now(),
 unique(actor_id,request_id)
);
create trigger uc_company_purchase_edits_fixed before update or delete on uc_company_purchase_edits for each row execute function uc_investor_immutable();
create trigger uc_company_purchase_edits_no_truncate before truncate on uc_company_purchase_edits execute function uc_investor_immutable();
alter table uc_company_purchase_edits enable row level security;
revoke all on uc_company_purchase_edits from public,anon,authenticated,service_role;

-- The purchase row keeps its current values; only the edit below may change them.
drop trigger uc_company_purchase_fixed on uc_company_car_purchases;
create function public.uc_company_purchase_row_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and current_setting('autodream.company_purchase_edit',true)=txid_current()::text||':'||old.car_id
  and (new.car_id,new.created_by,new.created_at,new.request_id,new.payload,new.result) is not distinct from (old.car_id,old.created_by,old.created_at,old.request_id,old.payload,old.result) then return new;end if;
 raise exception 'COMPANY_PURCHASE_LOCKED';
end $$;
create trigger uc_company_purchase_fixed before update or delete on uc_company_car_purchases for each row execute function uc_company_purchase_row_guard();

-- The car's price and loan stay locked, except inside the edit for that car.
create or replace function public.uc_company_purchase_car_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare recorded boolean;begin
 if tg_op='UPDATE' and uc_company_outgoing_change_allowed(old.id,to_jsonb(old),to_jsonb(new)) then return new;end if;
 if tg_op='UPDATE' and current_setting('autodream.company_purchase_edit',true)=txid_current()::text||':'||old.id and new.company_purchase_recorded
  and not exists(select 1 from unnest(array['trade_in_source_car_id','investor_id','investor_split','investor_funded','investor_tagged','consignment','outgoing_consignment']) k where to_jsonb(new)->k is distinct from to_jsonb(old)->k) then return new;end if;
 if tg_op='INSERT' then if new.company_purchase_recorded then raise exception 'USE_COMPANY_PURCHASE';end if;return new;end if;
 recorded:=exists(select 1 from uc_company_car_purchases where car_id=old.id) or exists(select 1 from uc_company_trade_in_applications where incoming_car_id=old.id);
 if tg_op='DELETE' then if recorded then raise exception 'COMPANY_PURCHASE_LOCKED';end if;return old;end if;
 if new.company_purchase_recorded and not recorded then raise exception 'USE_COMPANY_PURCHASE';end if;
 if recorded and (not new.company_purchase_recorded or exists(select 1 from unnest(array['purchase_price','settlement_amount','settlement_recipient','trade_in_source_car_id','investor_id','investor_split','investor_funded','investor_tagged','consignment','outgoing_consignment']) k where to_jsonb(new)->k is distinct from to_jsonb(old)->k)) then raise exception 'COMPANY_PURCHASE_LOCKED';end if;
 return new;
end $$;

-- The seller and lender bills stay locked, except inside the edit for that car.
create or replace function public.uc_company_purchase_bill_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and current_setting('autodream.company_purchase_edit',true)=txid_current()::text||':'||old.car_id and old.type='purchase_settlement'
  and (new.id,new.type,new.car_id,new.recipient_type,new.recipient_id) is not distinct from (old.id,old.type,old.car_id,old.recipient_type,old.recipient_id) then return new;end if;
 if exists(select 1 from uc_company_car_purchases where old.id in (seller_payment_id,lender_payment_id)) or exists(select 1 from uc_company_trade_in_applications where lender_payment_id=old.id) then
  if tg_op='DELETE' then raise exception 'COMPANY_PURCHASE_LOCKED';end if;
  if exists(select 1 from unnest(array['type','car_id','amount','recipient_name','recipient_id','recipient_type']) k where to_jsonb(old)->k is distinct from to_jsonb(new)->k) then raise exception 'COMPANY_PURCHASE_LOCKED';end if;
 end if;if tg_op='DELETE' then return old;end if;return new;
end $$;

-- A correcting books entry counts toward what is owed on the purchase bills,
-- wherever a seller or lender payment is checked.
create or replace function public.uc_company_trade_in_source(p_journal text,p_car text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from uc_company_trade_in_applications a where a.incoming_car_id=p_car and p_journal='uc:company-trade-in:'||a.id::text)
 or exists(select 1 from uc_company_car_purchases a where a.car_id=p_car and p_journal='uc:company-purchase:'||a.car_id)
 or exists(select 1 from uc_company_purchase_edits e where e.car_id=p_car and e.journal_id=p_journal)
 or exists(select 1 from journal_entries j join cars c on c.id=p_car
   where j.id=p_journal
     and (j.source_type='trade_in_acquired' and j.source_id=c.id
       or j.source_type='trade_in_topup' and c.trade_in_source_car_id is not null and j.source_id=c.trade_in_source_car_id)) $$;

-- What the app needs back: the car, its purchase bills, the correcting entry, and bills removed.
create function public.uc_company_purchase_edit_result(p_car text,p_journal text,p_removed text[]) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('companyPurchase',true,
  'car',(select to_jsonb(c) from cars c where c.id=p_car),
  'payments',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(p.id)) order by p.id) from payments p join uc_company_car_purchases a on a.car_id=p_car and p.id in (a.seller_payment_id,a.lender_payment_id)),'[]'::jsonb),
  'journals',coalesce((select jsonb_agg(to_jsonb(j)) from journal_entries j where j.id=p_journal),'[]'::jsonb),
  'removedPaymentIds',to_jsonb(coalesce(p_removed,'{}'::text[]))) $$;

create function public.uc_edit_company_purchase(p_actor text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;prior uc_company_purchase_edits;a uc_company_car_purchases;c cars;bill payments;req text;v_car text;
 v_price bigint;v_lender bigint;v_seller text;v_lender_name text;v_seller_amt bigint;v_delta bigint;v_n integer;v_journal text;
 v_seller_id text;v_lender_id text;v_removed text[]:='{}';
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('carId','purchaseCents','sellerName','lenderCents','lenderName','requestId')) then raise exception 'INVALID';end if;
 req:=p_data->>'requestId';v_car:=p_data->>'carId';
 if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' or coalesce(v_car,'') !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 perform pg_advisory_xact_lock(hashtextextended('company-purchase-edit:'||p_actor||':'||req,0));
 select * into prior from uc_company_purchase_edits where actor_id=p_actor and request_id=req;
 if found then
  if prior.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;
  return uc_company_purchase_edit_result(prior.car_id,prior.journal_id,'{}'::text[]);
 end if;
 if jsonb_typeof(p_data->'purchaseCents') is distinct from 'number' or jsonb_typeof(p_data->'lenderCents') is distinct from 'number'
  or (p_data->>'purchaseCents') !~ '^[0-9]{1,13}$' or (p_data->>'lenderCents') !~ '^[0-9]{1,13}$'
  or jsonb_typeof(p_data->'sellerName') is distinct from 'string' or (p_data ? 'lenderName' and jsonb_typeof(p_data->'lenderName') is distinct from 'string') then raise exception 'INVALID';end if;
 v_price:=(p_data->>'purchaseCents')::bigint;v_lender:=(p_data->>'lenderCents')::bigint;
 v_seller:=trim(p_data->>'sellerName');v_lender_name:=nullif(trim(coalesce(p_data->>'lenderName','')),'');
 if v_price<1 or v_price>1000000000000 or v_lender>v_price or coalesce(length(v_seller),0) not between 1 and 150 or v_seller ~ '[[:cntrl:]]'
  or v_lender>0 and (coalesce(length(v_lender_name),0) not between 1 and 150 or v_lender_name ~ '[[:cntrl:]]') then raise exception 'INVALID';end if;
 if v_lender=0 then v_lender_name:=null;end if;
 perform pg_advisory_xact_lock(hashtextextended('uc-car:'||v_car,0));
 select * into c from cars where id=v_car for update;
 select * into a from uc_company_car_purchases where car_id=v_car for update;
 if c.id is null or a.car_id is null then raise exception 'NOT_RECORDED';end if;
 if coalesce(c.status,'') not in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') or c.investor_id is not null or coalesce(c.investor_funded,false)
  or c.trade_in_source_car_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true'
  or c.consignment is not null and c.consignment<>'null'::jsonb or c.outgoing_consignment is not null and c.outgoing_consignment<>'null'::jsonb then raise exception 'CAR_NOT_IN_STOCK';end if;
 -- Locked once any money or proof of payment is on either purchase bill.
 for bill in select * from payments where id in (a.seller_payment_id,a.lender_payment_id) order by id for update loop
  if bill.status is distinct from 'pending' or coalesce((to_jsonb(bill)->>'obligation_replaced')::boolean,false) or uc_company_has_bank_history(bill.id) or uc_company_paid_cents(bill.id)>0
   or exists(select 1 from journal_entries j where j.source_type='purchase_settlement_paid' and j.source_id=bill.id and not coalesce(j.voided,false))
   or exists(select 1 from uc_company_bill_adjustments where root_payment_id=bill.id) or exists(select 1 from uc_company_bill_obligations where payment_id=bill.id)
   or exists(select 1 from uc_company_payment_documents d where d.payment_id=bill.id and d.kind='payment' and d.state='confirmed')
   -- A bank statement line already matched to this bill, or ticked as paying it on the Bank check page.
   or exists(select 1 from bank_transactions t where t.matched_payment_id=bill.id or coalesce(to_jsonb(t)->'details'->'billIds','[]'::jsonb) ? bill.id
     or coalesce(to_jsonb(t)->'details'->'billCents','{}'::jsonb) ? bill.id or coalesce(to_jsonb(t)->'details'->'billFix','{}'::jsonb) ? bill.id) then raise exception 'PURCHASE_PAID_LOCKED';end if;
 end loop;
 v_seller_amt:=v_price-v_lender;
 if v_price=a.purchase_cents and v_lender=a.lender_cents and v_seller=a.seller_name and v_lender_name is not distinct from (case when a.lender_cents>0 then a.lender_name end) then raise exception 'NO_CHANGE';end if;
 -- A bill whose amount changes must not carry a confirmed document showing the old amount,
 -- and a bill that goes away must have no documents at all.
 if a.seller_payment_id is not null and v_seller_amt<>a.purchase_cents-a.lender_cents and exists(select 1 from uc_company_payment_documents d where d.payment_id=a.seller_payment_id and (v_seller_amt=0 or d.state='confirmed'))
  or a.lender_payment_id is not null and v_lender<>a.lender_cents and exists(select 1 from uc_company_payment_documents d where d.payment_id=a.lender_payment_id and (v_lender=0 or d.state='confirmed')) then raise exception 'PURCHASE_DOCUMENT_LOCKED';end if;

 perform set_config('autodream.company_purchase_edit',txid_current()::text||':'||v_car,true);
 v_seller_id:=a.seller_payment_id;v_lender_id:=a.lender_payment_id;
 if v_seller_amt>0 then
  if v_seller_id is null then
   v_seller_id:='company-purchase-seller:'||v_car;
   insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,description,created_at) values(v_seller_id,v_car,'purchase_settlement','pending',v_seller_amt::numeric/100,'merchant',v_car,v_seller,'Car purchase — seller balance',now());
  else update payments set amount=v_seller_amt::numeric/100,recipient_name=v_seller where id=v_seller_id;end if;
 elsif v_seller_id is not null then v_removed:=v_removed||v_seller_id;v_seller_id:=null;end if;
 if v_lender>0 then
  if v_lender_id is null then
   v_lender_id:='company-purchase-lender:'||v_car;
   insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,description,created_at) values(v_lender_id,v_car,'purchase_settlement','pending',v_lender::numeric/100,'merchant',v_car,v_lender_name,'Car purchase — lender balance',now());
  else update payments set amount=v_lender::numeric/100,recipient_name=v_lender_name where id=v_lender_id;end if;
 elsif v_lender_id is not null then v_removed:=v_removed||v_lender_id;v_lender_id:=null;end if;
 update uc_company_car_purchases set purchase_cents=v_price,seller_name=v_seller,lender_cents=v_lender,lender_name=v_lender_name,seller_payment_id=v_seller_id,lender_payment_id=v_lender_id where car_id=v_car;
 if cardinality(v_removed)>0 then delete from payments where id=any(v_removed);end if;
 update cars set purchase_price=v_price::numeric/100,settlement_amount=v_lender::numeric/100,settlement_recipient=v_lender_name where id=v_car;
 v_delta:=v_price-a.purchase_cents;
 if v_delta<>0 then
  select count(*)+1 into v_n from uc_company_purchase_edits where car_id=v_car and journal_id is not null;
  v_journal:='company-purchase-edit:'||v_car||':'||v_n;
  perform uc_post_journal(v_journal,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Company car purchase price corrected; payment still owing',v_car,p_actor,
   case when v_delta>0 then jsonb_build_array(jsonb_build_object('accountId','acct-inv-own','debit',v_delta::numeric/100,'credit',0),jsonb_build_object('accountId','acct-ap','debit',0,'credit',v_delta::numeric/100))
   else jsonb_build_array(jsonb_build_object('accountId','acct-ap','debit',(-v_delta)::numeric/100,'credit',0),jsonb_build_object('accountId','acct-inv-own','debit',0,'credit',(-v_delta)::numeric/100)) end);
  v_journal:='uc:'||v_journal;
 end if;
 insert into uc_company_purchase_edits(car_id,actor_id,request_id,payload,before_purchase,after_purchase,journal_id)
  values(v_car,p_actor,req,p_data,to_jsonb(a),(select to_jsonb(x) from uc_company_car_purchases x where x.car_id=v_car),v_journal);
 perform set_config('autodream.company_purchase_edit','',true);
 return uc_company_purchase_edit_result(v_car,v_journal,v_removed);
end $$;

revoke all on function uc_company_purchase_row_guard(),uc_company_purchase_car_guard(),uc_company_purchase_bill_guard(),uc_company_trade_in_source(text,text),uc_company_purchase_edit_result(text,text,text[]),uc_edit_company_purchase(text,jsonb),uc_register_company_car(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_edit_company_purchase(text,jsonb) to service_role;
grant execute on function uc_register_company_car(text,jsonb) to service_role;
commit;
