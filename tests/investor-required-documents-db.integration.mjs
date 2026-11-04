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

 let n=0;const req=()=>`required_docs_${String(++n).padStart(6,'0')}`;
 const call=async(actor,fn,name,data)=>(await db.query(`select ${fn}($1,$2,$3) result`,[actor,name,data])).rows[0].result;
 const capital=(actor,name,data={})=>call(actor,'uc_investor_capital',name,data);
 const action=(actor,name,data={})=>call(actor,'uc_investor_activation',name,data);
 const cmd=(actor,name,data={})=>capital(actor,name,{...data,requestId:req()});
 const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
 const count=async(sql,params=[])=>(await one(sql,params)).n;
 const paidRows=()=>count("select count(*)::int n from uc_investor_cash_entries where kind='car_expense'");
 const paidJournals=()=>count("select count(*)::int n from journal_entries where description='Investor car bill paid'");
 const approvedJournals=()=>count("select count(*)::int n from journal_entries where description='Investor car bill approved'");
 const billState=async id=>(await one('select state from uc_investor_car_bills where id=$1',[id])).state;
 const today=(await one("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).d;
 const bank=(await action('d','save_bank',{name:'Company bank',openingDate:today,openingCents:0,requestId:req()})).bank;
 const payment=()=>({bankAccountId:bank.id,bankReference:'ref-'+(++n),paidOn:today});

 const own=await cmd('d','create_profile',{name:'Own investor'});await cmd('d','link_account',{potId:own.potId,staffId:'i'});
 const rival=await cmd('d','create_profile',{name:'Other investor'});await cmd('d','link_account',{potId:rival.potId,staffId:'other'});
 for(const [potId,carId] of [[own.potId,'car-own'],[rival.potId,'car-rival']]){
  await cmd('d','capital_received',{potId,amountCents:20000000,...payment()});
  await cmd('d','fund_car',{potId,carId,purchaseCents:5000000});
  await cmd('d','purchase_paid',{carId,...payment()});
 }
 // A file counts as uploaded only once its object is in the private bucket.
 const store=path=>db.query("insert into storage.objects(bucket_id,name) values('finance-evidence',$1) on conflict do nothing",[path]);
 const prepare=(actor,billId,kind,fill,extra={})=>action(actor,'proof_prepare',{billId,kind,fileName:`${kind}-${fill}.pdf`,mimeType:'application/pdf',sha256:fill.repeat(64),sizeBytes:100,requestId:req(),...extra});
 const attach=async(actor,billId,kind,fill)=>{const doc=await prepare(actor,billId,kind,fill);await store(doc.path);await action(actor,'proof_confirm',{documentId:doc.documentId});return doc.documentId;};

 // ── 1. Supplier invoice before approval ──────────────────────────────────
 const bill=await cmd('a','add_car_bill',{carId:'car-own',category:'repair',purpose:'Brake repair',payee:'Workshop',amountCents:350000});
 await assert.rejects(()=>cmd('d','approve_car_bill',{carId:'car-own',billId:bill.billId}),/SUPPLIER_INVOICE_REQUIRED/);
 const invoice=await prepare('a',bill.billId,'bill','a');
 await assert.rejects(()=>action('a','proof_confirm',{documentId:invoice.documentId}),/UPLOAD_MISSING/);
 await assert.rejects(()=>cmd('d','approve_car_bill',{carId:'car-own',billId:bill.billId}),/SUPPLIER_INVOICE_REQUIRED/); // prepared is not enough
 // A receipt may be prepared early, but a receipt is not a supplier invoice.
 const earlyReceipt=await attach('a',bill.billId,'receipt','b');
 await assert.rejects(()=>cmd('d','approve_car_bill',{carId:'car-own',billId:bill.billId}),/SUPPLIER_INVOICE_REQUIRED/);
 assert.equal(await billState(bill.billId),'pending');assert.equal(await approvedJournals(),0);
 await store(invoice.path);await action('a','proof_confirm',{documentId:invoice.documentId});const invoiceId=invoice.documentId;
 const approve={carId:'car-own',billId:bill.billId,requestId:req()};
 const approved=await capital('d','approve_car_bill',approve);
 assert.deepEqual(await capital('d','approve_car_bill',approve),approved);
 assert.equal(await billState(bill.billId),'approved');assert.equal(await approvedJournals(),1);

 // ── 2. Payment receipt before bill money ─────────────────────────────────
 const pay=(extra={})=>({carId:'car-own',billId:bill.billId,amountCents:200000,...payment(),requestId:req(),...extra});
 await assert.rejects(()=>capital('d','pay_car_bill',pay()),/PAYMENT_RECEIPT_REQUIRED/);
 const unconfirmed=await prepare('d',bill.billId,'receipt','c');
 await assert.rejects(()=>capital('d','pay_car_bill',pay({receiptDocumentId:unconfirmed.documentId})),/RECEIPT_NOT_CONFIRMED/);
 await assert.rejects(()=>capital('d','pay_car_bill',pay({receiptDocumentId:invoiceId})),/RECEIPT_NOT_FOR_BILL/);
 await assert.rejects(()=>prepare('d',bill.billId,'receipt','a'),/RECEIPT_SAME_AS_INVOICE/);
 await assert.rejects(()=>capital('a','pay_car_bill',pay({receiptDocumentId:earlyReceipt})),/NOT_ALLOWED/);
 await assert.rejects(()=>capital('i','pay_car_bill',pay({receiptDocumentId:earlyReceipt})),/NOT_ALLOWED/);
 await assert.rejects(()=>capital('d','pay_car_bill',pay({receiptDocumentId:'not-a-document'})),/INVALID/);
 assert.equal(await paidRows(),0);assert.equal(await paidJournals(),0); // nothing posted before proof

 const firstPay=pay({receiptDocumentId:earlyReceipt});
 const paid=await capital('d','pay_car_bill',firstPay);
 assert.equal(paid.receiptDocumentId,earlyReceipt);assert.ok(paid.entryId);
 const link=await one('select * from uc_investor_payment_receipts where entry_id=$1',[paid.entryId]);
 assert.equal(link.document_id,earlyReceipt);assert.equal(link.bill_id,bill.billId);assert.equal(link.request_id,firstPay.requestId);
 assert.equal(await count('select count(*)::int n from journal_entries where id=$1',['uc:'+paid.entryId]),1);
 // Replay returns the original and consumes nothing; changes are refused.
 assert.deepEqual(await capital('d','pay_car_bill',firstPay),paid);
 assert.equal(await paidRows(),1);
 const second=await attach('d',bill.billId,'receipt','d');
 await assert.rejects(()=>capital('d','pay_car_bill',{...firstPay,receiptDocumentId:second}),/REQUEST_CHANGED/);
 await assert.rejects(()=>capital('d','pay_car_bill',{...firstPay,amountCents:200001}),/REQUEST_CHANGED/);
 const {receiptDocumentId:_,...withoutReceipt}=firstPay;
 await assert.rejects(()=>capital('d','pay_car_bill',withoutReceipt),/PAYMENT_RECEIPT_REQUIRED/);
 // One receipt pays one payment.
 await assert.rejects(()=>capital('d','pay_car_bill',pay({receiptDocumentId:earlyReceipt,amountCents:150000})),/RECEIPT_ALREADY_USED/);
 assert.equal(await paidRows(),1);
 const finalPay=await capital('d','pay_car_bill',pay({receiptDocumentId:second,amountCents:150000}));
 assert.equal(finalPay.receiptDocumentId,second);assert.equal(await paidRows(),2);
 // A failed payment rolls back and leaves its receipt unused.
 await store(unconfirmed.path);await action('d','proof_confirm',{documentId:unconfirmed.documentId});
 await assert.rejects(()=>capital('d','pay_car_bill',pay({receiptDocumentId:unconfirmed.documentId,amountCents:1})),/PAYMENT_EXCEEDS_BALANCE/);
 assert.equal(await count('select count(*)::int n from uc_investor_payment_receipts where document_id=$1',[unconfirmed.documentId]),0);
 assert.equal(await paidRows(),2);

 // ── 3. No bypass around the wrappers ─────────────────────────────────────
 const tow=await cmd('a','add_car_bill',{carId:'car-own',category:'transport',purpose:'Tow',payee:'Tow company',amountCents:50000});
 await assert.rejects(()=>db.query("update uc_investor_car_bills set state='approved',reviewed_by='d',reviewed_at=now() where id=$1",[tow.billId]),/SUPPLIER_INVOICE_REQUIRED/);
 await assert.rejects(()=>db.query("insert into uc_investor_car_bills(car_id,category,purpose,payee,amount_cents,created_by,state,reviewed_by,reviewed_at) values('car-own','misc','Forged','Nobody',1,'d','approved','d',now())"),/BILL_REVIEW_REQUIRED/);
 await attach('a',tow.billId,'bill','e');await cmd('d','approve_car_bill',{carId:'car-own',billId:tow.billId});
 // Even the private inner command cannot record bill money without a checked receipt.
 await assert.rejects(()=>db.query('select uc_investor_capital_phase2($1,$2,$3)',['d','pay_car_bill',{carId:'car-own',billId:tow.billId,amountCents:50000,bankAccount:'bank:'+bank.id,bankReference:'bypass-1',paidOn:today,requestId:req()}]),/PAYMENT_RECEIPT_REQUIRED/);
 await assert.rejects(()=>db.query("insert into uc_investor_cash_entries(pot_id,kind,amount_cents,car_id,bill_id,bank_account,bank_reference,paid_on,recorded_by) values($1,'car_expense',-1,'car-own',$2,$3,'bypass-2',$4,'d')",[own.potId,tow.billId,'bank:'+bank.id,today]),/PAYMENT_RECEIPT_REQUIRED/);
 // A receipt prepared for another bill cannot pay this one.
 await assert.rejects(()=>capital('d','pay_car_bill',{carId:'car-own',billId:tow.billId,amountCents:50000,...payment(),requestId:req(),receiptDocumentId:unconfirmed.documentId}),/RECEIPT_NOT_FOR_BILL/);
 await assert.rejects(()=>db.query('update uc_investor_payment_receipts set document_id=$1',[unconfirmed.documentId]),/IMMUTABLE_HISTORY/);
 await assert.rejects(()=>db.query('delete from uc_investor_payment_receipts'),/IMMUTABLE_HISTORY/);
 assert.equal(await paidRows(),2);assert.equal(await paidJournals(),2);
 // Receipt preparation: replay, same-file reuse, strict shape, storage check.
 const towReceipt={billId:tow.billId,kind:'receipt',fileName:'tow-receipt.pdf',mimeType:'application/pdf',sha256:'8'.repeat(64),sizeBytes:200,requestId:req()};
 const prepared=await action('a','proof_prepare',towReceipt);
 assert.ok(prepared.path.startsWith(`bills/${tow.billId}/receipt-`));assert.equal(prepared.state,'prepared');
 assert.deepEqual(await action('a','proof_prepare',towReceipt),prepared);
 await assert.rejects(()=>action('a','proof_prepare',{...towReceipt,sizeBytes:201}),/REQUEST_CHANGED/);
 assert.equal((await action('d','proof_prepare',{...towReceipt,requestId:req()})).documentId,prepared.documentId);
 await assert.rejects(()=>action('a','proof_prepare',{...towReceipt,entryId:paid.entryId,requestId:req()}),/INVALID/);
 await assert.rejects(()=>action('a','proof_confirm',{documentId:prepared.documentId}),/UPLOAD_MISSING/);
 await store(prepared.path);await action('a','proof_confirm',{documentId:prepared.documentId});
 assert.equal((await action('a','proof_prepare',towReceipt)).state,'confirmed');
 const towPaid=await capital('d','pay_car_bill',{carId:'car-own',billId:tow.billId,amountCents:50000,...payment(),requestId:req(),receiptDocumentId:prepared.documentId});
 assert.equal(towPaid.receiptDocumentId,prepared.documentId);
 // Evidence attached to an existing payment still works.
 const legacy=await prepare('a',bill.billId,'payment','f',{entryId:paid.entryId});assert.equal(legacy.state,'prepared');

 // Bills raised by the misc and repair commands need an invoice too.
 const misc=(await db.query('select uc_record_investor_misc($1,$2) result',['a',{carId:'car-own',miscId:'misc-1',amountCents:12000,purpose:'Road tax',payee:'Road transport office',requestId:req()}])).rows[0].result;
 await assert.rejects(()=>cmd('d','approve_car_bill',{carId:'car-own',billId:misc.billId}),/SUPPLIER_INVOICE_REQUIRED/);
 await db.exec("insert into repairs(id,car_id,type_of_repair,status,location) values('repair-1','car-own','Aircon','awaiting_bill','Workshop')");
 const repair=(await db.query('select uc_complete_investor_repair($1,$2) result',['a',{repairId:'repair-1',amountCents:20000,requestId:req()}])).rows[0].result;
 await assert.rejects(()=>cmd('d','approve_car_bill',{carId:'car-own',billId:repair.billId}),/SUPPLIER_INVOICE_REQUIRED/);
 await cmd('d','void_car_bill',{carId:'car-own',billId:misc.billId,note:'Duplicate entry'});
 await assert.rejects(()=>prepare('a',misc.billId,'receipt','6'),/BILL_VOIDED/);

 // ── 4. Investors read documents for their own cars only ─────────────────
 const rivalBill=await cmd('a','add_car_bill',{carId:'car-rival',category:'repair',purpose:'Paint',payee:'Paint shop',amountCents:10000});
 const rivalInvoice=await attach('a',rivalBill.billId,'bill','9');
 const snap=await capital('i','car_snapshot',{carId:'car-own'});
 const shown=snap.bills.find(b=>b.id===bill.billId);
 assert.equal(shown.supplierInvoiceConfirmed,true);
 assert.deepEqual(shown.documents.map(d=>d.id).sort(),[invoiceId,earlyReceipt,second,unconfirmed.documentId].sort()); // confirmed only
 assert.equal(shown.documents.find(d=>d.id===earlyReceipt).entryId,paid.entryId);
 assert.equal(shown.documents.find(d=>d.id===earlyReceipt).used,true);
 assert.equal(shown.documents.find(d=>d.id===unconfirmed.documentId).used,false);
 assert.equal(shown.documents.find(d=>d.id===invoiceId).used,undefined);
 assert.equal(shown.payments.find(p=>p.id===paid.entryId).receiptDocumentId,earlyReceipt);
 assert.equal(shown.payments.find(p=>p.id===finalPay.entryId).receiptDocumentId,second);
 assert.equal(snap.bills.find(b=>b.id===repair.billId).supplierInvoiceConfirmed,false);
 const read=await action('i','proof_read',{documentId:invoiceId});
 assert.equal(read.documentId,invoiceId);assert.equal(read.mimeType,'application/pdf');assert.ok(read.path.startsWith(`bills/${bill.billId}/`));
 assert.equal((await action('i','proof_read',{documentId:earlyReceipt})).documentId,earlyReceipt);
 await assert.rejects(()=>action('i','proof_read',{documentId:legacy.documentId}),/NOT_ALLOWED/); // not confirmed
 await assert.rejects(()=>action('i','proof_read',{documentId:rivalInvoice}),/NOT_ALLOWED/);
 await assert.rejects(()=>action('other','proof_read',{documentId:invoiceId}),/NOT_ALLOWED/);
 assert.equal((await action('other','proof_read',{documentId:rivalInvoice})).documentId,rivalInvoice);
 await assert.rejects(()=>action('loner','proof_read',{documentId:invoiceId}),/NOT_ALLOWED/);
 await assert.rejects(()=>action('i','proof_read',{documentId:'00000000-0000-0000-0000-000000000000'}),/NOT_ALLOWED/);
 await assert.rejects(()=>action('i','proof_read',{documentId:invoiceId,path:'bills/other'}),/INVALID/);
 await db.exec("update garage_building_staff set enabled=false where id='i'");
 await assert.rejects(()=>action('i','proof_read',{documentId:invoiceId}),/NOT_ALLOWED/);
 await assert.rejects(()=>capital('i','car_snapshot',{carId:'car-own'}),/NOT_ALLOWED/);
 await db.exec("update garage_building_staff set enabled=true where id='i'");
 await assert.rejects(()=>capital('i','car_snapshot',{carId:'car-rival'}),/NOT_ALLOWED/);
 await assert.rejects(()=>prepare('i',bill.billId,'receipt','7'),/NOT_ALLOWED/);
 await assert.rejects(()=>prepare('i',bill.billId,'bill','7'),/NOT_ALLOWED/);
 await assert.rejects(()=>action('i','proof_confirm',{documentId:legacy.documentId}),/NOT_ALLOWED/);
 await assert.rejects(()=>action('i','banks'),/NOT_ALLOWED/);
 // Staff keep the existing read path.
 assert.equal((await action('a','proof_read',{documentId:rivalInvoice})).documentId,rivalInvoice);
 const adminSnap=await capital('a','car_snapshot',{carId:'car-own'});
 assert.equal(adminSnap.purchaseCents,undefined);assert.equal(adminSnap.bills.find(b=>b.id===bill.billId).documents.length,4);

 // ── 5. Ledger consistency, private grants, single install ───────────────
 assert.equal(await paidRows(),3);assert.equal(await paidJournals(),3);
 assert.equal(await count("select count(*)::int n from uc_investor_cash_entries e where e.kind='car_expense' and not exists(select 1 from uc_investor_payment_receipts r where r.entry_id=e.id)"),0);
 assert.equal(await count("select count(*)::int n from uc_investor_audit where action='payment_receipt_linked'"),3);
 const can=async(role,fn)=>(await one(`select has_function_privilege('${role}','public.${fn}','execute') ok`)).ok;
 for(const fn of ['uc_investor_capital(text,text,jsonb)','uc_investor_activation(text,text,jsonb)']){
  assert.equal(await can('service_role',fn),true,fn);
  for(const role of ['anon','authenticated'])assert.equal(await can(role,fn),false,fn+' '+role);
 }
 for(const fn of ['uc_investor_capital_phase3(text,text,jsonb)','uc_investor_activation_phase3(text,text,jsonb)','uc_investor_capital_phase2(text,text,jsonb)',
  'uc_require_supplier_invoice()','uc_require_payment_receipt()','uc_payment_receipt_link_guard()'])
  for(const role of ['service_role','anon','authenticated'])assert.equal(await can(role,fn),false,fn+' '+role);
 await db.exec('set role service_role');
 await assert.rejects(()=>db.query('select * from uc_investor_payment_receipts'),/permission denied/);
 await assert.rejects(()=>db.query('select uc_investor_capital_phase3($1,$2,$3)',['d','car_snapshot',{carId:'car-own'}]),/permission denied/);
 await db.exec('reset role;set role anon');
 await assert.rejects(()=>db.query('select uc_investor_activation($1,$2,$3)',['i','proof_read',{documentId:invoiceId}]),/permission denied/);
 await db.exec('reset role');
 await assert.rejects(()=>db.exec(migration(REQUIRED_DOCUMENTS)),/INVESTOR_REQUIRED_DOCUMENTS_ALREADY_INSTALLED/);
 await db.exec('rollback');
 assert.equal((await action('i','proof_read',{documentId:invoiceId})).documentId,invoiceId);
 console.log('PASS investor required documents: invoice before approval, receipt before payment, single-use receipts, replay, bypass guards, own-car investor reads, private grants');
}finally{await db.close();}
