import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installationFixture} from './installation-fixture.mjs';
process.on('uncaughtException',e=>{console.error(e.message,e.where??'');process.exit(1);});
const db=await installationFixture(process.argv[2]);
await db.exec(`alter table garage_invoices add column receipt_path text,add column receipt_name text;
 create table garage_building_staff(id text primary key,name text,enabled boolean,registration_status text,role text,business_access text);
 insert into users values('other','Other sales','garage_salesman');
 insert into garage_building_staff select id,name,true,'active',role,'garage' from users;
 insert into garage_building_staff values('uc','Used Car salesperson',true,'active','salesperson','used_car');
 create table external_salesmen(id uuid primary key default gen_random_uuid(),name text,ic text,phone text,email text,bank text,bank_account text,notes text,created_at timestamptz default now());
 create table customers(id text primary key,name text,assigned_sales_id text,interested_car_id text);
 create table cars(id text primary key,car_plate text,make text,model text,assigned_salesperson text,final_deal jsonb);
 create table garage_enquiries(id text primary key);
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id text primary key,bucket_id text);alter table storage.objects enable row level security;
 insert into customers values('customer-deal','Example customer','uc','car-deal');
 insert into cars values('car-deal','EXAMPLE','Sample','Car','uc','{"submittedAt":"2026-10-10T10:00:00Z","approvalStatus":"approved"}');
 update garage_film_stock set remaining_sqft=1000 where series='eco';`);
