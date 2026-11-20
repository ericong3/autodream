-- Money received first, paperwork later. On any car (stock, consignment,
-- investor, trade-in) the Director records money that came in: amount, date,
-- bank, and optionally the slip. Nothing else is checked.
--  * On or after the bank's opening date the money enters that bank at once:
--    Dr the bank / Cr "Money received - to match" (a holding account). The
--    later matching step moves it to the car's proper records.
--  * Before the opening date the money is already inside the opening balance,
--    so the car is only marked received: no bank movement, no journal.
--  * The slip can be added later by the Director or admin.
begin;
do $$ begin
 if to_regclass('public.uc_bank_movements') is null or to_regprocedure('public.uc_post_journal(text,date,text,text,text,jsonb)') is null
  or to_regclass('public.uc_investor_banks') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;

insert into ledger_accounts(id,name,type) values('acct-money-to-match','Money received - to match','liability') on conflict(id) do nothing;
alter table uc_bank_movements drop constraint uc_bank_source_kind;
alter table uc_bank_movements add constraint uc_bank_source_kind check(source_kind in ('investor','company','company_receipt','money_received'));

create table public.uc_money_received(
 id uuid primary key default gen_random_uuid(),
 car_id text not null references cars(id),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),
 received_on date not null,
 bank_id uuid not null references uc_investor_banks(id),
 bank_reference text not null check(length(trim(bank_reference)) between 1 and 200),
 before_opening boolean not null,
 note text not null default '' check(length(note)<=500),
 state text not null default 'to_match' check(state in ('to_match','matched')),
 slip_path text unique,slip_name text,slip_mime text check(slip_mime in ('image/png','image/jpeg','application/pdf')),slip_sha256 text check(slip_sha256 ~ '^[0-9a-f]{64}$'),
 slip_by text references garage_building_staff(id),slip_at timestamptz,
 recorded_by text not null references garage_building_staff(id),recorded_at timestamptz not null default now(),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),payload jsonb not null,
 matched_by text references garage_building_staff(id),matched_at timestamptz,match_note text,
 unique(recorded_by,request_id));
create index uc_money_received_car on uc_money_received(car_id,received_on);
alter table uc_money_received enable row level security;
revoke all on uc_money_received from public,anon,authenticated,service_role;

-- Only two later changes are allowed: attach the slip once, and match once.
create function public.uc_money_received_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare a jsonb:=to_jsonb(new);b jsonb:=to_jsonb(old);slip text[]:=array['slip_path','slip_name','slip_mime','slip_sha256','slip_by','slip_at'];m text[]:=array['state','matched_by','matched_at','match_note'];
begin
 if tg_op='UPDATE' then
  if old.slip_at is null and (a-slip)=(b-slip) then return new;end if;
  if old.state='to_match' and new.state='matched' and (a-m)=(b-m) then return new;end if;
 end if;
 raise exception 'IMMUTABLE_HISTORY';
end $$;
create trigger uc_money_received_fixed before update or delete on uc_money_received for each row execute function uc_money_received_guard();
create trigger uc_money_received_no_truncate before truncate on uc_money_received execute function uc_investor_immutable();

create function public.uc_money_received_view(r uc_money_received) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',r.id,'carId',r.car_id,'amountCents',r.amount_cents,'receivedOn',r.received_on,'bankName',(select name from uc_investor_banks where id=r.bank_id),
  'bankReference',r.bank_reference,'beforeOpening',r.before_opening,'note',r.note,'state',r.state,'hasSlip',r.slip_at is not null,'slipName',r.slip_name,
  'recordedBy',(select name from garage_building_staff where id=r.recorded_by),'recordedAt',r.recorded_at,'matchedAt',r.matched_at) $$;

