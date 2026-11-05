-- PREPARED ONLY. Apply only with the matching private API/UI and full bank chain.
begin;
do $$ begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' or to_regclass('uc_company_car_purchases') is null then raise exception 'COMPANY_PURCHASE_FOUNDATION_REQUIRED';end if;
end $$;
insert into ledger_accounts(id,name,type) values('acct-consign-clearing','Consignment deal clearing','liability'),('acct-consignor-ar','Money owed by consignors','asset'),('acct-rev-consign','Consignment company profit','revenue'),('acct-exp-consign-loss','Fixed-amount consignment loss','expense') on conflict(id) do nothing;
alter table cars add column consignment_finance_open boolean not null default false;
alter table cars add column consignment_settlement jsonb;
create table uc_consignment_cases (
 car_id text primary key references cars(id),customer_id text not null references customers(id),terms text not null check(terms in ('fixed_amount','profit_split')),
 dealer_basis_points integer check(dealer_basis_points between 0 and 10000),capital_cents bigint not null check(capital_cents>0),fixed_cents bigint not null check(fixed_cents>0),
 revenue_cents bigint not null check(revenue_cents>0),loan_cents bigint not null check(loan_cents>=0 and loan_cents<=revenue_cents),lender_cents bigint not null check(lender_cents>=0),dealer jsonb not null,
 customer_payment_id text unique references payments(id) deferrable initially deferred,loan_payment_id text unique references payments(id) deferrable initially deferred,
 lender_payment_id text unique references payments(id) deferrable initially deferred,dealer_payment_id text unique references payments(id) deferrable initially deferred,recovery_payment_id text unique references payments(id) deferrable initially deferred,
 opened_by text not null references garage_building_staff(id),opened_at timestamptz not null default now(),approved_by text references garage_building_staff(id),approved_at timestamptz,settlement jsonb,
 check((terms='profit_split')=(dealer_basis_points is not null)),check((approved_at is null)=(settlement is null))
);
create table uc_consignment_documents (
 id uuid primary key default gen_random_uuid(),car_id text not null references uc_consignment_cases(car_id),file_name text not null,mime_type text not null,sha256 text not null,size_bytes integer not null,
 amendment_terms jsonb,terms_revision text not null,storage_path text not null unique,created_by text not null references garage_building_staff(id),created_at timestamptz not null default now(),confirmed_by text references garage_building_staff(id),confirmed_at timestamptz,
 check(mime_type in ('image/png','image/jpeg','application/pdf')),check(sha256~'^[0-9a-f]{64}$'),check(size_bytes between 1 and 1400000),check(length(file_name) between 1 and 120),check((confirmed_at is null)=(confirmed_by is null))
);
create table uc_consignment_bill_sources(payment_id text primary key references payments(id),car_id text not null references uc_consignment_cases(car_id),source_journal_id text not null references journal_entries(id),amount_cents bigint not null check(amount_cents>0));
create table uc_consignment_corrections(id uuid primary key default gen_random_uuid(),car_id text not null references uc_consignment_cases(car_id),actor_id text not null references garage_building_staff(id),request_id text not null,expected_revision text not null check(expected_revision~'^[0-9a-f]{32}$'),transaction_id bigint not null default txid_current(),reason text not null check(length(reason) between 5 and 1000),before_terms jsonb not null,after_terms jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(actor_id,request_id));
create table uc_consignment_commands(actor_id text not null references garage_building_staff(id),request_id text not null,payload jsonb not null,car_id text not null references uc_consignment_cases(car_id),recorded_at timestamptz not null default now(),primary key(actor_id,request_id));
alter table uc_consignment_corrections add foreign key(actor_id,request_id) references uc_consignment_commands(actor_id,request_id) deferrable initially deferred;
do $$ declare t text;begin foreach t in array array['uc_consignment_cases','uc_consignment_documents','uc_consignment_bill_sources','uc_consignment_commands','uc_consignment_corrections'] loop
 execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 execute format('create trigger %I before truncate on %I execute function uc_investor_immutable()',t||'_no_truncate',t);
