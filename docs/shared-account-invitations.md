# Shared AutoDream staff accounts — staged rollout

This replaces neither business workflow. The shared login follows the private
account's business access: Used Car, Garage, or both (director/shareholder).
Only directors create invitations, change role/access, enable or disable accounts.
Staff enter their own name, username, email, phone and password. Verification is
required before a new account can sign in. Existing staff keep their ID, records
and old private password until their newly entered email is verified.

## Implemented

- `/staff-access`: director invitations, targeted existing-account setup, revoke,
  role/access changes, enable/disable. Links appear once and expire after 48 hours.
- `/account/register?token=…` (inside the hash route): immutable invitation access,
  self-registration, hashed private password, no public password copy.
- `/account/verify`, `/account/forgot`, `/account/reset`, `/account/resend`:
  hashed single-use 30-minute email tokens; GET never consumes a token. Recovery
  mail runs through Vercel `waitUntil` so SMTP does not disclose account existence
  through request latency. Reset revokes sessions and outstanding email tokens.
- `/api/auth/accounts`: private server identity, director checks repeated in SQL,
  bounded JSON, same-origin controls, throttling. No anonymous table/function grants.
- Private email/phone; public staff rows retain only compatibility display data.
- Private role changes increment session version and revoke sessions. Protects
  the final active director. Targeted setup reissue revokes older links, including
  already-registered but unverified enrollments.

## Deployment prerequisites

Rollout on 2026-10-21: both 20261021 migrations applied successfully to Production in one transaction. Gmail credentials were entered privately by the owner. AUTH_PUBLIC_ORIGIN and AUTH_INVITES_ENABLED are configured. VITE_AUTODREAM_SECURE_LOGIN remains unset; existing staff login stays active. No real verification or reset email has been tested yet.

1. Live metadata was checked read-only: required `users` columns without defaults
   are id, name, username, password and role; users_username_key is unique. The
   registration insert supplies these. Recheck before deployment if the schema
   changes. The deployment should also audit existing private staff roles/IDs and enroll other accounts
   from director-confirmed information, not blindly copy the public staff table.
2. Apply `20261021000000_garage_login_roles.sql` and then
   `20261021010000_autodream_staff_invitations.sql`. New role/password authority
   remains in the private `garage_building_staff` table despite its historical name.
3. Set server-only `AUTH_PUBLIC_ORIGIN=https://autodream.vercel.app`,
   `AUTH_GMAIL_USER=autodreamkch@gmail.com`, `AUTH_GMAIL_APP_PASSWORD` (entered
   privately by the human), and `AUTH_INVITES_ENABLED=1`. Existing Supabase,
   session-secret and origin allow-list configuration is also required. No email
   credentials may have a `VITE_` prefix. Gmail requires an eligible App Password
   or a future OAuth adapter; never use the ordinary Google password here.
4. An administrator can bootstrap a confirmed existing director with
   `autodream_bootstrap_director_invitation(id)`. This function is inaccessible to
   service_role, anon and authenticated. Keep its returned token private; the link
   is `https://autodream.vercel.app/#/account/register?token=<token>`. The director
   completes email verification before the shared login is enabled for everyone.
5. Enable public `VITE_AUTODREAM_SECURE_LOGIN=1` and
   `VITE_GARAGE_BUILDING_STORAGE=online` only after deployment review and staff
   enrollment. Existing `/garage/login` redirects to the common `/login`.
   Old building setup-code activation is disabled once invitations are enabled.
6. Human completes a real verification email and password reset, then test a
   Used-Car-only, Garage-only and both-business account, director restrictions,
   logout, expiry, account disable, and existing staff profile workflows.

The old publicly accessible business tables are not made secure by a login UI.
New Leads saving must use the verified server actor and private tables. Broader
legacy data-policy migration is separate work; do not claim global data isolation.

## Validation

`npm test`; `npm run build`.
For isolated actual PostgreSQL transaction tests, install PGlite in a temporary
directory outside the application, then run:

```
node tests/staff-accounts-db.integration.mjs <path-to-pglite-package>
```

This tests migration syntax, director authority, simultaneous redemption, expired
and revoked links, replay prevention, sole-director email setup, replacement setup
links, verification resend, reset/session revocation and anonymous access denial.
No test sends email or connects to the production database.
