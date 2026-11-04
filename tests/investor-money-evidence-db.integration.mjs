// Disposable local PGlite rehearsal only. Never connects to Supabase.
// node tests/investor-required-documents-db.integration.mjs <path-to-pglite-package>
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
 let n=0;const req=()=> 'money_documents_'+String(++n).padStart(8,'0');
 const capital=async(actor,action,data={})=>(await db.query('select uc_investor_capital($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cmd=(actor,action,data={})=>capital(actor,action,{...data,requestId:req()});
 const evidence=async(actor,action,data)=>(await db.query('select uc_investor_money_evidence($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await db.query('select uc_investor_activation($1,$2,$3) result',['d','save_bank',{name:'Company bank',openingDate:day,openingCents:0,requestId:req()}])).rows[0].result.bank;
 const pay=()=>({paidOn:day,bankAccountId:bank.id,bankReference:req()});
 const profile=await cmd('d','create_profile',{name:'Own investor'}),potId=profile.potId;
 await cmd('d','link_account',{potId,staffId:'i'});await cmd('d','capital_received',{potId,amountCents:20000000,...pay()});
 const carId='car-own';await cmd('d','fund_car',{potId,carId,purchaseCents:5000000});
 const draft=(source,kind,amountCents,sha)=>({...source,kind,amountCents,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:sha??(++n).toString(16).padStart(64,'0'),requestId:req()});
 const confirm=async(doc)=>{await db.query("insert into storage.objects values('finance-evidence',$1) on conflict do nothing",[doc.path]);return evidence('d','confirm',{documentId:doc.documentId});};
 const purchase={target:'purchase',carId};
 await assert.rejects(()=>cmd('d','purchase_paid',{carId,...pay()}),/PURCHASE_INVOICE_REQUIRED/);
 const invPayload=draft(purchase,'invoice',5000000),invoice=await evidence('d','prepare',invPayload);
 assert.deepEqual(await evidence('d','prepare',invPayload),invoice);
 await assert.rejects(()=>evidence('d','prepare',{...invPayload,amountCents:5000001}),/REQUEST_CHANGED/);
 await assert.rejects(()=>evidence('d','confirm',{documentId:invoice.documentId}),/UPLOAD_MISSING/);
 const receipt=await evidence('d','prepare',draft(purchase,'payment',5000000));
 await confirm(receipt);
 const payment={carId,invoiceDocumentId:invoice.documentId,receiptDocumentId:receipt.documentId,...pay(),requestId:req()};
 await assert.rejects(()=>capital('d','purchase_paid',payment),/PROOF_NOT_CONFIRMED/);
 await confirm(invoice);
 const paid=await capital('d','purchase_paid',payment);assert.deepEqual(await capital('d','purchase_paid',payment),paid);
 await assert.rejects(()=>capital('d','purchase_paid',{...payment,receiptDocumentId:invoice.documentId}),/REQUEST_CHANGED/);
 assert.equal((await evidence('i','list',purchase)).documents.length,2);
 assert.equal((await evidence('i','read',{documentId:receipt.documentId})).documentId,receipt.documentId);
 for(const actor of ['other','a','loner'])await assert.rejects(()=>evidence(actor,'read',{documentId:receipt.documentId}),/NOT_ALLOWED/);
 // Bill proof remains enforced through the complete wrapper stack.
 const bill=await cmd('a','add_car_bill',{carId,category:'repair',purpose:'Repair',payee:'Workshop',amountCents:10000});
 const billProof=async(kind)=>{
  const prepared=(await db.query('select uc_investor_activation($1,$2,$3) result',['a','proof_prepare',{billId:bill.billId,kind,fileName:kind+'.pdf',mimeType:'application/pdf',sha256:(++n).toString(16).padStart(64,'0'),sizeBytes:100,requestId:req()}])).rows[0].result;
  await db.query("insert into storage.objects values('finance-evidence',$1)",[prepared.path]);
  await db.query('select uc_investor_activation($1,$2,$3)',['a','proof_confirm',{documentId:prepared.documentId}]);return prepared.documentId;
 };
 await billProof('bill');await cmd('d','approve_car_bill',{carId,billId:bill.billId});
 const billReceipt=await billProof('receipt');await cmd('d','pay_car_bill',{carId,billId:bill.billId,amountCents:10000,receiptDocumentId:billReceipt,...pay()});
 const withdrawal=await cmd('i','request_withdrawal',{potId,amountCents:100000});
 await cmd('d','approve_withdrawal',{potId,withdrawalId:withdrawal.withdrawalId});
 const withdrawalTarget={target:'withdrawal',withdrawalId:withdrawal.withdrawalId};
 await assert.rejects(()=>cmd('d','withdrawal_paid',{potId,withdrawalId:withdrawal.withdrawalId,...pay()}),/PAYMENT_RECEIPT_REQUIRED/);
 await assert.rejects(()=>evidence('d','prepare',draft(withdrawalTarget,'payment',100001)),/PROOF_AMOUNT_CHANGED/);
 const withdrawalReceipt=await evidence('d','prepare',draft(withdrawalTarget,'payment',100000));await confirm(withdrawalReceipt);
 const payout={potId,withdrawalId:withdrawal.withdrawalId,receiptDocumentId:withdrawalReceipt.documentId,...pay(),requestId:req()};
 const done=await capital('d','withdrawal_paid',payout);assert.deepEqual(await capital('d','withdrawal_paid',payout),done);
 assert.equal((await evidence('i','list',withdrawalTarget)).documents[0].used,true);
 await cmd('d','fund_car',{potId,carId:'car-rival',purchaseCents:5000000});
 await assert.rejects(()=>db.query('select uc_investor_capital_phase4($1,$2,$3)',['d','purchase_paid',{carId:'car-rival',...pay(),requestId:req()}]),/MONEY_PROOF_REQUIRED/);
 await assert.rejects(()=>db.query('delete from uc_investor_money_links where entry_id=$1',[paid.entryId]),/IMMUTABLE_HISTORY/);
 assert.equal((await db.query("select count(*) n from uc_investor_money_links")).rows[0].n,2);
 assert.equal((await db.query("select has_function_privilege('anon','uc_investor_money_evidence(text,text,jsonb)','execute') allowed")).rows[0].allowed,false);
 assert.equal((await db.query("select has_function_privilege('service_role','uc_investor_capital_phase4(text,text,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS investor money documents: confirmed storage, invoice and receipt before purchase, withdrawal proof, exact retries, own-only reads, private internal functions and bypass protection');
}finally{await db.close();}
