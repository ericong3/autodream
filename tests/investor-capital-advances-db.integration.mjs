// Disposable local database only. Allocate a car before the investor's capital
// is in: the company fronts the shortfall until capital arrives.
// node tests/investor-capital-advances-db.integration.mjs <path-to-pglite-package>
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bcrypt from 'bcryptjs';
import {productionFinanceFixture} from './helpers/production-finance-fixture.mjs';
const db=await productionFinanceFixture(process.argv[2]);
try{
 for(const f of ['20261120000100_investor_purchase_before_opening.sql','20261120000200_investor_capital_advances.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
 const password=bcrypt.hashSync('Disposable-test-only',10);
 for(const [id,role] of [['d','director'],['a','admin'],['i','investor']]){await db.query("insert into users(id,name,username,password,role,business_access) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end)",[id,password,role]);await db.query("insert into garage_building_staff(id,name,username,password,role,business_access,registration_status,enabled) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end,'active',true)",[id,password,role]);}
 let serial=0;const req=()=>'inv_advance_'+String(++serial).padStart(8,'0');const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cap=(action,data={},actor='d')=>call('uc_investor_capital',actor,action,{requestId:req(),...data});
 const pos=async pot=>(await db.query('select uc_investor_position($1) p',[pot])).rows[0].p;
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Public Bank',openingDate:day,openingCents:52415109,requestId:req()})).bank;
 const potId=(await cap('create_profile',{name:'Ting'})).potId;await cap('link_account',{potId,staffId:'i'});
 await db.query("insert into cars(id,make,model,year,status,purchase_price,investor_split,waive_commission) values('veloz','Toyota','Veloz',2023,'available',90000,null,true)");
 // Without a reason the usual protection holds.
 await assert.rejects(()=>cap('fund_car',{carId:'veloz',potId,purchaseCents:9000000}),/INSUFFICIENT_FUNDS/);
 await assert.rejects(()=>call('uc_investor_capital','a','fund_car',{carId:'veloz',potId,purchaseCents:9000000,advanceReason:'Capital from 2TN payouts',requestId:req()}),/NOT_ALLOWED/);
 await assert.rejects(()=>cap('fund_car',{carId:'veloz',potId,purchaseCents:9000000,advanceReason:' '}),/INVALID/);
 const fundReq=req();const fundInput={carId:'veloz',potId,purchaseCents:9000000,investorBasisPoints:5000,advanceReason:'Capital from 2TN payouts, lock later',requestId:fundReq};
 await call('uc_investor_capital','d','fund_car',fundInput);
 await call('uc_investor_capital','d','fund_car',fundInput);// replay: no second advance
 assert.equal(Number((await db.query('select count(*) n from uc_investor_advances')).rows[0].n),1);
 let p=await pos(potId);assert.equal(Number(p.advanceWaitingCents),9000000);assert.equal(Number(p.availableCents),0);
 // Purchase paid before opening: cash goes to zero, still waiting for capital.
 const proof={};for(const kind of ['invoice','payment']){const d=await call('uc_investor_money_evidence','d','prepare',{target:'purchase',carId:'veloz',kind,amountCents:9000000,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++serial).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_investor_money_evidence','d','confirm',{documentId:d.documentId});proof[kind]=d.documentId;}
 await cap('purchase_paid',{carId:'veloz',bankAccountId:bank.id,bankReference:'IBG 26 Sep',paidOn:'2026-09-26',invoiceDocumentId:proof.invoice,receiptDocumentId:proof.payment});
 p=await pos(potId);assert.equal(Number(p.cashCents),0);assert.equal(Number(p.advanceWaitingCents),9000000);
 // No withdrawal while waiting.
 await assert.rejects(()=>call('uc_investor_capital','i','request_withdrawal',{amountCents:100,requestId:req()}),/CAPITAL_ADVANCE_WAITING/);
 await assert.rejects(()=>cap('request_withdrawal',{potId,amountCents:100},'i'),/CAPITAL_ADVANCE_WAITING/);
 // Capital arriving fills the gap first.
 await cap('capital_received',{potId,amountCents:5000000,bankAccountId:bank.id,bankReference:'capital part',paidOn:day});
 p=await pos(potId);assert.equal(Number(p.advanceWaitingCents),4000000);assert.equal(Number(p.cashCents),0);
 await cap('capital_received',{potId,amountCents:6000000,bankAccountId:bank.id,bankReference:'capital rest',paidOn:day});
 p=await pos(potId);assert.equal(Number(p.advanceWaitingCents),0);assert.equal(Number(p.cashCents),2000000);
 // History shows the advance.
 const snap=await call('uc_investor_capital','d','snapshot',{potId});
 assert.ok(snap.entries.some(e=>e.kind==='capital_advance'&&Number(e.amountCents)===9000000));
 assert.equal((await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n,0);
 assert.equal((await db.query("select has_function_privilege('anon','uc_investor_capital(text,text,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS capital advances: director-only with reason, exact shortfall, replay-safe, purchase before opening, withdrawals blocked while waiting, capital fills the gap first, shown in history');
}finally{await db.close();}
