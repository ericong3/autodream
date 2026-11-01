begin;
lock table public.cars,public.customers in share row exclusive mode;
lock table public.payments in share mode;
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='cars' and column_name in ('is_recon','sales_commission')) then raise exception 'STOP: Migration already installed or unexpected schema.';end if;
 if (select count(*) from cars where id='08xao10m398qmvg2z0he' and car_plate='PPU7298' and status='available' and delivery_collected and final_deal is not null)<>1 then raise exception 'STOP: PPU7298 changed. Review first.';end if;
 if (select count(*) from cars where id='1791530284110-9qkg1enf1' and trim(model)='Noah' and status='delivered')<>1 then raise exception 'STOP: Noah changed. Review first.';end if;
 if (select count(*) from customers where id='1791525983278-v2qwimrgs' and interested_car_id='08xao10m398qmvg2z0he' and delivered and delivered_at='2026-10-30T08:48:52.895+00:00')<>1 then raise exception 'STOP: PPU7298 delivery changed.';end if;
 if (select count(*) from customers where id='1791006548439-6i19u7mtz' and interested_car_id='1791530284110-9qkg1enf1' and delivered and commission=1000 and delivered_at='2026-10-20T05:06:01.704+00:00')<>1 then raise exception 'STOP: Noah deal changed.';end if;
 if exists(select 1 from payments where car_id in ('1791530284110-9qkg1enf1','08xao10m398qmvg2z0he') and type='salesman_commission') then raise exception 'STOP: Commission payment now exists. Review first.';end if;
end $$;
create temporary table repair_before on commit drop as
select jsonb_build_object('cars',(select jsonb_agg(to_jsonb(c) order by id) from cars c where id in ('1791530284110-9qkg1enf1','08xao10m398qmvg2z0he')),'customers',(select jsonb_agg(to_jsonb(c) order by id) from customers c where id in ('1791006548439-6i19u7mtz','1791525983278-v2qwimrgs'))) state;
-- Additive repair: no grants, payments, ownership or delivery dates are changed.
alter table public.cars add column is_recon boolean not null default false;
alter table public.cars add column sales_commission numeric(12,2)
 check (sales_commission between 0 and 100000);

create table public.used_car_data_repairs (
 id text primary key,reason text not null,recorded_at timestamptz not null default now(),
 before_state jsonb not null,after_state jsonb not null
);
alter table public.used_car_data_repairs enable row level security;
revoke all on table public.used_car_data_repairs from public,anon,authenticated,service_role;

create function public.used_car_preserve_delivery() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if (old.status='delivered' or exists(select 1 from public.customers c where c.interested_car_id=old.id and c.delivered))
 and (new.status is distinct from 'delivered' or (old.final_deal is not null and new.final_deal is null)) then
  raise exception 'DELIVERED_LOCKED: A delivered car cannot return to stock or have its deal cancelled.';
 end if;
 return new;
end $$;
revoke all on function public.used_car_preserve_delivery() from public,anon,authenticated;
create trigger used_car_preserve_delivery before update on public.cars
 for each row execute function public.used_car_preserve_delivery();

create function public.used_car_preserve_delivered_customer() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Serialize against car cancellation, including an old browser tab.
 perform 1 from public.cars where id=old.interested_car_id for update;
 if old.delivered and (new.delivered is distinct from true
  or new.interested_car_id is distinct from old.interested_car_id
  or (old.cash_work_order is not null and new.cash_work_order is null)
  or (old.loan_work_order is not null and new.loan_work_order is null)) then
  raise exception 'DELIVERED_LOCKED: A delivered customer deal cannot be reverted.';
 end if;
 return new;
end $$;
revoke all on function public.used_car_preserve_delivered_customer() from public,anon,authenticated;
create trigger used_car_preserve_delivered_customer before update on public.customers
 for each row execute function public.used_car_preserve_delivered_customer();

update cars set status='delivered' where id='08xao10m398qmvg2z0he';
update cars set is_recon=true,sales_commission=2000 where id='1791530284110-9qkg1enf1';
update customers set commission=2000 where id='1791006548439-6i19u7mtz';
insert into used_car_data_repairs(id,reason,before_state,after_state)
select 'used-car-delivery-recon-20261101','Owner approved: restore PPU7298 delivery; Noah recon commission RM2000. Existing payments, ownership and delivery dates preserved.',state,
jsonb_build_object('cars',(select jsonb_agg(to_jsonb(c) order by id) from cars c where id in ('1791530284110-9qkg1enf1','08xao10m398qmvg2z0he')),'customers',(select jsonb_agg(to_jsonb(c) order by id) from customers c where id in ('1791006548439-6i19u7mtz','1791525983278-v2qwimrgs'))) from repair_before;
notify pgrst,'reload schema';
commit;
select jsonb_build_object('checked_at',now(),'ppu_delivered',(select status='delivered' from cars where id='08xao10m398qmvg2z0he'),'noah_recon',(select is_recon from cars where id='1791530284110-9qkg1enf1'),'noah_commission',(select sales_commission from cars where id='1791530284110-9qkg1enf1'),'delivery_guards',(select count(*) from pg_trigger where tgname in ('used_car_preserve_delivery','used_car_preserve_delivered_customer')),'repair_recorded',exists(select 1 from used_car_data_repairs where id='used-car-delivery-recon-20261101'),'payments_changed',false);
