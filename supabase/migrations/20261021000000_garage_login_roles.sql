-- PREPARED ONLY, NOT APPLIED. Shared AutoDream private enrollment, without expanding
-- the building-project RPC permissions (which retain their sales/manager checks).
alter table public.garage_building_staff drop constraint if exists garage_building_staff_role_check;
alter table public.garage_building_staff add constraint garage_building_staff_role_check
  check (role in ('garage_salesman','garage_head','director','shareholder',
    'garage_installer','garage_detailer','garage_spray','salesperson','mechanic','admin','banker','investor'));
alter table public.garage_building_staff drop constraint if exists garage_building_staff_business_access_check;
alter table public.garage_building_staff add constraint garage_building_staff_business_access_check
  check (business_access in ('used_car','garage','both'));
-- User-approved rule: directors and shareholders can access both businesses.
update public.garage_building_staff set business_access='both' where role in ('director','shareholder');
alter table public.garage_building_staff add constraint private_director_business_access_check
  check (role not in ('director','shareholder') or business_access='both');
-- Do not copy credentials or roles from public.users. Enroll each staff member
-- using independently confirmed identity/role and an administrator-issued code.
