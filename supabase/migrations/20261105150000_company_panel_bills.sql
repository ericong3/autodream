-- PREPARED ONLY. Invoice-backed company-owned car panel bills.
begin;
insert into ledger_accounts(id,name,type) values('acct-exp-panel','Dealer panel fees','expense') on conflict(id) do nothing;
create table uc_company_panel_approvals(payment_id text primary key references payments(id),car_id text not null unique references cars(id),amount_cents bigint not null check(amount_cents>0),source_journal_id text not null references journal_entries(id) deferrable initially deferred,approved_by text not null references garage_building_staff(id),approved_at timestamptz not null default now(),request_id text not null,payload jsonb not null,before_payment jsonb not null,after_payment jsonb not null,transaction_id bigint not null default txid_current(),unique(approved_by,request_id));
alter table uc_company_panel_approvals enable row level security;
revoke all on uc_company_panel_approvals from public,anon,authenticated,service_role;
create trigger uc_company_panel_fixed before update or delete on uc_company_panel_approvals for each row execute function uc_investor_immutable();
create trigger uc_company_panel_no_truncate before truncate on uc_company_panel_approvals execute function uc_investor_immutable();
alter table payments add column panel_approved boolean not null default false;
create or replace function uc_company_panel_allowed(p_payment text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select exists(select 1 from uc_company_panel_approvals where payment_id=p_payment) $$;
create function uc_company_panel(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;p payments;c cars;party jsonb;approval uc_company_panel_approvals;revision text;amount bigint;credit numeric;expense numeric;journal_count integer;jid text;req text;before_pay jsonb;after_pay jsonb;begin
 select * into actor from garage_building_staff where id=p_actor for share;if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_action not in ('review','approve') or jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) x where x<>all(case when p_action='review' then array['paymentId'] else array['paymentId','expectedRevision','requestId'] end)) then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 if p_action='approve' then req:=p_data->>'requestId';if coalesce(req,'')!~'^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;perform pg_advisory_xact_lock(hashtextextended('company-panel:'||p_actor||':'||req,0));select * into approval from uc_company_panel_approvals where approved_by=p_actor and request_id=req;if found then if approval.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return jsonb_build_object('approved',true,'paymentId',approval.payment_id,'payments',(select jsonb_agg(to_jsonb(s)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(s.id))) from payments s where id=approval.payment_id),'journals',(select jsonb_agg(to_jsonb(j)) from journal_entries j where id=approval.source_journal_id));end if;end if;
 select * into p from payments where id=p_data->>'paymentId' for update;if p.id is null or p.type<>'panel_charge' then raise exception 'PANEL_BILL_REQUIRED';end if;
 select * into approval from uc_company_panel_approvals where payment_id=p.id;
 if approval.payment_id is not null or exists(select 1 from uc_consignment_bill_sources where payment_id=p.id) then return jsonb_build_object('approved',true,'paymentId',p.id,'name',p.recipient_name,'amountCents',uc_commission_cents(to_jsonb(p)->'amount'),'payments',jsonb_build_array(to_jsonb(p)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(p.id))),'journals',coalesce((select jsonb_agg(to_jsonb(j)) from journal_entries j where j.id=approval.source_journal_id),'[]'::jsonb));end if;
 select * into c from cars where id=p.car_id for update;
 if c.id is null or c.investor_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true' or exists(select 1 from uc_investor_cars where car_id=c.id) or c.consignment is not null and c.consignment<>'null'::jsonb then raise exception 'PANEL_SEPARATE_WORKFLOW';end if;
 if exists(select 1 from uc_company_panel_approvals where car_id=c.id and payment_id<>p.id) then raise exception 'PANEL_BILL_EXISTS';end if;
 amount:=uc_commission_cents(to_jsonb(c)->'panel_charge_amount');if coalesce(amount,0)<=0 or amount<>uc_commission_cents(to_jsonb(p)->'amount') or p.recipient_type<>'dealer' or p.recipient_id is distinct from to_jsonb(c)->>'panel_dealer_id' or p.status<>'pending' or uc_company_paid_cents(p.id)>0 then raise exception 'PANEL_SOURCE_REVIEW';end if;
 select to_jsonb(d) into party from dealers d where id=p.recipient_id;
 if party is not null then party:=party||jsonb_build_object('bankName',coalesce(nullif(party->>'bankName',''),party->>'bank_name'),'bankAccountNumber',coalesce(nullif(party->>'bankAccountNumber',''),party->>'bank_account_number'),'bankAccountHolder',coalesce(nullif(party->>'bankAccountHolder',''),party->>'bank_account_holder'));end if;
 if party is null or exists(select 1 from unnest(array['bankName','bankAccountNumber','bankAccountHolder']) x where nullif(trim(party->>x),'') is null) then raise exception 'DEALER_BANK_DETAILS_REQUIRED';end if;
 revision:=md5(jsonb_build_object('payment',to_jsonb(p),'car',to_jsonb(c),'party',party,'invoices',(select jsonb_agg(to_jsonb(d) order by d.id) from uc_company_payment_documents d where payment_id=p.id and state='confirmed'))::text);
 if p_action='review' then return jsonb_build_object('approved',false,'paymentId',p.id,'name',party->>'name','bankName',party->>'bankName','accountLast4',right(party->>'bankAccountNumber',4),'amountCents',amount,'sourceRevision',revision,'invoiceReady',exists(select 1 from uc_company_payment_documents where payment_id=p.id and kind='invoice' and state='confirmed'));end if;
 if revision is distinct from p_data->>'expectedRevision' then raise exception 'SOURCE_CHANGED';end if;
 if not exists(select 1 from uc_company_payment_documents where payment_id=p.id and kind='invoice' and state='confirmed') then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
 select count(distinct j.id),min(j.id),coalesce(sum(case when l->>'accountId'='acct-ap' then ((l->>'credit')::numeric-(l->>'debit')::numeric)*100 else 0 end),0),coalesce(sum(case when a.type='expense' then ((l->>'debit')::numeric-(l->>'credit')::numeric)*100 else 0 end),0) into journal_count,jid,credit,expense from journal_entries j cross join lateral jsonb_array_elements(j.lines) l left join ledger_accounts a on a.id=l->>'accountId' where j.source_type='panel_charge' and j.source_id=p.id and not coalesce(j.voided,false);
 if journal_count=0 then jid:='company-panel:'||p.id;elsif journal_count<>1 or credit<>amount or expense<>amount then raise exception 'BILL_LEDGER_REVIEW_REQUIRED';end if;
 before_pay:=to_jsonb(p);after_pay:=before_pay||jsonb_build_object('panel_approved',true,'bank_name',party->>'bankName','account_number',party->>'bankAccountNumber','account_holder',party->>'bankAccountHolder');
 insert into uc_company_panel_approvals values(p.id,c.id,amount,jid,p_actor,now(),req,p_data,before_pay,after_pay,txid_current());
 update payments set panel_approved=true,bank_name=party->>'bankName',account_number=party->>'bankAccountNumber',account_holder=party->>'bankAccountHolder' where id=p.id;
 if journal_count=0 then insert into journal_entries(id,date,description,source_type,source_id,car_id,created_by,lines) values(jid,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Approved dealer panel bill','panel_charge',p.id,c.id,p_actor,jsonb_build_array(jsonb_build_object('accountId','acct-exp-panel','debit',amount::numeric/100,'credit',0),jsonb_build_object('accountId','acct-ap','debit',0,'credit',amount::numeric/100)));end if;
 return jsonb_build_object('approved',true,'paymentId',p.id,'payments',(select jsonb_agg(to_jsonb(s)||jsonb_build_object('bank_paid_cents',uc_company_paid_cents(s.id))) from payments s where id=p.id),'journals',(select jsonb_agg(to_jsonb(j)) from journal_entries j where id=jid));
end $$;
create function uc_company_panel_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare a uc_company_panel_approvals;begin
 if tg_table_name='payments' then
  if tg_op='INSERT' then if new.panel_approved then raise exception 'USE_PANEL_APPROVAL';end if;return new;end if;
  select * into a from uc_company_panel_approvals where payment_id=old.id;
  if a.payment_id is not null and a.transaction_id=txid_current() and a.before_payment=to_jsonb(old) and a.after_payment=to_jsonb(new) then return new;end if;
  if new.panel_approved is distinct from old.panel_approved or a.payment_id is not null and exists(select 1 from unnest(array['amount','type','recipient_id','recipient_type','recipient_name','car_id','bank_name','account_number','account_holder']) x where to_jsonb(old)->x is distinct from to_jsonb(new)->x) then raise exception 'PANEL_BILL_ADJUSTMENT_REQUIRED';end if;
 elsif tg_table_name='cars' then
  if (old.panel_dealer_id,old.panel_charge_amount) is distinct from (new.panel_dealer_id,new.panel_charge_amount) and exists(select 1 from uc_company_panel_approvals where car_id=old.id) then raise exception 'PANEL_BILL_ADJUSTMENT_REQUIRED';end if;
 else
  if tg_op<>'INSERT' and exists(select 1 from uc_company_panel_approvals where source_journal_id=old.id) then raise exception 'PANEL_BILL_ADJUSTMENT_REQUIRED';end if;
  if tg_op='INSERT' and new.source_type='panel_charge' and exists(select 1 from uc_company_panel_approvals where payment_id=new.source_id and not(transaction_id=txid_current() and source_journal_id=new.id)) then raise exception 'PANEL_BILL_ADJUSTMENT_REQUIRED';end if;
 end if;if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger uc_company_panel_payment_guard before insert or update on payments for each row execute function uc_company_panel_guard();
create trigger uc_company_panel_car_guard before update on cars for each row execute function uc_company_panel_guard();
create trigger uc_company_panel_journal_guard before insert or update or delete on journal_entries for each row execute function uc_company_panel_guard();
alter function uc_company_cash_position() rename to uc_company_position_before_panel;
create function uc_company_cash_position() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$ declare result jsonb;reserved bigint;begin result:=uc_company_position_before_panel();select coalesce(sum(greatest(0,a.amount_cents-uc_company_paid_cents(p.id))),0) into reserved from uc_company_panel_approvals a join payments p on p.id=a.payment_id where p.status='pending' and not p.obligation_replaced;return result||jsonb_build_object('unpaidCompanyCents',(result->>'unpaidCompanyCents')::bigint+reserved,'availableCents',(result->>'availableCents')::bigint-reserved);end $$;
revoke all on function uc_company_panel_allowed(text),uc_company_panel(text,text,jsonb),uc_company_panel_guard(),uc_company_position_before_panel(),uc_company_cash_position() from public,anon,authenticated,service_role;
grant execute on function uc_company_panel(text,text,jsonb) to service_role;
commit;
