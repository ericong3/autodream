-- Supplier refunds are physical receipts, but are not customer sale money.
begin;
create function uc_company_sale_receipt_exists(p_car text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from uc_company_bank_receipts r join payments p on p.id=r.payment_id
 where r.car_id=p_car and p.type in('customer_collection','loan_disbursement','consignment_collection'))
$$;
create or replace function uc_company_receipt_journal_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op<>'INSERT' and old.id like 'company-receipt:%' then raise exception 'BANK_PAYMENT_IMMUTABLE';end if;
 if tg_op<>'INSERT' and old.source_type='car_sold' and uc_company_sale_receipt_exists(old.car_id) then raise exception 'BANK_PAYMENT_IMMUTABLE';end if;
 if tg_op<>'INSERT' and exists(select 1 from uc_company_withheld_payments w join payments p on p.id=w.payment_id where old.source_type=p.type and old.source_id=p.id) then raise exception 'BANK_PAYMENT_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
-- Preserve the full existing customer-hold calculation and its place in the
-- wrapper chain. Change only the two receipt-origin predicates.
do $$ declare body text;needle text:='exists(select 1 from uc_company_bank_receipts where car_id=j.car_id)';begin
 select pg_get_functiondef('uc_company_position_before_consignments()'::regprocedure) into body;
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>2 then raise exception 'CUSTOMER_HOLD_CLASSIFICATION_REVIEW_REQUIRED';end if;
 execute replace(body,needle,'uc_company_sale_receipt_exists(j.car_id)');
end $$;
revoke all on function uc_company_sale_receipt_exists(text),uc_company_receipt_journal_guard() from public,anon,authenticated,service_role;
commit;
