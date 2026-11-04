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

 await db.exec(migration('20261105000000_trade_in_funding_choices.sql'));await db.exec(migration('20261105020000_investor_trade_in_application.sql'));
 await db.exec("alter table cars add column settlement_amount numeric;update cars set waive_commission=true;update cars set trade_in_source_car_id='car-own',purchase_price=40000,settlement_amount=0 where id='car-rival';update cars set trade_in_source_car_id='car-own',purchase_price=10000,settlement_amount=0 where id='car-zero'");

 await db.exec("alter table payments add column if not exists notes text;alter table payments add column if not exists receipt_url text;alter table payments add column if not exists description text;alter table payments add column if not exists recipient_name text;alter table payments add column if not exists claim_confirmed_at timestamptz");
 await db.exec(migration('20261105030000_company_bank_payments.sql'));

 await db.exec(migration('20261105040000_investor_trade_in_lenders.sql'));
 await db.exec("update cars set trade_in_source_car_id='car-own',purchase_price=40000,settlement_amount=10000 where id='car-rival';update cars set waive_commission=true");
 let n=0;const req=()=> 'lender_test_'+String(++n).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cap=(action,data={})=>call('uc_investor_capital','d',action,{...data,...(action==='car_snapshot'?{}:{requestId:req()})});
 const loan=(actor,action,data={})=>call('uc_trade_in_lender_money',actor,action,data);
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Bank',openingDate:day,openingCents:0,requestId:req()})).bank;
 const bankData=()=>({paidOn:day,bankAccountId:bank.id,bankReference:req()});
 const profile=await cap('create_profile',{name:'Investor'}),potId=profile.potId;await cap('link_account',{potId,staffId:'i'});await cap('capital_received',{potId,amountCents:50000000,...bankData()});
 const carId='car-own';await cap('fund_car',{potId,carId,purchaseCents:5000000});
 const purchase={};for(const kind of ['invoice','payment']){const d=await call('uc_investor_money_evidence','d','prepare',{target:'purchase',carId,kind,amountCents:5000000,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_investor_money_evidence','d','confirm',{documentId:d.documentId});purchase[kind]=d.documentId;}
 await cap('purchase_paid',{carId,invoiceDocumentId:purchase.invoice,receiptDocumentId:purchase.payment,...bankData()});await cap('agree_sale',{carId,amountCents:7000000});
 const choice=(await call('uc_trade_in_funding','d','choose',{incomingCarId:'car-rival',fundingKind:'investor',potId,investorBasisPoints:4000,requestId:req()})).choice;
 const inv=await call('uc_apply_investor_trade_in','d','proof_prepare',{choiceId:choice.id,fileName:'purchase.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0')});await db.query("insert into storage.objects values('finance-evidence',$1)",[inv.path]);await call('uc_apply_investor_trade_in','d','proof_confirm',{documentId:inv.documentId});await call('uc_apply_investor_trade_in','d','apply',{choiceId:choice.id,documentId:inv.documentId,requestId:req()});
 const incoming=await cap('car_snapshot',{carId:'car-rival'}),applicationId=incoming.tradeInApplicationId;assert.ok(applicationId);assert.equal(incoming.purchaseCents,4000000);assert.equal(incoming.purchasePaidCents,3000000);assert.equal(incoming.state,'reserved');assert.equal(incoming.lenderCents,1000000);assert.equal((await cap('car_snapshot',{carId})).receivedCents,3000000);
 const position=async()=>(await db.query('select uc_investor_position($1) value',[potId])).rows[0].value;
 const before=await position();assert.equal(before.purchaseReservedCents,1000000);assert.equal(before.cashCents,45000000);assert.equal(before.availableCents,42000000);
 await assert.rejects(()=>cap('agree_sale',{carId:'car-rival',amountCents:5000000}),/SALE_AGREEMENT_LOCKED/);
 const proof=async(kind,app=applicationId)=>{const d=await loan('d','proof_prepare',{applicationId:app,kind,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0')});await assert.rejects(()=>loan('d','proof_confirm',{documentId:d.documentId}),/UPLOAD_MISSING/);await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await loan('d','proof_confirm',{documentId:d.documentId});return d.documentId;};
 const statementDocumentId=await proof('statement'),receiptDocumentId=await proof('payment');
 const data={applicationId,statementDocumentId,receiptDocumentId,...bankData(),recipientBank:'Lender bank',recipientAccount:'12345678',recipientName:'Lender',note:'Clear outstanding loan',requestId:req()};
 await assert.rejects(()=>loan('a','pay',data),/NOT_ALLOWED/);await assert.rejects(()=>loan('i','pay',data),/NOT_ALLOWED/);await assert.rejects(()=>loan('d','pay',{...data,requestId:req(),receiptDocumentId:statementDocumentId}),/LENDER_PAYMENT_PROOF_REQUIRED/);
 const paid=await loan('d','pay',data);assert.equal((await loan('d','pay',data)).paymentId,paid.paymentId);await assert.rejects(()=>loan('d','pay',{...data,recipientAccount:'changed'}),/REQUEST_CHANGED/);await assert.rejects(()=>loan('d','pay',{...data,requestId:req()}),/LENDER_ALREADY_PAID/);
 const after=await position();assert.equal(after.cashCents,44000000);assert.equal(after.purchaseReservedCents,0);assert.equal(after.availableCents,before.availableCents);
 const ready=await cap('car_snapshot',{carId:'car-rival'});assert.equal(ready.purchasePaidCents,4000000);assert.equal(ready.state,'in_stock');assert.equal(ready.costCents,0);assert.equal(ready.lenderPaidCents,1000000);
 await cap('agree_sale',{carId:'car-rival',amountCents:5000000});
 const own=await loan('i','snapshot',{applicationId});assert.equal(own.paid,true);assert.equal(own.recipientAccount,null);assert.equal(own.accountLast4,'5678');assert.equal((await loan('d','snapshot',{applicationId})).recipientAccount,'12345678');await assert.rejects(()=>loan('other','snapshot',{applicationId}),/NOT_ALLOWED/);
 assert.equal((await db.query("select count(*) n from uc_bank_movements where source_kind='investor'")).rows[0].n,3);

 // A different investor must fund gross value, while only net equity moves
 // to the outgoing pot. The lender reserve belongs to the incoming pot.
 const second=await cap('create_profile',{name:'Second investor'});await cap('link_account',{potId:second.potId,staffId:'other'});await cap('capital_received',{potId:second.potId,amountCents:10000000,...bankData()});
 await db.exec("update cars set trade_in_source_car_id='car-own',purchase_price=20000,settlement_amount=5000 where id='car-low';update cars set trade_in_source_car_id='car-own',purchase_price=5000,settlement_amount=5000 where id='car-zero'");
 const cross=(await call('uc_trade_in_funding','d','choose',{incomingCarId:'car-low',fundingKind:'investor',potId:second.potId,investorBasisPoints:4000,requestId:req()})).choice;
 const purchaseDoc=async(choiceId)=>{const d=await call('uc_apply_investor_trade_in','d','proof_prepare',{choiceId,fileName:'purchase.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0')});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_apply_investor_trade_in','d','proof_confirm',{documentId:d.documentId});return d.documentId;};
 const crossDoc=await purchaseDoc(cross.id);await call('uc_apply_investor_trade_in','d','apply',{choiceId:cross.id,documentId:crossDoc,requestId:req()});const crossCar=await cap('car_snapshot',{carId:'car-low'}),crossApp=crossCar.tradeInApplicationId;
 const secondPosition=async()=>(await db.query('select uc_investor_position($1) value',[second.potId])).rows[0].value;
 assert.equal((await secondPosition()).cashCents,8500000);assert.equal((await secondPosition()).purchaseReservedCents,500000);assert.equal((await secondPosition()).availableCents,8000000);assert.equal((await position()).cashCents,45500000);
 const crossStatement=await proof('statement',crossApp),crossReceipt=await proof('payment',crossApp);
 await loan('d','pay',{...data,applicationId:crossApp,statementDocumentId:crossStatement,receiptDocumentId:crossReceipt,...bankData(),requestId:req()});
 assert.equal((await secondPosition()).cashCents,8000000);assert.equal((await secondPosition()).availableCents,8000000);await assert.rejects(()=>loan('i','snapshot',{applicationId:crossApp}),/NOT_ALLOWED/);assert.equal((await loan('other','snapshot',{applicationId:crossApp})).paid,true);
 const zero=(await call('uc_trade_in_funding','d','choose',{incomingCarId:'car-zero',fundingKind:'investor',potId,investorBasisPoints:4000,requestId:req()})).choice,zeroDoc=await purchaseDoc(zero.id);
 const cashCount=(await db.query('select count(*) n from uc_investor_cash_entries')).rows[0].n;
 await call('uc_apply_investor_trade_in','d','apply',{choiceId:zero.id,documentId:zeroDoc,requestId:req()});
 assert.equal((await cap('car_snapshot',{carId:'car-zero'})).purchasePaidCents,0);assert.equal((await cap('car_snapshot',{carId})).receivedCents,4500000);assert.equal((await db.query('select count(*) n from uc_investor_cash_entries')).rows[0].n,cashCount);
 const ledgerBank=(await db.query("select coalesce(sum((l->>'debit')::numeric-(l->>'credit')::numeric)*100,0) cents from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where not coalesce(j.voided,false) and l->>'accountId'='acct-bank-uc-'||md5('bank:'||$1)",[bank.id])).rows[0].cents;
 assert.equal(Number(ledgerBank),(await db.query('select uc_registered_bank_position($1) cents',[bank.id])).rows[0].cents);
 assert.equal((await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n,0);
 assert.equal((await db.query("select has_function_privilege('anon','uc_trade_in_lender_money(text,text,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS financed investor trade-in: net credit once, gross car value, reserved lender debt, source-bound statement/receipt, one bank settlement, no second expense, unchanged available balance, replay and own-investor ACL');
}finally{await db.close();}
