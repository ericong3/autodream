-- Investor money: car purchases paid before the bank opening date, and
-- changing an investor car's profit share before it is settled.
--
-- Cars bought with an investor's money before the finance cut-off (e.g. a car
-- paid on 26 Sep 2026) are allocated to the investor and their purchase is
-- recorded with the real slip and date. The bank opening balance already
-- reflects that transfer, so no bank movement is made: the purchase is posted
-- Dr investor car stock / Cr acct-opening-review, and the investor's cash is
-- reduced as for any purchase. Same proof (invoice + bank slip) and checks.
--
-- The investor's share (basis points) is only applied at settlement, so the
-- Director may change it until the car is settled; every change is audited.
begin;
do $$ begin
 if to_regprocedure('public.uc_capital_before_dealer_conversions(text,text,jsonb)') is null then raise exception 'PREREQUISITE_MIGRATIONS_MISSING';end if;
end $$;
insert into ledger_accounts(id,name,type) values('acct-opening-review','Opening balance waiting for review','equity') on conflict(id) do nothing;

create or replace function public.uc_investor_post_event() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare amount numeric;bank_id text;d text;c text;lines jsonb;label text;
begin
 if TG_TABLE_NAME='uc_investor_cash_entries' then
  -- A pot-to-company profit allocation changes ownership, not the bank.
  -- Its income/liability posting is included in the single settlement entry.
  if new.kind='company_profit' then return new;end if;
  amount:=abs(new.amount_cents)::numeric/100;
  -- Paid before the bank opening date: the opening balance already reflects it.
  if new.bank_account like 'opening:%' then bank_id:='acct-opening-review';
  else
   bank_id:='acct-bank-uc-'||md5(new.bank_account);
   insert into ledger_accounts(id,name,type,investor_tagged) values(bank_id,'Bank account '||right(new.bank_account,8),'asset',null) on conflict(id) do nothing;
  end if;
  if new.kind='capital_in' then d:=bank_id;c:='acct-investor-payable';label:='Investor money received';
  elsif new.kind='withdrawal_out' then d:='acct-investor-payable';c:=bank_id;label:='Investor withdrawal paid';
  elsif new.kind='car_purchase' then d:='acct-inv-investor';c:=bank_id;label:='Investor car purchase paid';
  elsif new.kind='car_expense' then d:='acct-ap';c:=bank_id;label:='Investor car bill paid';
  elsif new.kind='car_sale' then d:=bank_id;c:='acct-uc-sale-clearing';label:='Investor car sale money received';
  else raise exception 'INVALID_INVESTOR_CASH_KIND';end if;
  lines:=jsonb_build_array(jsonb_build_object('accountId',d,'debit',amount,'credit',0),jsonb_build_object('accountId',c,'debit',0,'credit',amount));
  perform uc_post_journal(new.id::text,new.paid_on,label,new.car_id,new.recorded_by,lines);
 elsif TG_TABLE_NAME='uc_investor_car_bills' then
  if new.state='approved' and old.state='pending' then
   d:='acct-inv-investor';c:='acct-ap';label:='Investor car bill approved';
  elsif new.state='voided' and old.state='approved' then
   d:='acct-ap';c:='acct-inv-investor';label:='Investor car bill cancelled';
  else return new;end if;
  amount:=new.amount_cents::numeric/100;
  perform uc_post_journal('bill:'||new.id||':'||new.state,(new.reviewed_at at time zone 'Asia/Kuala_Lumpur')::date,label,new.car_id,new.reviewed_by,
   jsonb_build_array(jsonb_build_object('accountId',d,'debit',amount,'credit',0),jsonb_build_object('accountId',c,'debit',0,'credit',amount)));
 else
  -- Principal and direct costs are recovered first. Only the investor's net
  -- result changes capital payable; the company receives no loss posting.
  lines:=jsonb_build_array(
   jsonb_build_object('accountId','acct-uc-sale-clearing','debit',new.sale_cents::numeric/100,'credit',0),
   jsonb_build_object('accountId','acct-inv-investor','debit',0,'credit',(new.purchase_cents+new.cost_cents)::numeric/100));
  if new.investor_result_cents<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-investor-payable','debit',greatest(0,-new.investor_result_cents)::numeric/100,'credit',greatest(0,new.investor_result_cents)::numeric/100));end if;
  if new.company_profit_cents>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-rev-investor-share','debit',0,'credit',new.company_profit_cents::numeric/100));end if;
  perform uc_post_journal('settlement:'||new.car_id,(new.approved_at at time zone 'Asia/Kuala_Lumpur')::date,'Investor car profit confirmed',new.car_id,new.approved_by,lines);
 end if;
 return new;
end $$;

