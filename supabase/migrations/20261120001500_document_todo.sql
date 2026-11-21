-- Dashboard to-do for paperwork. Admin sees everything missing and either
-- uploads it or sends it back to the Director with a reason (e.g. a duplicate
-- bill). The Director answers from their own to-do: delete the bill, edit its
-- amount, or send it back to admin with a note. Every step is kept.
--  * Delete / edit is Director-only and only for an unpaid company bill with
--    no bank money and no confirmed documents, on a car that is not an
--    investor car and whose consignment dealer amount is not approved yet.
--    Its own accounting entries are voided on delete; an edit is refused once
--    the bill is in the accounts (delete and re-add it instead).
begin;
do $$ begin
 if to_regprocedure('public.uc_company_evidence(text,text,jsonb)') is null or to_regclass('public.uc_money_received') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;

create table public.uc_doc_returns(
 id uuid primary key default gen_random_uuid(),
 payment_id text,money_id uuid references uc_money_received(id),car_id text references cars(id),
 label text not null check(length(label) between 1 and 300),
 reason text not null check(length(trim(reason)) between 3 and 500),
 raised_by text not null references garage_building_staff(id),raised_at timestamptz not null default now(),
 state text not null default 'open' check(state in ('open','resolved')),
 resolution text check(resolution in ('deleted','edited','returned','done')),
 resolved_note text check(length(resolved_note)<=500),resolved_by text references garage_building_staff(id),resolved_at timestamptz,
 check(num_nonnulls(payment_id,money_id)<=1),
 check(state='open' and resolution is null and resolved_by is null and resolved_at is null or state='resolved' and resolution is not null and resolved_by is not null and resolved_at is not null));
create unique index uc_doc_returns_one_open on uc_doc_returns(coalesce(payment_id,money_id::text,car_id)) where state='open';
alter table uc_doc_returns enable row level security;
revoke all on uc_doc_returns from public,anon,authenticated,service_role;
create function public.uc_doc_returns_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and old.state='open' and new.state='resolved' and (to_jsonb(new)-array['state','resolution','resolved_note','resolved_by','resolved_at'])=(to_jsonb(old)-array['state','resolution','resolved_note','resolved_by','resolved_at']) then return new;end if;
 raise exception 'IMMUTABLE_HISTORY';
end $$;
create trigger uc_doc_returns_fixed before update or delete on uc_doc_returns for each row execute function uc_doc_returns_guard();

create function public.uc_doc_return_view(r uc_doc_returns) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',r.id,'paymentId',r.payment_id,'moneyId',r.money_id,'carId',r.car_id,'label',r.label,'reason',r.reason,
  'raisedBy',(select name from garage_building_staff where id=r.raised_by),'raisedAt',r.raised_at,'state',r.state,'resolution',r.resolution,'note',r.resolved_note,
  'resolvedBy',(select name from garage_building_staff where id=r.resolved_by),'resolvedAt',r.resolved_at,
  'car',(select concat_ws(' ',c.make,c.model,c.car_plate) from cars c where c.id=r.car_id),
  'bill',(select jsonb_build_object('type',p.type,'status',p.status,'amountCents',uc_commission_cents(to_jsonb(p)->'amount'),'recipientName',p.recipient_name) from payments p where p.id=r.payment_id)) $$;