end loop;end $$;
create trigger uc_consignment_docs_fixed before update or delete on uc_consignment_documents for each row execute function uc_trade_in_document_guard();
create trigger uc_consignment_sources_fixed before update or delete on uc_consignment_bill_sources for each row execute function uc_investor_immutable();
create trigger uc_consignment_corrections_fixed before update or delete on uc_consignment_corrections for each row execute function uc_investor_immutable();
create trigger uc_consignment_commands_fixed before update or delete on uc_consignment_commands for each row execute function uc_investor_immutable();
create function uc_consignment_case_fixed() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if tg_op='UPDATE' and old.approved_at is null and new.approved_at is null and old.customer_payment_id is null and old.loan_payment_id is null and old.lender_payment_id is null
  and current_setting('autodream.consignment_write',true)=txid_current()::text||':'||old.car_id and to_jsonb(old)-array['customer_payment_id','loan_payment_id','lender_payment_id']=to_jsonb(new)-array['customer_payment_id','loan_payment_id','lender_payment_id'] then return new;end if;
 if tg_op='UPDATE' and old.approved_at is null and new.approved_at is not null and new.approved_by is not null and current_setting('autodream.consignment_write',true)=txid_current()::text||':'||old.car_id and to_jsonb(old)-array['approved_at','approved_by','settlement','dealer_payment_id','recovery_payment_id']=to_jsonb(new)-array['approved_at','approved_by','settlement','dealer_payment_id','recovery_payment_id'] then return new;end if;
 if tg_op='UPDATE' and old.approved_at is null and new.approved_at is null and current_setting('autodream.consignment_write',true)=txid_current()::text||':'||old.car_id and to_jsonb(old)-array['dealer_basis_points','fixed_cents']=to_jsonb(new)-array['dealer_basis_points','fixed_cents'] and (old.terms='profit_split' and new.fixed_cents=old.fixed_cents or old.terms='fixed_amount' and new.dealer_basis_points is not distinct from old.dealer_basis_points) and exists(select 1 from uc_consignment_corrections x where x.car_id=old.car_id and x.transaction_id=txid_current() and x.before_terms=jsonb_build_object('dealerBasisPoints',old.dealer_basis_points,'fixedAmountCents',old.fixed_cents) and x.after_terms=jsonb_build_object('dealerBasisPoints',new.dealer_basis_points,'fixedAmountCents',new.fixed_cents)) then return new;end if;
 raise exception 'IMMUTABLE_HISTORY';end $$;
create trigger uc_consignment_case_fixed before update or delete on uc_consignment_cases for each row execute function uc_consignment_case_fixed();

-- Strict source plan: values are read from saved car/customer records, never
-- supplied as price/cost totals by the browser.
create function uc_consignment_open_plan(p_car text,p_basis integer) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c cars;b jsonb;wo jsonb;price bigint;discount bigint;revenue bigint;loan bigint;loan_contract bigint;booking bigint;capital bigint;fixed bigint;lender bigint;bp integer;party jsonb;terms text;source jsonb;n integer;
begin
 select * into c from cars where id=p_car;
 if c.id is null or c.consignment is null or c.consignment='null'::jsonb or c.outgoing_consignment is not null and c.outgoing_consignment<>'null'::jsonb or c.investor_id is not null or coalesce(c.investor_funded,false) or coalesce(to_jsonb(c)->>'investor_tagged','false')='true' or c.trade_in_source_car_id is not null then raise exception 'INCOMING_CONSIGNMENT_REQUIRED';end if;
 select count(*) into n from customers s where s.interested_car_id=p_car and (s.cash_work_order is not null and s.cash_work_order<>'null'::jsonb or s.loan_work_order is not null and s.loan_work_order<>'null'::jsonb);
 if n<>1 then raise exception 'ONE_DEAL_CUSTOMER_REQUIRED';end if;
 select to_jsonb(s) into b from customers s where s.interested_car_id=p_car and (s.cash_work_order is not null and s.cash_work_order<>'null'::jsonb or s.loan_work_order is not null and s.loan_work_order<>'null'::jsonb);
 wo:=case when b->'loan_work_order' is not null and b->'loan_work_order'<>'null'::jsonb then b->'loan_work_order' else b->'cash_work_order' end;
 if coalesce((wo->>'hasTradeIn')::boolean,false) then raise exception 'CONSIGNMENT_TRADE_IN_REVIEW_REQUIRED';end if;
 price:=uc_commission_cents(wo->'sellingPrice');discount:=coalesce(uc_commission_cents(wo->'discount'),0);
 if coalesce(price,0)<=0 then price:=uc_commission_cents(c.final_deal->'dealPrice');discount:=0;end if;
 if coalesce(price,0)<=0 or discount>=price then raise exception 'AGREED_SALE_REQUIRED';end if;
 select price-discount+coalesce(uc_commission_cents(wo->'insurance'),0)+coalesce(uc_commission_cents(wo->'bankProduct'),0)+coalesce(sum(uc_commission_cents(value->'amount')),0) into revenue from jsonb_array_elements(coalesce(nullif(wo->'additionalItems','null'::jsonb),'[]'::jsonb));
 loan:=case when b->'loan_work_order' is not null and b->'loan_work_order'<>'null'::jsonb then coalesce(uc_commission_cents(wo->'loanAmount'),0) else 0 end;
 if revenue>1000000000000 then raise exception 'LOAN_AMOUNT_REVIEW_REQUIRED';end if;
 loan_contract:=loan;booking:=least(revenue,coalesce(uc_commission_cents(wo->'bookingFee'),0));loan:=least(loan,greatest(0,revenue-booking));
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
 source:=jsonb_build_object('car',to_jsonb(c),'buyer',b,'basis',bp,'dealer',party);
 return jsonb_build_object('carId',p_car,'customerId',b->>'id','customerName',b->>'name','terms',terms,'capitalCents',capital,'fixedCents',fixed,'revenueCents',revenue,'loanCents',loan,'loanContractCents',loan_contract,'lenderCents',lender,'dealerBasisPoints',bp,'dealer',party,'sourceRevision',md5(source::text));
