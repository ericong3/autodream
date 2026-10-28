-- REVIEW ONLY: apply only after owner approval. No historical data is backfilled.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- 20261028000000_garage_damage_reports.sql
-- LOCAL REVIEW CANDIDATE. Existing orders are preserved; no records are backfilled.
create table garage_damage_reports(
 id text primary key,invoice_id text not null references garage_invoices(id) on delete restrict,
 kind text not null check(kind in ('arrival','installation')),area text not null check(length(area) between 1 and 200),
 description text not null check(length(description) between 1 and 2000),
 status text not null default 'open' check(status in ('open','acknowledged','resolved')),
 reported_by text not null references users(id),created_at timestamptz not null default now(),
 reviewed_by text references users(id),reviewed_at timestamptz,resolution text,
 check((status='open' and reviewed_by is null and reviewed_at is null and resolution is null) or
       (status<>'open' and reviewed_by is not null and reviewed_at is not null and length(resolution) between 1 and 2000)),
 check(status<>'acknowledged' or kind='arrival'),check(status<>'resolved' or kind='installation')
);
create index garage_damage_reports_invoice_idx on garage_damage_reports(invoice_id,created_at);
create table garage_damage_photos(
 id bigint generated always as identity primary key,report_id text not null references garage_damage_reports(id) on delete restrict,
 path text not null unique,name text not null,uploaded_by text not null references users(id),created_at timestamptz not null default now()
);
create table garage_damage_requests(actor_id text not null,request_id text not null,payload jsonb not null,result jsonb not null,primary key(actor_id,request_id));
alter table garage_damage_reports enable row level security;alter table garage_damage_photos enable row level security;alter table garage_damage_requests enable row level security;
revoke all on garage_damage_reports,garage_damage_photos,garage_damage_requests from public,anon,authenticated;
do $$declare old_check text;begin
 select pg_get_expr(conbin,conrelid) into old_check from pg_constraint where conrelid='garage_work_order_activity'::regclass and conname='garage_work_order_activity_event_type_check';
 if old_check is null then raise exception 'ACTIVITY_CONSTRAINT_REVIEW_REQUIRED';end if;
 alter table garage_work_order_activity drop constraint garage_work_order_activity_event_type_check;
 execute 'alter table garage_work_order_activity add constraint garage_work_order_activity_event_type_check check (('||old_check||') or event_type in (''DAMAGE_REPORTED'',''DAMAGE_REVIEWED'',''DAMAGE_PHOTO_ATTACHED''))';
end$$;
create function garage_tint_damage(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;inv garage_invoices;report garage_damage_reports;prior garage_damage_requests;
 iid text;request text;result jsonb;area text;description text;kind text;note text;photo_count integer;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('garage','both') and actor.role in ('director','shareholder','garage_head','garage_salesman','garage_installer','garage_detailer','garage_spray'),false) then raise exception 'NOT_ALLOWED';end if;
 iid:=p_data->>'invoiceId';
 select * into inv from garage_invoices where id=iid for update;
 if inv.id is null or inv.service<>'tinted' or (actor.role='garage_salesman' and inv.created_by is distinct from p_actor) then raise exception 'NOT_ALLOWED';end if;
 if p_action='snapshot' then
  return jsonb_build_object('invoiceId',iid,'canReport',inv.delivered_at is null,'canReview',actor.role='garage_head' and inv.delivered_at is null,
   'openCount',(select count(*) from garage_damage_reports where invoice_id=iid and status='open'),
   'reports',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('photos',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from garage_damage_photos p where p.report_id=r.id),'[]'::jsonb)) order by r.created_at,r.id) from garage_damage_reports r where r.invoice_id=iid),'[]'::jsonb));
 end if;
 if p_action not in ('create','resolve','evidence') then raise exception 'INVALID';end if;
 request:=p_data->>'requestId';if request is null or request !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 select * into prior from garage_damage_requests where actor_id=p_actor and request_id=request;
 if found then if prior.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;return prior.result;end if;
 if inv.delivered_at is not null then raise exception 'ORDER_DELIVERED';end if;
 if p_action='create' then
  area:=trim(p_data->>'area');description:=trim(p_data->>'description');kind:=p_data->>'kind';
  if kind is null or kind not in ('arrival','installation') or length(coalesce(area,'')) not between 1 and 200 or length(coalesce(description,'')) not between 1 and 2000 then raise exception 'INVALID';end if;
  insert into garage_damage_reports(id,invoice_id,kind,area,description,reported_by) values('gdr_'||replace(gen_random_uuid()::text,'-',''),iid,kind,area,description,p_actor) returning * into report;
 else
  select * into report from garage_damage_reports where id=p_data->>'reportId' and invoice_id=iid for update;
  if report.id is null then raise exception 'NOT_ALLOWED';end if;
  if report.status<>'open' then raise exception 'DAMAGE_ALREADY_REVIEWED';end if;
  if p_action='resolve' then
   if actor.role<>'garage_head' then raise exception 'NOT_ALLOWED';end if;
   note:=trim(p_data->>'note');if length(coalesce(note,'')) not between 1 and 2000 then raise exception 'REASON_REQUIRED';end if;
   update garage_damage_reports r set status=case r.kind when 'arrival' then 'acknowledged' else 'resolved' end,reviewed_by=p_actor,reviewed_at=now(),resolution=note where r.id=report.id;
  else
   if actor.id<>report.reported_by and actor.role<>'garage_head' then raise exception 'NOT_ALLOWED';end if;
   if coalesce(p_data->>'path','') !~ ('^'||iid||'/'||report.id||'/[a-f0-9]{64}$') or length(coalesce(p_data->>'name','')) not between 1 and 255 then raise exception 'INVALID';end if;
   if not exists(select 1 from garage_damage_photos where path=p_data->>'path') then
    select count(*) into photo_count from garage_damage_photos where report_id=report.id;
    if photo_count>=4 then raise exception 'PHOTO_LIMIT';end if;
    insert into garage_damage_photos(report_id,path,name,uploaded_by) values(report.id,p_data->>'path',p_data->>'name',p_actor);
   end if;
  end if;
 end if;
 insert into garage_work_order_activity(work_order_id,event_type,actor_id,actor_role,metadata) values(iid,
  case p_action when 'create' then 'DAMAGE_REPORTED' when 'resolve' then 'DAMAGE_REVIEWED' else 'DAMAGE_PHOTO_ATTACHED' end,p_actor,actor.role,jsonb_build_object('report_id',report.id,'kind',report.kind));
 result:=garage_tint_damage(p_actor,'snapshot',jsonb_build_object('invoiceId',iid))||jsonb_build_object('reportId',report.id);
 insert into garage_damage_requests values(p_actor,request,jsonb_build_object('action',p_action,'data',p_data),result);return result;
