// Disposable local PGlite rehearsal only. Never connects to Supabase.
// node tests/company-bank-receipts-db.integration.mjs <path-to-pglite-package>
// Investor car bills only: supplier invoice before approval, payment receipt
// before bill money, and investor document reads limited to their own cars.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const root=process.argv[2];if(!root)throw Error('Supply the temporary PGlite package path.');
const {PGlite}=await import(pathToFileURL(resolve(root,'dist/index.js')));const db=new PGlite();
const migration=n=>readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
const REQUIRED_DOCUMENTS='20261104090000_investor_required_documents.sql';
try{
 // storage.objects stands in for the private bucket, so proof_confirm really
 // checks that the file exists. storage.buckets is absent (setup skipped).
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;
 create schema storage;create table storage.objects(bucket_id text not null,name text not null,primary key(bucket_id,name));
 create table garage_building_staff(id text primary key,name text,username text,password text,enabled boolean default true,role text,business_access text);
 create table garage_building_sessions(user_id text);
 create table users(id text primary key,name text,username text,password text,role text,business_access text,phone text,monthly_target numeric,cars_in_month integer);
 create table cars(id text primary key,make text,model text,year integer,car_plate text,photo text,status text,investor_id text,investor_split numeric,trade_in_source_car_id text,purchase_price numeric,consignment jsonb,outgoing_consignment jsonb,misc_costs jsonb default '[]'::jsonb);
 create table repairs(id text primary key,car_id text references cars(id),type_of_repair text,parts jsonb default '[]',labour_cost numeric default 0,total_cost numeric default 0,status text,location text,receipt_photo text,actual_cost numeric,completed_at text,notes text);
 create table payments(id text primary key,car_id text,type text,status text,amount numeric,claim_confirmed_by text,claim_confirmed_at timestamptz,description text,recipient_name text);
 create table payslips(id text primary key,user_id text);
 create table investor_transactions(id text primary key);
 create table bank_transactions(id text primary key);
 create table bank_statement_uploads(id text primary key);
 insert into garage_building_staff(id,name,username,password,role,business_access) values('d','Director','director','discarded','director','both'),('a','Admin','admin','discarded','admin','used_car'),
  ('i','Own investor','investor','discarded','investor','used_car'),('other','Other investor','other','discarded','investor','used_car'),('loner','Unlinked investor','loner','discarded','investor','used_car');
 insert into cars(id,make,model,status,purchase_price) values('car-own','Toyota','Vios','available',50000),('car-rival','Honda','City','available',50000);`);
 // Install order: every prepared investor migration through 080000, then this one.
 await db.exec("select set_config('autodream.private_finance_ready','reviewed-20261104',false)");
 for(const file of ['20260720_ledger_accounts.sql','20260720_journal_entries.sql','20261021010000_autodream_staff_invitations.sql','20261104000000_investor_capital_foundation.sql',
  '20261104010000_investor_car_expenses.sql','20261104020000_investor_activation.sql','20261104030000_investor_journal_integration.sql','20261104040000_private_claim_posting.sql',
  '20261104050000_private_finance_lockdown.sql','20261104060000_investor_car_registration.sql','20261104070000_investor_repair_bills.sql','20261104080000_investor_misc_bills.sql',
  REQUIRED_DOCUMENTS])await db.exec(migration(file));


 await db.exec('alter table payments add column if not exists recipient_type text;alter table payments add column if not exists recipient_id text');
 await db.exec(migration('20261104100000_company_payment_documents.sql'));
 await db.exec(migration('20261104110000_investor_money_documents.sql'));

 await db.exec(migration('20261104120000_investor_staff_claims.sql'));
 await db.exec(migration('20261104121000_investor_claim_invoice_access.sql'));
 await db.exec("insert into garage_building_staff(id,name,username,password,role,business_access) values('s','Staff','staff','discarded','salesperson','used_car'),('peer','Peer','peer','discarded','mechanic','used_car')");

 await db.exec("alter table cars add column if not exists assigned_salesperson text;alter table cars add column if not exists sales_commission numeric;alter table cars add column if not exists is_recon boolean default false;alter table cars add column if not exists waive_commission boolean default false;alter table cars add column if not exists is_staff_sale boolean default false;alter table cars add column if not exists price_floor numeric;alter table cars add column if not exists intake_commission numeric;alter table cars add column if not exists source_commission numeric;alter table cars add column if not exists source_type text;alter table cars add column if not exists source_salesman_id text;alter table cars add column if not exists external_salesman_id text;alter table cars add column if not exists commission_credited_early boolean default false;alter table cars add column if not exists commission_credited_month text;alter table cars add column if not exists final_deal jsonb;alter table cars add column if not exists date_added text default '2026-11-01';alter table payments add column if not exists created_at timestamptz;alter table payments add column if not exists transferred_at timestamptz;alter table payments add column if not exists transferred_by text;alter table payments add column if not exists bank_name text;alter table payments add column if not exists account_number text;alter table payments add column if not exists account_holder text");
 await db.exec("create table customers(id text primary key,interested_car_id text,assigned_sales_id text,commission numeric,cash_work_order jsonb,loan_work_order jsonb,delivered boolean default false,delivered_at text);create table external_salesmen(id text primary key,name text,bank text,bank_account text);insert into users(id,name,role) values('s','Staff','salesperson');insert into external_salesmen values('external','Outside salesperson','Bank','123');insert into cars(id,make,model,status,purchase_price) values('car-low','Toyota','Vios','available',50000),('car-zero','Toyota','Vios','available',50000),('car-missing','Toyota','Vios','available',50000),('car-recon','Toyota','Vios','available',50000),('car-customer','Toyota','Vios','available',50000)");
 await db.exec(migration('20261104130000_investor_commission_bills.sql'));

 await db.exec(migration('20261105010000_investor_sale_recoveries.sql'));
 await db.exec("alter table customers add column if not exists name text;update cars set waive_commission=true;insert into customers(id,interested_car_id,assigned_sales_id,commission,cash_work_order,name) values('buyer','car-own','s',0,'{}','Buyer')");

 await db.exec(migration('20261105000000_trade_in_funding_choices.sql'));await db.exec(migration('20261105020000_investor_trade_in_application.sql'));
 await db.exec("alter table cars add column if not exists settlement_amount numeric;update cars set waive_commission=true;update cars set trade_in_source_car_id='car-own',purchase_price=40000,settlement_amount=0 where id='car-rival';update cars set trade_in_source_car_id='car-own',purchase_price=10000,settlement_amount=0 where id='car-zero'");

 await db.exec("alter table payments add column if not exists notes text;alter table payments add column if not exists receipt_url text;alter table payments add column if not exists description text;alter table payments add column if not exists recipient_name text;alter table payments add column if not exists claim_confirmed_at timestamptz");
 await db.exec(migration('20261105030000_company_bank_payments.sql'));

 await db.exec(migration('20261105040000_investor_trade_in_lenders.sql'));
 await db.exec("alter table cars add column if not exists money_received boolean default false;alter table cars add column if not exists disbursement_status text;alter table cars add column if not exists disbursement_amount numeric;alter table cars add column if not exists disbursement_expected_amount numeric;alter table cars add column if not exists disbursement_date text;alter table customers add column if not exists name text");
 await db.exec(migration('20261105050000_company_bank_receipts.sql'));
 let n=0;const req=()=> 'company_receipt_'+String(++n).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const record=data=>call('uc_company_bank_receipt','d','record',data);
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Bank',openingDate:day,openingCents:0,requestId:req()})).bank;
 const payment=()=>({paidOn:day,bankAccountId:bank.id,bankReference:req()});
 await db.exec("insert into customers(id,name,interested_car_id) values('buyer','Buyer','car-own') on conflict(id) do update set name=excluded.name;insert into payments(id,type,status,amount,car_id,recipient_type,recipient_id,recipient_name) values('loan','loan_disbursement','pending',70000,'car-own','customer','car-own','Bank'),('fee','misc_cost','pending',1000,'car-own','merchant','bank','Bank')");
 const doc=async(paymentId,kind)=>{const d=await call('uc_company_evidence','d','prepare',{paymentId,kind,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_company_evidence','d','confirm',{documentId:d.documentId});return d.documentId;};
 await assert.rejects(()=>record({paymentId:'loan',amountCents:500000,receiptDocumentId:'11111111-1111-4111-8111-111111111111',...payment(),requestId:req()}),/PAYMENT_RECEIPT_REQUIRED/);assert.equal((await db.query('select count(*) n from uc_company_bank_receipts')).rows[0].n,0);
 const firstDoc=await doc('loan','payment');const first=await record({paymentId:'loan',amountCents:500000,receiptDocumentId:firstDoc,...payment(),requestId:req()});assert.equal(first.payments[0].status,'pending');assert.equal(first.payments[0].bank_paid_cents,500000);assert.equal(first.car.money_received,false);assert.equal(first.car.disbursement_status,'processing');
 await db.exec("insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('fee-source',current_date,'Fee','misc_cost','fee','car-own','[{\"accountId\":\"acct-inv-own\",\"debit\":1000,\"credit\":0},{\"accountId\":\"acct-ap\",\"debit\":0,\"credit\":1000}]')");await doc('fee','invoice');const feeProof=await doc('fee','payment'),mainProof=await doc('loan','payment');
 const body={paymentId:'loan',amountCents:7400000,withheldBills:[{paymentId:'fee',amountCents:100000,documentId:feeProof}],excessCents:1000000,customerId:'buyer',receiptDocumentId:mainProof,...payment(),requestId:req()};
 const result=await record(body);assert.equal((await record(body)).receiptId,result.receiptId);await assert.rejects(()=>record({...body,amountCents:7400001}),/REQUEST_CHANGED/);
 const loan=result.payments.find(p=>p.id==='loan'),fee=result.payments.find(p=>p.id==='fee'),refund=result.payments.find(p=>p.type==='customer_refund');assert.equal(loan.status,'transferred');assert.equal(loan.bank_paid_cents,7000000);assert.equal(fee.status,'transferred');assert.equal(fee.bank_paid_cents,100000);assert.equal(refund.amount,10000);assert.equal(refund.recipient_id,'buyer');assert.equal(refund.status,'pending');
 assert.equal(result.car.disbursement_amount,79000);assert.equal(result.car.money_received,true);assert.equal((await db.query('select uc_registered_bank_position($1) cents',[bank.id])).rows[0].cents,7900000);assert.equal((await db.query('select count(*) n from uc_bank_movements')).rows[0].n,2);
 const balance=await call('uc_company_bank_receipt','a','balance',{carId:result.car.id});assert.deepEqual(Object.keys(balance).sort(),['carId','customerCoveredCents','loanCoveredCents']);assert.equal(balance.loanCoveredCents,7000000);
 assert.deepEqual(await call('uc_company_bank_receipt','s','balance',{carId:result.car.id}),balance);
 await assert.rejects(()=>call('uc_company_bank_receipt','s','balance',{carId:'car-low'}),/NOT_ALLOWED/);
 await assert.rejects(()=>call('uc_company_bank_receipt','a','balance',{carId:result.car.id,paymentId:'salary'}),/INVALID/);
 const history=await call('uc_company_bank_money','a','history',{paymentId:'loan'});assert.equal(history.entries.length,2);assert.equal(history.entries[1].kind,'received');const feeHistory=await call('uc_company_bank_money','a','history',{paymentId:'fee'});assert.equal(feeHistory.entries[0].kind,'deducted');
 await assert.rejects(()=>record({...body,requestId:req(),...payment()}),/PAYMENT_EXCEEDS_BALANCE/);await assert.rejects(()=>call('uc_company_bank_receipt','a','record',body),/NOT_ALLOWED/);

 const refundProof=await doc(refund.id,'payment');await call('uc_company_bank_money','d','record',{bankAccountId:bank.id,paidOn:day,bankReference:req(),allocations:[{paymentId:refund.id,amountCents:1000000,documentId:refundProof}],requestId:req()});
 assert.equal((await db.query('select uc_registered_bank_position($1) cents',[bank.id])).rows[0].cents,6900000);
 const month=(await call('uc_company_bank_money','d','month',{})).month;assert.equal(month.receivedCents,7900000);assert.equal(month.paidCents,1000000);await assert.rejects(()=>call('uc_company_bank_money','a','month',{}),/NOT_ALLOWED/);
 // Fully withheld loan settlement has no physical-bank row at all.
 await db.exec("insert into payments(id,type,status,amount,car_id,recipient_type,recipient_id,recipient_name) values('loan2','loan_disbursement','pending',1000,'car-low','customer','car-low','Bank'),('fee2','misc_cost','pending',1000,'car-low','merchant','bank','Bank')");
 await db.exec("insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('fee2-source',current_date,'Fee','misc_cost','fee2','car-low','[{\"accountId\":\"acct-inv-own\",\"debit\":1000,\"credit\":0},{\"accountId\":\"acct-ap\",\"debit\":0,\"credit\":1000}]')");await doc('fee2','invoice');const zeroDoc=await doc('loan2','payment'),zeroFeeDoc=await doc('fee2','payment');
 const count=(await db.query('select count(*) n from uc_bank_movements')).rows[0].n;await record({paymentId:'loan2',amountCents:0,withheldBills:[{paymentId:'fee2',amountCents:100000,documentId:zeroFeeDoc}],receiptDocumentId:zeroDoc,...payment(),requestId:req()});assert.equal((await db.query('select count(*) n from uc_bank_movements')).rows[0].n,count);
 // An old cash sale already debited the generic bank: reclassify it once.
 await db.exec("insert into payments(id,type,status,amount,car_id,recipient_type,recipient_id,recipient_name) values('cash','customer_collection','pending',1000,'car-customer','customer','buyer','Buyer');insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('old-cash-sale',current_date,'Sale','car_sold','car-customer','car-customer','[{\"accountId\":\"acct-bank-operating\",\"debit\":1000,\"credit\":0},{\"accountId\":\"acct-rev-car-sales\",\"debit\":0,\"credit\":1000}]')");const cashDoc=await doc('cash','payment');const cash=await record({paymentId:'cash',amountCents:100000,receiptDocumentId:cashDoc,...payment(),requestId:req()});assert.ok(cash.journals[0].lines.some(l=>l.accountId==='acct-bank-operating'&&l.credit===1000));
 await assert.rejects(()=>db.exec("update journal_entries set voided=true where id='old-cash-sale'"),/BANK_PAYMENT_IMMUTABLE/);
 await db.exec("insert into payments(id,type,status,amount,car_id,recipient_type,recipient_id,recipient_name) values('old-loan','loan_disbursement','pending',1000,'car-missing','customer','car-missing','Bank');update cars set money_received=true where id='car-missing'");const oldDoc=await doc('old-loan','payment');await assert.rejects(()=>record({paymentId:'old-loan',amountCents:100000,receiptDocumentId:oldDoc,...payment(),requestId:req()}),/COLLECTION_HISTORY_REVIEW_REQUIRED/);
 const books=(await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n;assert.equal(books,0);
 console.log('PASS company receipts: partial loan balance, one actual net bank movement, invoice-backed withholding, customer excess liability, immutable replay, audit and ACL');
}finally{await db.close();}