end $$;

create function uc_consignment_cost_plan(p_car text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c cars;k uc_consignment_cases;p payments;r repairs;item jsonb;costs jsonb:='[]';total bigint:=0;expected bigint;actual bigint;kind text;person text;v_source_type text;v_source_id text;credit numeric;debits jsonb;jids jsonb;commission bigint;intake bigint;source_amount bigint;repairs_json jsonb;payments_json jsonb;source jsonb;net bigint;share bigint;loss bigint;gross bigint;balance bigint;company bigint;
begin
 select * into k from uc_consignment_cases where car_id=p_car;select * into c from cars where id=p_car;if k.car_id is null then raise exception 'CONSIGNMENT_CASE_REQUIRED';end if;
 if exists(select 1 from repairs where car_id=p_car and status is distinct from 'done') then raise exception 'UNFINISHED_CAR_BILLS';end if;
 -- Every completed repair and misc item must have a corresponding bill.
 for r in select * from repairs where car_id=p_car and status='done' loop
  expected:=coalesce(uc_commission_cents(to_jsonb(r)->'actual_cost'),uc_commission_cents(to_jsonb(r)->'total_cost'),0);
  select count(*),coalesce(sum(uc_commission_cents(to_jsonb(s)->'amount')),0) into actual,credit from payments s where s.car_id=p_car and s.type in ('repair','expense_claim') and to_jsonb(s)->>'repair_job_id'=r.id;
  if expected>0 and (actual<>1 or credit<>expected) then raise exception 'CAR_BILLS_INCOMPLETE';end if;
 end loop;
 select coalesce(sum(uc_commission_cents(value->'amount')),0) into expected from jsonb_array_elements(coalesce(nullif(c.misc_costs,'null'::jsonb),'[]'::jsonb));
 select expected+coalesce(sum(uc_commission_cents(value->'amount')),0) into expected from jsonb_array_elements(coalesce(nullif(to_jsonb(c)->'disbursement_charges','null'::jsonb),'[]'::jsonb));
 select coalesce(sum(uc_commission_cents(to_jsonb(s)->'amount')),0) into actual from payments s where s.car_id=p_car and (s.type='misc_cost' or s.type='expense_claim' and nullif(to_jsonb(s)->>'misc_cost_id','') is not null);if actual<>expected then raise exception 'CAR_BILLS_INCOMPLETE';end if;
 commission:=case when coalesce(c.waive_commission,false) or coalesce(c.is_staff_sale,false) then 0 else coalesce(uc_commission_cents(to_jsonb(c)->'sales_commission'),(select uc_commission_cents(to_jsonb(b)->'commission') from customers b where id=k.customer_id),case when coalesce(c.is_recon,false) then 200000 else 100000 end) end;
 intake:=coalesce(uc_commission_cents(to_jsonb(c)->'intake_commission'),0);source_amount:=coalesce(uc_commission_cents(to_jsonb(c)->'source_commission'),0);
 foreach kind in array array['salesman_commission','intake_bonus','source_commission','panel_charge'] loop
  expected:=case kind when 'salesman_commission' then commission when 'intake_bonus' then intake when 'source_commission' then source_amount else coalesce(uc_commission_cents(to_jsonb(c)->'panel_charge_amount'),0) end;
  select count(*),coalesce(sum(uc_commission_cents(to_jsonb(s)->'amount')),0) into actual,credit from payments s where s.car_id=p_car and s.type=kind;
  if expected>0 and (actual<>1 or credit<>expected) or expected=0 and actual>0 then raise exception 'CAR_BILLS_INCOMPLETE';end if;
  if expected>0 then
   person:=case kind when 'panel_charge' then to_jsonb(c)->>'panel_dealer_id' when 'source_commission' then case when c.source_type='external' then c.external_salesman_id else c.source_salesman_id end else coalesce(c.assigned_salesperson,(select assigned_sales_id from customers where id=k.customer_id)) end;
   if person is null or not exists(select 1 from payments s where s.car_id=p_car and s.type=kind and s.recipient_id=person and s.recipient_type=case when kind='panel_charge' then 'dealer' when kind='source_commission' and c.source_type='external' then 'external_salesman' else 'user' end) then raise exception 'CAR_BILLS_INCOMPLETE';end if;
  end if;
 end loop;
 for p in select * from payments where car_id=p_car and type in ('repair','misc_cost','salesman_commission','intake_bonus','source_commission','panel_charge','expense_claim') order by id loop
  expected:=uc_commission_cents(to_jsonb(p)->'amount');if coalesce(expected,0)<=0 or p.status not in ('pending','transferred') then raise exception 'CAR_BILLS_INCOMPLETE';end if;
  if p.status='transferred' and uc_company_paid_cents(p.id)<>expected then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
  if p.type='repair' and not exists(select 1 from repairs s where s.id=to_jsonb(p)->>'repair_job_id' and s.car_id=p_car and s.status='done' and expected=coalesce(uc_commission_cents(to_jsonb(s)->'actual_cost'),uc_commission_cents(to_jsonb(s)->'total_cost'),0)) then raise exception 'CAR_BILLS_INCOMPLETE';end if;
  if p.type='expense_claim' and p.claim_confirmed_by is null then raise exception 'CLAIM_NOT_APPROVED';end if;
  if p.type='expense_claim' and nullif(to_jsonb(p)->>'repair_job_id','') is not null and not exists(select 1 from repairs s where s.id=to_jsonb(p)->>'repair_job_id' and s.car_id=p_car and s.status='done' and expected=coalesce(uc_commission_cents(to_jsonb(s)->'actual_cost'),uc_commission_cents(to_jsonb(s)->'total_cost'),0)) then raise exception 'CAR_BILLS_INCOMPLETE';end if;
  if p.type='expense_claim' and nullif(to_jsonb(p)->>'misc_cost_id','') is not null and not exists(select 1 from jsonb_array_elements(coalesce(nullif(c.misc_costs,'null'::jsonb),'[]'::jsonb)) m where m->>'id'=to_jsonb(p)->>'misc_cost_id' and uc_commission_cents(m->'amount')=expected) then raise exception 'CAR_BILLS_INCOMPLETE';end if;
  if uc_company_invoice_type(p.type) and not exists(select 1 from uc_company_payment_documents d where d.payment_id=p.id and d.kind='invoice' and d.state='confirmed') then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
  v_source_type:=case p.type when 'expense_claim' then 'expense_claim_confirmed' else p.type end;v_source_id:=case when p.type in ('salesman_commission','intake_bonus','source_commission') then p_car else p.id end;
  select coalesce(sum(((l->>'credit')::numeric-(l->>'debit')::numeric)*100),0),coalesce(jsonb_agg(distinct to_jsonb(j.id) order by to_jsonb(j.id)),'[]'::jsonb) into credit,jids from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.source_type=v_source_type and j.source_id=v_source_id and not coalesce(j.voided,false) and l->>'accountId'='acct-ap';
  if credit<>0 and credit<>expected then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
  if credit=0 and (p.status<>'pending' or uc_company_paid_cents(p.id)>0) then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
  select coalesce(jsonb_agg(jsonb_build_object('accountId',a.account_id,'amountCents',a.amount_cents) order by a.account_id),'[]'::jsonb) into debits from (
   select l->>'accountId' account_id,sum(((l->>'debit')::numeric-(l->>'credit')::numeric)*100)::bigint amount_cents from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.source_type=v_source_type and j.source_id=v_source_id and not coalesce(j.voided,false) and l->>'accountId'<>'acct-ap' group by l->>'accountId'
  ) a;
  if credit>0 and (select coalesce(sum((value->>'amountCents')::bigint),0) from jsonb_array_elements(debits))<>expected then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
  if exists(select 1 from jsonb_array_elements(debits) l where (l->>'amountCents')::bigint<0 or l->>'accountId' like 'acct-bank%' or l->>'accountId' in ('acct-investor-payable','acct-customer-refunds')) then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
  costs:=costs||jsonb_build_array(jsonb_build_object('paymentId',p.id,'type',p.type,'amountCents',expected,'recipient',p.recipient_name,'sourceJournals',jids,'debitLines',debits,'hasAccrual',credit>0));total:=total+expected;
 end loop;
 if jsonb_array_length(costs)>200 or total>1000000000000 then raise exception 'CAR_BILLS_INCOMPLETE';end if;
 net:=k.revenue_cents-k.capital_cents-total;share:=case when k.terms='profit_split' and net>0 then round(net::numeric*k.dealer_basis_points/10000)::bigint else 0 end;loss:=case when k.terms='profit_split' then greatest(0,-net) else 0 end;
 gross:=case when k.terms='fixed_amount' then k.fixed_cents else k.capital_cents+share-loss end;balance:=gross-k.lender_cents;company:=case when k.terms='fixed_amount' then net+k.capital_cents-k.fixed_cents else greatest(0,net)-share end;
 source:=jsonb_build_object('car',to_jsonb(c),'case',to_jsonb(k),'bills',costs,'payments',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from payments s where s.car_id=p_car),'repairs',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from repairs s where s.car_id=p_car),'proofs',(select coalesce(jsonb_agg(d.id order by d.id),'[]'::jsonb) from uc_company_payment_documents d join payments s on s.id=d.payment_id where s.car_id=p_car and d.state='confirmed'),'contracts',(select coalesce(jsonb_agg(d.id order by d.id),'[]'::jsonb) from uc_consignment_documents d where d.car_id=p_car and d.confirmed_at is not null));
 return jsonb_build_object('contractDocumentIds',source->'contracts','costCents',total,'bills',costs,'netProfitCents',net,'dealerProfitCents',share,'dealerLossCents',loss,'dealerBalanceCents',balance,'dealerPayableCents',greatest(0,balance),'dealerOwesCompanyCents',greatest(0,-balance),'companyResultCents',company,'sourceRevision',md5(source::text));
