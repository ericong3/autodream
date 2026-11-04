-- PREPARED ONLY. Not installed. Phase 3: registered company banks, stable
-- investor invitations linked on email verification, private bill/payment
-- evidence and read models for the investor finance console. Depends on
-- 20261021010000 (staff invitations), 20261104000000 and 20261104010000.
-- No bank matching, journal posting, email sending or public signup here.
begin;

-- The shape below (bank linkage on money rows, documents, invite links) is
-- prepared for empty investor tables only. Stop instead of reshaping live money.
do $$ begin
 lock table public.uc_investor_profiles,public.uc_investor_pots,public.uc_investor_withdrawals,public.uc_investor_cash_entries,
  public.uc_investor_commands,public.uc_investor_audit,public.uc_investor_cars,public.uc_investor_car_bills,
  public.uc_investor_car_settlements,public.uc_company_investor_profit in access exclusive mode;
 if exists(select 1 from public.uc_investor_profiles) or exists(select 1 from public.uc_investor_pots)
  or exists(select 1 from public.uc_investor_withdrawals) or exists(select 1 from public.uc_investor_cash_entries)
  or exists(select 1 from public.uc_investor_commands) or exists(select 1 from public.uc_investor_audit)
  or exists(select 1 from public.uc_investor_cars) or exists(select 1 from public.uc_investor_car_bills)
  or exists(select 1 from public.uc_investor_car_settlements) or exists(select 1 from public.uc_company_investor_profit) then
  raise exception 'INVESTOR_TABLES_NOT_EMPTY: prepare a data-preserving migration instead';
 end if;
end $$;

-- ── Company bank registry ────────────────────────────────────────────────
create table public.uc_investor_banks (
 id uuid primary key default gen_random_uuid(),
 name text not null check(name=trim(name) and length(name) between 2 and 80 and name !~ '[[:cntrl:]]'),
 opening_date date not null check(opening_date>=date '2000-01-01'),
 opening_cents bigint not null check(opening_cents between 0 and 1000000000000),
 created_by text not null references public.garage_building_staff(id), created_at timestamptz not null default now()
);
create unique index uc_investor_bank_name on public.uc_investor_banks(lower(name));
create trigger uc_investor_banks_fixed before update or delete on public.uc_investor_banks for each row execute function public.uc_investor_immutable();
create trigger uc_investor_banks_no_truncate before truncate on public.uc_investor_banks execute function public.uc_investor_immutable();

-- Money rows name a registered bank as canonical 'bank:<uuid>'. Free text is
-- refused once any bank is registered; earlier local fixtures never register one.
alter table public.uc_investor_cash_entries add column bank_id uuid references public.uc_investor_banks(id);
alter table public.uc_investor_cash_entries add constraint uc_cash_registered_bank check(
 (bank_id is null and (bank_account is null or bank_account !~* '^\s*bank:')) or
 (bank_id is not null and bank_account='bank:'||bank_id::text));
create index uc_cash_by_bank on public.uc_investor_cash_entries(bank_id,paid_on) where bank_id is not null;
create function public.uc_investor_cash_bank() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare b uc_investor_banks;
begin
 if new.bank_account is null then new.bank_id:=null;return new;end if;
 if new.bank_account ~ '^bank:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  select * into b from uc_investor_banks where id=substr(new.bank_account,6)::uuid;
  if b.id is null then raise exception 'INVALID_BANK';end if;
  if new.paid_on is null or new.paid_on<b.opening_date then raise exception 'BEFORE_BANK_OPENING';end if;
  new.bank_id:=b.id;
 elsif new.bank_account ~* '^\s*bank:' then raise exception 'INVALID_BANK';
 elsif exists(select 1 from uc_investor_banks) then raise exception 'REGISTERED_BANK_REQUIRED';
 else new.bank_id:=null;
 end if;
 return new;
end $$;
create trigger uc_investor_cash_bank before insert on public.uc_investor_cash_entries for each row execute function public.uc_investor_cash_bank();

