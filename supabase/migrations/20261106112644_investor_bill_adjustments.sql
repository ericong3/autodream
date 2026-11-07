-- PREPARED ONLY. Preserve paid bills and settlements; adjust their entitlement.
begin;
create table uc_investor_bill_adjustments(
 id uuid primary key default gen_random_uuid(),bill_id uuid not null references uc_investor_car_bills(id),car_id text not null references uc_investor_cars(car_id),
 sequence bigint generated always as identity unique,before_cents bigint not null check(before_cents>=0),after_cents bigint not null check(after_cents between 0 and 1000000000000),
 invoice_document_id uuid not null unique references uc_investor_documents(id),reason text not null check(length(trim(reason)) between 5 and 1000),
 before_settlement jsonb,after_settlement jsonb,actor_id text not null references garage_building_staff(id),created_at timestamptz not null default now(),
 request_id text not null,payload jsonb not null,result jsonb,unique(actor_id,request_id)
);
create table uc_investor_supplier_refunds(
 id uuid primary key default gen_random_uuid(),bill_id uuid not null references uc_investor_car_bills(id),car_id text not null references uc_investor_cars(car_id),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),receipt_document_id uuid not null unique references uc_investor_documents(id),
 cash_entry_id uuid not null unique references uc_investor_cash_entries(id) deferrable initially deferred,actor_id text not null references garage_building_staff(id),
 created_at timestamptz not null default now(),request_id text not null,payload jsonb not null,unique(actor_id,request_id)
);
revoke all on sequence uc_investor_bill_adjustments_sequence_seq from public,anon,authenticated,service_role;
create table uc_investor_profit_transfers(
 id uuid primary key default gen_random_uuid(),car_id text not null references uc_investor_car_settlements(car_id),pot_id uuid not null references uc_investor_pots(id),
 amount_cents bigint not null check(amount_cents<>0),actor_id text not null references garage_building_staff(id),created_at timestamptz not null default now(),
 request_id text not null,payload jsonb not null,unique(actor_id,request_id)
);
do $$ declare t text;begin foreach t in array array['uc_investor_bill_adjustments','uc_investor_supplier_refunds','uc_investor_profit_transfers'] loop
 execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 execute format('create trigger %I before update or delete on %I for each row execute function uc_investor_immutable()',t||'_fixed',t);
 execute format('create trigger %I before truncate on %I execute function uc_investor_immutable()',t||'_no_truncate',t);