end $$;

create function uc_consignment_terms_key(p_car text) returns text language sql stable security definer set search_path=public,pg_temp as $$
 select md5(jsonb_build_object('terms',k.terms,'dealerBasisPoints',k.dealer_basis_points,'fixedAmountCents',k.fixed_cents,'correction',(select id from uc_consignment_corrections where car_id=p_car order by created_at desc,id desc limit 1))::text) from uc_consignment_cases k where car_id=p_car
$$;
create function uc_consignment_contract_current(p_car text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from uc_consignment_documents d where d.car_id=p_car and d.confirmed_at is not null and d.terms_revision=uc_consignment_terms_key(p_car))
$$;
create function uc_consignment_view(p_car text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare k uc_consignment_cases;plan jsonb;issue text;begin
 select * into k from uc_consignment_cases where car_id=p_car;
 if k.car_id is null then return jsonb_build_object('carId',p_car,'case',null);end if;
 if k.approved_at is null then begin plan:=uc_consignment_cost_plan(p_car);exception when others then issue:=sqlerrm;end;end if;
 return jsonb_build_object('carId',p_car,'case',to_jsonb(k),'termsRevision',md5((to_jsonb(k)||(select jsonb_build_object('car',to_jsonb(c)) from cars c where c.id=p_car))::text),'agreementReviewRequired',not uc_consignment_contract_current(p_car),'corrections',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('actorName',(select name from garage_building_staff where id=x.actor_id)) order by x.created_at,x.id) from uc_consignment_corrections x where x.car_id=p_car),'[]'::jsonb),'openedByName',(select name from garage_building_staff where id=k.opened_by),'approvedByName',(select name from garage_building_staff where id=k.approved_by),'review',plan,'reviewIssue',issue,'documents',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',file_name,'confirmedAt',confirmed_at,'createdAt',created_at,'amendmentTerms',amendment_terms,'currentTerms',terms_revision=uc_consignment_terms_key(p_car)) order by created_at,id) from uc_consignment_documents where car_id=p_car and confirmed_at is not null),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(p.id)) order by p.created_at,p.id) from payments p where p.car_id=p_car and p.type in ('customer_collection','loan_disbursement','consignment_payout','consignment_collection','supplier_credit_collection','purchase_settlement','repair','misc_cost','panel_charge','salesman_commission','intake_bonus','source_commission','expense_claim','customer_refund')),'[]'::jsonb));
