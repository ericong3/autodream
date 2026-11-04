-- PREPARED ONLY. Not installed. Install after 20261104080000_investor_misc_bills.
-- Investor car bills only; company (non-investor) bills and claims are untouched.
--  * A bill can be approved only after a confirmed supplier invoice (kind
--    'bill') is attached. Enforced by a trigger, whichever function approves.
--  * pay_car_bill records money only when it names a confirmed, unused payment
--    receipt (kind 'receipt') prepared for that bill. The receipt is tied to the
--    bill, uploaded and storage-verified BEFORE the payment, then consumed by
--    exactly one cash entry in the same transaction that creates it. A trigger
--    refuses any car_expense cash row that did not pass this check.
--  * A linked investor can read confirmed documents for cars funded from their
--    own account only.
begin;
do $$ begin
 if to_regclass('public.uc_investor_documents') is null or to_regclass('public.uc_investor_misc_bills') is null
  or to_regprocedure('public.uc_investor_capital_phase2(text,text,jsonb)') is null then raise exception 'INVESTOR_MISC_BILLS_REQUIRED';end if;
 if to_regclass('public.uc_investor_payment_receipts') is not null or to_regprocedure('public.uc_investor_capital_phase3(text,text,jsonb)') is not null
  or to_regprocedure('public.uc_investor_activation_phase3(text,text,jsonb)') is not null then raise exception 'INVESTOR_REQUIRED_DOCUMENTS_ALREADY_INSTALLED';end if;
end $$;

-- ── Receipt documents: tied to the bill, not to a payment that does not exist yet
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.uc_investor_documents'::regclass and contype='c'
  and pg_get_constraintdef(oid) ~ '\mkind\M' loop
  execute format('alter table public.uc_investor_documents drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.uc_investor_documents add constraint uc_document_kind check(kind in ('bill','payment','receipt'));
alter table public.uc_investor_documents add constraint uc_document_entry check((kind='payment')=(entry_id is not null));

-- One receipt pays one cash entry; one cash entry consumes one receipt.
create table public.uc_investor_payment_receipts (
 entry_id uuid primary key references public.uc_investor_cash_entries(id),
 document_id uuid not null unique references public.uc_investor_documents(id),
 bill_id uuid not null references public.uc_investor_car_bills(id),
 actor_id text not null references public.garage_building_staff(id),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),
 created_at timestamptz not null default now(),
 unique(actor_id,request_id)
);
create function public.uc_payment_receipt_link_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from uc_investor_documents d where d.id=new.document_id and d.bill_id=new.bill_id and d.kind='receipt' and d.state='confirmed')
  or not exists(select 1 from uc_investor_cash_entries e where e.id=new.entry_id and e.bill_id=new.bill_id and e.kind='car_expense') then raise exception 'RECEIPT_NOT_FOR_BILL';end if;
 return new;
end $$;
create trigger uc_payment_receipt_link before insert on public.uc_investor_payment_receipts for each row execute function public.uc_payment_receipt_link_guard();
create trigger uc_payment_receipts_fixed before update or delete on public.uc_investor_payment_receipts for each row execute function public.uc_investor_immutable();
create trigger uc_payment_receipts_no_truncate before truncate on public.uc_investor_payment_receipts execute function public.uc_investor_immutable();

-- ── Supplier invoice before approval (every path) ───────────────────────────
create function public.uc_require_supplier_invoice() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then
  if new.state<>'pending' then raise exception 'BILL_REVIEW_REQUIRED';end if;
  return new;
 end if;
 if not exists(select 1 from uc_investor_documents d where d.bill_id=new.id and d.kind='bill' and d.state='confirmed') then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
 return new;
end $$;
create trigger uc_bill_starts_pending before insert on public.uc_investor_car_bills for each row execute function public.uc_require_supplier_invoice();
create trigger uc_bill_invoice_required before update of state on public.uc_investor_car_bills for each row
 when (old.state='pending' and new.state='approved') execute function public.uc_require_supplier_invoice();

