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
 await db.exec("alter table payments add column if not exists repair_job_id text;alter table payments add column if not exists misc_cost_id text;alter table cars add column if not exists disbursement_charges jsonb;alter table cars add column if not exists panel_charge_amount numeric;alter table cars add column if not exists panel_dealer_id text");
 await db.exec("create table dealers(id text primary key,name text,\"bankName\" text,\"bankAccountNumber\" text,\"bankAccountHolder\" text);insert into dealers values('dealer-one','Dealer One','Bank','123456','Dealer One'),('dealer','Dealer','Bank','654321','Dealer')");
 await db.exec(migration('20261105080000_incoming_consignment_finance.sql'));
 let n=0;const req=()=> 'consign_test_'+String(++n).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cf=(action,data={})=>call('uc_consignment_finance','d',action,data);
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Bank',openingDate:day,openingCents:10000000,requestId:req()})).bank;
 const bankData=()=>({paidOn:day,bankAccountId:bank.id,bankReference:req()});
 await db.exec("insert into cars(id,make,model,colour,status,purchase_price,settlement_amount,consignment,waive_commission) values('consign-one','Toyota','Vios','White','delivered',50000,0,'{\"terms\":\"profit_split\",\"splitPercent\":30,\"dealer\":\"Dealer One\"}',true);insert into customers(id,name,interested_car_id,cash_work_order) values('consign-customer','Buyer','consign-one','{\"sellingPrice\":70000}')");
 const preview=(await cf('preview_open',{carId:'consign-one'})).preview;
 await assert.rejects(()=>call('uc_consignment_finance','a','open',{carId:'consign-one',expectedRevision:preview.sourceRevision,requestId:req()}),/NOT_ALLOWED/);
 const body={carId:'consign-one',expectedRevision:preview.sourceRevision,requestId:req()};const opened=await cf('open',body);assert.equal(opened.case.revenue_cents,7000000);assert.equal(opened.car.consignment_finance_open,true);assert.equal((await cf('open',body)).case.car_id,'consign-one');await assert.rejects(()=>cf('open',{...body,expectedRevision:'changed'}),/REQUEST_CHANGED/);
 const customerPay=opened.case.customer_payment_id;
 const evidence=async(paymentId,kind)=>{const d=await call('uc_company_evidence','d','prepare',{paymentId,kind,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_company_evidence','d','confirm',{documentId:d.documentId});return d.documentId;};
 const cashProof=await evidence(customerPay,'payment');const cash=await call('uc_company_bank_receipt','d','record',{paymentId:customerPay,amountCents:2000000,receiptDocumentId:cashProof,...bankData(),requestId:req()});assert.equal(cash.car.money_received,false);
 const held=(await call('uc_company_bank_money','d','banks',{})).company;assert.equal(held.consignmentHeldCents,2000000);assert.equal(held.availableCents,10000000);
 const contract=await cf('proof_prepare',{carId:'consign-one',fileName:'agreement.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0')});await db.query("insert into storage.objects values('finance-evidence',$1)",[contract.path]);await cf('proof_confirm',{documentId:contract.documentId});
 await db.exec("insert into repairs(id,car_id,status,actual_cost,total_cost) values('consign-repair','consign-one','done',3500,3500);insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,repair_job_id) values('consign-repair-bill','consign-one','repair','pending',3500,'workshop','workshop','Workshop','consign-repair')");
 assert.equal((await cf('snapshot',{carId:'consign-one'})).reviewIssue,'SUPPLIER_INVOICE_REQUIRED');await evidence('consign-repair-bill','invoice');
 const review=(await cf('snapshot',{carId:'consign-one'})).review;assert.equal(review.costCents,350000);assert.equal(review.dealerPayableCents,5495000);assert.equal(review.companyResultCents,1155000);
 await assert.rejects(()=>cf('approve',{carId:'consign-one',expectedRevision:'0'.repeat(32),costsConfirmed:true,requestId:req()}),/SOURCE_CHANGED/);
 // Withholding cannot bypass the unapproved panel bill gate.
 await db.exec('BEGIN');
 await db.exec("insert into payments(id,car_id,type,status,amount,recipient_name) values('unapproved-panel','consign-one','panel_charge','pending',100,'Panel dealer')");
 const panelProof=await evidence('unapproved-panel','payment'),panelCashProof=await evidence(customerPay,'payment');
 await assert.rejects(()=>call('uc_company_bank_receipt','d','record',{paymentId:customerPay,amountCents:10000,receiptDocumentId:panelCashProof,withheldBills:[{paymentId:'unapproved-panel',amountCents:10000,documentId:panelProof}],...bankData(),requestId:req()}),/PAYMENT_WORKFLOW_REQUIRED/);
 await db.exec('ROLLBACK');
 // A forged matching-amount payout cannot become the approved beneficiary.
 await db.exec('BEGIN');
 await db.query("insert into payments(id,car_id,type,status,amount,recipient_name,account_number) values('forged-payout','consign-one','consignment_payout','pending',54950,'Attacker','wrong')");
 const forgedReview=(await cf('snapshot',{carId:'consign-one'})).review;
 await assert.rejects(()=>cf('approve',{carId:'consign-one',expectedRevision:forgedReview.sourceRevision,costsConfirmed:true,requestId:req()}),/EXISTING_PAYMENT_REVIEW_REQUIRED/);
 await db.exec('ROLLBACK');
 const approved=await cf('approve',{carId:'consign-one',expectedRevision:review.sourceRevision,costsConfirmed:true,requestId:req()});assert.equal(approved.case.approved_by,'d');assert.equal(approved.case.settlement.companyResultCents,1155000);
 assert.equal(Number((await db.query("select coalesce(sum((l->>'credit')::numeric-(l->>'debit')::numeric),0) amount from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.car_id='consign-one' and l->>'accountId'='acct-consign-clearing'")).rows[0].amount),0);
 const dealerPay=approved.case.dealer_payment_id,proof=await evidence(dealerPay,'payment');const pay={...bankData(),allocations:[{paymentId:dealerPay,amountCents:1000000,documentId:proof}],requestId:req()};
 await assert.rejects(()=>call('uc_company_bank_money','d','record',pay),/SUPPLIER_INVOICE_REQUIRED/);await evidence(dealerPay,'invoice');const paid=await call('uc_company_bank_money','d','record',pay);assert.equal(paid.payments[0].bank_paid_cents,1000000);assert.equal(paid.payments[0].status,'pending');
 assert.equal((await db.query('select uc_registered_bank_position($1) cents',[bank.id])).rows[0].cents,11000000);
 await assert.rejects(()=>db.exec("update payments set amount=1 where id='"+dealerPay+"'"),/CONSIGNMENT_HISTORY_LOCKED|EVIDENCE_REVIEW_REQUIRED|BANK_PAYMENT_IMMUTABLE/);
 await assert.rejects(()=>db.exec("update cars set consignment='{}' where id='consign-one'"),/USE_CONSIGNMENT_FINANCE/);
 await assert.rejects(()=>db.exec("update cars set money_received=true where id='consign-one'"),/USE_CONSIGNMENT_FINANCE/);
 await assert.rejects(()=>db.exec("update customers set cash_work_order='{\"sellingPrice\":1}' where id='consign-customer'"),/CONSIGNMENT_HISTORY_LOCKED/);
 const rest=await evidence(customerPay,'payment');const received=await call('uc_company_bank_receipt','d','record',{paymentId:customerPay,amountCents:5000000,receiptDocumentId:rest,...bankData(),requestId:req()});assert.equal(received.car.money_received,true);
 const makeCase=async(id,{terms='profit_split',price=45000,lender=0,loan=null,booking=0,purchase=50000}={})=>{
  await db.query("insert into cars(id,make,model,colour,status,purchase_price,settlement_amount,settlement_recipient,consignment,waive_commission) values($1,'Toyota','Vios','White','delivered',$2,$3,'Lender',$4,true)",[id,purchase,lender,{terms,splitPercent:57.25,fixedAmount:purchase,dealer:'Dealer'}]);
  const wo={sellingPrice:price,bookingFee:booking,...(loan!==null?{loanAmount:loan}:{})};
  await db.query('insert into customers(id,name,interested_car_id,cash_work_order,loan_work_order) values($1,$2,$3,$4,$5)',[id+'-buyer','Buyer',id,loan===null?wo:null,loan!==null?wo:null]);
  const pv=(await cf('preview_open',{carId:id})).preview;const opened=await cf('open',{carId:id,expectedRevision:pv.sourceRevision,requestId:req()});
  const doc=await cf('proof_prepare',{carId:id,fileName:'agreement.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0')});await db.query("insert into storage.objects values('finance-evidence',$1)",[doc.path]);await cf('proof_confirm',{documentId:doc.documentId});return opened;
 };
 const approve=async id=>{const rv=(await cf('snapshot',{carId:id})).review;assert.ok(rv);const data={carId:id,expectedRevision:rv.sourceRevision,costsConfirmed:true,requestId:req()};const a=await cf('approve',data);assert.equal((await cf('approve',data)).case.approved_at,a.case.approved_at);return a;};
 const loss=await makeCase('loss-case',{lender:10000});const lossClosed=await approve('loss-case');assert.equal(lossClosed.case.settlement.companyResultCents,0);assert.equal(lossClosed.case.settlement.dealerLossCents,500000);assert.equal(lossClosed.case.settlement.dealerPayableCents,3500000);
 const lp=loss.case.lender_payment_id;await evidence(lp,'invoice');const lpr=await evidence(lp,'payment');await call('uc_company_bank_money','d','record',{...bankData(),allocations:[{paymentId:lp,amountCents:500000,documentId:lpr}],requestId:req()});assert.equal((await cf('snapshot',{carId:'loss-case'})).payments.find(p=>p.id===lp).bank_paid_cents,500000);
 await makeCase('fixed-case',{terms:'fixed_amount',lender:10000});const fixed=await approve('fixed-case');assert.equal(fixed.case.settlement.dealerPayableCents,4000000);assert.equal(fixed.case.settlement.companyResultCents,-500000);assert.equal(fixed.case.settlement.dealerLossCents,0);
 // Loss beyond capital is a receivable from this dealer, not a hidden company loss.
 await makeCase('debt-case',{price:5000});await db.exec("insert into repairs(id,car_id,status,actual_cost,total_cost) values('debt-repair','debt-case','done',10000,10000);insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,repair_job_id) values('debt-bill','debt-case','repair','pending',10000,'workshop','workshop','Workshop','debt-repair')");await evidence('debt-bill','invoice');
 const debt=await approve('debt-case');assert.equal(debt.case.settlement.dealerPayableCents,0);assert.equal(debt.case.settlement.companyResultCents,0);assert.equal(debt.case.settlement.dealerOwesCompanyCents,500000);
 const recovery=debt.case.recovery_payment_id,dp=await evidence(recovery,'payment');const rb={paymentId:recovery,amountCents:250000,receiptDocumentId:dp,...bankData(),requestId:req()};const rc=await call('uc_company_bank_receipt','d','record',rb);assert.equal(rc.payments[0].bank_paid_cents,250000);assert.equal((await call('uc_company_bank_receipt','d','record',rb)).receiptId,rc.receiptId);
 const dp2=await evidence(recovery,'payment');await call('uc_company_bank_receipt','d','record',{paymentId:recovery,amountCents:250000,receiptDocumentId:dp2,...bankData(),requestId:req()});assert.equal((await cf('snapshot',{carId:'debt-case'})).payments.find(p=>p.id===recovery).status,'transferred');
 // Bank-loan excess stays refundable; the booking is still uncollected until proved.
 const over=await makeCase('overloan-case',{price:60000,loan:70000,booking:10000});assert.equal(over.case.loan_cents,5000000);assert.equal(over.payments.find(p=>p.id===over.case.customer_payment_id).amount,10000);
 const op=await evidence(over.case.loan_payment_id,'payment');const overReceipt=await call('uc_company_bank_receipt','d','record',{paymentId:over.case.loan_payment_id,amountCents:7000000,excessCents:2000000,customerId:'overloan-case-buyer',receiptDocumentId:op,...bankData(),requestId:req()});assert.equal(overReceipt.car.money_received,false);assert.ok(overReceipt.payments.some(p=>p.type==='customer_refund'&&p.amount===20000));
 const bookProof=await evidence(over.case.customer_payment_id,'payment');assert.equal((await call('uc_company_bank_receipt','d','record',{paymentId:over.case.customer_payment_id,amountCents:1000000,receiptDocumentId:bookProof,...bankData(),requestId:req()})).car.money_received,true);
 const overApproved=await approve('overloan-case');assert.equal(overApproved.case.settlement.netProfitCents,1000000);
 // Withheld cost clears its existing AP without a second expense or bank outflow.
 const wh=await makeCase('withheld-case',{price:10000,purchase:5000});await db.exec("insert into repairs(id,car_id,status,actual_cost,total_cost) values('wh-repair','withheld-case','done',1000,1000);insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,repair_job_id) values('wh-bill','withheld-case','repair','pending',1000,'workshop','w','Workshop','wh-repair');insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('wh-accrual',current_date,'Repair','repair','wh-bill','withheld-case','[{\"accountId\":\"acct-inv-own\",\"debit\":1000,\"credit\":0},{\"accountId\":\"acct-ap\",\"debit\":0,\"credit\":1000}]')");await evidence('wh-bill','invoice');const wd=await evidence('wh-bill','payment'),wr=await evidence(wh.case.customer_payment_id,'payment');const moveCount=Number((await db.query('select count(*) n from uc_bank_movements')).rows[0].n);
 await call('uc_company_bank_receipt','d','record',{paymentId:wh.case.customer_payment_id,amountCents:900000,receiptDocumentId:wr,withheldBills:[{paymentId:'wh-bill',amountCents:100000,documentId:wd}],...bankData(),requestId:req()});assert.equal(Number((await db.query('select count(*) n from uc_bank_movements')).rows[0].n),moveCount+1);const whClose=await approve('withheld-case');assert.equal(whClose.case.settlement.costCents,100000);assert.equal(whClose.payments.find(p=>p.id==='wh-bill').status,'transferred');
 assert.equal(Number((await db.query("select sum((l->>'debit')::numeric-(l->>'credit')::numeric) amount from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.car_id='withheld-case' and l->>'accountId'='acct-inv-own'")).rows[0].amount),0);
 assert.equal((await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n,0);

 // Exercise the real database permissions, not only the API's role switch.
 await db.exec("insert into garage_building_staff(id,name,username,password,role,business_access,registration_status) values('sh','Shareholder','shareholder','discarded','shareholder','used_car','active')");
 for(const actor of ['a','sh']){
  const view=await call('uc_consignment_finance',actor,'snapshot',{carId:'consign-one'});assert.equal(view.case.car_id,'consign-one');assert.ok(view.payments.every(p=>!['salary','allowance','campaign_bonus'].includes(p.type)));
  await assert.rejects(()=>call('uc_consignment_finance',actor,'approve',{carId:'consign-one',expectedRevision:'a'.repeat(32),costsConfirmed:true,requestId:req()}),/NOT_ALLOWED/);
 }
 for(const actor of ['s','i','peer'])await assert.rejects(()=>call('uc_consignment_finance',actor,'snapshot',{carId:'consign-one'}),/NOT_ALLOWED/);
 await db.exec("update garage_building_staff set enabled=false where id='sh'");await assert.rejects(()=>call('uc_consignment_finance','sh','snapshot',{carId:'consign-one'}),/NOT_ALLOWED/);
 // Director-only terms correction preserves history, requires fresh agreement and posts no cash/journal.
 await makeCase('correction-case',{price:70000});const beforeCorrection=await cf('snapshot',{carId:'correction-case'});
 const correction={carId:'correction-case',expectedRevision:beforeCorrection.termsRevision,dealerBasisPoints:4000,reason:'Agreed dealer share was entered wrongly',requestId:req()};
 const journalBefore=Number((await db.query('select count(*) n from journal_entries')).rows[0].n),cashBefore=Number((await db.query('select count(*) n from uc_bank_movements')).rows[0].n);
 await assert.rejects(()=>call('uc_consignment_finance','a','correct_terms',correction),/NOT_ALLOWED/);
 await assert.rejects(()=>cf('correct_terms',{...correction,reason:'bad'}),/CORRECTION_REASON_REQUIRED/);
 const pendingAgreement=await cf('proof_prepare',{carId:'correction-case',fileName:'pending-agreement.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0')});await db.query("insert into storage.objects values('finance-evidence',$1)",[pendingAgreement.path]);
 await db.exec('BEGIN');await db.query("select set_config('autodream.consignment_write',txid_current()::text||':correction-case',true)");await assert.rejects(()=>db.exec("update uc_consignment_cases set dealer_basis_points=9000 where car_id='correction-case'"),/IMMUTABLE_HISTORY/);await db.exec('ROLLBACK');
 const corrected=await cf('correct_terms',correction);assert.equal(corrected.case.dealer_basis_points,4000);assert.equal(corrected.corrections.length,1);assert.equal(corrected.corrections[0].before_terms.dealerBasisPoints,5725);assert.equal(corrected.corrections[0].actorName,'Director');assert.equal(corrected.agreementReviewRequired,true);
 assert.equal((await cf('correct_terms',correction)).corrections.length,1);
 await assert.rejects(()=>cf('proof_confirm',{documentId:pendingAgreement.documentId}),/AGREEMENT_TERMS_CHANGED/);
 assert.equal(corrected.documents.every(d=>d.currentTerms===false),true);
 assert.equal(corrected.corrections[0].expected_revision,beforeCorrection.termsRevision);
 await assert.rejects(()=>cf('correct_terms',{...correction,reason:'Different retry payload'}),/REQUEST_CHANGED/);
 await assert.rejects(()=>cf('correct_terms',{...correction,requestId:req()}),/SOURCE_CHANGED/);
 await assert.rejects(()=>approve('correction-case'),/CONSIGNMENT_CONTRACT_REQUIRED/);
 const fresh=await cf('proof_prepare',{carId:'correction-case',fileName:'corrected-agreement.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0')});await db.query("insert into storage.objects values('finance-evidence',$1)",[fresh.path]);await cf('proof_confirm',{documentId:fresh.documentId});
 assert.equal(Number((await db.query('select count(*) n from journal_entries')).rows[0].n),journalBefore);assert.equal(Number((await db.query('select count(*) n from uc_bank_movements')).rows[0].n),cashBefore);
 const correctionClosed=await approve('correction-case');assert.equal(correctionClosed.case.settlement.dealerProfitCents,800000);
 await assert.rejects(()=>cf('correct_terms',{...correction,expectedRevision:correctionClosed.termsRevision,requestId:req()}),/CONSIGNMENT_APPROVED_CORRECTION_REQUIRED/);
 await assert.rejects(()=>db.exec("delete from uc_consignment_corrections where car_id='correction-case'"),/IMMUTABLE_HISTORY/);
 await makeCase('fixed-correction',{terms:'fixed_amount'});const fr=await cf('snapshot',{carId:'fixed-correction'});const fc=await cf('correct_terms',{carId:'fixed-correction',expectedRevision:fr.termsRevision,fixedAmountCents:4800000,reason:'Correct agreed fixed dealer amount',requestId:req()});assert.equal(fc.case.fixed_cents,4800000);assert.equal(fc.car.consignment.fixedAmount,48000);assert.equal(fc.review.companyResultCents,-300000);
 // Legacy purchase postings must be reviewed instead of accruing the car twice.
 // Approved beneficiaries and per-bill ceilings cannot borrow another bill's AP.
 await assert.rejects(()=>db.query("update payments set account_number='attacker' where id=$1",[dealerPay]),/CONSIGNMENT_HISTORY_LOCKED|BANK_PAYMENT_IMMUTABLE/);
 assert.equal(Number((await db.query('select uc_consignment_bill_limit($1) cents',[dealerPay])).rows[0].cents),5495000);
 await assert.rejects(()=>db.exec("insert into journal_entries(id,date,description,source_type,source_id,lines) values('fake-paid',current_date,'Fake bank payment','consignment_payout_paid','"+dealerPay+"','[]')"),/USE_CONSIGNMENT_FINANCE|BANK_PAYMENT/);
 // An ambiguous beneficiary is refused before any case or money is recorded.
 await db.exec("insert into dealers values('duplicate','dealer','Bank','987','Duplicate')");
 await db.exec("insert into cars(id,make,model,colour,status,purchase_price,consignment,waive_commission) values('ambiguous-case','Toyota','Vios','White','delivered',5000,'{\"terms\":\"profit_split\",\"splitPercent\":30,\"dealer\":\"Dealer\"}',true);insert into customers(id,name,interested_car_id,cash_work_order) values('ambiguous-buyer','Buyer','ambiguous-case','{\"sellingPrice\":10000}')");
 await assert.rejects(()=>cf('preview_open',{carId:'ambiguous-case'}),/DEALER_PROFILE_REVIEW_REQUIRED/);
 await db.exec("delete from dealers where id='duplicate'");
 await db.exec("insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('legacy-consign-purchase',current_date,'Legacy purchase','car_purchased','ambiguous-case','ambiguous-case','[]')");
 const oldPreview=(await cf('preview_open',{carId:'ambiguous-case'})).preview;
 await assert.rejects(()=>cf('open',{carId:'ambiguous-case',expectedRevision:oldPreview.sourceRevision,requestId:req()}),/CONSIGNMENT_HISTORY_REVIEW_REQUIRED/);
 assert.equal((await db.query("select has_function_privilege('anon','uc_consignment_finance(text,text,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS incoming consignment: private Director case, held receipts, source costs and invoice gates, signed settlement, partial payouts, immutable source and balanced actual-bank accounting');
}finally{await db.close();}