end $$;

create function uc_consignment_finance(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
   amount:=case kind when 'customer_collection' then k.revenue_cents-k.loan_cents when 'loan_disbursement' then k.loan_cents else k.lender_cents end;
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

create function uc_consignment_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare cid text;next_cid text;k uc_consignment_cases;trusted boolean;before_data jsonb;after_data jsonb;key text;
begin
 if tg_op='DELETE' then before_data:=to_jsonb(old);else after_data:=to_jsonb(new);if tg_op='UPDATE' then before_data:=to_jsonb(old);end if;end if;
 cid:=case tg_table_name when 'cars' then coalesce(before_data->>'id',after_data->>'id') when 'customers' then coalesce(before_data->>'interested_car_id',after_data->>'interested_car_id') else coalesce(before_data->>'car_id',after_data->>'car_id') end;
 next_cid:=case tg_table_name when 'cars' then after_data->>'id' when 'customers' then after_data->>'interested_car_id' else after_data->>'car_id' end;
 if tg_table_name='journal_entries' and cid is null then
  select p.car_id into cid from payments p where p.id=coalesce(before_data->>'source_id',after_data->>'source_id') and exists(select 1 from uc_consignment_cases where car_id=p.car_id);
  if cid is null then select car_id into cid from uc_consignment_cases where car_id=coalesce(before_data->>'source_id',after_data->>'source_id');end if;
 end if;
 if not exists(select 1 from uc_consignment_cases where car_id=cid) and (exists(select 1 from uc_consignment_cases where car_id=next_cid) or exists(select 1 from cars c where c.id=next_cid and c.consignment is not null and c.consignment<>'null'::jsonb)) then cid:=next_cid;end if;
 select * into k from uc_consignment_cases where car_id=cid;
 if k.car_id is not null or exists(select 1 from cars c where c.id=cid and c.consignment is not null and c.consignment<>'null'::jsonb) or tg_table_name='cars' and coalesce(after_data->'consignment',before_data->'consignment','null'::jsonb)<>'null'::jsonb then
  perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));select * into k from uc_consignment_cases where car_id=cid;
 end if;
 trusted:=current_setting('autodream.consignment_write',true)=txid_current()::text||':'||coalesce(cid,'');
 if tg_table_name='cars' and k.car_id is null and (coalesce((after_data->>'consignment_finance_open')::boolean,false) or after_data->'consignment_settlement' is not null and after_data->'consignment_settlement'<>'null'::jsonb) then raise exception 'USE_CONSIGNMENT_FINANCE';end if;
 if k.car_id is null then if tg_op='DELETE' then return old;end if;return new;end if;
 if trusted then if tg_op='DELETE' then return old;end if;return new;end if;
 if tg_op='DELETE' then raise exception 'CONSIGNMENT_HISTORY_LOCKED';end if;
 if tg_table_name='cars' then
  if exists(select 1 from unnest(array['consignment','purchase_price','settlement_amount','settlement_recipient','investor_id','investor_split','investor_funded','outgoing_consignment','trade_in_source_car_id','consignment_finance_open','consignment_settlement','money_received','disbursement_status','disbursement_amount','disbursement_expected_amount','disbursement_date']) x where before_data->x is distinct from after_data->x) then raise exception 'USE_CONSIGNMENT_FINANCE';end if;
  if k.approved_at is not null and exists(select 1 from unnest(array['misc_costs','panel_charge_amount','panel_dealer_id','sales_commission','intake_commission','source_commission','waive_commission','is_staff_sale','is_recon','source_type','source_salesman_id','external_salesman_id']) x where before_data->x is distinct from after_data->x) then raise exception 'CONSIGNMENT_COST_CORRECTION_REQUIRED';end if;
 elsif tg_table_name='customers' then
  if tg_op='INSERT' then if after_data->'cash_work_order' is not null and after_data->'cash_work_order'<>'null'::jsonb or after_data->'loan_work_order' is not null and after_data->'loan_work_order'<>'null'::jsonb then raise exception 'ONE_DEAL_CUSTOMER_REQUIRED';end if;return new;end if;
  if before_data->'interested_car_id' is distinct from after_data->'interested_car_id' then raise exception 'CONSIGNMENT_HISTORY_LOCKED';end if;
  foreach key in array array['sellingPrice','discount','bookingFee','insurance','bankProduct','additionalItems','loanAmount','hasTradeIn','tradeInPrice','settlementFigure'] loop
   if before_data->'cash_work_order'->key is distinct from after_data->'cash_work_order'->key or before_data->'loan_work_order'->key is distinct from after_data->'loan_work_order'->key then raise exception 'CONSIGNMENT_HISTORY_LOCKED';end if;
  end loop;
 elsif tg_table_name='payments' then
  if tg_op='UPDATE' and (exists(select 1 from uc_consignment_bill_sources where payment_id=old.id) or old.id in(k.customer_payment_id,k.loan_payment_id,k.recovery_payment_id)) and exists(select 1 from unnest(array['type','amount','car_id','recipient_id','recipient_type','recipient_name']||case when old.id=k.dealer_payment_id then array['bank_name','account_number','account_holder'] else '{}'::text[] end) x where before_data->x is distinct from after_data->x) then raise exception 'CONSIGNMENT_HISTORY_LOCKED';end if;
  if k.approved_at is not null and after_data->>'type' in ('repair','misc_cost','panel_charge','expense_claim','salesman_commission','intake_bonus','source_commission','consignment_payout','purchase_settlement') and (tg_op='INSERT' or exists(select 1 from unnest(array['amount','type','car_id','recipient_id','recipient_type']) x where before_data->x is distinct from after_data->x)) then raise exception 'CONSIGNMENT_COST_CORRECTION_REQUIRED';end if;
 elsif tg_table_name='repairs' and k.approved_at is not null then
  if tg_op='INSERT' or exists(select 1 from unnest(array['actual_cost','total_cost','status','car_id']) x where before_data->x is distinct from after_data->x) then raise exception 'CONSIGNMENT_COST_CORRECTION_REQUIRED';end if;
 elsif tg_table_name='journal_entries' then
  if after_data->>'source_type' like '%\_paid' escape '\' and current_setting('autodream.company_bank_payment',true) is distinct from txid_current()::text||':'||coalesce(after_data->>'source_id','') then raise exception 'USE_CONSIGNMENT_FINANCE';end if;
  if tg_op='UPDATE' or after_data->>'source_type' in ('car_sold','car_purchased','trade_in_acquired','purchase_settlement_recognized','disbursement_received') or k.approved_at is not null and after_data->>'source_type' in ('repair','misc_cost','panel_charge','expense_claim_confirmed','salesman_commission','intake_bonus','source_commission') then raise exception 'USE_CONSIGNMENT_FINANCE';end if;
 end if;
 return new;
