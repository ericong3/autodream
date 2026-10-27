// Disposable database only. Characterizes the existing installer workflow.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
export async function installationFixture(runtime){
const {PGlite}=await import(pathToFileURL(resolve(runtime,'dist/index.js')));const db=new PGlite();

await db.exec(`create role anon;create role authenticated;create role service_role;create publication supabase_realtime;create table users(id text primary key,name text,role text);
insert into users values('i1','Sample installer A','garage_installer'),('i2','Sample installer B','garage_installer'),('head','Sample head','garage_head'),('director','Sample director','director'),('sales','Sample sales','garage_salesman');`);
for(const file of [
 '20260913020000_garage_customers_vehicles.sql','20260913030000_garage_invoices.sql','20260913040000_garage_tint_pricing.sql',
 '20260916000000_garage_installer_jobs.sql','20260916210000_garage_invoice_payment_status.sql','20260917000000_garage_invoice_payment_addons.sql',
 '20260918000000_garage_work_order_lifecycle.sql','20260919000000_garage_installer_job_estimate.sql','20260919020000_garage_tint_installation_pieces.sql',
])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
await db.exec("alter table garage_tint_orders add column extras jsonb not null default '[]'");
for(const file of [
 '20260930000000_garage_tint_work_order_items.sql','20260930010000_garage_work_order_status.sql','20260930020000_garage_installer_job_start.sql',
 '20260930030000_garage_installer_job_complete.sql','20260930040000_garage_work_order_actors.sql','20260930050000_garage_work_order_activity.sql',
 '20261001000000_garage_work_status_reconcile.sql','20261001010000_garage_lifecycle_guards.sql','20261001020000_garage_glass_sqft_atomic.sql',
 '20261001030000_garage_installation_permissions.sql','20261001040000_garage_assign_installer.sql','20261002000000_garage_team_installation.sql',
])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));

return db;
}
