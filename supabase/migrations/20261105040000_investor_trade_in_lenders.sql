-- PREPARED ONLY. Investor trade-in lender reserves and proof-backed settlement.
begin;
do $$ begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' or to_regclass('uc_bank_movements') is null then raise exception 'COMPANY_BANK_FOUNDATION_REQUIRED';end if;
end $$;
alter table uc_trade_in_applications add column lender_cents bigint not null default 0 check(lender_cents between 0 and 1000000000000);
alter table uc_trade_in_applications add column gross_cents bigint generated always as (amount_cents+lender_cents) stored;
alter table uc_trade_in_applications drop constraint uc_trade_in_applications_amount_cents_check;
alter table uc_trade_in_applications add constraint uc_trade_in_net_credit check(amount_cents between 0 and 1000000000000 and gross_cents between 1 and 1000000000000);
create table public.uc_trade_in_lender_documents (
 id uuid primary key default gen_random_uuid(),application_id uuid not null references uc_trade_in_applications(id),kind text not null check(kind in ('statement','payment')),
 file_name text not null check(length(file_name) between 1 and 120 and file_name=trim(file_name) and file_name !~ '[[:cntrl:]/\\]'),mime_type text not null check(mime_type in ('image/png','image/jpeg','application/pdf')),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),size_bytes integer not null check(size_bytes between 1 and 1400000),storage_path text not null unique,
 created_by text not null references garage_building_staff(id),created_at timestamptz not null default now(),confirmed_by text references garage_building_staff(id),confirmed_at timestamptz,check((confirmed_by is null)=(confirmed_at is null))
);
create table public.uc_trade_in_lender_payments (
 id uuid primary key default gen_random_uuid(),application_id uuid not null unique references uc_trade_in_applications(id),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),statement_document_id uuid not null references uc_trade_in_lender_documents(id),receipt_document_id uuid not null unique references uc_trade_in_lender_documents(id),
 cash_entry_id uuid not null unique references uc_investor_cash_entries(id) deferrable initially deferred,
 recipient_bank text not null,recipient_account text not null,recipient_name text not null,note text not null,
 recorded_by text not null references garage_building_staff(id),recorded_at timestamptz not null default now(),request_id text not null,payload jsonb not null,unique(recorded_by,request_id)
);
create trigger uc_lender_documents_fixed before update or delete on uc_trade_in_lender_documents for each row execute function uc_trade_in_document_guard();
create trigger uc_lender_documents_no_truncate before truncate on uc_trade_in_lender_documents execute function uc_investor_immutable();
create trigger uc_lender_payments_fixed before update or delete on uc_trade_in_lender_payments for each row execute function uc_investor_immutable();
create trigger uc_lender_payments_no_truncate before truncate on uc_trade_in_lender_payments execute function uc_investor_immutable();
alter table uc_investor_cash_entries add column trade_in_lender_payment_id uuid unique references uc_trade_in_lender_payments(id);
alter table uc_investor_cash_entries add constraint uc_lender_cash_source check(kind='trade_in_lender_out' or trade_in_lender_payment_id is null);
do $$ declare expression text;begin
 select pg_get_expr(conbin,conrelid) into expression from pg_constraint where conrelid='uc_investor_cash_entries'::regclass and conname='uc_cash_kind';if expression is null then raise exception 'CASH_CONSTRAINT_REVIEW_REQUIRED';end if;
 alter table uc_investor_cash_entries drop constraint uc_cash_kind;
 execute 'alter table uc_investor_cash_entries add constraint uc_cash_kind check (('||expression||') or (kind=''trade_in_lender_out'' and amount_cents<0 and car_id is not null and trade_in_lender_payment_id is not null and bill_id is null and withdrawal_id is null and customer_refund_id is null))';