-- Whether the Director may delete or edit this bill here; returns the reason it may not.
create function public.uc_doc_bill_blocker(p_payment text) returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p payments;k uc_consignment_cases;
begin
 select * into p from payments where id=p_payment;
 if p.id is null then return 'BILL_NOT_FOUND';end if;
 if p.status is distinct from 'pending' or uc_company_paid_cents(p.id)>0 then return 'BILL_ALREADY_PAID';end if;
 if p.type in ('customer_collection','loan_disbursement','consignment_collection','supplier_credit_collection','consignment_payout','purchase_settlement','customer_refund','campaign_bonus') or uc_company_payroll_type(p.type) then return 'BILL_TYPE_NOT_ALLOWED';end if;
 if p.car_id is not null and (exists(select 1 from uc_investor_cars where car_id=p.car_id) or exists(select 1 from cars c where c.id=p.car_id and (c.investor_id is not null or coalesce(to_jsonb(c)->>'investor_tagged','false')='true'))) or p.id like 'uc_commission_%' then return 'USE_INVESTOR_CAR_BILLS';end if;
 if exists(select 1 from uc_company_payment_documents d where d.payment_id=p.id and d.state='confirmed') then return 'BILL_HAS_DOCUMENTS';end if;
 select * into k from uc_consignment_cases where car_id=p.car_id;
 if k.car_id is not null and (k.approved_at is not null or p.id in (k.customer_payment_id,k.loan_payment_id,k.lender_payment_id,k.dealer_payment_id,k.recovery_payment_id) or exists(select 1 from uc_consignment_bill_sources where payment_id=p.id)) then return 'CONSIGNMENT_APPROVED_CORRECTION_REQUIRED';end if;
 return null;
end $$;

