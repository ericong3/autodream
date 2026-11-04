-- PREPARED ONLY. Install after 20261104060000_investor_car_registration.
-- Completes a repair on an investor-funded car and raises ONE pending repair
-- bill for it atomically. No cash entry, payment or journal is written; the
-- Director approves/pays the bill through the existing car bill flow.
-- A trigger stops browser (anon/authenticated) writes from marking a funded
-- repair done or changing its money fields outside this function.
begin;

create table public.uc_investor_repair_bills (
 repair_id text primary key references public.repairs(id),
 bill_id uuid unique references public.uc_investor_car_bills(id),
 completion_payload jsonb not null,
 actor_id text not null references public.garage_building_staff(id),
 created_at timestamptz not null default now()
);
alter table public.uc_investor_repair_bills enable row level security;
revoke all on public.uc_investor_repair_bills from public,anon,authenticated,service_role;
create trigger uc_investor_repair_bills_fixed before update or delete on public.uc_investor_repair_bills for each row execute function public.uc_investor_immutable();
create trigger uc_investor_repair_bills_no_truncate before truncate on public.uc_investor_repair_bills execute function public.uc_investor_immutable();

-- Guard on public.repairs. Only the completion function opens the private gate
-- (transaction-local, keyed to the current transaction id).
create or replace function public.uc_guard_funded_repair() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 gated boolean:=coalesce(current_setting('autodream.uc_repair_complete',true),'')='on:'||txid_current()::text;
 old_funded boolean:=false;
 new_funded boolean:=false;
 linked boolean:=false;
begin
 if gated then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op in ('UPDATE','DELETE') then
  old_funded:=exists(select 1 from uc_investor_cars a where a.car_id=old.car_id);
  linked:=exists(select 1 from uc_investor_repair_bills l where l.repair_id=old.id);
 end if;
 if tg_op in ('INSERT','UPDATE') then new_funded:=exists(select 1 from uc_investor_cars a where a.car_id=new.car_id);end if;
 if tg_op='DELETE' then
  if linked then raise exception 'IMMUTABLE_HISTORY';end if;
  return old;
 end if;

 -- Serialize with completion/funding on the car without risking a deadlock:
 -- browser writes give up instead of waiting.
 if not pg_try_advisory_xact_lock(hashtextextended('uc-car:'||coalesce(case when tg_op='UPDATE' then old.car_id end,new.car_id),0)) then raise exception 'REPAIR_BUSY';end if;
 -- Re-read after the shared funding/repair gate is acquired.
 if tg_op in ('UPDATE','DELETE') then old_funded:=exists(select 1 from uc_investor_cars where car_id=old.car_id);end if;
 new_funded:=exists(select 1 from uc_investor_cars where car_id=new.car_id);
 if not(old_funded or new_funded or linked)then return new;end if;
 if tg_op='INSERT' then
  if coalesce(new.status,'')='done' or new.completed_at is not null or coalesce(new.actual_cost,0)<>0 then raise exception 'REPAIR_COMPLETION_REQUIRED';end if;
  return new;
 end if;
 if new.car_id is distinct from old.car_id or new.id is distinct from old.id then raise exception 'IMMUTABLE_HISTORY';end if;
 if new.parts is distinct from old.parts or new.labour_cost is distinct from old.labour_cost or new.total_cost is distinct from old.total_cost
  or new.actual_cost is distinct from old.actual_cost or new.receipt_photo is distinct from old.receipt_photo
  or new.completed_at is distinct from old.completed_at then raise exception 'REPAIR_COMPLETION_REQUIRED';end if;
 if new.status is distinct from old.status and (coalesce(new.status,'')='done' or coalesce(old.status,'')='done') then raise exception 'REPAIR_COMPLETION_REQUIRED';end if;
 return new;
end $$;
create trigger uc_guard_funded_repair before insert or update or delete on public.repairs for each row execute function public.uc_guard_funded_repair();

