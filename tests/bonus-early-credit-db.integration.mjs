import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
process.on('uncaughtException',e=>{console.error(e.message,e.where??'');process.exit(1);});
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2],'dist/index.js')));
const db=new PGlite();
const load=path=>readFileSync(new URL(path,import.meta.url),'utf8').replaceAll('\r\n','\n');
await db.exec(`create role anon;create role authenticated;create role service_role;
create table garage_building_staff(id text primary key,name text,role text,business_access text,enabled boolean,registration_status text);
insert into garage_building_staff values('1775830371686-07v0clknm','Director','director','both',true,'active'),('a','A','salesperson','used_car',true,'active'),('b','B','salesperson','used_car',true,'active'),('c','C','salesperson','used_car',true,'active'),('d','D','salesperson','used_car',true,'active');
create table cars(id text primary key,car_plate text,make text,model text,status text,consignment jsonb,outgoing_consignment jsonb,commission_credited_early boolean default false,commission_credited_month text);
create table customers(id text primary key,interested_car_id text,delivered boolean,delivered_at timestamptz);
create table used_car_data_repairs(id text primary key,reason text,before_state jsonb,after_state jsonb);
create table payments(id text primary key,amount numeric);insert into payments values('existing',1234.56);
create table payslips(id text primary key,amount numeric);insert into payslips values('existing',1234.56);`);
await db.exec(load('../supabase/migrations/20261101000000_used_car_bonus_campaigns.sql'));
const id='3950ac75-1bc0-4f91-a894-3eb25615883c',actor='1775830371686-07v0clknm';
await db.query("insert into used_car_bonus_campaigns(id,title,start_month,end_month,minimum_units,amount_per_unit,revision,published_at,created_by) values($1,'Year-end 2026 team bonus','2026-10','2026-12',6,500,2,now(),$2)",[id,actor]);
await db.query("insert into used_car_bonus_enrolments select $1,id,name from garage_building_staff where role='salesperson'",[id]);
for(let n=1;n<=4;n++){
 await db.query("insert into cars(id,car_plate,make,model,status) values($1,$1,'Sample','Delivered','delivered')",['delivered-'+n]);
 await db.query('insert into customers values($1,$1,true,$2)',['delivered-'+n,'2026-10-15T12:00:00Z']);
}
await db.exec("insert into cars(id,car_plate,make,model,status,commission_credited_early,commission_credited_month) values('early-1','EARLY1','Sample','Early','deal_pending',true,'2026-10');");
const installer=load('../docs/bonus-early-commission-INSTALL-AND-CHECK.sql');
assert.ok(installer.includes(load('../supabase/migrations/20261101020000_bonus_early_commission_units.sql').trim()));
await db.exec(process.argv[3]==='crlf'?installer.replaceAll('\n','\r\n'):installer);
const preview=async(month='2026-10')=>(await db.query('select used_car_bonus_campaign($1,\'preview\',$2) r',[actor,{id,month}])).rows[0].r;
let p=await preview();assert.equal(p.minimumUnits,5);assert.equal(p.units,5);assert.equal(p.pool,2500);assert.ok(p.shares.every(s=>s.amount===625));assert.equal(p.cars.find(c=>c.id==='early-1').basis,'early_credit');
await db.exec("insert into cars(id,car_plate,make,model,status,commission_credited_early,commission_credited_month) values('early-2','EARLY2','Sample','Early','deal_pending',true,'2026-10');");
p=await preview();assert.equal(p.units,6);assert.equal(p.pool,3000);assert.ok(p.shares.every(s=>s.amount===750));
await db.exec("insert into cars(id,car_plate,make,model,status,commission_credited_early,commission_credited_month) values('early-3','EARLY3','Sample','Early','deal_pending',true,'2026-10');");
p=await preview();assert.equal(p.units,7);assert.equal(p.pool,3500);assert.ok(p.shares.every(s=>s.amount===875));
// A later physical handover stays in the original early-credit month, not both.
await db.exec("update cars set status='delivered' where id='early-1';insert into customers values('early-handover','early-1',true,'2026-11-05T12:00:00Z');insert into customers values('duplicate','delivered-1',true,'2026-10-15T12:00:00Z');");
assert.equal((await preview()).units,7);assert.equal((await preview('2026-11')).units,0);
// Early credit applies only to company-owned units, and must have an explicit valid month.
await db.exec("insert into cars(id,status,consignment,commission_credited_early,commission_credited_month) values('dealer','deal_pending','{}',true,'2026-10');insert into cars(id,status,outgoing_consignment,commission_credited_early,commission_credited_month) values('out','deal_pending','{}',true,'2026-10');");
assert.equal((await preview()).units,7);
await db.exec("insert into cars(id,status,commission_credited_early) values('missing-month','deal_pending',true)");
p=await preview();assert.equal(p.units,7);assert.ok(p.issues.some(i=>i.id==='missing-month'));
await db.exec("delete from cars where id='missing-month'");
// Stale previews cannot be confirmed after the qualifying month is edited.
p=await preview();await db.exec("update cars set commission_credited_month='2026-11' where id='early-2'");
const call=(action,data)=>db.query('select used_car_bonus_campaign($1,$2,$3) r',[actor,action,data]);
await assert.rejects(()=>call('confirm_month',{id,month:'2026-10',requestId:'early-bonus-stale-request',previewHash:p.previewHash}),/PREVIEW_CHANGED|FUTURE_MONTH/);
assert.equal((await preview()).units,6);assert.equal((await preview('2026-11')).units,1);
await db.exec("update cars set commission_credited_month='2026-10' where id='early-2'");
// A frozen result remains identical, and its units cannot recur in another confirmed month
// even if a director later clears the early flag or changes the delivery/credit month.
p=await preview();await db.query('insert into used_car_bonus_months(campaign_id,month,snapshot,confirmed_by) values($1,$2,$3,$4)',[id,'2026-10',p,actor]);
await db.exec("update cars set commission_credited_early=false where id='early-1';update cars set commission_credited_month='2026-11' where id='early-2'");
const frozen=await preview();assert.equal(frozen.confirmed,true);assert.equal(frozen.pool,3500);assert.equal((await preview('2026-11')).units,0);
await assert.rejects(()=>db.exec(installer),/Published campaign changed|confirmed results/);await db.exec('rollback');
assert.equal((await db.query('select count(*)::int n from used_car_data_repairs')).rows[0].n,1);
assert.equal((await db.query('select amount from payments')).rows[0].amount,'1234.56');assert.equal((await db.query('select amount from payslips')).rows[0].amount,'1234.56');
for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(()=>db.query('select used_car_bonus_preview($1,$2)',[id,'2026-10']),/permission denied/);await db.exec('reset role');}
await db.close();console.log('PASS: five-unit target; 5/6/7 pools; early-credit month precedence; no double count on later delivery or frozen months; consignment exclusion; invalid month issues; stale confirmation; private execution; payroll unchanged.');
