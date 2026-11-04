-- PREPARED ONLY. Install after 20261104070000_investor_repair_bills.
-- Records a MISC cost on an investor-funded car: appends ONE item to
-- public.cars.misc_costs and raises ONE pending 'misc' bill atomically. No cash
-- entry, payment or journal is written; the Director approves/pays the bill
-- through the existing approve_car_bill/pay_car_bill flow.
-- A trigger on public.cars stops any other change to misc_costs on a funded
-- car (add, edit, delete, replace); every other column and every company car is
-- left alone. Funding a car with existing MISC history needs Director review.
begin;

create table public.uc_investor_misc_bills (
 car_id text not null references public.uc_investor_cars(car_id),
 misc_id text not null check(misc_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 bill_id uuid not null unique references public.uc_investor_car_bills(id),
 misc_item jsonb not null check(jsonb_typeof(misc_item)='object'),
 original_payload jsonb not null,
 actor_id text not null references public.garage_building_staff(id),
 created_at timestamptz not null default now(),
 primary key(car_id,misc_id)
);
alter table public.uc_investor_misc_bills enable row level security;
revoke all on public.uc_investor_misc_bills from public,anon,authenticated,service_role;
create trigger uc_investor_misc_bills_fixed before update or delete on public.uc_investor_misc_bills for each row execute function public.uc_investor_immutable();
create trigger uc_investor_misc_bills_no_truncate before truncate on public.uc_investor_misc_bills execute function public.uc_investor_immutable();

-- Guard on public.cars. A BEFORE UPDATE row trigger runs while the UPDATE
-- already holds the car row lock, which is the same lock fund_car takes
-- (pot -> cars FOR UPDATE). The membership query below runs with a fresh
-- READ COMMITTED snapshot, so it sees a funding that committed while we waited.
-- Deleting a funded car is already blocked by the uc_investor_cars foreign key.
create or replace function public.uc_guard_funded_misc() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.misc_costs is not distinct from old.misc_costs and new.id is not distinct from old.id then return new;end if;
 if coalesce(current_setting('autodream.uc_misc_record',true),'')='on:'||txid_current()::text||':'||old.id and new.id is not distinct from old.id then return new;end if;
 if exists(select 1 from uc_investor_cars a where a.car_id=old.id) then raise exception 'MISC_COMMAND_REQUIRED';end if;
 return new;
end $$;
create trigger uc_guard_funded_misc before update on public.cars for each row execute function public.uc_guard_funded_misc();

-- Funding serializes with misc writes on the public car row fund_car already
-- holds FOR UPDATE. Existing or malformed MISC history needs a reviewed
-- opening conversion; it is never silently rewritten.
create function public.uc_check_misc_history() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
 select c.misc_costs into v from cars c where c.id=new.car_id for update;
 if not found or v is null or jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)<>0 then raise exception 'CAR_MISC_HISTORY_REVIEW_REQUIRED';end if;
 return new;
end $$;
create trigger uc_check_misc_history before insert on public.uc_investor_cars for each row execute function public.uc_check_misc_history();

