-- PREPARED ONLY. Audited ordinary company supplier bill adjustments; no cash replay.
begin;
create table uc_company_bill_adjustments(
 id uuid primary key default gen_random_uuid(),root_payment_id text not null references payments(id),car_id text not null references cars(id),
 actor_id text not null references garage_building_staff(id),request_id text not null,reason text not null check(length(reason) between 5 and 1000),
 invoice_document_id uuid not null unique references uc_company_payment_documents(id),before_total_cents bigint not null check(before_total_cents>=0),
 after_total_cents bigint not null check(after_total_cents between 0 and 1000000000000),before_source jsonb not null,after_source jsonb not null,
 plan jsonb not null,payload jsonb not null,journal_id text not null unique references journal_entries(id) deferrable initially deferred,
 transaction_id bigint not null default txid_current(),created_at timestamptz not null default clock_timestamp(),unique(actor_id,request_id)
);
create table uc_company_bill_obligations(payment_id text primary key references payments(id) deferrable initially deferred,root_payment_id text not null references payments(id),adjustment_id uuid not null references uc_company_bill_adjustments(id),amount_cents bigint not null check(amount_cents>0));
create table uc_company_bill_replacements(payment_id text primary key references payments(id),adjustment_id uuid not null references uc_company_bill_adjustments(id),before_payment jsonb not null,after_payment jsonb not null,transaction_id bigint not null default txid_current());
do $$ declare t text;begin foreach t in array array['uc_company_bill_adjustments','uc_company_bill_obligations','uc_company_bill_replacements'] loop
 execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 execute format('create trigger %I before update or delete on %I for each row execute function uc_investor_immutable()',t||'_fixed',t);
 execute format('create trigger %I before truncate on %I execute function uc_investor_immutable()',t||'_no_truncate',t);end loop;end $$;

alter function uc_consignment_replacement_allowed(jsonb,jsonb) rename to uc_replacement_before_company_bills;
create function uc_consignment_replacement_allowed(p_before jsonb,p_after jsonb) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select uc_replacement_before_company_bills(p_before,p_after) or exists(select 1 from uc_company_bill_replacements x where x.payment_id=p_before->>'id' and x.transaction_id=txid_current() and x.before_payment=p_before and x.after_payment=p_after)
$$;
alter function uc_supplier_adjustment_invoice(text) rename to uc_supplier_invoice_before_company_bills;
create function uc_supplier_adjustment_invoice(p_payment text) returns uuid language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(uc_supplier_invoice_before_company_bills(p_payment),(select a.invoice_document_id from uc_company_bill_obligations o join uc_company_bill_adjustments a on a.id=o.adjustment_id where o.payment_id=p_payment))
$$;
alter function uc_consignment_bill_limit(text) rename to uc_bill_limit_before_company_bills;
create function uc_consignment_bill_limit(p_payment text) returns bigint language sql stable security definer set search_path=public,pg_temp as $$ select coalesce(uc_bill_limit_before_company_bills(p_payment),(select amount_cents from uc_company_bill_obligations where payment_id=p_payment)) $$;
alter function uc_consignment_receipt_allowed(text,text) rename to uc_receipt_allowed_before_company_bills;
create function uc_consignment_receipt_allowed(p_car text,p_payment text default null) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select uc_receipt_allowed_before_company_bills(p_car,p_payment) or exists(select 1 from uc_company_bill_obligations o join payments p on p.id=o.payment_id where p.car_id=p_car and p.id=p_payment and p.type='supplier_credit_collection' and not p.obligation_replaced)
$$;
alter function uc_outgoing_receipt_allowed(text,text) rename to uc_outgoing_receipt_before_company_bills;
create function uc_outgoing_receipt_allowed(p_car text,p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select uc_outgoing_receipt_before_company_bills(p_car,p_payment) or exists(select 1 from uc_company_bill_obligations o join payments p on p.id=o.payment_id where p.car_id=p_car and p.id=p_payment and p.type='supplier_credit_collection' and not p.obligation_replaced)
$$;

create function uc_company_bill_source_allowed(p_table text,p_before jsonb,p_after jsonb) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from uc_company_bill_adjustments a where a.transaction_id=txid_current() and a.before_source=p_before and a.after_source=p_after and (p_table='repairs' and a.plan->>'rootType'='repair' or p_table='cars' and a.plan->>'rootType'='misc_cost'))
$$;
create function uc_company_bill_insert_allowed(p_table text,p_after jsonb) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_table='payments' then exists(select 1 from uc_company_bill_obligations o join uc_company_bill_adjustments a on a.id=o.adjustment_id where o.payment_id=p_after->>'id' and a.transaction_id=txid_current() and a.car_id=p_after->>'car_id' and o.amount_cents=uc_commission_cents(p_after->'amount'))
 when p_table='journal_entries' then exists(select 1 from uc_company_bill_adjustments a where a.journal_id=p_after->>'id' and a.transaction_id=txid_current() and a.car_id=p_after->>'car_id') else false end
