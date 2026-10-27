// Disposable database only. Characterizes the existing installer workflow.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2],'dist/index.js')));const db=new PGlite();
process.on('uncaughtException',e=>{console.error('INSTALLATION CHECK FAILED:',e.message);process.exit(1);});
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
const rpc=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const invoice=async id=>(await rpc('select work_status,payment_status from garage_invoices where id=$1',[id]));
async function seed(id,paid=false){await db.query("insert into garage_customers(id,name,ic_number,phone,created_by) values($1,'Sample customer',$2,'0100000000','sales')",['c-'+id,id]);await db.query("insert into garage_vehicles(id,customer_id,make,model,year,registration_no) values($1,$2,'Sample','Car',2026,'SAMPLE')",['v-'+id,'c-'+id]);await db.query("insert into garage_invoices(id,customer_id,vehicle_id,service,created_by,payment_status,payment_method) values($1,$2,$3,'tinted','sales',$4,$5)",[id,'c-'+id,'v-'+id,paid?'paid':'pending',paid?'cash':null]);await db.query("insert into garage_installer_jobs(id,invoice_id,service) values($1,$2,'tinted')",['j-'+id,id]);for(const [suffix,position] of [['a','front_windscreen'],['b','rear_windscreen']])await db.query("insert into garage_tint_installation_pieces(id,invoice_id,position,requested_series,requested_vlt) values($1,$2,$3,'eco','70%')",[id+'-'+suffix,id,position]);}
await seed('unpaid');
await rpc("select (claim_garage_glass_item('unpaid-a','i1')).id");assert.equal((await invoice('unpaid')).work_status,'in_progress');
await assert.rejects(()=>rpc("select claim_garage_glass_item('unpaid-a','i2')"),/GLASS_ALREADY_TAKEN/);
await assert.rejects(()=>rpc("select set_garage_glass_item_status('unpaid-a','installed','i2')"),/NOT_YOUR_GLASS/);
await assert.rejects(()=>rpc("select submit_garage_installation('j-unpaid','i1')"),/GLASS_NOT_ALL_CONFIRMED/);
await rpc("select set_garage_glass_item_sqft('unpaid-a',10,'i1')");await rpc("select set_garage_glass_item_sqft('unpaid-a',12,'i1')");await rpc("select set_garage_glass_item_sqft('unpaid-a',12,'i1')");
assert.equal(Number((await rpc("select remaining_sqft from garage_film_stock where series='eco'")).remaining_sqft),488,'usage edits apply only the difference');
await rpc("select set_garage_glass_item_status('unpaid-a','installed','i1')");await rpc("select claim_garage_glass_item('unpaid-b','i2')");await rpc("select set_garage_glass_item_status('unpaid-b','installed','i2')");
assert.equal((await rpc("select sqft from garage_tint_installation_pieces where id='unpaid-b'")).sqft,null);
console.log('KNOWN GAP: a glass can be finished with no film usage recorded.');
await rpc("select submit_garage_installation('j-unpaid','i1')");assert.equal((await invoice('unpaid')).work_status,'pending_approval');
await assert.rejects(()=>rpc("select set_garage_glass_item_status('unpaid-a','taken','i1')"),/NOT_IN_PROGRESS/);
await assert.rejects(()=>rpc("select approve_garage_installation('j-unpaid','head',false,null)"),/FINAL_INSPECTION_REQUIRED/);
await assert.rejects(()=>rpc("select approve_garage_installation('j-unpaid','sales',true,null)"),/NOT_A_MANAGER/);
await assert.rejects(()=>rpc("select return_garage_installation('j-unpaid','head','',null)"),/RETURN_REASON_REQUIRED/);
await rpc("select return_garage_installation('j-unpaid','head','Sample correction',array['unpaid-b'])");assert.equal((await invoice('unpaid')).work_status,'in_progress');
assert.equal((await rpc("select needs_correction from garage_tint_installation_pieces where id='unpaid-b'")).needs_correction,true);
await assert.rejects(()=>rpc("select submit_garage_installation('j-unpaid','i1')"),/GLASS_NOT_ALL_CONFIRMED/);
await rpc("select set_garage_glass_item_status('unpaid-b','installed','i2')");await rpc("select submit_garage_installation('j-unpaid','i2')");await rpc("select approve_garage_installation('j-unpaid','head',true,null)");assert.equal((await invoice('unpaid')).work_status,'payment_due');
await assert.rejects(()=>rpc("select set_garage_glass_item_status('unpaid-a','taken','i1')"),/NOT_IN_PROGRESS/);
await seed('paid',true);for(const suffix of ['a','b']){await rpc('select claim_garage_glass_item($1,$2)',['paid-'+suffix,'i1']);await rpc('select set_garage_glass_item_status($1,$2,$3)',['paid-'+suffix,'installed','i1']);}await rpc("select submit_garage_installation('j-paid','i1')");await rpc("select approve_garage_installation('j-paid','director',true,null)");assert.equal((await invoice('paid')).work_status,'ready_for_delivery');
console.log('PASS: shared team claim, ownership, stock delta, incomplete submission block, inspection, corrections, approved locking and paid/unpaid routing.');
// Mirror the legacy Supabase table grants to characterize identity trust.
await seed('identity');for(const suffix of ['a','b']){await rpc('select claim_garage_glass_item($1,$2)',['identity-'+suffix,'i1']);await rpc('select set_garage_glass_item_status($1,$2,$3)',['identity-'+suffix,'installed','i1']);}await rpc("select submit_garage_installation('j-identity','i1')");
await db.exec('grant usage on schema public to anon;grant select,insert,update,delete on all tables in schema public to anon;grant usage,select on all sequences in schema public to anon;set role anon');
await rpc("select approve_garage_installation('j-identity','head',true,null)");await db.exec('reset role');assert.equal((await invoice('identity')).work_status,'payment_due');
console.log('KNOWN SECURITY GAP: with legacy browser grants, anonymous caller can supply a manager ID and approve. This is a reproduction, not a security pass.');
await db.close();