-- ── Receipt before any bill money is recorded (every path) ─────────────────
-- Only the pay_car_bill wrapper opens this transaction-local gate, after it has
-- checked the receipt under the account lock. The gate is single use.
create function public.uc_require_payment_receipt() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(current_setting('autodream.uc_payment_receipt',true),'')<>'on:'||txid_current()::text||':'||new.bill_id::text then raise exception 'PAYMENT_RECEIPT_REQUIRED';end if;
 perform set_config('autodream.uc_payment_receipt','used:'||txid_current()::text||':'||new.bill_id::text,true);
 return new;
end $$;
create trigger uc_cash_receipt_required before insert on public.uc_investor_cash_entries for each row
 when (new.kind='car_expense') execute function public.uc_require_payment_receipt();

-- ── Command wrapper: receipt consumption and document read model ───────────
alter function public.uc_investor_capital(text,text,jsonb) rename to uc_investor_capital_phase3;
revoke all on function public.uc_investor_capital_phase3(text,text,jsonb) from public,anon,authenticated,service_role;

create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; prior uc_investor_commands; link uc_investor_payment_receipts; doc uc_investor_documents;
 bill uc_investor_car_bills; car uc_investor_cars; req text; receipt uuid; result jsonb; entry uuid;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action='pay_car_bill' then
  if not(p_data ? 'receiptDocumentId') then raise exception 'PAYMENT_RECEIPT_REQUIRED';end if;
  if jsonb_typeof(p_data->'receiptDocumentId') is distinct from 'string' or p_data->>'receiptDocumentId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_data->'billId') is distinct from 'string' or p_data->>'billId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_data->'carId') is distinct from 'string'
   or jsonb_typeof(p_data->'requestId') is distinct from 'string' or p_data->>'requestId' !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  select * into actor from garage_building_staff where id=p_actor for share;
  if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
  req:=p_data->>'requestId';receipt:=(p_data->>'receiptDocumentId')::uuid;
  -- Same lock the money commands take, so a replay cannot race the original.
  perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
  select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
  if found then
   -- Replay: the original command decides; no receipt is consumed again and
   -- no money is written. A different receipt is a changed request.
   select * into link from uc_investor_payment_receipts where actor_id=p_actor and request_id=req;
   if link.entry_id is not null and link.document_id<>receipt then raise exception 'REQUEST_CHANGED';end if;
   result:=uc_investor_capital_phase3(p_actor,p_action,p_data-'receiptDocumentId');
   if link.entry_id is not null then result:=result||jsonb_build_object('receiptDocumentId',link.document_id);end if;
   return result;
  end if;
  -- Account lock first (same order as every bill/document command), then the receipt.
  select * into car from uc_investor_cars where car_id=p_data->>'carId';
  if car.car_id is null then raise exception 'NOT_ALLOWED';end if;
  perform 1 from uc_investor_pots where id=car.pot_id for update;
  select * into bill from uc_investor_car_bills where id=(p_data->>'billId')::uuid and car_id=car.car_id;
  if bill.id is null then raise exception 'NOT_ALLOWED';end if;
  -- Also covers bills approved before this migration was installed.
  if not exists(select 1 from uc_investor_documents d where d.bill_id=bill.id and d.kind='bill' and d.state='confirmed') then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
  select * into doc from uc_investor_documents where id=receipt for update;
  if doc.id is null or doc.bill_id<>bill.id or doc.kind<>'receipt' then raise exception 'RECEIPT_NOT_FOR_BILL';end if;
  if doc.state<>'confirmed' then raise exception 'RECEIPT_NOT_CONFIRMED';end if;
  if exists(select 1 from uc_investor_payment_receipts where document_id=doc.id) then raise exception 'RECEIPT_ALREADY_USED';end if;
  perform set_config('autodream.uc_payment_receipt','on:'||txid_current()::text||':'||bill.id::text,true);
  result:=uc_investor_capital_phase3(p_actor,p_action,p_data-'receiptDocumentId');
  if coalesce(current_setting('autodream.uc_payment_receipt',true),'')<>'used:'||txid_current()::text||':'||bill.id::text then raise exception 'PAYMENT_RECEIPT_REQUIRED';end if;
  perform set_config('autodream.uc_payment_receipt','',true);
  entry:=(result->>'entryId')::uuid;
  insert into uc_investor_payment_receipts(entry_id,document_id,bill_id,actor_id,request_id) values(entry,doc.id,bill.id,p_actor,req);
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(car.pot_id,p_actor,'payment_receipt_linked',
   jsonb_build_object('requestId',req,'carId',car.car_id,'billId',bill.id,'entryId',entry,'documentId',doc.id));
  return result||jsonb_build_object('receiptDocumentId',doc.id);
 end if;

 result:=uc_investor_capital_phase3(p_actor,p_action,p_data);
 if p_action<>'car_snapshot' then return result;end if;
 -- Permission was checked by phase 2; re-check investor ownership before
 -- adding any document, since this layer now shows documents to investors.
 select * into actor from garage_building_staff where id=p_actor;
 select * into car from uc_investor_cars where car_id=result->>'carId';
 if car.car_id is null or actor.role not in ('director','admin','investor') then raise exception 'NOT_ALLOWED';end if;
 if actor.role='investor' and not exists(select 1 from uc_investor_pots p join uc_investor_profiles f on f.id=p.profile_id where p.id=car.pot_id and f.linked_staff_id=actor.id) then raise exception 'NOT_ALLOWED';end if;
 return result||jsonb_build_object('bills',coalesce((select jsonb_agg(b.value||jsonb_build_object(
   'supplierInvoiceConfirmed',exists(select 1 from uc_investor_documents d where d.bill_id=(b.value->>'id')::uuid and d.car_id=car.car_id and d.kind='bill' and d.state='confirmed'),
   'payments',coalesce((select jsonb_agg(p.value||jsonb_build_object('receiptDocumentId',r.document_id) order by p.ordinality)
    from jsonb_array_elements(b.value->'payments') with ordinality p left join uc_investor_payment_receipts r on r.entry_id=(p.value->>'id')::uuid),'[]'::jsonb),
   'documents',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',d.id,'name',d.file_name,'kind',d.kind,'entryId',coalesce(d.entry_id,r.entry_id),
     'used',case when d.kind='receipt' then r.entry_id is not null end)) order by d.confirmed_at,d.id)
    from uc_investor_documents d left join uc_investor_payment_receipts r on r.document_id=d.id
    where d.bill_id=(b.value->>'id')::uuid and d.car_id=car.car_id and d.state='confirmed'),'[]'::jsonb)
  ) order by b.ordinality) from jsonb_array_elements(result->'bills') with ordinality b),'[]'::jsonb));