create or replace function public.uc_complete_investor_repair(p_actor text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor garage_building_staff%rowtype;
 prior uc_investor_commands%rowtype;
 link uc_investor_repair_bills%rowtype;
 src repairs%rowtype;
 rep repairs%rowtype;
 car uc_investor_cars%rowtype;
 v_bill uuid;
 req text:=p_data->>'requestId';
 cmd jsonb;
 completion jsonb;
 amount bigint;
 labour bigint;
 parts_out jsonb:='[]'::jsonb;
 part jsonb;
 pc numeric;
 parts_sum bigint:=0;
 v_payee text;
 v_purpose text;
 row_out jsonb;
 result jsonb;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(array['repairId','amountCents','receiptPhoto','billDetails','requestId']))) then raise exception 'INVALID';end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role in ('director','admin','mechanic') and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if req is null or req !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
 cmd:=jsonb_build_object('action','complete_repair')||p_data;
 select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
 if found then if prior.payload is distinct from cmd then raise exception 'REQUEST_CHANGED';end if;return prior.result||jsonb_build_object('alreadyRecorded',true);end if;

 -- Independent validation (the API validates too).
 if jsonb_typeof(p_data->'repairId') is distinct from 'string' or (p_data->>'repairId') !~ '^[A-Za-z0-9_-]{1,100}$'
  or jsonb_typeof(p_data->'amountCents') is distinct from 'number' or (p_data->>'amountCents') !~ '^[0-9]{1,13}$' then raise exception 'INVALID';end if;
 amount:=(p_data->>'amountCents')::bigint;

 if amount<0 or amount>1000000000000 then raise exception 'INVALID';end if;
 if p_data ? 'receiptPhoto' and (jsonb_typeof(p_data->'receiptPhoto') is distinct from 'string' or length(p_data->>'receiptPhoto')>2000 or (p_data->>'receiptPhoto') !~ '^https://[^/@:]+/storage/v1/object/') then raise exception 'INVALID';end if;
 if p_data ? 'billDetails' then
  if jsonb_typeof(p_data->'billDetails') is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data->'billDetails') k where not(k=any(array['parts','labourCostCents'])))
   or jsonb_typeof(p_data->'billDetails'->'parts') is distinct from 'array' or jsonb_array_length(p_data->'billDetails'->'parts')>100
   or jsonb_typeof(p_data->'billDetails'->'labourCostCents') is distinct from 'number' or (p_data->'billDetails'->>'labourCostCents') !~ '^[0-9]{1,13}$' then raise exception 'INVALID';end if;
  labour:=(p_data->'billDetails'->>'labourCostCents')::bigint;
  for part in select value from jsonb_array_elements(p_data->'billDetails'->'parts') loop
   if jsonb_typeof(part) is distinct from 'object' or exists(select 1 from jsonb_object_keys(part) k where not(k=any(array['name','cost'])))
    or jsonb_typeof(part->'name') is distinct from 'string' or length(trim(part->>'name')) not between 1 and 200
    or jsonb_typeof(part->'cost') is distinct from 'number' then raise exception 'INVALID';end if;
   pc:=(part->>'cost')::numeric;
   if pc<0 or pc>10000000000 or pc*100<>trunc(pc*100) then raise exception 'INVALID';end if;
   parts_sum:=parts_sum+(pc*100)::bigint;
   parts_out:=parts_out||jsonb_build_array(jsonb_build_object('name',trim(part->>'name'),'cost',pc));
  end loop;
  if parts_sum+labour<>amount then raise exception 'INVALID';end if;
 end if;
 -- What makes two completions "the same" regardless of request id.
 completion:=p_data-'requestId';

 -- Read source repair -> private funded car -> account. Then lock account,
 -- car (advisory + private row), repair; recheck the car did not change.
 select * into src from repairs where id=p_data->>'repairId';
 if src.id is null then raise exception 'REPAIR_NOT_FOUND';end if;
 select * into car from uc_investor_cars where car_id=src.car_id;
 if car.car_id is null then raise exception 'NOT_INVESTOR_FUNDED';end if;
 perform 1 from uc_investor_pots where id=car.pot_id for update;
 perform pg_advisory_xact_lock(hashtextextended('uc-car:'||car.car_id,0));
 select * into car from uc_investor_cars where car_id=car.car_id for update;
 select * into rep from repairs where id=src.id for update;
 if rep.id is null then raise exception 'REPAIR_NOT_FOUND';end if;
 if rep.car_id is distinct from car.car_id then raise exception 'REQUEST_CHANGED';end if;

 -- Already completed through this flow: identical details return the one bill.
 select * into link from uc_investor_repair_bills where repair_id=rep.id;
 if found then
  if link.completion_payload is distinct from completion then raise exception 'REPAIR_CHANGED_REVIEW_REQUIRED';end if;
  result:=jsonb_build_object('repair',to_jsonb(rep),'billId',link.bill_id,'alreadyRecorded',true);
  insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,cmd,result);
  return result;
 end if;
 if car.settled_at is not null then raise exception 'CAR_SETTLED_ADJUSTMENT_REQUIRED';end if;
 if coalesce(rep.status,'')='done' or rep.completed_at is not null then raise exception 'REPAIR_REVIEW_REQUIRED';end if;

 v_payee:=left(trim(coalesce(rep.location,'')),150);
 if amount>0 and v_payee='' then raise exception 'REPAIR_LOCATION_REQUIRED';end if;
 v_purpose:=left('Repair: '||coalesce(nullif(trim(coalesce(rep.type_of_repair::text,'')),''),'workshop job')||' ('||rep.id||')',300);
 if amount>0 then
 insert into uc_investor_car_bills(car_id,category,purpose,payee,amount_cents,created_by)
  values(car.car_id,'repair',v_purpose,v_payee,amount,p_actor) returning id into v_bill;
 end if;
 insert into uc_investor_repair_bills(repair_id,bill_id,completion_payload,actor_id) values(rep.id,v_bill,completion,p_actor);

 perform set_config('autodream.uc_repair_complete','on:'||txid_current()::text,true);
 update repairs set status='done',actual_cost=amount::numeric/100,completed_at=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  receipt_photo=case when p_data ? 'receiptPhoto' then p_data->>'receiptPhoto' else receipt_photo end,
  parts=case when p_data ? 'billDetails' then parts_out else parts end,
  labour_cost=case when p_data ? 'billDetails' then labour::numeric/100 else labour_cost end,
  total_cost=case when p_data ? 'billDetails' then amount::numeric/100 else total_cost end
  where id=rep.id;
 perform set_config('autodream.uc_repair_complete','',true);

 select to_jsonb(r) into row_out from repairs r where r.id=rep.id;
 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(car.pot_id,p_actor,'complete_repair',jsonb_build_object('carId',car.car_id,'repairId',rep.id,'billId',v_bill,'amountCents',amount));
 result:=jsonb_build_object('repair',row_out,'billId',v_bill,'alreadyRecorded',false);
 insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,cmd,result);
 return result;
end $$;

revoke all on function public.uc_guard_funded_repair() from public,anon,authenticated,service_role;
revoke all on function public.uc_complete_investor_repair(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_complete_investor_repair(text,jsonb) to service_role;

-- Funding and legacy repair completion serialize on the same gate. A car
-- with an existing completed repair needs a reviewed opening conversion.
create function public.uc_check_repair_history() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended('uc-car:'||new.car_id,0))then raise exception 'REPAIR_BUSY';end if;
 if exists(select 1 from repairs where car_id=new.car_id and (status='done' or completed_at is not null or coalesce(actual_cost,0)<>0))then raise exception 'CAR_REPAIR_HISTORY_REVIEW_REQUIRED';end if;
 return new;
end $$;
create trigger uc_check_repair_history before insert on public.uc_investor_cars for each row execute function public.uc_check_repair_history();
revoke all on function public.uc_check_repair_history() from public,anon,authenticated,service_role;

commit;
