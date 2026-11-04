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

 await db.exec("alter table cars add column assigned_salesperson text;alter table cars add column sales_commission numeric;alter table cars add column is_recon boolean default false;alter table cars add column waive_commission boolean default false;alter table cars add column is_staff_sale boolean default false;alter table cars add column price_floor numeric;alter table cars add column intake_commission numeric;alter table cars add column source_commission numeric;alter table cars add column source_type text;alter table cars add column source_salesman_id text;alter table cars add column external_salesman_id text;alter table cars add column commission_credited_early boolean default false;alter table cars add column commission_credited_month text;alter table cars add column final_deal jsonb;alter table cars add column date_added text default '2026-11-01';alter table payments add column created_at timestamptz;alter table payments add column transferred_at timestamptz;alter table payments add column transferred_by text;alter table payments add column bank_name text;alter table payments add column account_number text;alter table payments add column account_holder text");
 await db.exec("create table customers(id text primary key,interested_car_id text,assigned_sales_id text,commission numeric,cash_work_order jsonb,loan_work_order jsonb,delivered boolean default false,delivered_at text);create table external_salesmen(id text primary key,name text,bank text,bank_account text);insert into users(id,name,role) values('s','Staff','salesperson');insert into external_salesmen values('external','Outside salesperson','Bank','123');insert into cars(id,make,model,status,purchase_price) values('car-low','Toyota','Vios','available',50000),('car-zero','Toyota','Vios','available',50000),('car-missing','Toyota','Vios','available',50000),('car-recon','Toyota','Vios','available',50000),('car-customer','Toyota','Vios','available',50000)");
 await db.exec(migration('20261104130000_investor_commission_bills.sql'));

 await db.exec(migration('20261105000000_trade_in_funding_choices.sql'));
 await db.exec("alter table cars add column settlement_amount numeric;update cars set trade_in_source_car_id='car-own',purchase_price=40000,settlement_amount=10000 where id='car-rival'");
 let n=0;const req=()=> 'tradein_choice_'+String(++n).padStart(8,'0');
 const rpc=async(actor,action,data)=>(await db.query('select uc_trade_in_funding($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const incomingCarId='car-rival';assert.equal((await rpc('d','snapshot',{incomingCarId})).choice,null);
 const firstData={incomingCarId,fundingKind:'company',requestId:req()};
 await assert.rejects(()=>rpc('a','choose',firstData),/NOT_ALLOWED/);
 await assert.rejects(()=>rpc('d','choose',{incomingCarId,requestId:req()}),/FUNDING_CHOICE_REQUIRED/);
 const first=(await rpc('d','choose',firstData)).choice;assert.equal(first.fundingKind,'company');assert.equal(first.netCreditCents,3000000);assert.equal(first.financiallyApplied,false);
 assert.equal((await rpc('d','choose',firstData)).choice.id,first.id);
 const profile=(await db.query('select uc_investor_capital($1,$2,$3) result',['d','create_profile',{name:'Investor B',requestId:req()}])).rows[0].result;
 await assert.rejects(()=>rpc('d','choose',{incomingCarId,fundingKind:'investor',potId:profile.potId,investorBasisPoints:4000,requestId:req()}),/CHOICE_CHANGED/);
 const secondData={incomingCarId,fundingKind:'investor',potId:profile.potId,investorBasisPoints:4000,expectedChoiceId:first.id,reason:'Investor funds this car',requestId:req()};
 const second=(await rpc('d','choose',secondData)).choice;assert.equal(second.revision,2);assert.equal(second.potId,profile.potId);
 assert.equal((await rpc('d','snapshot',{incomingCarId})).choice.id,second.id);
 assert.equal((await rpc('d','choose',firstData)).choice.id,first.id);assert.equal((await rpc('d','snapshot',{incomingCarId})).choice.id,second.id);
 await assert.rejects(()=>rpc('d','choose',{...firstData,fundingKind:'investor',potId:profile.potId,investorBasisPoints:4000}),/REQUEST_CHANGED/);
 await assert.rejects(()=>rpc('d','choose',{...secondData,requestId:req()}),/CHOICE_CHANGED/);
 await db.exec("update cars set purchase_price=41000 where id='car-rival'");
 assert.equal((await rpc('d','snapshot',{incomingCarId})).choice.valuationChanged,true);
 await db.exec("update cars set purchase_price=40000 where id='car-rival'");
 assert.equal((await rpc('d','snapshot',{incomingCarId})).choice.valuationChanged,false);
 assert.equal((await rpc('d','snapshot',{incomingCarId})).history.length,2);
 assert.equal((await db.query('select count(*) n from uc_investor_cash_entries')).rows[0].n,0);assert.equal((await db.query('select count(*) n from journal_entries')).rows[0].n,0);assert.equal((await db.query('select count(*) n from uc_investor_cars')).rows[0].n,0);
 await db.exec("update cars set trade_in_source_car_id='car-own',settlement_amount=60000 where id='car-low'");
 await assert.rejects(()=>rpc('d','choose',{incomingCarId:'car-low',fundingKind:'company',requestId:req()}),/NEGATIVE_EQUITY_REVIEW_REQUIRED/);
 await assert.rejects(()=>rpc('d','choose',{incomingCarId:'car-zero',fundingKind:'company',requestId:req()}),/NOT_A_TRADE_IN/);
 await assert.rejects(()=>db.query('delete from uc_trade_in_funding_choices where id=$1',[second.id]),/IMMUTABLE_HISTORY/);
 assert.equal((await db.query("select has_function_privilege('anon','uc_trade_in_funding(text,text,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS trade-in choice: Director-only explicit selection, immutable revisions, concurrency precondition, exact replay, no default inheritance and no financial postings');
}finally{await db.close();}
