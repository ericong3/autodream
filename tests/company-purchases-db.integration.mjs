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
 await db.exec("alter table cars add column if not exists money_received boolean default false;alter table cars add column if not exists disbursement_status text;alter table cars add column if not exists disbursement_amount numeric;alter table cars add column if not exists disbursement_expected_amount numeric;alter table cars add column if not exists disbursement_date text");
 await db.exec(migration('20261105050000_company_bank_receipts.sql'));await db.exec(migration('20261105060000_company_trade_in_application.sql'));
 await db.exec("alter table cars add column if not exists colour text;alter table cars add column if not exists settlement_recipient text");
 await db.exec(migration('20261105070000_company_car_purchases.sql'));
 let n=0;const req=()=> 'lender_test_'+String(++n).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cap=(action,data={})=>call('uc_investor_capital','d',action,{...data,...(action==='car_snapshot'?{}:{requestId:req()})});
 const loan=(actor,action,data={})=>call('uc_trade_in_lender_money',actor,action,data);
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Bank',openingDate:day,openingCents:60000000,requestId:req()})).bank;
 const bankData=()=>({paidOn:day,bankAccountId:bank.id,bankReference:req()});
 const profile=await cap('create_profile',{name:'Investor'}),potId=profile.potId;await cap('link_account',{potId,staffId:'i'});await cap('capital_received',{potId,amountCents:50000000,...bankData()});
 const carId='car-own';await cap('fund_car',{potId,carId,purchaseCents:5000000});
 const purchase={};for(const kind of ['invoice','payment']){const d=await call('uc_investor_money_evidence','d','prepare',{target:'purchase',carId,kind,amountCents:5000000,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_investor_money_evidence','d','confirm',{documentId:d.documentId});purchase[kind]=d.documentId;}
 await cap('purchase_paid',{carId,invoiceDocumentId:purchase.invoice,receiptDocumentId:purchase.payment,...bankData()});await cap('agree_sale',{carId,amountCents:7000000});
 const car={id:'company-buy',make:'Toyota',model:'Noah',colour:'White',purchase_price:100000,status:'available'};
 const data={car,sellerName:'Seller One',lenderCents:3000000,lenderName:'Lender One',requestId:req()};
 const bankBefore=(await db.query('select uc_registered_bank_position($1) cents',[bank.id])).rows[0].cents;
 const register=(actor,data)=>db.query('select uc_register_company_car($1,$2) result',[actor,data]).then(r=>r.rows[0].result);
 await db.exec("insert into payments(id,type,status,amount) values('company-purchase-seller:rollback-car','purchase_settlement','pending',1)");
 await assert.rejects(()=>register('d',{...data,car:{...car,id:'rollback-car'},requestId:req()}),/duplicate key/);
 assert.equal((await db.query("select count(*) n from cars where id='rollback-car'")).rows[0].n,0);assert.equal((await db.query("select count(*) n from journal_entries where car_id='rollback-car'")).rows[0].n,0);
 await db.exec("delete from payments where id='company-purchase-seller:rollback-car'");
 await assert.rejects(()=>register('a',data),/NOT_ALLOWED/);
 await assert.rejects(()=>register('d',{...data,lenderCents:10000001}),/INVALID/);
 assert.equal((await db.query("select count(*) n from cars where id='company-buy'")).rows[0].n,0);
 const saved=await register('d',data);assert.equal(saved.companyPurchase,true);assert.equal(saved.car.company_purchase_recorded,true);assert.equal(saved.car.investor_split,null);assert.equal(saved.payments.length,2);assert.equal(saved.payments.reduce((n,p)=>n+p.amount,0),100000);
 assert.equal(saved.journals.length,1);assert.ok(saved.journals[0].lines.every(l=>!l.accountId.startsWith('acct-bank')));
 assert.deepEqual(await register('d',data),saved);await assert.rejects(()=>register('d',{...data,sellerName:'Changed'}),/REQUEST_CHANGED/);
 assert.equal((await db.query('select uc_registered_bank_position($1) cents',[bank.id])).rows[0].cents,bankBefore);
 assert.equal((await call('uc_company_bank_money','d','banks',{})).company.availableCents,50000000);
 const seller=saved.payments.find(p=>p.recipient_name==='Seller One'),lender=saved.payments.find(p=>p.recipient_name==='Lender One');assert.equal(seller.amount,70000);assert.equal(lender.amount,30000);
 await assert.rejects(()=>db.exec("update payments set amount=1 where id='"+seller.id+"'"),/COMPANY_PURCHASE_LOCKED/);
 await assert.rejects(()=>db.exec("update cars set purchase_price=1 where id='company-buy'"),/COMPANY_PURCHASE_LOCKED/);
 await assert.rejects(()=>cap('fund_car',{potId,carId:'company-buy',purchaseCents:10000000}),/CAR_HISTORY_REVIEW_REQUIRED|CAR_NOT_ELIGIBLE|COMPANY_PURCHASE_LOCKED/);
 const document=async(paymentId,kind)=>{const d=await call('uc_company_evidence','d','prepare',{paymentId,kind,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_company_evidence','d','confirm',{documentId:d.documentId});return d.documentId;};
 const proof=await document(seller.id,'payment'),payout={...bankData(),allocations:[{paymentId:seller.id,amountCents:2000000,documentId:proof}],requestId:req()};
 await assert.rejects(()=>call('uc_company_bank_money','d','record',payout),/SUPPLIER_INVOICE_REQUIRED/);await document(seller.id,'invoice');await call('uc_company_bank_money','d','record',payout);
 const replay=await register('d',data);assert.equal(replay.payments.find(p=>p.id===seller.id).bank_paid_cents,2000000);assert.equal(replay.payments.find(p=>p.id===seller.id).status,'pending');
 assert.equal((await call('uc_company_bank_money','d','banks',{})).company.availableCents,50000000);
 await document(lender.id,'invoice');const lenderProof=await document(lender.id,'payment');await call('uc_company_bank_money','d','record',{...bankData(),allocations:[{paymentId:lender.id,amountCents:3000000,documentId:lenderProof}],requestId:req()});
 assert.equal((await db.query('select uc_registered_bank_position($1) cents',[bank.id])).rows[0].cents,bankBefore-5000000);
 const own=await register('s',{car:{...car,id:'staff-buy',purchase_price:5000},sellerName:'Seller Two',requestId:req()});assert.equal(own.payments.length,0);assert.equal(own.journals.length,0);assert.equal(own.car.company_purchase_recorded,true);
 await db.exec("insert into cars(id,make,model,colour,status,purchase_price) values('draft-car','Honda','City','Black','coming_soon',0)");
 const draft={car:{...car,id:'draft-car',purchase_price:10000},sellerName:'Draft seller',requestId:req()};
 await assert.rejects(()=>register('s',draft),/CAR_EXISTS/);
 const completed=await register('d',draft);assert.equal(completed.car.purchase_price,10000);assert.equal(completed.car.make,'Honda');assert.equal(completed.car.model,'City');assert.equal(completed.car.company_purchase_recorded,true);assert.equal(completed.payments.length,1);
 await assert.rejects(()=>register('d',{...data,requestId:req()}),/CAR_EXISTS/);
 // Company trade-ins still mark their source after the purchase marker exists.
 await db.exec("insert into cars(id,make,model,colour,status,purchase_price,settlement_amount,trade_in_source_car_id) values('company-trade','Toyota','Vios','White','available',5000,1000,'car-own')");
 const tc=(await call('uc_trade_in_funding','d','choose',{incomingCarId:'company-trade',fundingKind:'company',requestId:req()})).choice;
 const td=await call('uc_apply_investor_trade_in','d','proof_prepare',{choiceId:tc.id,fileName:'trade.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0')});await db.query("insert into storage.objects values('finance-evidence',$1)",[td.path]);await call('uc_apply_investor_trade_in','d','proof_confirm',{documentId:td.documentId});
 const acquired=await call('uc_apply_investor_trade_in','d','apply',{choiceId:tc.id,documentId:td.documentId,requestId:req()});assert.equal(acquired.car.company_purchase_recorded,true);
 await assert.rejects(()=>db.query('update payments set amount=1 where id=$1',[acquired.payments[0].id]),/COMPANY_PURCHASE_LOCKED/);
 assert.equal((await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n,0);
 assert.equal((await db.query("select has_function_privilege('anon','uc_register_company_car(text,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS company purchases: atomic car/seller/lender bills, no assumed cash, invoice and receipt gates, partial actual payouts, current replay balances, preserved staff registration and private source guards');
}finally{await db.close();}
