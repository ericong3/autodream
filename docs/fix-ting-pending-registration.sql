-- One-time fix (2026-11-14): remove Ting Ping Liang's abandoned, never-verified
-- registration from 7 Nov so he can register again with the current
-- Investor-accounts sign-up link.
--
-- Single statement: deletes only if the account is still pending, never
-- verified, never signed in and an investor. Otherwise it deletes nothing.
-- If anything else points at this account, it fails and nothing changes.
-- Expected result: one row  ->  tokens_deleted 1, staff_deleted 1, users_deleted 1
with target as (
  select id from garage_building_staff
  where id = '9b4dfe26d2ef35647f8b833c49b2e458'
    and registration_status = 'pending' and email_verified_at is null
    and session_version = 0 and role = 'investor'
), t as (
  delete from autodream_email_tokens where staff_id in (select id from target) returning 1
), s as (
  delete from garage_building_staff where id in (select id from target) returning 1
), u as (
  delete from users where id in (select id from target) returning 1
)
select (select count(*) from t) as tokens_deleted,
       (select count(*) from s) as staff_deleted,
       (select count(*) from u) as users_deleted;
