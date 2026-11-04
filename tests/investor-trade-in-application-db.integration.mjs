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
 let n=0;const req=()=> 'tradein_apply_'+String(++n).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cap=(action,data={})=>call('uc_investor_capital','d',action,{...data,...(action==='car_snapshot'?{}:{requestId:req()})});
 const apply=(actor,action,data={})=>call('uc_apply_investor_trade_in',actor,action,data);
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Bank',openingDate:day,openingCents:0,requestId:req()})).bank;
 const payment=()=>({paidOn:day,bankAccountId:bank.id,bankReference:req()});
 const first=await cap('create_profile',{name:'First'}),second=await cap('create_profile',{name:'Second'});
 await cap('capital_received',{potId:first.potId,amountCents:50000000,...payment()});await cap('capital_received',{potId:second.potId,amountCents:10000000,...payment()});await cap('link_account',{potId:first.potId,staffId:'i'});
 const carId='car-own';await cap('fund_car',{potId:first.potId,carId,purchaseCents:5000000});
 const proofs={};for(const kind of ['invoice','payment']){const d=await call('uc_investor_money_evidence','d','prepare',{target:'purchase',carId,kind,amountCents:5000000,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_investor_money_evidence','d','confirm',{documentId:d.documentId});proofs[kind]=d.documentId;}
 await cap('purchase_paid',{carId,invoiceDocumentId:proofs.invoice,receiptDocumentId:proofs.payment,...payment()});await cap('agree_sale',{carId,amountCents:7000000});
 const choice=async(incoming,potId)=>(await call('uc_trade_in_funding','d','choose',{incomingCarId:incoming,fundingKind:'investor',potId,investorBasisPoints:4000,requestId:req()})).choice;
 const proof=async(choiceId)=>{const d=await apply('d','proof_prepare',{choiceId,fileName:'trade-in-invoice.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0')});await assert.rejects(()=>apply('d','proof_confirm',{documentId:d.documentId}),/UPLOAD_MISSING/);await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await apply('d','proof_confirm',{documentId:d.documentId});return d.documentId;};
 await db.exec("update cars set investor_split=50 where id='car-rival'");
 const chosen=await choice('car-rival',first.potId),documentId=await proof(chosen.id),data={choiceId:chosen.id,documentId,requestId:req()};
 const cashBefore=(await db.query('select count(*) n from uc_investor_cash_entries')).rows[0].n;
 await assert.rejects(()=>apply('a','apply',data),/NOT_ALLOWED/);await assert.rejects(()=>apply('i','apply',data),/NOT_ALLOWED/);
 assert.equal((await apply('d','apply',data)).choice.financiallyApplied,true);assert.equal((await apply('d','apply',data)).choice.financiallyApplied,true);
 await assert.rejects(()=>apply('d','apply',{...data,choiceId:'11111111-1111-4111-8111-111111111111'}),/REQUEST_CHANGED/);
 const incoming=(await cap('car_snapshot',{carId:'car-rival'}));assert.equal(incoming.purchasePaidCents,4000000);assert.equal(incoming.state,'in_stock');assert.equal(incoming.noncashPurchaseCents,4000000);
 const outgoing=await cap('car_snapshot',{carId});assert.equal(outgoing.receivedCents,4000000);assert.equal(outgoing.actualReceivedCents,0);
 const position=async(id)=>(await db.query('select uc_investor_position($1) value',[id])).rows[0].value;
 assert.equal((await position(first.potId)).cashCents,45000000);assert.equal((await position(first.potId)).purchaseReservedCents,0);assert.equal((await position(first.potId)).availableCents,43000000);
 assert.equal((await db.query('select count(*) n from uc_investor_cash_entries')).rows[0].n,cashBefore);
 await assert.rejects(()=>cap('purchase_paid',{carId:'car-rival',...payment()}),/TRADE_IN_ALREADY_FUNDED/);
 const cross=await choice('car-zero',second.potId),crossProof=await proof(cross.id);await apply('d','apply',{choiceId:cross.id,documentId:crossProof,requestId:req()});
 assert.equal((await position(first.potId)).cashCents,46000000);assert.equal((await position(second.potId)).cashCents,9000000);assert.equal((await position(second.potId)).availableCents,9000000);
 assert.equal((await cap('car_snapshot',{carId})).receivedCents,5000000);

 assert.equal((await cap('car_snapshot',{carId:'car-rival'})).tradeInDocumentId,documentId);
 assert.equal((await apply('i','proof_read',{documentId})).documentId,documentId);await assert.rejects(()=>apply('other','proof_read',{documentId}),/NOT_ALLOWED/);await assert.rejects(()=>apply('i','proof_read',{documentId:crossProof}),/NOT_ALLOWED/);
 await assert.rejects(()=>db.exec("update cars set settlement_amount=100 where id='car-rival'"),/TRADE_IN_FUNDING_LOCKED/);
 await assert.rejects(()=>db.exec("update cars set trade_in_source_car_id='car-low' where id='car-rival'"),/TRADE_IN_FUNDING_LOCKED/);
 assert.equal((await db.query("select investor_split from cars where id='car-rival'")).rows[0].investor_split,null);
 await db.exec("update cars set trade_in_source_car_id='car-own',purchase_price=10000,settlement_amount=0 where id='car-low';update cars set trade_in_source_car_id='car-own',purchase_price=10000,settlement_amount=1000 where id='car-customer'");
 const empty=await cap('create_profile',{name:'Empty'}),noFunds=await choice('car-low',empty.potId),noFundsProof=await proof(noFunds.id);
 await assert.rejects(()=>apply('d','apply',{choiceId:noFunds.id,documentId:noFundsProof,requestId:req()}),/INSUFFICIENT_FUNDING_POT/);
 assert.equal((await db.query("select count(*) n from uc_investor_cars where car_id='car-low'")).rows[0].n,0);
 const lender=await choice('car-customer',first.potId),lenderProof=await proof(lender.id);await assert.rejects(()=>apply('d','apply',{choiceId:lender.id,documentId:lenderProof,requestId:req()}),/LENDER_SETTLEMENT_NOT_READY/);
 const company=(await call('uc_trade_in_funding','d','choose',{incomingCarId:'car-low',fundingKind:'company',expectedChoiceId:noFunds.id,reason:'Company chosen instead',requestId:req()})).choice,companyProof=await proof(company.id);
 await assert.rejects(()=>apply('d','apply',{choiceId:company.id,documentId:companyProof,requestId:req()}),/COMPANY_FUNDING_NOT_READY/);
 await assert.rejects(()=>apply('d','apply',{choiceId:noFunds.id,documentId:noFundsProof,requestId:req()}),/CHOICE_CHANGED/);
 const history=await call('uc_investor_capital','i','snapshot',{});assert.equal(history.entries.filter(e=>e.kind==='trade_in_value_in').length,1);assert.equal(history.entries.find(e=>e.kind==='trade_in_value_in').amountCents,1000000);
 assert.equal((await db.query('select count(*) n from uc_investor_cash_entries')).rows[0].n,cashBefore);
 assert.equal((await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n,0);
 await assert.rejects(()=>db.query('delete from uc_trade_in_applications'),/IMMUTABLE_HISTORY/);
 assert.equal((await db.query("select has_function_privilege('anon','uc_apply_investor_trade_in(text,text,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS applied investor trade-ins: same-pot asset rotation, cross-pot ownership, no bank movement, single acquisition/recovery, proof, replay, reserve and role guards');
}finally{await db.close();}
