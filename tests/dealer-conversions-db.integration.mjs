// Disposable local database only. Reproduces production types/checks/triggers.
// Dealer accounts: link a consignment dealer to an investor and lock unpaid
// dealer payouts as investor capital without any bank movement.
// node tests/dealer-conversions-db.integration.mjs <path-to-pglite-package>
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bcrypt from 'bcryptjs';
import {productionFinanceFixture} from './helpers/production-finance-fixture.mjs';
const db=await productionFinanceFixture(process.argv[2]);
try{

 const password=bcrypt.hashSync('Disposable-test-only',10);
 for(const [id,role] of [['d','director'],['a','admin'],['i','investor'],['other','investor']]){await db.query("insert into users(id,name,username,password,role,business_access) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end)",[id,password,role]);await db.query("insert into garage_building_staff(id,name,username,password,role,business_access,registration_status,enabled) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end,'active',true)",[id,password,role]);}
 let serial=0;const req=()=>'dealer_convert_'+String(++serial).padStart(8,'0');
 const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cap=(action,data={})=>call('uc_investor_capital','d',action,{...data,requestId:req()});
 const dealer=(actor,action,data={})=>call('uc_dealer_account',actor,action,data);
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const position=async pot=>(await db.query('select uc_investor_position($1) p',[pot])).rows[0].p;

 // Two investors; 'i' owns dealer 2TN.
 const potId=(await cap('create_profile',{name:'Ting Ping Liang'})).potId;await cap('link_account',{potId,staffId:'i'});
 const otherPot=(await cap('create_profile',{name:'Other investor'})).potId;await cap('link_account',{potId:otherPot,staffId:'other'});
 await db.query("insert into dealers(id,name,bank_name,bank_account_number,bank_account_holder) values('2tn','2TN','Maybank','5123456789','2TN AUTO WORLD SDN BHD'),('bingo','BINGO',null,null,null)");
 await db.query(`insert into cars(id,make,model,year,status,consignment,selling_price,money_received,date_added) values
  ('c1','Toyota','Vios',2020,'delivered','{"dealer":"2TN","terms":"fixed_amount","fixedAmount":40000}',50000,true,'2026-10-01'),
  ('c2','Honda','City',2020,'delivered','{"dealer":"2TN","terms":"fixed_amount","fixedAmount":80000}',90000,false,'2026-10-02'),
  ('c3','Perodua','Myvi',2020,'delivered','{"dealer":"2TN"}',45000,true,'2026-10-03'),
  ('c4','Proton','X50',2022,'available','{"dealer":"2TN"}',70000,false,'2026-11-01'),
  ('b1','Perodua','Axia',2019,'delivered','{"dealer":"BINGO"}',30000,true,'2026-10-04')`);
 await db.exec("set session_replication_role=replica");await db.query(`insert into payments(id,type,car_id,recipient_type,recipient_id,recipient_name,amount,status,created_at,description) values
  ('p0','consignment_payout','c1','dealer','2tn','2TN',10000,'transferred','2026-10-05','paid earlier'),
  ('p1','consignment_payout','c1','dealer','2tn','2TN',30000,'pending','2026-10-06','older unpaid'),
  ('p2','consignment_payout','c2','dealer','2tn','2TN',80000,'pending','2026-10-07','newer unpaid'),
  ('pb','consignment_payout','b1','dealer','bingo','BINGO',25000,'pending','2026-10-08','other dealer')`);await db.exec("set session_replication_role=origin");

 // Only the Director links, and only once per dealer and per investor.
 await assert.rejects(()=>dealer('a','list'),/NOT_ALLOWED/);
 await assert.rejects(()=>dealer('d','convert',{dealerId:'2tn',amountCents:100,convertedOn:day,note:'Agreed in writing',requestId:req()}),/INVESTOR_LINK_REQUIRED/);
 let view=await dealer('d','link',{dealerId:'2tn',potId,requestId:req()});
 assert.equal(view.investor.name,'Ting Ping Liang');
 await assert.rejects(()=>dealer('d','link',{dealerId:'bingo',potId,requestId:req()}),/ALREADY_LINKED/);
 await assert.rejects(()=>dealer('d','link',{dealerId:'2tn',potId:otherPot,requestId:req()}),/ALREADY_LINKED/);
 assert.equal(view.totals.payoutCents,12000000);assert.equal(view.totals.paidCents,1000000);assert.equal(view.totals.owedCents,11000000);
 assert.equal(view.totals.carsDelivered,3);assert.equal(view.totals.carsInStock,1);assert.equal(view.totals.deliveredWithoutPayout,1);assert.equal(view.totals.deliveredNotDisbursed,1);
 const list=await dealer('d','list');assert.equal(list.dealers.find(x=>x.id==='2tn').investorName,'Ting Ping Liang');assert.equal(list.investors.length,2);

 // Lock RM 50,000: oldest payout fully, the next one partially.
 const before=await position(potId);
 const command={dealerId:'2tn',amountCents:5000000,convertedOn:day,note:'Signed agreement 14 Nov: payouts kept as investment',requestId:req()};
 view=await dealer('d','convert',command);
 assert.equal(view.totals.convertedCents,5000000);assert.equal(view.totals.owedCents,6000000);
 const alloc=view.conversions[0].allocations;assert.deepEqual(alloc,[{paymentId:'p1',amountCents:3000000},{paymentId:'p2',amountCents:2000000}]);
 assert.equal(view.payouts.find(p=>p.paymentId==='p1').balanceCents,0);assert.equal(view.payouts.find(p=>p.paymentId==='p2').balanceCents,6000000);
 const after=await position(potId);
 assert.equal(after.cashCents-before.cashCents,5000000);assert.equal(after.availableCents-before.availableCents,5000000);assert.equal(after.convertedCapitalCents,5000000);
 assert.equal((await position(otherPot)).availableCents,0,'Other investors are untouched');
 // Payout balances read everywhere through uc_company_paid_cents; no bank movement.
 assert.equal((await db.query("select uc_company_paid_cents('p1') v")).rows[0].v,3000000);
 assert.equal((await db.query("select uc_company_paid_cents('pb') v")).rows[0].v,0);
 assert.equal((await db.query('select count(*) n from uc_bank_movements')).rows[0].n,0);
 const journal=(await db.query("select lines from journal_entries where source_id like 'dealer-conversion:%'")).rows;assert.equal(journal.length,1);
 assert.deepEqual(journal[0].lines.map(l=>[l.accountId,Number(l.debit),Number(l.credit)]),[['acct-opening-review',50000,0],['acct-investor-payable',0,50000]]);

 // Same save again returns the stored reply; a changed save is refused.
 const again=await dealer('d','convert',command);assert.equal(again.conversionId,view.conversionId);
 assert.equal((await db.query('select count(*) n from uc_dealer_conversions')).rows[0].n,1);
 await assert.rejects(()=>dealer('d','convert',{...command,amountCents:100}),/REQUEST_CHANGED/);
 // Cannot lock more than is still owed; can lock more later.
 await assert.rejects(()=>dealer('d','convert',{...command,amountCents:6000001,requestId:req()}),/CONVERSION_EXCEEDS_OWED/);
 await assert.rejects(()=>dealer('d','convert',{...command,convertedOn:'2099-01-01',requestId:req()}),/FUTURE_DATE/);
 await assert.rejects(()=>dealer('d','convert',{...command,note:'x',requestId:req()}),/INVALID/);
 view=await dealer('d','convert',{...command,amountCents:6000000,note:'Second top-up: rest kept as investment',requestId:req()});
 assert.equal(view.totals.owedCents,0);assert.equal(view.totals.convertedCents,11000000);assert.equal(view.conversions.length,2);
 assert.equal((await position(potId)).availableCents-before.availableCents,11000000);
 await assert.rejects(()=>dealer('d','convert',{...command,amountCents:1,requestId:req()}),/CONVERSION_EXCEEDS_OWED/);

 // History is permanent; converted payouts can no longer be deleted.
 await assert.rejects(()=>db.query('update uc_dealer_conversions set amount_cents=1'),/IMMUTABLE|immutable/i);
 await assert.rejects(()=>db.query('delete from uc_dealer_conversion_allocations'),/IMMUTABLE|immutable/i);
 await assert.rejects(()=>db.query("delete from payments where id='p1'"),/BANK_PAYMENT_IMMUTABLE/);

 // Investor sees only their own dealer; money history shows the conversions.
 const mine=await dealer('i','mine');assert.equal(mine.dealer.name,'2TN');assert.equal(mine.totals.convertedCents,11000000);
 assert.equal((await dealer('other','mine')).dealer,null);
 await assert.rejects(()=>dealer('i','view',{dealerId:'2tn'}),/NOT_ALLOWED/);
 await assert.rejects(()=>dealer('i','convert',command),/NOT_ALLOWED/);
 const snap=await call('uc_investor_capital','i','snapshot',{});
 assert.equal(snap.entries.filter(e=>e.kind==='capital_converted').length,2);assert.equal(snap.position.availableCents,11000000);

 // The dealer adds their own stock: consignment for their dealer, no terms, unpriced.
 const photo='https://example.supabase.co/storage/v1/object/public/car-photos/dealer/a.jpg';
 const addCar={make:'Honda',model:'Civic',variant:'1.5 TC',year:2021,carPlate:'vgt 1234',colour:'White',mileage:42000,transmission:'auto',notes:'Full service record',photos:[photo],requestId:req()};
 let mineAfter=await dealer('i','add_car',addCar);
 const added=mineAfter.cars.find(c=>c.plate==='VGT 1234');assert.ok(added,'New car shows in the dealer view');assert.equal(added.status,'available');assert.equal(added.editable,true);
 const row=(await db.query('select consignment,selling_price,purchase_price,photo,year from cars where id=$1',[added.carId])).rows[0];
 assert.deepEqual(row.consignment,{dealer:'2TN'});assert.equal(Number(row.selling_price),0);assert.equal(row.photo,photo);
 assert.equal((await dealer('i','add_car',addCar)).cars.filter(c=>c.plate==='VGT 1234').length,1,'Same save is not added twice');
 await assert.rejects(()=>dealer('i','add_car',{...addCar,requestId:req()}),/PLATE_EXISTS/);
 await assert.rejects(()=>dealer('i','add_car',{...addCar,carPlate:'NEW 1',photos:[],requestId:req()}),/PHOTOS_REQUIRED/);
 await assert.rejects(()=>dealer('i','add_car',{...addCar,carPlate:'NEW 2',transmission:'cvt',requestId:req()}),/INVALID/);
 await assert.rejects(()=>dealer('other','add_car',{...addCar,carPlate:'NEW 3',requestId:req()}),/NOT_ALLOWED/,'An investor without a dealer cannot add stock');
 mineAfter=await dealer('i','edit_car',{carId:added.carId,photos:[photo,photo],mileage:43000,colour:'Pearl white',requestId:req()});
 const edited=(await db.query('select mileage,colour,photos,consignment from cars where id=$1',[added.carId])).rows[0];
 assert.equal(edited.mileage,43000);assert.equal(edited.colour,'Pearl white');assert.equal(edited.photos.length,2);assert.deepEqual(edited.consignment,{dealer:'2TN'});
 await assert.rejects(()=>dealer('i','edit_car',{carId:'c1',photos:[photo],requestId:req()}),/CAR_LOCKED/,'Sold cars are locked for the dealer');
 await assert.rejects(()=>dealer('i','edit_car',{carId:'b1',photos:[photo],requestId:req()}),/NOT_ALLOWED/,'Another dealer\'s car');
 assert.ok(mineAfter.cars.every(c=>'repairCents' in c&&'miscCents' in c));

 // Converted capital can fund a car like any other capital.
 await db.query("insert into cars(id,make,model,year,status,purchase_price,investor_split,waive_commission) values('own1','Toyota','Veloz',2026,'available',60000,null,true)");
 await cap('fund_car',{carId:'own1',potId,purchaseCents:6000000,investorBasisPoints:4000});
 assert.equal((await position(potId)).availableCents,5000000);

 const unbalanced=(await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n;assert.equal(unbalanced,0);
 console.log('PASS dealer conversions: link once, totals, oldest-first partial lock, top-up, no bank movement, balanced journal, idempotent retry, owed limit, immutable history, investor isolation, money history, funding from converted capital.');
}finally{await db.close();}
