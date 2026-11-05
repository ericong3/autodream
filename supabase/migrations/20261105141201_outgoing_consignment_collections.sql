-- PREPARED ONLY. Actual outgoing dealer receipts, pending separate cost review.
-- Approval creates a receivable against a named review clearing account, never
-- a bank movement or final profit. Missing old purchase records remain visible.
begin;
create table uc_outgoing_sales(
 car_id text primary key references cars(id),payment_id text not null unique references payments(id) deferrable initially deferred,
 recorded_by text not null references garage_building_staff(id),recorded_at timestamptz not null default now(),request_id text not null,payload jsonb not null,
 before_car jsonb not null,after_car jsonb not null,transaction_id bigint not null default txid_current(),unique(recorded_by,request_id)
);
alter table uc_outgoing_sales enable row level security;
revoke all on uc_outgoing_sales from public,anon,authenticated,service_role;
create trigger uc_outgoing_sales_fixed before update or delete on uc_outgoing_sales for each row execute function uc_investor_immutable();
create trigger uc_outgoing_sales_no_truncate before truncate on uc_outgoing_sales execute function uc_investor_immutable();
create or replace function uc_company_outgoing_change_allowed(p_car text,p_before jsonb,p_after jsonb) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from uc_outgoing_sales where car_id=p_car and transaction_id=txid_current() and before_car=p_before and after_car=p_after)$$;
create function uc_outgoing_send(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;c cars;party dealers;s uc_outgoing_sales;amount bigint;day date;revision text;patch jsonb;after_row jsonb;req text;pid text;begin
 select * into actor from garage_building_staff where id=p_actor for share;if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_action not in ('prepare_send','send') or jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k<>all(case when p_action='prepare_send' then array['carId','dealer','amountCents','soldOn'] else array['carId','dealer','amountCents','soldOn','expectedRevision','requestId'] end)) then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 if p_action='send' then req:=p_data->>'requestId';if coalesce(req,'')!~'^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;select * into s from uc_outgoing_sales where recorded_by=p_actor and request_id=req;if found then if s.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return jsonb_build_object('carId',s.car_id,'paymentId',s.payment_id,'approved',false,'car',(select to_jsonb(x) from cars x where id=s.car_id),'payments',(select jsonb_agg(to_jsonb(p)) from payments p where id=s.payment_id),'journals','[]'::jsonb);end if;end if;
 select * into c from cars where id=p_data->>'carId' for update;
 if c.id is null or coalesce(c.status,'') not in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') or c.investor_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true' or exists(select 1 from uc_investor_cars where car_id=c.id) or c.consignment is not null and c.consignment<>'null'::jsonb then raise exception 'OUTGOING_CAR_NOT_ELIGIBLE';end if;
 if c.final_deal is not null and c.final_deal<>'null'::jsonb and (c.outgoing_consignment is null or c.outgoing_consignment='null'::jsonb) or exists(select 1 from uc_outgoing_sales where car_id=c.id) or exists(select 1 from payments where car_id=c.id and type in ('consignment_collection','customer_collection','loan_disbursement')) or exists(select 1 from uc_company_bank_receipts where car_id=c.id) or exists(select 1 from customers where interested_car_id=c.id and (cash_work_order is not null and cash_work_order<>'null'::jsonb or loan_work_order is not null and loan_work_order<>'null'::jsonb)) then raise exception 'OUTGOING_SOURCE_REVIEW_REQUIRED';end if;
 if (select count(*) from dealers where id=p_data->>'dealer' or lower(name)=lower(p_data->>'dealer'))<>1 then raise exception 'DEALER_PROFILE_REVIEW_REQUIRED';end if;
 select * into party from dealers where id=p_data->>'dealer' or lower(name)=lower(p_data->>'dealer');
 amount:=uc_recovery_cents(p_data->'amountCents');day:=(p_data->>'soldOn')::date;if amount<=0 or day is null or day>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'INVALID';end if;
 revision:=md5(jsonb_build_object('car',to_jsonb(c),'dealer',to_jsonb(party),'amount',amount,'day',day)::text);
 if p_action='prepare_send' then return jsonb_build_object('carId',c.id,'sourceRevision',revision,'dealer',party.name,'amountCents',amount);end if;
 if revision is distinct from p_data->>'expectedRevision' then raise exception 'SOURCE_CHANGED';end if;
 patch:=jsonb_build_object('outgoing_consignment',jsonb_build_object('dealer',party.name,'terms','fixed_amount','fixedAmount',amount::numeric/100),'status','delivered','delivery_collected',true,'final_deal',jsonb_build_object('submittedBy',actor.name,'submittedAt',day::text||'T12:00:00+08:00','dealPrice',amount::numeric/100,'bank','Consignment — '||party.name,'approvalStatus','approved'));
 after_row:=to_jsonb(jsonb_populate_record(c,patch));pid:='outgoing-dealer:'||c.id;
 insert into uc_outgoing_sales values(c.id,pid,p_actor,now(),req,p_data,to_jsonb(c),after_row,txid_current());
 update cars set outgoing_consignment=patch->'outgoing_consignment',status='delivered',delivery_collected=true,final_deal=patch->'final_deal' where id=c.id;
 insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,description,created_at) values(pid,c.id,'consignment_collection','pending',amount::numeric/100,'dealer',party.id,party.name,'Fixed dealer collection; statement review required',now());
 return jsonb_build_object('carId',c.id,'paymentId',pid,'approved',false,'car',(select to_jsonb(x) from cars x where id=c.id),'payments',(select jsonb_agg(to_jsonb(p)) from payments p where id=pid),'journals','[]'::jsonb);
