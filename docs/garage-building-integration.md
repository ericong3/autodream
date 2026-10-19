# Garage building tint — integration notes

Building tint is a separate Garage document (`BuildingProject`, see
`src/types/garageBuilding.ts`). It is **never** a vehicle invoice.

## Scope

- The "quote" is **measured scope only**: rooms, windows, panes, film, total
  sqft and how many panes still need checking, saved as immutable numbered
  versions.
- **No building pricing or rates exist anywhere.** Invoices, payments and
  installation keep running through the existing Garage car flow until a
  building backend review happens.
- Tall glass (`window.span`, rows × cols grid up to 4×4 reaching a higher
  floor) and 3D layout fields (`room.x/z`, `window.wall/position`) are stored
  in the same JSON document. No new invoice schema.
- Films are the real Garage tint series (`BUILDING_FILMS`: Royal, Unique,
  Majestic, Classic, Lite, Eco). No demo users, stock or series.

## Files

| File | Purpose |
| --- | --- |
| `src/utils/garageBuilding.ts` | Pure document logic, validation, permissions |
| `src/lib/garageBuildingProjects.ts` | Storage adapter (local default, server API opt-in) |
| `supabase/migrations/20261020000000_garage_building_projects.sql` | Applied 19 October 2026 with approval |
| `tests/garage-building*.test.mjs` | `npm test` (Node 23.6+ strips TS types) |

## Storage

- Default: **local** (this browser). One key per signed-in user:
  `autodream.garageBuilding.v1.<userId>`. Nobody — managers included — can
  list another user's key on a shared device; a manager sees only projects
  saved under their own key.
- Opt-in online API: set `VITE_GARAGE_BUILDING_STORAGE=online` **only after**
  the migration is reviewed, applied and the auth review below is done.
- Both modes enforce: Garage business access (`garage` / `both`), owner or
  Garage manager, revision compare-and-swap (`project.revision` must equal
  the stored revision; save returns `revision + 1`), saved versions are
  append-only and byte-for-byte unchanged, structural validation.
- Cloud errors are thrown as `BuildingStorageError` (`code`:
  `FORBIDDEN | CONFLICT | INVALID | NOT_FOUND | SETUP | CLOUD | AUTH | RATE_LIMITED`). There is
  **no silent fallback** to local storage and nothing is written locally
  when a cloud save fails. The UI must keep the user's in-memory document
  and show the error.
- `isBuildingSetupError(e)` identifies a server setup error; database
  setup failures are mapped to HTTP 503 by the private API.

## Privacy

- `customerId` is a Garage customer reference only. Values shaped like a
  Malaysian IC number are rejected; unknown top-level fields are rejected.
- `phone`, `customerName` and `address` are stored as entered (same as the
  existing Garage customer data). In local mode they sit in browser storage
  unencrypted — use shared devices with care.

## Migration (applied 19 October 2026)

- New Garage project, private staff, session and sign-in throttle tables;
  no changes to `users`, invoices or any car table.
- RLS on with **no policies**; table privileges revoked from `anon` /
  `authenticated`. All access is through `garage_building_list`,
  `garage_building_get`, `garage_building_save` (`SECURITY DEFINER`,
  `search_path = public, pg_temp`), executable only by `service_role`. Browser roles (`anon`, `authenticated`) have no execute grants.
- The database repeats: Garage access, owner/manager, `REVISION_CONFLICT`,
  `VERSION_IMMUTABLE`, and JSON validation (ids, room/floor refs, 1–24 panes,
  positive sizes, span grid/pane count/higher floor, film list, IC check).
  It returns canonical `revision`, `created_at`, `updated_at`.

### Online bridge prepared, not deployed

See [garage-building-online.md](garage-building-online.md) for the current architecture and activation checklist. Online calls now go through Vercel APIs with private Garage staff credentials and HttpOnly sessions. The legacy users table is publicly writable, so it is not trusted for Garage credentials or roles. Browser RPC access remains revoked. Shared saving is inactive until migrations, private account provisioning, environment configuration and deployment verification are complete.

## Limitations

- Local mode cannot detect an id collision with another user's key (keys
  are isolated by design); the cloud path refuses it.
- Local mode does not sync between devices.
- `measurementIssues` flags unchecked panes and custom panes without a
  verified area or photo reference. File uploads are not yet connected.
- Version snapshots validate span floors against the current floor list
  (floors are never removed by these helpers).

## Native app integration and verification

- Entry: Garage → Sales Tools → Building Tint (`/garage/building`).
- The editor is native React in GarageShell, with 2D/3D planning, tall glass, pane editing, duplicate/delete/Undo, a whole-set checkbox, measurement checks, printing and immutable quote snapshots. No iframe or prototype user list is used.
- Local saving/reopening and whole-set sizing were walked through in the browser using a clearly labelled review project. Cancelling a 3D resize retained the original measurements.
- The page chunks are lazy-loaded so the existing PWA cache limit is respected. Printing uses a named page rule so it does not change used-car print layouts.
- The database migration remains unexecuted. No invoices, live stock or customer records were written during verification.