end$$;
revoke all on function garage_tint_damage(text,text,jsonb) from public,anon,authenticated;
grant execute on function garage_tint_damage(text,text,jsonb) to service_role;
-- Serialize report creation/review with handover. All previous stage, actor,
-- revision, inspection and verified-payment gates remain in the prior function.
alter function garage_installation_workflow(text,text,jsonb) rename to garage_installation_before_damage;
create function garage_installation_workflow(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare iid text;begin
 if p_action='deliver' then
  perform 1 from garage_building_staff where id=p_actor for share;
  if p_data->>'jobId' is not null then select invoice_id into iid from garage_installer_jobs where id=p_data->>'jobId';
  elsif p_data->>'itemId' is not null then select invoice_id into iid from garage_tint_installation_pieces where id=p_data->>'itemId';else iid:=p_data->>'invoiceId';end if;
  perform 1 from garage_invoices where id=iid for update;
  if exists(select 1 from garage_damage_reports where invoice_id=iid and status='open') then raise exception 'DAMAGE_REVIEW_REQUIRED';end if;
 end if;
 return garage_installation_before_damage(p_actor,p_action,p_data);
end$$;
revoke all on function garage_installation_workflow(text,text,jsonb),garage_installation_before_damage(text,text,jsonb) from public,anon,authenticated;
grant execute on function garage_installation_workflow(text,text,jsonb) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('garage-damage-evidence','garage-damage-evidence',false,2097152,array['image/jpeg','image/png','image/webp']);
create policy garage_damage_evidence_private on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'garage-damage-evidence') with check(bucket_id<>'garage-damage-evidence');


