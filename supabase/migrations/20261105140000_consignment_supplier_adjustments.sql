-- PREPARED ONLY. Supplier credit-note / extra-bill amendments after settlement.
begin;
-- Preserve every existing payment kind, including payroll extensions installed live.
do $$ declare prior_check text;begin
 select pg_get_expr(conbin,conrelid) into prior_check from pg_constraint where conrelid='public.payments'::regclass and conname='payments_type_check' and contype='c';
 if prior_check is null then raise exception 'PAYMENT_TYPE_CONSTRAINT_REVIEW_REQUIRED';end if;
 alter table payments drop constraint payments_type_check;
 execute format('alter table payments add constraint payments_type_check check ((%s) or type=''supplier_credit_collection'')',prior_check);
end $$;
insert into ledger_accounts(id,name,type) values('acct-supplier-credit','Money owed back by suppliers','asset') on conflict(id) do nothing;
create table uc_consignment_supplier_adjustments(adjustment_id uuid primary key references uc_consignment_settlement_adjustments(id),root_payment_id text not null references payments(id),invoice_document_id uuid not null unique references uc_company_payment_documents(id),before_total_cents bigint not null check(before_total_cents>0),after_total_cents bigint not null check(after_total_cents>0),before_source jsonb not null,after_source jsonb not null,transaction_id bigint not null default txid_current());
alter table uc_consignment_supplier_adjustments enable row level security;
revoke all on uc_consignment_supplier_adjustments from public,anon,authenticated,service_role;
create trigger uc_consignment_supplier_adjustments_fixed before update or delete on uc_consignment_supplier_adjustments for each row execute function uc_investor_immutable();
create trigger uc_consignment_supplier_adjustments_no_truncate before truncate on uc_consignment_supplier_adjustments execute function uc_investor_immutable();
create or replace function uc_supplier_adjustment_invoice(p_payment text) returns uuid language sql stable security definer set search_path=public,pg_temp as $$ select x.invoice_document_id from uc_consignment_adjustment_obligations o join uc_consignment_supplier_adjustments x on x.adjustment_id=o.adjustment_id join uc_company_payment_documents d on d.id=x.invoice_document_id where o.payment_id=p_payment and o.root_bill_id=x.root_payment_id and o.root_bill_id is not null and d.kind='invoice' and d.state='confirmed' $$;
revoke all on function uc_supplier_adjustment_invoice(text) from public,anon,authenticated,service_role;
create or replace function uc_consignment_approved_source_allowed(p_car text,p_before jsonb,p_after jsonb) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from uc_consignment_supplier_adjustments x join uc_consignment_settlement_adjustments a on a.id=x.adjustment_id where a.car_id=p_car and x.transaction_id=txid_current() and x.before_source=p_before and x.after_source=p_after)
$$;
create function uc_consignment_supplier_plan(p_car text,p_data jsonb) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare k uc_consignment_cases;root payments;selected payments;c cars;r repairs;old_bill uc_consignment_supplier_adjustments;last_settlement jsonb;before_total bigint;after_total bigint;paid bigint;returned bigint;open_ap bigint;open_ar bigint;balance bigint;new_cost bigint;before_source jsonb;after_source jsonb;items jsonb;new_items jsonb;item_id text;family text[];invoice uc_company_payment_documents;begin
 select * into k from uc_consignment_cases where car_id=p_car;if k.approved_at is null then raise exception 'APPROVED_SETTLEMENT_REQUIRED';end if;
 if jsonb_typeof(p_data->'amountCents') is distinct from 'number' or coalesce(p_data->>'amountCents','')!~'^[1-9][0-9]{0,11}$' then raise exception 'INVALID';end if;after_total:=(p_data->>'amountCents')::bigint;
 select * into selected from payments where id=p_data->>'paymentId' and car_id=p_car;
 select * into root from payments where id=coalesce((select root_bill_id from uc_consignment_adjustment_obligations where payment_id=selected.id),selected.id) and car_id=p_car;
 if root.id is null or root.type not in ('repair','misc_cost') or root.claim_confirmed_by is not null or not exists(select 1 from uc_consignment_bill_sources where payment_id=root.id and car_id=p_car) then raise exception 'DIRECT_CAR_BILL_REQUIRED';end if;
 select array_agg(id order by id) into family from payments where id=root.id or id in(select payment_id from uc_consignment_adjustment_obligations where root_bill_id=root.id);
 if exists(select 1 from payments p where p.id=any(family) and p.status='transferred' and uc_company_paid_cents(p.id)<>uc_commission_cents(to_jsonb(p)->'amount')) or exists(select 1 from journal_entries j where j.source_id=any(family) and j.source_type like '%\_paid' escape '\' and j.id not like 'company-bank:%' and not coalesce(j.voided,false)) then raise exception 'SUPPLIER_HISTORY_REVIEW_REQUIRED';end if;
 select * into old_bill from uc_consignment_supplier_adjustments where root_payment_id=root.id order by (select created_at from uc_consignment_settlement_adjustments where id=adjustment_id) desc,adjustment_id desc limit 1;
 before_total:=coalesce(old_bill.after_total_cents,uc_commission_cents(to_jsonb(root)->'amount'));if before_total=after_total then raise exception 'NO_CORRECTION_CHANGE';end if;
 select * into invoice from uc_company_payment_documents where id=(p_data->>'invoiceDocumentId')::uuid and payment_id=any(family) and kind='invoice' and state='confirmed' and confirmed_at>greatest(coalesce((select created_at from uc_consignment_settlement_adjustments where id=old_bill.adjustment_id),'-infinity'::timestamptz),k.approved_at) and not exists(select 1 from uc_consignment_supplier_adjustments where invoice_document_id=(p_data->>'invoiceDocumentId')::uuid) and not exists(select 1 from uc_consignment_bill_corrections where invoice_document_id=(p_data->>'invoiceDocumentId')::uuid);
 if invoice.id is null then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
 select coalesce(sum(case when p.type<>'supplier_credit_collection' then uc_company_paid_cents(p.id) else 0 end),0),coalesce(sum(case when p.type='supplier_credit_collection' then uc_company_paid_cents(p.id) else 0 end),0),coalesce(sum(case when not p.obligation_replaced and p.type<>'supplier_credit_collection' then greatest(0,uc_commission_cents(to_jsonb(p)->'amount')-uc_company_paid_cents(p.id)) else 0 end),0),coalesce(sum(case when not p.obligation_replaced and p.type='supplier_credit_collection' then greatest(0,uc_commission_cents(to_jsonb(p)->'amount')-uc_company_paid_cents(p.id)) else 0 end),0) into paid,returned,open_ap,open_ar from payments p where id=any(family);
 if open_ap-open_ar<>before_total-paid+returned then raise exception 'SUPPLIER_HISTORY_REVIEW_REQUIRED';end if;
 select * into c from cars where id=p_car;
 if root.type='repair' then
  select * into r from repairs where id=to_jsonb(root)->>'repair_job_id' and car_id=p_car and status='done';
  if r.id is null or coalesce(uc_commission_cents(to_jsonb(r)->'actual_cost'),uc_commission_cents(to_jsonb(r)->'total_cost'))<>before_total or exists(select 1 from payments where car_id=p_car and to_jsonb(payments)->>'repair_job_id'=r.id and not(id=any(family))) then raise exception 'DIRECT_CAR_BILL_REQUIRED';end if;
  before_source:=to_jsonb(r);after_source:=before_source||jsonb_build_object('actual_cost',after_total::numeric/100);
 else
  item_id:=to_jsonb(root)->>'misc_cost_id';items:=coalesce(nullif(c.misc_costs,'null'::jsonb),'[]'::jsonb);
  if nullif(item_id,'') is null or (select count(*) from jsonb_array_elements(items) x where x->>'id'=item_id)<>1 or not exists(select 1 from jsonb_array_elements(items) x where x->>'id'=item_id and uc_commission_cents(x->'amount')=before_total) or exists(select 1 from payments where car_id=p_car and to_jsonb(payments)->>'misc_cost_id'=item_id and not(id=any(family))) then raise exception 'DIRECT_CAR_BILL_REQUIRED';end if;
  before_source:=jsonb_build_object('misc_costs',c.misc_costs,'disbursement_charges',to_jsonb(c)->'disbursement_charges');select jsonb_agg(case when x->>'id'=item_id then jsonb_set(x,'{amount}',to_jsonb(after_total::numeric/100)) else x end order by ord) into new_items from jsonb_array_elements(items) with ordinality t(x,ord);after_source:=before_source||jsonb_build_object('misc_costs',new_items);
 end if;
 select after_settlement into last_settlement from uc_consignment_settlement_adjustments where car_id=p_car order by created_at desc,id desc limit 1;last_settlement:=coalesce(last_settlement,k.settlement);
 new_cost:=(last_settlement->>'costCents')::bigint+after_total-before_total;if new_cost not between 0 and 1000000000000 then raise exception 'INVALID';end if;balance:=after_total-paid+returned;
 return jsonb_build_object('rootPaymentId',root.id,'root',to_jsonb(root),'family',to_jsonb(family),'beforeTotalCents',before_total,'afterTotalCents',after_total,'newCostCents',new_cost,'paidCents',paid,'receivedCents',returned,'oldPayableCents',open_ap,'oldReceivableCents',open_ar,'payableCents',greatest(0,balance),'receivableCents',greatest(0,-balance),'beforeSource',before_source,'afterSource',after_source,'invoice',to_jsonb(invoice),'dealerBasisPoints',coalesce((last_settlement->>'dealerBasisPoints')::integer,k.dealer_basis_points),'fixedCents',coalesce((last_settlement->>'fixedCents')::bigint,k.fixed_cents));
end $$;
alter function uc_consignment_view(text) rename to uc_consignment_view_before_supplier_review;
create function uc_consignment_view(p_car text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;root payments;family text[];latest uc_consignment_supplier_adjustments;totals jsonb:='[]';invoices jsonb:='[]';begin
 result:=uc_consignment_view_before_supplier_review(p_car);
 for root in select p.* from payments p join uc_consignment_bill_sources b on b.payment_id=p.id where p.car_id=p_car and p.type in ('repair','misc_cost') and not exists(select 1 from uc_consignment_adjustment_obligations x where x.payment_id=p.id and x.root_bill_id is not null) order by p.id loop
  select array_agg(p.id order by p.id) into family from payments p where p.id=root.id or p.id in(select payment_id from uc_consignment_adjustment_obligations where root_bill_id=root.id);
  select * into latest from uc_consignment_supplier_adjustments where root_payment_id=root.id order by (select created_at from uc_consignment_settlement_adjustments where id=adjustment_id) desc,adjustment_id desc limit 1;
  totals:=totals||jsonb_build_array(jsonb_build_object('rootPaymentId',root.id,'familyPaymentIds',family,'totalCents',coalesce(latest.after_total_cents,uc_commission_cents(to_jsonb(root)->'amount'))));
  invoices:=invoices||coalesce((select jsonb_agg(jsonb_build_object('rootPaymentId',root.id,'documentId',d.id,'name',d.file_name) order by d.confirmed_at,d.id) from uc_company_payment_documents d where d.payment_id=any(family) and d.kind='invoice' and d.state='confirmed' and d.confirmed_at>greatest(coalesce((select created_at from uc_consignment_settlement_adjustments where id=latest.adjustment_id),'-infinity'::timestamptz),(select approved_at from uc_consignment_cases where car_id=p_car)) and not exists(select 1 from uc_consignment_supplier_adjustments where invoice_document_id=d.id) and not exists(select 1 from uc_consignment_bill_corrections where invoice_document_id=d.id)),'[]'::jsonb);
 end loop;
 return result||jsonb_build_object('approvedBillTotals',totals,'supplierInvoices',invoices,'supplierCorrections',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('actorName',(select name from garage_building_staff where id=a.actor_id),'createdAt',a.created_at,'reason',a.reason) order by a.created_at,a.id) from uc_consignment_supplier_adjustments x join uc_consignment_settlement_adjustments a on a.id=x.adjustment_id where a.car_id=p_car),'[]'::jsonb));
end $$;
revoke all on function uc_consignment_view_before_supplier_review(text),uc_consignment_view(text) from public,anon,authenticated,service_role;
revoke all on function uc_consignment_approved_source_allowed(text,jsonb,jsonb),uc_consignment_supplier_plan(text,jsonb) from public,anon,authenticated,service_role;
commit;