end $$;
alter function uc_consignment_payment_allowed(text) rename to uc_payment_allowed_before_outgoing;
create function uc_consignment_payment_allowed(p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select uc_payment_allowed_before_outgoing(p_payment) or exists(select 1 from payments p join uc_outgoing_sales s on s.car_id=p.car_id where p.id=p_payment and p.type='purchase_settlement' and (exists(select 1 from uc_company_car_purchases a where a.car_id=p.car_id and p.id in (a.seller_payment_id,a.lender_payment_id)) or exists(select 1 from uc_company_trade_in_applications a where a.incoming_car_id=p.car_id and a.lender_payment_id=p.id)))
$$;
revoke all on function uc_company_outgoing_change_allowed(text,jsonb,jsonb),uc_outgoing_send(text,text,jsonb),uc_payment_allowed_before_outgoing(text),uc_consignment_payment_allowed(text) from public,anon,authenticated,service_role;
grant execute on function uc_outgoing_send(text,text,jsonb) to service_role;
create or replace function uc_outgoing_invoice_allowed(p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from payments p join cars c on c.id=p.car_id where p.id=p_payment and p.type='consignment_collection' and c.outgoing_consignment is not null and c.outgoing_consignment<>'null'::jsonb)$$;
revoke all on function uc_outgoing_invoice_allowed(text) from public,anon,authenticated,service_role;
insert into ledger_accounts(id,name,type) values('acct-outgoing-sale-review','Outgoing sales waiting for cost review','liability') on conflict(id) do nothing;
create table uc_outgoing_collections(
 payment_id text primary key references payments(id),car_id text not null unique references cars(id),
 amount_cents bigint not null check(amount_cents>0),approved_by text not null references garage_building_staff(id),approved_at timestamptz not null default now(),
 request_id text not null,payload jsonb not null,source_car jsonb not null,source_payment jsonb not null,
 statement_document_id uuid not null references uc_company_payment_documents(id),source_journal_id text not null unique references journal_entries(id) deferrable initially deferred,unique(approved_by,request_id)
);
alter table uc_outgoing_collections enable row level security;
revoke all on uc_outgoing_collections from public,anon,authenticated,service_role;
create trigger uc_outgoing_collections_fixed before update or delete on uc_outgoing_collections for each row execute function uc_investor_immutable();
create trigger uc_outgoing_collections_no_truncate before truncate on uc_outgoing_collections execute function uc_investor_immutable();
create or replace function uc_outgoing_receipt_allowed(p_car text,p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from uc_outgoing_collections where car_id=p_car and payment_id=p_payment)$$;
alter function uc_consignment_receipt_allowed(text,text) rename to uc_incoming_receipt_allowed;
create function uc_consignment_receipt_allowed(p_car text,p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select uc_incoming_receipt_allowed(p_car,p_payment) or uc_outgoing_receipt_allowed(p_car,p_payment)$$;
create function uc_outgoing_collection(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;p payments;c cars;a uc_outgoing_collections;party jsonb;revision text;amount bigint;req text;jid text;begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_action not in ('review','approve') or jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k<>all(case when p_action='review' then array['paymentId'] else array['paymentId','expectedRevision','requestId','reviewConfirmed'] end)) then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 if p_action='approve' then
  req:=p_data->>'requestId';if coalesce(req,'')!~'^[A-Za-z0-9_-]{16,80}$' or p_data->'reviewConfirmed' is distinct from 'true'::jsonb then raise exception 'INVALID';end if;
  select * into a from uc_outgoing_collections where approved_by=p_actor and request_id=req;
  if found then if a.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;
   return jsonb_build_object('paymentId',a.payment_id,'approved',true,'costReviewPending',true,'payments',(select jsonb_agg(to_jsonb(s)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(s.id))) from payments s where id=a.payment_id),'journals',(select jsonb_agg(to_jsonb(j)) from journal_entries j where id=a.source_journal_id));end if;
 end if;
 select * into p from payments where id=p_data->>'paymentId' for update;
 if p.id is null or p.type<>'consignment_collection' then raise exception 'OUTGOING_COLLECTION_REQUIRED';end if;
 select * into a from uc_outgoing_collections where payment_id=p.id;
 if found then return jsonb_build_object('paymentId',p.id,'approved',true,'costReviewPending',true,'payments',jsonb_build_array(to_jsonb(p)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(p.id))),'journals','[]'::jsonb);end if;
 select * into c from cars where id=p.car_id for update;
 if c.id is null or c.status<>'delivered' or c.outgoing_consignment is null or c.outgoing_consignment='null'::jsonb or c.consignment is not null and c.consignment<>'null'::jsonb or c.investor_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true' or exists(select 1 from uc_investor_cars where car_id=c.id) then raise exception 'OUTGOING_COLLECTION_REQUIRED';end if;
 if c.outgoing_consignment->>'terms' is distinct from 'fixed_amount' then raise exception 'OUTGOING_TERMS_REVIEW_REQUIRED';end if;
 amount:=uc_commission_cents(c.outgoing_consignment->'fixedAmount');
 if coalesce(amount,0)<=0 or amount<>uc_commission_cents(to_jsonb(p)->'amount') or p.status<>'pending' or uc_company_paid_cents(p.id)>0 or p.recipient_type<>'dealer' or (select count(*) from payments where car_id=c.id and type='consignment_collection')<>1 then raise exception 'OUTGOING_SOURCE_REVIEW_REQUIRED';end if;
 if (select count(*) from dealers d where d.id=c.outgoing_consignment->>'dealer' or lower(d.name)=lower(c.outgoing_consignment->>'dealer'))<>1 then raise exception 'DEALER_PROFILE_REVIEW_REQUIRED';end if;
 select to_jsonb(d) into party from dealers d where d.id=c.outgoing_consignment->>'dealer' or lower(d.name)=lower(c.outgoing_consignment->>'dealer');
 if p.recipient_id is distinct from party->>'id' and p.recipient_id is distinct from c.outgoing_consignment->>'dealer' then raise exception 'OUTGOING_SOURCE_REVIEW_REQUIRED';end if;
 if exists(select 1 from journal_entries j where j.car_id=c.id and not coalesce(j.voided,false) and (j.source_type in ('car_sold','consignment_collection_received') or exists(select 1 from jsonb_array_elements(j.lines) l where l->>'accountId' in ('acct-consignor-ar','acct-outgoing-sale-review')))) then raise exception 'COLLECTION_HISTORY_REVIEW_REQUIRED';end if;
 revision:=md5(jsonb_build_object('payment',to_jsonb(p),'car',to_jsonb(c),'dealer',party,'documents',(select jsonb_agg(to_jsonb(d) order by id) from uc_company_payment_documents d where payment_id=p.id and state='confirmed'))::text);
 if p_action='review' then return jsonb_build_object('paymentId',p.id,'approved',false,'name',party->>'name','amountCents',amount,'sourceRevision',revision,'invoiceReady',exists(select 1 from uc_company_payment_documents where payment_id=p.id and kind='invoice' and state='confirmed'),'costReviewPending',true);end if;
 if revision is distinct from p_data->>'expectedRevision' then raise exception 'SOURCE_CHANGED';end if;
 if not exists(select 1 from uc_company_payment_documents where payment_id=p.id and kind='invoice' and state='confirmed') then raise exception 'DEALER_STATEMENT_REQUIRED';end if;
 jid:='uc:outgoing-collection:'||p.id;
 insert into uc_outgoing_collections values(p.id,c.id,amount,p_actor,now(),req,p_data,to_jsonb(c),to_jsonb(p),(select id from uc_company_payment_documents where payment_id=p.id and kind='invoice' and state='confirmed' order by confirmed_at,id limit 1),jid);
 perform uc_post_journal('outgoing-collection:'||p.id,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Dealer receivable; profit awaits car cost review',c.id,p_actor,jsonb_build_array(jsonb_build_object('accountId','acct-consignor-ar','debit',amount::numeric/100,'credit',0),jsonb_build_object('accountId','acct-outgoing-sale-review','debit',0,'credit',amount::numeric/100)));
 return jsonb_build_object('paymentId',p.id,'approved',true,'costReviewPending',true,'payments',jsonb_build_array(to_jsonb(p)||jsonb_build_object('bank_paid_cents',0)),'journals',(select jsonb_agg(to_jsonb(j)) from journal_entries j where id=jid));
end $$;
create table uc_outgoing_cost_reviews(
 payment_id text primary key references uc_outgoing_collections(payment_id),car_id text not null unique references cars(id),
 reviewed_by text not null references garage_building_staff(id),reviewed_at timestamptz not null default now(),request_id text not null,payload jsonb not null,
 purchase_invoice_id uuid not null references uc_company_payment_documents(id),plan jsonb not null,source_journal_id text not null unique references journal_entries(id) deferrable initially deferred,
 transaction_id bigint not null default txid_current(),unique(reviewed_by,request_id)
);
alter table uc_outgoing_cost_reviews enable row level security;
revoke all on uc_outgoing_cost_reviews from public,anon,authenticated,service_role;
create trigger uc_outgoing_cost_reviews_fixed before update or delete on uc_outgoing_cost_reviews for each row execute function uc_investor_immutable();
create trigger uc_outgoing_cost_reviews_no_truncate before truncate on uc_outgoing_cost_reviews execute function uc_investor_immutable();
create function uc_outgoing_close_allowed(p_journal text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from uc_outgoing_cost_reviews where source_journal_id=p_journal and transaction_id=txid_current())$$;
create function uc_outgoing_cost_plan(p_payment text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a uc_outgoing_collections;c cars;r repairs;p payments;item jsonb;stock bigint;purchase bigint;car_cost bigint:=0;expected bigint;actual bigint;n integer;gap bigint;expenses bigint;source jsonb;begin
 select * into a from uc_outgoing_collections where payment_id=p_payment;select * into c from cars where id=a.car_id;
 if a.payment_id is null then raise exception 'OUTGOING_COLLECTION_REQUIRED';end if;
 if exists(select 1 from repairs where car_id=c.id and status is distinct from 'done') then raise exception 'UNFINISHED_CAR_BILLS';end if;
 purchase:=uc_commission_cents(to_jsonb(c)->'purchase_price');if coalesce(purchase,0)<=0 then raise exception 'PURCHASE_COST_REVIEW_REQUIRED';end if;
 for r in select * from repairs where car_id=c.id loop
  expected:=coalesce(uc_commission_cents(to_jsonb(r)->'actual_cost'),uc_commission_cents(to_jsonb(r)->'total_cost'),0);if expected<0 then raise exception 'CAR_BILLS_INCOMPLETE';end if;
  select count(*),coalesce(sum(uc_commission_cents(to_jsonb(s)->'amount')),0) into n,actual from payments s where s.car_id=c.id and s.type in ('repair','expense_claim') and to_jsonb(s)->>'repair_job_id'=r.id;
  if expected>0 and (n<>1 or actual<>expected) then raise exception 'CAR_BILLS_INCOMPLETE';end if;car_cost:=car_cost+expected;
 end loop;
 select coalesce(sum(uc_commission_cents(value->'amount')),0) into expected from jsonb_array_elements(coalesce(nullif(c.misc_costs,'null'::jsonb),'[]'::jsonb));
 select coalesce(sum(uc_commission_cents(to_jsonb(s)->'amount')),0) into actual from payments s where s.car_id=c.id and (s.type='misc_cost' or s.type='expense_claim' and nullif(to_jsonb(s)->>'misc_cost_id','') is not null);
 if expected<>actual then raise exception 'CAR_BILLS_INCOMPLETE';end if;car_cost:=car_cost+expected;
 foreach item in array array[jsonb_build_object('type','intake_bonus','value',to_jsonb(c)->'intake_commission'),jsonb_build_object('type','source_commission','value',to_jsonb(c)->'source_commission'),jsonb_build_object('type','panel_charge','value',to_jsonb(c)->'panel_charge_amount')] loop
  expected:=coalesce(uc_commission_cents(item->'value'),0);select count(*),coalesce(sum(uc_commission_cents(to_jsonb(s)->'amount')),0) into n,actual from payments s where s.car_id=c.id and s.type=item->>'type';if expected<>actual or expected>0 and n<>1 or expected=0 and n<>0 then raise exception 'CAR_BILLS_INCOMPLETE';end if;
 end loop;
 for p in select * from payments where car_id=c.id and type in ('repair','misc_cost','expense_claim','salesman_commission','intake_bonus','source_commission','panel_charge') loop
  expected:=uc_commission_cents(to_jsonb(p)->'amount');if coalesce(expected,0)<=0 or p.obligation_replaced or p.type='expense_claim' and p.claim_confirmed_by is null then raise exception 'CAR_BILLS_INCOMPLETE';end if;
  if uc_company_invoice_type(p.type) and not exists(select 1 from uc_company_payment_documents where payment_id=p.id and kind='invoice' and state='confirmed') then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
  select coalesce(sum(((l->>'credit')::numeric-(l->>'debit')::numeric)*100),0) into actual from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where not coalesce(j.voided,false) and l->>'accountId'='acct-ap' and (j.source_id=p.id and j.source_type in (p.type,'expense_claim_confirmed') or j.source_id=c.id and j.source_type=p.type and p.type in ('salesman_commission','intake_bonus','source_commission'));
  if actual<>expected then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
 end loop;
 select coalesce(sum(((l->>'debit')::numeric-(l->>'credit')::numeric)*100),0) into stock from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.car_id=c.id and not coalesce(j.voided,false) and l->>'accountId'='acct-inv-own';
 gap:=purchase+car_cost-stock;
 if gap<>0 and (gap<>purchase or exists(select 1 from journal_entries where car_id=c.id and source_type in ('car_purchased','trade_in_acquired','company_car_purchase') and not coalesce(voided,false))) then raise exception 'PURCHASE_COST_REVIEW_REQUIRED';end if;
 select coalesce(sum(((l->>'debit')::numeric-(l->>'credit')::numeric)*100),0) into expenses from journal_entries j cross join lateral jsonb_array_elements(j.lines) l join ledger_accounts la on la.id=l->>'accountId' where j.car_id=c.id and not coalesce(j.voided,false) and la.type in ('expense','cogs');
 if expenses<0 or exists(select 1 from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.car_id=c.id and not coalesce(j.voided,false) and l->>'accountId'='acct-cogs-own') then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
 source:=jsonb_build_object('car',to_jsonb(c),'repairs',(select jsonb_agg(to_jsonb(s) order by id) from repairs s where car_id=c.id),'payments',(select jsonb_agg(to_jsonb(s) order by id) from payments s where car_id=c.id),'journals',(select jsonb_agg(to_jsonb(j) order by id) from journal_entries j where car_id=c.id),'documents',(select jsonb_agg(to_jsonb(d) order by d.id) from uc_company_payment_documents d join payments s on s.id=d.payment_id where s.car_id=c.id));
 return jsonb_build_object('paymentId',p_payment,'approved',true,'costReviewPending',true,'purchaseCents',purchase,'carCostCents',car_cost,'stockCents',stock,'missingPurchaseCents',gap,'otherExpenseCents',expenses,'netProfitCents',a.amount_cents-purchase-car_cost-expenses,'sourceRevision',md5(source::text),'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',file_name) order by confirmed_at,id) from uc_company_payment_documents where payment_id=p_payment and kind='invoice' and state='confirmed'),'[]'::jsonb));
