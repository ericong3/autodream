process.on('uncaughtException',e=>{console.error(e.message,e.where);process.exit(1)});
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installationFixture} from './installation-fixture.mjs';
const db=await installationFixture(process.argv[2]);
await db.exec(`alter table garage_invoices add column receipt_path text,add column receipt_name text;create table garage_building_staff(id text primary key,enabled boolean,registration_status text,role text,business_access text);
insert into users values('sales2','Other salesman','garage_salesman'),('share','Shareholder','shareholder');
insert into garage_building_staff select id,true,'active',role,'garage' from users;
grant usage on schema public to anon,authenticated,service_role;
grant select,insert,update,delete on all tables in schema public to anon,authenticated;
grant usage,select on all sequences in schema public to anon,authenticated;`);
await db.exec(readFileSync(new URL('../supabase/migrations/20261025050000_garage_installation_review.sql',import.meta.url),'utf8'));
const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
await db.exec(`insert into garage_customers(id,name,ic_number,phone,created_by) values('c','Sample','TEST','0100000000','sales');insert into garage_vehicles(id,customer_id,make,model,year,registration_no) values('v','c','Sample','Car',2026,'SAMPLE');insert into garage_invoices(id,customer_id,vehicle_id,service,created_by,payment_status,payment_method) values('inv','c','v','tinted','sales','paid','cash');insert into garage_installer_jobs(id,invoice_id,service) values('job','inv','tinted');insert into garage_tint_installation_pieces(id,invoice_id,position,requested_series,requested_vlt) values('a','inv','front_windscreen','eco','70%'),('b','inv','rear_windscreen','eco','70%');`);
let serial=0;
const snapshot=async(actor='i1')=>(await q('select garage_installation_workflow($1,$2,$3) r',[actor,'snapshot',{jobId:'job'}])).r;
async function act(actor,action,extra={},rev){const s=await snapshot(actor);return (await q('select garage_installation_workflow($1,$2,$3) r',[actor,action,{jobId:'job',revision:rev??s.review.revision,requestId:'sample-request-'+String(++serial).padStart(5,'0'),...(['head_approve','sales_approve'].includes(action)?{value:true}:{}),...extra}])).r;}
await act('i1','claim',{itemId:'a'});await act('i2','claim',{itemId:'b'});
await assert.rejects(()=>act('i2','complete',{itemId:'a'}),/NOT_ALLOWED/);
await assert.rejects(()=>act('i1','confirm'),/OWN_WORK_INCOMPLETE/);
await act('i1','complete',{itemId:'a'});await act('i1','confirm');
assert.equal((await snapshot()).review.state,'working');
await act('i2','complete',{itemId:'b'});assert.equal((await snapshot()).review.state,'working','all glass done alone does not submit');
await act('i2','confirm');assert.equal((await snapshot()).review.state,'head');
assert.equal((await q("select garage_installation_workflow('head','notices','{}') r")).r.notices.length,1);
for(const role of ['director','share','sales','i1'])await assert.rejects(()=>act(role,'head_approve'),/NOT_ALLOWED/);
await assert.rejects(()=>act('sales','sales_approve'),/NOT_ALLOWED/);
await act('head','head_approve');assert.equal((await snapshot()).review.state,'sales');assert.equal((await q("select work_status from garage_invoices where id='inv'")).work_status,'sales_inspection');
await assert.rejects(()=>act('sales','deliver'),/INSPECTION_REQUIRED/);
await assert.rejects(()=>act('sales2','sales_approve'),/NOT_ALLOWED/);
await act('sales','sales_return',{reason:'Sample bubble'});assert.equal((await snapshot()).review.state,'correction_review');assert.equal((await q("select work_status from garage_invoices where id='inv'")).work_status,'head_correction_review');
await assert.rejects(()=>act('head','head_approve'),/NOT_READY/);
await assert.rejects(()=>act('head','head_return',{reason:'Fix',itemIds:['other']}),/INVALID/);
await act('head','head_return',{reason:'Replace rear piece',itemIds:['b']});
assert.equal((await q("select installer_id from garage_tint_installation_pieces where id='b'")).installer_id,'i2');
await assert.rejects(()=>act('i2','release',{itemId:'b'}),/ORIGINAL_INSTALLER/);
await assert.rejects(()=>act('i1','complete',{itemId:'b'}),/NOT_ALLOWED/);
await act('i2','complete',{itemId:'b'});await act('i2','confirm');assert.equal((await snapshot()).review.state,'working');
await act('i1','confirm');assert.equal((await snapshot()).review.state,'head');await act('head','head_approve');
const before=await snapshot('sales'),payload={jobId:'job',revision:before.review.revision,requestId:'same-request-0123456789',value:true};
const r=await q("select garage_installation_workflow('sales','sales_approve',$1) r",[payload]);
assert.deepEqual((await q("select garage_installation_workflow('sales','sales_approve',$1) r",[payload])).r,r.r);
await assert.rejects(()=>q("select garage_installation_workflow('sales','sales_return',$1)",[{...payload,reason:'changed'}]),/REQUEST_CHANGED/);
await assert.rejects(()=>act('sales','deliver',{},before.review.revision),/REVISION_CONFLICT/);
await assert.rejects(()=>act('sales2','receipt',{value:{path:'inv/sample',name:'sample.png'}}),/NOT_ALLOWED/);await act('sales','receipt',{value:{path:'inv/sample',name:'sample.png'}});await act('sales','deliver');assert.ok((await q("select delivered_at from garage_invoices where id='inv'")).delivered_at);
assert.ok(Number((await q('select count(*) n from garage_installation_review_events')).n)>10);
// Existing sale confirmation still writes children through its trusted definer.
await db.exec(readFileSync(new URL('../supabase/migrations/20261025040000_garage_atomic_confirmation.sql',import.meta.url),'utf8'));
const newSale={customerId:'c',vehicleId:'v',paymentStatus:'pending',remark:'Sample',receiptExpected:false,pending:{packageType:'full',fullSeries:'eco',selections:[{position:'front_windscreen',series:'eco',vlt:'70%',price:100}],extras:[],discount:0,finalTotal:100},addons:[],booking:{mode:'none'}};
const saved=(await q("select garage_sale_confirmation('sales','confirm','new-sale-after-review-01',$1) r",[newSale])).r;
assert.equal(saved.state,'saved');
const otherJob=(await q('select id from garage_installer_jobs where invoice_id=$1',[saved.invoiceId])).id;
const otherPiece=(await q('select id from garage_tint_installation_pieces where invoice_id=$1',[saved.invoiceId])).id;
async function other(actor,action,extra={}){const sn=(await q('select garage_installation_workflow($1,$2,$3) r',[actor,'snapshot',{jobId:otherJob}])).r;return (await q('select garage_installation_workflow($1,$2,$3) r',[actor,action,{jobId:otherJob,revision:sn.review.revision,requestId:'other-request-'+String(++serial).padStart(5,'0'),value:true,...extra}])).r;}
await other('i1','claim',{itemId:otherPiece});await other('i1','complete',{itemId:otherPiece});await other('i1','confirm');await other('head','head_approve');
await db.exec('begin');await other('director','pay',{value:'cash'});assert.equal((await q('select work_status from garage_invoices where id=$1',[saved.invoiceId])).work_status,'sales_inspection');await db.exec('rollback');
await other('sales','sales_return',{reason:'Sample defect'});await other('head','pay',{value:'cash'});assert.equal((await q('select work_status from garage_invoices where id=$1',[saved.invoiceId])).work_status,'head_correction_review');
await db.exec('begin read only');await q("select garage_installation_workflow('head','snapshot',$1)",[{jobId:otherJob}]);await db.exec('commit');
console.log('PASS: atomic sale creation after lockdown, payment during both inspection stages, existing manager finance permissions, read-only snapshots.');
await db.exec('set role anon');
for(const sql of ["select approve_garage_installation('job','head',true,null)","select garage_installation_workflow('head','head_approve','{}')","select garage_lifecycle_begin()","select garage_work_status_from_facts('inv')","select mark_garage_work_order_paid('inv','sales','cash')","update garage_installer_jobs set approved_by='head' where id='job'","update garage_invoices set created_by='i1' where id='inv'","delete from garage_invoices where id='inv'", "update garage_invoices set receipt_path='fake' where id='inv'"])await assert.rejects(()=>db.exec(sql),/permission denied/);
await db.exec('reset role');
console.log('PASS: individual confirmations, automatic Head queue, Head-only approval, salesman inspection, correction to original installer, repeat/stale actions, delivery gate, anonymous bypass denial.');