create function public.uc_money_received_action(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;r uc_money_received;c cars;b uc_investor_banks;amount bigint;day date;ref text;req text;allowed text[];path text;stored boolean;
begin
 select * into actor from garage_building_staff where id=p_actor;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and (actor.role='director' or actor.role='admin' and p_action in ('list','summary','slip_prepare','slip_confirm','slip_read')),false) then raise exception 'NOT_ALLOWED';end if;
 allowed:=case p_action when 'record' then array['carId','amountCents','receivedOn','bankAccountId','bankReference','note','requestId'] when 'list' then array['carId'] when 'summary' then array[]::text[]
  when 'slip_prepare' then array['id','fileName','mimeType','sha256'] when 'slip_confirm' then array['id','path','fileName'] when 'slip_read' then array['id'] end;
 if allowed is null or jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'INVALID';end if;

 if p_action='record' then
  req:=p_data->>'requestId';if coalesce(req,'')!~'^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('money-received:'||p_actor||':'||req,0));
  select * into r from uc_money_received where recorded_by=p_actor and request_id=req;
  if found then if r.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return jsonb_build_object('entry',uc_money_received_view(r));end if;
  select * into c from cars where id=p_data->>'carId';if c.id is null then raise exception 'INVALID';end if;
  if jsonb_typeof(p_data->'amountCents') is distinct from 'number' or coalesce(p_data->>'amountCents','')!~'^[1-9][0-9]{0,12}$' then raise exception 'INVALID';end if;
  amount:=(p_data->>'amountCents')::bigint;
  day:=case when coalesce(p_data->>'receivedOn','')~'^\d{4}-\d{2}-\d{2}$' then (p_data->>'receivedOn')::date end;
  if day is null or day<date '2000-01-01' or day>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'INVALID_DATE';end if;
  select * into b from uc_investor_banks where id=case when coalesce(p_data->>'bankAccountId','')~'^[0-9a-fA-F-]{36}$' then (p_data->>'bankAccountId')::uuid end;
  if b.id is null then raise exception 'BANK_REQUIRED';end if;
  if jsonb_typeof(coalesce(p_data->'note','""'::jsonb))<>'string' or length(coalesce(p_data->>'note',''))>500 or jsonb_typeof(coalesce(p_data->'bankReference','""'::jsonb))<>'string' then raise exception 'INVALID';end if;
  ref:=nullif(trim(coalesce(p_data->>'bankReference','')),'');
  if ref is not null and (length(ref)>200 or exists(select 1 from uc_bank_movements where bank_id=b.id and lower(trim(bank_reference))=lower(ref)) or exists(select 1 from uc_money_received where bank_id=b.id and lower(trim(bank_reference))=lower(ref))) then raise exception 'DUPLICATE_REFERENCE';end if;
  insert into uc_money_received(car_id,amount_cents,received_on,bank_id,bank_reference,before_opening,note,recorded_by,request_id,payload)
   values(c.id,amount,day,b.id,coalesce(ref,'MR-'||left(md5(p_actor||req),10)),day<b.opening_date,trim(coalesce(p_data->>'note','')),p_actor,req,p_data) returning * into r;
  if not r.before_opening then
   insert into uc_bank_movements(bank_id,amount_cents,paid_on,bank_reference,source_kind,source_id,recorded_by) values(b.id,amount,day,r.bank_reference,'money_received',r.id,p_actor);
   perform uc_post_journal('money-received:'||r.id,day,'Money received for '||concat_ws(' ',c.make,c.model,c.car_plate)||' - to match',null,p_actor,
    jsonb_build_array(jsonb_build_object('accountId','acct-bank-uc-'||md5('bank:'||b.id::text),'debit',amount::numeric/100,'credit',0),jsonb_build_object('accountId','acct-money-to-match','debit',0,'credit',amount::numeric/100)));
  end if;
  return jsonb_build_object('entry',uc_money_received_view(r));
 end if;

 if p_action='list' then
  return jsonb_build_object('carId',p_data->>'carId','entries',coalesce((select jsonb_agg(uc_money_received_view(x) order by x.received_on,x.recorded_at) from uc_money_received x where x.car_id=p_data->>'carId'),'[]'::jsonb));
 end if;
 if p_action='summary' then
  return jsonb_build_object('cars',coalesce((select jsonb_object_agg(car_id,jsonb_build_object('amountCents',total,'lastOn',last_on,'toMatch',to_match,'noSlip',no_slip)) from
   (select car_id,sum(amount_cents)::bigint total,max(received_on) last_on,count(*) filter (where state='to_match')::int to_match,count(*) filter (where slip_at is null)::int no_slip from uc_money_received group by car_id) s),'{}'::jsonb));
 end if;

 select * into r from uc_money_received where id=case when coalesce(p_data->>'id','')~'^[0-9a-fA-F-]{36}$' then (p_data->>'id')::uuid end;
 if r.id is null then raise exception 'NOT_ALLOWED';end if;
 if p_action='slip_read' then if r.slip_at is null then raise exception 'NOT_ALLOWED';end if;return jsonb_build_object('path',r.slip_path,'fileName',r.slip_name,'mimeType',r.slip_mime);end if;
 if r.slip_at is not null then raise exception 'SLIP_ALREADY_SAVED';end if;
 if p_action='slip_prepare' then
  if coalesce(p_data->>'fileName','')='' or length(p_data->>'fileName')>120 or p_data->>'fileName'~'[[:cntrl:]/\\]' or coalesce(p_data->>'mimeType','') not in ('image/png','image/jpeg','application/pdf') or coalesce(p_data->>'sha256','')!~'^[0-9a-f]{64}$' then raise exception 'INVALID';end if;
  return jsonb_build_object('path','money-received/'||r.id||'/'||(p_data->>'sha256')||case p_data->>'mimeType' when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' else '.png' end);
 end if;
 -- slip_confirm: the server stored the file at the prepared path first.
 path:=p_data->>'path';
 if coalesce(path,'')!~('^money-received/'||r.id||'/[0-9a-f]{64}\.(png|jpg|pdf)$') then raise exception 'INVALID';end if;
 if to_regclass('storage.objects') is not null then
  execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into stored using 'finance-evidence',path;
  if not stored then raise exception 'UPLOAD_MISSING';end if;
 end if;
 update uc_money_received set slip_path=path,slip_name=coalesce(nullif(p_data->>'fileName',''),split_part(path,'/',3)),slip_mime=case when path like '%.pdf' then 'application/pdf' when path like '%.jpg' then 'image/jpeg' else 'image/png' end,
  slip_sha256=substring(path from '/([0-9a-f]{64})\.'),slip_by=p_actor,slip_at=now() where id=r.id returning * into r;
 return jsonb_build_object('entry',uc_money_received_view(r));
end $$;
revoke all on function uc_money_received_guard(),uc_money_received_view(uc_money_received),uc_money_received_action(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_money_received_action(text,text,jsonb) to service_role;
commit;
