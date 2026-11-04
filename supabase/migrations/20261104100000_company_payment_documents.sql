-- PREPARED ONLY. Not installed. Company (non-investor) payment evidence.
-- Install order: after 20261104090000_investor_required_documents, and only
-- AFTER the private bridge release that serves scope 'company_evidence'
-- uploads (server/usedCar/companyEvidence.mjs) is deployed and verified.
-- Installing earlier blocks every new transfer, because nobody could upload
-- the receipt it requires. Uses the existing private finance review marker;
-- there is no separate installer flag.
--  * public.payments: any NEW move to 'transferred' (including a row inserted
--    as already transferred) needs a confirmed payment receipt. Outgoing bills
--    (repair, misc_cost, expense_claim, panel_charge, purchase_settlement)
--    also need a confirmed supplier invoice; so does confirming a claim.
--    Incoming money and payouts (commission, salary etc.) need the receipt
--    only. Rows already transferred before install are not rewritten.
--  * Once a document is confirmed the payment's type, amount, recipient and
--    car are fixed, so the document stays bound to what it proves.
--  * Documents are private, immutable and never hard deleted. Admin never
--    sees payroll payments; staff see the invoice on their own claim only;
--    investors have no company scope.
begin;
do $$ declare is_public boolean; begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' then
  raise exception 'PRIVATE_FINANCE_RELEASE_NOT_REVIEWED: deploy and verify the private evidence upload before requiring documents';
 end if;
 if to_regclass('public.uc_investor_payment_receipts') is null or to_regclass('public.payments') is null then raise exception 'INVESTOR_REQUIRED_DOCUMENTS_REQUIRED';end if;
 if to_regclass('public.uc_company_payment_documents') is not null or to_regprocedure('public.uc_company_evidence(text,text,jsonb)') is not null then raise exception 'COMPANY_EVIDENCE_ALREADY_INSTALLED';end if;
 -- Files share the private bucket created by 20261104020000.
 if to_regclass('storage.buckets') is not null then
  execute $q$select public from storage.buckets where id='finance-evidence'$q$ into is_public;
  if is_public is distinct from false then raise exception 'FINANCE_EVIDENCE_BUCKET_NOT_PRIVATE';end if;
 end if;
end $$;

-- ── Documents ────────────────────────────────────────────────────────────
create table public.uc_company_payment_documents (
 id uuid primary key default gen_random_uuid(),
 payment_id text not null references public.payments(id),
 kind text not null check(kind in ('invoice','payment')),
 file_name text not null check(file_name=trim(file_name) and length(file_name) between 1 and 120 and file_name !~ '[[:cntrl:]/\\]'),
 mime_type text not null check(mime_type in ('image/png','image/jpeg','application/pdf')),
 size_bytes integer not null check(size_bytes between 1 and 1400000),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 storage_path text not null unique check(storage_path ~ '^company-payments/[0-9a-f]{64}/(invoice|payment)-[0-9a-f]{64}\.(png|jpg|pdf)$'),
 state text not null default 'prepared' check(state in ('prepared','confirmed')),
 created_by text not null references public.garage_building_staff(id),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),
 created_at timestamptz not null default now(),
 confirmed_by text references public.garage_building_staff(id), confirmed_at timestamptz,
 -- The payment as it stood, under lock, when this document was confirmed.
 bound_payment jsonb,
 check((state='prepared' and confirmed_by is null and confirmed_at is null and bound_payment is null)
  or (state='confirmed' and confirmed_by is not null and confirmed_at is not null and jsonb_typeof(bound_payment)='object'))
);
create index uc_company_documents_payment on public.uc_company_payment_documents(payment_id,kind,state);

-- One request reference is one upload, whoever else shares the same file.
create table public.uc_company_evidence_requests (
 actor_id text not null references public.garage_building_staff(id),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),
 payload jsonb not null,
 document_id uuid not null references public.uc_company_payment_documents(id),
 created_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);

