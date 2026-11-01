begin;
do $$begin if replace((select prosrc from pg_proc where oid='public.used_car_bonus_campaign(text,text,jsonb)'::regprocedure),E'\r\n',E'\n') is distinct from replace($reviewed_bonus_wrapper$
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
end $reviewed_bonus_wrapper$,E'\r\n',E'\n') then raise exception 'STOP: Bonus wrapper changed. Review refresh update first.';end if;end $$;
create function used_car_bonus_payroll_snapshot(p_result jsonb,p_campaign uuid,p_month text) returns jsonb language sql security definer set search_path=public,pg_temp as $$
select p_result||jsonb_build_object('payrollPosted',exists(select 1 from used_car_bonus_payroll_postings where campaign_id=p_campaign and month=p_month),
'payrollPayments',coalesce((select jsonb_agg(to_jsonb(p) order by id) from payments p where bonus_campaign_id=p_campaign and bonus_month=p_month),'[]'::jsonb),
'payrollJournal',(select to_jsonb(j) from used_car_bonus_payroll_postings b join journal_entries j on j.id=b.journal_id where b.campaign_id=p_campaign and b.month=p_month),
'payrollAccount',(select to_jsonb(a) from ledger_accounts a where id='acct-exp-campaign-bonus'));
$$;
revoke all on function used_car_bonus_payroll_snapshot(jsonb,uuid,text) from public,anon,authenticated,service_role;
create or replace function public.used_car_bonus_campaign(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
   if prior.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;return used_car_bonus_payroll_snapshot(prior.result,(p_data->>'id')::uuid,p_data->>'month');
  end if;
  perform used_car_bonus_post_payroll(p_actor,(p_data->>'id')::uuid,p_data->>'month');
  result:=used_car_bonus_payroll_snapshot(used_car_bonus_preview((p_data->>'id')::uuid,p_data->>'month'),(p_data->>'id')::uuid,p_data->>'month');
  insert into used_car_bonus_requests values(p_actor,p_data->>'requestId',jsonb_build_object('action',p_action,'data',p_data),result,now());
  return result;
 elsif p_action='confirm_and_post' then
  result:=used_car_bonus_campaign_core(p_actor,'confirm_month',p_data);
  perform used_car_bonus_post_payroll(p_actor,(p_data->>'id')::uuid,p_data->>'month');
  return used_car_bonus_payroll_snapshot(result,(p_data->>'id')::uuid,p_data->>'month');
 else
  result:=used_car_bonus_campaign_core(p_actor,p_action,p_data);
  if p_action in ('preview','confirm_month') then
   select exists(select 1 from used_car_bonus_payroll_postings where campaign_id=(p_data->>'id')::uuid and month=p_data->>'month') into posted;
   result:=result||jsonb_build_object('payrollPosted',posted);
  end if;
  return result;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
select now() checked_at,to_regprocedure('public.used_car_bonus_payroll_snapshot(jsonb,uuid,text)') is not null refresh_ready;