create or replace function public.uc_record_investor_misc(p_actor text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor garage_building_staff%rowtype;
 prior uc_investor_commands%rowtype;
 link uc_investor_misc_bills%rowtype;
 car uc_investor_cars%rowtype;
 src cars%rowtype;
 req text:=p_data->>'requestId';
 cmd jsonb;
 detail jsonb;
 amount bigint;
 v_purpose text;
 v_payee text;
 v_category text;
 v_misc jsonb;
 v_item jsonb;
 v_bill uuid;
 v_gate text;
 result jsonb;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(array['carId','miscId','amountCents','purpose','payee','category','requestId']))) then raise exception 'INVALID';end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role in ('director','admin') and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data->'requestId') is distinct from 'string' or req !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
 cmd:=jsonb_build_object('action','record_misc')||p_data;
 select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
 if found then if prior.payload is distinct from cmd then raise exception 'REQUEST_CHANGED';end if;return prior.result||jsonb_build_object('alreadyRecorded',true);end if;

 -- Independent validation (the API validates too).
 if jsonb_typeof(p_data->'carId') is distinct from 'string' or (p_data->>'carId') !~ '^[A-Za-z0-9_-]{1,100}$'
  or jsonb_typeof(p_data->'miscId') is distinct from 'string' or (p_data->>'miscId') !~ '^[A-Za-z0-9_-]{1,100}$'
  or jsonb_typeof(p_data->'amountCents') is distinct from 'number' or (p_data->>'amountCents') !~ '^[1-9][0-9]{0,12}$'
  or jsonb_typeof(p_data->'purpose') is distinct from 'string' or length(trim(p_data->>'purpose')) not between 1 and 300
  or jsonb_typeof(p_data->'payee') is distinct from 'string' or length(trim(p_data->>'payee')) not between 1 and 150
  or (p_data ? 'category' and (jsonb_typeof(p_data->'category') is distinct from 'string' or length(trim(p_data->>'category')) not between 1 and 80)) then raise exception 'INVALID';end if;
 amount:=(p_data->>'amountCents')::bigint;
 if amount>1000000000000 then raise exception 'INVALID';end if;
 v_purpose:=trim(p_data->>'purpose');v_payee:=trim(p_data->>'payee');
 v_category:=case when p_data ? 'category' then trim(p_data->>'category') end;
 -- What makes two recordings "the same" regardless of request id.
 detail:=jsonb_strip_nulls(jsonb_build_object('carId',p_data->>'carId','miscId',p_data->>'miscId','amountCents',amount,'purpose',v_purpose,'payee',v_payee,'category',v_category));

 -- Same order as fund_car: account FOR UPDATE, then the public car row.
 select * into car from uc_investor_cars where car_id=p_data->>'carId';
 if car.car_id is null then raise exception 'NOT_INVESTOR_FUNDED';end if;
 perform 1 from uc_investor_pots where id=car.pot_id for update;
 select * into src from cars where id=car.car_id for update;
 if src.id is null then raise exception 'NOT_INVESTOR_FUNDED';end if;
 select * into car from uc_investor_cars where car_id=src.id;
 if car.car_id is null then raise exception 'NOT_INVESTOR_FUNDED';end if;

 -- Already recorded through this flow: identical details return the one bill.
 select * into link from uc_investor_misc_bills where car_id=car.car_id and misc_id=p_data->>'miscId';
 if found then
  if link.original_payload is distinct from detail then raise exception 'MISC_CHANGED_REVIEW_REQUIRED';end if;
  result:=jsonb_build_object('carId',car.car_id,'misc',link.misc_item,'billId',link.bill_id,'alreadyRecorded',true);
  insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,cmd,result);
  return result;
 end if;
 if car.settled_at is not null then raise exception 'CAR_SETTLED_ADJUSTMENT_REQUIRED';end if;
 v_misc:=src.misc_costs;
 if v_misc is null or jsonb_typeof(v_misc) is distinct from 'array' then raise exception 'MISC_COSTS_REVIEW_REQUIRED';end if;
 if exists(select 1 from jsonb_array_elements(v_misc) e where jsonb_typeof(e)<>'object' or e->>'id'=p_data->>'miscId') then raise exception 'MISC_COSTS_REVIEW_REQUIRED';end if;

 insert into uc_investor_car_bills(car_id,category,purpose,payee,amount_cents,created_by)
  values(car.car_id,'misc',v_purpose,v_payee,amount,p_actor) returning id into v_bill;
 v_item:=jsonb_strip_nulls(jsonb_build_object('id',p_data->>'miscId','description',v_purpose,'amount',round(amount::numeric/100,2),'merchant',v_payee,'category',v_category,
  'createdAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdBy',p_actor));
 insert into uc_investor_misc_bills(car_id,misc_id,bill_id,misc_item,original_payload,actor_id) values(car.car_id,p_data->>'miscId',v_bill,v_item,detail,p_actor);

 v_gate:=coalesce(current_setting('autodream.uc_misc_record',true),'');
 perform set_config('autodream.uc_misc_record','on:'||txid_current()::text||':'||car.car_id,true);
 update cars set misc_costs=v_misc||jsonb_build_array(v_item) where id=car.car_id;
 perform set_config('autodream.uc_misc_record',v_gate,true);

 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(car.pot_id,p_actor,'record_misc',jsonb_build_object('carId',car.car_id,'miscId',p_data->>'miscId','billId',v_bill,'amountCents',amount));
 result:=jsonb_build_object('carId',car.car_id,'misc',v_item,'billId',v_bill,'alreadyRecorded',false);
 insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,cmd,result);
 return result;
end $$;

revoke all on function public.uc_guard_funded_misc() from public,anon,authenticated,service_role;
revoke all on function public.uc_check_misc_history() from public,anon,authenticated,service_role;
revoke all on function public.uc_record_investor_misc(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_record_investor_misc(text,jsonb) to service_role;

commit;
