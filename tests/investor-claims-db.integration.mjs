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

 await db.exec(migration('20261104120000_investor_staff_claims.sql'));
 await db.exec(migration('20261104121000_investor_claim_invoice_access.sql'));
 await db.exec("insert into garage_building_staff(id,name,username,password,role,business_access) values('s','Staff','staff','discarded','salesperson','used_car'),('peer','Peer','peer','discarded','mechanic','used_car')");
 let n=0;const req=()=> 'claim_rehearsal_'+String(++n).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const capital=(actor,action,data={})=>call('uc_investor_capital',actor,action,data);
 const cmd=(actor,action,data={})=>capital(actor,action,{...data,requestId:req()});
 const claims=(actor,action,data={})=>call('uc_investor_claims',actor,action,data);
 const proof=(actor,action,data)=>call('uc_staff_claim_proof',actor,action,data);
 const profile=await cmd('d','create_profile',{name:'Claim investor'}),potId=profile.potId;
 await cmd('d','link_account',{potId,staffId:'i'});
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Bank',openingDate:day,openingCents:0,requestId:req()})).bank;
 await cmd('d','capital_received',{potId,amountCents:10000000,paidOn:day,bankAccountId:bank.id,bankReference:req()});
 const carId='car-own';await cmd('d','fund_car',{potId,carId,purchaseCents:5000000});
 const data={carId,claimKind:'misc',category:'Petrol',purpose:'Petrol for stock car',payee:'Staff',amountCents:5000,requestId:req()};
 const saved=await claims('s','submit',data);assert.equal(saved.claim.state,'pending');
 assert.equal((await claims('s','submit',data)).claim.claimId,saved.claim.claimId);
 await assert.rejects(()=>claims('s','submit',{...data,amountCents:5001}),/REQUEST_CHANGED/);
 await assert.rejects(()=>claims('peer','details',{claimId:saved.claim.claimId}),/NOT_ALLOWED/);
 await assert.rejects(()=>claims('a','approve',{claimId:saved.claim.claimId,requestId:req()}),/DIRECTOR_APPROVAL_REQUIRED/);
 await assert.rejects(()=>claims('d','approve',{claimId:saved.claim.claimId,requestId:req()}),/SUPPLIER_INVOICE_REQUIRED/);
 assert.equal((await db.query('select count(*) n from payments')).rows[0].n,0);
 assert.equal((await db.query('select count(*) n from uc_investor_car_bills')).rows[0].n,1);
 const invoice={billId:saved.claim.billId,kind:'bill',fileName:'petrol.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:'a'.repeat(64),requestId:req()};
 const doc=await proof('s','proof_prepare',invoice);
 await assert.rejects(()=>proof('peer','proof_prepare',{...invoice,requestId:req()}),/NOT_ALLOWED/);
 await assert.rejects(()=>proof('s','proof_confirm',{documentId:doc.documentId}),/UPLOAD_MISSING/);
 await db.query("insert into storage.objects values('finance-evidence',$1)",[doc.path]);
 await proof('s','proof_confirm',{documentId:doc.documentId});
 const approved=await claims('d','approve',{claimId:saved.claim.claimId,requestId:req()});assert.equal(approved.claim.state,'approved');
 assert.equal((await proof('s','proof_read',{documentId:doc.documentId})).documentId,doc.documentId);
 await assert.rejects(()=>proof('s','proof_prepare',{...invoice,requestId:req(),sha256:'b'.repeat(64)}),/CLAIM_LOCKED/);
 const unrelated=await cmd('d','add_car_bill',{carId,category:'misc',purpose:'Other bill',payee:'Shop',amountCents:100});
 await assert.rejects(()=>proof('s','proof_prepare',{...invoice,billId:unrelated.billId,requestId:req()}),/NOT_ALLOWED/);
 const second=await claims('s','submit',{...data,purpose:'Other cost',requestId:req()});
 await claims('a','reject',{claimId:second.claim.claimId,note:'Duplicate bill',requestId:req()});
 assert.equal((await claims('s','details',{claimId:second.claim.claimId})).claim.state,'rejected');
 assert.equal((await claims('peer','list',{page:0})).claims.length,0);
 assert.equal((await claims('s','list',{page:0})).claims.length,2);
 await assert.rejects(()=>claims('i','list',{page:0}),/NOT_ALLOWED/);
 assert.equal((await db.query("select has_function_privilege('anon','uc_staff_claim_proof(text,text,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS investor staff claims: canonical bill, exact retries, own invoice, upload validation, Director approval, admin rejection, no public payment and ownership isolation');
}finally{await db.close();}
