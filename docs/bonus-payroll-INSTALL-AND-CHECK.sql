begin;
do $$ begin
 if replace((select prosrc from pg_proc where oid='public.used_car_bonus_campaign(text,text,jsonb)'::regprocedure),E'\r\n',E'\n') is distinct from replace($reviewed_bonus_core$
declare actor garage_building_staff;c used_car_bonus_campaigns;prior used_car_bonus_requests;details jsonb;result jsonb;ids text[];page_no integer;request text;current_month text;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role in ('director','shareholder') and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_action='list' then
  if coalesce(p_data->>'page','0') !~ '^\d{1,5}$' then raise exception 'INVALID';end if;page_no:=coalesce((p_data->>'page')::integer,0);
  return jsonb_build_object('enabled',true,
   'campaigns',coalesce((select jsonb_agg(to_jsonb(q) order by q."startMonth" desc,q.id) from
    (select row_c.id,row_c.title,row_c.start_month "startMonth",row_c.end_month "endMonth",row_c.minimum_units "minimumUnits",row_c.amount_per_unit "amountPerUnit",row_c.revision,row_c.published_at "publishedAt",
     (select coalesce(jsonb_agg(jsonb_build_object('id',staff_id,'name',name) order by name,staff_id),'[]'::jsonb) from used_car_bonus_enrolments where campaign_id=row_c.id) participants,
     (select coalesce(jsonb_agg(month order by month),'[]'::jsonb) from used_car_bonus_months where campaign_id=row_c.id) "confirmedMonths"
     from used_car_bonus_campaigns row_c order by row_c.start_month desc,row_c.id limit 100 offset page_no*100) q),'[]'::jsonb),
   'hasMore',(select count(*)>(page_no+1)*100 from used_car_bonus_campaigns),
   'participants',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from garage_building_staff where enabled and registration_status='active' and role='salesperson' and business_access in ('used_car','both')),'[]'::jsonb));
 end if;
 if p_action='preview' then return used_car_bonus_preview((p_data->>'id')::uuid,p_data->>'month');end if;
 if actor.role<>'director' then raise exception 'NOT_ALLOWED';end if;
 if p_action not in ('save','publish','confirm_month') then raise exception 'INVALID';end if;
 request:=p_data->>'requestId';
 if request is null or request !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(112026,hashtext(p_actor||':'||request));
 select * into prior from used_car_bonus_requests where actor_id=p_actor and request_id=request;
 if found then
  if prior.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;return prior.result;
 end if;
 if p_action='save' then
  details:=p_data->'campaign';
  if jsonb_typeof(details) is distinct from 'object' or details-array['title','startMonth','endMonth','minimumUnits','amountPerUnit','participantIds']<>'{}'::jsonb
  or jsonb_typeof(details->'title') is distinct from 'string' or length(trim(details->>'title')) not between 1 and 120
  or coalesce(details->>'startMonth','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or coalesce(details->>'endMonth','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
  or details->>'startMonth'>details->>'endMonth'
  or jsonb_typeof(details->'minimumUnits') is distinct from 'number' or coalesce(details->>'minimumUnits','') !~ '^\d{1,5}$'
  or (details->>'minimumUnits')::integer not between 1 and 10000
  or jsonb_typeof(details->'amountPerUnit') is distinct from 'number' or (details->>'amountPerUnit')::numeric not between 0 and 100000
  or (details->>'amountPerUnit')::numeric<>round((details->>'amountPerUnit')::numeric,2)
  or jsonb_typeof(details->'participantIds') is distinct from 'array' or jsonb_array_length(details->'participantIds') not between 1 and 200
  or exists(select 1 from jsonb_array_elements(details->'participantIds') v where jsonb_typeof(v) is distinct from 'string') then raise exception 'INVALID';end if;
  select array_agg(value) into ids from jsonb_array_elements_text(details->'participantIds');
  if (select count(distinct x) from unnest(ids) x)<>cardinality(ids) then raise exception 'INVALID';end if;
  perform 1 from garage_building_staff where id=any(ids) order by id for share;
  if (select count(*) from garage_building_staff where id=any(ids) and enabled and registration_status='active' and role='salesperson' and business_access in ('used_car','both'))<>cardinality(ids) then raise exception 'NOT_ALLOWED';end if;
  if p_data->>'id' is not null then
   select * into c from used_car_bonus_campaigns where id=(p_data->>'id')::uuid for update;
   if c.id is null then raise exception 'NOT_ALLOWED';end if;
   if c.published_at is not null then raise exception 'PUBLISHED_LOCKED';end if;
   if c.revision is distinct from (p_data->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
   update used_car_bonus_campaigns set title=trim(details->>'title'),start_month=details->>'startMonth',end_month=details->>'endMonth',minimum_units=(details->>'minimumUnits')::integer,amount_per_unit=(details->>'amountPerUnit')::numeric,revision=revision+1 where id=c.id returning * into c;
   delete from used_car_bonus_enrolments where campaign_id=c.id;
  else
   insert into used_car_bonus_campaigns(title,start_month,end_month,minimum_units,amount_per_unit,created_by)
    values(trim(details->>'title'),details->>'startMonth',details->>'endMonth',(details->>'minimumUnits')::integer,(details->>'amountPerUnit')::numeric,p_actor) returning * into c;
  end if;
  insert into used_car_bonus_enrolments(campaign_id,staff_id,name) select c.id,id,name from garage_building_staff where id=any(ids);
  result:=jsonb_build_object('id',c.id,'revision',c.revision);
 else
  select * into c from used_car_bonus_campaigns where id=(p_data->>'id')::uuid for update;
  if c.id is null then raise exception 'NOT_ALLOWED';end if;
  if p_action='publish' then
   if c.revision is distinct from (p_data->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
   if c.published_at is not null then raise exception 'PUBLISHED_LOCKED';end if;
   if not exists(select 1 from used_car_bonus_enrolments where campaign_id=c.id) or exists(select 1 from used_car_bonus_enrolments e join garage_building_staff s on s.id=e.staff_id where e.campaign_id=c.id and not coalesce(s.enabled and s.registration_status='active' and s.role='salesperson' and s.business_access in ('used_car','both'),false)) then raise exception 'NOT_ALLOWED';end if;
   update used_car_bonus_campaigns set published_at=now(),revision=revision+1 where id=c.id;
   result:=jsonb_build_object('id',c.id,'published',true);
  else
   if c.published_at is null then raise exception 'NOT_ALLOWED';end if;
   current_month:=to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM');
   if p_data->>'month'>=current_month then raise exception 'FUTURE_MONTH';end if;
   result:=used_car_bonus_preview(c.id,p_data->>'month');
   if not coalesce((result->>'confirmed')::boolean,false) then
    if result->>'previewHash' is distinct from p_data->>'previewHash' then raise exception 'PREVIEW_CHANGED';end if;
    if jsonb_array_length(result->'issues')>0 then raise exception 'DELIVERY_REVIEW_REQUIRED';end if;
    insert into used_car_bonus_months(campaign_id,month,snapshot,confirmed_by) values(c.id,p_data->>'month',result,p_actor);
    result:=used_car_bonus_preview(c.id,p_data->>'month');
   end if;
  end if;
 end if;
 insert into used_car_bonus_requests(actor_id,request_id,payload,result) values(p_actor,request,jsonb_build_object('action',p_action,'data',p_data),result);
 return result;
end $reviewed_bonus_core$,E'\r\n',E'\n') then raise exception 'STOP: Existing campaign operations changed. Review before integration.';end if;
end $$;
create temporary table bonus_payroll_install_before on commit drop as select (select count(*) from payments) payments,(select count(*) from journal_entries) journals,(select count(*) from payslips) payslips,(select count(*) from used_car_bonus_months) results;
-- Installation creates no bonus obligation or payment. Only explicit director confirmation posts.
do $$ declare old_check text;begin
 if to_regclass('public.used_car_bonus_payroll_postings') is not null or to_regprocedure('public.used_car_bonus_campaign_core(text,text,jsonb)') is not null then raise exception 'STOP: Bonus payroll already installed.';end if;
 if not exists(select 1 from ledger_accounts where id='acct-ap' and type='liability') or not exists(select 1 from ledger_accounts where id='acct-bank-operating' and type='asset') then raise exception 'STOP: Ledger baseline missing.';end if;
 select pg_get_expr(conbin,conrelid) into old_check from pg_constraint where conrelid='public.payments'::regclass and conname='payments_type_check';
 if old_check is null then raise exception 'STOP: Payment type baseline missing.';end if;
 alter table payments drop constraint payments_type_check;
 execute format('alter table payments add constraint payments_type_check check ((%s) or type in (''salary'',''allowance'',''campaign_bonus''))',old_check);
end $$;
insert into ledger_accounts(id,name,type,investor_tagged,notes) values('acct-exp-campaign-bonus','Used Car Staff Bonus Expense','expense',false,'Department campaign bonus; not allocated to individual cars.');
alter table payments add column bonus_campaign_id uuid,add column bonus_month text;
alter table payments add constraint payments_bonus_month_fk foreign key(bonus_campaign_id,bonus_month) references used_car_bonus_months(campaign_id,month);
alter table payments add constraint payments_campaign_bonus_shape check(type<>'campaign_bonus' or (bonus_campaign_id is not null and bonus_month is not null and recipient_type='user' and car_id is null and amount>0));
create unique index payments_campaign_bonus_unique on payments(bonus_campaign_id,bonus_month,recipient_id) where type='campaign_bonus';
create table used_car_bonus_payroll_postings(
 campaign_id uuid not null,month text not null,journal_id text references journal_entries(id),posted_by text not null references garage_building_staff(id),posted_at timestamptz not null default now(),
 primary key(campaign_id,month),foreign key(campaign_id,month) references used_car_bonus_months(campaign_id,month)
);
alter table used_car_bonus_payroll_postings enable row level security;
revoke all on used_car_bonus_payroll_postings from public,anon,authenticated,service_role;

create function used_car_bonus_finance_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='payments' then
  if (tg_op<>'INSERT' and old.type='campaign_bonus') or (tg_op<>'DELETE' and new.type='campaign_bonus') then
   if current_setting('app.used_car_bonus_posting',true) is distinct from '1' then raise exception 'BONUS_IMMUTABLE: Use the authorised bonus workflow.';end if;
  end if;
 else
  if (tg_op<>'INSERT' and old.source_type in ('campaign_bonus','campaign_bonus_paid')) or (tg_op<>'DELETE' and new.source_type in ('campaign_bonus','campaign_bonus_paid')) then
   if current_setting('app.used_car_bonus_posting',true) is distinct from '1' then raise exception 'BONUS_IMMUTABLE: Posted bonus entries require a separate adjustment.';end if;
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function used_car_bonus_finance_guard() from public,anon,authenticated,service_role;
create trigger used_car_bonus_payment_guard before insert or update or delete on payments for each row execute function used_car_bonus_finance_guard();
create trigger used_car_bonus_journal_guard before insert or update or delete on journal_entries for each row execute function used_car_bonus_finance_guard();

create function used_car_bonus_post_payroll(p_actor text,p_campaign uuid,p_month text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare frozen used_car_bonus_months;campaign used_car_bonus_campaigns;share jsonb;pid text;jid text;total numeric;share_total numeric;amount numeric;bank users;old_context text;
begin
 if not exists(select 1 from garage_building_staff where id=p_actor and enabled and registration_status='active' and role='director' and business_access in ('used_car','both')) then raise exception 'NOT_ALLOWED';end if;
 select * into campaign from used_car_bonus_campaigns where id=p_campaign for update;
 select * into frozen from used_car_bonus_months where campaign_id=p_campaign and month=p_month for update;
 if not found or campaign.published_at is null then raise exception 'BONUS_NOT_CONFIRMED';end if;
 if exists(select 1 from used_car_bonus_payroll_postings where campaign_id=p_campaign and month=p_month) then return;end if;
 if not exists(select 1 from ledger_accounts where id='acct-exp-campaign-bonus' and type='expense') or not exists(select 1 from ledger_accounts where id='acct-ap' and type='liability') then raise exception 'BONUS_LEDGER_SETUP';end if;
 total:=(frozen.snapshot->>'pool')::numeric;
 select sum((s->>'amount')::numeric) into share_total from jsonb_array_elements(frozen.snapshot->'shares')s;
 if total is null or total<0 or total<>round(total,2) or share_total is distinct from total or jsonb_array_length(frozen.snapshot->'shares')=0
 or (select count(distinct s->>'id') from jsonb_array_elements(frozen.snapshot->'shares')s)<>jsonb_array_length(frozen.snapshot->'shares')
 or exists(select 1 from jsonb_array_elements(frozen.snapshot->'shares')s where (s->>'amount')::numeric<0 or (s->>'amount')::numeric<>round((s->>'amount')::numeric,2)) then raise exception 'INVALID';end if;
 old_context:=current_setting('app.used_car_bonus_posting',true);perform set_config('app.used_car_bonus_posting','1',true);
 if total>0 then
  jid:='bonus-accrual:'||p_campaign||':'||p_month;
  insert into journal_entries(id,date,description,lines,source_type,source_id,created_by)
   values(jid,((p_month||'-01')::date+interval '1 month - 1 day')::date,'Used Car staff bonus: '||campaign.title||' ('||p_month||')',jsonb_build_array(
    jsonb_build_object('accountId','acct-exp-campaign-bonus','debit',total,'credit',0),jsonb_build_object('accountId','acct-ap','debit',0,'credit',total)),
    'campaign_bonus',p_campaign||':'||p_month,p_actor);
  for share in select value from jsonb_array_elements(frozen.snapshot->'shares') loop
   amount:=(share->>'amount')::numeric;
   if amount<0 or amount<>round(amount,2) then raise exception 'INVALID';end if;
   if amount=0 then continue;end if;
   select * into bank from users where id=share->>'id';
   pid:='bonus:'||p_campaign||':'||p_month||':'||(share->>'id');
   insert into payments(id,type,recipient_type,recipient_id,recipient_name,bank_name,account_number,account_holder,amount,description,status,period_start,period_end,bonus_campaign_id,bonus_month)
    values(pid,'campaign_bonus','user',share->>'id',share->>'name',bank.bank_name,bank.bank_account_number,bank.bank_account_holder,amount,
    campaign.title||' — '||p_month,'pending',(p_month||'-01')::date,((p_month||'-01')::date+interval '1 month - 1 day')::date,p_campaign,p_month);
  end loop;
 end if;
 insert into used_car_bonus_payroll_postings(campaign_id,month,journal_id,posted_by) values(p_campaign,p_month,jid,p_actor);
 perform set_config('app.used_car_bonus_posting',coalesce(old_context,''),true);
end $$;
revoke all on function used_car_bonus_post_payroll(text,uuid,text) from public,anon,authenticated,service_role;

alter function public.used_car_bonus_campaign(text,text,jsonb) rename to used_car_bonus_campaign_core;
revoke all on function used_car_bonus_campaign_core(text,text,jsonb) from public,anon,authenticated,service_role;
create function public.used_car_bonus_campaign(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;pay payments;entry journal_entries;old_context text;prior used_car_bonus_requests;posted boolean;
begin
 if p_action in ('confirm_and_post','post_payroll','settle_bonus') then
  perform 1 from garage_building_staff where id=p_actor and enabled and registration_status='active' and role='director' and business_access in ('used_car','both') for share;
  if not found then raise exception 'NOT_ALLOWED';end if;
 end if;
 if p_action='settle_bonus' then
  select * into pay from payments where id=p_data->>'paymentId' and type='campaign_bonus' for update;
  if not found then raise exception 'NOT_ALLOWED';end if;
  if pay.status='pending' then
   if not exists(select 1 from ledger_accounts where id='acct-bank-operating' and type='asset') or not exists(select 1 from ledger_accounts where id='acct-ap' and type='liability') then raise exception 'BONUS_LEDGER_SETUP';end if;
   if (p_data->>'transferredAt')::timestamptz is null or length(coalesce(p_data->>'notes',''))>2000 or length(coalesce(p_data->>'receiptUrl',''))>2000 then raise exception 'INVALID';end if;
   old_context:=current_setting('app.used_car_bonus_posting',true);perform set_config('app.used_car_bonus_posting','1',true);
   update payments set status='transferred',transferred_at=(p_data->>'transferredAt')::timestamptz,transferred_by=p_actor,
    notes=coalesce(p_data->>'notes',''),receipt_url=coalesce(nullif(p_data->>'receiptUrl',''),receipt_url) where id=pay.id returning * into pay;
   insert into journal_entries(id,date,description,lines,source_type,source_id,created_by)
    values('bonus-paid:'||pay.id,(pay.transferred_at at time zone 'Asia/Kuala_Lumpur')::date,'Used Car staff bonus paid: '||pay.recipient_name,jsonb_build_array(
     jsonb_build_object('accountId','acct-ap','debit',pay.amount,'credit',0),jsonb_build_object('accountId','acct-bank-operating','debit',0,'credit',pay.amount)),
     'campaign_bonus_paid',pay.id,p_actor);
   perform set_config('app.used_car_bonus_posting',coalesce(old_context,''),true);
  end if;
  select * into entry from journal_entries where id='bonus-paid:'||pay.id;
  if entry.id is null then raise exception 'BONUS_POSTING_CONFLICT';end if;
  return jsonb_build_object('payment',to_jsonb(pay),'journal',to_jsonb(entry));
 elsif p_action='post_payroll' then
  if coalesce(p_data->>'requestId','') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  perform pg_advisory_xact_lock(112026,hashtext(p_actor||':'||(p_data->>'requestId')));
  select * into prior from used_car_bonus_requests where actor_id=p_actor and request_id=p_data->>'requestId';
  if found then
   if prior.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;return prior.result;
  end if;
  perform used_car_bonus_post_payroll(p_actor,(p_data->>'id')::uuid,p_data->>'month');
  result:=used_car_bonus_preview((p_data->>'id')::uuid,p_data->>'month')||jsonb_build_object('payrollPosted',true);
  insert into used_car_bonus_requests values(p_actor,p_data->>'requestId',jsonb_build_object('action',p_action,'data',p_data),result,now());
  return result;
 elsif p_action='confirm_and_post' then
  result:=used_car_bonus_campaign_core(p_actor,'confirm_month',p_data);
  perform used_car_bonus_post_payroll(p_actor,(p_data->>'id')::uuid,p_data->>'month');
  return result||jsonb_build_object('payrollPosted',true);
 else
  result:=used_car_bonus_campaign_core(p_actor,p_action,p_data);
  if p_action in ('preview','confirm_month') then
   select exists(select 1 from used_car_bonus_payroll_postings where campaign_id=(p_data->>'id')::uuid and month=p_data->>'month') into posted;
   result:=result||jsonb_build_object('payrollPosted',posted);
  end if;
  return result;
 end if;
end $$;
revoke all on function public.used_car_bonus_campaign(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.used_car_bonus_campaign(text,text,jsonb) to service_role;
notify pgrst,'reload schema';

do $$begin if exists(select 1 from bonus_payroll_install_before b where b.payments<>(select count(*) from payments) or b.journals<>(select count(*) from journal_entries) or b.payslips<>(select count(*) from payslips) or b.results<>(select count(*) from used_car_bonus_months)) then raise exception 'STOP: Installation changed financial records.';end if;end $$;
commit;
select now() checked_at,to_regclass('public.used_car_bonus_payroll_postings') is not null payroll_ready,not has_function_privilege('anon','public.used_car_bonus_post_payroll(text,uuid,text)','EXECUTE') and not has_function_privilege('authenticated','public.used_car_bonus_post_payroll(text,uuid,text)','EXECUTE') helpers_private,(select count(*) from used_car_bonus_payroll_postings) posted_months;
