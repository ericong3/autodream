-- Proof-of-payment (receipt) uploaded when confirming a Pay Now work order —
-- photo, camera capture, or PDF. Private bucket, same pattern as
-- workshop-documents/loan-documents: only the storage path is kept on the
-- invoice row, a signed URL is generated on view.
alter table garage_invoices add column if not exists receipt_path text;
alter table garage_invoices add column if not exists receipt_name text;

insert into storage.buckets (id, name, public)
values ('garage-invoice-receipts', 'garage-invoice-receipts', false)
on conflict (id) do nothing;
