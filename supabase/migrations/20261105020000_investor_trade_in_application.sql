-- PREPARED ONLY. Debt-free investor trade-ins. Company-funded or financed
-- trade-ins remain awaiting funding until their bank/lender workflow exists.
begin;
do $$ begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' then raise exception 'PRIVATE_FINANCE_RELEASE_NOT_REVIEWED';end if;
 if to_regclass('uc_sale_money_orders') is null or to_regclass('uc_trade_in_funding_choices') is null then raise exception 'TRADE_IN_DEPENDENCIES_REQUIRED';end if;
end $$;
create table public.uc_trade_in_documents (
 id uuid primary key default gen_random_uuid(),choice_id uuid not null references uc_trade_in_funding_choices(id),
 file_name text not null check(length(file_name) between 1 and 120 and file_name=trim(file_name) and file_name !~ '[[:cntrl:]/\\]'),
 mime_type text not null check(mime_type in ('image/png','image/jpeg','application/pdf')),sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 size_bytes integer not null check(size_bytes between 1 and 1400000),storage_path text not null unique,
 created_by text not null references garage_building_staff(id),created_at timestamptz not null default now(),
 confirmed_by text references garage_building_staff(id),confirmed_at timestamptz,check((confirmed_by is null)=(confirmed_at is null))
);
create table public.uc_trade_in_applications (
 id uuid primary key default gen_random_uuid(),choice_id uuid not null unique references uc_trade_in_funding_choices(id),
 incoming_car_id text not null unique references uc_investor_cars(car_id),outgoing_car_id text not null references uc_investor_cars(car_id),
 incoming_pot_id uuid not null references uc_investor_pots(id),outgoing_pot_id uuid not null references uc_investor_pots(id),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),document_id uuid not null unique references uc_trade_in_documents(id),
 applied_by text not null references garage_building_staff(id),applied_at timestamptz not null default now(),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),payload jsonb not null,unique(applied_by,request_id),check(incoming_car_id<>outgoing_car_id)
);
create function public.uc_trade_in_document_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and old.confirmed_at is null and new.confirmed_at is not null and new.confirmed_by is not null
  and to_jsonb(old)-array['confirmed_at','confirmed_by']=to_jsonb(new)-array['confirmed_at','confirmed_by'] then return new;end if;
 raise exception 'IMMUTABLE_HISTORY';
end $$;
create trigger uc_trade_in_documents_fixed before update or delete on uc_trade_in_documents for each row execute function uc_trade_in_document_guard();
create trigger uc_trade_in_documents_no_truncate before truncate on uc_trade_in_documents execute function uc_investor_immutable();
create trigger uc_trade_in_applications_fixed before update or delete on uc_trade_in_applications for each row execute function uc_investor_immutable();
create trigger uc_trade_in_applications_no_truncate before truncate on uc_trade_in_applications execute function uc_investor_immutable();
create function public.uc_applied_trade_in_car_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if (new.trade_in_source_car_id is distinct from old.trade_in_source_car_id or to_jsonb(new)->'settlement_amount' is distinct from to_jsonb(old)->'settlement_amount')
  and exists(select 1 from uc_trade_in_applications where incoming_car_id=old.id) then raise exception 'TRADE_IN_FUNDING_LOCKED';end if;
 return new;
end $$;
create trigger uc_applied_trade_in_car_fixed before update on cars for each row execute function uc_applied_trade_in_car_guard();