end $$;

-- ── Activation wrapper: receipt preparation and investor document reads ────
alter function public.uc_investor_activation(text,text,jsonb) rename to uc_investor_activation_phase3;
revoke all on function public.uc_investor_activation_phase3(text,text,jsonb) from public,anon,authenticated,service_role;

create function public.uc_investor_activation(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; prior uc_investor_commands; doc uc_investor_documents; bill uc_investor_car_bills; car uc_investor_cars;
 req text; payload jsonb; path text;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action='proof_read' then
  select * into actor from garage_building_staff where id=p_actor for share;
  if actor.id is null or actor.role is distinct from 'investor' then return uc_investor_activation_phase3(p_actor,p_action,p_data);end if;
  if not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where k<>'documentId') or jsonb_typeof(p_data->'documentId') is distinct from 'string'
   or p_data->>'documentId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID';end if;
  -- Confirmed documents on a car funded from the investor's own account only.
  -- Missing, unconfirmed and other investors' documents look the same.
  select d.* into doc from uc_investor_documents d join uc_investor_car_bills b on b.id=d.bill_id and b.car_id=d.car_id
   join uc_investor_cars a on a.car_id=d.car_id join uc_investor_pots p on p.id=a.pot_id join uc_investor_profiles f on f.id=p.profile_id
   where d.id=(p_data->>'documentId')::uuid and d.state='confirmed' and f.linked_staff_id=actor.id;
  if doc.id is null then raise exception 'NOT_ALLOWED';end if;
  return jsonb_build_object('documentId',doc.id,'path',doc.storage_path,'fileName',doc.file_name,'mimeType',doc.mime_type);
 end if;
 if p_action<>'proof_prepare' or p_data->>'kind' is distinct from 'receipt' then return uc_investor_activation_phase3(p_actor,p_action,p_data);end if;

 -- Payment receipt prepared before the payment exists: tied to the bill only.
 -- proof_confirm (unchanged) verifies the stored object before it can be used.
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and actor.role in ('director','admin'),false) then raise exception 'NOT_ALLOWED';end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(array['billId','kind','fileName','mimeType','sha256','sizeBytes','requestId']))) then raise exception 'INVALID';end if;
 req:=p_data->>'requestId';
 if jsonb_typeof(p_data->'requestId') is distinct from 'string' or req !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
 payload:=jsonb_build_object('action',p_action,'data',p_data);
 select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
 if found then
  if prior.payload is distinct from payload then raise exception 'REQUEST_CHANGED';end if;
  select * into doc from uc_investor_documents where id=(prior.result->>'documentId')::uuid;
  if doc.id is null then raise exception 'INVALID';end if;
  return jsonb_build_object('documentId',doc.id,'path',doc.storage_path,'state',doc.state);
 end if;
 if jsonb_typeof(p_data->'billId') is distinct from 'string' or p_data->>'billId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_data->'fileName') is distinct from 'string' or p_data->>'fileName'<>trim(p_data->>'fileName') or length(p_data->>'fileName') not between 1 and 120 or p_data->>'fileName' ~ '[[:cntrl:]/\\]'
  or coalesce(p_data->>'mimeType','') not in ('image/png','image/jpeg','application/pdf') or coalesce(p_data->>'sha256','') !~ '^[0-9a-f]{64}$'
  or jsonb_typeof(p_data->'sizeBytes') is distinct from 'number' or p_data->>'sizeBytes' !~ '^[1-9][0-9]{0,6}$' or (p_data->>'sizeBytes')::integer>1400000 then raise exception 'INVALID';end if;
 select * into bill from uc_investor_car_bills where id=(p_data->>'billId')::uuid;
 if bill.id is null then raise exception 'NOT_ALLOWED';end if;
 select * into car from uc_investor_cars where car_id=bill.car_id;
 perform 1 from uc_investor_pots where id=car.pot_id for update;
 select * into bill from uc_investor_car_bills where id=bill.id for update;
 path:='bills/'||bill.id::text||'/receipt-'||(p_data->>'sha256')||
  case p_data->>'mimeType' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' else '.pdf' end;
 -- The same receipt file on the same bill is one document, whoever retries.
 select * into doc from uc_investor_documents where storage_path=path;
 if doc.id is null then
  if bill.state='voided' then raise exception 'BILL_VOIDED';end if;
  -- The supplier invoice is not proof that the supplier was paid.
  if exists(select 1 from uc_investor_documents where bill_id=bill.id and kind='bill' and sha256=p_data->>'sha256') then raise exception 'RECEIPT_SAME_AS_INVOICE';end if;
  if (select count(*) from uc_investor_documents where bill_id=bill.id)>=20 then raise exception 'PROOF_LIMIT';end if;
  insert into uc_investor_documents(car_id,bill_id,entry_id,kind,file_name,mime_type,size_bytes,sha256,storage_path,created_by,request_id)
  values(car.car_id,bill.id,null,'receipt',p_data->>'fileName',p_data->>'mimeType',(p_data->>'sizeBytes')::integer,p_data->>'sha256',path,p_actor,req) returning * into doc;
 end if;
 insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,payload,jsonb_build_object('documentId',doc.id));
 -- Path stays server-side; the HTTP layer never returns it to the browser.
 return jsonb_build_object('documentId',doc.id,'path',doc.storage_path,'state',doc.state);
end $$;

alter table public.uc_investor_payment_receipts enable row level security;
revoke all on table public.uc_investor_payment_receipts from public,anon,authenticated,service_role;
revoke all on function public.uc_payment_receipt_link_guard() from public,anon,authenticated,service_role;
revoke all on function public.uc_require_supplier_invoice() from public,anon,authenticated,service_role;
revoke all on function public.uc_require_payment_receipt() from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_activation(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_investor_capital(text,text,jsonb) to service_role;
grant execute on function public.uc_investor_activation(text,text,jsonb) to service_role;
commit;
