// Disposable local PGlite rehearsal only. Never connects to Supabase.
// node tests/investor-recoveries-db.integration.mjs <path-to-pglite-package>
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


 await db.exec('alter table payments add column recipient_type text;alter table payments add column recipient_id text');
 await db.exec(migration('20261104100000_company_payment_documents.sql'));
 await db.exec(migration('20261104110000_investor_money_documents.sql'));

 await db.exec(migration('20261104120000_investor_staff_claims.sql'));
 await db.exec(migration('20261104121000_investor_claim_invoice_access.sql'));
 await db.exec("insert into garage_building_staff(id,name,username,password,role,business_access) values('s','Staff','staff','discarded','salesperson','used_car'),('peer','Peer','peer','discarded','mechanic','used_car')");

 await db.exec("alter table cars add column assigned_salesperson text;alter table cars add column sales_commission numeric;alter table cars add column is_recon boolean default false;alter table cars add column waive_commission boolean default false;alter table cars add column is_staff_sale boolean default false;alter table cars add column price_floor numeric;alter table cars add column intake_commission numeric;alter table cars add column source_commission numeric;alter table cars add column source_type text;alter table cars add column source_salesman_id text;alter table cars add column external_salesman_id text;alter table cars add column commission_credited_early boolean default false;alter table cars add column commission_credited_month text;alter table cars add column final_deal jsonb;alter table cars add column date_added text default '2026-11-01';alter table payments add column created_at timestamptz;alter table payments add column transferred_at timestamptz;alter table payments add column transferred_by text;alter table payments add column bank_name text;alter table payments add column account_number text;alter table payments add column account_holder text");
 await db.exec("create table customers(id text primary key,interested_car_id text,assigned_sales_id text,commission numeric,cash_work_order jsonb,loan_work_order jsonb,delivered boolean default false,delivered_at text);create table external_salesmen(id text primary key,name text,bank text,bank_account text);insert into users(id,name,role) values('s','Staff','salesperson');insert into external_salesmen values('external','Outside salesperson','Bank','123');insert into cars(id,make,model,status,purchase_price) values('car-low','Toyota','Vios','available',50000),('car-zero','Toyota','Vios','available',50000),('car-missing','Toyota','Vios','available',50000),('car-recon','Toyota','Vios','available',50000),('car-customer','Toyota','Vios','available',50000)");
 await db.exec(migration('20261104130000_investor_commission_bills.sql'));

 await db.exec(migration('20261105010000_investor_sale_recoveries.sql'));
 await db.exec("alter table customers add column name text;update cars set waive_commission=true;insert into customers(id,interested_car_id,assigned_sales_id,commission,cash_work_order,name) values('buyer','car-own','s',0,'{}','Buyer')");
 if(process.argv.includes('--with-trade-ins')){await db.exec(migration('20261105000000_trade_in_funding_choices.sql'));await db.exec(migration('20261105020000_investor_trade_in_application.sql'));}
 let n=0;const req=()=> 'recovery_test_'+String(++n).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cap=(action,data={})=>call('uc_investor_capital','d',action,{...data,requestId:req()});
 const recovery=(actor,action,data={})=>call('uc_investor_recoveries',actor,action,data);
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Bank',openingDate:day,openingCents:0,requestId:req()})).bank;
 const payment=()=>({paidOn:day,bankAccountId:bank.id,bankReference:req()});
 const profile=await cap('create_profile',{name:'Investor'}),potId=profile.potId;await cap('link_account',{potId,staffId:'i'});await cap('capital_received',{potId,amountCents:50000000,...payment()});
 const carId='car-own';await cap('fund_car',{potId,carId,purchaseCents:5000000});
 const purchase={};for(const kind of ['invoice','payment']){const d=await call('uc_investor_money_evidence','d','prepare',{target:'purchase',carId,kind,amountCents:5000000,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_investor_money_evidence','d','confirm',{documentId:d.documentId});purchase[kind]=d.documentId;}
 await cap('purchase_paid',{carId,invoiceDocumentId:purchase.invoice,receiptDocumentId:purchase.payment,...payment()});await cap('agree_sale',{carId,amountCents:7000000});
 const receiptProof=async(orderId)=>{const d=await recovery('d','proof_prepare',{orderId,fileName:'bank.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await assert.rejects(()=>recovery('d','proof_confirm',{documentId:d.documentId}),/UPLOAD_MISSING/);await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await recovery('d','proof_confirm',{documentId:d.documentId});return d.documentId;};
 const deposit=await recovery('d','prepare_receipt',{carId,amountCents:500000,...payment(),requestId:req()});const depositDoc=await receiptProof(deposit.orderId);await recovery('d','post',{orderId:deposit.orderId,documentId:depositDoc,requestId:req()});
 const fee=await cap('add_car_bill',{carId,category:'invoicing',purpose:'Bank processing fee',payee:'Bank',amountCents:100000});
 const invoice=await call('uc_investor_activation','d','proof_prepare',{billId:fee.billId,kind:'bill',fileName:'fee.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[invoice.path]);await call('uc_investor_activation','d','proof_confirm',{documentId:invoice.documentId});await cap('approve_car_bill',{carId,billId:fee.billId});
 const receiptData={carId,amountCents:7400000,withheldBills:[{billId:fee.billId,amountCents:100000}],excessCents:1000000,customerId:'buyer',...payment(),requestId:req()};
 const prepared=await recovery('d','prepare_receipt',receiptData);assert.equal((await recovery('d','prepare_receipt',receiptData)).orderId,prepared.orderId);await assert.rejects(()=>recovery('d','prepare_receipt',{...receiptData,amountCents:7400001}),/REQUEST_CHANGED/);
 await assert.rejects(()=>recovery('d','post',{orderId:prepared.orderId,documentId:depositDoc,requestId:req()}),/PAYMENT_RECEIPT_REQUIRED/);
 const documentId=await receiptProof(prepared.orderId),post={orderId:prepared.orderId,documentId,requestId:req()};await recovery('d','post',post);await recovery('d','post',post);
 const summary=(await db.query('select uc_investor_car_summary($1) value',[carId])).rows[0].value;
 assert.equal(summary.receivedCents,7000000);assert.equal(summary.actualReceivedCents,7900000);assert.equal(summary.unpaidBillCents,0);assert.equal(summary.costCents,100000);assert.equal(summary.refundOwingCents,1000000);
 const position=(await db.query('select uc_investor_position($1) value',[potId])).rows[0].value;assert.equal(position.cashCents,52900000);assert.equal(position.customerRefundReservedCents,1000000);assert.equal(position.availableCents,50000000);
 const own=await call('uc_investor_capital','i','car_snapshot',{carId});assert.equal(own.bills[0].paidCents,100000);assert.equal(own.bills[0].withheldCents,100000);
 await assert.rejects(()=>cap('void_car_bill',{carId,billId:fee.billId,note:'Wrong fee'}),/PAID_BILL_ADJUSTMENT_REQUIRED/);
 await assert.rejects(()=>cap('pay_car_bill',{carId,billId:fee.billId,amountCents:1,receiptDocumentId:documentId,...payment()}),/PAYMENT_EXCEEDS_BALANCE/);
 await cap('settle_car',{carId,confirmCosts:true});
 const refund=await recovery('d','prepare_refund',{carId,customerId:'buyer',amountCents:600000,bankName:'Customer bank',accountNumber:'123456',accountHolder:'Buyer',note:'Return overloan',requestId:req()});
 await assert.rejects(()=>recovery('d','prepare_refund',{carId,customerId:'buyer',amountCents:500000,bankName:'Bank',accountNumber:'123456',accountHolder:'Buyer',note:'Return overloan',requestId:req()}),/REFUND_EXCEEDS_BALANCE/);
 const refundDoc=await receiptProof(refund.orderId),refundPost={orderId:refund.orderId,documentId:refundDoc,...payment(),requestId:req()};await recovery('d','post',refundPost);await recovery('d','post',refundPost);
 const after=(await db.query('select uc_investor_position($1) value',[potId])).rows[0].value;assert.equal(after.customerRefundReservedCents,400000);assert.equal(after.availableCents,50760000);assert.equal(after.cashCents,51160000);
 assert.equal((await recovery('i','snapshot',{carId})).refundOwingCents,400000);await assert.rejects(()=>recovery('other','snapshot',{carId}),/NOT_ALLOWED/);await assert.rejects(()=>recovery('a','snapshot',{carId}),/NOT_ALLOWED/);

 const privateView=await recovery('i','snapshot',{carId}),directorView=await recovery('d','snapshot',{carId});
 assert.equal(privateView.orders.find(o=>o.id===refund.orderId).recipientAccount,null);assert.equal(privateView.orders.find(o=>o.id===refund.orderId).accountLast4,'3456');
 assert.equal(directorView.orders.find(o=>o.id===refund.orderId).recipientAccount,'123456');assert.equal(directorView.refundCustomers[0].name,'Buyer');
 const waiting=await recovery('d','prepare_refund',{carId,customerId:'buyer',amountCents:400000,bankName:'Bank',accountNumber:'654321',accountHolder:'Buyer',note:'Remaining refund',requestId:req()});
 await assert.rejects(()=>recovery('d','cancel',{orderId:waiting.orderId,note:'',requestId:req()}),/REASON_REQUIRED/);
 await recovery('d','cancel',{orderId:waiting.orderId,note:'Bank details need checking',requestId:req()});
 const cancelled=(await recovery('d','snapshot',{carId})).orders.find(o=>o.id===waiting.orderId);assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.cancelledBy,'Director');
 const replacement=await recovery('d','prepare_refund',{carId,customerId:'buyer',amountCents:400000,bankName:'Bank',accountNumber:'654321',accountHolder:'Buyer',note:'Corrected refund',requestId:req()});assert.ok(replacement.orderId);
 await assert.rejects(()=>cap('sale_received',{carId,amountCents:1,...payment()}),/SALE_RECEIPT_REQUIRED/);
 await assert.rejects(()=>recovery('i','prepare_refund',{carId,customerId:'buyer',amountCents:1,requestId:req()}),/NOT_ALLOWED/);

 // A deduction can cover the sale with no bank deposit. It is not a zero-value
 // cash movement, and the full loss still belongs to the investor.
 const lossCar='car-zero';await cap('fund_car',{potId,carId:lossCar,purchaseCents:5000000});
 const lossProofs={};for(const kind of ['invoice','payment']){const doc=await call('uc_investor_money_evidence','d','prepare',{target:'purchase',carId:lossCar,kind,amountCents:5000000,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[doc.path]);await call('uc_investor_money_evidence','d','confirm',{documentId:doc.documentId});lossProofs[kind]=doc.documentId;}
 await cap('purchase_paid',{carId:lossCar,invoiceDocumentId:lossProofs.invoice,receiptDocumentId:lossProofs.payment,...payment()});await cap('agree_sale',{carId:lossCar,amountCents:100000});
 const lossFee=await cap('add_car_bill',{carId:lossCar,category:'invoicing',purpose:'Withheld bank fee',payee:'Bank',amountCents:100000});
 const lossInvoice=await call('uc_investor_activation','d','proof_prepare',{billId:lossFee.billId,kind:'bill',fileName:'bank-fee.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[lossInvoice.path]);await call('uc_investor_activation','d','proof_confirm',{documentId:lossInvoice.documentId});await cap('approve_car_bill',{carId:lossCar,billId:lossFee.billId});
 const zero=await recovery('d','prepare_receipt',{carId:lossCar,amountCents:0,withheldBills:[{billId:lossFee.billId,amountCents:100000}],...payment(),requestId:req()});const zeroProof=await receiptProof(zero.orderId);await recovery('d','post',{orderId:zero.orderId,documentId:zeroProof,requestId:req()});
 const zeroSummary=(await db.query('select uc_investor_car_summary($1) value',[lossCar])).rows[0].value;assert.equal(zeroSummary.receivedCents,100000);assert.equal(zeroSummary.actualReceivedCents,0);assert.equal(zeroSummary.unpaidBillCents,0);
 assert.equal((await db.query("select count(*) n from uc_investor_cash_entries where car_id=$1 and kind='car_sale'",[lossCar])).rows[0].n,0);
 await cap('settle_car',{carId:lossCar,confirmCosts:true});const loss=(await db.query('select * from uc_investor_car_settlements where car_id=$1',[lossCar])).rows[0];assert.equal(loss.company_profit_cents,0);assert.equal(loss.investor_result_cents,-5000000);
 const count=(await db.query("select count(*) n from uc_investor_cash_entries where kind='customer_refund_out'")).rows[0].n;assert.equal(count,1);
 const bad=(await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n;assert.equal(bad,0);
 console.log('PASS sale recoveries: actual net cash once, gross recovery, withheld bill clearance without fake cash, reserved overloan, partial proof-backed refund, profit and ACL');
}finally{await db.close();}