create table public.uc_company_evidence_audit (
 sequence bigint generated always as identity primary key,
 payment_id text not null references public.payments(id),
 document_id uuid not null references public.uc_company_payment_documents(id),
 actor_id text not null references public.garage_building_staff(id),
 action text not null check(action in ('upload','open')),
 detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index uc_company_evidence_audit_payment on public.uc_company_evidence_audit(payment_id,created_at);

create function public.uc_company_evidence_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'IMMUTABLE_HISTORY'; end $$;
-- The only change a document may ever make: prepared -> confirmed.
create function public.uc_company_document_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' then
  if old.state='prepared' and new.state='confirmed'
   and (to_jsonb(new)-array['state','confirmed_by','confirmed_at','bound_payment']) = (to_jsonb(old)-array['state','confirmed_by','confirmed_at','bound_payment']) then return new;end if;
 end if;
 raise exception 'IMMUTABLE_HISTORY';
end $$;
create trigger uc_company_documents_fixed before update or delete on public.uc_company_payment_documents for each row execute function public.uc_company_document_guard();
create trigger uc_company_documents_no_truncate before truncate on public.uc_company_payment_documents execute function public.uc_company_evidence_immutable();
create trigger uc_company_requests_fixed before update or delete on public.uc_company_evidence_requests for each row execute function public.uc_company_evidence_immutable();
create trigger uc_company_requests_no_truncate before truncate on public.uc_company_evidence_requests execute function public.uc_company_evidence_immutable();
create trigger uc_company_audit_fixed before update or delete on public.uc_company_evidence_audit for each row execute function public.uc_company_evidence_immutable();
create trigger uc_company_audit_no_truncate before truncate on public.uc_company_evidence_audit execute function public.uc_company_evidence_immutable();

-- ── Policy helpers ───────────────────────────────────────────────────────
create function public.uc_company_invoice_type(p_type text) returns boolean language sql immutable set search_path=public,pg_temp as $$
 select coalesce(p_type in ('repair','misc_cost','expense_claim','panel_charge','purchase_settlement'),false) $$;
-- Payroll stays Director-only: the private finance bridge already hides it from admin.
create function public.uc_company_payroll_type(p_type text) returns boolean language sql immutable set search_path=public,pg_temp as $$
 select p_type is null or p_type in ('salary','allowance','director_fee','campaign_bonus','payroll','payslip','salary_paid','allowance_paid','director_fee_paid','campaign_bonus_paid')
  or p_type ~ '(salary|allowance|payroll|payslip|director_fee|campaign_bonus)' $$;
-- p_kind null asks whether the payment itself is visible.
create function public.uc_company_evidence_allows(p_tier text,p_actor text,p_type text,p_recipient text,p_kind text) returns boolean language sql immutable set search_path=public,pg_temp as $$
 select case p_tier
  when 'director' then true
  when 'admin' then not uc_company_payroll_type(p_type)
  when 'staff' then coalesce(p_type='expense_claim' and p_recipient=p_actor and coalesce(p_kind,'invoice')='invoice',false)
  else false end $$;
create function public.uc_company_evidence_doc(d public.uc_company_payment_documents) returns jsonb language sql stable set search_path=public,pg_temp as $$
 select jsonb_strip_nulls(jsonb_build_object('documentId',d.id,'kind',d.kind,'fileName',d.file_name,'mimeType',d.mime_type,'sizeBytes',d.size_bytes,'state',d.state,'uploadedAt',d.confirmed_at,'createdBy',d.confirmed_by,'actorName',(select s.name from garage_building_staff s where s.id=d.confirmed_by))) $$;

-- ── Payments: evidence before money moves (every path) ───────────────────
create function public.uc_company_payment_evidence() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare claiming boolean:=new.claim_confirmed_by is not null; paying boolean:=new.status='transferred';
begin
 if tg_op='UPDATE' then
  if old.status='transferred' and new.status is distinct from old.status and exists(select 1 from uc_company_payment_documents d where d.payment_id=old.id and d.state='confirmed') then raise exception 'EVIDENCE_REVIEW_REQUIRED';end if;
  if (new.id,new.type,new.amount,new.recipient_type,new.recipient_id,new.car_id) is distinct from (old.id,old.type,old.amount,old.recipient_type,old.recipient_id,old.car_id)
   and exists(select 1 from uc_company_payment_documents d where d.payment_id=old.id and d.state='confirmed') then raise exception 'EVIDENCE_REVIEW_REQUIRED';end if;
  -- Only a new transition is checked: earlier history is left as it was.
  claiming:=claiming and old.claim_confirmed_by is null;
  paying:=paying and old.status is distinct from 'transferred';
 end if;
 if coalesce(claiming,false) and not exists(select 1 from uc_company_payment_documents d where d.payment_id=new.id and d.kind='invoice' and d.state='confirmed') then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
 if coalesce(paying,false) then
  if uc_company_invoice_type(new.type) and not exists(select 1 from uc_company_payment_documents d where d.payment_id=new.id and d.kind='invoice' and d.state='confirmed') then raise exception 'SUPPLIER_INVOICE_REQUIRED';end if;
  if not exists(select 1 from uc_company_payment_documents d where d.payment_id=new.id and d.kind='payment' and d.state='confirmed') then raise exception 'PAYMENT_RECEIPT_REQUIRED';end if;
 end if;
 return new;
end $$;
create trigger uc_company_payment_evidence before insert or update on public.payments for each row execute function public.uc_company_payment_evidence();

-- ── Command: prepare / confirm / list / read ─────────────────────────────
create function public.uc_company_evidence(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; pay payments; doc uc_company_payment_documents; prior uc_company_evidence_requests;
 allowed text[]; tier text; req text; path text; stored boolean;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and actor.role<>'investor',false) then raise exception 'NOT_ALLOWED';end if;
 tier:=case actor.role when 'director' then 'director' when 'admin' then 'admin' else 'staff' end;
 allowed:=case p_action
  when 'prepare' then array['paymentId','kind','fileName','mimeType','sha256','sizeBytes','requestId']
  when 'confirm' then array['documentId'] when 'read' then array['documentId'] when 'list' then array['paymentId'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) or exists(select 1 from unnest(allowed) k where not(p_data ? k)) then raise exception 'INVALID';end if;
 if p_data ? 'paymentId' and (jsonb_typeof(p_data->'paymentId') is distinct from 'string' or length(p_data->>'paymentId') not between 1 and 180 or p_data->>'paymentId' ~ '[[:cntrl:]]') then raise exception 'INVALID';end if;
 if p_data ? 'documentId' and (jsonb_typeof(p_data->'documentId') is distinct from 'string' or p_data->>'documentId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'INVALID';end if;

 if p_action='prepare' then
  if coalesce(p_data->>'kind','') not in ('invoice','payment')
   or jsonb_typeof(p_data->'fileName') is distinct from 'string' or p_data->>'fileName'<>trim(p_data->>'fileName') or length(p_data->>'fileName') not between 1 and 120 or p_data->>'fileName' ~ '[[:cntrl:]/\\]'
   or coalesce(p_data->>'mimeType','') not in ('image/png','image/jpeg','application/pdf') or coalesce(p_data->>'sha256','') !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(p_data->'sizeBytes') is distinct from 'number' or p_data->>'sizeBytes' !~ '^[1-9][0-9]{0,6}$' or (p_data->>'sizeBytes')::integer>1400000
   or jsonb_typeof(p_data->'requestId') is distinct from 'string' or p_data->>'requestId' !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  req:=p_data->>'requestId';
  perform pg_advisory_xact_lock(hashtextextended('company-evidence:'||p_actor||':'||req,0));
  -- The payment row lock serialises document writes with payment changes.
  select * into pay from payments where id=p_data->>'paymentId' for update;
  if pay.id is null or not uc_company_evidence_allows(tier,actor.id,pay.type,pay.recipient_id,p_data->>'kind') then raise exception 'NOT_ALLOWED';end if;
  select * into prior from uc_company_evidence_requests where actor_id=p_actor and request_id=req;
  if found then
   if prior.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;
   select * into doc from uc_company_payment_documents where id=prior.document_id;
   return uc_company_evidence_doc(doc)||jsonb_build_object('path',doc.storage_path);
  end if;
  if pay.car_id is not null and exists(select 1 from uc_investor_cars where car_id=pay.car_id) then raise exception 'USE_INVESTOR_CAR_BILLS';end if;
  if p_data->>'kind'='invoice' and not uc_company_invoice_type(pay.type) then raise exception 'INVOICE_NOT_REQUIRED';end if;
  if tier='staff' and (pay.status is distinct from 'pending' or pay.claim_confirmed_by is not null) then raise exception 'CLAIM_LOCKED';end if;
  -- Content-addressed and server-chosen: payment, kind and file digest.
  path:='company-payments/'||encode(sha256(convert_to(pay.id,'UTF8')),'hex')||'/'||(p_data->>'kind')||'-'||(p_data->>'sha256')||
   case p_data->>'mimeType' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' else '.pdf' end;
  select * into doc from uc_company_payment_documents where storage_path=path;
  if doc.id is null then
   -- A supplier invoice is not proof that the money moved, and vice versa.
   if exists(select 1 from uc_company_payment_documents where payment_id=pay.id and sha256=p_data->>'sha256' and kind<>p_data->>'kind') then raise exception 'RECEIPT_SAME_AS_INVOICE';end if;
   if (select count(*) from uc_company_payment_documents where payment_id=pay.id)>=20 then raise exception 'PROOF_LIMIT';end if;
   insert into uc_company_payment_documents(payment_id,kind,file_name,mime_type,size_bytes,sha256,storage_path,created_by,request_id)
   values(pay.id,p_data->>'kind',p_data->>'fileName',p_data->>'mimeType',(p_data->>'sizeBytes')::integer,p_data->>'sha256',path,p_actor,req) returning * into doc;
  end if;
  insert into uc_company_evidence_requests(actor_id,request_id,payload,document_id) values(p_actor,req,p_data,doc.id);
  -- Path stays server-side; the HTTP layer never returns it to the browser.
  return uc_company_evidence_doc(doc)||jsonb_build_object('path',doc.storage_path);

 elsif p_action='confirm' then
  select * into doc from uc_company_payment_documents where id=(p_data->>'documentId')::uuid;
  if doc.id is null then raise exception 'NOT_ALLOWED';end if;
  -- Payment first, then the document: the same order as prepare.
  select * into pay from payments where id=doc.payment_id for update;
  if pay.id is null or not uc_company_evidence_allows(tier,actor.id,pay.type,pay.recipient_id,doc.kind) then raise exception 'NOT_ALLOWED';end if;
  select * into doc from uc_company_payment_documents where id=doc.id for update;
  if doc.state='confirmed' then return uc_company_evidence_doc(doc);end if;
  if pay.car_id is not null and exists(select 1 from uc_investor_cars where car_id=pay.car_id) then raise exception 'USE_INVESTOR_CAR_BILLS';end if;
  if doc.kind='invoice' and not uc_company_invoice_type(pay.type) then raise exception 'INVOICE_NOT_REQUIRED';end if;
  if tier='staff' and (pay.status is distinct from 'pending' or pay.claim_confirmed_by is not null) then raise exception 'CLAIM_LOCKED';end if;
  if to_regclass('storage.objects') is not null then
   execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into stored using 'finance-evidence',doc.storage_path;
   if not stored then raise exception 'UPLOAD_MISSING';end if;
  end if;
  update uc_company_payment_documents set state='confirmed',confirmed_by=p_actor,confirmed_at=now(),
   bound_payment=jsonb_build_object('type',pay.type,'amount',pay.amount,'recipientType',pay.recipient_type,'recipientId',pay.recipient_id,'carId',pay.car_id,'status',pay.status)
  where id=doc.id returning * into doc;
  insert into uc_company_evidence_audit(payment_id,document_id,actor_id,action,detail)
  values(pay.id,doc.id,p_actor,'upload',jsonb_build_object('kind',doc.kind,'requestId',doc.request_id,'sha256',doc.sha256));
  return uc_company_evidence_doc(doc);

 elsif p_action='list' then
  select * into pay from payments where id=p_data->>'paymentId';
  if pay.id is null or not uc_company_evidence_allows(tier,actor.id,pay.type,pay.recipient_id,null) then raise exception 'NOT_ALLOWED';end if;
  return jsonb_strip_nulls(jsonb_build_object('paymentId',pay.id,
   'invoiceRequired',uc_company_invoice_type(pay.type),
   'invoiceConfirmed',exists(select 1 from uc_company_payment_documents d where d.payment_id=pay.id and d.kind='invoice' and d.state='confirmed'),
   'receiptConfirmed',case when tier<>'staff' then exists(select 1 from uc_company_payment_documents d where d.payment_id=pay.id and d.kind='payment' and d.state='confirmed') end))
   ||jsonb_build_object('documents',coalesce((select jsonb_agg(uc_company_evidence_doc(d) order by d.confirmed_at,d.id) from uc_company_payment_documents d
    where d.payment_id=pay.id and d.state='confirmed' and uc_company_evidence_allows(tier,actor.id,pay.type,pay.recipient_id,d.kind)),'[]'::jsonb));

 elsif p_action='read' then
  -- Missing, unconfirmed and unauthorised documents look the same.
  select d.* into doc from uc_company_payment_documents d join payments p on p.id=d.payment_id
  where d.id=(p_data->>'documentId')::uuid and d.state='confirmed' and uc_company_evidence_allows(tier,actor.id,p.type,p.recipient_id,d.kind);
  if doc.id is null then raise exception 'NOT_ALLOWED';end if;
  insert into uc_company_evidence_audit(payment_id,document_id,actor_id,action) values(doc.payment_id,doc.id,p_actor,'open');
  return jsonb_build_object('documentId',doc.id,'path',doc.storage_path,'fileName',doc.file_name,'mimeType',doc.mime_type);
 end if;
 raise exception 'INVALID';
end $$;

alter table public.uc_company_payment_documents enable row level security;
alter table public.uc_company_evidence_requests enable row level security;
alter table public.uc_company_evidence_audit enable row level security;
revoke all on table public.uc_company_payment_documents,public.uc_company_evidence_requests,public.uc_company_evidence_audit from public,anon,authenticated,service_role;
revoke all on function public.uc_company_evidence_immutable() from public,anon,authenticated,service_role;
revoke all on function public.uc_company_document_guard() from public,anon,authenticated,service_role;
revoke all on function public.uc_company_invoice_type(text) from public,anon,authenticated,service_role;
revoke all on function public.uc_company_payroll_type(text) from public,anon,authenticated,service_role;
revoke all on function public.uc_company_evidence_allows(text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.uc_company_evidence_doc(public.uc_company_payment_documents) from public,anon,authenticated,service_role;
revoke all on function public.uc_company_payment_evidence() from public,anon,authenticated,service_role;
revoke all on function public.uc_company_evidence(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_company_evidence(text,text,jsonb) to service_role;
commit;
