-- New evidence only. Existing storage buckets/policies retain their behavior.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('garage-payment-proofs','garage-payment-proofs',false,2097152,array['image/jpeg','image/png','image/webp','application/pdf']);
-- Existing permissive ALL policies must not expose this new private bucket.
create policy garage_payment_proofs_private on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'garage-payment-proofs') with check(bucket_id<>'garage-payment-proofs');
