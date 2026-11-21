// Disposable local PGlite rehearsal only. Never connects to Supabase.
// node tests/car-salesperson-db.integration.mjs <path-to-pglite-package>
// Sold cars get the buyer's salesperson; old sales are marked as paid outside
// the app; new sales cannot be saved without a salesperson.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const root=process.argv[2];if(!root)throw Error('Supply the temporary PGlite package path.');
const {createFinanceRehearsal}=await import('./helpers/finance-rehearsal.mjs');const db=await createFinanceRehearsal(root);
const migration=n=>readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
try{
 await db.exec(`create role anon;create role authenticated;
 create table cars(id text primary key,make text,model text,year int,car_plate text,status text,assigned_salesperson text,outgoing_consignment jsonb,is_staff_sale boolean default false,
  commission_credited_early boolean default false,commission_credited_month text,final_deal jsonb,date_added text);
 create table customers(id text primary key,interested_car_id text,assigned_sales_id text,cash_work_order jsonb,loan_work_order jsonb,delivered_at timestamptz);
 create table payments(id text primary key,car_id text,type text,status text,amount numeric);
 insert into cars(id,status,assigned_salesperson,date_added) values
  ('old','delivered','', '2026-03-01'),('nov','delivered',null,'2026-11-02'),('paid','delivered','', '2026-10-01'),
  ('nobuyer','delivered','', '2026-09-01'),('kept','delivered','sp-keep','2026-09-01'),('out','delivered','', '2026-09-01'),('stock','available',null,'2026-09-01');
 update cars set outgoing_consignment='{"dealer":"X"}' where id='out';
 insert into customers values
  ('c-old','old','sp-voon','{}',null,'2026-08-15'),('c-nov','nov','sp-voon',null,'{}','2026-11-05'),('c-paid','paid','sp-aaron','{}',null,'2026-10-20'),
  ('c-kept','kept','sp-other','{}',null,'2026-09-02'),('c-out','out','sp-voon','{}',null,'2026-09-02'),('c-stock','stock','sp-aaron','{}',null,null),('c-lead','nobuyer','sp-x',null,null,null);
 insert into payments values('pay-paid','paid','salesman_commission','pending',500);`);
 await db.exec(migration('20261121000100_car_salesperson.sql'));
 const car=async id=>(await db.query('select assigned_salesperson sp,commission_settled_outside settled from cars where id=$1',[id])).rows[0];
 // Old sale: filled and marked paid outside the app.
 assert.deepEqual(await car('old'),{sp:'sp-voon',settled:true});
 // November sale: filled, commission still to be paid.
 assert.deepEqual(await car('nov'),{sp:'sp-voon',settled:false});
 // Already has a commission payment: filled, not marked.
 assert.deepEqual(await car('paid'),{sp:'sp-aaron',settled:false});
 // A salesperson already on the car is never replaced; consigned-out cars are left alone.
 assert.deepEqual(await car('kept'),{sp:'sp-keep',settled:false});
 assert.deepEqual(await car('out'),{sp:'',settled:false});
 // No buyer with a work order: left unchanged and reported.
 assert.deepEqual(await car('nobuyer'),{sp:'',settled:false});
 const log=Object.fromEntries((await db.query('select car_id,new_value,commission_month,settled_outside,skipped_reason from uc_car_salesperson_fills')).rows.map(r=>[r.car_id,r]));
 assert.equal(log.old.commission_month,'2026-08');assert.equal(log.nov.commission_month,'2026-11');
 assert.equal(log.nobuyer.skipped_reason,'NO_BUYER_SALESPERSON');assert.equal(Object.keys(log).length,4);
 // New sale: the buyer's salesperson is copied when the car is delivered.
 await db.exec("update cars set status='delivered' where id='stock'");
 assert.equal((await car('stock')).sp,'sp-aaron');
 // No salesperson anywhere: refused. Staff sales and consigned-out cars may go through.
 await db.exec("insert into cars(id,status) values('bare','available'),('staff','available'),('bare-out','available')");
 await assert.rejects(()=>db.exec("update cars set status='sold' where id='bare'"),/SALESPERSON_REQUIRED/);
 await db.exec("update cars set status='sold',is_staff_sale=true where id='staff'");
 await db.exec(`update cars set status='sold',outgoing_consignment='{"dealer":"X"}' where id='bare-out'`);
 // Clearing the salesperson on a sold car falls back to the buyer's; other edits of old rows still work.
 await db.exec("update cars set assigned_salesperson='' where id='stock'");assert.equal((await car('stock')).sp,'sp-aaron');
 await db.exec("update cars set make='Toyota' where id='nobuyer'");
 console.log('PASS car salesperson: fill from buyer, old sales settled outside the app, November left to pay, new sales require a salesperson');
}finally{await db.close?.();}