for(const file of ['20260919010000_garage_appointments.sql','20260919030000_garage_film_stock_atomic_adjust.sql','20261025010000_garage_private_appointments.sql','20261025030000_garage_sale_appointments.sql','20261025040000_garage_atomic_confirmation.sql','20261025050000_garage_installation_review.sql','20261026000000_garage_vehicle_glass_layout.sql','20261027000000_garage_tint_payment_ledger.sql','20261027010000_garage_tint_usage_history.sql','20261027030000_garage_tint_after_sales.sql','20261028000000_garage_damage_reports.sql','20261028010000_garage_verified_payment_evidence.sql','20261029020000_garage_referral_accounts.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../docs/garage-head-tint-INSTALL-AND-CHECK.sql',import.meta.url),'utf8'));
const migration=readFileSync(new URL('../supabase/migrations/20261031000000_garage_sales_referrals.sql',import.meta.url),'utf8');
let bundle=readFileSync(new URL('../docs/garage-sales-referrals-INSTALL-AND-CHECK.sql',import.meta.url),'utf8');
assert.ok(bundle.replaceAll('\r\n','\n').includes(migration.replaceAll('\r\n','\n').trim()),'guarded bundle contains the exact migration body');
// The production baseline hashes remain unchanged on disk. Substitute the
// disposable fixture's own definitions only for this installation rehearsal.
const baselines=[...bundle.matchAll(/\('([a-z_]+\([^']+\))','([a-f0-9]{32})'\)/g)];
assert.equal(baselines.length,9);
for(const [,signature,hash] of baselines){
 const actual=(await db.query('select md5(pg_get_functiondef($1::regprocedure)) hash',[signature])).rows[0].hash;bundle=bundle.replace(hash,actual);
}
await assert.rejects(()=>db.exec(bundle.replace(/('garage_sale_confirmation\(text,text,text,jsonb\)','?)[a-f0-9]{32}/,"$1"+'0'.repeat(32))),/baseline changed/);
await db.exec('rollback');assert.equal((await db.query("select to_regclass('garage_sales_assignments') t")).rows[0].t,null);
await db.exec(bundle);
await assert.rejects(()=>db.exec(bundle),/already exists/);await db.exec('rollback');
await db.exec(`insert into garage_customers(id,name,ic_number,phone,created_by) values('c','Example customer','TEST','0100000000','sales');
 insert into garage_vehicles(id,customer_id,make,model,year,registration_no) values('v','c','Sample','Car',2026,'EXAMPLE');`);
const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0];let n=0;
const key=()=>`referral-request-${String(++n).padStart(8,'0')}`;
const rpc=async(actor,action,data={})=>(await q('select garage_sales_referrals($1,$2,$3) r',[actor,action,data])).r;
const profile=(await q("select garage_referral_account('create_profile','head',$1) r",[{requestId:key(),profile:{legalName:'Example partner',recipientType:'individual',phone:'0100000001',brand:'Sample',branch:'Sample branch',tin:'PRIVATE-TIN',bankAccount:'PRIVATE-BANK'}}])).r;
const options=await rpc('sales','options');assert.ok(options.owners.some(u=>u.id==='director'));assert.ok(!options.owners.some(u=>u.id==='head'));assert.equal(options.external[0].id,profile.profileId);assert.ok(!JSON.stringify(options).includes('PRIVATE-'));
for(const actor of ['uc','i1','missing'])await assert.rejects(()=>rpc(actor,'options'),/NOT_ALLOWED/);
assert.equal((await rpc('sales','deals',{staffId:'uc',month:'2026-10'})).deals.length,1);
assert.equal((await rpc('sales','deals',{staffId:'uc',month:'2026-09'})).deals.length,0);
const sale={customerId:'c',vehicleId:'v',paymentStatus:'pending',remark:'Disposable example',receiptExpected:false,
 pending:{packageType:'mix',selections:[{position:'front_windscreen',series:'eco',vlt:'70%',price:100}],extras:[],discount:10,finalTotal:90},
 addons:[{name:'Coating',price:20,qty:2,serviceKey:'coating'},{name:'PPF',price:30,qty:1,serviceKey:'ppf'},{name:'Coating named generic product',price:10,qty:1}],booking:{mode:'none'},
 salesAssignment:{ownerId:'other',referrer:{kind:'external',profileId:profile.profileId}}};
const confirm=async(payload=sale,request=key())=>(await q("select garage_sale_confirmation('sales','confirm',$1,$2) r",[request,payload])).r;
const request=key(),saved=await confirm(sale,request),iid=saved.invoiceId;
assert.equal((await confirm(sale,request)).invoiceId,iid);
await assert.rejects(()=>confirm({...sale,salesAssignment:{...sale.salesAssignment,ownerId:'director'}},request),/REQUEST_CHANGED/);
const invoice=await q('select created_by,sales_owner_id from garage_invoices where id=$1',[iid]);assert.equal(invoice.created_by,'sales');assert.equal(invoice.sales_owner_id,'other');
let summary=(await rpc('other','snapshot',{invoiceId:iid})).assignment;assert.equal(summary.basis,130);assert.equal(summary.commission,39);assert.equal(summary.payable,false);
await assert.rejects(()=>rpc('sales','snapshot',{invoiceId:iid}),/NOT_ALLOWED/);
assert.equal((await rpc('other','orders')).invoices.length,1);assert.equal((await rpc('sales','orders')).invoices.length,0);
await assert.rejects(()=>q("select garage_tint_finance('sales','snapshot',$1)",[{invoiceId:iid}]),/NOT_ALLOWED/);
await q("select garage_tint_stock('other','snapshot',$1)",[{invoiceId:iid}]);
await assert.rejects(()=>q("select garage_tint_stock('sales','snapshot',$1)",[{invoiceId:iid}]),/NOT_ALLOWED/);
const money=async(actor,action,data)=>(await q('select garage_tint_finance($1,$2,$3) r',[actor,action,{invoiceId:iid,requestId:key(),...data}])).r;
const partial=await money('other','record',{amount:50,method:'cash',reference:'Example deposit'});await money('director','verify',{paymentId:partial.paymentId});
assert.equal((await rpc('other','snapshot',{invoiceId:iid})).assignment.payable,false);
const balance=await money('other','record',{amount:120,method:'transfer',reference:'Example balance'});
assert.equal((await rpc('other','snapshot',{invoiceId:iid})).assignment.payable,false);
await money('director','verify',{paymentId:balance.paymentId});assert.equal((await rpc('other','snapshot',{invoiceId:iid})).assignment.payable,true);
// Real installation and Head inspection still precede the selected owner's check.
const piece=(await q('select id from garage_tint_installation_pieces where invoice_id=$1',[iid])).id;
const installation=async(actor,action,extra={})=>{
 const state=(await q("select garage_installation_workflow($1,'snapshot',$2) r",[actor,{invoiceId:iid}])).r;
 return (await q('select garage_installation_workflow($1,$2,$3) r',[actor,action,{invoiceId:iid,itemId:piece,revision:state.review.revision,requestId:key(),...extra}])).r;
};
await assert.rejects(()=>installation('other','sales_approve',{value:true}),/NOT_ALLOWED/);
await installation('head','claim');await installation('head','sqft',{value:5});await installation('head','complete');await installation('head','confirm');await installation('head','head_approve',{value:true});
const notices=(await q("select garage_installation_workflow('other','notices','{}') r")).r;
assert.ok(notices.notices.some(v=>v.invoiceId===iid));assert.equal((await q("select garage_installation_workflow('sales','notices','{}') r")).r.notices.some(v=>v.invoiceId===iid),false);
const snap=(await q("select garage_installation_workflow('other','snapshot',$1) r",[{invoiceId:iid}])).r;
await assert.rejects(()=>q("select garage_installation_workflow('sales','sales_approve',$1)",[{invoiceId:iid,revision:snap.review.revision,requestId:key(),value:true}]),/NOT_ALLOWED/);
await installation('other','sales_approve',{value:true});
assert.equal((await q('select sales_by from garage_installation_reviews where invoice_id=$1',[iid])).sales_by,'other');
const damage=(await q("select garage_tint_damage('other','create',$1) r",[{invoiceId:iid,requestId:key(),kind:'arrival',area:'Example bumper',description:'Disposable scratch example'}])).r;
await assert.rejects(()=>q("select garage_tint_damage('sales','snapshot',$1)",[{invoiceId:iid}]),/NOT_ALLOWED/);
await assert.rejects(()=>installation('other','deliver'),/DAMAGE_REVIEW_REQUIRED/);
await q("select garage_tint_damage('head','resolve',$1)",[{invoiceId:iid,requestId:key(),reportId:damage.reportId,note:'Example condition acknowledged'}]);
await installation('other','deliver');assert.ok((await q('select delivered_at from garage_invoices where id=$1',[iid])).delivered_at);
// Disabled/invalid recipient errors roll back the complete sale, not just referral metadata.
const countBefore=(await q('select count(*)::int n from garage_invoices')).n;
await assert.rejects(()=>confirm({...sale,salesAssignment:{ownerId:'head',referrer:{kind:'none'}}}),/NOT_ALLOWED/);
const linked={ownerId:'other',referrer:{kind:'used_car',staffId:'uc',deal:{customerId:'customer-deal',carId:'car-deal',submittedAt:'2026-10-10T10:00:00Z'}}};
await assert.rejects(()=>confirm({...sale,salesAssignment:{...linked,referrer:{...linked.referrer,deal:{...linked.referrer.deal,submittedAt:'2026-09-10T10:00:00Z'}}}}),/DEAL_CHANGED/);
assert.equal((await q('select count(*)::int n from garage_invoices')).n,countBefore);
const used=await confirm({...sale,salesAssignment:linked});assert.ok((await rpc('other','snapshot',{invoiceId:used.invoiceId})).assignment.linkedDeal);
await db.exec("update garage_building_staff set enabled=false where id='uc'");
await assert.rejects(()=>confirm({...sale,salesAssignment:linked}),/NOT_ALLOWED/);
// Old clients/after-sales calls remain usable; legacy ownership falls back to creator.
const {salesAssignment,...legacySale}=sale;const legacy=await confirm(legacySale);
assert.equal((await q('select sales_owner_id from garage_invoices where id=$1',[legacy.invoiceId])).sales_owner_id,null);
assert.ok((await rpc('sales','orders')).invoices.some(i=>i.id===legacy.invoiceId));
for(const role of ['anon','authenticated']){
 await db.exec(`set role ${role}`);
 await assert.rejects(()=>db.query('select * from garage_sales_assignments'),/permission denied/);
 await assert.rejects(()=>db.query("select garage_sales_referrals('other','options','{}')"),/permission denied/);
 await db.exec('reset role');
}
assert.equal((await q("select has_function_privilege('anon','garage_sale_confirmation_before_referrals(text,text,text,jsonb)','EXECUTE') allowed")).allowed,false);
await db.close();console.log('PASS: atomic sales assignment, accountless referral, exact approved Used Car deal, preserved creator, correct owner permissions/tasks, discount/service basis, full verified receipt, rollback, replay and private access.');