$$;
-- Keep the original trigger function and all of its checks. Only add exact audit allowances.
do $$ declare body text;begin
 select pg_get_functiondef('uc_outgoing_closed_cost_guard()'::regprocedure) into body;
 if position('declare cid text;financial boolean;begin' in body)=0 then raise exception 'OUTGOING_GUARD_REVIEW_REQUIRED';end if;
 body:=replace(body,'declare cid text;financial boolean;begin',E'declare cid text;financial boolean;begin\n if tg_op=''UPDATE'' and uc_company_bill_source_allowed(tg_table_name,to_jsonb(old),to_jsonb(new)) then return new;end if;\n if tg_op=''INSERT'' and uc_company_bill_insert_allowed(tg_table_name,to_jsonb(new)) then return new;end if;');execute body;
end $$;

create function uc_company_bill_plan(p_payment text,p_data jsonb default null) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare root payments;chosen payments;c cars;r repairs;latest uc_company_bill_adjustments;family text[];before_total bigint;after_total bigint;paid bigint;returned bigint;open_ap bigint;open_ar bigint;balance bigint;credit bigint;debit bigint;account text;accounts integer;cost_account text;before_source jsonb;after_source jsonb;items jsonb;changed jsonb;item_id text;source jsonb;cutoff timestamptz;invoices jsonb;invoice_id uuid;begin
 select * into chosen from payments where id=p_payment;select * into root from payments where id=coalesce((select root_payment_id from uc_company_bill_obligations where payment_id=p_payment),p_payment);
 select * into c from cars where id=root.car_id;
 if root.id is null or c.id is null or root.type not in ('repair','misc_cost') or root.claim_confirmed_by is not null or c.investor_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true' or exists(select 1 from uc_investor_cars where car_id=c.id) or c.consignment is not null and c.consignment<>'null'::jsonb or exists(select 1 from uc_consignment_cases where car_id=c.id) then raise exception 'DIRECT_COMPANY_CAR_BILL_REQUIRED';end if;

 select array_agg(id order by id) into family from payments where id=root.id or id in(select payment_id from uc_company_bill_obligations where root_payment_id=root.id);
 if exists(select 1 from payments p where id=any(family) and (p.status not in ('pending','transferred') or p.status='transferred' and uc_company_paid_cents(p.id)<>uc_commission_cents(to_jsonb(p)->'amount'))) or exists(select 1 from journal_entries j where j.source_id=any(family) and j.source_type like '%\_paid' escape '\' and j.id not like 'company-bank:%' and not coalesce(j.voided,false)) then raise exception 'SUPPLIER_HISTORY_REVIEW_REQUIRED';end if;
 select * into latest from uc_company_bill_adjustments where root_payment_id=root.id order by created_at desc,id desc limit 1;before_total:=coalesce(latest.after_total_cents,uc_commission_cents(to_jsonb(root)->'amount'));

 select coalesce(sum(case when type<>'supplier_credit_collection' then uc_company_paid_cents(id) else 0 end),0),coalesce(sum(case when type='supplier_credit_collection' then uc_company_paid_cents(id) else 0 end),0),coalesce(sum(case when not obligation_replaced and type<>'supplier_credit_collection' then greatest(0,uc_commission_cents(to_jsonb(p)->'amount')-uc_company_paid_cents(id)) else 0 end),0),coalesce(sum(case when not obligation_replaced and type='supplier_credit_collection' then greatest(0,uc_commission_cents(to_jsonb(p)->'amount')-uc_company_paid_cents(id)) else 0 end),0) into paid,returned,open_ap,open_ar from payments p where id=any(family);
 if open_ap-open_ar<>before_total-paid+returned then raise exception 'SUPPLIER_HISTORY_REVIEW_REQUIRED';end if;
 select coalesce(sum(((l->>'credit')::numeric-(l->>'debit')::numeric)*100),0) into credit from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.source_type=root.type and j.source_id=root.id and not coalesce(j.voided,false) and l->>'accountId'='acct-ap';
 select count(*),min(x.account),sum(x.cents) into accounts,account,debit from (select l->>'accountId' account,sum(((l->>'debit')::numeric-(l->>'credit')::numeric)*100) cents from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.source_type=root.type and j.source_id=root.id and not coalesce(j.voided,false) and l->>'accountId'<>'acct-ap' group by l->>'accountId' having sum((l->>'debit')::numeric-(l->>'credit')::numeric)<>0) x;
 if credit<>uc_commission_cents(to_jsonb(root)->'amount') or accounts<>1 or debit<>credit or not exists(select 1 from ledger_accounts where id=account and (id='acct-inv-own' or type in ('expense','cogs'))) then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
 cost_account:=account;if account='acct-inv-own' and (exists(select 1 from uc_outgoing_cost_reviews where car_id=c.id) or exists(select 1 from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.car_id=c.id and not coalesce(j.voided,false) and l->>'accountId'='acct-cogs-own' and (l->>'debit')::numeric>0)) then cost_account:='acct-cogs-own';end if;
 if root.type='repair' then
  select * into r from repairs where id=to_jsonb(root)->>'repair_job_id' and car_id=c.id and status='done';
  if r.id is null or coalesce(uc_commission_cents(to_jsonb(r)->'actual_cost'),uc_commission_cents(to_jsonb(r)->'total_cost'))<>before_total or exists(select 1 from payments p where p.car_id=c.id and to_jsonb(p)->>'repair_job_id'=r.id and not(p.id=any(family))) then raise exception 'DIRECT_COMPANY_CAR_BILL_REQUIRED';end if;before_source:=to_jsonb(r);
 else
  item_id:=to_jsonb(root)->>'misc_cost_id';items:=coalesce(nullif(c.misc_costs,'null'::jsonb),'[]'::jsonb);
  if nullif(item_id,'') is null or (select count(*) from jsonb_array_elements(items) x where x->>'id'=item_id)<>1 or not exists(select 1 from jsonb_array_elements(items) x where x->>'id'=item_id and uc_commission_cents(x->'amount')=before_total) or exists(select 1 from payments p where p.car_id=c.id and to_jsonb(p)->>'misc_cost_id'=item_id and not(p.id=any(family))) then raise exception 'DIRECT_COMPANY_CAR_BILL_REQUIRED';end if;before_source:=to_jsonb(c);
 end if;
 select greatest(coalesce((select min(confirmed_at) from uc_company_payment_documents where payment_id=root.id and kind='invoice' and state='confirmed'),'-infinity'::timestamptz),coalesce(latest.created_at,'-infinity'::timestamptz),coalesce((select max(m.recorded_at) from uc_company_bank_payments m join uc_company_bank_allocations a on a.bank_payment_id=m.id where a.payment_id=any(family)),'-infinity'::timestamptz),coalesce((select max(recorded_at) from uc_company_bank_receipts where payment_id=any(family)),'-infinity'::timestamptz),coalesce((select max(recorded_at) from uc_company_bank_receipts br join uc_company_withheld_payments w on w.receipt_id=br.id where w.payment_id=any(family)),'-infinity'::timestamptz)) into cutoff;
 select coalesce(jsonb_agg(jsonb_build_object('documentId',d.id,'name',d.file_name) order by d.confirmed_at,d.id),'[]'::jsonb) into invoices from uc_company_payment_documents d where d.payment_id=any(family) and d.kind='invoice' and d.state='confirmed' and d.confirmed_at>cutoff and not exists(select 1 from uc_company_bill_adjustments where invoice_document_id=d.id);
 source:=jsonb_build_object('car',to_jsonb(c),'source',before_source,'payments',(select jsonb_agg(to_jsonb(p)||jsonb_build_object('paidCents',uc_company_paid_cents(p.id)) order by id) from payments p where p.car_id=c.id),'journals',(select jsonb_agg(to_jsonb(j) order by id) from journal_entries j where j.car_id=c.id),'documents',(select jsonb_agg(to_jsonb(d) order by id) from uc_company_payment_documents d where payment_id=any(family)),'latest',to_jsonb(latest));
 if p_data is null then return jsonb_build_object('paymentId',p_payment,'rootPaymentId',root.id,'carId',c.id,'totalCents',before_total,'paidCents',paid,'returnedCents',returned,'invoices',invoices,'costAccount',cost_account,'sourceRevision',md5(source::text),'adjustments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'beforeTotalCents',a.before_total_cents,'afterTotalCents',a.after_total_cents,'reason',a.reason,'createdAt',a.created_at,'actorName',(select name from garage_building_staff where id=a.actor_id)) order by a.created_at,a.id) from uc_company_bill_adjustments a where root_payment_id=root.id),'[]'::jsonb));end if;
 if jsonb_typeof(p_data->'amountCents') is distinct from 'number' or coalesce(p_data->>'amountCents','')!~'^\d{1,13}$' or (p_data->>'amountCents')::bigint>1000000000000 then raise exception 'INVALID';end if;after_total:=(p_data->>'amountCents')::bigint;if after_total=before_total then raise exception 'NO_CORRECTION_CHANGE';end if;
 invoice_id:=(p_data->>'invoiceDocumentId')::uuid;if not exists(select 1 from jsonb_array_elements(invoices) x where x->>'documentId'=invoice_id::text) then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
 if root.type='repair' then after_source:=before_source||jsonb_build_object('actual_cost',after_total::numeric/100);else select jsonb_agg(case when x->>'id'=item_id then jsonb_set(x,'{amount}',to_jsonb(after_total::numeric/100)) else x end order by ord) into changed from jsonb_array_elements(items) with ordinality t(x,ord);after_source:=before_source||jsonb_build_object('misc_costs',changed);end if;
 balance:=after_total-paid+returned;
 return jsonb_build_object('paymentId',p_payment,'rootPaymentId',root.id,'rootType',root.type,'carId',c.id,'sourceRevision',md5(source::text),'beforeTotalCents',before_total,'afterTotalCents',after_total,'paidCents',paid,'returnedCents',returned,'oldPayableCents',open_ap,'oldReceivableCents',open_ar,'payableCents',greatest(0,balance),'receivableCents',greatest(0,-balance),'costAccount',cost_account,'beforeSource',before_source,'afterSource',after_source,'family',to_jsonb(family));
end $$;

create function uc_company_bill_adjustment(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;prior uc_company_bill_adjustments;plan jsonb;root payments;p payments;aid uuid:=gen_random_uuid();jid text;pid text;req text;payable bigint;receivable bigint;delta bigint;lines jsonb:='[]';leg jsonb;begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_action not in ('snapshot','preview','apply') or jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(case p_action when 'snapshot' then array['paymentId'] when 'preview' then array['paymentId','amountCents','invoiceDocumentId','reason'] else array['paymentId','amountCents','invoiceDocumentId','reason','expectedRevision','requestId'] end))) or coalesce(p_data->>'paymentId','')!~'^[A-Za-z0-9_:-]{1,180}$' then raise exception 'INVALID';end if;
 if p_action='snapshot' then return uc_company_bill_plan(p_data->>'paymentId');end if;
 if jsonb_typeof(p_data->'reason') is distinct from 'string' or length(trim(p_data->>'reason')) not between 5 and 1000 or p_data->>'reason'~'[[:cntrl:]]' then raise exception 'REASON_REQUIRED';end if;
 if p_action='preview' then return uc_company_bill_plan(p_data->>'paymentId',p_data);end if;
 req:=p_data->>'requestId';if coalesce(req,'')!~'^[A-Za-z0-9_-]{16,80}$' or coalesce(p_data->>'expectedRevision','')!~'^[0-9a-f]{32}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));perform pg_advisory_xact_lock(hashtextextended('company-bill:'||p_actor||':'||req,0));
 select * into prior from uc_company_bill_adjustments where actor_id=p_actor and request_id=req;
 if found then if prior.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;aid:=prior.id;
 else
  select * into root from payments where id=coalesce((select root_payment_id from uc_company_bill_obligations where payment_id=p_data->>'paymentId'),p_data->>'paymentId');
  perform 1 from cars where id=root.car_id for update;perform 1 from payments where car_id=root.car_id order by id for update;perform 1 from repairs where car_id=root.car_id order by id for update;
  plan:=uc_company_bill_plan(p_data->>'paymentId',p_data);if plan->>'sourceRevision' is distinct from p_data->>'expectedRevision' then raise exception 'SOURCE_CHANGED';end if;
  payable:=(plan->>'payableCents')::bigint;receivable:=(plan->>'receivableCents')::bigint;delta:=(plan->>'afterTotalCents')::bigint-(plan->>'beforeTotalCents')::bigint;jid:='uc:company-bill-adjustment:'||aid;
  for leg in select jsonb_build_object('accountId',a,'debit',d::numeric/100,'credit',c::numeric/100) from (values('acct-ap',(plan->>'oldPayableCents')::bigint,0::bigint),('acct-ap',0::bigint,payable),('acct-supplier-credit',receivable,0::bigint),('acct-supplier-credit',0::bigint,(plan->>'oldReceivableCents')::bigint),(plan->>'costAccount',greatest(0,delta),greatest(0,-delta))) v(a,d,c) where d<>0 or c<>0 loop lines:=lines||jsonb_build_array(leg);end loop;
  insert into uc_company_bill_adjustments(id,root_payment_id,car_id,actor_id,request_id,reason,invoice_document_id,before_total_cents,after_total_cents,before_source,after_source,plan,payload,journal_id) values(aid,root.id,root.car_id,p_actor,req,trim(p_data->>'reason'),(p_data->>'invoiceDocumentId')::uuid,(plan->>'beforeTotalCents')::bigint,(plan->>'afterTotalCents')::bigint,plan->'beforeSource',plan->'afterSource',plan,p_data,jid);
  for p in select * from payments where id in(select jsonb_array_elements_text(plan->'family')) and not obligation_replaced order by id loop insert into uc_company_bill_replacements values(p.id,aid,to_jsonb(p),to_jsonb(p)||jsonb_build_object('obligation_replaced',true),txid_current());update payments set obligation_replaced=true where id=p.id;end loop;
  if payable>0 or receivable>0 then
   pid:='company-bill-adjustment:'||aid;
   -- Register before INSERT so the outgoing closed-cost trigger can verify this exact obligation.
   insert into uc_company_bill_obligations values(pid,root.id,aid,greatest(payable,receivable));
   insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,bank_name,account_number,account_holder,description,created_at,repair_job_id,misc_cost_id) values(pid,root.car_id,case when payable>0 then root.type else 'supplier_credit_collection' end,'pending',greatest(payable,receivable)::numeric/100,root.recipient_type,root.recipient_id,root.recipient_name,root.bank_name,root.account_number,root.account_holder,'Supplier adjustment; original payments retained',clock_timestamp(),to_jsonb(root)->>'repair_job_id',to_jsonb(root)->>'misc_cost_id');
  end if;
  if root.type='repair' then update repairs set actual_cost=(plan->>'afterTotalCents')::numeric/100 where id=to_jsonb(root)->>'repair_job_id';else update cars set misc_costs=plan->'afterSource'->'misc_costs' where id=root.car_id;end if;
  perform uc_post_journal('company-bill-adjustment:'||aid,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Director supplier bill adjustment: '||trim(p_data->>'reason'),root.car_id,p_actor,lines);
 end if;
 select * into prior from uc_company_bill_adjustments where id=aid;
 return jsonb_build_object('paymentId',p_data->>'paymentId','rootPaymentId',prior.root_payment_id,'carId',prior.car_id,'adjustmentId',aid,'car',(select to_jsonb(c) from cars c where id=prior.car_id),'repairs',coalesce((select jsonb_agg(to_jsonb(r) order by id) from repairs r where car_id=prior.car_id),'[]'::jsonb),'payments',coalesce((select jsonb_agg(to_jsonb(pp)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(pp.id)) order by pp.id) from payments pp where pp.car_id=prior.car_id),'[]'::jsonb),'journals',coalesce((select jsonb_agg(to_jsonb(j)) from journal_entries j where id=prior.journal_id),'[]'::jsonb));
