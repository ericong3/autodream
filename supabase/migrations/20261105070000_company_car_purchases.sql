-- PREPARED ONLY. New ordinary company purchases accrue seller/lender bills.
begin;
do $$ begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' or to_regclass('uc_company_trade_in_applications') is null then raise exception 'COMPANY_TRADE_IN_FOUNDATION_REQUIRED';end if;
end $$;
alter table cars add column company_purchase_recorded boolean not null default false;
create table public.uc_company_car_purchases (
 car_id text primary key references cars(id),purchase_cents bigint not null check(purchase_cents between 1 and 1000000000000),
 seller_name text not null check(length(trim(seller_name)) between 1 and 150),lender_cents bigint not null check(lender_cents between 0 and purchase_cents),lender_name text,
 seller_payment_id text unique references payments(id) deferrable initially deferred,lender_payment_id text unique references payments(id) deferrable initially deferred,
 created_by text not null references garage_building_staff(id),created_at timestamptz not null default now(),request_id text not null,payload jsonb not null,result jsonb not null,
 unique(created_by,request_id),check((seller_payment_id is null)=(purchase_cents=lender_cents)),check((lender_payment_id is null)=(lender_cents=0)),check(lender_cents=0 or length(trim(lender_name)) between 1 and 150)
);
create trigger uc_company_purchase_fixed before update or delete on uc_company_car_purchases for each row execute function uc_investor_immutable();
create trigger uc_company_purchase_no_truncate before truncate on uc_company_car_purchases execute function uc_investor_immutable();
alter table uc_company_car_purchases enable row level security;
revoke all on uc_company_car_purchases from public,anon,authenticated,service_role;
create function public.uc_company_purchase_car_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare recorded boolean;begin
 if tg_op='UPDATE' and uc_company_outgoing_change_allowed(old.id,to_jsonb(old),to_jsonb(new)) then return new;end if;
 if tg_op='INSERT' then if new.company_purchase_recorded then raise exception 'USE_COMPANY_PURCHASE';end if;return new;end if;
 recorded:=exists(select 1 from uc_company_car_purchases where car_id=old.id) or exists(select 1 from uc_company_trade_in_applications where incoming_car_id=old.id);
 if tg_op='DELETE' then if recorded then raise exception 'COMPANY_PURCHASE_LOCKED';end if;return old;end if;
 if new.company_purchase_recorded and not recorded then raise exception 'USE_COMPANY_PURCHASE';end if;
 if recorded and (not new.company_purchase_recorded or exists(select 1 from unnest(array['purchase_price','settlement_amount','settlement_recipient','trade_in_source_car_id','investor_id','investor_split','investor_funded','investor_tagged','consignment','outgoing_consignment']) k where to_jsonb(new)->k is distinct from to_jsonb(old)->k)) then raise exception 'COMPANY_PURCHASE_LOCKED';end if;
 return new;
end $$;
create trigger uc_company_purchase_car_fixed before insert or update or delete on cars for each row execute function uc_company_purchase_car_guard();
create function public.uc_company_trade_in_marked() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin update cars set company_purchase_recorded=true where id=new.incoming_car_id;return new;end $$;
create trigger uc_company_trade_in_marked after insert on uc_company_trade_in_applications for each row execute function uc_company_trade_in_marked();
update cars set company_purchase_recorded=true where id in (select incoming_car_id from uc_company_trade_in_applications);
create function public.uc_company_purchase_journal_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.source_type in ('car_purchased','trade_in_acquired','purchase_settlement_recognized') and exists(select 1 from uc_company_car_purchases where car_id=new.car_id) then raise exception 'COMPANY_PURCHASE_ALREADY_RECORDED';end if;return new;
end $$;
create trigger uc_company_purchase_journal_fixed before insert or update on journal_entries for each row execute function uc_company_purchase_journal_guard();
create function public.uc_company_purchase_bill_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from uc_company_car_purchases where old.id in (seller_payment_id,lender_payment_id)) or exists(select 1 from uc_company_trade_in_applications where lender_payment_id=old.id) then
  if tg_op='DELETE' then raise exception 'COMPANY_PURCHASE_LOCKED';end if;
  if exists(select 1 from unnest(array['type','car_id','amount','recipient_name','recipient_id','recipient_type']) k where to_jsonb(old)->k is distinct from to_jsonb(new)->k) then raise exception 'COMPANY_PURCHASE_LOCKED';end if;
 end if;if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger uc_company_purchase_bill_fixed before update or delete on payments for each row execute function uc_company_purchase_bill_guard();
create or replace function public.uc_company_trade_in_source(p_journal text,p_car text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from uc_company_trade_in_applications a where a.incoming_car_id=p_car and p_journal='uc:company-trade-in:'||a.id::text)
 or exists(select 1 from uc_company_car_purchases a where a.car_id=p_car and p_journal='uc:company-purchase:'||a.car_id) $$;

create function public.uc_register_company_car(p_actor text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
   or coalesce(existing.status,'') not in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') or exists(select 1 from journal_entries where journal_entries.car_id=v_car_id and not coalesce(voided,false)) or exists(select 1 from payments where payments.car_id=v_car_id) then raise exception 'CAR_EXISTS';end if;
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
revoke all on function uc_company_purchase_car_guard(),uc_company_trade_in_marked(),uc_company_purchase_journal_guard(),uc_company_purchase_bill_guard(),uc_company_trade_in_source(text,text),uc_register_company_car(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_register_company_car(text,jsonb) to service_role;
commit;
