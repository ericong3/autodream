// Disposable local database only. Reproduces production types/checks/triggers.
// Older dealer payouts (made before the reviewed consignment workflow) are
// prepared once, then paid through the normal company bank payment screen.
// node tests/dealer-legacy-payouts-db.integration.mjs <path-to-pglite-package>
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {productionFinanceFixture} from './helpers/production-finance-fixture.mjs';
const db=await productionFinanceFixture(process.argv[2]);
try{
 const password=bcrypt.hashSync('Disposable-test-only',10);
 for(const [id,role] of [['d','director'],['i','investor']]){await db.query("insert into users(id,name,username,password,role,business_access) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end)",[id,password,role]);await db.query("insert into garage_building_staff(id,name,username,password,role,business_access,registration_status,enabled) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end,'active',true)",[id,password,role]);}
 let serial=0;const req=()=>'dealer_legacy_'+String(++serial).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const dealer=(action,data={})=>call('uc_dealer_account','d',action,{...data,requestId:req()});
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const n=async sql=>Number((await db.query(sql)).rows[0].n);

 const potId=(await call('uc_investor_capital','d','create_profile',{name:'Ting Ping Liang',requestId:req()})).potId;
 await call('uc_investor_capital','d','link_account',{potId,staffId:'i',requestId:req()});
 await db.query("insert into dealers(id,name,bank_name,bank_account_number,bank_account_holder) values('2tn','2TN','Maybank','5123456789','2TN AUTO WORLD SDN BHD')");
 await db.query(`insert into cars(id,make,model,year,status,consignment,selling_price,money_received,date_added) values
  ('c1','Toyota','Vios',2020,'delivered','{"dealer":"2TN"}',50000,true,'2026-10-01'),('c2','Honda','City',2020,'delivered','{"dealer":"2TN"}',90000,true,'2026-10-02')`);
 await db.exec("set session_replication_role=replica");
 await db.query(`insert into payments(id,type,car_id,recipient_type,recipient_id,recipient_name,amount,status,created_at,description) values
  ('p1','consignment_payout','c1','dealer','2tn','2TN',30000,'pending','2026-10-06','older payout'),
  ('p2','consignment_payout','c2','dealer','2tn','2TN',80000,'pending','2026-10-07','older payout')`);
 await db.exec("set session_replication_role=origin");
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Company bank',openingDate:day,openingCents:20000000,requestId:req()})).bank;
 const evidence=async(paymentId,kind)=>{const doc=await call('uc_company_evidence','d','prepare',{paymentId,kind,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++serial).toString(16).padStart(64,'0'),requestId:req()});
  await db.query("insert into storage.objects(bucket_id,name) values('finance-evidence',$1)",[doc.path]);await call('uc_company_evidence','d','confirm',{documentId:doc.documentId});return doc.documentId;};
 const payBank=async(paymentId,amountCents)=>call('uc_company_bank_money','d','record',{paidOn:day,bankAccountId:bank.id,bankReference:req(),allocations:[{paymentId,amountCents,documentId:await evidence(paymentId,'payment')}],requestId:req()});

 // Before preparing, the bank payment screen refuses older payouts.
 await evidence('p1','invoice');
 await assert.rejects(()=>payBank('p1',1000000),/PAYMENT_WORKFLOW_REQUIRED/);
 let view=await dealer('link',{dealerId:'2tn',potId});
 assert.equal(view.totals.needsPreparingCount,2);assert.equal(view.totals.needsPreparingCents,11000000);
 assert.ok(view.payouts.every(p=>p.needsPreparing&&!p.bankReady));

 // Lock RM 10,000 first: an unprepared payout is cleared from the opening review.
 await dealer('confirm_costs',{dealerId:'2tn',paymentId:'p1'});await dealer('save_draft',{dealerId:'2tn',targetCents:1000000,paymentIds:['p1']});
 view=await dealer('lock_draft',{dealerId:'2tn',convertedOn:day,note:'Kept as investment before preparing'});
 assert.equal(view.totals.needsPreparingCents,10000000);

 // Prepare: each unpaid balance becomes a bill. Running it again adds nothing.
 view=await dealer('prepare_payouts',{dealerId:'2tn'});
 assert.equal(view.totals.needsPreparingCount,0);assert.ok(view.payouts.every(p=>p.bankReady&&!p.needsPreparing));
 assert.equal(view.totals.owedCents,10000000,'Preparing does not change what is owed');
 const bills=(await db.query("select lines from journal_entries where source_id like 'dealer-legacy-payout:%' order by source_id")).rows;
 assert.deepEqual(bills.map(b=>b.lines.map(l=>[l.accountId,Number(l.debit),Number(l.credit)])),[
  [['acct-opening-review',20000,0],['acct-ap',0,20000]],[['acct-opening-review',80000,0],['acct-ap',0,80000]]]);
 await dealer('prepare_payouts',{dealerId:'2tn'});
 assert.equal(await n("select count(*) n from journal_entries where source_id like 'dealer-legacy-payout:%'"),2);
 assert.equal(await n('select count(*) n from uc_bank_movements'),0,'Preparing moves no money');

 // Now the normal bank payment works, never more than the remaining bill.
 await assert.rejects(()=>payBank('p1',2000001),/PAYMENT_EXCEEDS_BALANCE/);
 const paid=await payBank('p1',2000000);
 assert.equal(paid.payments[0].status,'transferred');
 view=await dealer('view',{dealerId:'2tn'});
 assert.equal(view.payouts.find(p=>p.paymentId==='p1').balanceCents,0);assert.equal(view.totals.owedCents,8000000);
 const out=(await db.query("select lines from journal_entries where id like 'company-bank:%'")).rows[0].lines;
 assert.deepEqual(out.map(l=>[l.accountId.startsWith('acct-bank-uc-')?'bank':l.accountId,Number(l.debit),Number(l.credit)]),[['acct-ap',20000,0],['bank',0,20000]]);

 // A lock after preparing clears the payable instead of the opening review.
 await dealer('confirm_costs',{dealerId:'2tn',paymentId:'p2'});await dealer('save_draft',{dealerId:'2tn',targetCents:3000000,paymentIds:['p2']});
 await dealer('lock_draft',{dealerId:'2tn',convertedOn:day,note:'Second lock after preparing'});
 const lock=(await db.query("select lines from journal_entries where source_id like 'dealer-conversion:%' order by created_at desc, id desc limit 1")).rows[0].lines;
 assert.deepEqual(lock.map(l=>[l.accountId,Number(l.debit),Number(l.credit)]),[['acct-ap',30000,0],['acct-investor-payable',0,30000]]);
 await evidence('p2','invoice');
 await assert.rejects(()=>payBank('p2',5000001),/PAYMENT_EXCEEDS_BALANCE/,'Bank cannot pay what was locked');
 const rest=await payBank('p2',5000000);assert.equal(rest.payments[0].status,'transferred');
 assert.equal((await dealer('view',{dealerId:'2tn'})).totals.owedCents,0);

 // Prepared payouts are fixed and their bill records permanent.
 await assert.rejects(()=>db.query("update payments set amount=1 where id='p2'"),/BANK_PAYMENT_IMMUTABLE/);
 await assert.rejects(()=>db.query('delete from uc_dealer_legacy_payouts'),/IMMUTABLE|immutable/i);
 await assert.rejects(()=>call('uc_dealer_account','i','prepare_payouts',{dealerId:'2tn',requestId:req()}),/NOT_ALLOWED/);

 // Accounts payable for these payouts nets to zero; every journal balances.
 assert.equal(await n("select coalesce(sum((l->>'credit')::numeric-(l->>'debit')::numeric),0) n from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where l->>'accountId'='acct-ap'"),0);
 assert.equal(await n("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0"),0);
 console.log('PASS older dealer payouts: refused before preparing, one bill per unpaid balance, idempotent, no money moved, bank pays up to the bill, locks clear payables, fixed afterwards, payables net to zero.');
}finally{await db.close();}
