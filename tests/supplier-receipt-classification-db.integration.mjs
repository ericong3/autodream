// Disposable production-shaped database; never connects to Supabase.
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {productionFinanceFixture} from './helpers/production-finance-fixture.mjs';
const db=await productionFinanceFixture(process.argv[2]);
try{
 const hash=bcrypt.hashSync('Disposable-local-only',4);
 await db.query("insert into users(id,name,username,password,role,business_access) values('d','Director','d',$1,'director','both')",[hash]);
 await db.query("insert into garage_building_staff(id,name,username,password,role,business_access) values('d','Director','d',$1,'director','both')",[hash]);
 let n=0;const req=()=> 'receipt_classification_'+String(++n).padStart(8,'0');
 const call=async(fn,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',['d',action,data])).rows[0].result;
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','save_bank',{name:'Public Bank test',openingDate:day,openingCents:1000000,requestId:req()})).bank;
 await db.exec("insert into cars(id,make,model,year,status,purchase_price) values('car','Toyota','Vios',2026,'available',50000);insert into repairs(id,car_id,status,actual_cost,total_cost) values('repair','car','done',1000,1000);insert into payments(id,car_id,type,status,amount,repair_job_id,recipient_type,recipient_id,recipient_name) values('bill','car','repair','pending',1000,'repair','workshop','shop','Workshop')");
 await db.exec(`insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('repair-accrual',current_date,'Repair','repair','bill','car','[{"accountId":"acct-inv-own","debit":1000,"credit":0},{"accountId":"acct-ap","debit":0,"credit":1000}]'),('old-deposit',current_date,'Old customer deposit needs later review','legacy_deposit','car','car','[{"accountId":"acct-equity","debit":500,"credit":0},{"accountId":"acct-ar","debit":0,"credit":500}]')`);
 const doc=async(paymentId,kind)=>{const d=await call('uc_company_evidence','prepare',{paymentId,kind,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_company_evidence','confirm',{documentId:d.documentId});return d.documentId;};
 await doc('bill','invoice');const proof=await doc('bill','payment');
 await call('uc_company_bank_money','record',{bankAccountId:bank.id,paidOn:day,bankReference:'Actual supplier payment',requestId:req(),allocations:[{paymentId:'bill',amountCents:100000,documentId:proof}]});
 const invoice=await doc('bill','invoice'),input={paymentId:'bill',amountCents:80000,invoiceDocumentId:invoice,reason:'Supplier issued a credit note'};
 const preview=await call('uc_company_bill_adjustment','preview',input);
 const amended=await call('uc_company_bill_adjustment','apply',{...input,expectedRevision:preview.sourceRevision,requestId:req()});
 const refund=amended.payments.find(p=>p.type==='supplier_credit_collection');assert.ok(refund);
 const before=(await call('uc_company_bank_money','banks')).company.customerHeldCents;
 await call('uc_company_bank_receipt','record',{paymentId:refund.id,amountCents:20000,receiptDocumentId:await doc(refund.id,'payment'),bankAccountId:bank.id,paidOn:day,bankReference:'Actual supplier refund',requestId:req()});
 assert.equal((await db.query("select uc_company_sale_receipt_exists('car') result")).rows[0].result,false);
 assert.equal((await call('uc_company_bank_money','banks')).company.customerHeldCents,before,'Supplier refund must not activate old customer held balances');
 await db.exec(`insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('later-sale',current_date,'Later car sale','car_sold','car','car','[{"accountId":"acct-ar","debit":1000,"credit":0},{"accountId":"acct-rev-car-sales","debit":0,"credit":1000}]');update journal_entries set voided=true where id='later-sale'`);
 assert.equal((await db.query("select voided from journal_entries where id='later-sale'")).rows[0].voided,true,'Supplier refund alone must not freeze a later sale journal');
 await assert.rejects(()=>db.query("update journal_entries set voided=true where id like 'company-receipt:%'"),/BANK_PAYMENT_IMMUTABLE|USE_COMPANY_BANK_PAYMENT/);
 assert.equal((await db.query("select has_function_privilege('anon','uc_company_sale_receipt_exists(text)','EXECUTE') allowed")).rows[0].allowed,false);
 console.log('PASS supplier refund classification: actual bank proof, no customer-deposit activation, no false sale journal freeze, receipt journal remains immutable.');
}finally{await db.close();}