end $$;
create trigger uc_consignment_car_guard before insert or update or delete on cars for each row execute function uc_consignment_guard();
create trigger uc_consignment_customer_guard before insert or update or delete on customers for each row execute function uc_consignment_guard();
create trigger uc_consignment_payment_guard before insert or update or delete on payments for each row execute function uc_consignment_guard();
create trigger uc_consignment_repair_guard before insert or update or delete on repairs for each row execute function uc_consignment_guard();
create trigger uc_consignment_journal_guard before insert or update or delete on journal_entries for each row execute function uc_consignment_guard();

-- Accrued dealer payables and unsettled customer money stay reserved. Only
-- real bank receipts and payouts appear in the shared bank register.
alter function uc_company_cash_position() rename to uc_company_position_before_consignments;
create function uc_company_cash_position() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;dealer bigint;panel bigint;held bigint;begin
 r:=uc_company_position_before_consignments();
 select coalesce(sum(greatest(0,uc_commission_cents(to_jsonb(p)->'amount')-uc_company_paid_cents(p.id))),0) into dealer from payments p join uc_consignment_cases k on k.dealer_payment_id=p.id where p.status='pending' and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false);
 select coalesce(sum(greatest(0,uc_commission_cents(to_jsonb(p)->'amount')-uc_company_paid_cents(p.id))),0) into panel from payments p join uc_consignment_cases k on k.car_id=p.car_id where p.status='pending' and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false) and p.type='panel_charge';
 select coalesce(sum(greatest(0,
  coalesce((select sum(amount_cents) from uc_company_bank_receipts where car_id=k.car_id),0)
  -coalesce((select sum(a.amount_cents) from uc_company_bank_allocations a join payments p on p.id=a.payment_id where p.car_id=k.car_id),0)
  -coalesce((select sum(greatest(0,uc_commission_cents(to_jsonb(p)->'amount')-uc_company_paid_cents(p.id))) from payments p where p.car_id=k.car_id and p.status='pending' and not coalesce((to_jsonb(p)->>'obligation_replaced')::boolean,false) and p.type in ('repair','misc_cost','panel_charge','salesman_commission','intake_bonus','source_commission','purchase_settlement','expense_claim','customer_refund') and (p.type<>'expense_claim' or p.claim_confirmed_by is not null)),0)
 )),0) into held from uc_consignment_cases k where k.approved_at is null;
 return r||jsonb_build_object('consignmentHeldCents',held,'customerHeldCents',coalesce((r->>'customerHeldCents')::bigint,0)+held,'unpaidCompanyCents',(r->>'unpaidCompanyCents')::bigint+dealer+panel,'availableCents',(r->>'availableCents')::bigint-dealer-panel-held);