end $$;
drop trigger uc_cash_to_journal on uc_investor_cash_entries;
create trigger uc_cash_to_journal after insert on uc_investor_cash_entries for each row when(new.kind not in ('customer_refund_out','trade_in_lender_out')) execute function uc_investor_post_event();
create function public.uc_trade_in_lender_cash() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare payment uc_trade_in_lender_payments;application uc_trade_in_applications;statement uc_trade_in_lender_documents;receipt uc_trade_in_lender_documents;
begin
 select * into payment from uc_trade_in_lender_payments where id=new.trade_in_lender_payment_id;
 select * into application from uc_trade_in_applications where id=payment.application_id;
 select * into statement from uc_trade_in_lender_documents where id=payment.statement_document_id;
 select * into receipt from uc_trade_in_lender_documents where id=payment.receipt_document_id;
 if payment.id is null or payment.cash_entry_id<>new.id or application.incoming_car_id is distinct from new.car_id or application.incoming_pot_id<>new.pot_id or payment.amount_cents<>-new.amount_cents or payment.amount_cents<>application.lender_cents
  or statement.application_id<>application.id or receipt.application_id<>application.id or statement.kind<>'statement' or receipt.kind<>'payment' or statement.confirmed_at is null or receipt.confirmed_at is null
  or statement.sha256=receipt.sha256 or current_setting('autodream.uc_trade_in_lender',true) is distinct from txid_current()::text||':'||payment.id::text then raise exception 'LENDER_PAYMENT_PROOF_REQUIRED';end if;
 perform uc_post_journal(new.id::text,new.paid_on,'Trade-in lender balance paid',new.car_id,new.recorded_by,jsonb_build_array(
  jsonb_build_object('accountId','acct-ap','debit',payment.amount_cents::numeric/100,'credit',0),jsonb_build_object('accountId','acct-bank-uc-'||md5(new.bank_account),'debit',0,'credit',payment.amount_cents::numeric/100)));
 return new;