-- 20261028010000_garage_verified_payment_evidence.sql
-- Preserve verified money state while allowing an immutable missing receipt to be attached.
create or replace function garage_tint_finance(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;inv garage_invoices;account garage_tint_accounts;payment garage_tint_payments;
 prior garage_tint_finance_requests;amount numeric;reported numeric;verified numeric;result jsonb;iid text;request text;page_no integer;
begin
 if p_action not in ('snapshot','queue') then perform 1 from garage_building_staff where id=p_actor for share;end if;
 actor:=garage_tint_money_actor(p_actor);
 if p_action not in ('snapshot','queue','record','verify','reject','void','receipt') then raise exception 'INVALID';end if;
 if p_action='queue' then
  if actor.role not in ('director','admin') then raise exception 'NOT_ALLOWED';end if;
  if coalesce(p_data->>'page','0') !~ '^\d{1,6}$' then raise exception 'INVALID';end if;
  page_no:=coalesce((p_data->>'page')::integer,0);
  return jsonb_build_object('payments',coalesce((select jsonb_agg(to_jsonb(q)) from
   (select p.*,i.invoice_number from garage_tint_payments p join garage_invoices i on i.id=p.invoice_id
    where p.state in ('pending','rejected') order by p.created_at,p.id limit 50 offset page_no*50) q),'[]'::jsonb),
   'hasMore',(select count(*)> (page_no+1)*50 from garage_tint_payments where state in ('pending','rejected')));
 end if;
 iid:=p_data->>'invoiceId';
 if p_action='snapshot' then return garage_tint_money_snapshot(p_actor,iid);end if;
 -- All finance and workshop transitions serialize on the invoice first.
 perform 1 from garage_building_staff where id=p_actor for share;
 select * into inv from garage_invoices where id=iid for update;
 if inv.id is null or inv.service<>'tinted' or (actor.role='garage_salesman' and inv.created_by is distinct from p_actor) then raise exception 'NOT_ALLOWED';end if;
 select * into account from garage_tint_accounts where invoice_id=iid;
 if account.invoice_id is null then raise exception 'FINANCE_NOT_READY';end if;
 request:=p_data->>'requestId';
 if request is null or request !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 select * into prior from garage_tint_finance_requests where actor_id=p_actor and request_id=request;
 if found then
  if prior.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;
  return prior.result;
 end if;
 if p_action='record' then
  if inv.delivered_at is not null then raise exception 'ORDER_DELIVERED';end if;
  if jsonb_typeof(p_data->'amount') is distinct from 'number' or (p_data->>'amount') !~ '^\d{1,12}(\.\d{1,2})?$'
   or coalesce(p_data->>'method','') not in ('cash','card','transfer','installment')
   or length(coalesce(p_data->>'reference',''))>200 then raise exception 'INVALID';end if;
  amount:=(p_data->>'amount')::numeric;
  select coalesce(sum(p.amount),0) into reported from garage_tint_payments p where invoice_id=iid and state in ('pending','rejected','verified');
  if amount<=0 or amount>account.total_amount-reported then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
  insert into garage_tint_payments(invoice_id,amount,method,reference,recorded_by)
   values(iid,amount,p_data->>'method',trim(coalesce(p_data->>'reference','')),p_actor) returning * into payment;
 elsif p_action in ('verify','reject','void') then
  if actor.role not in ('director','admin') then raise exception 'NOT_ALLOWED';end if;
  select * into payment from garage_tint_payments where id=p_data->>'paymentId' and invoice_id=iid for update;
  if payment.id is null then raise exception 'NOT_ALLOWED';end if;
  if payment.state not in ('pending','rejected') then raise exception 'PAYMENT_ALREADY_REVIEWED';end if;
  if length(coalesce(p_data->>'note',''))>2000 or (p_action in ('reject','void') and nullif(trim(p_data->>'note'),'') is null) then raise exception 'REASON_REQUIRED';end if;
  update garage_tint_payments set state=case when p_action='verify' then 'verified' when p_action='void' then 'voided' else 'rejected' end,
   reviewed_by=p_actor,reviewed_at=now(),review_note=trim(coalesce(p_data->>'note','')) where id=payment.id;
 else
  select * into payment from garage_tint_payments where id=p_data->>'paymentId' and invoice_id=iid for update;
  if payment.id is null or payment.state not in ('pending','rejected','verified') or (payment.recorded_by<>p_actor and actor.role not in ('director','admin')) then raise exception 'NOT_ALLOWED';end if;
  if payment.receipt_path is not null then raise exception 'RECEIPT_ALREADY_ATTACHED';end if;
  if coalesce(p_data->>'path','') not like iid||'/%' or coalesce(p_data->>'path','') like '%..%'
   or length(coalesce(p_data->>'name','')) not between 1 and 255 then raise exception 'INVALID';end if;
  update garage_tint_payments set receipt_path=p_data->>'path',receipt_name=p_data->>'name' where id=payment.id;
 end if;
 select coalesce(sum(p.amount),0) into verified from garage_tint_payments p where invoice_id=iid and state='verified';
 perform garage_lifecycle_begin();
 update garage_invoices set payment_status=case when verified>=account.total_amount then 'paid' else 'pending' end,
  paid_by=case when verified>=account.total_amount then coalesce(paid_by,p_actor) else null end,
  paid_at=case when verified>=account.total_amount then coalesce(paid_at,now()) else null end,
  payment_method=case when p_action='verify' then payment.method else payment_method end,
  work_status=case when verified>=account.total_amount and work_status='payment_due' then 'ready_for_delivery' else work_status end
 where id=iid;
 insert into garage_work_order_activity(work_order_id,event_type,actor_id,actor_role,metadata)
 values(iid,case p_action when 'record' then 'PAYMENT_REPORTED' when 'verify' then 'PAYMENT_VERIFIED' when 'reject' then 'PAYMENT_REJECTED' when 'void' then 'PAYMENT_REJECTED' else 'PAYMENT_PROOF_ATTACHED' end,p_actor,actor.role,
  jsonb_build_object('payment_id',payment.id,'action',p_action));
 result:=garage_tint_money_snapshot(p_actor,iid)||jsonb_build_object('paymentId',payment.id);
 insert into garage_tint_finance_requests values(p_actor,request,jsonb_build_object('action',p_action,'data',p_data),result);
 return result;
end$$;

revoke all on function garage_tint_finance(text,text,jsonb) from public,anon,authenticated;
grant execute on function garage_tint_finance(text,text,jsonb) to service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