end $$;
-- Freeze corrected sources and bill links; only another exact adjustment may change costs.
create function uc_company_bill_source_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare cid text;begin
 if tg_table_name='payments' then
  if tg_op='INSERT' then
   if not uc_company_bill_insert_allowed(tg_table_name,to_jsonb(new)) and exists(select 1 from uc_company_bill_adjustments a join payments p on p.id=a.root_payment_id where p.car_id=new.car_id and (p.type='repair' and nullif(to_jsonb(p)->>'repair_job_id','')=to_jsonb(new)->>'repair_job_id' or p.type='misc_cost' and nullif(to_jsonb(p)->>'misc_cost_id','')=to_jsonb(new)->>'misc_cost_id')) then raise exception 'COMPANY_BILL_ADJUSTMENT_REQUIRED';end if;return new;end if;
  if uc_consignment_replacement_allowed(to_jsonb(old),to_jsonb(new)) then return new;end if;
  if exists(select 1 from uc_company_bill_adjustments a where a.root_payment_id=old.id) or exists(select 1 from uc_company_bill_obligations where payment_id=old.id) then
   if tg_op='DELETE' or exists(select 1 from unnest(array['id','type','amount','car_id','repair_job_id','misc_cost_id','recipient_id','recipient_type','recipient_name','bank_name','account_number','account_holder','claim_confirmed_by']) k where to_jsonb(old)->k is distinct from to_jsonb(new)->k) then raise exception 'COMPANY_BILL_ADJUSTMENT_REQUIRED';end if;
  end if;
 elsif tg_table_name='journal_entries' then
  if tg_op='INSERT' and uc_company_bill_insert_allowed(tg_table_name,to_jsonb(new)) then return new;end if;
  if exists(select 1 from uc_company_bill_adjustments a join payments p on p.id=a.root_payment_id where (tg_op<>'INSERT' and a.journal_id=old.id) or (case when tg_op='INSERT' then new.source_type=p.type and new.source_id=p.id else old.source_type=p.type and old.source_id=p.id end)) or exists(select 1 from uc_company_bill_obligations o join payments pp on pp.id=o.payment_id where case when tg_op='INSERT' then new.source_type=pp.type and new.source_id=pp.id else old.source_type=pp.type and old.source_id=pp.id end) then raise exception 'COMPANY_BILL_ADJUSTMENT_REQUIRED';end if;
 else
  cid:=case when tg_table_name='cars' then to_jsonb(old)->>'id' else to_jsonb(old)->>'car_id' end;
  if exists(select 1 from uc_company_bill_adjustments a where a.car_id=cid and (tg_table_name='cars' and a.plan->>'rootType'='misc_cost' or tg_table_name='repairs' and a.before_source->>'id'=old.id)) then
   if tg_op='DELETE' then raise exception 'COMPANY_BILL_ADJUSTMENT_REQUIRED';end if;
   if uc_company_bill_source_allowed(tg_table_name,to_jsonb(old),to_jsonb(new)) then return new;end if;
   if tg_table_name='cars' and exists(select 1 from uc_company_bill_adjustments a join payments p on p.id=a.root_payment_id where a.car_id=cid and p.type='misc_cost' and (select jsonb_agg(x order by x::text) from jsonb_array_elements(coalesce(nullif(to_jsonb(old)->'misc_costs','null'::jsonb),'[]'::jsonb)) x where x->>'id'=to_jsonb(p)->>'misc_cost_id') is distinct from (select jsonb_agg(x order by x::text) from jsonb_array_elements(coalesce(nullif(to_jsonb(new)->'misc_costs','null'::jsonb),'[]'::jsonb)) x where x->>'id'=to_jsonb(p)->>'misc_cost_id')) or tg_table_name='repairs' and exists(select 1 from unnest(array['id','car_id','actual_cost','total_cost','status','parts','labour_cost']) k where to_jsonb(old)->k is distinct from to_jsonb(new)->k) then raise exception 'COMPANY_BILL_ADJUSTMENT_REQUIRED';end if;
  end if;
 end if;if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger uc_company_adjusted_bill before insert or update or delete on payments for each row execute function uc_company_bill_source_guard();