end $$;
create trigger uc_lender_cash_journal after insert on uc_investor_cash_entries for each row when(new.kind='trade_in_lender_out') execute function uc_trade_in_lender_cash();
alter function uc_investor_car_summary(text) rename to uc_car_summary_before_lenders;
create function public.uc_investor_car_summary(p_car text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;application uc_trade_in_applications;paid bigint;begin
 result:=uc_car_summary_before_lenders(p_car);if result is null then return null;end if;
 select * into application from uc_trade_in_applications where incoming_car_id=p_car;
 select coalesce(sum(amount_cents),0) into paid from uc_trade_in_lender_payments where application_id=application.id;
 return result||jsonb_build_object('tradeInApplicationId',application.id,'lenderCents',coalesce(application.lender_cents,0),'lenderPaidCents',paid,
  'purchasePaidCents',(result->>'purchasePaidCents')::bigint+paid,
  'state',case when result->>'state'='reserved' and (result->>'purchasePaidCents')::bigint+paid=(result->>'purchaseCents')::bigint then 'in_stock' else result->>'state' end);
end $$;
alter function uc_investor_position(uuid) rename to uc_position_before_lenders;
create function public.uc_investor_position(p_pot uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;paid bigint;begin
 result:=uc_position_before_lenders(p_pot);
 select coalesce(sum(p.amount_cents),0) into paid from uc_trade_in_lender_payments p join uc_trade_in_applications a on a.id=p.application_id where a.incoming_pot_id=p_pot;
 return result||jsonb_build_object('purchaseReservedCents',(result->>'purchaseReservedCents')::bigint-paid,'reservedCents',(result->>'reservedCents')::bigint-paid,'availableCents',(result->>'availableCents')::bigint+paid);
end $$;
alter function uc_trade_in_choice_view(uuid) rename to uc_choice_before_lenders;
create function public.uc_trade_in_choice_view(p_choice uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select uc_choice_before_lenders(p_choice)||jsonb_build_object('lenderPaidCents',coalesce(payment.amount_cents,0),'applicationId',a.id)
 from (select 1) x left join uc_trade_in_applications a on a.choice_id=p_choice left join uc_trade_in_lender_payments payment on payment.application_id=a.id $$;

create or replace function public.uc_apply_investor_trade_in(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;c uc_trade_in_funding_choices;d uc_trade_in_documents;a uc_trade_in_applications;source uc_investor_cars;
 incoming cars;latest uuid;path text;stored boolean;available bigint;required bigint;chosen uuid;allowed text[];req text;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and (actor.role='director' and actor.business_access='both' or actor.role='investor' and actor.business_access in ('used_car','both') and p_action='proof_read'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 allowed:=case p_action when 'proof_prepare' then array['choiceId','fileName','mimeType','sizeBytes','sha256'] when 'proof_confirm' then array['documentId'] when 'proof_read' then array['documentId'] when 'apply' then array['choiceId','documentId','requestId'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'INVALID';end if;
 if p_action='apply' then
  req:=p_data->>'requestId';if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('trade-in-apply:'||p_actor||':'||req,0));
  select * into a from uc_trade_in_applications where applied_by=p_actor and request_id=req;
  if found then if a.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return jsonb_build_object('choice',uc_trade_in_choice_view(a.choice_id));end if;
 end if;
 if p_action in ('proof_confirm','proof_read') then select * into d from uc_trade_in_documents where id=(p_data->>'documentId')::uuid;chosen:=d.choice_id;
 else chosen:=(p_data->>'choiceId')::uuid;end if;
 select * into c from uc_trade_in_funding_choices where id=chosen;
 if c.id is null then raise exception 'NOT_ALLOWED';end if;
 if p_action='proof_read' then
  if d.confirmed_at is null or actor.role='investor' and not exists(select 1 from uc_trade_in_applications application join uc_investor_pots p on p.id=application.incoming_pot_id join uc_investor_profiles f on f.id=p.profile_id where application.document_id=d.id and f.linked_staff_id=p_actor) then raise exception 'NOT_ALLOWED';end if;
  return jsonb_build_object('documentId',d.id,'path',d.storage_path);
 end if;
 if p_action='proof_confirm' then
  select * into d from uc_trade_in_documents where id=d.id for update;
  if d.confirmed_at is not null then return jsonb_build_object('documentId',d.id);end if;
  execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into stored using 'finance-evidence',d.storage_path;
  if not stored then raise exception 'UPLOAD_MISSING';end if;
  update uc_trade_in_documents set confirmed_by=p_actor,confirmed_at=now() where id=d.id;return jsonb_build_object('documentId',d.id);
 end if;
 if p_action='proof_prepare' then
  if jsonb_typeof(p_data->'fileName') is distinct from 'string' or length(p_data->>'fileName') not between 1 and 120 or p_data->>'fileName'<>trim(p_data->>'fileName') or p_data->>'fileName' ~ '[[:cntrl:]/\\]'
   or coalesce(p_data->>'mimeType','') not in ('image/png','image/jpeg','application/pdf') or coalesce(p_data->>'sha256','') !~ '^[0-9a-f]{64}$' or uc_recovery_cents(p_data->'sizeBytes') not between 1 and 1400000 then raise exception 'INVALID';end if;
  path:='trade-in/'||c.id::text||'/'||(p_data->>'sha256')||case p_data->>'mimeType' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' else '.pdf' end;
  insert into uc_trade_in_documents(choice_id,file_name,mime_type,sha256,size_bytes,storage_path,created_by)
  values(c.id,p_data->>'fileName',p_data->>'mimeType',p_data->>'sha256',(p_data->>'sizeBytes')::integer,path,p_actor) on conflict(storage_path) do nothing;
  select * into d from uc_trade_in_documents where storage_path=path;return jsonb_build_object('documentId',d.id,'path',d.storage_path,'confirmed',d.confirmed_at is not null);
 end if;
 -- Lock pots in UUID order. All existing car-money actions also lock their pot.
 select * into source from uc_investor_cars where car_id=c.outgoing_car_id;
 if source.car_id is null then raise exception 'OUTGOING_INVESTOR_CAR_REQUIRED';end if;
 if c.funding_kind<>'investor' then raise exception 'COMPANY_FUNDING_NOT_READY';end if;

 perform 1 from uc_investor_pots where id in (source.pot_id,c.pot_id) order by id for update;
 perform 1 from cars where id in (c.incoming_car_id,c.outgoing_car_id) order by id for update;
 select * into source from uc_investor_cars where car_id=c.outgoing_car_id;
 select * into incoming from cars where id=c.incoming_car_id;
 select id into latest from uc_trade_in_funding_choices where incoming_car_id=c.incoming_car_id order by revision desc limit 1;
 if latest<>c.id then raise exception 'CHOICE_CHANGED';end if;
 if incoming.trade_in_source_car_id is distinct from c.outgoing_car_id or uc_commission_cents(to_jsonb(incoming)->'purchase_price') is distinct from c.gross_cents or coalesce(uc_commission_cents(to_jsonb(incoming)->'settlement_amount'),0)<>c.lender_cents then raise exception 'TRADE_IN_VALUE_CHANGED';end if;
 if source.sale_cents is null or source.settled_at is not null then raise exception 'SALE_PRICE_REQUIRED';end if;
 if c.gross_cents-c.lender_cents>source.sale_cents-(uc_investor_car_summary(source.car_id)->>'receivedCents')::bigint then raise exception 'TRADE_IN_CREDIT_EXCEEDS_SALE';end if;
 if exists(select 1 from uc_investor_cars where car_id=c.incoming_car_id) or exists(select 1 from uc_trade_in_applications where incoming_car_id=c.incoming_car_id) then raise exception 'TRADE_IN_FUNDING_LOCKED';end if;
 if coalesce(incoming.status,'') not in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') or incoming.investor_id is not null
  or coalesce(to_jsonb(incoming)->>'investor_tagged','false')='true' or incoming.consignment is not null and incoming.consignment<>'null'::jsonb or incoming.outgoing_consignment is not null and incoming.outgoing_consignment<>'null'::jsonb
  or exists(select 1 from journal_entries where car_id=c.incoming_car_id and not coalesce(voided,false)) or exists(select 1 from payments where car_id=c.incoming_car_id) then raise exception 'TRADE_IN_HISTORY_REVIEW_REQUIRED';end if;
 select * into d from uc_trade_in_documents where id=(p_data->>'documentId')::uuid and choice_id=c.id and confirmed_at is not null;
 if d.id is null then raise exception 'TRADE_IN_INVOICE_REQUIRED';end if;
 available:=(uc_investor_position(c.pot_id)->>'availableCents')::bigint;required:=case when c.pot_id=source.pot_id then c.lender_cents else c.gross_cents end;
 if available<required then raise exception 'INSUFFICIENT_FUNDING_POT';end if;
 -- Legacy inventory has investor_split DEFAULT 50 even for ordinary stock.
 -- The explicit reviewed agreement below is the sole funding source.
 update cars set investor_split=null where id=c.incoming_car_id;
 insert into uc_investor_cars(car_id,pot_id,purchase_cents,investor_basis_points,approved_by) values(c.incoming_car_id,c.pot_id,c.gross_cents,c.investor_basis_points,p_actor);
 insert into uc_trade_in_applications(choice_id,incoming_car_id,outgoing_car_id,incoming_pot_id,outgoing_pot_id,amount_cents,lender_cents,document_id,applied_by,request_id,payload)
 values(c.id,c.incoming_car_id,c.outgoing_car_id,c.pot_id,source.pot_id,c.gross_cents-c.lender_cents,c.lender_cents,d.id,p_actor,req,p_data) returning * into a;
 perform uc_post_journal('trade-in:'||a.id::text,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Trade-in car received without bank movement',c.incoming_car_id,p_actor,jsonb_build_array(
  jsonb_build_object('accountId','acct-inv-investor','debit',c.gross_cents::numeric/100,'credit',0),jsonb_build_object('accountId','acct-uc-sale-clearing','debit',0,'credit',(c.gross_cents-c.lender_cents)::numeric/100),jsonb_build_object('accountId','acct-ap','debit',0,'credit',c.lender_cents::numeric/100)));
 if (uc_investor_position(c.pot_id)->>'availableCents')::bigint<0 or (uc_investor_position(source.pot_id)->>'availableCents')::bigint<0 then raise exception 'INSUFFICIENT_FUNDING_POT';end if;
 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(c.pot_id,p_actor,'trade_in_funded',jsonb_build_object('incomingCarId',c.incoming_car_id,'outgoingCarId',c.outgoing_car_id,'applicationId',a.id));
 if source.pot_id<>c.pot_id then insert into uc_investor_audit(pot_id,actor_id,action,detail) values(source.pot_id,p_actor,'trade_in_sale_credit',jsonb_build_object('outgoingCarId',c.outgoing_car_id,'amountCents',c.gross_cents-c.lender_cents,'applicationId',a.id));end if;
 return jsonb_build_object('choice',uc_trade_in_choice_view(c.id));
end $$;

create function public.uc_trade_in_lender_money(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;application uc_trade_in_applications;payment uc_trade_in_lender_payments;d uc_trade_in_lender_documents;statement uc_trade_in_lender_documents;receipt uc_trade_in_lender_documents;
 b uc_investor_banks;cash_id uuid;payment_id uuid;path text;stored boolean;req text;allowed text[];day date;reference text;result jsonb;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and (actor.role='director' or actor.role='investor' and p_action in ('snapshot','proof_read')),false) then raise exception 'NOT_ALLOWED';end if;
 allowed:=case p_action when 'snapshot' then array['applicationId'] when 'proof_prepare' then array['applicationId','kind','fileName','mimeType','sha256','sizeBytes'] when 'proof_confirm' then array['documentId'] when 'proof_read' then array['documentId']
  when 'pay' then array['applicationId','statementDocumentId','receiptDocumentId','bankAccountId','bankReference','paidOn','recipientBank','recipientAccount','recipientName','note','requestId'] end;
 if jsonb_typeof(p_data) is distinct from 'object' or allowed is null or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'INVALID';end if;
 if p_action in ('proof_confirm','proof_read') then select * into d from uc_trade_in_lender_documents where id=(p_data->>'documentId')::uuid;select * into application from uc_trade_in_applications where id=d.application_id;
 else select * into application from uc_trade_in_applications where id=(p_data->>'applicationId')::uuid;end if;
 if application.id is null or application.lender_cents<=0 then raise exception 'NOT_ALLOWED';end if;
 if actor.role='investor' and not exists(select 1 from uc_investor_pots p join uc_investor_profiles f on f.id=p.profile_id where p.id=application.incoming_pot_id and f.linked_staff_id=p_actor) then raise exception 'NOT_ALLOWED';end if;
 if p_action='proof_read' then if d.confirmed_at is null then raise exception 'NOT_ALLOWED';end if;return jsonb_build_object('documentId',d.id,'path',d.storage_path);end if;
 if p_action='snapshot' then
  select * into payment from uc_trade_in_lender_payments where application_id=application.id;
  return jsonb_build_object('applicationId',application.id,'amountCents',application.lender_cents,'paid',payment.id is not null,'paidOn',(select paid_on from uc_investor_cash_entries where id=payment.cash_entry_id),
   'recipientBank',case when actor.role='director' then payment.recipient_bank end,'recipientAccount',case when actor.role='director' then payment.recipient_account end,'recipientName',payment.recipient_name,'accountLast4',right(payment.recipient_account,4),
   'recordedAt',payment.recorded_at,'recordedBy',(select name from garage_building_staff where id=payment.recorded_by),
   'documents',coalesce((select jsonb_agg(jsonb_build_object('id',doc.id,'kind',doc.kind,'name',doc.file_name) order by doc.confirmed_at,doc.id) from uc_trade_in_lender_documents doc where doc.application_id=application.id and doc.confirmed_at is not null),'[]'::jsonb));
 end if;
 if p_action='proof_confirm' then
  select * into d from uc_trade_in_lender_documents where id=d.id for update;
  if d.confirmed_at is null then
   execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into stored using 'finance-evidence',d.storage_path;if not stored then raise exception 'UPLOAD_MISSING';end if;
   update uc_trade_in_lender_documents set confirmed_by=p_actor,confirmed_at=now() where id=d.id;
  end if;return jsonb_build_object('documentId',d.id);
 end if;
 if p_action='proof_prepare' then
  if coalesce(p_data->>'kind','') not in ('statement','payment') or jsonb_typeof(p_data->'fileName') is distinct from 'string' or length(p_data->>'fileName') not between 1 and 120 or p_data->>'fileName'<>trim(p_data->>'fileName') or p_data->>'fileName' ~ '[[:cntrl:]/\\]'
   or coalesce(p_data->>'mimeType','') not in ('image/png','image/jpeg','application/pdf') or coalesce(p_data->>'sha256','') !~ '^[0-9a-f]{64}$' or uc_recovery_cents(p_data->'sizeBytes') not between 1 and 1400000 then raise exception 'INVALID';end if;
  path:='trade-in-lender/'||application.id::text||'/'||(p_data->>'kind')||'-'||(p_data->>'sha256')||case p_data->>'mimeType' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' else '.pdf' end;
  insert into uc_trade_in_lender_documents(application_id,kind,file_name,mime_type,sha256,size_bytes,storage_path,created_by) values(application.id,p_data->>'kind',p_data->>'fileName',p_data->>'mimeType',p_data->>'sha256',(p_data->>'sizeBytes')::integer,path,p_actor) on conflict(storage_path) do nothing;
  select * into d from uc_trade_in_lender_documents where storage_path=path;return jsonb_build_object('documentId',d.id,'path',d.storage_path,'confirmed',d.confirmed_at is not null);
 end if;
 req:=p_data->>'requestId';if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('trade-in-lender:'||p_actor||':'||req,0));
 select * into payment from uc_trade_in_lender_payments where recorded_by=p_actor and request_id=req;
 if found then if payment.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return jsonb_build_object('applicationId',payment.application_id,'paymentId',payment.id);end if;
 perform 1 from uc_investor_pots where id=application.incoming_pot_id for update;
 if exists(select 1 from uc_trade_in_lender_payments where application_id=application.id) then raise exception 'LENDER_ALREADY_PAID';end if;
 select * into statement from uc_trade_in_lender_documents where id=(p_data->>'statementDocumentId')::uuid and application_id=application.id and kind='statement' and confirmed_at is not null;
 select * into receipt from uc_trade_in_lender_documents where id=(p_data->>'receiptDocumentId')::uuid and application_id=application.id and kind='payment' and confirmed_at is not null;
 if statement.id is null or receipt.id is null or statement.sha256=receipt.sha256 then raise exception 'LENDER_PAYMENT_PROOF_REQUIRED';end if;
 if exists(select 1 from unnest(array['recipientBank','recipientAccount','recipientName','note']) k where jsonb_typeof(p_data->k) is distinct from 'string' or length(trim(p_data->>k)) not between 1 and 200 or p_data->>k ~ '[[:cntrl:]]') then raise exception 'LENDER_RECIPIENT_REQUIRED';end if;
 select * into b from uc_investor_banks where id=(p_data->>'bankAccountId')::uuid;day:=(p_data->>'paidOn')::date;reference:=trim(p_data->>'bankReference');
 if b.id is null or day is null or day<b.opening_date or day<(application.applied_at at time zone 'Asia/Kuala_Lumpur')::date or day>(now() at time zone 'Asia/Kuala_Lumpur')::date or coalesce(length(reference),0) not between 1 and 200 then raise exception 'INVALID_BANK_PAYMENT';end if;
 cash_id:=gen_random_uuid();payment_id:=gen_random_uuid();
 insert into uc_trade_in_lender_payments(id,application_id,amount_cents,statement_document_id,receipt_document_id,cash_entry_id,recipient_bank,recipient_account,recipient_name,note,recorded_by,request_id,payload)
 values(payment_id,application.id,application.lender_cents,statement.id,receipt.id,cash_id,trim(p_data->>'recipientBank'),trim(p_data->>'recipientAccount'),trim(p_data->>'recipientName'),trim(p_data->>'note'),p_actor,req,p_data);
 perform set_config('autodream.uc_trade_in_lender',txid_current()::text||':'||payment_id::text,true);
 insert into uc_investor_cash_entries(id,pot_id,kind,amount_cents,car_id,trade_in_lender_payment_id,bank_account,bank_reference,paid_on,recorded_by)
 values(cash_id,application.incoming_pot_id,'trade_in_lender_out',-application.lender_cents,application.incoming_car_id,payment_id,'bank:'||b.id::text,reference,day,p_actor);
 perform set_config('autodream.uc_trade_in_lender','',true);
 if (uc_investor_position(application.incoming_pot_id)->>'availableCents')::bigint<0 then raise exception 'INSUFFICIENT_FUNDS';end if;
 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(application.incoming_pot_id,p_actor,'trade_in_lender_paid',jsonb_build_object('carId',application.incoming_car_id,'paymentId',payment_id,'amountCents',application.lender_cents));
 return jsonb_build_object('applicationId',application.id,'paymentId',payment_id);
end $$;
alter table uc_trade_in_lender_documents enable row level security;alter table uc_trade_in_lender_payments enable row level security;
revoke all on uc_trade_in_lender_documents,uc_trade_in_lender_payments from public,anon,authenticated,service_role;
revoke all on function uc_trade_in_lender_cash(),uc_choice_before_lenders(uuid),uc_trade_in_choice_view(uuid),uc_car_summary_before_lenders(text),uc_position_before_lenders(uuid),uc_investor_car_summary(text),uc_investor_position(uuid),uc_trade_in_lender_money(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_trade_in_lender_money(text,text,jsonb) to service_role;
commit;
