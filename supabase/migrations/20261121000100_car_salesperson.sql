-- Every sold or delivered car (except consigned-out cars) records who sold it.
--  1. Sold/delivered cars with no salesperson on the car get the salesperson
--     from the buyer's work order. Each change is kept in uc_car_salesperson_fills.
--  2. Cars whose commission month is before November 2026 and that have no
--     commission payment were paid outside the app: they are marked
--     commission_settled_outside so the Payments backfill and Run Payroll
--     never create commission for them. November 2026 cars are not marked.
--  3. From now on, when a car becomes sold or delivered with no salesperson,
--     the database copies the buyer's; if there is none it refuses
--     (SALESPERSON_REQUIRED), except for consigned-out cars and staff sales.
begin;

alter table public.cars add column if not exists commission_settled_outside boolean not null default false;

create table public.uc_car_salesperson_fills(
 car_id text primary key references cars(id),
 old_value text,
 new_value text,
 commission_month text,
 settled_outside boolean not null,
 skipped_reason text,
 filled_at timestamptz not null default now());
alter table uc_car_salesperson_fills enable row level security;
revoke all on uc_car_salesperson_fills from public,anon,authenticated;

-- The buyer's salesperson for a car (same buyer the app uses: the customer with a work order).
create function public.uc_buyer_salesperson(p_car text) returns text language sql stable security definer set search_path=public,pg_temp as $$
 select nullif(trim(cu.assigned_sales_id::text),'') from customers cu
 where cu.interested_car_id=p_car and (cu.cash_work_order is not null or cu.loan_work_order is not null)
 order by (nullif(trim(cu.assigned_sales_id::text),'') is null) limit 1 $$;

do $$
declare r record;month text;settled boolean;
begin
 for r in
  select c.id,c.assigned_salesperson::text as old_value,uc_buyer_salesperson(c.id) as buyer_sp,
   left(coalesce(case when c.commission_credited_early and c.commission_credited_month is not null then c.commission_credited_month||'-01' end,
    (select cu.delivered_at::text from customers cu where cu.interested_car_id=c.id and (cu.cash_work_order is not null or cu.loan_work_order is not null) order by (nullif(trim(cu.assigned_sales_id::text),'') is null) limit 1),
    c.final_deal->>'submittedAt',c.date_added::text),7) as cmonth,
   exists(select 1 from payments p where p.car_id=c.id and p.type='salesman_commission') as has_commission
  from cars c
  where c.status in ('sold','delivered') and c.outgoing_consignment is null and nullif(trim(c.assigned_salesperson::text),'') is null
 loop
  month:=r.cmonth;
  settled:=month<'2026-11' and not r.has_commission;
  if r.buyer_sp is null then
   insert into uc_car_salesperson_fills(car_id,old_value,new_value,commission_month,settled_outside,skipped_reason) values(r.id,r.old_value,null,month,false,'NO_BUYER_SALESPERSON');
   continue;
  end if;
  begin
   update cars set assigned_salesperson=r.buyer_sp,commission_settled_outside=commission_settled_outside or settled where id=r.id;
   insert into uc_car_salesperson_fills(car_id,old_value,new_value,commission_month,settled_outside) values(r.id,r.old_value,r.buyer_sp,month,settled);
  exception when others then
   insert into uc_car_salesperson_fills(car_id,old_value,new_value,commission_month,settled_outside,skipped_reason) values(r.id,r.old_value,null,month,false,left(sqlerrm,300));
  end;
 end loop;
end $$;

create function public.uc_car_salesperson_rule() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status in ('sold','delivered') and new.outgoing_consignment is null
  and nullif(trim(new.assigned_salesperson::text),'') is null
  and (old.status is distinct from new.status or nullif(trim(old.assigned_salesperson::text),'') is not null) then
  new.assigned_salesperson:=uc_buyer_salesperson(new.id);
  if new.assigned_salesperson is null and not coalesce(new.is_staff_sale,false) then
   raise exception 'SALESPERSON_REQUIRED' using hint='Choose the salesperson for this car before it is sold or delivered.';
  end if;
 end if;
 return new;
end $$;
create trigger uc_car_salesperson_required before update of status,assigned_salesperson,outgoing_consignment on cars for each row execute function uc_car_salesperson_rule();

revoke all on function uc_buyer_salesperson(text),uc_car_salesperson_rule() from public,anon,authenticated;
commit;

-- After running, check: select * from uc_car_salesperson_fills order by commission_month desc;
-- Rows with skipped_reason were not changed; send them to the developer.
