-- TEMPLATE ONLY: do not run with placeholders. Run as database administrator.
-- The account id/username must match the chosen existing AutoDream account.
-- Choose a NEW Garage online password, not the legacy app password.
-- The user must enter the credential and execute this themselves.
-- Do not save a snippet containing an actual password.
-- Confirm pgcrypto is available in extensions before running.
insert into public.garage_building_staff (id, username, name, role, password)
values (
  'REPLACE_WITH_EXISTING_STAFF_ID',
  'REPLACE_WITH_EXISTING_USERNAME',
  'REPLACE_WITH_DISPLAY_NAME',
  'garage_head', -- choose garage_salesman / garage_head / director / shareholder
  extensions.crypt('ENTER_NEW_GARAGE_PASSWORD_HERE', extensions.gen_salt('bf', 12))
);
