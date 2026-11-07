// Disposable local database only. Never connects to Supabase.
// Company direct supplier credits, proof-backed refunds and outgoing cost adjustments.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const root=process.argv[2];if(!root)throw Error('Supply the temporary PGlite package path.');
const {createFinanceRehearsal}=await import('./helpers/finance-rehearsal.mjs');const db=await createFinanceRehearsal(root);
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
 create table payments(id text primary key,car_id text,type text constraint payments_type_check check(type in ('salesman_commission','intake_bonus','source_commission','repair','misc_cost','consignment_payout','consignment_collection','panel_charge','investor_payout','customer_refund','customer_collection','loan_disbursement','expense_claim','purchase_settlement','salary','allowance','campaign_bonus')),status text,amount numeric,claim_confirmed_by text,claim_confirmed_at timestamptz,description text,recipient_name text);
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


 await db.exec("alter table payments add column recipient_type text constraint payments_recipient_type_check check(recipient_type in ('user','external_salesman','workshop','dealer','merchant','customer'));alter table payments add column recipient_id text");
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
 await db.exec(migration('20261105090000_consignment_bill_corrections.sql'));
 await db.exec(migration('20261105110000_investor_withdrawal_destinations.sql'));
 await db.exec(migration('20261105120000_finance_opening_review.sql'));
 await db.exec(migration('20261105130000_consignment_settlement_adjustments.sql'));
 await db.exec(migration('20261105140000_consignment_supplier_adjustments.sql'));
 await db.exec('alter table cars add column delivery_collected boolean');
 await db.exec(migration('20261105141201_outgoing_consignment_collections.sql'));await db.exec(migration('20261105150000_company_panel_bills.sql'));
 await assert.rejects(()=>db.exec("update cars set investor_id='i' where id='car-own'"),/USE_INVESTOR_ACCOUNTS/);
 await assert.rejects(()=>db.exec("insert into journal_entries(id,date,description,source_type,source_id,lines) values('legacy-investor-bypass',current_date,'Legacy investor write','car_sold','old','[{\"accountId\":\"acct-inv-investor\",\"debit\":1,\"credit\":0},{\"accountId\":\"acct-investor-payable\",\"debit\":0,\"credit\":1}]')"),/USE_INVESTOR_POSTING/);
 await db.exec(migration('20261106112115_company_bill_adjustments.sql'));
 let n=0;const req=()=> 'company_bill_test_'+String(++n).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Bank',openingDate:day,openingCents:10000000,requestId:req()})).bank;
 const bankData=()=>({paidOn:day,bankAccountId:bank.id,bankReference:req()});
 const evidence=async(paymentId,kind)=>{const d=await call('uc_company_evidence','d','prepare',{paymentId,kind,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_company_evidence','d','confirm',{documentId:d.documentId});return d.documentId;};
 const adjust=(action,data)=>call('uc_company_bill_adjustment','d',action,data);
 const paid=async(id,amount)=>call('uc_company_bank_money','d','record',{...bankData(),allocations:[{paymentId:id,amountCents:amount,documentId:await evidence(id,'payment')}],requestId:req()});
 const receipt=async(id,amount)=>call('uc_company_bank_receipt','d','record',{...bankData(),paymentId:id,amountCents:amount,receiptDocumentId:await evidence(id,'payment'),requestId:req()});
 const revise=async(id,total)=>{const data={paymentId:id,amountCents:total,invoiceDocumentId:await evidence(id,'invoice'),reason:'Supplier revised their final invoice'};const p=await adjust('preview',data);return{data:{...data,expectedRevision:p.sourceRevision,requestId:req()},preview:p};};
 await db.exec(`insert into cars(id,make,model,status,purchase_price) values('bill-car','Toyota','Vios','available',50000);insert into repairs(id,car_id,status,actual_cost,total_cost) values('bill-repair','bill-car','done',3500,3500);insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,repair_job_id) values('bill-original','bill-car','repair','pending',3500,'workshop','workshop','Workshop','bill-repair');insert into journal_entries(id,date,description,source_type,source_id,car_id,created_by,lines) values('bill-accrual',current_date,'Repair bill','repair','bill-original','bill-car','d','[{"accountId":"acct-inv-own","debit":3500,"credit":0},{"accountId":"acct-ap","debit":0,"credit":3500}]')`);
 await evidence('bill-original','invoice');await paid('bill-original',300000);
 const a=await revise('bill-original',250000);assert.equal(a.preview.receivableCents,50000);assert.equal(a.preview.costAccount,'acct-inv-own');
 await assert.rejects(()=>call('uc_company_bill_adjustment','a','apply',a.data),/NOT_ALLOWED/);
 await assert.rejects(()=>adjust('apply',{...a.data,expectedRevision:'0'.repeat(32)}),/SOURCE_CHANGED/);
 const before=Number((await db.query('select count(*) n from uc_bank_movements')).rows[0].n);
 const corrected=await adjust('apply',a.data);assert.equal(corrected.payments.find(p=>p.id==='bill-original').amount,3500);assert.equal(corrected.payments.find(p=>p.id==='bill-original').obligation_replaced,true);
 assert.equal((await adjust('apply',a.data)).adjustmentId,corrected.adjustmentId);assert.equal(Number((await db.query('select count(*) n from uc_bank_movements')).rows[0].n),before);
 await assert.rejects(()=>adjust('apply',{...a.data,reason:'Changed after response loss'}),/REQUEST_CHANGED/);
 const refund=corrected.payments.find(p=>p.type==='supplier_credit_collection');assert.equal(refund.amount,500);await receipt(refund.id,50000);
 assert.equal(Number((await db.query("select actual_cost from repairs where id='bill-repair'")).rows[0].actual_cost),2500);
 await assert.rejects(()=>db.exec("update repairs set actual_cost=2000 where id='bill-repair'"),/COMPANY_BILL_ADJUSTMENT_REQUIRED/);
 await assert.rejects(()=>db.exec("update payments set amount=1 where id='bill-original'"),/BANK_PAYMENT_IMMUTABLE|COMPANY_BILL_ADJUSTMENT_REQUIRED/);
 const b=await revise('bill-original',400000);assert.equal(b.preview.payableCents,150000);const more=await adjust('apply',b.data);const extra=more.payments.find(p=>p.type==='repair'&&p.id!=='bill-original'&&!p.obligation_replaced);assert.equal(extra.amount,1500);await paid(extra.id,150000);
 const balances=async(account)=>(await db.query("select coalesce(sum(((l->>'debit')::numeric-(l->>'credit')::numeric)*100),0) cents from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.car_id='bill-car' and l->>'accountId'=$1",[account])).rows[0].cents;
 assert.equal(Number(await balances('acct-ap')),0);assert.equal(Number(await balances('acct-supplier-credit')),0);assert.equal(Number(await balances('acct-inv-own')),400000);
 await assert.rejects(()=>db.exec("insert into payments(id,car_id,type,status,amount,repair_job_id) values('duplicate-corrected-bill','bill-car','repair','pending',4000,'bill-repair')"),/COMPANY_BILL_ADJUSTMENT_REQUIRED/);
 const zero=await revise('bill-original',0);const credited=await adjust('apply',zero.data);assert.equal(Number((await adjust('snapshot',{paymentId:'bill-original'})).totalCents),0);const fullRefund=credited.payments.find(p=>p.type==='supplier_credit_collection'&&!p.obligation_replaced);assert.equal(fullRefund.amount,4000);await receipt(fullRefund.id,400000);assert.equal(Number(await balances('acct-inv-own')),0);assert.equal(Number(await balances('acct-supplier-credit')),0);
 // A later revised bill can reopen a fully credited family without touching history.
 const reopened=await revise('bill-original',100000);assert.equal(reopened.preview.payableCents,100000);await adjust('apply',reopened.data);
 // Corrected company stock can still be sold through a dealer and its reviewed effective costs count once.
 const sendData={carId:'bill-car',dealer:'Dealer',amountCents:6000000,soldOn:day};const sendReview=await call('uc_outgoing_send','d','prepare_send',sendData);const sent=await call('uc_outgoing_send','d','send',{...sendData,expectedRevision:sendReview.sourceRevision,requestId:req()});
 const dealerInvoice=await evidence(sent.paymentId,'invoice');const dealerReview=await call('uc_outgoing_collection','d','review',{paymentId:sent.paymentId});await call('uc_outgoing_collection','d','approve',{paymentId:sent.paymentId,expectedRevision:dealerReview.sourceRevision,reviewConfirmed:true,requestId:req()});
 const costReview=await call('uc_outgoing_collection','d','review_costs',{paymentId:sent.paymentId});assert.equal(costReview.carCostCents,100000);assert.equal(costReview.netProfitCents,900000);assert.equal(costReview.missingPurchaseCents,5000000);
 await call('uc_outgoing_collection','d','close_costs',{paymentId:sent.paymentId,expectedRevision:costReview.sourceRevision,purchaseInvoiceId:dealerInvoice,missingPurchaseAcknowledged:true,reviewConfirmed:true,requestId:req()});
 const postClose=await revise('bill-original',150000);assert.equal(postClose.preview.costAccount,'acct-cogs-own');await adjust('apply',postClose.data);assert.equal(Number(await balances('acct-inv-own')),0);assert.equal(Number(await balances('acct-cogs-own')),5150000);
 await assert.rejects(()=>db.exec("update repairs set actual_cost=1 where id='bill-repair'"),/COMPANY_BILL_ADJUSTMENT_REQUIRED|OUTGOING_COST_ADJUSTMENT_REQUIRED/);
 // A refund on an outgoing closed car uses proof-backed physical bank receipt only.
 const postClosePaid=(await db.query("select id from payments where car_id='bill-car' and type='repair' and not obligation_replaced")).rows[0].id;await paid(postClosePaid,150000);const postCloseCredit=await revise('bill-original',125000);const pcc=await adjust('apply',postCloseCredit.data);await receipt(pcc.payments.find(p=>p.type==='supplier_credit_collection'&&!p.obligation_replaced).id,25000);assert.equal(Number(await balances('acct-supplier-credit')),0);assert.equal(Number(await balances('acct-cogs-own')),5125000);
 // Misc costs paid by withheld sale money are settled amounts, not unpaid bills.
 await db.exec(`insert into cars(id,make,model,status,purchase_price,misc_costs) values('misc-car','Honda','City','available',20000,'[{"id":"petrol-one","amount":1000,"description":"Petrol"}]');insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,misc_cost_id) values('misc-original','misc-car','misc_cost','pending',1000,'merchant','station','Station','petrol-one');insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name) values('misc-receivable','misc-car','loan_disbursement','pending',10000,'customer','buyer','Buyer');insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('misc-accrual',current_date,'Petrol bill','misc_cost','misc-original','misc-car','[{"accountId":"acct-inv-own","debit":1000,"credit":0},{"accountId":"acct-ap","debit":0,"credit":1000}]')`);
 await evidence('misc-original','invoice');const withheldProof=await evidence('misc-original','payment');await call('uc_company_bank_receipt','d','record',{paymentId:'misc-receivable',amountCents:900000,withheldBills:[{paymentId:'misc-original',amountCents:100000,documentId:withheldProof}],receiptDocumentId:await evidence('misc-receivable','payment'),...bankData(),requestId:req()});
 const misc=await revise('misc-original',80000);assert.equal(misc.preview.receivableCents,20000);const mc=await adjust('apply',misc.data);await receipt(mc.payments.find(p=>p.type==='supplier_credit_collection').id,20000);
 await db.exec(`update cars set misc_costs=misc_costs||'[{"id":"unrelated-cost","amount":20}]'::jsonb where id='misc-car'`);await assert.rejects(()=>db.exec(`update cars set misc_costs='[]' where id='misc-car'`),/COMPANY_BILL_ADJUSTMENT_REQUIRED/);
 await assert.rejects(()=>db.exec("delete from journal_entries where id='misc-accrual'"),/BANK_PAYMENT_IMMUTABLE|COMPANY_BILL_ADJUSTMENT_REQUIRED/);
 assert.equal((await db.query("select has_table_privilege('anon','uc_company_bill_adjustments','SELECT') allowed")).rows[0].allowed,false);assert.equal((await db.query("select has_function_privilege('authenticated','uc_company_bill_adjustment(text,text,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
 // Unpaid corrections still need a NEW document, and the replaced original
 // must not be paid a second time by deduction from a loan receipt.
 await db.exec(`insert into cars(id,make,model,status,purchase_price) values('withheld-correction','Toyota','Vios','available',50000);insert into repairs(id,car_id,status,actual_cost,total_cost) values('withheld-repair','withheld-correction','done',3500,3500);insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name,repair_job_id) values('withheld-original','withheld-correction','repair','pending',3500,'workshop','workshop','Workshop','withheld-repair');insert into payments(id,car_id,type,status,amount,recipient_type,recipient_id,recipient_name) values('withheld-loan','withheld-correction','loan_disbursement','pending',4000,'customer','buyer','Buyer');insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values('withheld-accrual',current_date,'Repair','repair','withheld-original','withheld-correction','[{"accountId":"acct-inv-own","debit":3500,"credit":0},{"accountId":"acct-ap","debit":0,"credit":3500}]')`);
 const firstInvoice=await evidence('withheld-original','invoice');assert.equal((await adjust('snapshot',{paymentId:'withheld-original'})).invoices.length,0);
 await assert.rejects(()=>adjust('preview',{paymentId:'withheld-original',amountCents:250000,invoiceDocumentId:firstInvoice,reason:'Supplier revised invoice amount'}),/SUPPLIER_INVOICE_REQUIRED/);
 const wh=await revise('withheld-original',250000);const changedWithheld=await adjust('apply',wh.data);const newWithheld=changedWithheld.payments.find(p=>p.type==='repair'&&!p.obligation_replaced);
 const oldProof=await evidence('withheld-original','payment'),loanProof=await evidence('withheld-loan','payment');const whBankCount=Number((await db.query('select count(*) n from uc_bank_movements')).rows[0].n);
 await assert.rejects(()=>call('uc_company_bank_receipt','d','record',{paymentId:'withheld-loan',amountCents:50000,withheldBills:[{paymentId:'withheld-original',amountCents:350000,documentId:oldProof}],receiptDocumentId:loanProof,...bankData(),requestId:req()}),/PAYMENT_WORKFLOW_REQUIRED/);
 assert.equal(Number((await db.query('select count(*) n from uc_bank_movements')).rows[0].n),whBankCount);
 await assert.rejects(()=>paid('withheld-original',350000),/PAYMENT_WORKFLOW_REQUIRED/);
 const whNewProof=await evidence(newWithheld.id,'payment');await call('uc_company_bank_receipt','d','record',{paymentId:'withheld-loan',amountCents:150000,withheldBills:[{paymentId:newWithheld.id,amountCents:250000,documentId:whNewProof}],receiptDocumentId:loanProof,...bankData(),requestId:req()});
 assert.equal(Number((await db.query('select uc_company_paid_cents($1) n',['withheld-original'])).rows[0].n),0);assert.equal(Number((await db.query('select uc_company_paid_cents($1) n',[newWithheld.id])).rows[0].n),250000);
 assert.equal(Number((await db.query("select sum(((l->>'debit')::numeric-(l->>'credit')::numeric)*100) n from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.car_id='withheld-correction' and l->>'accountId'='acct-ap'")).rows[0].n),0);
 if(db.isPostgres){
  const next=await revise('misc-original',90000);const increased=await adjust('apply',next.data);const pending=increased.payments.find(p=>p.type==='misc_cost'&&!p.obligation_replaced);const proof=await evidence(pending.id,'payment');const lowering=await revise('misc-original',85000);
  const first=await db.connection(),second=await db.connection();try{
   const race=await Promise.allSettled([first.query('select uc_company_bank_money($1,$2,$3) result',['d','record',{...bankData(),allocations:[{paymentId:pending.id,amountCents:10000,documentId:proof}],requestId:req()}]),second.query('select uc_company_bill_adjustment($1,$2,$3) result',['d','apply',lowering.data])]);
   assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.match(race.find(x=>x.status==='rejected').reason.message,/SOURCE_CHANGED|SUPPLIER_INVOICE_REQUIRED|PAYMENT_WORKFLOW_REQUIRED|PAYMENT_EXCEEDS_BALANCE/);
   const replayPlan=await revise('misc-original',95000);const duplicate=await Promise.all([first,second].map(c=>c.query('select uc_company_bill_adjustment($1,$2,$3) result',['d','apply',replayPlan.data])));assert.equal(duplicate[0].rows[0].result.adjustmentId,duplicate[1].rows[0].result.adjustmentId);
  }finally{await first.end();await second.end();}
 }
 console.log('PASS company supplier correction: immutable history, partial/full credits, actual refunds, reopened AP, corrected outgoing close + COGS amendments, withheld misc money, payment race, duplicate replay and ACL');
}finally{await db.close();}
