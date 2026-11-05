-- PREPARED ONLY: unpaid direct repair/misc amount corrections. No bank reversal.
begin;
create table uc_consignment_bill_corrections(
 id uuid primary key default gen_random_uuid(),car_id text not null references uc_consignment_cases(car_id),payment_id text not null references payments(id),actor_id text not null references garage_building_staff(id),request_id text not null,expected_revision text not null,reason text not null check(length(reason) between 5 and 1000),invoice_document_id uuid not null unique references uc_company_payment_documents(id),before_payment jsonb not null,after_payment jsonb not null,before_source jsonb not null,after_source jsonb not null,journal_id text references journal_entries(id) deferrable initially deferred,transaction_id bigint not null default txid_current(),created_at timestamptz not null default clock_timestamp(),unique(actor_id,request_id),foreign key(actor_id,request_id) references uc_consignment_commands(actor_id,request_id) deferrable initially deferred
);
alter table uc_consignment_bill_corrections enable row level security;
revoke all on uc_consignment_bill_corrections from public,anon,authenticated,service_role;
create trigger uc_consignment_bill_corrections_fixed before update or delete on uc_consignment_bill_corrections for each row execute function uc_investor_immutable();
create trigger uc_consignment_bill_corrections_no_truncate before truncate on uc_consignment_bill_corrections execute function uc_investor_immutable();
create or replace function uc_consignment_bill_correction_allowed(p_before jsonb,p_after jsonb) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select p_before->>'status'='pending' and p_after->>'status'='pending' and p_before-'amount'=p_after-'amount' and uc_company_paid_cents(p_before->>'id')=0 and not exists(select 1 from uc_company_payment_documents where payment_id=p_before->>'id' and kind='payment' and state='confirmed') and exists(select 1 from uc_consignment_bill_corrections x join uc_consignment_cases k on k.car_id=x.car_id where x.payment_id=p_before->>'id' and k.approved_at is null and x.transaction_id=txid_current() and x.before_payment=p_before and x.after_payment=p_after)
$$;
alter function uc_consignment_view(text) rename to uc_consignment_view_before_bills;
create function uc_consignment_view(p_car text) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select uc_consignment_view_before_bills(p_car)||jsonb_build_object('billRevision',md5(jsonb_build_object('car',(select to_jsonb(c) from cars c where id=p_car),'payments',(select jsonb_agg(to_jsonb(p) order by p.id) from payments p where car_id=p_car),'repairs',(select jsonb_agg(to_jsonb(r) order by r.id) from repairs r where car_id=p_car),'journals',(select jsonb_agg(to_jsonb(j) order by j.id) from journal_entries j where car_id=p_car),'invoices',(select jsonb_agg(to_jsonb(d) order by d.id) from uc_company_payment_documents d join payments p on p.id=d.payment_id where p.car_id=p_car))::text),'billInvoices',coalesce((select jsonb_agg(jsonb_build_object('paymentId',p.id,'documentId',d.id,'name',d.file_name) order by d.created_at,d.id) from uc_company_payment_documents d join payments p on p.id=d.payment_id where p.car_id=p_car and p.type in ('repair','misc_cost') and d.kind='invoice' and d.state='confirmed' and d.bound_payment->>'status'='pending' and uc_commission_cents(d.bound_payment->'amount')=uc_commission_cents(to_jsonb(p)->'amount') and d.confirmed_at>coalesce((select max(created_at) from uc_consignment_bill_corrections where payment_id=p.id),'-infinity'::timestamptz) and not exists(select 1 from uc_consignment_bill_corrections where invoice_document_id=d.id)),'[]'::jsonb),'billCorrections',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('actorName',(select name from garage_building_staff where id=x.actor_id)) order by x.created_at,x.id) from uc_consignment_bill_corrections x where x.car_id=p_car),'[]'::jsonb))
$$;
alter function uc_consignment_finance(text,text,jsonb) rename to uc_consignment_finance_before_bills;
create function uc_consignment_finance(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;k uc_consignment_cases;p payments;c cars;r repairs;cmd uc_consignment_commands;cid text;req text;amount bigint;old_amount bigint;delta bigint;credit numeric;deb numeric;account text;accounts integer;before_source jsonb;after_source jsonb;after_payment jsonb;jid text;lines jsonb;ctx text;v_misc_id text;items jsonb;new_items jsonb;v_count integer;correction_id uuid:=gen_random_uuid();
begin
 if p_action<>'correct_bill' then return uc_consignment_finance_before_bills(p_actor,p_action,p_data);end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) x where x<>all(array['carId','paymentId','amountCents','invoiceDocumentId','reason','expectedRevision','requestId'])) or jsonb_typeof(p_data->'reason') is distinct from 'string' or length(trim(p_data->>'reason')) not between 5 and 1000 or p_data->>'reason'~'[[:cntrl:]]' or jsonb_typeof(p_data->'amountCents') is distinct from 'number' or coalesce(p_data->>'amountCents','')!~'^[1-9][0-9]{0,11}$' or coalesce(p_data->>'expectedRevision','')!~'^[0-9a-f]{32}$' then raise exception 'INVALID';end if;
 cid:=p_data->>'carId';req:=p_data->>'requestId';amount:=(p_data->>'amountCents')::bigint;
 if coalesce(cid,'')!~'^[A-Za-z0-9_-]{1,100}$' or coalesce(req,'')!~'^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));perform pg_advisory_xact_lock(hashtextextended('consignment:'||p_actor||':'||req,0));
 select * into cmd from uc_consignment_commands where actor_id=p_actor and request_id=req;
 if found then if cmd.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;return uc_consignment_view(cid)||jsonb_build_object('car',(select to_jsonb(v) from cars v where id=cid),'repairs',coalesce((select jsonb_agg(to_jsonb(rr) order by rr.id) from repairs rr where car_id=cid),'[]'::jsonb),'journals',coalesce((select jsonb_agg(to_jsonb(j)) from journal_entries j join uc_consignment_bill_corrections x on x.journal_id=j.id where x.actor_id=p_actor and x.request_id=req),'[]'::jsonb));end if;
 select * into c from cars where id=cid for update;select * into k from uc_consignment_cases where car_id=cid for update;
 if k.car_id is null then raise exception 'CONSIGNMENT_CASE_REQUIRED';end if;if k.approved_at is not null then raise exception 'CONSIGNMENT_APPROVED_CORRECTION_REQUIRED';end if;
 perform 1 from payments where car_id=cid order by id for update;perform 1 from repairs where car_id=cid order by id for update;
 select * into p from payments where id=p_data->>'paymentId' and car_id=cid;
 if p.id is null or p.type not in ('repair','misc_cost') or p.claim_confirmed_by is not null then raise exception 'DIRECT_CAR_BILL_REQUIRED';end if;
 if p.status is distinct from 'pending' or uc_company_paid_cents(p.id)>0 or exists(select 1 from uc_company_payment_documents where payment_id=p.id and kind='payment' and state='confirmed') or exists(select 1 from journal_entries where source_id=p.id and source_type like '%\_paid' escape '\' and not coalesce(voided,false)) then raise exception 'PAID_BILL_ADJUSTMENT_REQUIRED';end if;
 if uc_consignment_view(cid)->>'billRevision' is distinct from p_data->>'expectedRevision' then raise exception 'SOURCE_CHANGED';end if;
 if not exists(select 1 from uc_company_payment_documents where id=(p_data->>'invoiceDocumentId')::uuid and payment_id=p.id and kind='invoice' and state='confirmed' and bound_payment->>'status'='pending' and uc_commission_cents(bound_payment->'amount')=uc_commission_cents(to_jsonb(p)->'amount') and confirmed_at>coalesce((select max(created_at) from uc_consignment_bill_corrections where payment_id=p.id),'-infinity'::timestamptz) and not exists(select 1 from uc_consignment_bill_corrections where invoice_document_id=(p_data->>'invoiceDocumentId')::uuid)) then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
 old_amount:=uc_commission_cents(to_jsonb(p)->'amount');if old_amount=amount then raise exception 'NO_CORRECTION_CHANGE';end if;if coalesce(old_amount,0)<=0 then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
 if p.type='repair' then
  select * into r from repairs where id=to_jsonb(p)->>'repair_job_id' and car_id=cid and status='done';
  if r.id is null or coalesce(uc_commission_cents(to_jsonb(r)->'actual_cost'),uc_commission_cents(to_jsonb(r)->'total_cost'),0)<>old_amount or (select count(*) from payments where car_id=cid and type in ('repair','expense_claim') and to_jsonb(payments)->>'repair_job_id'=r.id)<>1 then raise exception 'DIRECT_CAR_BILL_REQUIRED';end if;
  before_source:=to_jsonb(r);after_source:=before_source||jsonb_build_object('actual_cost',amount::numeric/100);
 else
  v_misc_id:=to_jsonb(p)->>'misc_cost_id';if nullif(v_misc_id,'') is null then raise exception 'DIRECT_CAR_BILL_REQUIRED';end if;
  items:=coalesce(nullif(c.misc_costs,'null'::jsonb),'[]'::jsonb);
  if exists(select 1 from jsonb_array_elements(coalesce(nullif(to_jsonb(c)->'disbursement_charges','null'::jsonb),'[]'::jsonb)) x where x->>'id'=v_misc_id) then raise exception 'DIRECT_CAR_BILL_REQUIRED';end if;
  select count(*) into v_count from jsonb_array_elements(items) x where x->>'id'=v_misc_id and uc_commission_cents(x->'amount')=old_amount;
  if v_count<>1 or (select count(*) from jsonb_array_elements(items) x where x->>'id'=v_misc_id)<>1 or (select count(*) from payments where car_id=cid and to_jsonb(payments)->>'misc_cost_id'=v_misc_id)<>1 then raise exception 'DIRECT_CAR_BILL_REQUIRED';end if;
  before_source:=jsonb_build_object('misc_costs',c.misc_costs,'disbursement_charges',to_jsonb(c)->'disbursement_charges');
  select jsonb_agg(case when x->>'id'=v_misc_id then jsonb_set(x,'{amount}',to_jsonb(amount::numeric/100)) else x end order by ord) into new_items from jsonb_array_elements(coalesce(nullif(c.misc_costs,'null'::jsonb),'[]'::jsonb)) with ordinality t(x,ord);
  after_source:=jsonb_build_object('misc_costs',coalesce(new_items,'[]'::jsonb));
  select jsonb_agg(case when x->>'id'=v_misc_id then jsonb_set(x,'{amount}',to_jsonb(amount::numeric/100)) else x end order by ord) into new_items from jsonb_array_elements(coalesce(nullif(to_jsonb(c)->'disbursement_charges','null'::jsonb),'[]'::jsonb)) with ordinality t(x,ord);
  after_source:=after_source||jsonb_build_object('disbursement_charges',coalesce(new_items,'[]'::jsonb));
 end if;
 perform 1 from journal_entries where source_type=p.type and journal_entries.source_id=p.id and not coalesce(voided,false) order by id for update;
 select coalesce(sum(((l->>'credit')::numeric-(l->>'debit')::numeric)*100),0) into credit from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.source_type=p.type and j.source_id=p.id and not coalesce(j.voided,false) and l->>'accountId'='acct-ap';
 if credit<>0 then
  select count(*),min(a.id),sum(a.cents) into accounts,account,deb from (select l->>'accountId' id,sum(((l->>'debit')::numeric-(l->>'credit')::numeric)*100) cents from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.source_type=p.type and j.source_id=p.id and not coalesce(j.voided,false) and l->>'accountId'<>'acct-ap' group by l->>'accountId' having sum((l->>'debit')::numeric-(l->>'credit')::numeric)<>0) a;
  if credit<>old_amount or accounts<>1 or deb<>old_amount or not exists(select 1 from ledger_accounts where id=account and type in ('asset','expense') and id not like 'acct-bank%' and id not in ('acct-ar','acct-consignor-ar','acct-inv-investor')) then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
  delta:=amount-old_amount;lines:=case when delta>0 then jsonb_build_array(jsonb_build_object('accountId',account,'debit',delta::numeric/100,'credit',0),jsonb_build_object('accountId','acct-ap','debit',0,'credit',delta::numeric/100)) else jsonb_build_array(jsonb_build_object('accountId','acct-ap','debit',-delta::numeric/100,'credit',0),jsonb_build_object('accountId',account,'debit',0,'credit',-delta::numeric/100)) end;jid:='consign-bill-correction:'||correction_id;
 elsif exists(select 1 from journal_entries where source_type=p.type and journal_entries.source_id=p.id and not coalesce(voided,false)) then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
 after_payment:=to_jsonb(p)||jsonb_build_object('amount',amount::numeric/100);
 insert into uc_consignment_bill_corrections(id,car_id,payment_id,actor_id,request_id,expected_revision,reason,invoice_document_id,before_payment,after_payment,before_source,after_source,journal_id) values(correction_id,cid,p.id,p_actor,req,p_data->>'expectedRevision',trim(p_data->>'reason'),(p_data->>'invoiceDocumentId')::uuid,to_jsonb(p),after_payment,before_source,after_source,jid);
 ctx:=current_setting('autodream.consignment_write',true);perform set_config('autodream.consignment_write',txid_current()::text||':'||cid,true);
 if p.type='repair' then update repairs set actual_cost=amount::numeric/100 where id=r.id;else update cars set misc_costs=after_source->'misc_costs',disbursement_charges=after_source->'disbursement_charges' where id=cid;end if;
 update payments set amount=(p_data->>'amountCents')::numeric/100 where id=p.id;
 if jid is not null then insert into journal_entries(id,date,description,source_type,source_id,car_id,created_by,lines) values(jid,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Director bill correction: '||trim(p_data->>'reason'),p.type,p.id,cid,p_actor,lines);end if;
 insert into uc_consignment_commands(actor_id,request_id,payload,car_id) values(p_actor,req,jsonb_build_object('action',p_action,'data',p_data),cid);
 perform set_config('autodream.consignment_write',coalesce(ctx,''),true);
 return uc_consignment_view(cid)||jsonb_build_object('car',(select to_jsonb(v) from cars v where id=cid),'repairs',coalesce((select jsonb_agg(to_jsonb(rr) order by rr.id) from repairs rr where car_id=cid),'[]'::jsonb),'journals',coalesce((select jsonb_agg(to_jsonb(j)) from journal_entries j where id=jid),'[]'::jsonb));
end $$;
create function uc_consignment_corrected_source_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id text;v_before jsonb;v_after jsonb;begin
 if tg_table_name='payments' then
  if (to_jsonb(old)->'repair_job_id',to_jsonb(old)->'misc_cost_id',old.car_id,old.type) is distinct from (to_jsonb(new)->'repair_job_id',to_jsonb(new)->'misc_cost_id',new.car_id,new.type) and exists(select 1 from uc_consignment_bill_corrections where payment_id=old.id) then raise exception 'USE_CONSIGNMENT_BILL_CORRECTION';end if;return new;
 elsif tg_table_name='repairs' then
  if (old.car_id,old.status,old.actual_cost,old.total_cost) is distinct from (new.car_id,new.status,new.actual_cost,new.total_cost) and exists(select 1 from uc_consignment_bill_corrections x where x.before_payment->>'type'='repair' and x.before_source->>'id'=old.id) and not exists(select 1 from uc_consignment_bill_corrections x where x.transaction_id=txid_current() and x.before_source=to_jsonb(old) and x.after_source=to_jsonb(new)) then raise exception 'USE_CONSIGNMENT_BILL_CORRECTION';end if;
 else
  for v_id in select distinct x.before_payment->>'misc_cost_id' from uc_consignment_bill_corrections x where x.car_id=old.id and x.before_payment->>'type'='misc_cost' loop
   select x->'amount' into v_before from jsonb_array_elements(coalesce(nullif(old.misc_costs,'null'::jsonb),'[]'::jsonb)) x where x->>'id'=v_id;
   select x->'amount' into v_after from jsonb_array_elements(coalesce(nullif(new.misc_costs,'null'::jsonb),'[]'::jsonb)) x where x->>'id'=v_id;
   if v_before is distinct from v_after and not exists(select 1 from uc_consignment_bill_corrections x where x.car_id=old.id and x.transaction_id=txid_current() and x.before_source=jsonb_build_object('misc_costs',old.misc_costs,'disbursement_charges',to_jsonb(old)->'disbursement_charges') and x.after_source=jsonb_build_object('misc_costs',new.misc_costs,'disbursement_charges',to_jsonb(new)->'disbursement_charges')) then raise exception 'USE_CONSIGNMENT_BILL_CORRECTION';end if;
  end loop;
 end if;return new;end $$;
create trigger uc_consignment_corrected_bill_link before update on payments for each row execute function uc_consignment_corrected_source_guard();
create trigger uc_consignment_corrected_repair before update on repairs for each row execute function uc_consignment_corrected_source_guard();
create trigger uc_consignment_corrected_misc before update on cars for each row execute function uc_consignment_corrected_source_guard();
revoke all on function uc_consignment_corrected_source_guard() from public,anon,authenticated,service_role;
revoke all on function uc_consignment_view_before_bills(text),uc_consignment_view(text),uc_consignment_finance_before_bills(text,text,jsonb),uc_consignment_finance(text,text,jsonb),uc_consignment_bill_correction_allowed(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_consignment_finance(text,text,jsonb) to service_role;
commit;
