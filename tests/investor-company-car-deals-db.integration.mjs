// Disposable local database only. Company cars bought with an investor's
// money: editable draft share, confirmed later from the car's ledger profit.
// node tests/investor-company-car-deals-db.integration.mjs <path-to-pglite-package>
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bcrypt from 'bcryptjs';
import {productionFinanceFixture} from './helpers/production-finance-fixture.mjs';
const db=await productionFinanceFixture(process.argv[2]);
try{
 for(const f of ['20261120000000_paid_before_bank_opening.sql','20261120000100_investor_purchase_before_opening.sql','20261120000200_investor_capital_advances.sql','20261120000300_register_car_advance.sql','20261120000400_move_car_to_investor.sql','20261120000500_investor_company_car_deals.sql','20261120000600_allocate_any_car.sql','20261120000700_allocate_search_all.sql','20261120000800_delivered_car_app_profit.sql','20261120000900_investor_delivered_cars_view.sql','20261120001000_delivered_car_capital_held.sql'])
  await db.exec(readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
 const password=bcrypt.hashSync('Disposable-test-only',10);
 for(const [id,role] of [['d','director'],['a','admin'],['i','investor']]){await db.query("insert into users(id,name,username,password,role,business_access) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end)",[id,password,role]);await db.query("insert into garage_building_staff(id,name,username,password,role,business_access,registration_status,enabled) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end,'active',true)",[id,password,role]);}
 let serial=0;const req=()=>'deal_test_'+String(++serial).padStart(8,'0');const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cap=(action,data={},actor='d')=>call('uc_investor_capital',actor,action,{requestId:req(),...data});
 const pos=async pot=>(await db.query('select uc_investor_position($1) p',[pot])).rows[0].p;
 const potId=(await cap('create_profile',{name:'Ting'})).potId;await cap('link_account',{potId,staffId:'i'});
 const other=(await cap('create_profile',{name:'Other'})).potId;
 await db.exec("set session_replication_role=replica");
 await db.exec(`insert into cars(id,make,model,year,status,purchase_price,car_plate,investor_split) values('veloz','Toyota','Veloz',2023,'delivered',90000,'VLM6465',50),('myvi','Perodua','Myvi',2021,'available',30000,'QAA1',50)`);
 await db.exec(`insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values
  ('jp','2026-09-26','Car purchased','car_purchased','veloz','veloz','[{"accountId":"acct-inv-own","debit":90000,"credit":0},{"accountId":"acct-bank-operating","debit":0,"credit":90000}]'),
  ('js','2026-10-20','Car sold','car_sold','veloz','veloz','[{"accountId":"acct-bank-operating","debit":100000,"credit":0},{"accountId":"acct-rev-car-sales","debit":0,"credit":100000},{"accountId":"acct-cogs-own","debit":90000,"credit":0},{"accountId":"acct-inv-own","debit":0,"credit":90000}]'),
  ('jc','2026-10-20','Commission','salesman_commission','veloz','veloz','[{"accountId":"acct-exp-salesman-comm","debit":1500,"credit":0},{"accountId":"acct-ap","debit":0,"credit":1500}]')`);
 await db.exec("set session_replication_role=origin");
 // A delivered car with a loss.
 await db.exec("set session_replication_role=replica");
 await db.exec("insert into cars(id,make,model,year,status,purchase_price,car_plate,investor_split) values('axia','Perodua','Axia',2020,'delivered',20000,'VLX1',50)");
 await db.exec(`insert into journal_entries(id,date,description,source_type,source_id,car_id,lines) values
  ('js2','2026-10-21','Car sold','car_sold','axia','axia','[{"accountId":"acct-bank-operating","debit":19000,"credit":0},{"accountId":"acct-rev-car-sales","debit":0,"credit":19000},{"accountId":"acct-cogs-own","debit":20000,"credit":0},{"accountId":"acct-inv-own","debit":0,"credit":20000}]')`);
 await db.exec("set session_replication_role=origin");
 await assert.rejects(()=>call('uc_investor_capital','a','deal_search',{potId,query:'veloz'}),/NOT_ALLOWED/);
 // One search finds every company car with what can be done with it.
 const found=(await call('uc_investor_capital','d','deal_search',{potId,query:'qaa'})).cars.concat((await call('uc_investor_capital','d','deal_search',{potId,query:'vlm'})).cars);
 const v=found.find(c=>c.id==='veloz'),m=found.find(c=>c.id==='myvi');
 assert.equal(v.sold,true);assert.equal(Number(v.profitCents),850000);
 assert.deepEqual([v.breakdown.saleCents,v.breakdown.costOfCarCents,v.breakdown.expenseCents,v.breakdown.purchaseCents].map(Number),[10000000,9000000,150000,9000000]);
 assert.equal(m.sold,false);assert.equal(m.blocker,'COMPANY_PURCHASE_NOT_RECORDED');
 // Search shows every match, ignores plate spaces, and explains blocked cars.
 await db.exec("set session_replication_role=replica");
 await db.exec(`insert into cars(id,make,model,year,status,purchase_price,car_plate,investor_id,investor_split,consignment) values
  ('vios','Toyota','Vios',2022,'delivered',60000,'QM 7788','legacy-user',50,'{}'::jsonb),('alza','Perodua','Alza',2022,'delivered',60000,'QM 7799',null,50,'{"owner":"x"}'::jsonb)`);
 await db.exec("set session_replication_role=origin");
 const qm=(await call('uc_investor_capital','d','deal_search',{potId,query:'qm77'})).cars;
 assert.equal(qm.length,2);assert.equal(qm.find(c=>c.id==='vios').blocker,null);assert.equal(qm.find(c=>c.id==='alza').blocker,'CONSIGNMENT_CAR');
 await cap('save_deal',{potId,carId:'vios',investorBasisPoints:5000,capitalCents:0});
 await assert.rejects(()=>cap('save_deal',{potId,carId:'alza',investorBasisPoints:5000,capitalCents:0}),/CONSIGNMENT_CAR/);
 await cap('remove_deal',{potId,carId:'vios'});
 // A car in stock is moved, not marked.
 await assert.rejects(()=>cap('save_deal',{potId,carId:'myvi',investorBasisPoints:4000,capitalCents:0}),/CAR_IN_STOCK/);
 // Draft on a delivered car: save, change, remove, save again.
 let saved=await cap('save_deal',{potId,carId:'veloz',investorBasisPoints:4000,capitalCents:9000000,note:'Bought with Ting money 26 Sep'});
 assert.equal(saved.deal.state,'draft');assert.equal(Number(saved.deal.estimatedShareCents),340000);
 saved=await cap('save_deal',{potId,carId:'veloz',investorBasisPoints:5000,capitalCents:9000000,note:'Changed to 50/50'});
 assert.equal(Number(saved.deal.estimatedShareCents),425000);
 await assert.rejects(()=>cap('save_deal',{potId:other,carId:'veloz',investorBasisPoints:5000,capitalCents:9000000}),/DEAL_OTHER_INVESTOR/);
 await cap('remove_deal',{potId,carId:'veloz'});
 assert.equal((await call('uc_investor_capital','d','deals_list',{potId})).deals.length,0);
 await cap('save_deal',{potId,carId:'veloz',investorBasisPoints:5000,capitalCents:9000000,note:'Bought with Ting money'});
 assert.equal(Number((await pos(potId)).cashCents),0);
 // Capital held in the waiting car: not free; the company fronts it until capital is in.
 let held=await pos(potId);assert.equal(Number(held.availableCents),0);assert.equal(Number(held.deliveredCapitalCents),9000000);assert.equal(Number(held.advanceWaitingCents),9000000);
 await assert.rejects(()=>cap('save_deal',{potId,carId:'veloz',investorBasisPoints:5000}),/INVALID/);
 // The investor sees the draft car with no amounts.
 let mine=(await call('uc_investor_capital','i','snapshot',{})).deliveredCars;
 assert.equal(mine.length,1);assert.equal(mine[0].state,'draft');assert.equal(mine[0].shareCents,null);assert.equal(mine[0].investorBasisPoints,null);
 // A loss is the investor's in full, whatever the %.
 const loss=await cap('save_deal',{potId,carId:'axia',investorBasisPoints:4000,capitalCents:0});
 assert.equal(Number(loss.deal.estimatedShareCents),-100000);
 // Confirm with an adjusted share, within the profit.
 await assert.rejects(()=>cap('confirm_deal',{potId,carId:'veloz',shareCents:900000,profitCents:850000,note:'Too much'}),/SHARE_OUT_OF_RANGE/);
 const conf=await cap('confirm_deal',{potId,carId:'veloz',shareCents:400000,profitCents:850000,note:'Final after costs checked'});
 assert.equal(conf.deal.state,'confirmed');assert.equal(conf.position.deliveredCapitalCents,undefined);assert.equal(Number(conf.position.availableCents),400000);
 mine=(await call('uc_investor_capital','i','snapshot',{})).deliveredCars;assert.equal(Number(mine.find(c=>c.carId==='veloz').shareCents),400000);assert.equal(Number(conf.position.cashCents),400000);
 const j=(await db.query("select lines from journal_entries where id='uc:deal:veloz'")).rows[0].lines;
 assert.deepEqual(j.map(l=>[l.accountId,Number(l.debit),Number(l.credit)]),[['acct-exp-investor-profit-share',4000,0],['acct-investor-payable',0,4000]]);
 await cap('confirm_deal',{potId,carId:'axia',shareCents:-100000,profitCents:-100000,note:'Loss confirmed'});
 assert.equal(Number((await pos(potId)).cashCents),300000);
 assert.equal(Number((await db.query("select uc_car_book_profit_cents('veloz') n")).rows[0].n),850000);
 await assert.rejects(()=>cap('save_deal',{potId,carId:'veloz',investorBasisPoints:6000,capitalCents:9000000}),/DEAL_CONFIRMED/);
 await assert.rejects(()=>cap('remove_deal',{potId,carId:'veloz'}),/DEAL_CONFIRMED/);
 await assert.rejects(()=>db.exec("delete from uc_investor_deals where car_id='veloz'"),/DEAL_CONFIRMED/);
 assert.ok((await call('uc_investor_capital','d','snapshot',{potId})).entries.some(e=>e.kind==='deal_profit_in'&&Number(e.amountCents)===400000));
 assert.equal((await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n,0);
 console.log('PASS allocate any car: one search (stock or delivered), stock cars must move, delivered draft editable, % of profit or whole loss, director only, search, editable draft (change, remove), no money until confirmed, sold-only confirm within profit, journal, fixed after confirm, history');
}finally{await db.close();}
