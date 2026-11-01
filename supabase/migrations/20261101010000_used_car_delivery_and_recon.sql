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
