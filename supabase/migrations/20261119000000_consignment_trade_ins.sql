-- Consignment deals that include a trade-in. Until now the consignment money
-- panel refused them (CONSIGNMENT_TRADE_IN_REVIEW_REQUIRED) and nothing else
-- could record their money, so such a car could never reach disbursed.
--
-- The trade-in's net value (agreed trade-in price less the customer's lender
-- balance) now counts as part of the customer's payment: the dealer settlement
-- still uses the full invoice, the customer collection is reduced by the
-- credit, and the opening journal clears it against acct-trade-in-clearing,
-- where the trade-in car's own acquisition entry (trade_in_acquired) credits
-- it, the same as an ordinary company sale. Swap-mode trade-ins stay blocked.
--
-- The two functions below are the originals from
-- 20261105080000_incoming_consignment_finance.sql with only those changes;
-- uc_consignment_finance_before_bills is that file's uc_consignment_finance,
-- renamed by 20261105090000 and still called by the current wrappers.
begin;

create table public.uc_consignment_trade_ins (
 car_id text primary key references uc_consignment_cases(car_id),
 incoming_car_id text not null references cars(id),
 credit_cents bigint not null check(credit_cents between 1 and 1000000000000),
 price_cents bigint not null check(price_cents>=credit_cents),
 lender_cents bigint not null check(lender_cents>=0 and lender_cents=price_cents-credit_cents),
 opened_by text not null references garage_building_staff(id),
 created_at timestamptz not null default now()
);
create trigger uc_consignment_trade_ins_fixed before update or delete on uc_consignment_trade_ins for each row execute function uc_investor_immutable();
create trigger uc_consignment_trade_ins_no_truncate before truncate on uc_consignment_trade_ins execute function uc_investor_immutable();
alter table uc_consignment_trade_ins enable row level security;
revoke all on uc_consignment_trade_ins from public,anon,authenticated,service_role;

