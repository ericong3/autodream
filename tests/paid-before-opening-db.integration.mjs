// Disposable local database only. Bills paid before the bank opening date are
// settled with their slip and real date, with no bank movement.
// node tests/paid-before-opening-db.integration.mjs <path-to-pglite-package>
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bcrypt from 'bcryptjs';
import {productionFinanceFixture} from './helpers/production-finance-fixture.mjs';
const db=await productionFinanceFixture(process.argv[2]);
try{
 await db.exec(readFileSync(new URL('../supabase/migrations/20261120000000_paid_before_bank_opening.sql',import.meta.url),'utf8'));
 const password=bcrypt.hashSync('Disposable-test-only',10);
 for(const [id,role] of [['d','director'],['a','admin']]){await db.query("insert into users(id,name,username,password,role,business_access) values($1,$1,$1,$2,$3,'both')",[id,password,role]);await db.query("insert into garage_building_staff(id,name,username,password,role,business_access,registration_status,enabled) values($1,$1,$1,$2,$3,'both','active',true)",[id,password,role]);}
 let n=0;const req=()=>'before_open_'+String(++n).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const money=(actor,action,data={})=>call('uc_company_bank_money',actor,action,data);
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Public Bank',openingDate:day,openingCents:52415109,requestId:req()})).bank;
 await db.exec("insert into cars(id,make,model,year,status,date_added) values('car-1','Toyota','Veloz',2023,'available','2026-09-20')");
 await db.exec("set session_replication_role=replica");
 await db.exec("insert into payments(id,type,status,amount,car_id,recipient_type,recipient_id,recipient_name,created_at) values('old-1','repair','pending',1200,'car-1','workshop','shop','Workshop','2026-09-27'),('old-2','misc_cost','pending',300,'car-1','merchant','m','Parts','2026-09-28')");
 await db.exec("set session_replication_role=origin");
 const doc=async(paymentId,kind)=>{const d=await call('uc_company_evidence','d','prepare',{paymentId,kind,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_company_evidence','d','confirm',{documentId:d.documentId});return d.documentId;};
 const before=Number((await money('d','banks')).banks[0].balanceCents);
 const slip=await doc('old-1','payment');
 const input={paymentId:'old-1',bankAccountId:bank.id,paidOn:'2026-09-26',bankReference:'IBG 26 Sep',notes:'paid before cut-off',documentId:slip,requestId:req()};
 await assert.rejects(()=>money('a','record_before_opening',input),/NOT_ALLOWED/);
 await assert.rejects(()=>money('d','record_before_opening',{...input,paidOn:day}),/AFTER_BANK_OPENING/);
 await assert.rejects(()=>money('d','record_before_opening',input),/SUPPLIER_INVOICE_REQUIRED|BILL_LEDGER_REVIEW_REQUIRED/);
 await doc('old-1','invoice');
 await assert.rejects(()=>money('d','record_before_opening',input),/BILL_LEDGER_REVIEW_REQUIRED/);
 await db.exec("insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('accrue-1','2026-09-27','Repair','repair','old-1','car-1','[{\"accountId\":\"acct-inv-own\",\"debit\":1200,\"credit\":0},{\"accountId\":\"acct-ap\",\"debit\":0,\"credit\":1200}]')");
 const out=await money('d','record_before_opening',input);
 assert.equal(out.amountCents,120000);assert.equal(out.payments[0].status,'transferred');assert.equal(out.payments[0].bank_paid_cents,120000);
 assert.equal(out.journals.length,1);assert.deepEqual(out.journals[0].lines.map(l=>[l.accountId,Number(l.debit),Number(l.credit)]),[['acct-ap',1200,0],['acct-opening-review',0,1200]]);
 assert.equal(out.journals[0].date.slice?.(0,10)??new Date(out.journals[0].date).toISOString().slice(0,10),'2026-09-26');
 // Replay returns the same record; a changed retry is refused.
 assert.equal((await money('d','record_before_opening',input)).beforeOpeningId,out.beforeOpeningId);
 await assert.rejects(()=>money('d','record_before_opening',{...input,notes:'changed'}),/REQUEST_CHANGED/);
 // No bank movement: balance unchanged.
 assert.equal(Number((await money('d','banks')).banks[0].balanceCents),before);
 assert.equal(Number((await db.query("select count(*) n from uc_bank_movements")).rows[0].n),0);
 // Settled once only, and cannot be paid again from the bank.
 await assert.rejects(()=>money('d','record_before_opening',{...input,requestId:req()}),/PAYMENT_EXCEEDS_BALANCE/);
 const slip2=await doc('old-1','payment');
 await assert.rejects(()=>money('d','record',{bankAccountId:bank.id,paidOn:day,bankReference:'second pay',allocations:[{paymentId:'old-1',amountCents:1,documentId:slip2}],requestId:req()}),/PAYMENT_EXCEEDS_BALANCE/);
 // Fixed history.
 await assert.rejects(()=>db.exec("delete from payments where id='old-1'"),/BANK_PAYMENT_IMMUTABLE/);
 await assert.rejects(()=>db.exec("delete from uc_company_before_opening_payments"),/IMMUTABLE|immutable|NOT_ALLOWED/i);
 // A slip cannot be reused for another bill.
 await doc('old-2','invoice');
 await db.exec("insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('accrue-2','2026-09-28','Parts','misc_cost','old-2','car-1','[{\"accountId\":\"acct-inv-own\",\"debit\":300,\"credit\":0},{\"accountId\":\"acct-ap\",\"debit\":0,\"credit\":300}]')");
 await assert.rejects(()=>money('d','record_before_opening',{...input,paymentId:'old-2',requestId:req()}),/PAYMENT_RECEIPT_REQUIRED/);
 const slip3=await doc('old-2','payment');
 await money('d','record_before_opening',{...input,paymentId:'old-2',documentId:slip3,bankReference:'IBG 28 Sep',requestId:req()});
 assert.equal((await db.query("select status from payments where id='old-2'")).rows[0].status,'transferred');
 assert.equal((await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n,0);
 assert.equal((await db.query("select has_function_privilege('anon','uc_company_pay_before_opening(text,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS paid before bank opening: director only, date before opening, invoice/accrual/slip gates, no bank movement, opening-review journal, replay, no double pay, immutable');
}finally{await db.close();}