-- ── Stable investor invitations ──────────────────────────────────────────
-- Only the token hash is stored. The token is an HMAC the server re-derives
-- for the same Director + request + account, so a retry returns the same link.
create table public.uc_investor_invite_links (
 invitation_id text primary key references public.autodream_staff_invitations(id),
 profile_id uuid not null references public.uc_investor_profiles(id),
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 created_by text not null references public.garage_building_staff(id),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),
 created_at timestamptz not null default now(),
 linked_staff_id text references public.garage_building_staff(id), linked_at timestamptz,
 check((linked_staff_id is null)=(linked_at is null)), unique(created_by,request_id)
);
create index uc_investor_invites_profile on public.uc_investor_invite_links(profile_id,created_at);
create function public.uc_investor_invite_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op<>'UPDATE' or old.linked_staff_id is not null or new.linked_staff_id is null
  or (to_jsonb(new)-array['linked_staff_id','linked_at']) is distinct from (to_jsonb(old)-array['linked_staff_id','linked_at']) then raise exception 'IMMUTABLE_HISTORY';end if;
 return new;
end $$;
create trigger uc_investor_invites_fixed before update or delete on public.uc_investor_invite_links for each row execute function public.uc_investor_invite_guard();
create trigger uc_investor_invites_no_truncate before truncate on public.uc_investor_invite_links execute function public.uc_investor_immutable();

-- Runs inside the existing verify transaction. Links only the profile whose
-- live investor invitation produced the verify token being redeemed; never a
-- browser-supplied staff or profile ID. Ambiguity links nothing.
create function public.uc_investor_link_verified_staff() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare profiles uuid[]; invitations text[]; target uuid;
begin
 if not coalesce(new.enabled and new.registration_status='active' and new.role='investor' and new.business_access in ('used_car','both'),false) then return new;end if;
 if exists(select 1 from uc_investor_profiles where linked_staff_id=new.id) then return new;end if;
 select array_agg(distinct l.profile_id),array_agg(distinct l.invitation_id) into profiles,invitations
 from uc_investor_invite_links l join autodream_staff_invitations i on i.id=l.invitation_id
 join autodream_email_tokens t on t.invitation_id=i.id
 where t.staff_id=new.id and t.purpose='verify' and t.used_at is null and t.expires_at>now() and lower(t.email)=lower(new.email)
  and i.revoked_at is null and i.consumed_at is not null and i.role='investor' and l.linked_staff_id is null;
 if coalesce(cardinality(profiles),0)<>1 or cardinality(invitations)<>1 then return new;end if;
 target:=profiles[1];
 update uc_investor_profiles set linked_staff_id=new.id where id=target and linked_staff_id is null;
 if found then
  update uc_investor_invite_links set linked_staff_id=new.id,linked_at=now() where invitation_id=invitations[1];
  insert into uc_investor_audit(pot_id,actor_id,action,detail)
  select p.id,new.id,'login_linked',jsonb_build_object('invitationId',invitations[1]) from uc_investor_pots p where p.profile_id=target;
 end if;
 return new;
end $$;
create trigger uc_investor_verified_link after update of email_verified_at on public.garage_building_staff
for each row when (old.email_verified_at is null and new.email_verified_at is not null) execute function public.uc_investor_link_verified_staff();

-- ── Private bill and payment evidence ────────────────────────────────────
create table public.uc_investor_documents (
 id uuid primary key default gen_random_uuid(),
 car_id text not null references public.uc_investor_cars(car_id),
 bill_id uuid not null references public.uc_investor_car_bills(id),
 entry_id uuid references public.uc_investor_cash_entries(id),
 kind text not null check(kind in ('bill','payment')),
 file_name text not null check(file_name=trim(file_name) and length(file_name) between 1 and 120 and file_name !~ '[[:cntrl:]/\\]'),
 mime_type text not null check(mime_type in ('image/png','image/jpeg','application/pdf')),
 size_bytes integer not null check(size_bytes between 1 and 1400000),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 storage_path text not null unique,
 state text not null default 'prepared' check(state in ('prepared','confirmed')),
 created_by text not null references public.garage_building_staff(id), request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),
 created_at timestamptz not null default now(),
 confirmed_by text references public.garage_building_staff(id), confirmed_at timestamptz,
 check((kind='bill')=(entry_id is null)),
 check((state='prepared' and confirmed_by is null and confirmed_at is null) or (state='confirmed' and confirmed_by is not null and confirmed_at is not null)),
 unique(created_by,request_id)
);
create index uc_investor_documents_bill on public.uc_investor_documents(bill_id,state);
create function public.uc_investor_document_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op<>'UPDATE' or old.state<>'prepared' or new.state<>'confirmed'
  or (to_jsonb(new)-array['state','confirmed_by','confirmed_at']) is distinct from (to_jsonb(old)-array['state','confirmed_by','confirmed_at']) then raise exception 'IMMUTABLE_HISTORY';end if;
 return new;
