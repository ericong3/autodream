-- PREPARED ONLY. Commission costs share the investor bill/payment pipeline.
begin;
create table public.uc_investor_commission_reviews (
 car_id text primary key references uc_investor_cars(car_id), source_plan jsonb not null,
 reviewed_by text not null references garage_building_staff(id), reviewed_at timestamptz not null default now()
);
create table public.uc_investor_commission_bills (
 car_id text not null references uc_investor_commission_reviews(car_id),
 kind text not null check(kind in ('salesman_commission','intake_bonus','source_commission')),
 bill_id uuid not null unique references uc_investor_car_bills(id), recipient_type text not null, recipient_id text not null,
 primary key(car_id,kind)
);
create trigger uc_commission_reviews_fixed before update or delete on uc_investor_commission_reviews for each row execute function uc_investor_immutable();
create trigger uc_commission_links_fixed before update or delete on uc_investor_commission_bills for each row execute function uc_investor_immutable();
create trigger uc_commission_reviews_no_truncate before truncate on uc_investor_commission_reviews execute function uc_investor_immutable();
create trigger uc_commission_links_no_truncate before truncate on uc_investor_commission_bills execute function uc_investor_immutable();

create function public.uc_commission_cents(v jsonb) returns bigint language plpgsql immutable set search_path=public,pg_temp as $$
declare n numeric;
begin
 if v is null or v='null'::jsonb then return null;end if;
 if jsonb_typeof(v)<>'number' then raise exception 'COMMISSION_DETAILS_INVALID';end if;
 n:=(v#>>'{}')::numeric*100;
 if n<0 or n>1000000000000 or trunc(n)<>n then raise exception 'COMMISSION_DETAILS_INVALID';end if;
 return n::bigint;
end $$;

-- Optional legacy columns are read as JSON, preserving deployed defaults.
create function public.uc_investor_commission_plan(p_car text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb; buyer jsonb:='{}'; funding uc_investor_cars; amount bigint; intake bigint; source_amount bigint; person text; source_person text; source_type text; lines jsonb:='[]';
begin
 select * into funding from uc_investor_cars where car_id=p_car;
 select to_jsonb(s) into c from cars s where s.id=p_car;
 if c is null or funding.sale_cents is null then raise exception 'COMMISSION_REVIEW_REQUIRED';end if;
 if to_regclass('public.customers') is not null then
  execute $q$select to_jsonb(s) from customers s where to_jsonb(s)->>'interested_car_id'=$1
   and ((to_jsonb(s)->'loan_work_order' is not null and to_jsonb(s)->'loan_work_order'<>'null'::jsonb) or (to_jsonb(s)->'cash_work_order' is not null and to_jsonb(s)->'cash_work_order'<>'null'::jsonb))
   order by coalesce((to_jsonb(s)->>'delivered')::boolean,false) desc,s.id limit 1$q$ into buyer using p_car;
 end if;
 person:=coalesce(nullif(c->>'assigned_salesperson',''),nullif(buyer->>'assigned_sales_id',''));
 if coalesce((c->>'waive_commission')::boolean,false) or coalesce((c->>'is_staff_sale')::boolean,false) or (c->'outgoing_consignment' is not null and c->'outgoing_consignment'<>'null'::jsonb) then amount:=0;
 else
  amount:=coalesce(uc_commission_cents(c->'sales_commission'),uc_commission_cents(buyer->'commission'));
  if amount is null then amount:=case when coalesce((c->>'is_recon')::boolean,false) then 200000 when uc_commission_cents(c->'price_floor') is not null and funding.sale_cents<uc_commission_cents(c->'price_floor') then 100000 else 150000 end;end if;
 end if;
 intake:=coalesce(uc_commission_cents(c->'intake_commission'),0);
 source_amount:=coalesce(uc_commission_cents(c->'source_commission'),0);
 if (amount>0 or intake>0) and person is null then raise exception 'COMMISSION_RECIPIENT_REQUIRED';end if;
 if amount>0 then lines:=lines||jsonb_build_array(jsonb_build_object('kind','salesman_commission','amountCents',amount,'recipientType','user','recipientId',person));end if;
 if intake>0 then lines:=lines||jsonb_build_array(jsonb_build_object('kind','intake_bonus','amountCents',intake,'recipientType','user','recipientId',person));end if;
 if source_amount>0 then
  if c->>'source_type'='internal' then source_person:=nullif(c->>'source_salesman_id','');source_type:='user';
  elsif c->>'source_type'='external' then source_person:=nullif(c->>'external_salesman_id','');source_type:='external_salesman';end if;
  if source_person is null then raise exception 'COMMISSION_RECIPIENT_REQUIRED';end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('kind','source_commission','amountCents',source_amount,'recipientType',source_type,'recipientId',source_person));
 end if;
 return lines;
end $$;

create function public.uc_commission_recipient(p_type text,p_id text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_type='user' then
  if not exists(select 1 from garage_building_staff s where s.id=p_id and s.enabled and s.registration_status='active' and s.business_access in ('used_car','both') and s.role in ('salesperson','director')) then raise exception 'COMMISSION_RECIPIENT_REQUIRED';end if;
  select to_jsonb(u) into result from users u where id=p_id;
  if result is null then select jsonb_build_object('id',s.id,'name',s.name) into result from garage_building_staff s where id=p_id;end if;
 elsif p_type='external_salesman' and to_regclass('public.external_salesmen') is not null then
  execute 'select to_jsonb(s) from external_salesmen s where id=$1' into result using p_id;
 end if;
 if nullif(trim(result->>'name'),'') is null then raise exception 'COMMISSION_RECIPIENT_REQUIRED';end if;
 return result;
end $$;

alter function public.uc_investor_capital(text,text,jsonb) rename to uc_investor_capital_before_commissions;
revoke all on function public.uc_investor_capital_before_commissions(text,text,jsonb) from public,anon,authenticated,service_role;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; plan jsonb; old_plan jsonb; line jsonb; recipient jsonb; car uc_investor_cars; bill uuid; actor garage_building_staff; source_car jsonb;
begin
 if p_action not in ('agree_sale','settle_car','pay_car_bill') then return uc_investor_capital_before_commissions(p_actor,p_action,p_data);end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or coalesce(p_data->>'requestId','') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||(p_data->>'requestId'),0));
 select * into car from uc_investor_cars where car_id=p_data->>'carId';
 if car.car_id is null then raise exception 'NOT_ALLOWED';end if;
 perform 1 from uc_investor_pots where id=car.pot_id for update;
 -- A completed request remains a receipt of that operation, even if the car
 -- is later edited. The underlying command still checks exact payload equality.
 if exists(select 1 from uc_investor_commands where actor_id=p_actor and request_id=p_data->>'requestId') then return uc_investor_capital_before_commissions(p_actor,p_action,p_data);end if;
 if p_action='pay_car_bill' then
  if exists(select 1 from uc_investor_commission_bills where bill_id=(p_data->>'billId')::uuid) then
   select to_jsonb(s) into source_car from cars s where id=car.car_id for update;
   if source_car->>'status'<>'delivered' and not (coalesce((source_car->>'commission_credited_early')::boolean,false) and coalesce(source_car->>'commission_credited_month','') ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$') then raise exception 'COMMISSION_NOT_PAYABLE';end if;
  end if;
  return uc_investor_capital_before_commissions(p_actor,p_action,p_data);
 end if;
 if p_action='settle_car' then
  select source_plan into old_plan from uc_investor_commission_reviews where car_id=car.car_id;
  if old_plan is null or old_plan is distinct from uc_investor_commission_plan(car.car_id) then raise exception 'COMMISSION_REVIEW_REQUIRED';end if;
  if exists(select 1 from uc_investor_commission_bills l join uc_investor_car_bills b on b.id=l.bill_id where l.car_id=car.car_id and b.state<>'approved') then raise exception 'COMMISSION_REVIEW_REQUIRED';end if;
  return uc_investor_capital_before_commissions(p_actor,p_action,p_data);
 end if;
 result:=uc_investor_capital_before_commissions(p_actor,p_action,p_data);
 select * into car from uc_investor_cars where car_id=car.car_id;
 plan:=uc_investor_commission_plan(car.car_id);
 select source_plan into old_plan from uc_investor_commission_reviews where car_id=car.car_id;
 if old_plan is not null then
  if old_plan is distinct from plan then raise exception 'COMMISSION_REVIEW_REQUIRED';end if;
  return result;
 end if;
 insert into uc_investor_commission_reviews(car_id,source_plan,reviewed_by) values(car.car_id,plan,p_actor);
 for line in select value from jsonb_array_elements(plan) loop
  recipient:=uc_commission_recipient(line->>'recipientType',line->>'recipientId');
  insert into uc_investor_car_bills(car_id,category,purpose,payee,amount_cents,created_by)
  values(car.car_id,'commission',case line->>'kind' when 'salesman_commission' then 'Salesman commission' when 'intake_bonus' then 'Intake bonus' else 'Source commission' end,recipient->>'name',(line->>'amountCents')::bigint,p_actor) returning id into bill;
  insert into uc_investor_commission_bills(car_id,kind,bill_id,recipient_type,recipient_id) values(car.car_id,line->>'kind',bill,line->>'recipientType',line->>'recipientId');
 end loop;
 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(car.pot_id,p_actor,'commission_bills_created',jsonb_build_object('carId',car.car_id,'requestId',p_data->>'requestId','count',jsonb_array_length(plan)));
 return result;
end $$;

-- Read-only payroll projection: never another payable or bank movement.
create function public.uc_commission_payment_row(p_bill uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare link uc_investor_commission_bills;bill uc_investor_car_bills;c jsonb;buyer jsonb;recipient jsonb;paid bigint;entry uc_investor_cash_entries;day text;month text;
begin
 select * into link from uc_investor_commission_bills where bill_id=p_bill;
 select * into bill from uc_investor_car_bills where id=p_bill;
 if bill.id is null or bill.state<>'approved' then return null;end if;
 select to_jsonb(s) into c from cars s where id=bill.car_id;
 if c->>'status'<>'delivered' and not (coalesce((c->>'commission_credited_early')::boolean,false) and coalesce(c->>'commission_credited_month','') ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$') then return null;end if;
 if to_regclass('public.customers') is not null then execute $q$select to_jsonb(s) from customers s where to_jsonb(s)->>'interested_car_id'=$1 and ((to_jsonb(s)->'cash_work_order' is not null and to_jsonb(s)->'cash_work_order'<>'null'::jsonb) or (to_jsonb(s)->'loan_work_order' is not null and to_jsonb(s)->'loan_work_order'<>'null'::jsonb)) order by s.id limit 1$q$ into buyer using bill.car_id;end if;
 month:=c->>'commission_credited_month';
 if coalesce((c->>'commission_credited_early')::boolean,false) and coalesce(month,'') ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then day:=month||'-01';
 else day:=left(coalesce(buyer->>'delivered_at',c->'final_deal'->>'submittedAt',c->>'date_added',bill.created_at::text),10);end if;
 if link.recipient_type='user' then select to_jsonb(s) into recipient from users s where id=link.recipient_id;
 elsif to_regclass('public.external_salesmen') is not null then execute 'select to_jsonb(s) from external_salesmen s where id=$1' into recipient using link.recipient_id;end if;
 select coalesce(-sum(e.amount_cents),0) into paid from uc_investor_cash_entries e where e.bill_id=p_bill and e.kind='car_expense';
 select * into entry from uc_investor_cash_entries e where e.bill_id=p_bill and e.kind='car_expense' order by recorded_at desc,id desc limit 1;
 return jsonb_build_object('id','uc_commission_'||bill.id::text,'type',link.kind,'car_id',bill.car_id,'recipient_type',link.recipient_type,'recipient_id',link.recipient_id,'recipient_name',bill.payee,
  'bank_name',coalesce(recipient->>'bank_name',recipient->>'bank'),'account_number',coalesce(recipient->>'bank_account_number',recipient->>'bank_account'),'account_holder',recipient->>'bank_account_holder',
  'amount',bill.amount_cents::numeric/100,'description',bill.purpose||' — investor car','status',case when paid>=bill.amount_cents then 'transferred' else 'pending' end,
  'created_at',day||'T00:00:00Z','transferred_at',case when paid>=bill.amount_cents then entry.recorded_at else null end,'transferred_by',case when paid>=bill.amount_cents then entry.recorded_by else null end);
end $$;
create view public.uc_private_payment_rows as
 select p.* from public.payments p
 union all
 select (jsonb_populate_record(null::public.payments,r.row_data)).* from public.uc_investor_commission_bills c
 cross join lateral (select public.uc_commission_payment_row(c.bill_id) row_data) r where r.row_data is not null;

alter table uc_investor_commission_reviews enable row level security;
alter table uc_investor_commission_bills enable row level security;
revoke all on uc_investor_commission_reviews,uc_investor_commission_bills,uc_private_payment_rows from public,anon,authenticated,service_role;
grant select on uc_private_payment_rows to service_role;
revoke all on function public.uc_commission_cents(jsonb),public.uc_commission_recipient(text,text),public.uc_investor_commission_plan(text),public.uc_commission_payment_row(uuid),public.uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_investor_capital(text,text,jsonb) to service_role;
grant execute on function public.uc_commission_payment_row(uuid) to service_role;
notify pgrst,'reload schema';
commit;
