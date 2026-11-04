import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../src/utils/completeRepair.ts',import.meta.url),'utf8');
function fixture({pending=[],fail=false}={}){
 const calls=[],module={exports:{}},saved={id:'repair',car_id:'car',status:'done',actual_cost:123};
 const require=n=>n.includes('investorFinance')?{readPending:()=>pending,sendMutation:async(...args)=>{calls.push(['private',...args]);if(fail)throw Error('offline');return {repair:saved,billId:'bill'};}}:n.includes('generatePayments')?{generateRepairPayment:async()=>{calls.push(['legacy-payment']);return 'old-payment';}}:{buildCarCostRecognizedEntry:()=>({id:'old-entry'})};
 vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,require});
 const options={repair:{id:'repair',carId:'car',typeOfRepair:'Repair'},car:{id:'car',investorFunded:true},actualCost:123,currentUserId:'actor',payments:[],workshops:[],addPayment:async()=>{},updateRepair:async()=>calls.push(['public-update']),addJournalEntry:async()=>calls.push(['legacy-journal']),applySavedRepair:(...args)=>calls.push(['apply',...args])};
 return {calls,options,run:opts=>module.exports.completeRepairJob({...options,...opts})};
}
test('investor completion uses one private save with no public repair, payment or journal writes',async()=>{
 const f=fixture();await f.run({});assert.deepEqual(f.calls.map(c=>c[0]),['private','apply']);assert.equal(f.calls[0][3],'complete_repair');assert.equal(f.calls[0][4].amountCents,12300);
});
test('a lost reply leaves the screen unchanged; retry sends the original bill rather than edited form values',async()=>{
 const f=fixture({fail:true});await assert.rejects(f.run({}),/offline/);assert.deepEqual(f.calls.map(c=>c[0]),['private']);
 const original={repairId:'repair',amountCents:12300};const retry=fixture({pending:[{slot:'repair-complete:repair',action:'complete_repair',data:original,label:'Original'}]});
 await retry.run({retryOriginal:true,actualCost:999});assert.equal(retry.calls[0][4],original);
});
test('company-funded repairs retain the existing completion and accounting flow',async()=>{
 const f=fixture();await f.run({car:{id:'car'}});assert.deepEqual(f.calls.map(c=>c[0]),['public-update','legacy-payment','legacy-journal']);
});
test('a fractional cent is refused before any repair or accounting change',async()=>{
 const f=fixture();await assert.rejects(f.run({actualCost:1.234}),/2 decimal/);assert.equal(f.calls.length,0);
});
