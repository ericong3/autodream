-- Payments stopped loading in the app after 20261121000200_loan_deductions.sql.
-- That migration renamed uc_company_paid_cents to
-- uc_company_paid_cents_before_deductions, created a new uc_company_paid_cents,
-- and revoked both from service_role. The payments view the server reads
-- (uc_private_payment_rows) runs as service_role and still called the renamed
-- function, so every read of a payment failed ("Could not confirm this finance
-- change"), and the app fell back to the copy saved on the device.
--
-- Rebuild the view so it calls the new uc_company_paid_cents (which also counts
-- loan deductions as paid) and let service_role call it again. Rebuilt rather
-- than replaced because payments has gained columns (obligation_replaced,
-- panel_approved) since the view was made; the view now carries them too.
begin;

drop view public.uc_private_payment_rows;
create view public.uc_private_payment_rows as
 select p.*,case when p.status='transferred' then coalesce(uc_commission_cents(to_jsonb(p)->'amount'),0) else uc_company_paid_cents(p.id) end bank_paid_cents from payments p
 union all select (jsonb_populate_record(null::public.payments,r.row_data)).*,case when r.row_data->>'status'='transferred' then uc_commission_cents(r.row_data->'amount') else 0 end bank_paid_cents from uc_investor_commission_bills c
 cross join lateral(select uc_commission_payment_row(c.bill_id) row_data) r where r.row_data is not null;
revoke all on uc_private_payment_rows from public,anon,authenticated,service_role;
grant select on uc_private_payment_rows to service_role;
-- The view calls these as service_role.
grant execute on function uc_company_paid_cents(text),uc_commission_cents(jsonb) to service_role;

notify pgrst,'reload schema';
commit;
