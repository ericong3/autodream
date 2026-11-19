// Disposable local database only. Move a company stock car (with its purchase
// and costs) into an investor account, with the accounting moving along.
// node tests/move-car-to-investor-db.integration.mjs <path-to-pglite-package>
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bcrypt from 'bcryptjs';
import {productionFinanceFixture} from './helpers/production-finance-fixture.mjs';
const db=await productionFinanceFixture(process.argv[2]);
try{
 for(const f of ['20261120000000_paid_before_bank_opening.sql','20261120000100_investor_purchase_before_opening.sql','20261120000200_investor_capital_advances.sql','20261120000300_register_car_advance.sql','20261120000400_move_car_to_investor.sql'])
  await db.exec(readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
 const password=bcrypt.hashSync('Disposable-test-only',10);
 for(const [id,role] of [['d','director'],['a','admin'],['i','investor']]){await db.query("insert into users(id,name,username,password,role,business_access) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end)",[id,password,role]);await db.query("insert into garage_building_staff(id,name,username,password,role,business_access,registration_status,enabled) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end,'active',true)",[id,password,role]);}
 let serial=0;const req=()=>'move_car_test_'+String(++serial).padStart(8,'0');const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cap=(action,data={},actor='d')=>call('uc_investor_capital',actor,action,{requestId:req(),...data});
 const pos=async pot=>(await db.query('select uc_investor_position($1) p',[pot])).rows[0].p;
 const stock=async car=>Number((await db.query('select uc_company_stock_cents($1) n',[car])).rows[0].n);
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Public Bank',openingDate:day,openingCents:52415109,requestId:req()})).bank;
 const potId=(await cap('create_profile',{name:'Ting'})).potId;await cap('link_account',{potId,staffId:'i'});
 // Company stock car bought 26 Sep with a paid misc cost and a pending one on another car.
 await db.exec("set session_replication_role=replica");
 await db.exec(`insert into cars(id,make,model,year,status,purchase_price,waive_commission,car_plate,misc_costs,investor_split) values
  ('veloz','Toyota','Veloz',2023,'available',90000,true,'VLM6465','[{"id":"m1","amount":500}]',50),('city','Honda','City',2022,'available',50000,true,'ABC1','[]',50)`);
 await db.exec(`insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values
  ('jp-veloz','2026-09-26','Car purchased','car_purchased','veloz','veloz','[{"accountId":"acct-inv-own","debit":90000,"credit":0},{"accountId":"acct-bank-operating","debit":0,"credit":90000}]'),
  ('jm-veloz','2026-09-28','Misc','misc_cost','pm1','veloz','[{"accountId":"acct-inv-own","debit":500,"credit":0},{"accountId":"acct-ap","debit":0,"credit":500}]'),
  ('jp-city','2026-09-20','Car purchased','car_purchased','city','city','[{"accountId":"acct-inv-own","debit":50000,"credit":0},{"accountId":"acct-bank-operating","debit":0,"credit":50000}]')`);
 await db.exec(`insert into payments(id,type,status,amount,car_id,recipient_type,recipient_id,recipient_name) values
  ('pm1','misc_cost','transferred',500,'veloz','merchant','m','Parts'),('pc1','repair','pending',800,'city','workshop','w','Workshop')`);
 await db.exec("set session_replication_role=origin");
 // Listing: Director only; shows the blocker for the car with an unpaid bill.
 await assert.rejects(()=>call('uc_investor_capital','a','transferable_cars',{potId}),/NOT_ALLOWED/);
 const list=(await call('uc_investor_capital','d','transferable_cars',{potId})).cars;
 assert.equal(list.find(c=>c.id==='veloz').blocker,null);assert.equal(Number(list.find(c=>c.id==='veloz').stockCents),9050000);
 assert.equal(list.find(c=>c.id==='city').blocker,'COMPANY_BILLS_UNPAID');
 await assert.rejects(()=>cap('transfer_car',{carId:'city',potId,investorBasisPoints:4000,reason:'Ting car'}),/COMPANY_BILLS_UNPAID/);
 // Without money and without a fronting reason it is refused.
 await assert.rejects(()=>cap('transfer_car',{carId:'veloz',potId,investorBasisPoints:4000,reason:'Bought with Ting money'}),/INSUFFICIENT_FUNDS/);
 await assert.rejects(()=>cap('transfer_car',{carId:'veloz',potId,investorBasisPoints:4000,reason:'Bought with Ting money',advanceReason:'2TN payouts'},'a'),/NOT_ALLOWED/);
 const moveInput={carId:'veloz',potId,investorBasisPoints:5000,reason:'Bought with Ting money on 26 Sep',advanceReason:'Capital from 2TN payouts',requestId:req()};
 const moved=await call('uc_investor_capital','d','transfer_car',moveInput);
 assert.equal(Number(moved.carriedCostCents),50000);
 assert.equal((await call('uc_investor_capital','d','transfer_car',moveInput)).carriedCostCents,moved.carriedCostCents);
 const sum=moved.car;assert.equal(Number(sum.purchasePaidCents),9000000);assert.equal(Number(sum.costCents),50000);assert.equal(sum.state,'in_stock');
 let p=await pos(potId);assert.equal(Number(p.cashCents),0);assert.equal(Number(p.availableCents),0);assert.equal(Number(p.advanceWaitingCents),9050000);assert.equal(Number(p.investedCents),9050000);assert.equal(Number(p.reservedCents),0);
 // Accounting moved: company stock for the car is zero, investor stock holds it.
 assert.equal(await stock('veloz'),0);
 const mj=(await db.query("select lines from journal_entries where id='uc:move:veloz'")).rows[0].lines;
 assert.deepEqual(mj.map(l=>[l.accountId,Number(l.debit),Number(l.credit)]),[['acct-inv-investor',90500,0],['acct-inv-own',0,90500]]);
 // Treated as bought: no second purchase; snapshot history shows the move.
 assert.ok((await call('uc_investor_capital','d','snapshot',{potId})).entries.some(e=>e.kind==='car_moved_in'&&Number(e.amountCents)===-9050000));
 assert.equal((await call('uc_investor_capital','d','car_snapshot',{carId:'veloz'})).state,'in_stock');
 // Capital arrives and fills the gap first.
 await cap('capital_received',{potId,amountCents:10000000,bankAccountId:bank.id,bankReference:'Ting capital',paidOn:day});
 p=await pos(potId);assert.equal(Number(p.advanceWaitingCents),0);assert.equal(Number(p.cashCents),950000);
 // The sale profit includes the carried cost.
 await cap('agree_sale',{carId:'veloz',amountCents:10050000});
 const sold=(await call('uc_investor_capital','d','car_snapshot',{carId:'veloz'}));assert.equal(Number(sold.profitCents),1000000);// 100,500 sale - 90,000 - 500 carried cost
 assert.equal(sold.state,'sold');

 assert.equal((await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n,0);
 await assert.rejects(()=>db.exec("delete from uc_investor_car_transfers"),/./);
 assert.equal((await db.query("select has_function_privilege('anon','uc_investor_capital(text,text,jsonb)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS move car to investor: director only, unpaid bills block, fronting reason, book value moves in one journal, counts as bought with carried costs, capital fills gap, sale profit includes carried costs');
}finally{await db.close();}
