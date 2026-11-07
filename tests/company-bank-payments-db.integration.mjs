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
 let n=0;const req=()=> 'company_bank_'+String(++n).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const money=(actor,action,data={})=>call('uc_company_bank_money',actor,action,data);
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Company bank',openingDate:day,openingCents:10000000,requestId:req()})).bank;
 await db.exec("insert into payments(id,type,status,amount,car_id,recipient_type,recipient_id,recipient_name) values('bill-1','repair','pending',1000,'car-low','workshop','shop','Workshop'),('bill-2','misc_cost','pending',500,'car-low','merchant','merchant','Parts shop')");
 const doc=async(paymentId,kind)=>{const d=await call('uc_company_evidence','d','prepare',{paymentId,kind,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_company_evidence','d','confirm',{documentId:d.documentId});return d.documentId;};
 const receipt=await doc('bill-1','payment');
 const input={bankAccountId:bank.id,paidOn:day,bankReference:'transfer 1',allocations:[{paymentId:'bill-1',amountCents:40000,documentId:receipt}],requestId:req()};
 await assert.rejects(()=>money('a','record',input),/NOT_ALLOWED/);await assert.rejects(()=>money('i','banks'),/NOT_ALLOWED/);await assert.rejects(()=>money('d','record',input),/SUPPLIER_INVOICE_REQUIRED/);
 await doc('bill-1','invoice');await assert.rejects(()=>money('d','record',input),/BILL_LEDGER_REVIEW_REQUIRED/);
 await db.exec("insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('recognise-1',current_date,'Repair','repair','bill-1','car-low','[{\"accountId\":\"acct-inv-own\",\"debit\":1000,\"credit\":0},{\"accountId\":\"acct-ap\",\"debit\":0,\"credit\":1000}]')");
 const first=await money('d','record',input);assert.equal(first.payments[0].status,'pending');assert.equal(first.payments[0].bank_paid_cents,40000);assert.equal(first.journals.length,1);
 assert.equal((await money('d','record',input)).bankPaymentId,first.bankPaymentId);await assert.rejects(()=>money('d','record',{...input,bankReference:'changed'}),/REQUEST_CHANGED/);
 const banks=await money('d','banks');assert.equal(banks.banks[0].balanceCents,9960000);assert.equal(banks.company.companyCashCents,9960000);assert.equal(banks.company.unpaidCompanyCents,110000);assert.equal(banks.company.availableCents,9850000);assert.equal(banks.company.bankMatched,false);
 const nextReceipt=await doc('bill-1','payment');
 const later={...input,bankReference:'transfer 2',requestId:req(),allocations:[{paymentId:'bill-1',amountCents:60000,documentId:nextReceipt}]};
 const final=await money('d','record',later);assert.equal(final.payments[0].status,'transferred');assert.equal(final.payments[0].bank_paid_cents,100000);
 await assert.rejects(()=>money('d','record',{...later,requestId:req(),bankReference:'transfer 3',allocations:[{paymentId:'bill-1',amountCents:1,documentId:receipt}]}),/PAYMENT_EXCEEDS_BALANCE/);
 await doc('bill-2','invoice');const secondReceipt=await doc('bill-2','payment');
 await db.exec("insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('recognise-2',current_date,'Parts','misc_cost','bill-2','car-low','[{\"accountId\":\"acct-inv-own\",\"debit\":500,\"credit\":0},{\"accountId\":\"acct-ap\",\"debit\":0,\"credit\":500}]')");
 await assert.rejects(()=>money('d','record',{...input,requestId:req(),allocations:[{paymentId:'bill-2',amountCents:50000,documentId:secondReceipt}]}),/duplicate key/);
 assert.equal((await db.query("select status from payments where id='bill-2'")).rows[0].status,'pending');assert.equal((await db.query('select count(*) n from uc_company_bank_payments')).rows[0].n,2);
 await assert.rejects(()=>db.exec("update payments set status='transferred' where id='bill-2'"),/USE_COMPANY_BANK_PAYMENT/);
 await assert.rejects(()=>db.exec("delete from payments where id='bill-1'"),/BANK_PAYMENT_IMMUTABLE/);

 await assert.rejects(()=>db.exec("update journal_entries set voided=true where id='recognise-1'"),/BANK_PAYMENT_IMMUTABLE/);
 await assert.rejects(()=>money('d','record',{...input,bankReference:'reuse proof',requestId:req(),allocations:[{paymentId:'bill-2',amountCents:10000,documentId:secondReceipt},{paymentId:'bill-1',amountCents:1,documentId:receipt}]}),/PAYMENT_EXCEEDS_BALANCE/);
 assert.equal((await db.query('select count(*) n from uc_company_bank_payments')).rows[0].n,2);assert.equal((await db.query("select count(*) n from uc_company_bank_allocations where payment_id='bill-2'")).rows[0].n,0);
 const partialTwo={...input,bankReference:'partial two',requestId:req(),allocations:[{paymentId:'bill-2',amountCents:10000,documentId:secondReceipt}]};await money('d','record',partialTwo);
 await assert.rejects(()=>money('d','record',{...partialTwo,bankReference:'reused receipt',requestId:req()}),/RECEIPT_ALREADY_USED/);
 const profile=await call('uc_investor_capital','d','create_profile',{name:'Investor',requestId:req()});
 await call('uc_investor_capital','d','capital_received',{potId:profile.potId,amountCents:500000,bankAccountId:bank.id,paidOn:day,bankReference:'investor transfer',requestId:req()});
 const positions=await money('d','banks');assert.equal(positions.company.investorOwnedCents,500000);assert.equal(positions.company.companyCashCents,9890000);
 assert.equal((await db.query("select count(*) n from uc_bank_movements where source_kind='investor'")).rows[0].n,1);

 // Exercise the actual existing bonus settlement function and its guards.
 const bonusSource=migration('20261101040000_bonus_payroll_refresh.sql');const bonusStart=bonusSource.indexOf('create or replace function public.used_car_bonus_campaign');const bonusEnd=bonusSource.indexOf('end $$;',bonusStart)+8;
 await db.exec('create table used_car_bonus_requests(actor_id text,request_id text,payload jsonb,result jsonb,created_at timestamptz)');await db.exec(bonusSource.slice(bonusStart,bonusEnd));
 const guards=migration('20261101030000_bonus_payroll_accounting.sql');const guardStart=guards.indexOf('create function used_car_bonus_finance_guard()'),guardEnd=guards.indexOf('create function used_car_bonus_post_payroll',guardStart);await db.exec(guards.slice(guardStart,guardEnd));
 await db.exec("select set_config('app.used_car_bonus_posting','1',false);insert into payments(id,type,status,amount,recipient_type,recipient_id,recipient_name) values('bonus','campaign_bonus','pending',100,'user','s','Staff');select set_config('app.used_car_bonus_posting','',false)");const bonusReceipt=await doc('bonus','payment');
 await assert.rejects(()=>money('d','record',{bankAccountId:bank.id,paidOn:day,bankReference:'partial bonus',allocations:[{paymentId:'bonus',amountCents:5000,documentId:bonusReceipt}],requestId:req()}),/PAYROLL_FULL_PAYMENT_REQUIRED/);
 const bonusPaid=await money('d','record',{bankAccountId:bank.id,paidOn:day,bankReference:'bonus payout',allocations:[{paymentId:'bonus',amountCents:10000,documentId:bonusReceipt}],requestId:req()});assert.equal(bonusPaid.payments[0].status,'transferred');assert.equal(bonusPaid.journals.length,1);assert.equal(bonusPaid.journals[0].source_type,'campaign_bonus_paid');assert.match(bonusPaid.journals[0].lines[1].accountId,/^acct-bank-uc-/);
 await assert.rejects(()=>db.exec("update journal_entries set voided=true where id='bonus-paid:bonus'"),/BONUS_IMMUTABLE|USE_COMPANY_BANK_PAYMENT/);

 const adminHistory=await money('a','history',{paymentId:'bill-1'});assert.equal(adminHistory.entries.length,2);assert.equal(adminHistory.entries[0].bankName,'Company bank');assert.equal(adminHistory.entries[0].recordedBy,'Director');assert.ok(!('batchTotalCents' in adminHistory.entries[0]));
 await assert.rejects(()=>money('a','history',{paymentId:'bonus'}),/NOT_ALLOWED/);
 await assert.rejects(()=>money('a','banks'),/NOT_ALLOWED/);
 await assert.rejects(()=>money('d','record',{bankAccountId:bank.id,paidOn:day,bankReference:'mixed payroll',allocations:[{paymentId:'bill-2',amountCents:1,documentId:secondReceipt},{paymentId:'bonus',amountCents:1,documentId:bonusReceipt}],requestId:req()}),/SEPARATE_SALARY_PAYMENTS/);
 assert.equal((await db.query("select bank_paid_cents from uc_private_payment_rows where id='bill-1'")).rows[0].bank_paid_cents,100000);
 assert.equal((await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n,0);
 assert.equal((await db.query("select has_function_privilege('anon','uc_company_bank_money(text,text,jsonb)','execute') allowed")).rows[0].allowed,false);
 const bankLedger='acct-bank-uc-'+(await db.query("select md5('bank:'||$1) value",[bank.id])).rows[0].value;
 await assert.rejects(()=>db.query("insert into journal_entries(id,date,description,lines) values('manual-bank',current_date,'Manual bank change',$1)",[JSON.stringify([{accountId:bankLedger,debit:100,credit:0},{accountId:'acct-equity',debit:0,credit:100}])]),/USE_COMPANY_BANK_PAYMENT/);
 // A physical bank balance includes money owned by investors. An ordinary
 // company bill must never consume that money, even when the bank has enough.
 await db.exec(migration('20261106112743_company_cash_ownership_guard.sql'));
 const ownedPosition=(await money('d','banks')).company;
 const companyCash=Number(ownedPosition.companyCashCents);
 assert.ok(companyCash>0);assert.ok(Number(ownedPosition.investorOwnedCents)>0);
 const oversized=companyCash+1;
 await db.query("insert into payments(id,type,status,amount,car_id,recipient_type,recipient_id,recipient_name) values('ownership-floor-bill','repair','pending',$1,'car-low','workshop','shop','Workshop')",[oversized/100]);
 await db.query("insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('ownership-floor-accrual',current_date,'Bill larger than company-owned cash','repair','ownership-floor-bill','car-low',$1)",[JSON.stringify([{accountId:'acct-inv-own',debit:oversized/100,credit:0},{accountId:'acct-ap',debit:0,credit:oversized/100}])]);
 await doc('ownership-floor-bill','invoice');const ownedReceipt=await doc('ownership-floor-bill','payment');
 const badOwnership={bankAccountId:bank.id,paidOn:day,bankReference:'must not spend investor money',requestId:req(),allocations:[{paymentId:'ownership-floor-bill',amountCents:oversized,documentId:ownedReceipt}]};
 const beforeOwnership=Number((await db.query('select count(*) n from uc_bank_movements')).rows[0].n);
 await assert.rejects(()=>money('d','record',badOwnership),/COMPANY_FUNDS_REQUIRED/);
 assert.equal(Number((await db.query('select count(*) n from uc_bank_movements')).rows[0].n),beforeOwnership);
 assert.equal(Number((await db.query("select uc_company_paid_cents('ownership-floor-bill') n")).rows[0].n),0);
 const allowedOwnership={...badOwnership,bankReference:'company-owned amount only',requestId:req(),allocations:[{paymentId:'ownership-floor-bill',amountCents:companyCash,documentId:ownedReceipt}]};
 await money('d','record',allowedOwnership);
 assert.equal(Number((await money('d','banks')).company.companyCashCents),0);
 assert.equal(Number((await money('d','banks')).company.investorOwnedCents),500000);
 assert.equal((await money('d','record',allowedOwnership)).payments[0].id,'ownership-floor-bill');
 console.log('PASS company-bank payments: proof/invoice/accrual gates, partial balance, atomic journal and status, registered bank, replay, cross-payment reference, rollback and ACL');
}finally{await db.close();}
