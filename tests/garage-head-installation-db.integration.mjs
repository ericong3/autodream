import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installationFixture} from './installation-fixture.mjs';
const db=await installationFixture(process.argv[2]);
await db.exec(`alter table garage_invoices add column receipt_path text,add column receipt_name text;
 create table garage_building_staff(id text primary key,enabled boolean,registration_status text,role text,business_access text);
 insert into garage_building_staff select id,true,'active',role,'garage' from users;
 update garage_film_stock set remaining_sqft=1000 where series='eco';`);
for(const file of ['20260919030000_garage_film_stock_atomic_adjust.sql','20261025040000_garage_atomic_confirmation.sql','20261025050000_garage_installation_review.sql','20261026000000_garage_vehicle_glass_layout.sql','20261027000000_garage_tint_payment_ledger.sql','20261027010000_garage_tint_usage_history.sql','20261027030000_garage_tint_after_sales.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
await db.exec(`insert into garage_customers(id,name,ic_number,phone,created_by) values('hc','Test only','TEST','0100000000','sales');
 insert into garage_vehicles(id,customer_id,make,model,year,registration_no) values('hv','hc','Test','Car',2026,'TEST');`);
const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0];let serial=0;
const key=()=>`head-trial-request-${++serial}`;
const sale={customerId:'hc',vehicleId:'hv',paymentStatus:'pending',remark:'Disposable test only',receiptExpected:false,
 pending:{vehicleLayout:{body:'sedan',roof:'none',sideRows:0},packageType:'mix',selections:[{position:'front_windscreen',series:'eco',vlt:'70%',price:100}],extras:[],discount:0,finalTotal:100},addons:[],booking:{mode:'none'}};
const saved=(await q("select garage_sale_confirmation('sales','confirm',$1,$2) r",[key(),sale])).r,iid=saved.invoiceId;
const piece=(await q('select id from garage_tint_installation_pieces where invoice_id=$1',[iid])).id;
const act=async(actor,action,data={})=>{
 const snapshot=(await q("select garage_installation_workflow($1,'snapshot',$2) r",[actor,{invoiceId:iid}])).r;
 return(await q('select garage_installation_workflow($1,$2,$3) r',[actor,action,{invoiceId:iid,itemId:piece,revision:snapshot.review.revision,requestId:key(),...data}])).r;
};
await assert.rejects(()=>act('head','claim'),/NOT_ALLOWED/);
const install=readFileSync(new URL('../docs/garage-head-tint-INSTALL-AND-CHECK.sql',import.meta.url),'utf8');
await db.exec(install);await db.exec(install); // Safe repeat installation.
await assert.rejects(()=>act('director','claim'),/NOT_ALLOWED/);
await assert.rejects(()=>act('sales','claim'),/NOT_ALLOWED/);
await db.exec("update garage_building_staff set enabled=false where id='head'");
await assert.rejects(()=>act('head','claim'),/NOT_ALLOWED/);
await db.exec("update garage_building_staff set enabled=true where id='head'");
await act('head','claim');await act('head','release');await act('head','claim');
assert.equal((await q('select installer_id from garage_tint_installation_pieces where id=$1',[piece])).installer_id,'head');
await assert.rejects(()=>act('i1','claim'),/GLASS_ALREADY_TAKEN/);
await assert.rejects(()=>act('i1','sqft',{value:5}),/NOT_ALLOWED/);
await assert.rejects(()=>act('head','complete'),/FILM_USAGE_REQUIRED/);
await act('head','sqft',{value:5});await act('head','remark',{value:'Installed by Garage Head'});
assert.equal(Number((await q("select remaining_sqft from garage_film_stock where series='eco'")).remaining_sqft),995);
assert.equal((await q('select installer_id from garage_tint_usage_attempts where invoice_id=$1',[iid])).installer_id,'head');
await act('head','complete');await act('head','confirm');
assert.equal((await q('select state from garage_installation_reviews where invoice_id=$1',[iid])).state,'head');
await act('head','head_approve',{value:true});await act('sales','sales_approve',{value:true});
assert.equal((await q('select state from garage_installation_reviews where invoice_id=$1',[iid])).state,'ready');
await assert.rejects(()=>act('head','deliver'),/PAYMENT_NOT_VERIFIED/);
for(const fn of ['garage_installation_before_usage_ledger(text,text,jsonb)','claim_garage_glass_item(text,text)']){
 assert.equal((await q("select has_function_privilege('anon',$1,'EXECUTE') allowed",[fn])).allowed,false);
 assert.equal((await q("select has_function_privilege('authenticated',$1,'EXECUTE') allowed",[fn])).allowed,false);
}
await db.close();console.log('PASS: Garage Head claim/release/usage/complete/confirm, ownership, stock attribution, inspections, payment guard and private permissions.');