create or replace function public.uc_investor_cash_bank() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare b uc_investor_banks;flag text:=coalesce(current_setting('autodream.uc_before_opening',true),'');parts text[];
begin
 -- Purchase paid before the bank opening (flag set only by uc_investor_capital, single use).
 if new.kind='car_purchase' and flag<>'' and flag not like 'used|%' then
  parts:=string_to_array(flag,'|');
  if parts[1]=txid_current()::text and parts[2]=new.car_id and new.bank_account='bank:'||parts[4] then
   new.paid_on:=parts[3]::date;new.bank_account:='opening:'||parts[4];new.bank_id:=null;
   perform set_config('autodream.uc_before_opening','used|'||flag,true);
   return new;
  end if;
 end if;
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

alter function uc_investor_capital(text,text,jsonb) rename to uc_capital_before_opening_purchases;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;b uc_investor_banks;car uc_investor_cars;pot uc_investor_pots;day date;stand_in date;r jsonb;req text;bp integer;old_bp integer;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action='set_share' then
  select * into actor from garage_building_staff where id=p_actor for share;
  if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('carId','investorBasisPoints','note','requestId')) or jsonb_typeof(p_data->'carId') is distinct from 'string'
   or jsonb_typeof(p_data->'investorBasisPoints') is distinct from 'number' or coalesce(p_data->>'investorBasisPoints','') !~ '^[0-9]{1,5}$'
   or jsonb_typeof(p_data->'note') is distinct from 'string' or length(trim(p_data->>'note')) not between 3 and 500
   or coalesce(p_data->>'requestId','') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  bp:=(p_data->>'investorBasisPoints')::integer;if bp>10000 then raise exception 'INVALID';end if;
  req:=p_data->>'requestId';
  perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
  if exists(select 1 from uc_investor_commands where actor_id=p_actor and request_id=req) then
   if (select payload from uc_investor_commands where actor_id=p_actor and request_id=req) is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;
   return (select result from uc_investor_commands where actor_id=p_actor and request_id=req);
  end if;
  select p.* into pot from uc_investor_pots p join uc_investor_cars a on a.pot_id=p.id where a.car_id=p_data->>'carId';
  if pot.id is null then raise exception 'NOT_ALLOWED';end if;
  perform 1 from uc_investor_pots where id=pot.id for update;
  select * into car from uc_investor_cars where car_id=p_data->>'carId' for update;
  if car.settled_at is not null or exists(select 1 from uc_investor_car_settlements where car_id=car.car_id) then raise exception 'CAR_SETTLED_ADJUSTMENT_REQUIRED';end if;
  old_bp:=car.investor_basis_points;
  if old_bp<>bp then update uc_investor_cars set investor_basis_points=bp where car_id=car.car_id;end if;
  r:=jsonb_build_object('car',uc_investor_car_summary(car.car_id),'position',uc_investor_position(pot.id));
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot.id,p_actor,'set_share',jsonb_build_object('requestId',req,'carId',car.car_id,'fromBasisPoints',old_bp,'toBasisPoints',bp,'note',trim(p_data->>'note')));
  insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,p_data,r);
  return r;
 end if;
 if p_action='purchase_paid' and coalesce(p_data->>'bankAccountId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and jsonb_typeof(p_data->'paidOn')='string' and p_data->>'paidOn' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then
  select * into b from uc_investor_banks where id=(p_data->>'bankAccountId')::uuid;
  day:=(p_data->>'paidOn')::date;
  if b.id is not null and day<b.opening_date then
   select * into car from uc_investor_cars where car_id=p_data->>'carId';
   if car.car_id is null then raise exception 'NOT_ALLOWED';end if;
   if day<date '2020-01-01' then raise exception 'INVALID';end if;
   -- The usual checks run on a stand-in date (allocation or bank opening);
   -- the cash entry then takes the real date and makes no bank movement.
   stand_in:=greatest((car.approved_at at time zone 'Asia/Kuala_Lumpur')::date,b.opening_date);
   perform set_config('autodream.uc_before_opening',txid_current()::text||'|'||car.car_id||'|'||day::text||'|'||b.id::text,true);
   r:=uc_capital_before_opening_purchases(p_actor,p_action,p_data||jsonb_build_object('paidOn',to_char(stand_in,'YYYY-MM-DD')));
   perform set_config('autodream.uc_before_opening','',true);
   return r;
  end if;
 end if;
 return uc_capital_before_opening_purchases(p_actor,p_action,p_data);
end $$;
revoke all on function uc_capital_before_opening_purchases(text,text,jsonb),uc_investor_capital(text,text,jsonb),uc_investor_post_event(),uc_investor_cash_bank() from public,anon,authenticated,service_role;
grant execute on function uc_investor_capital(text,text,jsonb) to service_role;
commit;
