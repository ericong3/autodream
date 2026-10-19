# Garage building online saving

Database migrations applied to AutoDream on 19 October 2026 with user approval. All four new tables have RLS enabled and anonymous SELECT/UPDATE denied. Production Vercel variables are configured. **Deployment and staff account provisioning still require verification; do not claim shared saving is ready until the live test passes.**

## Identity and permissions

The live `public.users` table has RLS disabled and grants anonymous SELECT and UPDATE (verified through metadata only on 19 October 2026). Its passwords and role values cannot establish a trusted identity. Do not deploy a server that trusts that table for Garage authentication.

Garage online saving therefore uses a separate, private `garage_building_staff` table. An administrator provisions each allowed staff member with a **new Garage online password**, stored only as bcrypt. The id and username match their existing AutoDream account, but credentials and permission roles are independent of the legacy table. No staff are automatically enrolled. Browser roles have no access to this table. The existing used-car login is unchanged.

Sales staff can access their own building projects. Garage heads, directors and shareholders can access all building projects. Disabling the private account, removing its access or changing its password revokes its sessions. Do not reuse legacy passwords, since the existing table is exposed. The legacy application security issue remains outside this Garage change and should be addressed separately.

## Server

- Vercel endpoints: `/api/garage-building/session` (GET/POST/DELETE), `/api/garage-building/projects` (GET/PUT).
- HttpOnly, Secure, SameSite=Strict host-only cookie; opaque random token; only its hash is stored in the database. Ten-hour absolute lifetime and two-hour idle expiry.
- Each request rechecks the private account and derives the RPC actor on the server. The expected-user header only checks consistency to prevent shared-PC account races; it never establishes identity.
- Allow-listed Origin, same-origin fetch metadata and custom request header; no CORS grants. JSON/body limits, persistent atomic username/IP throttling, no-store responses and generic server errors.
- Project RPCs remain service-role-only. No direct browser table/RPC access. Revision checks prevent stale overwrites; saved versions are immutable.
- No silent local fallback and no automatic upload of existing device projects. Failed saves preserve the current document on screen. Staff re-authenticate and retry after session expiry.

## Deployment checklist

1. Review the two prepared migrations: `20261020000000_garage_building_projects.sql` then `20261020010000_garage_building_online_sessions.sql`. They create Garage-only objects; they do not change used-car tables or existing users. Apply them transactionally after approval, inspect the resulting grants and confirm anonymous access is denied.
2. An administrator provisions private Garage staff accounts. See `supabase/garage-building-provision.example.sql`. The user must enter and submit the new password themselves. Never commit actual passwords or hashes, and never print secret keys.
3. Configure the Vercel project with server-only variables:
   - `GARAGE_BUILDING_ONLINE=1`
   - `SUPABASE_URL=https://ayvbagxashasdqgwncbf.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` (existing secret/service-role key, **server only**)
   - `GARAGE_SESSION_SECRET` (at least 32 random bytes, e.g. base64 encoded)
   - `GARAGE_ALLOWED_ORIGINS=https://autodream.vercel.app` (exact comma-separated origins; explicitly add any testing deployment origin).
4. Set public build flag `VITE_GARAGE_BUILDING_STORAGE=online`. No secrets may use a `VITE_` prefix. Default API path is same-origin; external overrides are refused.
5. Commit only Garage integration/backend files, preserve unrelated local edits, review the deployment diff against production master, then deploy the approved change. The trial branch contains other prototype files; do not blindly promote the whole working tree.
6. Verify on the deployed HTTPS site with two independently signed-in browsers/PCs: save/reopen a clearly marked test project, update from the other PC, confirm a stale save conflicts, verify staff/manager access, sign-out and expiry. A local Vite server alone does not run Vercel APIs.
7. Only then tell staff that shared saving is enabled. Existing local sketches remain on their original browser until explicitly imported by a separately reviewed flow.

Rollback: turn the online feature off and redeploy; keep the private tables and saved cloud projects intact. Local mode does **not** display cloud projects. Rotating the server session secret invalidates existing sessions. Never drop tables as a rollback.

## Tests and remaining verification

`npm test` exercises the model, local/online storage and injected server handlers without live credentials. `npm run build` validates the web app/PWA. API entry points also parse under Node. These tests do not replace deployment routing, actual PostgreSQL execution, grant checks or the two-PC save test. No shared payments, installation workflow or pricing is introduced.
