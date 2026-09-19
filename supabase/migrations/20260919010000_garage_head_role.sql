-- Tint & Coat Head — director-level access scoped only to Garage (businessAccess
-- locked to 'garage' in the Team Members UI), for someone running Garage without
-- touching Used Car. Widen the role check constraint to accept it.
alter table users drop constraint users_role_check;

alter table users add constraint users_role_check
  check (role = ANY (ARRAY[
    'director'::text, 'salesperson'::text, 'mechanic'::text, 'admin'::text,
    'investor'::text, 'shareholder'::text, 'banker'::text,
    'garage_salesman'::text, 'garage_installer'::text, 'garage_detailer'::text, 'garage_spray'::text,
    'garage_head'::text
  ]));