create trigger uc_company_adjusted_repair before update or delete on repairs for each row execute function uc_company_bill_source_guard();
create trigger uc_company_adjusted_misc before update on cars for each row execute function uc_company_bill_source_guard();
create trigger uc_company_adjusted_journal before insert or update or delete on journal_entries for each row execute function uc_company_bill_source_guard();

create function uc_company_bill_effective_cents(p_payment text) returns bigint language sql stable security definer set search_path=public,pg_temp as $$ select coalesce((select after_total_cents from uc_company_bill_adjustments where root_payment_id=p_payment order by created_at desc,id desc limit 1),(select uc_commission_cents(to_jsonb(p)->'amount') from payments p where id=p_payment)) $$;
create function uc_company_bill_family_reviewed(p_payment text) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$ begin if not exists(select 1 from uc_company_bill_adjustments where root_payment_id=p_payment) then return false;end if;perform uc_company_bill_plan(p_payment);return true;end $$;
create or replace function uc_outgoing_cost_plan(p_payment text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a uc_outgoing_collections;c cars;r repairs;p payments;item jsonb;stock bigint;purchase bigint;car_cost bigint:=0;expected bigint;actual bigint;n integer;gap bigint;expenses bigint;source jsonb;begin
 select * into a from uc_outgoing_collections where payment_id=p_payment;select * into c from cars where id=a.car_id;
 if a.payment_id is null then raise exception 'OUTGOING_COLLECTION_REQUIRED';end if;
 if exists(select 1 from repairs where car_id=c.id and status is distinct from 'done') then raise exception 'UNFINISHED_CAR_BILLS';end if;
 purchase:=uc_commission_cents(to_jsonb(c)->'purchase_price');if coalesce(purchase,0)<=0 then raise exception 'PURCHASE_COST_REVIEW_REQUIRED';end if;
 for r in select * from repairs where car_id=c.id loop
  expected:=coalesce(uc_commission_cents(to_jsonb(r)->'actual_cost'),uc_commission_cents(to_jsonb(r)->'total_cost'),0);if expected<0 then raise exception 'CAR_BILLS_INCOMPLETE';end if;
  select count(*),coalesce(sum(uc_company_bill_effective_cents(s.id)),0) into n,actual from payments s where s.car_id=c.id and s.type in ('repair','expense_claim') and to_jsonb(s)->>'repair_job_id'=r.id and not exists(select 1 from uc_company_bill_obligations where payment_id=s.id);
  if expected>0 and (n<>1 or actual<>expected) then raise exception 'CAR_BILLS_INCOMPLETE';end if;car_cost:=car_cost+expected;
 end loop;
 select coalesce(sum(uc_commission_cents(value->'amount')),0) into expected from jsonb_array_elements(coalesce(nullif(c.misc_costs,'null'::jsonb),'[]'::jsonb));
 select coalesce(sum(uc_company_bill_effective_cents(s.id)),0) into actual from payments s where s.car_id=c.id and (s.type='misc_cost' or s.type='expense_claim' and nullif(to_jsonb(s)->>'misc_cost_id','') is not null) and not exists(select 1 from uc_company_bill_obligations where payment_id=s.id);
 if expected<>actual then raise exception 'CAR_BILLS_INCOMPLETE';end if;car_cost:=car_cost+expected;
 foreach item in array array[jsonb_build_object('type','intake_bonus','value',to_jsonb(c)->'intake_commission'),jsonb_build_object('type','source_commission','value',to_jsonb(c)->'source_commission'),jsonb_build_object('type','panel_charge','value',to_jsonb(c)->'panel_charge_amount')] loop
  expected:=coalesce(uc_commission_cents(item->'value'),0);select count(*),coalesce(sum(uc_company_bill_effective_cents(s.id)),0) into n,actual from payments s where s.car_id=c.id and s.type=item->>'type';if expected<>actual or expected>0 and n<>1 or expected=0 and n<>0 then raise exception 'CAR_BILLS_INCOMPLETE';end if;
 end loop;
 for p in select * from payments pp where car_id=c.id and type in ('repair','misc_cost','expense_claim','salesman_commission','intake_bonus','source_commission','panel_charge') and not exists(select 1 from uc_company_bill_obligations where payment_id=pp.id) loop
  expected:=uc_company_bill_effective_cents(p.id);if expected is null or expected<0 or expected=0 and not uc_company_bill_family_reviewed(p.id) or p.obligation_replaced and not uc_company_bill_family_reviewed(p.id) or p.type='expense_claim' and p.claim_confirmed_by is null then raise exception 'CAR_BILLS_INCOMPLETE';end if;
  if uc_company_invoice_type(p.type) and not exists(select 1 from uc_company_payment_documents where payment_id=p.id and kind='invoice' and state='confirmed') then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
  if not uc_company_bill_family_reviewed(p.id) then
  select coalesce(sum(((l->>'credit')::numeric-(l->>'debit')::numeric)*100),0) into actual from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where not coalesce(j.voided,false) and l->>'accountId'='acct-ap' and (j.source_id=p.id and j.source_type in (p.type,'expense_claim_confirmed') or j.source_id=c.id and j.source_type=p.type and p.type in ('salesman_commission','intake_bonus','source_commission'));
  if actual<>expected then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;end if;
 end loop;
 select coalesce(sum(((l->>'debit')::numeric-(l->>'credit')::numeric)*100),0) into stock from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.car_id=c.id and not coalesce(j.voided,false) and l->>'accountId'='acct-inv-own';
 gap:=purchase+car_cost-stock;
 if gap<>0 and (gap<>purchase or exists(select 1 from journal_entries where car_id=c.id and source_type in ('car_purchased','trade_in_acquired','company_car_purchase') and not coalesce(voided,false))) then raise exception 'PURCHASE_COST_REVIEW_REQUIRED';end if;
 select coalesce(sum(((l->>'debit')::numeric-(l->>'credit')::numeric)*100),0) into expenses from journal_entries j cross join lateral jsonb_array_elements(j.lines) l join ledger_accounts la on la.id=l->>'accountId' where j.car_id=c.id and not coalesce(j.voided,false) and la.type in ('expense','cogs');
 if expenses<0 or exists(select 1 from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.car_id=c.id and not coalesce(j.voided,false) and l->>'accountId'='acct-cogs-own') then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
 source:=jsonb_build_object('car',to_jsonb(c),'repairs',(select jsonb_agg(to_jsonb(s) order by id) from repairs s where car_id=c.id),'payments',(select jsonb_agg(to_jsonb(s) order by id) from payments s where car_id=c.id),'journals',(select jsonb_agg(to_jsonb(j) order by id) from journal_entries j where car_id=c.id),'documents',(select jsonb_agg(to_jsonb(d) order by d.id) from uc_company_payment_documents d join payments s on s.id=d.payment_id where s.car_id=c.id));
 return jsonb_build_object('paymentId',p_payment,'approved',true,'costReviewPending',true,'purchaseCents',purchase,'carCostCents',car_cost,'stockCents',stock,'missingPurchaseCents',gap,'otherExpenseCents',expenses,'netProfitCents',a.amount_cents-purchase-car_cost-expenses,'sourceRevision',md5(source::text),'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',file_name) order by confirmed_at,id) from uc_company_payment_documents where payment_id=p_payment and kind='invoice' and state='confirmed'),'[]'::jsonb));