end $$;
alter function uc_outgoing_collection(text,text,jsonb) rename to uc_outgoing_collection_before_costs;
create function uc_outgoing_collection(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;r jsonb;a uc_outgoing_collections;closed uc_outgoing_cost_reviews;plan jsonb;req text;gap bigint;cost bigint;jid text;lines jsonb;begin
 if p_action not in ('review_costs','close_costs') then r:=uc_outgoing_collection_before_costs(p_actor,p_action,p_data);return r||jsonb_build_object('costReviewPending',not exists(select 1 from uc_outgoing_cost_reviews where payment_id=p_data->>'paymentId'));end if;
 select * into actor from garage_building_staff where id=p_actor for share;if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k<>all(case when p_action='review_costs' then array['paymentId'] else array['paymentId','expectedRevision','requestId','purchaseInvoiceId','reviewConfirmed','missingPurchaseAcknowledged'] end)) then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 if p_action='close_costs' then req:=p_data->>'requestId';if coalesce(req,'')!~'^[A-Za-z0-9_-]{16,80}$' or p_data->'reviewConfirmed' is distinct from 'true'::jsonb then raise exception 'INVALID';end if;select * into closed from uc_outgoing_cost_reviews where reviewed_by=p_actor and request_id=req;if found then if closed.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return jsonb_build_object('paymentId',closed.payment_id,'approved',true,'costReviewPending',false,'payments','[]'::jsonb,'journals',(select jsonb_agg(to_jsonb(j)) from journal_entries j where id=closed.source_journal_id));end if;end if;
 select * into a from uc_outgoing_collections where payment_id=p_data->>'paymentId';if a.payment_id is null then raise exception 'OUTGOING_COLLECTION_REQUIRED';end if;
 perform 1 from cars where id=a.car_id for update;perform 1 from payments where car_id=a.car_id order by id for update;perform 1 from repairs where car_id=a.car_id order by id for update;
 select * into closed from uc_outgoing_cost_reviews where payment_id=a.payment_id;if found then return jsonb_build_object('paymentId',a.payment_id,'approved',true,'costReviewPending',false,'plan',closed.plan,'payments','[]'::jsonb,'journals','[]'::jsonb);end if;
 plan:=uc_outgoing_cost_plan(a.payment_id);if p_action='review_costs' then return plan;end if;
 if plan->>'sourceRevision' is distinct from p_data->>'expectedRevision' then raise exception 'SOURCE_CHANGED';end if;
 if not exists(select 1 from uc_company_payment_documents where id=(p_data->>'purchaseInvoiceId')::uuid and payment_id=a.payment_id and kind='invoice' and state='confirmed') then raise exception 'PURCHASE_INVOICE_REQUIRED';end if;
 gap:=(plan->>'missingPurchaseCents')::bigint;if gap>0 and p_data->'missingPurchaseAcknowledged' is distinct from 'true'::jsonb then raise exception 'PURCHASE_HISTORY_ACKNOWLEDGEMENT_REQUIRED';end if;
 cost:=(plan->>'purchaseCents')::bigint+(plan->>'carCostCents')::bigint;jid:='uc:outgoing-close:'||a.payment_id;
 insert into uc_outgoing_cost_reviews values(a.payment_id,a.car_id,p_actor,now(),req,p_data,(p_data->>'purchaseInvoiceId')::uuid,plan,jid,txid_current());
 lines:=jsonb_build_array(jsonb_build_object('accountId','acct-outgoing-sale-review','debit',a.amount_cents::numeric/100,'credit',0),jsonb_build_object('accountId','acct-rev-car-sales','debit',0,'credit',a.amount_cents::numeric/100),jsonb_build_object('accountId','acct-cogs-own','debit',cost::numeric/100,'credit',0),jsonb_build_object('accountId','acct-inv-own','debit',0,'credit',cost::numeric/100));
 if gap>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-inv-own','debit',gap::numeric/100,'credit',0),jsonb_build_object('accountId','acct-opening-review','debit',0,'credit',gap::numeric/100));end if;
 perform uc_post_journal('outgoing-close:'||a.payment_id,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Reviewed outgoing sale and car costs; missing historic purchase remains in opening review, no bank movement',a.car_id,p_actor,lines);
 return jsonb_build_object('paymentId',a.payment_id,'approved',true,'costReviewPending',false,'plan',plan,'payments','[]'::jsonb,'journals',(select jsonb_agg(to_jsonb(j)) from journal_entries j where id=jid));
end $$;
create function uc_outgoing_collection_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare a uc_outgoing_collections;begin
 if tg_table_name='payments' then
  select * into a from uc_outgoing_collections where payment_id=old.id;
  if a.payment_id is not null and (tg_op='DELETE' or exists(select 1 from unnest(array['amount','type','car_id','recipient_id','recipient_type','recipient_name']) k where to_jsonb(old)->k is distinct from to_jsonb(new)->k)) then raise exception 'OUTGOING_HISTORY_LOCKED';end if;
 elsif tg_table_name='cars' then
  if uc_company_outgoing_change_allowed(old.id,to_jsonb(old),to_jsonb(new)) then return new;end if;
  if exists(select 1 from unnest(array['outgoing_consignment','investor_id','investor_split','investor_funded','investor_tagged','consignment','status','final_deal','delivery_collected']) k where to_jsonb(old)->k is distinct from to_jsonb(new)->k) and (exists(select 1 from uc_outgoing_collections where car_id=old.id) or exists(select 1 from uc_outgoing_sales where car_id=old.id)) then raise exception 'OUTGOING_HISTORY_LOCKED';end if;
 else
  if tg_op<>'INSERT' and exists(select 1 from uc_outgoing_collections where source_journal_id=old.id) then raise exception 'OUTGOING_HISTORY_LOCKED';end if;
  if tg_op='INSERT' and not uc_outgoing_close_allowed(new.id) and exists(select 1 from uc_outgoing_collections where car_id=new.car_id and source_journal_id<>new.id) and exists(select 1 from jsonb_array_elements(new.lines) l where l->>'accountId'='acct-outgoing-sale-review') then raise exception 'OUTGOING_HISTORY_LOCKED';end if;
 end if;if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger uc_outgoing_payment_fixed before update or delete on payments for each row execute function uc_outgoing_collection_guard();
create trigger uc_outgoing_terms_fixed before update on cars for each row execute function uc_outgoing_collection_guard();
create function uc_outgoing_customer_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and (old.interested_car_id,old.cash_work_order,old.loan_work_order) is not distinct from (new.interested_car_id,new.cash_work_order,new.loan_work_order) then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 if ((new.cash_work_order is not null and new.cash_work_order<>'null'::jsonb) or (new.loan_work_order is not null and new.loan_work_order<>'null'::jsonb)) and exists(select 1 from cars c where c.id=new.interested_car_id and (c.status='delivered' and c.outgoing_consignment is not null and c.outgoing_consignment<>'null'::jsonb or exists(select 1 from uc_outgoing_sales where car_id=c.id) or exists(select 1 from uc_outgoing_collections where car_id=c.id))) then raise exception 'OUTGOING_CUSTOMER_REVIEW_REQUIRED: This car was sold through a dealer. Review its dealer account before changing the deal.';end if;
 if tg_op='UPDATE' and ((old.cash_work_order is not null and old.cash_work_order<>'null'::jsonb) or (old.loan_work_order is not null and old.loan_work_order<>'null'::jsonb)) and (exists(select 1 from uc_outgoing_sales where car_id=old.interested_car_id) or exists(select 1 from uc_outgoing_collections where car_id=old.interested_car_id)) then raise exception 'OUTGOING_CUSTOMER_REVIEW_REQUIRED: This car was sold through a dealer. Review its dealer account before changing the deal.';end if;
 return new;
end $$;
create trigger uc_outgoing_customer_fixed before insert or update on customers for each row execute function uc_outgoing_customer_guard();
revoke all on function uc_outgoing_customer_guard() from public,anon,authenticated,service_role;
create trigger uc_outgoing_journal_fixed before insert or update or delete on journal_entries for each row execute function uc_outgoing_collection_guard();
create function uc_outgoing_closed_cost_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare cid text;financial boolean;begin
 if tg_table_name='cars' then
  cid:=old.id;financial:=exists(select 1 from unnest(array['purchase_price','misc_costs','disbursement_charges','sales_commission','intake_commission','source_commission','panel_charge_amount','panel_dealer_id','waive_commission','is_staff_sale']) k where to_jsonb(old)->k is distinct from to_jsonb(new)->k);
 elsif tg_table_name in ('repairs','payments') then
  cid:=case when tg_op='INSERT' then new.car_id else old.car_id end;
  if tg_table_name='repairs' then financial:=tg_op<>'UPDATE' or exists(select 1 from unnest(array['id','car_id','actual_cost','total_cost','status','parts','labour_cost']) k where to_jsonb(old)->k is distinct from to_jsonb(new)->k);
  else financial:=((case when tg_op='INSERT' then new.type else old.type end) in ('repair','misc_cost','expense_claim','salesman_commission','intake_bonus','source_commission','panel_charge') or tg_op='UPDATE' and new.type in ('repair','misc_cost','expense_claim','salesman_commission','intake_bonus','source_commission','panel_charge')) and (tg_op<>'UPDATE' or exists(select 1 from unnest(array['id','type','amount','car_id','repair_job_id','misc_cost_id','recipient_id','recipient_type','claim_confirmed_by']) k where to_jsonb(old)->k is distinct from to_jsonb(new)->k));end if;
  if tg_op='UPDATE' and new.car_id is distinct from old.car_id and exists(select 1 from uc_outgoing_cost_reviews where car_id=new.car_id) then raise exception 'OUTGOING_COST_ADJUSTMENT_REQUIRED';end if;
 else
  cid:=case when tg_op='INSERT' then new.car_id else old.car_id end;
  if tg_op='INSERT' and uc_outgoing_close_allowed(new.id) then return new;end if;
  if tg_op<>'INSERT' and exists(select 1 from uc_outgoing_cost_reviews where source_journal_id=old.id) then raise exception 'OUTGOING_HISTORY_LOCKED';end if;
  if tg_op='UPDATE' and new.car_id is distinct from old.car_id and exists(select 1 from uc_outgoing_cost_reviews where car_id=new.car_id) then raise exception 'OUTGOING_COST_ADJUSTMENT_REQUIRED';end if;
  financial:=exists(select 1 from jsonb_array_elements(case when tg_op='INSERT' then new.lines when tg_op='DELETE' then old.lines else old.lines||new.lines end) l left join ledger_accounts a on a.id=l->>'accountId' where a.type in ('expense','cogs','revenue') or l->>'accountId' in ('acct-inv-own','acct-outgoing-sale-review'));
 end if;
 if financial and exists(select 1 from uc_outgoing_cost_reviews where car_id=cid) then raise exception 'OUTGOING_COST_ADJUSTMENT_REQUIRED';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger uc_outgoing_closed_car_costs before update on cars for each row execute function uc_outgoing_closed_cost_guard();
create trigger uc_outgoing_closed_repair_costs before insert or update or delete on repairs for each row execute function uc_outgoing_closed_cost_guard();
create trigger uc_outgoing_closed_payment_costs before insert or update or delete on payments for each row execute function uc_outgoing_closed_cost_guard();
create trigger uc_outgoing_closed_journal_costs before insert or update or delete on journal_entries for each row execute function uc_outgoing_closed_cost_guard();
revoke all on function uc_outgoing_closed_cost_guard() from public,anon,authenticated,service_role;
revoke all on function uc_outgoing_receipt_allowed(text,text),uc_incoming_receipt_allowed(text,text),uc_consignment_receipt_allowed(text,text),uc_outgoing_collection(text,text,jsonb),uc_outgoing_collection_before_costs(text,text,jsonb),uc_outgoing_cost_plan(text),uc_outgoing_close_allowed(text),uc_outgoing_collection_guard() from public,anon,authenticated,service_role;
grant execute on function uc_outgoing_collection(text,text,jsonb) to service_role;
alter function uc_company_bank_receipt(text,text,jsonb) rename to uc_receipt_before_outgoing;
create function uc_company_bank_receipt(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;a uc_outgoing_collections;begin
 result:=uc_receipt_before_outgoing(p_actor,p_action,p_data);
 if p_action='record' then select * into a from uc_outgoing_collections where payment_id=p_data->>'paymentId';if found then
  update cars set money_received=uc_company_paid_cents(a.payment_id)>=a.amount_cents where id=a.car_id;
  result:=result||jsonb_build_object('car',(select to_jsonb(c) from cars c where id=a.car_id));
 end if;end if;return result;
end $$;
revoke all on function uc_receipt_before_outgoing(text,text,jsonb),uc_company_bank_receipt(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_company_bank_receipt(text,text,jsonb) to service_role;
commit;