create or replace function uc_consignment_open_plan(p_car text,p_basis integer) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c cars;b jsonb;wo jsonb;price bigint;discount bigint;revenue bigint;loan bigint;loan_contract bigint;booking bigint;capital bigint;fixed bigint;lender bigint;bp integer;party jsonb;terms text;source jsonb;n integer;ti bigint:=0;tprice bigint:=0;tlender bigint:=0;tcar text;
begin
 select * into c from cars where id=p_car;
 if c.id is null or c.consignment is null or c.consignment='null'::jsonb or c.outgoing_consignment is not null and c.outgoing_consignment<>'null'::jsonb or c.investor_id is not null or coalesce(c.investor_funded,false) or coalesce(to_jsonb(c)->>'investor_tagged','false')='true' or c.trade_in_source_car_id is not null then raise exception 'INCOMING_CONSIGNMENT_REQUIRED';end if;
 select count(*) into n from customers s where s.interested_car_id=p_car and (s.cash_work_order is not null and s.cash_work_order<>'null'::jsonb or s.loan_work_order is not null and s.loan_work_order<>'null'::jsonb);
 if n<>1 then raise exception 'ONE_DEAL_CUSTOMER_REQUIRED';end if;
 select to_jsonb(s) into b from customers s where s.interested_car_id=p_car and (s.cash_work_order is not null and s.cash_work_order<>'null'::jsonb or s.loan_work_order is not null and s.loan_work_order<>'null'::jsonb);
 wo:=case when b->'loan_work_order' is not null and b->'loan_work_order'<>'null'::jsonb then b->'loan_work_order' else b->'cash_work_order' end;
 -- A trade-in pays part of the invoice with a car instead of money. Its net
 -- value (agreed price less the customer's lender balance) is credited here;
 -- the trade-in car itself is booked on its own record (trade_in_acquired).
 if coalesce((wo->>'hasTradeIn')::boolean,false) then
  if coalesce(wo->>'tradeInMode','trade_in')<>'trade_in' then raise exception 'CONSIGNMENT_TRADE_IN_REVIEW_REQUIRED';end if;
  tprice:=coalesce(uc_commission_cents(wo->'tradeInPrice'),0);tlender:=least(tprice,greatest(0,coalesce(uc_commission_cents(wo->'settlementFigure'),0)));
  if tprice<=0 then raise exception 'TRADE_IN_VALUE_REQUIRED';end if;
  select count(*),min(id) into n,tcar from cars where trade_in_source_car_id=p_car;
  if n<>1 then raise exception 'TRADE_IN_CAR_REQUIRED';end if;
  ti:=tprice-tlender;
 end if;
 price:=uc_commission_cents(wo->'sellingPrice');discount:=coalesce(uc_commission_cents(wo->'discount'),0);
 if coalesce(price,0)<=0 then price:=uc_commission_cents(c.final_deal->'dealPrice');discount:=0;end if;
 if coalesce(price,0)<=0 or discount>=price then raise exception 'AGREED_SALE_REQUIRED';end if;
 select price-discount+coalesce(uc_commission_cents(wo->'insurance'),0)+coalesce(uc_commission_cents(wo->'bankProduct'),0)+coalesce(sum(uc_commission_cents(value->'amount')),0) into revenue from jsonb_array_elements(coalesce(nullif(wo->'additionalItems','null'::jsonb),'[]'::jsonb));
 loan:=case when b->'loan_work_order' is not null and b->'loan_work_order'<>'null'::jsonb then coalesce(uc_commission_cents(wo->'loanAmount'),0) else 0 end;
 if revenue>1000000000000 then raise exception 'LOAN_AMOUNT_REVIEW_REQUIRED';end if;
 if ti>revenue then raise exception 'TRADE_IN_CREDIT_EXCEEDS_SALE';end if;
 loan_contract:=loan;booking:=least(revenue,coalesce(uc_commission_cents(wo->'bookingFee'),0));loan:=least(loan,greatest(0,revenue-booking-ti));
 capital:=uc_commission_cents(to_jsonb(c)->'purchase_price');fixed:=coalesce(uc_commission_cents(c.consignment->'fixedAmount'),capital);lender:=coalesce(uc_commission_cents(to_jsonb(c)->'settlement_amount'),0);terms:=c.consignment->>'terms';
 if coalesce(capital,0)<=0 or coalesce(fixed,0)<=0 or terms not in ('fixed_amount','profit_split') or coalesce(length(trim(c.consignment->>'dealer')),0)=0 then raise exception 'CONSIGNMENT_TERMS_REQUIRED';end if;
 if terms='fixed_amount' and c.consignment->'fixedAmount' is null then raise exception 'CONSIGNMENT_TERMS_REQUIRED';end if;
 if terms='profit_split' then
  if p_basis is not null then bp:=p_basis;else if jsonb_typeof(c.consignment->'splitPercent') is distinct from 'number' or (c.consignment->>'splitPercent')::numeric*100<>trunc((c.consignment->>'splitPercent')::numeric*100) then raise exception 'CONSIGNMENT_PERCENT_REQUIRED';end if;bp:=((c.consignment->>'splitPercent')::numeric*100)::integer;end if;
  if bp not between 0 and 10000 then raise exception 'CONSIGNMENT_PERCENT_REQUIRED';end if;
 end if;
 party:=jsonb_build_object('id',c.consignment->>'dealer','name',c.consignment->>'dealer');
 if to_regclass('dealers') is null then raise exception 'DEALER_PROFILE_REVIEW_REQUIRED';end if;
 execute 'select count(*) from dealers d where lower(d.name)=lower($1) or d.id=$1' into n using c.consignment->>'dealer';if n<>1 then raise exception 'DEALER_PROFILE_REVIEW_REQUIRED';end if;
 execute 'select jsonb_build_object(''id'',d.id,''name'',d.name,''bankName'',coalesce(to_jsonb(d)->>''bankName'',to_jsonb(d)->>''bank_name''),''accountNumber'',coalesce(to_jsonb(d)->>''bankAccountNumber'',to_jsonb(d)->>''bank_account_number''),''accountHolder'',coalesce(to_jsonb(d)->>''bankAccountHolder'',to_jsonb(d)->>''bank_account_holder'')) from dealers d where lower(d.name)=lower($1) or d.id=$1' into party using c.consignment->>'dealer';
 if exists(select 1 from unnest(array['bankName','accountNumber','accountHolder']) x where nullif(trim(party->>x),'') is null or length(party->>x)>200 or party->>x~'[[:cntrl:]]') then raise exception 'DEALER_BANK_DETAILS_REQUIRED';end if;
 source:=jsonb_build_object('car',to_jsonb(c),'buyer',b,'basis',bp,'dealer',party,'tradeIn',jsonb_build_object('carId',tcar,'cents',ti));
 return jsonb_build_object('carId',p_car,'customerId',b->>'id','customerName',b->>'name','terms',terms,'capitalCents',capital,'fixedCents',fixed,'revenueCents',revenue,'loanCents',loan,'loanContractCents',loan_contract,'lenderCents',lender,'dealerBasisPoints',bp,'dealer',party,'tradeInCents',ti,'tradeInPriceCents',tprice,'tradeInLenderCents',tlender,'tradeInCarId',tcar,'sourceRevision',md5(source::text));
end $$;

create or replace function uc_consignment_finance_before_bills(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;k uc_consignment_cases;cmd uc_consignment_commands;plan jsonb;c cars;doc uc_consignment_documents;item jsonb;debit jsonb;lines jsonb;req text;cid text;allowed text[];n integer;pid text;jid text;amount bigint;person text;kind text;recipient jsonb;old_ctx text;stored boolean;path text;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and (actor.role='director' or actor.role in ('admin','shareholder') and p_action in ('snapshot','proof_read') or actor.role='admin' and p_action in ('proof_prepare','proof_confirm')),false) then raise exception 'NOT_ALLOWED';end if;
 allowed:=case p_action when 'preview_open' then array['carId','dealerBasisPoints'] when 'open' then array['carId','dealerBasisPoints','expectedRevision','requestId'] when 'snapshot' then array['carId'] when 'approve' then array['carId','expectedRevision','costsConfirmed','requestId'] when 'correct_terms' then array['carId','expectedRevision','dealerBasisPoints','fixedAmountCents','reason','requestId'] when 'proof_prepare' then array['carId','fileName','mimeType','sizeBytes','sha256','amendmentTerms'] when 'proof_confirm' then array['documentId'] when 'proof_read' then array['documentId'] end;
 if jsonb_typeof(p_data) is distinct from 'object' or allowed is null or exists(select 1 from jsonb_object_keys(p_data) x where not(x=any(allowed))) then raise exception 'INVALID';end if;
 if p_data?'dealerBasisPoints' and (jsonb_typeof(p_data->'dealerBasisPoints')<>'number' or (p_data->>'dealerBasisPoints')!~'^\d{1,5}$' or (p_data->>'dealerBasisPoints')::integer>10000) then raise exception 'CONSIGNMENT_PERCENT_REQUIRED';end if;
 if p_action in ('proof_read','proof_confirm') then select * into doc from uc_consignment_documents where id=(p_data->>'documentId')::uuid;cid:=doc.car_id;else cid:=p_data->>'carId';end if;
 if coalesce(cid,'')!~'^[A-Za-z0-9_-]{1,100}$' then raise exception 'INVALID';end if;
 if p_action='preview_open' then return jsonb_build_object('preview',uc_consignment_open_plan(cid,(p_data->>'dealerBasisPoints')::integer));end if;
 if p_action='snapshot' then return uc_consignment_view(cid);end if;
 if p_action in ('open','approve','correct_terms') then
  req:=p_data->>'requestId';if coalesce(req,'')!~'^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));perform pg_advisory_xact_lock(hashtextextended('consignment:'||p_actor||':'||req,0));
  select * into cmd from uc_consignment_commands where actor_id=p_actor and request_id=req;
  if found then if cmd.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;return uc_consignment_view(cmd.car_id)||jsonb_build_object('car',(select to_jsonb(v) from cars v where id=cmd.car_id),'journals','[]'::jsonb);end if;
  perform 1 from cars where id=cid for update;perform 1 from payments where car_id=cid order by id for update;perform 1 from repairs where car_id=cid order by id for update;
  perform 1 from customers where interested_car_id=cid order by id for update;
  old_ctx:=current_setting('autodream.consignment_write',true);perform set_config('autodream.consignment_write',txid_current()::text||':'||cid,true);
 end if;
 if p_action in ('proof_prepare','proof_confirm') then perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));end if;
 select * into c from cars where id=cid;select * into k from uc_consignment_cases where car_id=cid;
 if p_action='open' then
  if k.car_id is not null then raise exception 'CONSIGNMENT_ALREADY_OPEN';end if;
  plan:=uc_consignment_open_plan(cid,(p_data->>'dealerBasisPoints')::integer);if plan->>'sourceRevision' is distinct from p_data->>'expectedRevision' then raise exception 'SOURCE_CHANGED';end if;
  if coalesce(c.money_received,false) or exists(select 1 from payments where car_id=cid and type in ('customer_collection','loan_disbursement','consignment_payout','consignment_collection','purchase_settlement') and (status<>'pending' or uc_company_paid_cents(id)>0))
   or exists(select 1 from journal_entries where car_id=cid and not coalesce(voided,false) and source_type in ('car_sold','car_purchased','purchase_settlement_recognized','trade_in_acquired','disbursement_received','consignment_payout_paid','consignment_collection_received')) then raise exception 'CONSIGNMENT_HISTORY_REVIEW_REQUIRED';end if;
  -- Reuse a single untouched pending row only if it matches the agreed amount.
  insert into uc_consignment_cases(car_id,customer_id,terms,dealer_basis_points,capital_cents,fixed_cents,revenue_cents,loan_cents,lender_cents,dealer,opened_by)
   values(cid,plan->>'customerId',plan->>'terms',(plan->>'dealerBasisPoints')::integer,(plan->>'capitalCents')::bigint,(plan->>'fixedCents')::bigint,(plan->>'revenueCents')::bigint,(plan->>'loanCents')::bigint,(plan->>'lenderCents')::bigint,plan->'dealer',p_actor);
  -- Fill the known payment links before the case is sealed against changes.
  select * into k from uc_consignment_cases where car_id=cid;
  foreach kind in array array['customer_collection','loan_disbursement','purchase_settlement'] loop
   amount:=case kind when 'customer_collection' then k.revenue_cents-k.loan_cents-coalesce((plan->>'tradeInCents')::bigint,0) when 'loan_disbursement' then k.loan_cents else k.lender_cents end;
   select count(*),min(id) into n,pid from payments where car_id=cid and type=kind;
   if amount=0 then if n>0 then raise exception 'EXISTING_PAYMENT_REVIEW_REQUIRED';end if;continue;end if;
   if n>1 or n=1 and (select uc_commission_cents(to_jsonb(p)->'amount') from payments p where id=pid)<>amount then raise exception 'EXISTING_PAYMENT_REVIEW_REQUIRED';end if;
   if n=0 then
    pid:='consign-'||kind||':'||cid;
    if kind='purchase_settlement' and nullif(trim(to_jsonb(c)->>'settlement_recipient'),'') is null then raise exception 'LENDER_RECIPIENT_REQUIRED';end if;
    insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,description,created_at)
     values(pid,cid,kind,'pending',amount::numeric/100,case when kind='purchase_settlement' then 'merchant' else 'customer' end,case when kind='purchase_settlement' then cid else k.customer_id end,
      case when kind='purchase_settlement' then to_jsonb(c)->>'settlement_recipient' when kind='loan_disbursement' then 'Customer bank loan' else plan->>'customerName' end,'Consignment deal '||kind,now());
   end if;
   -- Initial links are set with a dedicated, transaction-bound case trigger exception.
   if kind='customer_collection' then k.customer_payment_id:=pid;elsif kind='loan_disbursement' then k.loan_payment_id:=pid;else k.lender_payment_id:=pid;end if;
  end loop;
  update uc_consignment_cases set customer_payment_id=k.customer_payment_id,loan_payment_id=k.loan_payment_id,lender_payment_id=k.lender_payment_id where car_id=cid;
  -- Commission amounts are source-derived; creating a bill is not paying it.
  foreach kind in array array['salesman_commission','intake_bonus','source_commission'] loop
   amount:=case kind when 'salesman_commission' then case when coalesce(c.waive_commission,false) or coalesce(c.is_staff_sale,false) then 0 else coalesce(uc_commission_cents(to_jsonb(c)->'sales_commission'),(select uc_commission_cents(to_jsonb(b)->'commission') from customers b where id=k.customer_id),case when coalesce(c.is_recon,false) then 200000 else 100000 end) end when 'intake_bonus' then coalesce(uc_commission_cents(to_jsonb(c)->'intake_commission'),0) else coalesce(uc_commission_cents(to_jsonb(c)->'source_commission'),0) end;
   if amount=0 or exists(select 1 from payments where car_id=cid and type=kind) then continue;end if;
   person:=case when kind='source_commission' then case when c.source_type='external' then c.external_salesman_id else c.source_salesman_id end else coalesce(c.assigned_salesperson,(select assigned_sales_id from customers where id=k.customer_id)) end;
   recipient:=uc_commission_recipient(case when kind='source_commission' and c.source_type='external' then 'external_salesman' else 'user' end,person);
   insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,description,created_at) values('consign-'||kind||':'||cid,cid,kind,'pending',amount::numeric/100,case when kind='source_commission' and c.source_type='external' then 'external_salesman' else 'user' end,person,recipient->>'name','Consignment '||kind,now());
  end loop;
  lines:=jsonb_build_array(jsonb_build_object('accountId','acct-ar','debit',k.revenue_cents::numeric/100,'credit',0),jsonb_build_object('accountId','acct-consign-clearing','debit',0,'credit',k.revenue_cents::numeric/100));
  if k.lender_cents>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-consign-clearing','debit',k.lender_cents::numeric/100,'credit',0),jsonb_build_object('accountId','acct-ap','debit',0,'credit',k.lender_cents::numeric/100));end if;
  -- The customer settled part of the invoice with the trade-in car.
  if coalesce((plan->>'tradeInCents')::bigint,0)>0 then
   lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-trade-in-clearing','debit',(plan->>'tradeInCents')::numeric/100,'credit',0),jsonb_build_object('accountId','acct-ar','debit',0,'credit',(plan->>'tradeInCents')::numeric/100));
   insert into uc_consignment_trade_ins(car_id,incoming_car_id,credit_cents,price_cents,lender_cents,opened_by) values(cid,plan->>'tradeInCarId',(plan->>'tradeInCents')::bigint,(plan->>'tradeInPriceCents')::bigint,(plan->>'tradeInLenderCents')::bigint,p_actor);
  end if;
  jid:='uc:consign-open:'||cid;perform uc_post_journal('consign-open:'||cid,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Consignment deal and lender obligation; no bank movement',cid,p_actor,lines);
  if k.lender_payment_id is not null then insert into uc_consignment_bill_sources values(k.lender_payment_id,cid,jid,k.lender_cents);end if;
  update cars set consignment_finance_open=true,consignment=case when k.terms='profit_split' then jsonb_set(consignment,'{splitPercent}',to_jsonb(k.dealer_basis_points::numeric/100)) else consignment end where id=cid;
 elsif p_action='correct_terms' then
  if k.car_id is null then raise exception 'CONSIGNMENT_CASE_REQUIRED';end if;
  if k.approved_at is not null then raise exception 'CONSIGNMENT_APPROVED_CORRECTION_REQUIRED';end if;
  if (uc_consignment_view(cid)->>'termsRevision') is distinct from p_data->>'expectedRevision' then raise exception 'SOURCE_CHANGED';end if;
  if jsonb_typeof(p_data->'reason') is distinct from 'string' or length(trim(coalesce(p_data->>'reason',''))) not between 5 and 1000 then raise exception 'CORRECTION_REASON_REQUIRED';end if;
  if k.terms='profit_split' then
   if not(p_data?'dealerBasisPoints') or p_data?'fixedAmountCents' then raise exception 'INVALID';end if;
   amount:=(p_data->>'dealerBasisPoints')::bigint;if amount=k.dealer_basis_points then raise exception 'NO_CORRECTION_CHANGE';end if;
  else
   if p_data?'dealerBasisPoints' or jsonb_typeof(p_data->'fixedAmountCents') is distinct from 'number' or coalesce(p_data->>'fixedAmountCents','')!~'^[1-9][0-9]{0,11}$' then raise exception 'INVALID';end if;
   amount:=(p_data->>'fixedAmountCents')::bigint;if amount=k.fixed_cents then raise exception 'NO_CORRECTION_CHANGE';end if;
  end if;
  insert into uc_consignment_corrections(car_id,actor_id,request_id,expected_revision,reason,before_terms,after_terms) values(cid,p_actor,req,p_data->>'expectedRevision',trim(p_data->>'reason'),jsonb_build_object('dealerBasisPoints',k.dealer_basis_points,'fixedAmountCents',k.fixed_cents),jsonb_build_object('dealerBasisPoints',case when k.terms='profit_split' then amount else null end,'fixedAmountCents',case when k.terms='fixed_amount' then amount else k.fixed_cents end));
  update uc_consignment_cases set dealer_basis_points=case when terms='profit_split' then amount::integer else dealer_basis_points end,fixed_cents=case when terms='fixed_amount' then amount else fixed_cents end where car_id=cid;
  update cars set consignment=jsonb_set(consignment,case when k.terms='profit_split' then '{splitPercent}'::text[] else '{fixedAmount}'::text[] end,to_jsonb(amount::numeric/100)) where id=cid;
 elsif p_action='approve' then
  if k.car_id is null then raise exception 'CONSIGNMENT_CASE_REQUIRED';end if;if k.approved_at is not null then raise exception 'CONSIGNMENT_ALREADY_APPROVED';end if;
  if p_data->'costsConfirmed' is distinct from 'true'::jsonb then raise exception 'COST_CONFIRMATION_REQUIRED';end if;
  if not uc_consignment_contract_current(cid) then raise exception 'CONSIGNMENT_CONTRACT_REQUIRED';end if;
  plan:=uc_consignment_cost_plan(cid);if plan->>'sourceRevision' is distinct from p_data->>'expectedRevision' then raise exception 'SOURCE_CHANGED';end if;
  -- Existing dealer payouts need explicit history review; never adopt unchecked beneficiaries.
  select count(*),min(id) into n,pid from payments where car_id=cid and type='consignment_payout';
  if n>0 then raise exception 'EXISTING_PAYMENT_REVIEW_REQUIRED';end if;
  if (plan->>'dealerPayableCents')::bigint>0 and n=0 then pid:='consign-dealer:'||cid;insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,bank_name,account_number,account_holder,description,created_at) values(pid,cid,'consignment_payout','pending',(plan->>'dealerPayableCents')::numeric/100,'dealer',k.dealer->>'id',k.dealer->>'name',k.dealer->>'bankName',k.dealer->>'accountNumber',k.dealer->>'accountHolder','Approved incoming consignment dealer balance',now());end if;
  k.dealer_payment_id:=pid;k.recovery_payment_id:=null;
  if (plan->>'dealerOwesCompanyCents')::bigint>0 then k.recovery_payment_id:='consign-recovery:'||cid;insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,description,created_at) values(k.recovery_payment_id,cid,'consignment_collection','pending',(plan->>'dealerOwesCompanyCents')::numeric/100,'dealer',k.dealer->>'id',k.dealer->>'name','Dealer loss recovery — incoming consignment','now'::timestamptz);end if;
  lines:='[]'::jsonb;
  for item in select value from jsonb_array_elements(plan->'bills') loop
   amount:=(item->>'amountCents')::bigint;lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-consign-clearing','debit',amount::numeric/100,'credit',0));
   if (item->>'hasAccrual')::boolean then for debit in select value from jsonb_array_elements(item->'debitLines') loop lines:=lines||jsonb_build_array(jsonb_build_object('accountId',debit->>'accountId','debit',0,'credit',(debit->>'amountCents')::numeric/100));end loop;
   else lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-ap','debit',0,'credit',amount::numeric/100));end if;
  end loop;
  amount:=(plan->>'dealerPayableCents')::bigint;if amount>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-consign-clearing','debit',amount::numeric/100,'credit',0),jsonb_build_object('accountId','acct-ap','debit',0,'credit',amount::numeric/100));end if;
  amount:=(plan->>'dealerOwesCompanyCents')::bigint;if amount>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-consignor-ar','debit',amount::numeric/100,'credit',0),jsonb_build_object('accountId','acct-consign-clearing','debit',0,'credit',amount::numeric/100));end if;
  amount:=(plan->>'companyResultCents')::bigint;if amount>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-consign-clearing','debit',amount::numeric/100,'credit',0),jsonb_build_object('accountId','acct-rev-consign','debit',0,'credit',amount::numeric/100));elsif amount<0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-exp-consign-loss','debit',-amount::numeric/100,'credit',0),jsonb_build_object('accountId','acct-consign-clearing','debit',0,'credit',-amount::numeric/100));end if;
  jid:='uc:consign-close:'||cid;
  if jsonb_array_length(lines)>0 then perform uc_post_journal('consign-close:'||cid,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Director-approved consignment costs and dealer settlement; no bank movement',cid,p_actor,lines);end if;
  for item in select value from jsonb_array_elements(plan->'bills') loop if not (item->>'hasAccrual')::boolean then insert into uc_consignment_bill_sources values(item->>'paymentId',cid,jid,(item->>'amountCents')::bigint);else for debit in select value from jsonb_array_elements(item->'sourceJournals') loop insert into uc_consignment_bill_sources values(item->>'paymentId',cid,debit#>>'{}',(item->>'amountCents')::bigint) on conflict(payment_id) do nothing;end loop;end if;end loop;
  if k.dealer_payment_id is not null then insert into uc_consignment_bill_sources values(k.dealer_payment_id,cid,jid,(plan->>'dealerPayableCents')::bigint);end if;
  update uc_consignment_cases set approved_at=now(),approved_by=p_actor,settlement=plan,dealer_payment_id=k.dealer_payment_id,recovery_payment_id=k.recovery_payment_id where car_id=cid;
  update cars set consignment_settlement=plan-'bills'-'sourceRevision' where id=cid;
 elsif p_action in ('proof_prepare','proof_confirm','proof_read') then
  if k.car_id is null then raise exception 'CONSIGNMENT_CASE_REQUIRED';end if;
  if p_action='proof_read' then if doc.confirmed_at is null then raise exception 'NOT_ALLOWED';end if;return jsonb_build_object('documentId',doc.id,'path',doc.storage_path);end if;
  if p_action='proof_confirm' then
   select * into doc from uc_consignment_documents where id=doc.id for update;if doc.terms_revision is distinct from uc_consignment_terms_key(cid) then raise exception 'AGREEMENT_TERMS_CHANGED';end if;if doc.confirmed_at is not null then return jsonb_build_object('documentId',doc.id);end if;
   execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into stored using 'finance-evidence',doc.storage_path;if not stored then raise exception 'UPLOAD_MISSING';end if;
   update uc_consignment_documents set confirmed_at=now(),confirmed_by=p_actor where id=doc.id;return jsonb_build_object('documentId',doc.id);
  end if;
  if coalesce(p_data->>'fileName','')='' or length(p_data->>'fileName')>120 or p_data->>'fileName'~'[[:cntrl:]/\\]' or coalesce(p_data->>'mimeType','') not in ('image/png','image/jpeg','application/pdf') or coalesce(p_data->>'sha256','')!~'^[0-9a-f]{64}$' or uc_recovery_cents(p_data->'sizeBytes') not between 1 and 1400000 then raise exception 'INVALID';end if;
  if p_data?'amendmentTerms' then
   if actor.role<>'director' or k.approved_at is null or jsonb_typeof(p_data->'amendmentTerms') is distinct from 'object' then raise exception 'INVALID';end if;
   if k.terms='profit_split' then if (select count(*) from jsonb_object_keys(p_data->'amendmentTerms'))<>1 or jsonb_typeof(p_data->'amendmentTerms'->'dealerBasisPoints') is distinct from 'number' or coalesce(p_data->'amendmentTerms'->>'dealerBasisPoints','')!~'^\d{1,5}$' or (p_data->'amendmentTerms'->>'dealerBasisPoints')::integer>10000 then raise exception 'INVALID';end if;
   else if (select count(*) from jsonb_object_keys(p_data->'amendmentTerms'))<>1 or jsonb_typeof(p_data->'amendmentTerms'->'fixedAmountCents') is distinct from 'number' or coalesce(p_data->'amendmentTerms'->>'fixedAmountCents','')!~'^[1-9][0-9]{0,11}$' then raise exception 'INVALID';end if;end if;
  end if;
  path:='consignment/'||cid||'/'||uc_consignment_terms_key(cid)||'/'||case when p_data?'amendmentTerms' then md5((p_data->'amendmentTerms')::text)||'/' else '' end||(p_data->>'sha256')||case p_data->>'mimeType' when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' else '.png' end;
  insert into uc_consignment_documents(car_id,file_name,mime_type,sha256,size_bytes,storage_path,terms_revision,amendment_terms,created_by) values(cid,p_data->>'fileName',p_data->>'mimeType',p_data->>'sha256',(p_data->>'sizeBytes')::integer,path,uc_consignment_terms_key(cid),p_data->'amendmentTerms',p_actor) on conflict(storage_path) do nothing;
  select * into doc from uc_consignment_documents where storage_path=path;return jsonb_build_object('documentId',doc.id,'path',path,'confirmed',doc.confirmed_at is not null);
 end if;
 insert into uc_consignment_commands(actor_id,request_id,payload,car_id) values(p_actor,req,jsonb_build_object('action',p_action,'data',p_data),cid);
 perform set_config('autodream.consignment_write',coalesce(old_ctx,''),true);
 return uc_consignment_view(cid)||jsonb_build_object('car',(select to_jsonb(v) from cars v where id=cid),'journals',coalesce((select jsonb_agg(to_jsonb(j)) from journal_entries j where id=jid),'[]'::jsonb));
end $$;

-- The consignment receipt step from 20261105080000 (renamed to
-- uc_receipt_before_outgoing by 20261105141201): the money is all received
-- once customer and bank-loan receipts plus the trade-in credit cover the invoice.
create or replace function uc_receipt_before_outgoing(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;cid text;k uc_consignment_cases;old_ctx text;covered bigint;begin
 if p_action<>'record' then return uc_receipt_before_consignments(p_actor,p_action,p_data);end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 select car_id into cid from payments where id=p_data->>'paymentId';select * into k from uc_consignment_cases where car_id=cid;
 if k.car_id is null then return uc_receipt_before_consignments(p_actor,p_action,p_data);end if;
 old_ctx:=current_setting('autodream.consignment_write',true);perform set_config('autodream.consignment_write',txid_current()::text||':'||cid,true);
 r:=uc_receipt_before_consignments(p_actor,p_action,p_data);
 covered:=coalesce(uc_company_paid_cents(k.customer_payment_id),0)+coalesce(uc_company_paid_cents(k.loan_payment_id),0)+coalesce((select credit_cents from uc_consignment_trade_ins where car_id=cid),0);
 update cars set money_received=covered>=k.revenue_cents,disbursement_status=case when covered>=k.revenue_cents then 'disbursed' else 'processing' end where id=cid;
 perform set_config('autodream.consignment_write',coalesce(old_ctx,''),true);
 return r||jsonb_build_object('car',(select to_jsonb(c) from cars c where id=cid));
end $$;

alter function uc_consignment_view(text) rename to uc_consignment_view_before_trade_ins;
create function uc_consignment_view(p_car text) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select uc_consignment_view_before_trade_ins(p_car)||jsonb_build_object('tradeIn',(select jsonb_build_object('incomingCarId',t.incoming_car_id,'creditCents',t.credit_cents,'priceCents',t.price_cents,'lenderCents',t.lender_cents) from uc_consignment_trade_ins t where t.car_id=p_car))
$$;
revoke all on function uc_consignment_open_plan(text,integer),uc_consignment_finance_before_bills(text,text,jsonb),uc_receipt_before_outgoing(text,text,jsonb),uc_consignment_view_before_trade_ins(text),uc_consignment_view(text) from public,anon,authenticated,service_role;
commit;
