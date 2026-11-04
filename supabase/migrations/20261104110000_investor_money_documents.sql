-- PREPARED ONLY. Not installed. Investor purchase and withdrawal evidence.
-- Install order: after 20261104090000_investor_required_documents (it does not
-- depend on 20261104100000), and only AFTER the private bridge release that
-- serves scope 'investor_money_evidence' (server/usedCar/investorMoneyEvidence.mjs)
-- and sends the document IDs on purchase_paid / withdrawal_paid is deployed and
-- verified. Installing earlier blocks every new car purchase payment and
-- withdrawal payout. Uses the existing private finance review marker.
--  * purchase_paid records money only when it names a confirmed supplier
--    invoice AND a confirmed payment receipt, both prepared for that car and
--    bound to its purchase price. withdrawal_paid needs a confirmed payment
--    receipt bound to that approved withdrawal and its amount.
--  * Files are uploaded and storage-verified BEFORE the payment, then consumed
--    by exactly one cash entry in the same transaction that creates it. One
--    document proves one payment. A trigger refuses any car_purchase or
--    withdrawal_out cash row that did not pass this check, and a deferred
--    check refuses any such row left without its proof link at commit.
--  * pay_car_bill (090000), capital received and sale money are unchanged.
--  * Documents are private, immutable and never hard deleted. Director only
--    uploads; a linked investor reads confirmed documents on their own
--    account only. Admin and other staff have no access.
begin;
do $$ declare is_public boolean; begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' then
  raise exception 'PRIVATE_FINANCE_RELEASE_NOT_REVIEWED: deploy and verify the private evidence upload before requiring documents';
 end if;
 if to_regclass('public.uc_investor_payment_receipts') is null or to_regprocedure('public.uc_investor_capital_phase3(text,text,jsonb)') is null then raise exception 'INVESTOR_REQUIRED_DOCUMENTS_REQUIRED';end if;
 if to_regclass('public.uc_investor_money_documents') is not null or to_regprocedure('public.uc_investor_capital_phase4(text,text,jsonb)') is not null
  or to_regprocedure('public.uc_investor_money_evidence(text,text,jsonb)') is not null then raise exception 'INVESTOR_MONEY_EVIDENCE_ALREADY_INSTALLED';end if;
 -- Files share the private bucket created by 20261104020000.
 if to_regclass('storage.buckets') is not null then
  execute $q$select public from storage.buckets where id='finance-evidence'$q$ into is_public;
  if is_public is distinct from false then raise exception 'FINANCE_EVIDENCE_BUCKET_NOT_PRIVATE';end if;
 end if;
end $$;

-- ── Documents ────────────────────────────────────────────────────────────
create table public.uc_investor_money_documents (
 id uuid primary key default gen_random_uuid(),
 target text not null check(target in ('purchase','withdrawal')),
 pot_id uuid not null references public.uc_investor_pots(id),
 car_id text references public.uc_investor_cars(car_id),
 withdrawal_id uuid references public.uc_investor_withdrawals(id),
 kind text not null check(kind in ('invoice','payment')),
 -- The amount the payment must be, read under lock when prepared.
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),
 file_name text not null check(file_name=trim(file_name) and length(file_name) between 1 and 120 and file_name !~ '[[:cntrl:]/\\]'),
 mime_type text not null check(mime_type in ('image/png','image/jpeg','application/pdf')),
 size_bytes integer not null check(size_bytes between 1 and 1400000),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 storage_path text not null unique check(storage_path ~ '^investor-money/(purchase|withdrawal)/[0-9a-f]{64}/(invoice|payment)-[0-9a-f]{64}\.(png|jpg|pdf)$'),
 state text not null default 'prepared' check(state in ('prepared','confirmed')),
 created_by text not null references public.garage_building_staff(id),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),
 created_at timestamptz not null default now(),
 confirmed_by text references public.garage_building_staff(id), confirmed_at timestamptz,
 check((target='purchase' and car_id is not null and withdrawal_id is null)
  or (target='withdrawal' and withdrawal_id is not null and car_id is null and kind='payment')),
 check((state='prepared' and confirmed_by is null and confirmed_at is null) or (state='confirmed' and confirmed_by is not null and confirmed_at is not null))
);
create index uc_money_documents_car on public.uc_investor_money_documents(car_id,kind,state) where car_id is not null;
create index uc_money_documents_withdrawal on public.uc_investor_money_documents(withdrawal_id,state) where withdrawal_id is not null;
create index uc_money_documents_pot on public.uc_investor_money_documents(pot_id,confirmed_at,id);
create index uc_money_documents_digest on public.uc_investor_money_documents(sha256,kind);