create function public.uc_doc_todo(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;r uc_doc_returns;p payments;target text;lbl text;blocker text;v_amount bigint;cid text;missing jsonb;allowed text[];
begin
 select * into actor from garage_building_staff where id=p_actor;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and actor.role in ('director','admin'),false) then raise exception 'NOT_ALLOWED';end if;
 if actor.role<>'director' and p_action in ('resolve','delete_bill','edit_bill') then raise exception 'NOT_ALLOWED';end if;
 allowed:=case p_action when 'list' then array[]::text[] when 'send_back' then array['paymentId','moneyId','carId','reason'] when 'resolve' then array['id','resolution','note']
  when 'delete_bill' then array['id','note'] when 'edit_bill' then array['id','amountCents','note'] end;
 if allowed is null or jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'INVALID';end if;

 if p_action='list' then
  missing:=uc_company_evidence(p_actor,'missing','{}'::jsonb);
  return jsonb_build_object('items',missing->'items','total',missing->'total','agreements',missing->'agreements',
   'moneyWithoutSlip',coalesce((select jsonb_agg(uc_money_received_view(m)||jsonb_build_object('car',(select concat_ws(' ',c.make,c.model,c.car_plate) from cars c where c.id=m.car_id)) order by m.received_on desc) from uc_money_received m where m.slip_at is null),'[]'::jsonb),
   'open',coalesce((select jsonb_agg(uc_doc_return_view(x) order by x.raised_at) from uc_doc_returns x where x.state='open'),'[]'::jsonb),
   'answered',coalesce((select jsonb_agg(uc_doc_return_view(x) order by x.resolved_at desc) from uc_doc_returns x where x.state='resolved' and x.resolved_at>now()-interval '30 days'),'[]'::jsonb));
 end if;

 if p_action='send_back' then
  if jsonb_typeof(p_data->'reason') is distinct from 'string' or length(trim(p_data->>'reason')) not between 3 and 500 then raise exception 'REASON_REQUIRED';end if;
  if num_nonnulls(p_data->>'paymentId',p_data->>'moneyId',p_data->>'carId')<>1 then raise exception 'INVALID';end if;
  if p_data ? 'paymentId' then
   select * into p from payments where id=p_data->>'paymentId';if p.id is null then raise exception 'INVALID';end if;
   cid:=p.car_id;lbl:=concat_ws(' · ',nullif(p.recipient_name,''),replace(p.type,'_',' '),'RM '||to_char(p.amount,'FM999,999,990.00'));
  elsif p_data ? 'moneyId' then
   select car_id,'Money received RM '||to_char(amount_cents/100.0,'FM999,999,990.00')||' on '||received_on into cid,lbl from uc_money_received where id=case when coalesce(p_data->>'moneyId','')~'^[0-9a-fA-F-]{36}$' then (p_data->>'moneyId')::uuid end;
   if cid is null then raise exception 'INVALID';end if;
  else
   select id,'Dealer agreement' into cid,lbl from cars where id=p_data->>'carId';if cid is null then raise exception 'INVALID';end if;
  end if;
  begin
   insert into uc_doc_returns(payment_id,money_id,car_id,label,reason,raised_by) values(p_data->>'paymentId',case when p_data ? 'moneyId' then (p_data->>'moneyId')::uuid end,cid,left(lbl,300),trim(p_data->>'reason'),p_actor) returning * into r;
  exception when unique_violation then raise exception 'ALREADY_SENT_BACK';end;
  return jsonb_build_object('entry',uc_doc_return_view(r));
 end if;

 select * into r from uc_doc_returns where id=case when coalesce(p_data->>'id','')~'^[0-9a-fA-F-]{36}$' then (p_data->>'id')::uuid end for update;
 if r.id is null then raise exception 'INVALID';end if;
 if r.state<>'open' then raise exception 'ALREADY_ANSWERED';end if;
 if jsonb_typeof(coalesce(p_data->'note','""'::jsonb))<>'string' or length(coalesce(p_data->>'note',''))>500 then raise exception 'INVALID';end if;

 if p_action='resolve' then
  if coalesce(p_data->>'resolution','') not in ('returned','done') then raise exception 'INVALID';end if;
  if p_data->>'resolution'='returned' and length(trim(coalesce(p_data->>'note','')))<3 then raise exception 'NOTE_REQUIRED';end if;
 else
  if r.payment_id is null then raise exception 'INVALID';end if;
  blocker:=uc_doc_bill_blocker(r.payment_id);if blocker is not null then raise exception '%',blocker;end if;
  select * into p from payments where id=r.payment_id for update;
  -- Trusted, transaction-bound write past the consignment lock (Director only, checked above).
  perform set_config('autodream.consignment_write',txid_current()::text||':'||coalesce(p.car_id,''),true);
  if p_action='delete_bill' then
   update journal_entries set voided=true where source_id=p.id and source_type in (p.type,'expense_claim_confirmed') and not coalesce(voided,false);
   delete from payments where id=p.id;
  else
   if jsonb_typeof(p_data->'amountCents') is distinct from 'number' or coalesce(p_data->>'amountCents','')!~'^[1-9][0-9]{0,11}$' then raise exception 'INVALID';end if;
   v_amount:=(p_data->>'amountCents')::bigint;
   if exists(select 1 from journal_entries where source_id=p.id and source_type in (p.type,'expense_claim_confirmed') and not coalesce(voided,false)) then raise exception 'BILL_IN_ACCOUNTS';end if;
   update payments set amount=v_amount::numeric/100 where id=p.id;
   -- Keep a linked repair's cost equal to its single bill.
   if nullif(to_jsonb(p)->>'repair_job_id','') is not null and (select count(*) from payments where to_jsonb(payments)->>'repair_job_id'=to_jsonb(p)->>'repair_job_id')=1 then
    update repairs set actual_cost=v_amount::numeric/100 where id=to_jsonb(p)->>'repair_job_id';
   end if;
  end if;
  perform set_config('autodream.consignment_write','',true);
 end if;
 update uc_doc_returns set state='resolved',resolution=case p_action when 'delete_bill' then 'deleted' when 'edit_bill' then 'edited' else p_data->>'resolution' end,
  resolved_note=nullif(trim(coalesce(p_data->>'note','')),''),resolved_by=p_actor,resolved_at=now() where id=r.id returning * into r;
 return jsonb_build_object('entry',uc_doc_return_view(r));
end $$;
revoke all on function uc_doc_returns_guard(),uc_doc_return_view(uc_doc_returns),uc_doc_bill_blocker(text),uc_doc_todo(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_doc_todo(text,text,jsonb) to service_role;
commit;