alter function public.uc_investor_car_summary(text) rename to uc_car_summary_before_trade_ins;
create function public.uc_investor_car_summary(p_car text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;paid bigint;received bigint;begin
 result:=uc_car_summary_before_trade_ins(p_car);if result is null then return null;end if;
 select coalesce(sum(amount_cents),0) into paid from uc_trade_in_applications where incoming_car_id=p_car;
 select coalesce(sum(amount_cents),0) into received from uc_trade_in_applications where outgoing_car_id=p_car;
 return result||jsonb_build_object('purchasePaidCents',(result->>'purchasePaidCents')::bigint+paid,
  'noncashPurchaseCents',paid,'tradeInReceivedCents',received,'receivedCents',(result->>'receivedCents')::bigint+received,
  'state',case when result->>'state'='reserved' and (result->>'purchasePaidCents')::bigint+paid=(result->>'purchaseCents')::bigint then 'in_stock' else result->>'state' end);
end $$;
alter function public.uc_investor_position(uuid) rename to uc_position_before_trade_ins;
create function public.uc_investor_position(p_pot uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;movement bigint;purchases bigint;begin
 result:=uc_position_before_trade_ins(p_pot);
 select coalesce(sum(case when outgoing_pot_id=p_pot then amount_cents else 0 end-case when incoming_pot_id=p_pot then amount_cents else 0 end),0),
 coalesce(sum(amount_cents) filter(where incoming_pot_id=p_pot),0) into movement,purchases from uc_trade_in_applications where outgoing_pot_id=p_pot or incoming_pot_id=p_pot;
 return result||jsonb_build_object('cashCents',(result->>'cashCents')::bigint+movement,'tradeInOwnershipCents',movement,
  'purchaseReservedCents',(result->>'purchaseReservedCents')::bigint-purchases,'reservedCents',(result->>'reservedCents')::bigint-purchases,
  'availableCents',(result->>'availableCents')::bigint+movement+purchases);
end $$;
alter function public.uc_trade_in_choice_view(uuid) rename to uc_trade_in_choice_before_application;
create function public.uc_trade_in_choice_view(p_choice uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select uc_trade_in_choice_before_application(p_choice)||jsonb_build_object('financiallyApplied',a.id is not null,'status',case when a.id is null then 'chosen' else 'funded' end,'appliedAt',a.applied_at,
  'appliedBy',(select name from garage_building_staff where id=a.applied_by))
 from (select 1) x left join uc_trade_in_applications a on a.choice_id=p_choice $$;

create function public.uc_apply_investor_trade_in(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
 if c.lender_cents<>0 then raise exception 'LENDER_SETTLEMENT_NOT_READY';end if;
 perform 1 from uc_investor_pots where id in (source.pot_id,c.pot_id) order by id for update;
 perform 1 from cars where id in (c.incoming_car_id,c.outgoing_car_id) order by id for update;
 select * into source from uc_investor_cars where car_id=c.outgoing_car_id;
 select * into incoming from cars where id=c.incoming_car_id;
 select id into latest from uc_trade_in_funding_choices where incoming_car_id=c.incoming_car_id order by revision desc limit 1;
 if latest<>c.id then raise exception 'CHOICE_CHANGED';end if;
 if incoming.trade_in_source_car_id is distinct from c.outgoing_car_id or uc_commission_cents(to_jsonb(incoming)->'purchase_price') is distinct from c.gross_cents or coalesce(uc_commission_cents(to_jsonb(incoming)->'settlement_amount'),0)<>c.lender_cents then raise exception 'TRADE_IN_VALUE_CHANGED';end if;
 if source.sale_cents is null or source.settled_at is not null then raise exception 'SALE_PRICE_REQUIRED';end if;
 if c.gross_cents>source.sale_cents-(uc_investor_car_summary(source.car_id)->>'receivedCents')::bigint then raise exception 'TRADE_IN_CREDIT_EXCEEDS_SALE';end if;
 if exists(select 1 from uc_investor_cars where car_id=c.incoming_car_id) or exists(select 1 from uc_trade_in_applications where incoming_car_id=c.incoming_car_id) then raise exception 'TRADE_IN_FUNDING_LOCKED';end if;
 if coalesce(incoming.status,'') not in ('available','coming_soon','in_workshop','ready','photo_complete','submitted') or incoming.investor_id is not null
  or coalesce(to_jsonb(incoming)->>'investor_tagged','false')='true' or incoming.consignment is not null and incoming.consignment<>'null'::jsonb or incoming.outgoing_consignment is not null and incoming.outgoing_consignment<>'null'::jsonb
  or exists(select 1 from journal_entries where car_id=c.incoming_car_id and not coalesce(voided,false)) or exists(select 1 from payments where car_id=c.incoming_car_id) then raise exception 'TRADE_IN_HISTORY_REVIEW_REQUIRED';end if;
 select * into d from uc_trade_in_documents where id=(p_data->>'documentId')::uuid and choice_id=c.id and confirmed_at is not null;
 if d.id is null then raise exception 'TRADE_IN_INVOICE_REQUIRED';end if;
 available:=(uc_investor_position(c.pot_id)->>'availableCents')::bigint;required:=case when c.pot_id=source.pot_id then 0 else c.gross_cents end;
 if available<required then raise exception 'INSUFFICIENT_FUNDING_POT';end if;
 -- Legacy inventory has investor_split DEFAULT 50 even for ordinary stock.
 -- The explicit reviewed agreement below is the sole funding source.
 update cars set investor_split=null where id=c.incoming_car_id;
 insert into uc_investor_cars(car_id,pot_id,purchase_cents,investor_basis_points,approved_by) values(c.incoming_car_id,c.pot_id,c.gross_cents,c.investor_basis_points,p_actor);
 insert into uc_trade_in_applications(choice_id,incoming_car_id,outgoing_car_id,incoming_pot_id,outgoing_pot_id,amount_cents,document_id,applied_by,request_id,payload)
 values(c.id,c.incoming_car_id,c.outgoing_car_id,c.pot_id,source.pot_id,c.gross_cents,d.id,p_actor,req,p_data) returning * into a;
 perform uc_post_journal('trade-in:'||a.id::text,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Trade-in car received without bank movement',c.incoming_car_id,p_actor,jsonb_build_array(
  jsonb_build_object('accountId','acct-inv-investor','debit',c.gross_cents::numeric/100,'credit',0),jsonb_build_object('accountId','acct-uc-sale-clearing','debit',0,'credit',c.gross_cents::numeric/100)));
 if (uc_investor_position(c.pot_id)->>'availableCents')::bigint<0 or (uc_investor_position(source.pot_id)->>'availableCents')::bigint<0 then raise exception 'INSUFFICIENT_FUNDING_POT';end if;
 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(c.pot_id,p_actor,'trade_in_funded',jsonb_build_object('incomingCarId',c.incoming_car_id,'outgoingCarId',c.outgoing_car_id,'applicationId',a.id));
 if source.pot_id<>c.pot_id then insert into uc_investor_audit(pot_id,actor_id,action,detail) values(source.pot_id,p_actor,'trade_in_sale_credit',jsonb_build_object('outgoingCarId',c.outgoing_car_id,'amountCents',c.gross_cents,'applicationId',a.id));end if;
 return jsonb_build_object('choice',uc_trade_in_choice_view(c.id));
end $$;

-- An applied trade-in was paid by car value, not another bank purchase.
alter function public.uc_investor_capital(text,text,jsonb) rename to uc_capital_before_trade_ins;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;owner_pot uuid;
begin
 if p_action in ('purchase_paid','void_funding') and exists(select 1 from uc_trade_in_applications where incoming_car_id=p_data->>'carId') then raise exception 'TRADE_IN_ALREADY_FUNDED';end if;
 result:=uc_capital_before_trade_ins(p_actor,p_action,p_data);
 if p_action='car_snapshot' then result:=result||jsonb_build_object('tradeInDocumentId',(select document_id from uc_trade_in_applications where incoming_car_id=p_data->>'carId'));end if;
 if p_action='snapshot' then
  owner_pot:=(result->'position'->>'potId')::uuid;
  result:=result||jsonb_build_object('entries',coalesce((select jsonb_agg(e.value order by e.value->>'recordedAt' desc,e.value->>'id') from (
   select value from jsonb_array_elements(result->'entries')
   union all select jsonb_build_object('id',a.id::text||':in','kind','trade_in_value_in','amountCents',a.amount_cents,'paidOn',null,'recordedAt',a.applied_at)
    from uc_trade_in_applications a where a.outgoing_pot_id=owner_pot and a.incoming_pot_id<>a.outgoing_pot_id
   union all select jsonb_build_object('id',a.id::text||':out','kind','trade_in_value_out','amountCents',-a.amount_cents,'paidOn',null,'recordedAt',a.applied_at)
    from uc_trade_in_applications a where a.incoming_pot_id=owner_pot and a.incoming_pot_id<>a.outgoing_pot_id
  ) e),'[]'::jsonb));
 end if;
 return result;
end $$;
alter table uc_trade_in_documents enable row level security;alter table uc_trade_in_applications enable row level security;
revoke all on uc_trade_in_documents,uc_trade_in_applications from public,anon,authenticated,service_role;
revoke all on function uc_applied_trade_in_car_guard(),uc_trade_in_document_guard(),uc_car_summary_before_trade_ins(text),uc_position_before_trade_ins(uuid),uc_trade_in_choice_before_application(uuid),uc_investor_car_summary(text),uc_investor_position(uuid),uc_trade_in_choice_view(uuid),uc_apply_investor_trade_in(text,text,jsonb),uc_capital_before_trade_ins(text,text,jsonb),uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_apply_investor_trade_in(text,text,jsonb),uc_investor_capital(text,text,jsonb) to service_role;
commit;