-- One request reference is one upload, whoever else shares the same file.
create table public.uc_investor_money_requests (
 actor_id text not null references public.garage_building_staff(id),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),
 payload jsonb not null,
 document_id uuid not null references public.uc_investor_money_documents(id),
 created_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);

-- One proof pays one cash entry; one cash entry consumes its proof once.
-- extra keeps the exact document fields the payment request sent, so a
-- replay must repeat them even though the inner commands never see them.
create table public.uc_investor_money_links (
 entry_id uuid primary key references public.uc_investor_cash_entries(id),
 target text not null check(target in ('purchase','withdrawal')),
 invoice_document_id uuid unique references public.uc_investor_money_documents(id),
 receipt_document_id uuid not null unique references public.uc_investor_money_documents(id),
 actor_id text not null references public.garage_building_staff(id),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),
 extra jsonb not null check(jsonb_typeof(extra)='object'),
 created_at timestamptz not null default now(),
 unique(actor_id,request_id),
 check((target='purchase')=(invoice_document_id is not null))
);

-- The only change a document may ever make: prepared -> confirmed.
create function public.uc_money_document_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and old.state='prepared' and new.state='confirmed'
  and (to_jsonb(new)-array['state','confirmed_by','confirmed_at']) = (to_jsonb(old)-array['state','confirmed_by','confirmed_at']) then return new;end if;
 raise exception 'IMMUTABLE_HISTORY';
end $$;
create trigger uc_money_documents_fixed before update or delete on public.uc_investor_money_documents for each row execute function public.uc_money_document_guard();
create trigger uc_money_documents_no_truncate before truncate on public.uc_investor_money_documents execute function public.uc_investor_immutable();
create trigger uc_money_requests_fixed before update or delete on public.uc_investor_money_requests for each row execute function public.uc_investor_immutable();
create trigger uc_money_requests_no_truncate before truncate on public.uc_investor_money_requests execute function public.uc_investor_immutable();
create trigger uc_money_links_fixed before update or delete on public.uc_investor_money_links for each row execute function public.uc_investor_immutable();
create trigger uc_money_links_no_truncate before truncate on public.uc_investor_money_links execute function public.uc_investor_immutable();

-- ── Helpers ──────────────────────────────────────────────────────────────
-- Whether a document is confirmed proof of exactly this cash entry.
create function public.uc_money_document_proves(d public.uc_investor_money_documents,e public.uc_investor_cash_entries,p_kind text) returns boolean
language sql stable set search_path=public,pg_temp as $$
 select coalesce(d.id is not null and e.id is not null and d.state='confirmed' and d.kind=p_kind and d.pot_id=e.pot_id and d.amount_cents=-e.amount_cents
  and ((d.target='purchase' and e.kind='car_purchase' and d.car_id=e.car_id) or (d.target='withdrawal' and e.kind='withdrawal_out' and d.withdrawal_id=e.withdrawal_id)),false) $$;
-- Browser-safe shape: never the storage path or digest.
create function public.uc_investor_money_doc(d public.uc_investor_money_documents) returns jsonb language sql stable set search_path=public,pg_temp as $$
 select jsonb_strip_nulls(jsonb_build_object('documentId',d.id,'target',d.target,'carId',d.car_id,'withdrawalId',d.withdrawal_id,'kind',d.kind,
  'fileName',d.file_name,'mimeType',d.mime_type,'sizeBytes',d.size_bytes,'amountCents',d.amount_cents,'state',d.state,'uploadedAt',d.confirmed_at,'actorName',(select name from garage_building_staff where id=d.confirmed_by),
  'entryId',(select l.entry_id from uc_investor_money_links l where l.receipt_document_id=d.id or l.invoice_document_id=d.id)))
  ||jsonb_build_object('used',exists(select 1 from uc_investor_money_links l where l.receipt_document_id=d.id or l.invoice_document_id=d.id)) $$;