await db.exec(readFileSync(new URL('../supabase/migrations/20261026000000_garage_vehicle_glass_layout.sql',import.meta.url),'utf8'));
const positions=(layout)=>{const result=[];if(layout.body==='bus'||layout.body==='van'){result.push('front_windscreen','front_left_window','front_right_window');for(let n=1;n<=layout.sideRows;n++)result.push('side_left_'+n,'side_right_'+n);result.push('rear_windscreen');}else result.push('front_windscreen','front_left_window','front_right_window',...(layout.body==='coupe'?[]:['rear_left_window','rear_right_window']),'rear_left_panel_window','rear_right_panel_window','rear_windscreen');if(layout.roof==='split')result.push('front_roof_glass','rear_roof_glass');else if(layout.roof==='single')result.push('front_roof_glass');else if(layout.roof==='panoramic')result.push('panoramic_roof_glass');return result;};
for(const layout of [{body:'bus',roof:'none',sideRows:10},{body:'van',roof:'split',sideRows:6},{body:'suv',roof:'panoramic',sideRows:0},{body:'coupe',roof:'single',sideRows:0}]){const selections=positions(layout).map(position=>({position,series:'eco',vlt:'35%',price:position.includes('roof')?75:0}));const payload={...newSale,pending:{...newSale.pending,vehicleLayout:layout,selections,agreedBase:1200,finalTotal:1350}};const request='layout-sale-request-'+String(++serial).padStart(5,'0');const first=(await q("select garage_sale_confirmation('sales','confirm',$1,$2) r",[request,payload])).r;assert.equal(first.state,'saved');assert.deepEqual((await q('select vehicle_layout from garage_tint_orders where invoice_id=$1',[first.invoiceId])).vehicle_layout,layout);assert.equal(Number((await q('select count(*) n from garage_tint_installation_pieces where invoice_id=$1',[first.invoiceId])).n),selections.length);const replay=(await q("select garage_sale_confirmation('sales','confirm',$1,$2) r",[request,payload])).r;assert.equal(replay.invoiceId,first.invoiceId);}
const layoutBefore=Number((await q('select count(*) n from garage_invoices')).n);
for(const layout of [{body:'bus',roof:'single',sideRows:3},{body:'bus',roof:'none',sideRows:11},{body:'van',roof:'none',sideRows:7},{body:'suv',roof:'none',sideRows:1},{body:'coupe',roof:'none',sideRows:0}]){const payload={...newSale,pending:{...newSale.pending,vehicleLayout:layout,selections:[{position:'rear_left_window',series:'eco',vlt:'35%',price:0}]}};await assert.rejects(()=>q("select garage_sale_confirmation('sales','confirm',$1,$2) r",['bad-layout-request-'+String(++serial).padStart(5,'0'),payload]),/INVALID/);}
assert.equal(Number((await q('select count(*) n from garage_invoices')).n),layoutBefore,'invalid layouts create no partial sales');
console.log('PASS: persisted bus24/van18/SUV roof/coupe selections, atomic/replayed sale, invalid body/roof/rows/positions rejected before creating records.');
await db.close();