end loop;end $$;
insert into ledger_accounts(id,name,type,investor_tagged) values('acct-investor-supplier-credit','Investor supplier refunds due','asset',true) on conflict(id) do nothing;
create function uc_investor_supplier_account_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
if exists(select 1 from jsonb_array_elements(new.lines) l where l->>'accountId'='acct-investor-supplier-credit') and not coalesce(new.source_type='investor_finance' and current_setting('autodream.uc_posting',true)='on',false) then raise exception 'USE_INVESTOR_POSTING';end if;return new;end $$;
create trigger uc_investor_supplier_account_private before insert or update on journal_entries for each row execute function uc_investor_supplier_account_guard();
create function uc_investor_bill_total(p_bill uuid) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select after_cents from uc_investor_bill_adjustments where bill_id=b.id order by sequence desc limit 1),b.amount_cents) from uc_investor_car_bills b where b.id=p_bill $$;
create function uc_investor_bill_balance(p_bill uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('totalCents',uc_investor_bill_total(b.id),'paidCents',v.cash+uc_bill_withheld(b.id),'cashPaidCents',v.cash,'withheldCents',uc_bill_withheld(b.id),'returnedCents',v.refunds,
 'payableCents',greatest(0,uc_investor_bill_total(b.id)-v.cash-uc_bill_withheld(b.id)+v.refunds),'receivableCents',greatest(0,v.cash+uc_bill_withheld(b.id)-v.refunds-uc_investor_bill_total(b.id)))
 from uc_investor_car_bills b cross join lateral(select coalesce(-sum(amount_cents) filter(where kind='car_expense'),0)::bigint cash,coalesce(sum(amount_cents) filter(where kind='car_expense_refund'),0)::bigint refunds from uc_investor_cash_entries where bill_id=b.id) v where b.id=p_bill $$;
create function uc_investor_adjusted_settlement(p_car text) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select to_jsonb(s)||jsonb_build_object('cost_cents',v.cost,'profit_cents',v.profit,'investor_result_cents',v.profit-v.company,'company_profit_cents',v.company)
 from uc_investor_car_settlements s cross join lateral(select coalesce(sum(uc_investor_bill_total(b.id)),0)::bigint cost from uc_investor_car_bills b where b.car_id=s.car_id and b.state='approved') k
 cross join lateral(select k.cost,s.sale_cents-s.purchase_cents-k.cost profit,case when s.sale_cents-s.purchase_cents-k.cost>0 then s.sale_cents-s.purchase_cents-k.cost-round((s.sale_cents-s.purchase_cents-k.cost)::numeric*s.investor_basis_points/10000)::bigint else 0 end company) v where s.car_id=p_car $$;
create function uc_investor_profit_due(p_car text) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select s.company_profit_cents-(uc_investor_adjusted_settlement(p_car)->>'company_profit_cents')::bigint-coalesce((select sum(amount_cents) from uc_investor_profit_transfers where car_id=p_car),0)::bigint from uc_investor_car_settlements s where s.car_id=p_car $$;
create function uc_investor_bill_document_floor(p_bill uuid) returns timestamptz language sql stable security definer set search_path=public,pg_temp as $$
select greatest(b.reviewed_at,
 (select min(confirmed_at) from uc_investor_documents where bill_id=b.id and kind='bill' and state='confirmed'),
 (select max(created_at) from uc_investor_bill_adjustments where bill_id=b.id),
 (select max(recorded_at) from uc_investor_cash_entries where bill_id=b.id),
 (select max(o.posted_at) from uc_sale_withheld_bills w join uc_sale_money_orders o on o.id=w.order_id where w.bill_id=b.id and o.state='posted')) from uc_investor_car_bills b where b.id=p_bill $$;
alter function uc_investor_car_summary(text) rename to uc_car_summary_before_bill_adjustments;
create function uc_investor_car_summary(p_car text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;delta bigint;unpaid_delta bigint;refund_due bigint;begin
 r:=uc_car_summary_before_bill_adjustments(p_car);if r is null then return null;end if;
 select coalesce(sum(uc_investor_bill_total(b.id)-b.amount_cents),0),coalesce(sum((uc_investor_bill_balance(b.id)->>'payableCents')::bigint-(b.amount_cents-coalesce(v.paid,0)-uc_bill_withheld(b.id))),0),coalesce(sum((uc_investor_bill_balance(b.id)->>'receivableCents')::bigint),0)
 into delta,unpaid_delta,refund_due from uc_investor_car_bills b left join lateral(select -sum(amount_cents) paid from uc_investor_cash_entries where bill_id=b.id and kind='car_expense') v on true where b.car_id=p_car and b.state='approved';
 return r||jsonb_build_object('costCents',(r->>'costCents')::bigint+delta,'unpaidBillCents',(r->>'unpaidBillCents')::bigint+unpaid_delta,
 'profitCents',case when r->>'profitCents' is not null then (r->>'profitCents')::bigint-delta end,'supplierRefundOwingCents',refund_due,
 'originalSettlement',r->'settlement','settlement',coalesce(uc_investor_adjusted_settlement(p_car),r->'settlement'),'companyOwesInvestorCents',greatest(0,coalesce(uc_investor_profit_due(p_car),0)),'heldCompanyProfitAdjustmentCents',greatest(0,-coalesce(uc_investor_profit_due(p_car),0)));
end $$;
alter function uc_investor_position(uuid) rename to uc_position_before_bill_adjustments;
create function uc_investor_position(p_pot uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;delta bigint;transfers bigint;held bigint;owed bigint;begin
 r:=uc_position_before_bill_adjustments(p_pot);
 select coalesce(sum((uc_investor_bill_balance(b.id)->>'payableCents')::bigint-(b.amount_cents-coalesce(v.paid,0)-uc_bill_withheld(b.id))),0) into delta from uc_investor_car_bills b join uc_investor_cars c on c.car_id=b.car_id left join lateral(select -sum(amount_cents) paid from uc_investor_cash_entries where bill_id=b.id and kind='car_expense') v on true where c.pot_id=p_pot and b.state='approved';
 select coalesce(sum(amount_cents),0) into transfers from uc_investor_profit_transfers where pot_id=p_pot;
 select coalesce(sum(greatest(0,-uc_investor_profit_due(car_id))),0),coalesce(sum(greatest(0,uc_investor_profit_due(car_id))),0) into held,owed from uc_investor_cars where pot_id=p_pot and settled_at is not null;
 return r||jsonb_build_object('cashCents',(r->>'cashCents')::bigint+transfers,'billReservedCents',(r->>'billReservedCents')::bigint+delta,'reservedCents',(r->>'reservedCents')::bigint+delta+held,'availableCents',(r->>'availableCents')::bigint+transfers-delta-held,'companyOwesInvestorCents',owed,'heldCompanyProfitAdjustmentCents',held);
end $$;
alter function uc_company_cash_position() rename to uc_company_position_before_bill_adjustments;
create function uc_company_cash_position() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r jsonb;owed bigint;begin r:=uc_company_position_before_bill_adjustments();select coalesce(sum(greatest(0,uc_investor_profit_due(car_id))),0) into owed from uc_investor_car_settlements;
return r||jsonb_build_object('companyOwesInvestorCents',owed,'availableCents',(r->>'availableCents')::bigint-owed);end $$;

-- Only this additional kind represents physical money. Profit transfers above
-- are ownership records, so never create bank movements or cash-entry rows.
do $$ declare e text;begin select pg_get_expr(conbin,conrelid) into e from pg_constraint where conrelid='uc_investor_cash_entries'::regclass and conname='uc_cash_kind';alter table uc_investor_cash_entries drop constraint uc_cash_kind;
execute 'alter table uc_investor_cash_entries add constraint uc_cash_kind check (('||e||') or(kind=''car_expense_refund'' and amount_cents>0 and car_id is not null and bill_id is not null and withdrawal_id is null and customer_refund_id is null and trade_in_lender_payment_id is null))';end $$;
drop trigger uc_cash_to_journal on uc_investor_cash_entries;
create trigger uc_cash_to_journal after insert on uc_investor_cash_entries for each row when(new.kind not in('customer_refund_out','trade_in_lender_out','car_expense_refund')) execute function uc_investor_post_event();
create function uc_investor_supplier_refund_cash() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare r uc_investor_supplier_refunds;d uc_investor_documents;c uc_investor_cars;begin
select * into r from uc_investor_supplier_refunds where cash_entry_id=new.id;select * into c from uc_investor_cars where car_id=new.car_id;select * into d from uc_investor_documents where id=r.receipt_document_id;
if r.id is null or r.car_id<>new.car_id or r.bill_id<>new.bill_id or c.pot_id<>new.pot_id or r.amount_cents<>new.amount_cents or d.bill_id<>new.bill_id or d.kind<>'receipt' or d.state<>'confirmed' or current_setting('autodream.uc_supplier_refund',true) is distinct from txid_current()::text||':'||r.id::text then raise exception 'SUPPLIER_REFUND_PROOF_REQUIRED';end if;
insert into ledger_accounts(id,name,type,investor_tagged) values('acct-bank-uc-'||md5(new.bank_account),'Bank account '||right(new.bank_account,8),'asset',null) on conflict(id) do nothing;
perform uc_post_journal(new.id::text,new.paid_on,'Investor supplier refund received',new.car_id,new.recorded_by,jsonb_build_array(jsonb_build_object('accountId','acct-bank-uc-'||md5(new.bank_account),'debit',new.amount_cents::numeric/100,'credit',0),jsonb_build_object('accountId','acct-investor-supplier-credit','debit',0,'credit',new.amount_cents::numeric/100)));
return new;end $$;
create trigger uc_supplier_refund_cash_journal after insert on uc_investor_cash_entries for each row when(new.kind='car_expense_refund') execute function uc_investor_supplier_refund_cash();
create function uc_investor_bill_adjustment_plan(p_car text,p_bill uuid,p_data jsonb) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare b uc_investor_car_bills;c uc_investor_cars;d uc_investor_documents;balance jsonb;total bigint;after_ap bigint;after_ar bigint;cost bigint;profit bigint;company bigint;settlement jsonb;revision text;begin
select * into b from uc_investor_car_bills where id=p_bill and car_id=p_car;select * into c from uc_investor_cars where car_id=p_car;
if b.id is null or b.state<>'approved' then raise exception 'APPROVED_BILL_REQUIRED';end if;
if b.category='commission' or exists(select 1 from uc_investor_staff_claims where bill_id=b.id) then raise exception 'DIRECT_SUPPLIER_BILL_REQUIRED';end if;
total:=uc_recovery_cents(p_data->'amountCents');balance:=uc_investor_bill_balance(b.id);if total=(balance->>'totalCents')::bigint then raise exception 'AMOUNT_UNCHANGED';end if;
if jsonb_typeof(p_data->'reason') is distinct from 'string' or length(trim(p_data->>'reason')) not between 5 and 1000 or p_data->>'reason'~'[[:cntrl:]]' then raise exception 'REASON_REQUIRED';end if;
select * into d from uc_investor_documents where id=(p_data->>'invoiceDocumentId')::uuid and bill_id=b.id and car_id=p_car and kind='bill' and state='confirmed';
if d.id is null or exists(select 1 from uc_investor_bill_adjustments where invoice_document_id=d.id) or d.created_at<=uc_investor_bill_document_floor(b.id) then raise exception 'NEW_CREDIT_NOTE_REQUIRED';end if;
after_ap:=greatest(0,total-(balance->>'paidCents')::bigint+(balance->>'returnedCents')::bigint);after_ar:=greatest(0,(balance->>'paidCents')::bigint-(balance->>'returnedCents')::bigint-total);
settlement:=uc_investor_adjusted_settlement(p_car);
if settlement is not null then
 cost:=(settlement->>'cost_cents')::bigint+total-(balance->>'totalCents')::bigint;profit:=(settlement->>'sale_cents')::bigint-(settlement->>'purchase_cents')::bigint-cost;
 company:=case when profit>0 then profit-round(profit::numeric*(settlement->>'investor_basis_points')::integer/10000)::bigint else 0 end;
 settlement:=settlement||jsonb_build_object('cost_cents',cost,'profit_cents',profit,'investor_result_cents',profit-company,'company_profit_cents',company);
end if;
revision:=md5(jsonb_build_object('bill',to_jsonb(b),'car',to_jsonb(c),'balance',balance,'invoice',to_jsonb(d),'data',p_data-'expectedRevision'-'requestId','settlement',uc_investor_adjusted_settlement(p_car),'adjustments',(select coalesce(jsonb_agg(to_jsonb(a) order by sequence),'[]') from uc_investor_bill_adjustments a where car_id=p_car),'transfers',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at,id),'[]') from uc_investor_profit_transfers t where car_id=p_car))::text);
return jsonb_build_object('carId',p_car,'billId',p_bill,'sourceRevision',revision,'beforeTotalCents',balance->'totalCents','afterTotalCents',total,'payableCents',after_ap,'receivableCents',after_ar,'beforePayableCents',balance->'payableCents','beforeReceivableCents',balance->'receivableCents','beforeSettlement',uc_investor_adjusted_settlement(p_car),'afterSettlement',settlement);
end $$;
create function uc_investor_bill_adjustment_history(p_bill uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'beforeTotalCents',x.before_cents,'afterTotalCents',x.after_cents,'reason',x.reason,'actorName',s.name,'createdAt',x.created_at,'documentId',x.invoice_document_id) order by x.sequence desc),'[]') from uc_investor_bill_adjustments x join garage_building_staff s on s.id=x.actor_id where x.bill_id=p_bill $$;
create function uc_investor_bill_adjustment_snapshot(p_actor text,p_car text,p_bill uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a garage_building_staff;c uc_investor_cars;b uc_investor_car_bills;due bigint;transferable bigint;begin
select * into a from garage_building_staff where id=p_actor;select * into c from uc_investor_cars where car_id=p_car;select * into b from uc_investor_car_bills where id=p_bill and car_id=p_car;
if a.id is null or c.car_id is null or b.id is null or not coalesce(a.enabled and a.registration_status='active' and a.business_access in('used_car','both') and (a.role='director' or a.role='investor' and exists(select 1 from uc_investor_pots p join uc_investor_profiles f on f.id=p.profile_id where p.id=c.pot_id and f.linked_staff_id=p_actor)),false) then raise exception 'NOT_ALLOWED';end if;
due:=coalesce(uc_investor_profit_due(p_car),0);transferable:=case when a.role<>'director' then 0 when due>0 then least(due,greatest(0,(uc_company_cash_position()->>'availableCents')::bigint+due)) when due<0 and not exists(select 1 from uc_investor_car_bills where car_id=p_car and (uc_investor_bill_balance(id)->>'receivableCents')::bigint>0) then least(-due,greatest(0,(uc_investor_position(c.pot_id)->>'availableCents')::bigint-due)) else 0 end;
return uc_investor_bill_balance(b.id)||jsonb_build_object('carId',p_car,'billId',b.id,'eligible',b.state='approved' and b.category<>'commission' and not exists(select 1 from uc_investor_staff_claims where bill_id=b.id),
 'invoices',coalesce((select jsonb_agg(jsonb_build_object('documentId',d.id,'name',d.file_name) order by d.created_at,d.id) from uc_investor_documents d where d.bill_id=b.id and d.kind='bill' and d.state='confirmed' and d.created_at>uc_investor_bill_document_floor(b.id) and not exists(select 1 from uc_investor_bill_adjustments where invoice_document_id=d.id)),'[]'),
 'history',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'beforeCents',x.before_cents,'afterCents',x.after_cents,'reason',x.reason,'actorName',s.name,'createdAt',x.created_at,'documentId',x.invoice_document_id) order by x.sequence desc) from uc_investor_bill_adjustments x join garage_building_staff s on s.id=x.actor_id where x.bill_id=b.id),'[]'),
 'refundOwingCents',uc_investor_bill_balance(b.id)->'receivableCents','transferDueCents',due,'transferableCents',transferable,'adjustments',uc_investor_bill_adjustment_history(b.id),
 'receipts',coalesce((select jsonb_agg(jsonb_build_object('documentId',d.id,'name',d.file_name) order by d.created_at,d.id) from uc_investor_documents d where d.bill_id=b.id and d.kind='receipt' and d.state='confirmed' and d.created_at>(select max(created_at) from uc_investor_bill_adjustments where bill_id=b.id) and not exists(select 1 from uc_investor_payment_receipts where document_id=d.id) and not exists(select 1 from uc_investor_supplier_refunds where receipt_document_id=d.id)),'[]'),
 'refunds',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'amountCents',f.amount_cents,'documentId',f.receipt_document_id,'actorName',s.name,'recordedAt',f.created_at) order by f.created_at,f.id) from uc_investor_supplier_refunds f join garage_building_staff s on s.id=f.actor_id where f.bill_id=b.id),'[]'),
 'companyOwesInvestorCents',greatest(0,coalesce(uc_investor_profit_due(p_car),0)),'heldCompanyProfitAdjustmentCents',greatest(0,-coalesce(uc_investor_profit_due(p_car),0)),'position',uc_investor_position(c.pot_id));
