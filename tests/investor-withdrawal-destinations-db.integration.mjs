// Disposable local PGlite rehearsal only. Never connects to Supabase.
// node tests/investor-withdrawal-destinations-db.integration.mjs <path-to-pglite-package>
// Withdrawal payouts: Director-confirmed immutable destination at approval,
// payout bound to it with the receipt still required, exact retries, own-only
// investor reads, admin refused, and no reroute through profile edits.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const root=process.argv[2];if(!root)throw Error('Supply the temporary PGlite package path.');
const {PGlite}=await import(pathToFileURL(resolve(root,'dist/index.js')));const db=new PGlite();
const migration=n=>readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;
 create schema storage;create table storage.objects(bucket_id text not null,name text not null,primary key(bucket_id,name));
 create table garage_building_staff(id text primary key,name text,username text,password text,enabled boolean default true,role text,business_access text);
 create table garage_building_sessions(user_id text);
 create table users(id text primary key,name text,username text,password text,role text,business_access text,phone text,monthly_target numeric,cars_in_month integer,bank_name text,bank_account_number text,bank_account_holder text);
 create table cars(id text primary key,make text,model text,year integer,car_plate text,photo text,status text,investor_id text,investor_split numeric,trade_in_source_car_id text,purchase_price numeric,consignment jsonb,outgoing_consignment jsonb,misc_costs jsonb default '[]'::jsonb);
 create table repairs(id text primary key,car_id text references cars(id),type_of_repair text,parts jsonb default '[]',labour_cost numeric default 0,total_cost numeric default 0,status text,location text,receipt_photo text,actual_cost numeric,completed_at text,notes text);
 create table payments(id text primary key,car_id text,type text,status text,amount numeric,claim_confirmed_by text,claim_confirmed_at timestamptz,description text,recipient_name text);
 create table payslips(id text primary key,user_id text);
 create table investor_transactions(id text primary key);
 create table bank_transactions(id text primary key);
 create table bank_statement_uploads(id text primary key);
 insert into garage_building_staff(id,name,username,password,role,business_access) values('d','Director','director','discarded','director','both'),('d2','Second director','director2','discarded','director','both'),('a','Admin','admin','discarded','admin','used_car'),
  ('i','Own investor','investor','discarded','investor','used_car'),('other','Other investor','other','discarded','investor','used_car');
 insert into users(id,name,role,bank_name,bank_account_number,bank_account_holder) values('i','Own investor','investor','Profile Bank','111122223333','Own investor');
 insert into cars(id,make,model,status,purchase_price) values('car-own','Toyota','Vios','available',50000),('car-rival','Honda','City','available',50000);`);
 // Install order: every prepared migration through 20261105090000, then this one.
 await db.exec("select set_config('autodream.private_finance_ready','reviewed-20261104',false)");
 for(const file of ['20260720_ledger_accounts.sql','20260720_journal_entries.sql','20261021010000_autodream_staff_invitations.sql','20261104000000_investor_capital_foundation.sql',
  '20261104010000_investor_car_expenses.sql','20261104020000_investor_activation.sql','20261104030000_investor_journal_integration.sql','20261104040000_private_claim_posting.sql',
  '20261104050000_private_finance_lockdown.sql','20261104060000_investor_car_registration.sql','20261104070000_investor_repair_bills.sql','20261104080000_investor_misc_bills.sql',
  '20261104090000_investor_required_documents.sql'])await db.exec(migration(file));
 await db.exec('alter table payments add column recipient_type text;alter table payments add column recipient_id text');
 await db.exec(migration('20261104100000_company_payment_documents.sql'));
 await db.exec(migration('20261104110000_investor_money_documents.sql'));
 await db.exec(migration('20261104120000_investor_staff_claims.sql'));
 await db.exec(migration('20261104121000_investor_claim_invoice_access.sql'));
 await db.exec("insert into garage_building_staff(id,name,username,password,role,business_access) values('s','Staff','staff','discarded','salesperson','used_car')");
 await db.exec("alter table cars add column assigned_salesperson text;alter table cars add column sales_commission numeric;alter table cars add column is_recon boolean default false;alter table cars add column waive_commission boolean default false;alter table cars add column is_staff_sale boolean default false;alter table cars add column price_floor numeric;alter table cars add column intake_commission numeric;alter table cars add column source_commission numeric;alter table cars add column source_type text;alter table cars add column source_salesman_id text;alter table cars add column external_salesman_id text;alter table cars add column commission_credited_early boolean default false;alter table cars add column commission_credited_month text;alter table cars add column final_deal jsonb;alter table cars add column date_added text default '2026-11-01';alter table payments add column created_at timestamptz;alter table payments add column transferred_at timestamptz;alter table payments add column transferred_by text;alter table payments add column bank_name text;alter table payments add column account_number text;alter table payments add column account_holder text");
 await db.exec("create table customers(id text primary key,interested_car_id text,assigned_sales_id text,commission numeric,cash_work_order jsonb,loan_work_order jsonb,delivered boolean default false,delivered_at text);create table external_salesmen(id text primary key,name text,bank text,bank_account text)");
 await db.exec(migration('20261104130000_investor_commission_bills.sql'));
 await db.exec(migration('20261105010000_investor_sale_recoveries.sql'));
 await db.exec('alter table customers add column name text');
 await db.exec(migration('20261105000000_trade_in_funding_choices.sql'));await db.exec(migration('20261105020000_investor_trade_in_application.sql'));
 await db.exec('alter table cars add column settlement_amount numeric');
 await db.exec("alter table payments add column if not exists notes text;alter table payments add column if not exists receipt_url text");
 await db.exec(migration('20261105030000_company_bank_payments.sql'));
 await db.exec(migration('20261105040000_investor_trade_in_lenders.sql'));
 await db.exec("alter table cars add column if not exists money_received boolean default false;alter table cars add column if not exists disbursement_status text;alter table cars add column if not exists disbursement_amount numeric;alter table cars add column if not exists disbursement_expected_amount numeric;alter table cars add column if not exists disbursement_date text");
 await db.exec(migration('20261105050000_company_bank_receipts.sql'));await db.exec(migration('20261105060000_company_trade_in_application.sql'));
 await db.exec("alter table cars add column if not exists colour text;alter table cars add column if not exists settlement_recipient text");
 await db.exec(migration('20261105070000_company_car_purchases.sql'));
 await db.exec("alter table payments add column if not exists repair_job_id text;alter table payments add column if not exists misc_cost_id text;alter table cars add column if not exists disbursement_charges jsonb;alter table cars add column if not exists panel_charge_amount numeric;alter table cars add column if not exists panel_dealer_id text");
 await db.exec("create table dealers(id text primary key,name text,\"bankName\" text,\"bankAccountNumber\" text,\"bankAccountHolder\" text)");
 await db.exec(migration('20261105080000_incoming_consignment_finance.sql'));
 await db.exec(migration('20261105090000_consignment_bill_corrections.sql'));

 // A withdrawal approved before this migration: the one-time setup path.
 let n=0;const req=()=> 'withdraw_dest_'+String(++n).padStart(8,'0');
 const capital=async(actor,action,data={})=>(await db.query('select uc_investor_capital($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cmd=(actor,action,data={})=>capital(actor,action,{...data,requestId:req()});
 const evidence=async(actor,action,data)=>(await db.query('select uc_investor_money_evidence($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await db.query('select uc_investor_activation($1,$2,$3) result',['d','save_bank',{name:'Company bank',openingDate:day,openingCents:0,requestId:req()}])).rows[0].result.bank;
 const pay=()=>({paidOn:day,bankAccountId:bank.id,bankReference:req()});
 const profile=await cmd('d','create_profile',{name:'Own investor'}),potId=profile.potId;
 await cmd('d','link_account',{potId,staffId:'i'});await cmd('d','capital_received',{potId,amountCents:20000000,...pay()});
 const legacy=await cmd('i','request_withdrawal',{potId,amountCents:50000});await cmd('d','approve_withdrawal',{potId,withdrawalId:legacy.withdrawalId});

 await db.exec(migration('20261105110000_investor_withdrawal_destinations.sql'));
 await assert.rejects(()=>db.exec(migration('20261105110000_investor_withdrawal_destinations.sql')),/ALREADY_INSTALLED/);await db.exec('rollback');

 const receipt=async(withdrawalId,amountCents)=>{
  const doc=await evidence('d','prepare',{target:'withdrawal',withdrawalId,kind:'payment',amountCents,fileName:'transfer.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++n).toString(16).padStart(64,'0'),requestId:req()});
  await db.query("insert into storage.objects values('finance-evidence',$1)",[doc.path]);await evidence('d','confirm',{documentId:doc.documentId});return doc.documentId;
 };
 const dest={destinationBank:'  Maybank ',destinationHolder:'Own   investor',destinationAccount:'5140 1234 5678',destinationConfirmed:true};

 // Legacy approval: payout refused until the Director confirms a destination once.
 const legacyReceipt=await receipt(legacy.withdrawalId,50000);
 await assert.rejects(()=>cmd('d','withdrawal_paid',{potId,withdrawalId:legacy.withdrawalId,receiptDocumentId:legacyReceipt,...pay()}),/DESTINATION_REQUIRED/);
 await assert.rejects(()=>cmd('a','confirm_withdrawal_destination',{potId,withdrawalId:legacy.withdrawalId,...dest}),/NOT_ALLOWED/);
 await assert.rejects(()=>cmd('i','confirm_withdrawal_destination',{potId,withdrawalId:legacy.withdrawalId,...dest}),/NOT_ALLOWED/);
 await assert.rejects(()=>cmd('d','confirm_withdrawal_destination',{potId,withdrawalId:legacy.withdrawalId,...dest,destinationConfirmed:false}),/DESTINATION_NOT_CONFIRMED/);
 const setup={potId,withdrawalId:legacy.withdrawalId,...dest,requestId:req()};
 const setupDone=await capital('d','confirm_withdrawal_destination',setup);
 assert.deepEqual(await capital('d','confirm_withdrawal_destination',setup),setupDone);
 await assert.rejects(()=>capital('d','confirm_withdrawal_destination',{...setup,destinationAccount:'999999999'}),/REQUEST_CHANGED/);
 await assert.rejects(()=>cmd('d','confirm_withdrawal_destination',{potId,withdrawalId:legacy.withdrawalId,...dest,destinationAccount:'999999999'}),/DESTINATION_LOCKED/);
 assert.equal(setupDone.destination.accountNumber,'514012345678');assert.equal(setupDone.destination.bankName,'Maybank');assert.equal(setupDone.destination.accountHolder,'Own investor');

 // New approval needs the destination with it, Director confirmed.
 const w=await cmd('i','request_withdrawal',{potId,amountCents:100000});
 await assert.rejects(()=>cmd('d','approve_withdrawal',{potId,withdrawalId:w.withdrawalId}),/DESTINATION_REQUIRED/);
 await assert.rejects(()=>cmd('d','approve_withdrawal',{potId,withdrawalId:w.withdrawalId,...dest,destinationConfirmed:'yes'}),/DESTINATION_NOT_CONFIRMED/);
 await assert.rejects(()=>cmd('d','approve_withdrawal',{potId,withdrawalId:w.withdrawalId,...dest,destinationAccount:'12ab34'}),/DESTINATION_INVALID/);
 await assert.rejects(()=>cmd('a','approve_withdrawal',{potId,withdrawalId:w.withdrawalId,...dest}),/NOT_ALLOWED/);
 await assert.rejects(()=>cmd('i','approve_withdrawal',{potId,withdrawalId:w.withdrawalId,...dest}),/NOT_ALLOWED/);
 // The inner approval cannot be reached without a destination either.
 await assert.rejects(()=>db.query('select uc_capital_before_withdrawal_destinations($1,$2,$3)',['d','approve_withdrawal',{potId,withdrawalId:w.withdrawalId,requestId:req()}]),/DESTINATION_REQUIRED/);
 assert.equal((await db.query('select state from uc_investor_withdrawals where id=$1',[w.withdrawalId])).rows[0].state,'requested');
 const approval={potId,withdrawalId:w.withdrawalId,...dest,destinationAccount:'7001-2233-4455',requestId:req()};
 const approved=await capital('d','approve_withdrawal',approval);
 assert.deepEqual(await capital('d','approve_withdrawal',approval),approved);
 await assert.rejects(()=>capital('d','approve_withdrawal',{...approval,destinationAccount:'700122334456'}),/REQUEST_CHANGED/);
 await assert.rejects(()=>capital('d','approve_withdrawal',{...approval,destinationHolder:'Someone else'}),/REQUEST_CHANGED/);
 const destinationId=approved.destination.destinationId;
 assert.equal(approved.destination.accountNumber,'700122334455');

 // Profile edits and direct table writes cannot reroute it.
 await db.exec("update users set bank_name='Other Bank',bank_account_number='999988887777',bank_account_holder='Other person' where id='i'");
 await assert.rejects(()=>db.query("update uc_investor_withdrawal_destinations set account_number='999988887777' where id=$1",[destinationId]),/IMMUTABLE_HISTORY/);
 await assert.rejects(()=>db.query('delete from uc_investor_withdrawal_destinations where id=$1',[destinationId]),/IMMUTABLE_HISTORY/);
 await assert.rejects(()=>cmd('d','confirm_withdrawal_destination',{potId,withdrawalId:w.withdrawalId,...dest}),/DESTINATION_LOCKED/);

 // Payout: names the destination, still needs the bank receipt.
 await assert.rejects(()=>cmd('d','withdrawal_paid',{potId,withdrawalId:w.withdrawalId,destinationId,...pay()}),/PAYMENT_RECEIPT_REQUIRED/);
 const proof=await receipt(w.withdrawalId,100000);
 await assert.rejects(()=>cmd('d','withdrawal_paid',{potId,withdrawalId:w.withdrawalId,receiptDocumentId:proof,...pay()}),/DESTINATION_REQUIRED/);
 await assert.rejects(()=>cmd('d','withdrawal_paid',{potId,withdrawalId:w.withdrawalId,receiptDocumentId:proof,destinationId:setupDone.destination.destinationId,...pay()}),/DESTINATION_CHANGED/);
 await assert.rejects(()=>cmd('d','withdrawal_paid',{potId,withdrawalId:w.withdrawalId,receiptDocumentId:proof,destinationId,...pay(),destinationAccount:'1234567'}),/INVALID/);
 await assert.rejects(()=>cmd('a','withdrawal_paid',{potId,withdrawalId:w.withdrawalId,receiptDocumentId:proof,destinationId,...pay()}),/NOT_ALLOWED/);
 // The money-evidence layer alone cannot write a payout without the destination link.
 await assert.rejects(()=>db.query('select uc_capital_before_withdrawal_destinations($1,$2,$3)',['d','withdrawal_paid',{potId,withdrawalId:w.withdrawalId,receiptDocumentId:proof,...pay(),requestId:req()}]),/DESTINATION_REQUIRED/);
 const payout={potId,withdrawalId:w.withdrawalId,receiptDocumentId:proof,destinationId,...pay(),requestId:req()};
 const paid=await capital('d','withdrawal_paid',payout);
 assert.equal(paid.destinationId,destinationId);assert.equal(paid.receiptDocumentId,proof);
 assert.deepEqual(await capital('d','withdrawal_paid',payout),paid);
 await assert.rejects(()=>capital('d','withdrawal_paid',{...payout,destinationId:setupDone.destination.destinationId}),/REQUEST_CHANGED/);
 const {destinationId:_,...withoutDestination}=payout;
 await assert.rejects(()=>capital('d','withdrawal_paid',withoutDestination),/REQUEST_CHANGED/);
 // Actor-bound: another Director replaying the same reference is a new save, refused as already paid.
 await assert.rejects(()=>capital('d2','withdrawal_paid',payout),/APPROVAL_REQUIRED|ALREADY/);
 assert.equal((await db.query("select count(*)::int n from uc_investor_cash_entries where kind='withdrawal_out'")).rows[0].n,1);
 assert.equal((await db.query('select destination_id from uc_investor_withdrawal_payouts where entry_id=$1',[paid.entryId])).rows[0].destination_id,destinationId);

 // Investor sees own destination and history; another investor and admin see nothing.
 const own=await capital('i','snapshot',{});
 const shown=own.withdrawalDestinations.find(x=>x.withdrawalId===w.withdrawalId);
 assert.equal(shown.accountNumber,'700122334455');assert.equal(shown.accountHolder,'Own investor');assert.equal(shown.paidEntryId,paid.entryId);assert.equal(shown.confirmedBy,'Director');
 const actions=own.withdrawalHistory.filter(x=>x.withdrawalId===w.withdrawalId).map(x=>x.action);
 for(const action of ['request_withdrawal','approve_withdrawal','withdrawal_destination_confirmed','money_proof_upload','withdrawal_paid','withdrawal_paid_to_destination'])assert.ok(actions.includes(action),action);
 await assert.rejects(()=>capital('other','snapshot',{potId}),/NOT_ALLOWED/);
 await assert.rejects(()=>capital('a','snapshot',{potId}),/NOT_ALLOWED/);
 assert.equal((await capital('d','snapshot',{potId})).withdrawalDestinations.length,2);

 // Other actions are unchanged and refuse stray destination fields.
 await assert.rejects(()=>cmd('i','request_withdrawal',{potId,amountCents:1000,destinationAccount:'123456789'}),/INVALID/);
 const rejectMe=await cmd('i','request_withdrawal',{potId,amountCents:1000});
 await cmd('d','reject_withdrawal',{potId,withdrawalId:rejectMe.withdrawalId,note:'Not now'});

 // Service role reaches only the public wrapper; tables stay private.
 const priv=async(sql)=>(await db.query(sql)).rows[0].allowed;
 assert.equal(await priv("select has_function_privilege('service_role','uc_investor_capital(text,text,jsonb)','execute') allowed"),true);
 assert.equal(await priv("select has_function_privilege('service_role','uc_capital_before_withdrawal_destinations(text,text,jsonb)','execute') allowed"),false);
 assert.equal(await priv("select has_function_privilege('anon','uc_investor_capital(text,text,jsonb)','execute') allowed"),false);
 assert.equal(await priv("select has_function_privilege('authenticated','uc_withdrawal_destination_input(jsonb)','execute') allowed"),false);
 for(const table of ['uc_investor_withdrawal_destinations','uc_investor_withdrawal_payouts'])for(const role of ['anon','authenticated','service_role'])
  assert.equal(await priv(`select has_table_privilege('${role}','${table}','select') allowed`),false,role+' '+table);
 console.log('PASS investor withdrawal destinations: Director-confirmed immutable destination, legacy setup, receipt still required, destination-bound payout, exact actor-bound retries, own-only reads, admin refused, private tables');
}finally{await db.close();}
