-- Administrator template only: use explicitly approved account details.
-- Never copy passwords or permission roles from the public users table.
-- This unknown random password is discarded; staff set their own in the app.
insert into public.garage_building_staff(id,username,name,role,password)
values('APPROVED_STAFF_ID','APPROVED_USERNAME','DISPLAY_NAME','garage_salesman',
  extensions.crypt(encode(extensions.gen_random_bytes(32),'hex'),extensions.gen_salt('bf',12)))
on conflict(id) do nothing;

-- Administrator only; give this single-use code only to that staff member.
-- It expires in 72 hours. Reissuing replaces any previous code.
select public.garage_building_issue_invite('APPROVED_STAFF_ID') as setup_code;