end $$;
alter function uc_company_bank_receipt(text,text,jsonb) rename to uc_receipt_before_consignments;
create function uc_company_bank_receipt(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;cid text;k uc_consignment_cases;old_ctx text;covered bigint;begin
 if p_action<>'record' then return uc_receipt_before_consignments(p_actor,p_action,p_data);end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 select car_id into cid from payments where id=p_data->>'paymentId';select * into k from uc_consignment_cases where car_id=cid;
 if k.car_id is null then return uc_receipt_before_consignments(p_actor,p_action,p_data);end if;
 old_ctx:=current_setting('autodream.consignment_write',true);perform set_config('autodream.consignment_write',txid_current()::text||':'||cid,true);
 r:=uc_receipt_before_consignments(p_actor,p_action,p_data);
 covered:=coalesce(uc_company_paid_cents(k.customer_payment_id),0)+coalesce(uc_company_paid_cents(k.loan_payment_id),0);
 update cars set money_received=covered>=k.revenue_cents,disbursement_status=case when covered>=k.revenue_cents then 'disbursed' else 'processing' end where id=cid;
 perform set_config('autodream.consignment_write',coalesce(old_ctx,''),true);
 return r||jsonb_build_object('car',(select to_jsonb(c) from cars c where id=cid));
end $$;
create or replace function uc_company_invoice_type(p_type text) returns boolean language sql immutable set search_path=public,pg_temp as $$ select coalesce(p_type in ('repair','misc_cost','expense_claim','panel_charge','purchase_settlement','consignment_payout'),false) $$;
revoke all on function uc_consignment_terms_key(text),uc_consignment_contract_current(text),uc_consignment_case_fixed(),uc_consignment_open_plan(text,integer),uc_consignment_cost_plan(text),uc_consignment_view(text),uc_consignment_finance(text,text,jsonb),uc_consignment_guard(),uc_company_position_before_consignments(),uc_company_cash_position(),uc_receipt_before_consignments(text,text,jsonb),uc_company_bank_receipt(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_consignment_finance(text,text,jsonb),uc_company_bank_receipt(text,text,jsonb) to service_role;
commit;