end $$;
create trigger uc_investor_documents_fixed before update or delete on public.uc_investor_documents for each row execute function public.uc_investor_document_guard();
create trigger uc_investor_documents_no_truncate before truncate on public.uc_investor_documents execute function public.uc_investor_immutable();
create index uc_investor_audit_car on public.uc_investor_audit((detail->>'carId'),created_at) where detail ? 'carId';

-- Private bucket, service role only. Skipped where Supabase storage is absent
-- (local rehearsal); refuses to continue if the bucket exists but is public.
do $$ declare is_public boolean; begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('finance-evidence','finance-evidence',false,1400000,array['image/png','image/jpeg','application/pdf']) on conflict (id) do nothing$q$;
  execute $q$select public from storage.buckets where id='finance-evidence'$q$ into is_public;
  if is_public is distinct from false then raise exception 'FINANCE_EVIDENCE_BUCKET_NOT_PRIVATE';end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='finance_evidence_service_only') then
   execute $q$create policy finance_evidence_service_only on storage.objects as restrictive for all to anon,authenticated
    using(bucket_id<>'finance-evidence') with check(bucket_id<>'finance-evidence')$q$;
  end if;
 end if;
end $$;

-- ── Phase 3 command wrapper ──────────────────────────────────────────────
alter function public.uc_investor_capital(text,text,jsonb) rename to uc_investor_capital_phase2;
revoke all on function public.uc_investor_capital_phase2(text,text,jsonb) from public,anon,authenticated,service_role;

create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; bank uc_investor_banks; data jsonb:=p_data; result jsonb; car text;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_data ? 'bankAccountId' then
  if p_action not in ('capital_received','withdrawal_paid','purchase_paid','pay_car_bill','sale_received') or p_data ? 'bankAccount'
   or jsonb_typeof(p_data->'bankAccountId') is distinct from 'string'
   or p_data->>'bankAccountId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID';end if;
  select * into actor from garage_building_staff where id=p_actor for share;
  if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
  select * into bank from uc_investor_banks where id=(p_data->>'bankAccountId')::uuid;
  if bank.id is null then raise exception 'INVALID_BANK';end if;
  if jsonb_typeof(p_data->'paidOn') is distinct from 'string' or p_data->>'paidOn' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID';end if;
  if (p_data->>'paidOn')::date<bank.opening_date then raise exception 'BEFORE_BANK_OPENING';end if;
  data:=(p_data-'bankAccountId')||jsonb_build_object('bankAccount','bank:'||bank.id::text);
 end if;
 result:=uc_investor_capital_phase2(p_actor,p_action,data);
 if p_action<>'car_snapshot' then return result;end if;
 -- Permission was checked by the phase 2 command. Admin: bill evidence only,
 -- no payment rows, bank details or account history. Investor: no evidence.
 select * into actor from garage_building_staff where id=p_actor;
 car:=result->>'carId';
 return result||jsonb_build_object(
  'bills',coalesce((select jsonb_agg(b.value||jsonb_build_object(
    'payments',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'amountCents',-e.amount_cents,'paidOn',e.paid_on) order by e.paid_on,e.recorded_at,e.id)
     from uc_investor_cash_entries e where e.bill_id=(b.value->>'id')::uuid and e.kind='car_expense'),'[]'::jsonb),
    'documents',case when actor.role='investor' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',d.id,'name',d.file_name,'kind',d.kind,'entryId',d.entry_id)) order by d.confirmed_at,d.id)
     from uc_investor_documents d where d.bill_id=(b.value->>'id')::uuid and d.state='confirmed' and actor.role in ('director','admin')),'[]'::jsonb) end
   ) order by b.ordinality) from jsonb_array_elements(result->'bills') with ordinality b),'[]'::jsonb),
  'activity',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'actorName',coalesce(nullif(trim(s.name),''),'Staff'),'createdAt',a.created_at) order by a.created_at desc,a.sequence desc)
   from (select * from uc_investor_audit x where x.detail ? 'carId' and x.detail->>'carId'=car
    and (actor.role<>'admin' or x.action in ('add_car_bill','approve_car_bill','void_car_bill','proof_upload','complete_repair')) order by x.created_at desc,x.sequence desc limit 100) a
   left join garage_building_staff s on s.id=a.actor_id),'[]'::jsonb));