end $$;
create function uc_investor_bill_adjustment(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a garage_building_staff;c uc_investor_cars;b uc_investor_car_bills;prior uc_investor_commands;d uc_investor_documents;adj uc_investor_bill_adjustments;ref uc_investor_supplier_refunds;tr uc_investor_profit_transfers;
req text;payload jsonb;plan jsonb;balance jsonb;r jsonb;lines jsonb:='[]';delta bigint;ap bigint;ar bigint;ir bigint;cp bigint;amount bigint;due bigint;available bigint;entry uuid;day date;bank text;allowed text[];begin
select * into a from garage_building_staff where id=p_actor for share;
if a.id is null or not coalesce(a.enabled and a.registration_status='active' and a.business_access in('used_car','both') and (a.role='director' or a.role='investor' and p_action='snapshot'),false) then raise exception 'NOT_ALLOWED';end if;
if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
allowed:=case p_action when 'snapshot' then array['carId','billId'] when 'preview' then array['carId','billId','amountCents','invoiceDocumentId','reason'] when 'apply' then array['carId','billId','amountCents','invoiceDocumentId','reason','expectedRevision','requestId'] when 'pay' then array['carId','billId','amountCents','bankAccount','bankReference','paidOn','receiptDocumentId','requestId'] when 'refund' then array['carId','billId','amountCents','bankAccount','bankReference','paidOn','receiptDocumentId','requestId'] when 'apply_profit_transfer' then array['carId','billId','amountCents','requestId'] end;
if allowed is null or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'INVALID';end if;
if p_action='snapshot' then return uc_investor_bill_adjustment_snapshot(p_actor,p_data->>'carId',(p_data->>'billId')::uuid);end if;
if p_action='preview' then return jsonb_build_object('preview',uc_investor_bill_adjustment_plan(p_data->>'carId',(p_data->>'billId')::uuid,p_data));end if;
req:=p_data->>'requestId';payload:=jsonb_build_object('action',p_action,'data',p_data);if coalesce(req,'')!~'^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;if found then if prior.payload is distinct from payload then raise exception 'REQUEST_CHANGED';end if;return prior.result;end if;
select * into c from uc_investor_cars where car_id=p_data->>'carId';if c.car_id is null then raise exception 'NOT_ALLOWED';end if;perform 1 from uc_investor_pots where id=c.pot_id for update;select * into c from uc_investor_cars where car_id=c.car_id for update;
select * into b from uc_investor_car_bills where id=(p_data->>'billId')::uuid and car_id=c.car_id for update;if b.id is null then raise exception 'NOT_ALLOWED';end if;
if p_action='apply' then
 plan:=uc_investor_bill_adjustment_plan(c.car_id,b.id,p_data);if p_data->>'expectedRevision' is distinct from plan->>'sourceRevision' then raise exception 'SOURCE_CHANGED';end if;
 insert into uc_investor_bill_adjustments(bill_id,car_id,before_cents,after_cents,invoice_document_id,reason,before_settlement,after_settlement,actor_id,request_id,payload) values(b.id,c.car_id,(plan->>'beforeTotalCents')::bigint,(plan->>'afterTotalCents')::bigint,(p_data->>'invoiceDocumentId')::uuid,trim(p_data->>'reason'),plan->'beforeSettlement',plan->'afterSettlement',p_actor,req,payload) returning * into adj;
 delta:=adj.after_cents-adj.before_cents;ap:=(plan->>'payableCents')::bigint-(plan->>'beforePayableCents')::bigint;ar:=(plan->>'receivableCents')::bigint-(plan->>'beforeReceivableCents')::bigint;
 if c.settled_at is null then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-inv-investor','debit',greatest(0,delta)::numeric/100,'credit',greatest(0,-delta)::numeric/100));else
 ir:=(plan->'afterSettlement'->>'investor_result_cents')::bigint-(plan->'beforeSettlement'->>'investor_result_cents')::bigint;cp:=(plan->'afterSettlement'->>'company_profit_cents')::bigint-(plan->'beforeSettlement'->>'company_profit_cents')::bigint;
 if ir<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-investor-payable','debit',greatest(0,-ir)::numeric/100,'credit',greatest(0,ir)::numeric/100));end if;
 if cp<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-rev-investor-share','debit',greatest(0,-cp)::numeric/100,'credit',greatest(0,cp)::numeric/100));end if;end if;
 if ap<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-ap','debit',greatest(0,-ap)::numeric/100,'credit',greatest(0,ap)::numeric/100));end if;
 if ar<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-investor-supplier-credit','debit',greatest(0,ar)::numeric/100,'credit',greatest(0,-ar)::numeric/100));end if;
 perform uc_post_journal('bill-adjustment:'||adj.id::text,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Investor supplier bill corrected',c.car_id,p_actor,lines);
elsif p_action in('pay','refund') then
 balance:=uc_investor_bill_balance(b.id);amount:=uc_recovery_cents(p_data->'amountCents');if b.state<>'approved' then raise exception 'APPROVED_BILL_REQUIRED';end if;
 if amount<=0 or amount>(balance->>case when p_action='pay' then 'payableCents' else 'receivableCents' end)::bigint then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
 select * into d from uc_investor_documents where id=(p_data->>'receiptDocumentId')::uuid for update;
 if d.id is null or d.bill_id<>b.id or d.kind<>'receipt' or d.state<>'confirmed' or exists(select 1 from uc_investor_payment_receipts where document_id=d.id) or exists(select 1 from uc_investor_supplier_refunds where receipt_document_id=d.id) then raise exception 'SUPPLIER_REFUND_PROOF_REQUIRED';end if;
 if p_action='refund' and (not exists(select 1 from uc_investor_bill_adjustments where bill_id=b.id) or d.created_at<=(select max(created_at) from uc_investor_bill_adjustments where bill_id=b.id)) then raise exception 'SUPPLIER_REFUND_PROOF_REQUIRED';end if;
 bank:=p_data->>'bankAccount';if bank!~'^bank:[0-9a-f-]{36}$' or length(trim(coalesce(p_data->>'bankReference',''))) not between 1 and 200 or coalesce(p_data->>'paidOn','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID';end if;day:=(p_data->>'paidOn')::date;
 if day>(now() at time zone 'Asia/Kuala_Lumpur')::date or day<(b.reviewed_at at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'INVALID_PAYMENT_DATE';end if;
 if p_action='refund' and day<(select (max(created_at) at time zone 'Asia/Kuala_Lumpur')::date from uc_investor_bill_adjustments where bill_id=b.id) then raise exception 'INVALID_PAYMENT_DATE';end if;
 entry:=gen_random_uuid();if p_action='refund' then
 insert into uc_investor_supplier_refunds(bill_id,car_id,amount_cents,receipt_document_id,cash_entry_id,actor_id,request_id,payload) values(b.id,c.car_id,amount,d.id,entry,p_actor,req,payload) returning * into ref;
 perform set_config('autodream.uc_supplier_refund',txid_current()::text||':'||ref.id::text,true);
 insert into uc_investor_cash_entries(id,pot_id,kind,amount_cents,car_id,bill_id,bank_account,bank_reference,paid_on,recorded_by) values(entry,c.pot_id,'car_expense_refund',amount,c.car_id,b.id,bank,trim(p_data->>'bankReference'),day,p_actor);
 else
 if (uc_registered_bank_position(substr(bank,6)::uuid))<amount or (uc_investor_position(c.pot_id)->>'availableCents')::bigint<0 then raise exception 'INSUFFICIENT_FUNDS';end if;
 perform set_config('autodream.uc_payment_receipt','on:'||txid_current()::text||':'||b.id::text,true);
 insert into uc_investor_cash_entries(id,pot_id,kind,amount_cents,car_id,bill_id,bank_account,bank_reference,paid_on,recorded_by) values(entry,c.pot_id,'car_expense',-amount,c.car_id,b.id,bank,trim(p_data->>'bankReference'),day,p_actor);
 insert into uc_investor_payment_receipts(entry_id,document_id,bill_id,actor_id,request_id) values(entry,d.id,b.id,p_actor,req);
 end if;
elsif p_action='apply_profit_transfer' then
 due:=coalesce(uc_investor_profit_due(c.car_id),0);amount:=uc_recovery_cents(p_data->'amountCents');if amount<=0 or amount>abs(due) then raise exception 'PROFIT_TRANSFER_EXCEEDS_BALANCE';end if;
 if due>0 then available:=(uc_company_cash_position()->>'availableCents')::bigint+due;else
 if exists(select 1 from uc_investor_car_bills where car_id=c.car_id and (uc_investor_bill_balance(id)->>'receivableCents')::bigint>0) then raise exception 'SUPPLIER_REFUND_STILL_DUE';end if;
 available:=(uc_investor_position(c.pot_id)->>'availableCents')::bigint-due;end if;
 if amount>available then raise exception 'INSUFFICIENT_TRANSFER_FUNDS';end if;
 insert into uc_investor_profit_transfers(car_id,pot_id,amount_cents,actor_id,request_id,payload) values(c.car_id,c.pot_id,case when due>0 then amount else -amount end,p_actor,req,payload) returning * into tr;
end if;
if (uc_investor_position(c.pot_id)->>'cashCents')::numeric>1000000000000 then raise exception 'BALANCE_LIMIT';end if;
r:=uc_investor_bill_adjustment_snapshot(p_actor,c.car_id,b.id)||jsonb_build_object('adjustmentId',adj.id,'entryId',entry,'profitTransferId',tr.id,'car',uc_investor_car_summary(c.car_id));
insert into uc_investor_audit(pot_id,actor_id,action,detail) values(c.pot_id,p_actor,'bill_adjustment_'||p_action,jsonb_build_object('carId',c.car_id,'billId',b.id,'requestId',req,'adjustmentId',adj.id,'entryId',entry,'profitTransferId',tr.id));
insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,payload,r);return r;
end $$;
create function uc_supplier_receipt_single_use() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
if exists(select 1 from uc_investor_supplier_refunds where receipt_document_id=new.document_id) then raise exception 'RECEIPT_ALREADY_USED';end if;return new;end $$;
create trigger uc_supplier_receipt_single_use before insert on uc_investor_payment_receipts for each row execute function uc_supplier_receipt_single_use();
alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_bill_adjustments;
create function uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;prior uc_investor_commands;begin
if p_action in('pay_car_bill','void_car_bill','settle_car') and not exists(select 1 from garage_building_staff where id=p_actor and enabled and registration_status='active' and role='director' and business_access in('used_car','both')) then raise exception 'NOT_ALLOWED';end if;
if p_action not in('snapshot','car_snapshot','list_profiles','car_billing_list') then perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));end if;
if p_action='settle_car' and not exists(select 1 from uc_investor_cars where car_id=p_data->>'carId' and settled_at is not null) and exists(select 1 from uc_investor_car_bills where car_id=p_data->>'carId' and state='approved' and (uc_investor_bill_balance(id)->>'receivableCents')::bigint>0) then raise exception 'SUPPLIER_REFUND_STILL_DUE';end if;
if p_action in('pay_car_bill','void_car_bill') and exists(select 1 from uc_investor_bill_adjustments where bill_id=(p_data->>'billId')::uuid) then
 if p_action='void_car_bill' then raise exception 'PAID_BILL_ADJUSTMENT_REQUIRED';end if;
 select * into prior from uc_investor_commands where actor_id=p_actor and request_id=p_data->>'requestId';
 if prior.actor_id is not null and prior.payload->>'action'='pay_car_bill' then return uc_capital_before_bill_adjustments(p_actor,p_action,p_data);end if;
 r:=uc_investor_bill_adjustment(p_actor,'pay',p_data);return jsonb_build_object('car',r->'car','position',r->'position','billId',p_data->'billId','entryId',r->'entryId','receiptDocumentId',p_data->'receiptDocumentId');end if;
r:=uc_capital_before_bill_adjustments(p_actor,p_action,p_data);
if p_action='snapshot' then r:=r||jsonb_build_object('entries',coalesce((select jsonb_agg(x.value order by x.value->>'recordedAt' desc,x.value->>'id') from(select value from jsonb_array_elements(r->'entries') union all select jsonb_build_object('id',t.id::text,'kind',case when t.amount_cents>0 then 'profit_adjustment_in' else 'profit_adjustment_out' end,'amountCents',t.amount_cents,'paidOn',null,'recordedAt',t.created_at) from uc_investor_profit_transfers t where t.pot_id=(r->'position'->>'potId')::uuid) x),'[]'));end if;
if p_action='car_snapshot' then return r||jsonb_build_object('bills',coalesce((select jsonb_agg(v.value||jsonb_build_object('originalAmountCents',v.value->'amountCents','amountCents',uc_investor_bill_total((v.value->>'id')::uuid),'paidCents',(uc_investor_bill_balance((v.value->>'id')::uuid)->>'paidCents')::bigint-(uc_investor_bill_balance((v.value->>'id')::uuid)->>'returnedCents')::bigint,'returnedCents',uc_investor_bill_balance((v.value->>'id')::uuid)->'returnedCents','remainingCents',uc_investor_bill_balance((v.value->>'id')::uuid)->'payableCents','refundOwingCents',uc_investor_bill_balance((v.value->>'id')::uuid)->'receivableCents',
'adjustments',uc_investor_bill_adjustment_history((v.value->>'id')::uuid),'documents',coalesce((select jsonb_agg(x.value||case when x.value->>'kind'='receipt' then jsonb_build_object('used',coalesce((x.value->>'used')::boolean,false) or exists(select 1 from uc_investor_supplier_refunds where receipt_document_id=(x.value->>'id')::uuid)) else '{}'::jsonb end order by x.ordinality) from jsonb_array_elements(v.value->'documents') with ordinality x),'[]')) order by v.ordinality) from jsonb_array_elements(r->'bills') with ordinality v),'[]'));end if;return r;
end $$;
revoke all on function uc_investor_bill_total(uuid),uc_investor_bill_balance(uuid),uc_investor_adjusted_settlement(text),uc_investor_profit_due(text),uc_car_summary_before_bill_adjustments(text),uc_investor_car_summary(text),uc_position_before_bill_adjustments(uuid),uc_investor_position(uuid),uc_company_position_before_bill_adjustments(),uc_company_cash_position(),uc_investor_supplier_refund_cash(),uc_investor_bill_adjustment_plan(text,uuid,jsonb),uc_investor_bill_adjustment_snapshot(text,text,uuid),uc_investor_bill_adjustment(text,text,jsonb),uc_supplier_receipt_single_use(),uc_capital_before_bill_adjustments(text,text,jsonb),uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_investor_bill_adjustment(text,text,jsonb),uc_investor_capital(text,text,jsonb) to service_role;
revoke all on function uc_investor_bill_adjustment_history(uuid) from public,anon,authenticated,service_role;
revoke all on function uc_investor_supplier_account_guard() from public,anon,authenticated,service_role;
alter function uc_investor_activation(text,text,jsonb) rename to uc_activation_before_bill_adjustments;
create function uc_investor_activation(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;begin r:=uc_activation_before_bill_adjustments(p_actor,p_action,p_data);if p_action='list_profiles' then return r||jsonb_build_object('originalCompanyProfitCents',r->'companyProfitCents','companyProfitCents',coalesce((select sum((uc_investor_adjusted_settlement(car_id)->>'company_profit_cents')::bigint) from uc_investor_car_settlements),0));end if;return r;end $$;
revoke all on function uc_activation_before_bill_adjustments(text,text,jsonb),uc_investor_activation(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_investor_activation(text,text,jsonb) to service_role;
-- Replace precisely the two original bill-cap calculations (prepare and post).
-- Fail installation rather than patch an unexpected function revision.
do $$ declare definition text;needle text:='select bill.amount_cents-coalesce(-sum(amount_cents),0)-uc_bill_withheld(bill.id) into unpaid from uc_investor_cash_entries where bill_id=bill.id and kind=''car_expense'';';begin
select pg_get_functiondef('uc_investor_recoveries(text,text,jsonb)'::regprocedure) into definition;
if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then raise exception 'RECOVERY_BILL_CAP_REVIEW_REQUIRED';end if;
execute replace(definition,needle,'select (uc_investor_bill_balance(bill.id)->>''payableCents'')::bigint into unpaid;');end $$;
alter function uc_investor_recoveries(text,text,jsonb) rename to uc_recoveries_before_bill_adjustments;
create function uc_investor_recoveries(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ begin
if p_action in('prepare_receipt','prepare_refund','post','cancel') then perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));end if;
return uc_recoveries_before_bill_adjustments(p_actor,p_action,p_data);end $$;
revoke all on function uc_investor_bill_document_floor(uuid),uc_recoveries_before_bill_adjustments(text,text,jsonb),uc_investor_recoveries(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_investor_recoveries(text,text,jsonb) to service_role;
commit;
