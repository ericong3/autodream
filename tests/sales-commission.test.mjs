import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const cache=new Map();
function load(path){
 const url=new URL(path,import.meta.url);if(cache.has(url.href))return cache.get(url.href);
 const module={exports:{}};cache.set(url.href,module.exports);
 const code=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:n=>load(new URL(n+'.ts',url).href),Date,Math,crypto:{randomUUID:()=>String(Math.random())}});
 return module.exports;
}
const {salesCommission}=load('../src/utils/salesCommission.ts');
const payments=load('../src/utils/generatePayments.ts');
const car={id:'unit',make:'Toyota',model:'Noah',year:2022,status:'delivered',sellingPrice:120000,purchasePrice:110000,dateAdded:'2026-10-01',assignedSalesperson:'sales'};
const customer={id:'buyer',interestedCarId:'unit',delivered:true,deliveredAt:'2026-10-20T05:00:00Z',cashWorkOrder:{sellingPrice:121000,discount:0}};
test('standard, below-floor, consignment and recon rates are independent of ownership',()=>{
 assert.equal(salesCommission(car),1500);
 assert.equal(salesCommission({...car,priceFloor:125000}),1000);
 assert.equal(salesCommission({...car,consignment:{}}),1000);
 assert.equal(salesCommission({...car,isRecon:true,consignment:{}}),2000);
});
test('per-unit override wins over old snapshot; zero and explicit waivers are respected',()=>{
 assert.equal(salesCommission({...car,isRecon:true,salesCommission:2000},[{...customer,commission:1000}]),2000);
 assert.equal(salesCommission(car,[{...customer,commission:1750}]),1750);
 assert.equal(salesCommission({...car,salesCommission:0}),0);
 for(const flag of ['isStaffSale','waiveCommission','outgoingConsignment'])assert.equal(salesCommission({...car,[flag]:true,salesCommission:2000}),0);
});
test('delivery snapshot beats an unrelated earlier lead',()=>{
 assert.equal(salesCommission(car,[{...customer,id:'other',delivered:false,commission:1000},{...customer,commission:2200}]),2200);
});
test('payroll and backfill use the per-unit rate without changing existing payments',()=>{
 const unit={...car,isRecon:true,salesCommission:2000};
 const data={cars:[unit],customers:[customer],repairs:[],users:[{id:'sales',role:'salesperson',name:'Sales'}],externalSalesmen:[],dealers:[],workshops:[],merchants:[],payments:[]};
 const generated=payments.collectMissingPayments(data).filter(p=>p.type==='salesman_commission');
 assert.equal(generated.length,1);assert.equal(generated[0].amount,2000);
 const existing={...generated[0],amount:1000,status:'paid'};
 assert.equal(payments.collectMissingPayments({...data,payments:[existing]}).filter(p=>p.type==='salesman_commission').length,0);
 assert.equal(existing.amount,1000);
 const payroll=payments.collectMonthlyPayroll({...data,month:'2026-10'}).filter(p=>p.type==='salesman_commission');
 assert.equal(payroll.length,1);assert.equal(payroll[0].amount,2000);
 assert.equal(payments.collectMonthlyPayroll({...data,month:'2026-10',payments:[existing]}).filter(p=>p.type==='salesman_commission').length,0);
 assert.equal(payments.calcCarNetProfitBreakdown(unit,[customer],[]).commission,2000);
});
