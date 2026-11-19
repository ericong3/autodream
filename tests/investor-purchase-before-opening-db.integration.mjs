// Disposable local database only. An investor car bought before the bank
// opening date: purchase recorded with its slip and real date, no bank movement;
// and the investor share can be changed until settlement.
// node tests/investor-purchase-before-opening-db.integration.mjs <path-to-pglite-package>
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bcrypt from 'bcryptjs';
import {productionFinanceFixture} from './helpers/production-finance-fixture.mjs';
const db=await productionFinanceFixture(process.argv[2]);
try{
 await db.exec(readFileSync(new URL('../supabase/migrations/20261120000100_investor_purchase_before_opening.sql',import.meta.url),'utf8'));
 const password=bcrypt.hashSync('Disposable-test-only',10);
 for(const [id,role] of [['d','director'],['a','admin'],['i','investor']]){await db.query("insert into users(id,name,username,password,role,business_access) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end)",[id,password,role]);await db.query("insert into garage_building_staff(id,name,username,password,role,business_access,registration_status,enabled) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end,'active',true)",[id,password,role]);}
 let serial=0;const req=()=>'inv_before_open_'+String(++serial).padStart(8,'0');const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cap=(action,data={},actor='d')=>call('uc_investor_capital',actor,action,{requestId:req(),...data});
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Public Bank',openingDate:day,openingCents:52415109,requestId:req()})).bank;
 const potId=(await cap('create_profile',{name:'Ting'})).potId;await cap('link_account',{potId,staffId:'i'});
 await cap('capital_received',{potId,amountCents:50000000,bankAccountId:bank.id,bankReference:'capital in',paidOn:day});
 const bankBefore=Number((await db.query('select uc_registered_bank_position($1) p',[bank.id])).rows[0].p);
 const movesBefore=Number((await db.query('select count(*) n from uc_bank_movements')).rows[0].n);
 await db.query("insert into cars(id,make,model,year,status,purchase_price,investor_split,waive_commission,car_plate) values('veloz','Toyota','Veloz',2023,'available',90000,null,true,'VLM6465')");
 await cap('fund_car',{carId:'veloz',potId,purchaseCents:9000000});
 const proof={};for(const kind of ['invoice','payment']){const d=await call('uc_investor_money_evidence','d','prepare',{target:'purchase',carId:'veloz',kind,amountCents:9000000,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++serial).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_investor_money_evidence','d','confirm',{documentId:d.documentId});proof[kind]=d.documentId;}
 const input={carId:'veloz',bankAccountId:bank.id,bankReference:'IBG 26 Sep',paidOn:'2026-09-26',invoiceDocumentId:proof.invoice,receiptDocumentId:proof.payment,requestId:req()};
 await assert.rejects(()=>call('uc_investor_capital','a','purchase_paid',input),/NOT_ALLOWED/);
 const out=await call('uc_investor_capital','d','purchase_paid',input);
 assert.equal(out.car.purchasePaidCents,9000000);
 // Replay returns the same result without a second purchase.
 assert.equal((await call('uc_investor_capital','d','purchase_paid',input)).entryId,out.entryId);
 const entry=(await db.query("select * from uc_investor_cash_entries where kind='car_purchase' and car_id='veloz'")).rows;
 assert.equal(entry.length,1);assert.equal(entry[0].bank_id,null);assert.match(entry[0].bank_account,/^opening:/);
 assert.equal(new Date(entry[0].paid_on).toISOString().slice(0,10)<'2026-10-01',true);
 // No bank movement and the bank balance is unchanged.
 assert.equal(Number((await db.query('select count(*) n from uc_bank_movements')).rows[0].n),movesBefore);
 assert.equal(Number((await db.query('select uc_registered_bank_position($1) p',[bank.id])).rows[0].p),bankBefore);
 // Journal: Dr investor car stock / Cr opening review.
 const j=(await db.query("select lines from journal_entries where id=$1",['uc:'+entry[0].id])).rows[0].lines;
 assert.deepEqual(j.map(l=>[l.accountId,Number(l.debit),Number(l.credit)]),[['acct-inv-investor',90000,0],['acct-opening-review',0,90000]]);
 // Investor cash reduced as for any purchase.
 const pos=(await db.query('select uc_investor_position($1) p',[potId])).rows[0].p;assert.equal(Number(pos.cashCents),41000000);
 // The usual rules still apply: a second purchase is refused; the flag cannot be abused by hand.
 await assert.rejects(()=>call('uc_investor_capital','d','purchase_paid',{...input,requestId:req()}),/PURCHASE_ALREADY_PAID|PROOF_ALREADY_USED/);
 await assert.rejects(()=>db.query("insert into uc_investor_cash_entries(pot_id,kind,amount_cents,car_id,bank_account,bank_reference,paid_on,recorded_by) values($1,'capital_in',100,null,'opening:'||$2,'x','2026-09-01','d')",[potId,bank.id]),/REGISTERED_BANK_REQUIRED/);
 // A normal purchase on/after opening still makes a real bank movement.
 await db.query("insert into cars(id,make,model,year,status,purchase_price,investor_split,waive_commission) values('later','Honda','City',2022,'available',10000,null,true)");
 await cap('fund_car',{carId:'later',potId,purchaseCents:1000000,investorBasisPoints:5000});
 const p2={};for(const kind of ['invoice','payment']){const d=await call('uc_investor_money_evidence','d','prepare',{target:'purchase',carId:'later',kind,amountCents:1000000,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++serial).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_investor_money_evidence','d','confirm',{documentId:d.documentId});p2[kind]=d.documentId;}
 await cap('purchase_paid',{carId:'later',bankAccountId:bank.id,bankReference:'IBG later',paidOn:day,invoiceDocumentId:p2.invoice,receiptDocumentId:p2.payment});
 assert.equal(Number((await db.query('select uc_registered_bank_position($1) p',[bank.id])).rows[0].p),bankBefore-1000000);
 // Share: Director can change it until settlement, with a note; audited.
 await assert.rejects(()=>cap('set_share',{carId:'veloz',investorBasisPoints:5000,note:'Agreed 50/50'},'a'),/NOT_ALLOWED/);
 await assert.rejects(()=>cap('set_share',{carId:'veloz',investorBasisPoints:5000,note:''}),/INVALID/);
 await assert.rejects(()=>cap('set_share',{carId:'veloz',investorBasisPoints:10001,note:'Too much'}),/INVALID/);
 const shared=await cap('set_share',{carId:'veloz',investorBasisPoints:5000,note:'Agreed 50/50 with Ting'});
 assert.equal(shared.car.investorBasisPoints,5000);
 assert.equal((await db.query("select count(*) n from uc_investor_audit where action='set_share'")).rows[0].n,1);
 assert.equal((await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n,0);
 assert.equal((await db.query("select has_function_privilege('anon','uc_investor_capital(text,text,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS investor purchase before opening: real date, no bank movement, opening-review journal, investor cash reduced, replay, normal purchases unchanged; share editable by Director until settled');
}finally{await db.close();}
