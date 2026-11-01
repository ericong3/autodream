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