end $$;
revoke all on function uc_company_bill_effective_cents(text),uc_company_bill_family_reviewed(text) from public,anon,authenticated,service_role;
revoke all on function uc_replacement_before_company_bills(jsonb,jsonb),uc_consignment_replacement_allowed(jsonb,jsonb),uc_supplier_invoice_before_company_bills(text),uc_supplier_adjustment_invoice(text),uc_bill_limit_before_company_bills(text),uc_consignment_bill_limit(text),uc_receipt_allowed_before_company_bills(text,text),uc_consignment_receipt_allowed(text,text),uc_outgoing_receipt_before_company_bills(text,text),uc_outgoing_receipt_allowed(text,text),uc_company_bill_source_allowed(text,jsonb,jsonb),uc_company_bill_insert_allowed(text,jsonb),uc_company_bill_plan(text,jsonb),uc_company_bill_adjustment(text,text,jsonb),uc_company_bill_source_guard() from public,anon,authenticated,service_role;

-- A supplier refund is not a retail sale receipt and does not prevent later dealer sale.
do $$ declare body text;old_clause text:='exists(select 1 from uc_company_bank_receipts where car_id=c.id)';begin
 select pg_get_functiondef('uc_outgoing_send(text,text,jsonb)'::regprocedure) into body;
 if position(old_clause in body)=0 then raise exception 'OUTGOING_SEND_REVIEW_REQUIRED';end if;
 body:=replace(body,old_clause,'exists(select 1 from uc_company_bank_receipts br where br.car_id=c.id and not exists(select 1 from uc_company_bill_obligations o join payments p on p.id=o.payment_id where o.payment_id=br.payment_id and p.type=''supplier_credit_collection''))');execute body;