-- ── Links: proof must match the cash entry it pays ───────────────────────
create function public.uc_money_link_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare e uc_investor_cash_entries; r uc_investor_money_documents; i uc_investor_money_documents;
begin
 select * into e from uc_investor_cash_entries where id=new.entry_id;
 select * into r from uc_investor_money_documents where id=new.receipt_document_id;
 if new.invoice_document_id is not null then select * into i from uc_investor_money_documents where id=new.invoice_document_id;end if;
 if e.id is null or e.kind is distinct from (case new.target when 'purchase' then 'car_purchase' else 'withdrawal_out' end)
  or not uc_money_document_proves(r,e,'payment')
  or (new.target='purchase' and not uc_money_document_proves(i,e,'invoice')) then raise exception 'PROOF_NOT_FOR_PAYMENT';end if;
 return new;
end $$;
create trigger uc_money_link_check before insert on public.uc_investor_money_links for each row execute function public.uc_money_link_guard();

-- ── Proof before any purchase or withdrawal money is recorded (every path) ─
-- Only the uc_investor_capital wrapper opens this transaction-local gate, after
-- it has checked the documents under the account lock. The gate is single use.
create function public.uc_require_money_evidence() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare target text:=case new.kind when 'car_purchase' then 'car:'||coalesce(new.car_id,'') else 'withdrawal:'||coalesce(new.withdrawal_id::text,'') end;
begin
 if coalesce(current_setting('autodream.uc_money_evidence',true),'')<>'on:'||txid_current()::text||':'||target then raise exception 'MONEY_PROOF_REQUIRED';end if;
 perform set_config('autodream.uc_money_evidence','used:'||txid_current()::text||':'||target,true);
 return new;
end $$;
create trigger uc_cash_money_evidence_required before insert on public.uc_investor_cash_entries for each row
 when (new.kind in ('car_purchase','withdrawal_out')) execute function public.uc_require_money_evidence();
-- Opening the gate by hand is not enough: the row must carry its proof link by commit.
create function public.uc_money_evidence_linked() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from uc_investor_money_links where entry_id=new.id) then raise exception 'MONEY_PROOF_REQUIRED';end if;
 return null;
end $$;
create constraint trigger uc_cash_money_evidence_linked after insert on public.uc_investor_cash_entries deferrable initially deferred for each row
 when (new.kind in ('car_purchase','withdrawal_out')) execute function public.uc_money_evidence_linked();

-- ── Command wrapper: proof consumption for purchase_paid / withdrawal_paid ─
alter function public.uc_investor_capital(text,text,jsonb) rename to uc_investor_capital_phase4;
revoke all on function public.uc_investor_capital_phase4(text,text,jsonb) from public,anon,authenticated,service_role;

