// Local disposable database. No Supabase connection or credentials.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2],'dist/index.js')));const db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table garage_building_staff(id text primary key,enabled boolean,registration_status text,role text,business_access text);
 insert into garage_building_staff values('d',true,'active','director','both');
 create table cars(id text primary key,make text,model text,year integer,car_plate text,photo text,status text,investor_id text,investor_split numeric,trade_in_source_car_id text,purchase_price numeric,consignment jsonb,outgoing_consignment jsonb);
 insert into cars(id,make,model,status,purchase_price) values('gain','Toyota','Vios','available',50000),('loss','Toyota','Vios','available',50000),('history','Toyota','Vios','available',50000);
 create table payments(id text primary key,car_id text);
 create table journal_entries(id text primary key,date date,description text,lines jsonb,source_type text,source_id text,car_id text,created_by text,created_at timestamptz default now(),voided boolean default false);
 create table ledger_accounts(id text primary key,name text,type text,investor_tagged boolean);
 create table uc_investor_banks(id uuid primary key,name text,opening_date date,opening_cents bigint,created_by text);
 insert into ledger_accounts(id,type) values('acct-ap','liability'),('acct-investor-payable','liability'),('acct-inv-investor','asset'),('acct-rev-investor-share','revenue'),('acct-equity','equity');
 insert into journal_entries(id,car_id,lines) values('old-purchase','history','[]');`);
 for(const file of ['20261104000000_investor_capital_foundation.sql','20261104010000_investor_car_expenses.sql','20261104030000_investor_journal_integration.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 let n=0;const call=async(action,data={})=>(await db.query('select uc_investor_capital($1,$2,$3) result',['d',action,{...data,requestId:'journal_request_'+String(++n).padStart(5,'0')}])).rows[0].result;
 const today=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=()=>({bankAccount:'Sample bank',bankReference:'sample-'+(++n),paidOn:today});
 const {potId}=await call('create_profile',{name:'Sample investor'});
 await call('capital_received',{potId,amountCents:50000000,...bank()});
 await assert.rejects(()=>call('fund_car',{potId,carId:'history',purchaseCents:5000000}),/CAR_HISTORY_REVIEW_REQUIRED/);
 await assert.rejects(()=>db.exec("update cars set investor_funded=true where id='history'"),/FUNDING_ACCOUNT_REQUIRED/);
 for(const [carId,sale] of [['gain',7000000],['loss',4000000]]){
  await call('fund_car',{potId,carId,purchaseCents:5000000});
  assert.equal((await db.query('select investor_funded from cars where id=$1',[carId])).rows[0].investor_funded,true);
  await assert.rejects(()=>db.query('update cars set purchase_price=1 where id=$1',[carId]),/FUNDING_AGREEMENT_LOCKED/);
  await assert.rejects(()=>db.query('insert into payments(id,car_id) values($1,$2)',['old-'+carId,carId]),/USE_INVESTOR_CAR_BILLS/);
  await call('purchase_paid',{carId,...bank()});
  const bill=await call('add_car_bill',{carId,category:'repair',purpose:'Car repair',payee:'Workshop',amountCents:350000});
  await call('approve_car_bill',{carId,billId:bill.billId});
  await call('pay_car_bill',{carId,billId:bill.billId,amountCents:350000,...bank()});
  await call('agree_sale',{carId,amountCents:sale});
  await call('sale_received',{carId,amountCents:sale,...bank()});
  await call('settle_car',{carId,confirmCosts:true});
 }
 const entries=(await db.query("select * from journal_entries where source_type='investor_finance'")).rows;
 for(const e of entries){const delta=e.lines.reduce((s,l)=>s+Math.round(l.debit*100)-Math.round(l.credit*100),0);assert.equal(delta,0,e.id);}
 const accountBalance=account=>entries.flatMap(e=>e.lines).filter(l=>l.accountId===account).reduce((s,l)=>s+Math.round(l.credit*100)-Math.round(l.debit*100),0);
 assert.equal(accountBalance('acct-rev-investor-share'),990000); // no company loss
 assert.equal(accountBalance('acct-investor-payable'),49310000); // 500k + 6.6k - 13.5k
 assert.equal(accountBalance('acct-inv-investor'),0);
 assert.equal(accountBalance('acct-ap'),0);
 assert.equal(accountBalance('acct-uc-sale-clearing'),0);
 const banks=entries.flatMap(e=>e.lines).filter(l=>l.accountId.startsWith('acct-bank-uc-')).reduce((s,l)=>s+Math.round(l.debit*100)-Math.round(l.credit*100),0);
 assert.equal(banks,50300000); // real cash; includes company share, no fake transfer
 assert.equal((await db.query("select count(*)::int n from journal_entries where id like '%company_profit%'")).rows[0].n,0);
 await assert.rejects(()=>db.exec("update journal_entries set voided=true where source_type='investor_finance'"),/INVESTOR_JOURNAL_IMMUTABLE/);
 await assert.rejects(()=>db.exec("insert into journal_entries(id,source_type) values('forged','investor_finance')"),/INVESTOR_POSTING_PRIVATE/);
 console.log('PASS investor journal: cash, liability, inventory, bills, gain/loss, duplicate and immutability checks');
}finally{await db.close();}