end $$;

-- Retired obligations cannot be settled through either bank allocation or withholding.
create function uc_company_open_obligation_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare p payments;begin
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));select * into p from payments where id=new.payment_id for update;
 if p.id is null or p.obligation_replaced then raise exception 'PAYMENT_WORKFLOW_REQUIRED';end if;return new;
end $$;
create trigger uc_company_allocation_open_bill before insert on uc_company_bank_allocations for each row execute function uc_company_open_obligation_guard();
create trigger uc_company_withheld_open_bill before insert on uc_company_withheld_payments for each row execute function uc_company_open_obligation_guard();
revoke all on function uc_company_open_obligation_guard() from public,anon,authenticated,service_role;
-- Withheld payments on replacement bills use their audited invoice and AP limit.
do $$ declare body text;invoice_clause text:='if not exists(select 1 from uc_company_payment_documents where payment_id=bill.id and kind=''invoice'' and state=''confirmed'') then';limit_clause text:='if bill_amount>credit-bill_paid then';begin
 select pg_get_functiondef('uc_receipts_before_company_trade_ins(text,text,jsonb)'::regprocedure) into body;
 if position(invoice_clause in body)=0 or position(limit_clause in body)=0 then raise exception 'WITHHELD_SOURCE_REVIEW_REQUIRED';end if;
 body:=replace(body,invoice_clause,'if not exists(select 1 from uc_company_payment_documents where payment_id=bill.id and kind=''invoice'' and state=''confirmed'') and uc_supplier_adjustment_invoice(bill.id) is null then');
 body:=replace(body,limit_clause,'if uc_consignment_bill_limit(bill.id) is not null then credit:=uc_consignment_bill_limit(bill.id);end if; '||limit_clause);
 execute body;
end $$;
grant execute on function uc_company_bill_adjustment(text,text,jsonb) to service_role;
commit;