create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; link uc_investor_money_links; car uc_investor_cars; w uc_investor_withdrawals;
 inv uc_investor_money_documents; rec uc_investor_money_documents; proof_keys text[]; extra jsonb;
 req text; target text; gate text; amount bigint; pot uuid; result jsonb; entry uuid;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 -- Every other action (including pay_car_bill and incoming money) is unchanged.
 if p_action is distinct from 'purchase_paid' and p_action is distinct from 'withdrawal_paid' then return uc_investor_capital_phase4(p_actor,p_action,p_data);end if;
 proof_keys:=case p_action when 'purchase_paid' then array['invoiceDocumentId','receiptDocumentId'] else array['receiptDocumentId'] end;
 if p_action='withdrawal_paid' and p_data ? 'invoiceDocumentId' then raise exception 'INVALID';end if;
 if exists(select 1 from unnest(proof_keys) k where p_data ? k and (jsonb_typeof(p_data->k) is distinct from 'string'
   or p_data->>k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  or jsonb_typeof(p_data->'requestId') is distinct from 'string' or p_data->>'requestId' !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 req:=p_data->>'requestId';
 extra:=coalesce((select jsonb_object_agg(k,p_data->k) from unnest(proof_keys) k where p_data ? k),'{}'::jsonb);
 -- Same lock the money commands take, so a replay cannot race the original.
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
 if exists(select 1 from uc_investor_commands where actor_id=p_actor and request_id=req) then
  -- Replay: the original command decides; no proof is consumed again and no
  -- money is written. The document fields must be exactly what was first sent
  -- (none, for a command recorded before this migration).
  select * into link from uc_investor_money_links where actor_id=p_actor and request_id=req;
  if extra is distinct from coalesce(link.extra,'{}'::jsonb) then raise exception 'REQUEST_CHANGED';end if;
  result:=uc_investor_capital_phase4(p_actor,p_action,p_data-proof_keys);
  if link.entry_id is not null then
   result:=result||jsonb_strip_nulls(jsonb_build_object('invoiceDocumentId',link.invoice_document_id,'receiptDocumentId',link.receipt_document_id));
  end if;
  return result;
 end if;
 if p_action='purchase_paid' and not(p_data ? 'invoiceDocumentId') then raise exception 'PURCHASE_INVOICE_REQUIRED';end if;
 if not(p_data ? 'receiptDocumentId') then raise exception 'PAYMENT_RECEIPT_REQUIRED';end if;

 -- Account lock first (same order as every money and document command), then the documents.
 if p_action='purchase_paid' then
  if jsonb_typeof(p_data->'carId') is distinct from 'string' then raise exception 'INVALID';end if;
  select * into car from uc_investor_cars where car_id=p_data->>'carId';
  if car.car_id is null then raise exception 'NOT_ALLOWED';end if;
  perform 1 from uc_investor_pots where id=car.pot_id for update;
  select * into car from uc_investor_cars where car_id=car.car_id;
  target:='car:'||car.car_id;amount:=car.purchase_cents;pot:=car.pot_id;
 else
  if jsonb_typeof(p_data->'potId') is distinct from 'string' or p_data->>'potId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_data->'withdrawalId') is distinct from 'string' or p_data->>'withdrawalId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID';end if;
  perform 1 from uc_investor_pots where id=(p_data->>'potId')::uuid for update;
  select * into w from uc_investor_withdrawals where id=(p_data->>'withdrawalId')::uuid and pot_id=(p_data->>'potId')::uuid;
  if w.id is null then raise exception 'NOT_ALLOWED';end if;
  target:='withdrawal:'||w.id::text;amount:=w.amount_cents;pot:=w.pot_id;
 end if;
 if p_action='purchase_paid' then
  select * into inv from uc_investor_money_documents where id=(p_data->>'invoiceDocumentId')::uuid for update;
  if inv.id is null or inv.target<>'purchase' or inv.car_id is distinct from car.car_id or inv.kind<>'invoice' then raise exception 'PROOF_NOT_FOR_PAYMENT';end if;
  if inv.state<>'confirmed' then raise exception 'PROOF_NOT_CONFIRMED';end if;
  if inv.amount_cents<>amount then raise exception 'PROOF_AMOUNT_CHANGED';end if;
 end if;
 select * into rec from uc_investor_money_documents where id=(p_data->>'receiptDocumentId')::uuid for update;
 if rec.id is null or rec.kind<>'payment' or rec.pot_id<>pot
  or (p_action='purchase_paid' and (rec.target<>'purchase' or rec.car_id is distinct from car.car_id))
  or (p_action='withdrawal_paid' and (rec.target<>'withdrawal' or rec.withdrawal_id is distinct from w.id)) then raise exception 'PROOF_NOT_FOR_PAYMENT';end if;
 if rec.state<>'confirmed' then raise exception 'PROOF_NOT_CONFIRMED';end if;
 if rec.amount_cents<>amount then raise exception 'PROOF_AMOUNT_CHANGED';end if;
 if exists(select 1 from uc_investor_money_links where receipt_document_id=rec.id or invoice_document_id=inv.id) then raise exception 'PROOF_ALREADY_USED';end if;

 gate:=txid_current()::text||':'||target;
 perform set_config('autodream.uc_money_evidence','on:'||gate,true);
 result:=uc_investor_capital_phase4(p_actor,p_action,p_data-proof_keys);
 if coalesce(current_setting('autodream.uc_money_evidence',true),'')<>'used:'||gate then raise exception 'MONEY_PROOF_REQUIRED';end if;
 perform set_config('autodream.uc_money_evidence','',true);
 entry:=(result->>'entryId')::uuid;
 insert into uc_investor_money_links(entry_id,target,invoice_document_id,receipt_document_id,actor_id,request_id,extra)
 values(entry,case p_action when 'purchase_paid' then 'purchase' else 'withdrawal' end,inv.id,rec.id,p_actor,req,extra);
 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot,p_actor,'money_proof_linked',
  jsonb_strip_nulls(jsonb_build_object('requestId',req,'carId',car.car_id,'withdrawalId',w.id,'entryId',entry,'invoiceDocumentId',inv.id,'receiptDocumentId',rec.id)));
 return result||jsonb_strip_nulls(jsonb_build_object('invoiceDocumentId',inv.id,'receiptDocumentId',rec.id));
end $$;

-- ── Evidence command: prepare / confirm / list / read ────────────────────
create function public.uc_investor_money_evidence(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; allowed text[]; car uc_investor_cars; w uc_investor_withdrawals; doc uc_investor_money_documents;
 prior uc_investor_money_requests; pot uuid; amount bigint; paid boolean; target_id text; req text; path text; stored boolean;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and actor.role in ('director','investor'),false) then raise exception 'NOT_ALLOWED';end if;
 if actor.role<>'director' and p_action not in ('list','read') then raise exception 'NOT_ALLOWED';end if;
 allowed:=case p_action
  when 'prepare' then case p_data->>'target'
   when 'purchase' then array['target','carId','kind','fileName','mimeType','sha256','sizeBytes','amountCents','requestId']
   when 'withdrawal' then array['target','withdrawalId','kind','fileName','mimeType','sha256','sizeBytes','amountCents','requestId'] end
  when 'list' then case p_data->>'target' when 'purchase' then array['target','carId'] when 'withdrawal' then array['target','withdrawalId'] when 'pot' then array['target','potId'] end
  when 'confirm' then array['documentId'] when 'read' then array['documentId'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) or exists(select 1 from unnest(allowed) k where not(p_data ? k)) then raise exception 'INVALID';end if;
 if p_data ? 'target' and jsonb_typeof(p_data->'target') is distinct from 'string' then raise exception 'INVALID';end if;
 if p_data ? 'carId' and (jsonb_typeof(p_data->'carId') is distinct from 'string' or p_data->>'carId' !~ '^[A-Za-z0-9_-]{1,100}$') then raise exception 'INVALID';end if;
 if exists(select 1 from unnest(array['withdrawalId','potId','documentId']) k where p_data ? k and (jsonb_typeof(p_data->k) is distinct from 'string'
  or p_data->>k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then raise exception 'INVALID';end if;

 -- Target and its account. Missing targets and other investors' targets look the same.
 if p_data ? 'carId' then
  select * into car from uc_investor_cars where car_id=p_data->>'carId';
  pot:=car.pot_id;
 elsif p_data ? 'withdrawalId' then
  select * into w from uc_investor_withdrawals where id=(p_data->>'withdrawalId')::uuid;
  pot:=w.pot_id;
 elsif p_data ? 'potId' then
  select id into pot from uc_investor_pots where id=(p_data->>'potId')::uuid;
 end if;
 if p_action in ('prepare','list') then
  if pot is null then raise exception 'NOT_ALLOWED';end if;
  if actor.role='investor' and not exists(select 1 from uc_investor_pots p join uc_investor_profiles f on f.id=p.profile_id where p.id=pot and f.linked_staff_id=actor.id) then raise exception 'NOT_ALLOWED';end if;
 end if;

 if p_action='prepare' then
  if (p_data->>'target'='purchase' and coalesce(p_data->>'kind','') not in ('invoice','payment')) or (p_data->>'target'='withdrawal' and p_data->>'kind' is distinct from 'payment')
   or jsonb_typeof(p_data->'kind') is distinct from 'string'
   or jsonb_typeof(p_data->'fileName') is distinct from 'string' or p_data->>'fileName'<>trim(p_data->>'fileName') or length(p_data->>'fileName') not between 1 and 120 or p_data->>'fileName' ~ '[[:cntrl:]/\\]'
   or jsonb_typeof(p_data->'mimeType') is distinct from 'string' or p_data->>'mimeType' not in ('image/png','image/jpeg','application/pdf')
   or jsonb_typeof(p_data->'sha256') is distinct from 'string' or p_data->>'sha256' !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(p_data->'sizeBytes') is distinct from 'number' or p_data->>'sizeBytes' !~ '^[1-9][0-9]{0,6}$' or (p_data->>'sizeBytes')::integer>1400000
   or jsonb_typeof(p_data->'amountCents') is distinct from 'number' or p_data->>'amountCents' !~ '^[1-9][0-9]{0,12}$' or (p_data->>'amountCents')::bigint>1000000000000
   or jsonb_typeof(p_data->'requestId') is distinct from 'string' or p_data->>'requestId' !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  req:=p_data->>'requestId';
  perform pg_advisory_xact_lock(hashtextextended('investor-money-evidence:'||p_actor||':'||req,0));
  -- Account lock first, then the target re-read under it: same order as payment.
  perform 1 from uc_investor_pots where id=pot for update;
  if car.car_id is not null then
   select * into car from uc_investor_cars where car_id=car.car_id;
   amount:=car.purchase_cents;target_id:=car.car_id;
   paid:=exists(select 1 from uc_investor_cash_entries e where e.car_id=car.car_id and e.kind='car_purchase');
  else
   select * into w from uc_investor_withdrawals where id=w.id for update;
   amount:=w.amount_cents;target_id:=w.id::text;paid:=w.state='paid';
  end if;
  select * into prior from uc_investor_money_requests where actor_id=p_actor and request_id=req;
  if found then
   if prior.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;
   select * into doc from uc_investor_money_documents where id=prior.document_id;
   return uc_investor_money_doc(doc)||jsonb_build_object('path',doc.storage_path);
  end if;
  if paid or car.settled_at is not null then raise exception 'ALREADY_PAID';end if;
  if w.id is not null and w.state<>'approved' then raise exception 'APPROVAL_REQUIRED';end if;
  -- The file names the amount the payment must be; a stale screen is refused.
  if (p_data->>'amountCents')::bigint<>amount then raise exception 'PROOF_AMOUNT_CHANGED';end if;
  -- Content-addressed and server-chosen: target, kind and file digest.
  path:='investor-money/'||(p_data->>'target')||'/'||encode(sha256(convert_to(target_id,'UTF8')),'hex')||'/'||(p_data->>'kind')||'-'||(p_data->>'sha256')||
   case p_data->>'mimeType' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' else '.pdf' end;
  select * into doc from uc_investor_money_documents where storage_path=path;
  if doc.id is null then
   -- A supplier invoice is not proof that the money moved, and vice versa.
   if exists(select 1 from uc_investor_money_documents d where d.sha256=p_data->>'sha256' and d.kind<>p_data->>'kind'
    and d.car_id is not distinct from car.car_id and d.withdrawal_id is not distinct from w.id) then raise exception 'RECEIPT_SAME_AS_INVOICE';end if;
   -- A grouped bank transfer may support several separately identified payments.
   -- Each document remains bound to one target and one amount; bank matching
   -- allocates the actual transfer separately and must prevent over-allocation.
   if (select count(*) from uc_investor_money_documents d where d.car_id is not distinct from car.car_id and d.withdrawal_id is not distinct from w.id)>=20 then raise exception 'PROOF_LIMIT';end if;
   insert into uc_investor_money_documents(target,pot_id,car_id,withdrawal_id,kind,amount_cents,file_name,mime_type,size_bytes,sha256,storage_path,created_by,request_id)
   values(p_data->>'target',pot,car.car_id,w.id,p_data->>'kind',amount,p_data->>'fileName',p_data->>'mimeType',(p_data->>'sizeBytes')::integer,p_data->>'sha256',path,p_actor,req) returning * into doc;
  end if;
  insert into uc_investor_money_requests(actor_id,request_id,payload,document_id) values(p_actor,req,p_data,doc.id);
  -- Path stays server-side; the HTTP layer never returns it to the browser.
  return uc_investor_money_doc(doc)||jsonb_build_object('path',doc.storage_path);

 elsif p_action='confirm' then
  select * into doc from uc_investor_money_documents where id=(p_data->>'documentId')::uuid;
  if doc.id is null then raise exception 'NOT_ALLOWED';end if;
  perform 1 from uc_investor_pots where id=doc.pot_id for update;
  select * into doc from uc_investor_money_documents where id=doc.id for update;
  if doc.state='confirmed' then return uc_investor_money_doc(doc);end if;
  if doc.target='purchase' then
   select * into car from uc_investor_cars where car_id=doc.car_id;
   if exists(select 1 from uc_investor_cash_entries e where e.car_id=car.car_id and e.kind='car_purchase') or car.settled_at is not null then raise exception 'ALREADY_PAID';end if;
   amount:=car.purchase_cents;
  else
   select * into w from uc_investor_withdrawals where id=doc.withdrawal_id for update;
   if w.state='paid' then raise exception 'ALREADY_PAID';end if;
   if w.state<>'approved' then raise exception 'APPROVAL_REQUIRED';end if;
   amount:=w.amount_cents;
  end if;
  if doc.amount_cents<>amount then raise exception 'PROOF_AMOUNT_CHANGED';end if;
  if doc.kind='payment' then
   -- Serialises two accounts confirming the same receipt file at once.
   perform pg_advisory_xact_lock(hashtextextended('investor-money-receipt:'||doc.sha256,0));
  end if;
  if to_regclass('storage.objects') is not null then
   execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into stored using 'finance-evidence',doc.storage_path;
   if not stored then raise exception 'UPLOAD_MISSING';end if;
  end if;
  update uc_investor_money_documents set state='confirmed',confirmed_by=p_actor,confirmed_at=now() where id=doc.id returning * into doc;
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(doc.pot_id,p_actor,'money_proof_upload',
   jsonb_strip_nulls(jsonb_build_object('requestId',doc.request_id,'target',doc.target,'carId',doc.car_id,'withdrawalId',doc.withdrawal_id,'documentId',doc.id,'kind',doc.kind)));
  return uc_investor_money_doc(doc);

 elsif p_action='list' then
  return jsonb_strip_nulls(jsonb_build_object('target',p_data->>'target','carId',car.car_id,'withdrawalId',w.id,
    'potId',case when p_data->>'target'='pot' then pot end,
    'amountCents',coalesce(car.purchase_cents,w.amount_cents),
    'paid',case when car.car_id is not null then exists(select 1 from uc_investor_cash_entries e where e.car_id=car.car_id and e.kind='car_purchase') when w.id is not null then w.state='paid' end,
    'withdrawalState',w.state,
    'invoiceConfirmed',case when car.car_id is not null then exists(select 1 from uc_investor_money_documents d where d.car_id=car.car_id and d.kind='invoice' and d.state='confirmed') end,
    'receiptConfirmed',case when car.car_id is not null or w.id is not null then exists(select 1 from uc_investor_money_documents d
     where d.kind='payment' and d.state='confirmed' and (d.car_id=car.car_id or d.withdrawal_id=w.id)) end))
   ||jsonb_build_object('documents',coalesce((select jsonb_agg(uc_investor_money_doc(d) order by d.confirmed_at,d.id) from uc_investor_money_documents d
    where d.state='confirmed' and case p_data->>'target' when 'purchase' then d.car_id=car.car_id when 'withdrawal' then d.withdrawal_id=w.id else d.pot_id=pot end),'[]'::jsonb));

 elsif p_action='read' then
  -- Missing, unconfirmed and other investors' documents look the same.
  select d.* into doc from uc_investor_money_documents d join uc_investor_pots p on p.id=d.pot_id join uc_investor_profiles f on f.id=p.profile_id
  where d.id=(p_data->>'documentId')::uuid and d.state='confirmed' and (actor.role='director' or f.linked_staff_id=actor.id);
  if doc.id is null then raise exception 'NOT_ALLOWED';end if;
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(doc.pot_id,p_actor,'money_proof_open',jsonb_build_object('documentId',doc.id,'target',doc.target));
  return jsonb_build_object('documentId',doc.id,'path',doc.storage_path,'fileName',doc.file_name,'mimeType',doc.mime_type);
 end if;
 raise exception 'INVALID';
end $$;

alter table public.uc_investor_money_documents enable row level security;
alter table public.uc_investor_money_requests enable row level security;
alter table public.uc_investor_money_links enable row level security;
revoke all on table public.uc_investor_money_documents,public.uc_investor_money_requests,public.uc_investor_money_links from public,anon,authenticated,service_role;
revoke all on function public.uc_money_document_guard() from public,anon,authenticated,service_role;
revoke all on function public.uc_money_document_proves(public.uc_investor_money_documents,public.uc_investor_cash_entries,text) from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_money_doc(public.uc_investor_money_documents) from public,anon,authenticated,service_role;
revoke all on function public.uc_money_link_guard() from public,anon,authenticated,service_role;
revoke all on function public.uc_require_money_evidence() from public,anon,authenticated,service_role;
revoke all on function public.uc_money_evidence_linked() from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_money_evidence(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_investor_capital(text,text,jsonb) to service_role;
grant execute on function public.uc_investor_money_evidence(text,text,jsonb) to service_role;
commit;