end $$;

-- ── Phase 3 read models, banks, invitations and evidence ─────────────────
create function public.uc_investor_activation(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; allowed text[]; req text; payload jsonb; prior uc_investor_commands;
 bank uc_investor_banks; profile uc_investor_profiles; pot uc_investor_pots; car uc_investor_cars; bill uc_investor_car_bills;
 doc uc_investor_documents; invite jsonb; result jsonb; page integer:=0; day date; amount bigint; entry uuid; path text; stored boolean;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and actor.role in ('director','admin'),false) then raise exception 'NOT_ALLOWED';end if;
 allowed:=case p_action
  when 'save_bank' then array['name','openingDate','openingCents','requestId']
  when 'banks' then array[]::text[] when 'list_profiles' then array[]::text[]
  when 'fundable_cars' then array['page'] when 'car_billing_list' then array['page']
  when 'invite_investor' then array['potId','requestId','invitationId','tokenHash']
  when 'proof_prepare' then array['billId','entryId','kind','fileName','mimeType','sha256','sizeBytes','requestId']
  when 'proof_confirm' then array['documentId'] when 'proof_read' then array['documentId'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'INVALID';end if;
 if actor.role='admin' and p_action not in ('car_billing_list','proof_prepare','proof_confirm','proof_read') then raise exception 'NOT_ALLOWED';end if;
 if p_data ? 'page' then
  if jsonb_typeof(p_data->'page') is distinct from 'number' or p_data->>'page' !~ '^[0-9]{1,4}$' or (p_data->>'page')::integer>1000 then raise exception 'INVALID';end if;
  page:=(p_data->>'page')::integer;
 end if;

 if p_action in ('save_bank','invite_investor','proof_prepare') then
  req:=p_data->>'requestId';
  if jsonb_typeof(p_data->'requestId') is distinct from 'string' or req !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  -- Same lock as the money commands, so one reference cannot race two actions.
  perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
  payload:=jsonb_build_object('action',p_action,'data',p_data);
  select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
  if found then
   if prior.payload is distinct from payload then raise exception 'REQUEST_CHANGED';end if;
   if p_action='proof_prepare' then
    select * into doc from uc_investor_documents where id=(prior.result->>'documentId')::uuid;
    if doc.id is null then raise exception 'INVALID';end if;
    return jsonb_build_object('documentId',doc.id,'path',doc.storage_path,'state',doc.state);
   end if;
   return prior.result;
  end if;
 end if;

 if p_action='save_bank' then
  if jsonb_typeof(p_data->'name') is distinct from 'string' or length(trim(p_data->>'name')) not between 2 and 80 or p_data->>'name' ~ '[[:cntrl:]]'
   or jsonb_typeof(p_data->'openingDate') is distinct from 'string' or p_data->>'openingDate' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
   or jsonb_typeof(p_data->'openingCents') is distinct from 'number' or p_data->>'openingCents' !~ '^(0|[1-9][0-9]{0,12})$' then raise exception 'INVALID';end if;
  day:=(p_data->>'openingDate')::date;amount:=(p_data->>'openingCents')::bigint;
  if amount>1000000000000 then raise exception 'INVALID';end if;
  if day>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'FUTURE_DATE';end if;
  insert into uc_investor_banks(name,opening_date,opening_cents,created_by)
  values(regexp_replace(trim(p_data->>'name'),'\s+',' ','g'),day,amount,p_actor) returning * into bank;
  result:=jsonb_build_object('bank',jsonb_build_object('id',bank.id,'name',bank.name,'openingDate',bank.opening_date,'openingCents',bank.opening_cents));
  insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,payload,result);
  return result;
 elsif p_action='banks' then
  return jsonb_build_object('banks',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'openingDate',b.opening_date,'openingCents',b.opening_cents) order by lower(b.name),b.id) from uc_investor_banks b),'[]'::jsonb));
 elsif p_action='list_profiles' then
  return jsonb_build_object(
   'profiles',coalesce((select jsonb_agg(x.j order by lower(x.name),x.id) from (
    select f.name,f.id,jsonb_build_object('id',f.id,'name',f.name,'potId',p.id,'linkedStaffId',f.linked_staff_id,'hasLogin',f.linked_staff_id is not null,
     'invite',(select jsonb_build_object('expiresAt',i.expires_at,'registered',i.consumed_at is not null) from uc_investor_invite_links l
      join autodream_staff_invitations i on i.id=l.invitation_id
      where l.profile_id=f.id and l.linked_staff_id is null and i.revoked_at is null and (i.consumed_at is not null or i.expires_at>now()) order by l.created_at desc limit 1),
     'position',uc_investor_position(p.id),
     'cars',coalesce((select jsonb_agg(uc_investor_car_summary(a.car_id) order by a.approved_at desc,a.car_id) from uc_investor_cars a where a.pot_id=p.id),'[]'::jsonb),
     'withdrawals',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'amountCents',w.amount_cents,'state',w.state,'requestedAt',w.requested_at,'reviewedAt',w.reviewed_at,'note',w.review_note) order by w.requested_at desc,w.id)
      from uc_investor_withdrawals w where w.pot_id=p.id),'[]'::jsonb)) j
    from uc_investor_profiles f join uc_investor_pots p on p.profile_id=f.id) x),'[]'::jsonb),
   'banks',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'openingDate',b.opening_date,'openingCents',b.opening_cents) order by lower(b.name),b.id) from uc_investor_banks b),'[]'::jsonb),
   'companyProfitCents',(select coalesce(sum(amount_cents),0) from uc_company_investor_profit));
 elsif p_action='fundable_cars' then
  -- Mirrors the fund_car eligibility test; fund_car re-checks under lock.
  -- One extra row is read only to report whether another page exists.
  with page_rows as (select c.id,c.make,c.model,c.year,c.car_plate,c.photo,c.purchase_price,row_number() over(order by c.make,c.model,c.id) n from cars c
   where coalesce(c.status,'') in ('available','coming_soon','in_workshop','ready','photo_complete','submitted')
    and c.investor_id is null and c.investor_split is null and c.trade_in_source_car_id is null
    and coalesce(to_jsonb(c)->>'investor_tagged','false')<>'true'
    and (c.consignment is null or c.consignment='null'::jsonb) and (c.outgoing_consignment is null or c.outgoing_consignment='null'::jsonb)
    and c.purchase_price>0 and c.purchase_price*100=trunc(c.purchase_price*100) and c.purchase_price*100<=1000000000000
    and not exists(select 1 from uc_investor_cars a where a.car_id=c.id)
    and not exists(select 1 from journal_entries j where j.car_id=c.id and not coalesce(j.voided,false))
    and not exists(select 1 from payments p where p.car_id=c.id)
    and not exists(select 1 from repairs r where r.car_id=c.id and (r.status='done' or r.completed_at is not null or coalesce(r.actual_cost,0)<>0))
   order by c.make,c.model,c.id limit 51 offset page*50)
  select jsonb_build_object('cars',coalesce(jsonb_agg(jsonb_build_object('id',r.id,'make',r.make,'model',r.model,'year',r.year,'car_plate',r.car_plate,'photo',r.photo,'purchase_price',r.purchase_price) order by r.n) filter(where r.n<=page*50+50),'[]'::jsonb),
   'page',page,'hasMore',count(*)>50) into result from page_rows r;
  return result;
 elsif p_action='car_billing_list' then
  -- Safe identities for bill entry. No price, account, investor or balance.
  with page_rows as (select a.car_id,c.make,c.model,c.year,c.car_plate,c.photo,
    (select count(*) from uc_investor_car_bills b where b.car_id=a.car_id and b.state='pending') pending,row_number() over(order by a.approved_at desc,a.car_id) n
   from uc_investor_cars a join cars c on c.id=a.car_id where a.settled_at is null order by a.approved_at desc,a.car_id limit 51 offset page*50)
  select jsonb_build_object('cars',coalesce(jsonb_agg(jsonb_build_object('carId',r.car_id,'make',r.make,'model',r.model,'year',r.year,'plate',r.car_plate,'photo',r.photo,'pendingBills',r.pending) order by r.n) filter(where r.n<=page*50+50),'[]'::jsonb),
   'page',page,'hasMore',count(*)>50) into result from page_rows r;
  return result;
 elsif p_action='invite_investor' then
  if jsonb_typeof(p_data->'potId') is distinct from 'string' or p_data->>'potId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or coalesce(p_data->>'invitationId','') !~ '^[0-9a-f]{32}$' or coalesce(p_data->>'tokenHash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID';end if;
  -- Take the account-lifecycle lock before investor row locks: email
  -- verification holds it first and then links the profile (no deadlock).
  perform pg_advisory_xact_lock(hashtextextended('autodream-account-lifecycle',0));
  select * into pot from uc_investor_pots where id=(p_data->>'potId')::uuid for update;
  if pot.id is null then raise exception 'NOT_ALLOWED';end if;
  select * into profile from uc_investor_profiles where id=pot.profile_id for update;
  if profile.linked_staff_id is not null then raise exception 'ALREADY_LINKED';end if;
  -- One live link per investor: an older link (used or not) can no longer verify.
  update autodream_staff_invitations i set revoked_at=now() from uc_investor_invite_links l
  where l.invitation_id=i.id and l.profile_id=profile.id and i.revoked_at is null;
  invite:=autodream_account_action('invite',p_actor,jsonb_build_object('id',p_data->>'invitationId','tokenHash',p_data->>'tokenHash','role','investor','businessAccess','used_car'));
  insert into uc_investor_invite_links(invitation_id,profile_id,token_hash,created_by,request_id) values(invite->>'id',profile.id,p_data->>'tokenHash',p_actor,req);
  result:=jsonb_build_object('potId',pot.id,'profileId',profile.id,'invitationId',invite->>'id','expiresAt',invite->'expiresAt');
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot.id,p_actor,'invite_investor',jsonb_build_object('requestId',req,'invitationId',invite->>'id'));
  insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,payload,result);
  return result;
 elsif p_action='proof_prepare' then
  if jsonb_typeof(p_data->'billId') is distinct from 'string' or p_data->>'billId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (p_data ? 'entryId' and (jsonb_typeof(p_data->'entryId') is distinct from 'string' or p_data->>'entryId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
   or coalesce(p_data->>'kind','') not in ('bill','payment') or (p_data->>'kind'='payment')<>(p_data ? 'entryId')
   or jsonb_typeof(p_data->'fileName') is distinct from 'string' or p_data->>'fileName'<>trim(p_data->>'fileName') or length(p_data->>'fileName') not between 1 and 120 or p_data->>'fileName' ~ '[[:cntrl:]/\\]'
   or coalesce(p_data->>'mimeType','') not in ('image/png','image/jpeg','application/pdf') or coalesce(p_data->>'sha256','') !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(p_data->'sizeBytes') is distinct from 'number' or p_data->>'sizeBytes' !~ '^[1-9][0-9]{0,6}$' or (p_data->>'sizeBytes')::integer>1400000 then raise exception 'INVALID';end if;
  select * into bill from uc_investor_car_bills where id=(p_data->>'billId')::uuid;
  if bill.id is null then raise exception 'NOT_ALLOWED';end if;
  select * into car from uc_investor_cars where car_id=bill.car_id;
  perform 1 from uc_investor_pots where id=car.pot_id for update;
  select * into bill from uc_investor_car_bills where id=bill.id for update;

  if p_data ? 'entryId' then
   select e.id into entry from uc_investor_cash_entries e where e.id=(p_data->>'entryId')::uuid and e.bill_id=bill.id and e.kind='car_expense';
   if entry is null then raise exception 'NOT_ALLOWED';end if;
  end if;
  select * into doc from uc_investor_documents where created_by=p_actor and request_id=req;
  if doc.id is not null then
   if doc.bill_id<>bill.id or doc.entry_id is distinct from entry or doc.kind<>p_data->>'kind' or doc.sha256<>p_data->>'sha256'
    or doc.mime_type<>p_data->>'mimeType' or doc.size_bytes<>(p_data->>'sizeBytes')::integer or doc.file_name<>p_data->>'fileName' then raise exception 'REQUEST_CHANGED';end if;
  else
   path:='bills/'||bill.id::text||'/'||case when entry is null then 'bill' else 'payment-'||entry::text end||'-'||(p_data->>'sha256')||
    case p_data->>'mimeType' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' else '.pdf' end;
   -- The same file on the same bill/payment is one document, whoever retries.
   select * into doc from uc_investor_documents where storage_path=path;
   if doc.id is null then
    if bill.state='voided' then raise exception 'BILL_VOIDED';end if;
    if (select count(*) from uc_investor_documents where bill_id=bill.id)>=20 then raise exception 'PROOF_LIMIT';end if;
    insert into uc_investor_documents(car_id,bill_id,entry_id,kind,file_name,mime_type,size_bytes,sha256,storage_path,created_by,request_id)
    values(car.car_id,bill.id,entry,p_data->>'kind',p_data->>'fileName',p_data->>'mimeType',(p_data->>'sizeBytes')::integer,p_data->>'sha256',path,p_actor,req) returning * into doc;
   end if;
  end if;
  insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,payload,jsonb_build_object('documentId',doc.id));
  -- Path stays server-side; the HTTP layer never returns it to the browser.
  return jsonb_build_object('documentId',doc.id,'path',doc.storage_path,'state',doc.state);
 elsif p_action in ('proof_confirm','proof_read') then
  if jsonb_typeof(p_data->'documentId') is distinct from 'string' or p_data->>'documentId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID';end if;
  select * into doc from uc_investor_documents where id=(p_data->>'documentId')::uuid;
  if doc.id is null then raise exception 'NOT_ALLOWED';end if;
  if p_action='proof_read' then
   if doc.state<>'confirmed' then raise exception 'NOT_ALLOWED';end if;
   return jsonb_build_object('documentId',doc.id,'path',doc.storage_path,'fileName',doc.file_name,'mimeType',doc.mime_type);
  end if;
  select * into car from uc_investor_cars where car_id=doc.car_id;
  perform 1 from uc_investor_pots where id=car.pot_id for update;
  select * into doc from uc_investor_documents where id=doc.id for update;
  if doc.state='confirmed' then return jsonb_build_object('documentId',doc.id,'state',doc.state);end if;
  if to_regclass('storage.objects') is not null then
   execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into stored using 'finance-evidence',doc.storage_path;
   if not stored then raise exception 'UPLOAD_MISSING';end if;
  end if;
  update uc_investor_documents set state='confirmed',confirmed_by=p_actor,confirmed_at=now() where id=doc.id returning * into doc;
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(car.pot_id,p_actor,'proof_upload',jsonb_build_object('requestId',doc.request_id,'carId',doc.car_id,'billId',doc.bill_id,'documentId',doc.id,'kind',doc.kind));
  return jsonb_build_object('documentId',doc.id,'state',doc.state);
 end if;
 raise exception 'INVALID';
end $$;

alter table public.uc_investor_banks enable row level security;
alter table public.uc_investor_invite_links enable row level security;
alter table public.uc_investor_documents enable row level security;
revoke all on table public.uc_investor_banks,public.uc_investor_invite_links,public.uc_investor_documents from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_cash_bank() from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_invite_guard() from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_document_guard() from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_link_verified_staff() from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_activation(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_investor_capital(text,text,jsonb) to service_role;
grant execute on function public.uc_investor_activation(text,text,jsonb) to service_role;
commit;
