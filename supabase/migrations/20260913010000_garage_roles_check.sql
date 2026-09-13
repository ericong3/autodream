-- The users.role check constraint (added outside migrations, in the
-- dashboard) only allowed the original Used Car roles. Widen it to also
-- accept the four Garage-side roles so Garage team members can be added.
alter table users drop constraint users_role_check;

alter table users add constraint users_role_check
  check (role = ANY (ARRAY[
    'director'::text, 'salesperson'::text, 'mechanic'::text, 'admin'::text,
    'investor'::text, 'shareholder'::text, 'banker'::text,
    'garage_salesman'::text, 'garage_installer'::text, 'garage_detailer'::text, 'garage_spray'::text
  ]));
