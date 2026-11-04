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
 let n=0;const req=()=> 'commissions_'+String(++n).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const capital=(actor,action,data={})=>call('uc_investor_capital',actor,action,data);
 const cmd=(action,data={})=>capital('d',action,{...data,requestId:req()});
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Company bank',openingDate:day,openingCents:0,requestId:req()})).bank;
 const pay=()=>({paidOn:day,bankAccountId:bank.id,bankReference:req()});
 const profile=await cmd('create_profile',{name:'Commission investor'}),potId=profile.potId;
 await cmd('capital_received',{potId,amountCents:100000000,...pay()});
 const fund=async(carId)=>{
  await cmd('fund_car',{potId,carId,purchaseCents:5000000});
  const ids={};for(const kind of ['invoice','payment']){
   const d=await call('uc_investor_money_evidence','d','prepare',{target:'purchase',carId,kind,amountCents:5000000,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});
   await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_investor_money_evidence','d','confirm',{documentId:d.documentId});ids[kind]=d.documentId;
  }
  await cmd('purchase_paid',{carId,invoiceDocumentId:ids.invoice,receiptDocumentId:ids.payment,...pay()});
 };
 const billProof=async(billId,kind)=>{
  const d=await call('uc_investor_activation','d','proof_prepare',{billId,kind,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});
  await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_investor_activation','d','proof_confirm',{documentId:d.documentId});return d.documentId;
 };
 await db.exec("update cars set assigned_salesperson='s';update cars set is_recon=true,sales_commission=2500,intake_commission=300,source_commission=500,source_type='external',external_salesman_id='external' where id='car-own';update cars set price_floor=80000 where id='car-low';update cars set waive_commission=true,assigned_salesperson=null where id='car-zero';update cars set assigned_salesperson=null where id='car-missing';update cars set is_recon=true where id='car-recon';insert into customers values('customer','car-customer','s',1250,'{}',null,false,null)");
 await fund('car-own');const agreement={carId:'car-own',amountCents:7000000,requestId:req()};await capital('d','agree_sale',agreement);await capital('d','agree_sale',agreement);
 const bills=(await db.query("select b.*,l.kind from uc_investor_commission_bills l join uc_investor_car_bills b on b.id=l.bill_id where l.car_id='car-own' order by l.kind")).rows;
 assert.equal(bills.length,3);assert.equal(bills.find(b=>b.kind==='salesman_commission').amount_cents,250000);
 assert.equal((await db.query('select count(*) n from payments')).rows[0].n,0);
 const sales=bills.find(b=>b.kind==='salesman_commission');await billProof(sales.id,'bill');await cmd('approve_car_bill',{carId:'car-own',billId:sales.id});
 const receiptDocumentId=await billProof(sales.id,'receipt');const payment={carId:'car-own',billId:sales.id,amountCents:250000,receiptDocumentId,...pay()};
 await assert.rejects(()=>cmd('pay_car_bill',payment),/COMMISSION_NOT_PAYABLE/);
 assert.equal((await db.query('select count(*) n from uc_private_payment_rows')).rows[0].n,0);
 await db.exec("update cars set commission_credited_early=true,commission_credited_month='2026-10' where id='car-own'");
 let projection=(await db.query('select * from uc_private_payment_rows')).rows;assert.equal(projection.length,1);assert.equal(Number(projection[0].amount),2500);assert.equal(projection[0].recipient_id,'s');assert.equal(projection[0].created_at.toISOString().slice(0,7),'2026-10');assert.equal(projection[0].status,'pending');
 await cmd('pay_car_bill',payment);projection=(await db.query('select * from uc_private_payment_rows')).rows;assert.equal(projection[0].status,'transferred');
 await db.exec('set role service_role');assert.equal((await db.query('select count(*) n from uc_private_payment_rows')).rows[0].n,1);await db.exec('reset role');
 await cmd('sale_received',{carId:'car-own',amountCents:7000000,...pay()});await assert.rejects(()=>cmd('settle_car',{carId:'car-own',confirmCosts:true}),/COMMISSION_REVIEW_REQUIRED/);
 for(const b of bills.filter(b=>b.id!==sales.id)){await billProof(b.id,'bill');await cmd('approve_car_bill',{carId:'car-own',billId:b.id});}
 await db.exec("update cars set sales_commission=2600 where id='car-own'");await assert.rejects(()=>cmd('settle_car',{carId:'car-own',confirmCosts:true}),/COMMISSION_REVIEW_REQUIRED/);await db.exec("update cars set sales_commission=2500 where id='car-own'");
 const settled=await cmd('settle_car',{carId:'car-own',confirmCosts:true});assert.equal(settled.car.costCents,330000);
 for(const [id,amount]of [['car-low',100000],['car-recon',200000],['car-customer',125000]]){await fund(id);await cmd('agree_sale',{carId:id,amountCents:7000000});assert.equal((await db.query('select amount_cents from uc_investor_car_bills where car_id=$1',[id])).rows[0].amount_cents,amount);}
 await fund('car-zero');await cmd('agree_sale',{carId:'car-zero',amountCents:7000000});assert.equal((await db.query("select count(*) n from uc_investor_car_bills where car_id='car-zero'")).rows[0].n,0);assert.equal((await db.query("select count(*) n from uc_investor_commission_reviews where car_id='car-zero'")).rows[0].n,1);
 await fund('car-missing');await assert.rejects(()=>cmd('agree_sale',{carId:'car-missing',amountCents:7000000}),/COMMISSION_RECIPIENT_REQUIRED/);assert.equal((await db.query("select sale_cents from uc_investor_cars where car_id='car-missing'")).rows[0].sale_cents,null);
 assert.equal((await db.query('select count(*) n from payments')).rows[0].n,0);
 console.log('PASS investor commissions: real rules, source bills, replay, payroll read projection, early credit, actual paid status, profit cost review and no duplicate public payments');
}finally{await db.close();}
