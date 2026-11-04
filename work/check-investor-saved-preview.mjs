// Local sample endpoint test. No browser automation or production access.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:5204';
async function state(role='Director'){const r=await fetch(base+'/sample/state?role='+role);assert.equal(r.status,200);return r.json();}
async function action(action,payload={}){const requestId=randomUUID(),body=JSON.stringify({role:'Director',action,payload,requestId});const r=await fetch(base+'/sample/action',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));const retry=await fetch(base+'/sample/action',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body});assert.equal(retry.status,200,await retry.text());return data;}
let s=await state();
if(!s.settled){
 if(!s.bought)s=await action('purchase');
 const repair=s.bills.find(b=>b.amount===350000);assert.ok(repair);
 if(!repair.approved)s=await action('approve',{id:repair.id});
 const bill=s.bills.find(b=>b.id===repair.id);
 if(bill.paid===0){s=await action('pay',{id:bill.id,amount:'1000'});assert.equal(s.position.availableCents,44650000);}
 const remaining=350000-s.bills.find(b=>b.id===bill.id).paid;
 if(remaining)s=await action('pay',{id:bill.id,amount:String(remaining/100)});
 if(!s.collected)s=await action('collect');assert.equal(s.position.availableCents,50000000);
 s=await action('settle');
}
assert.equal(s.cash,50660000);assert.equal(s.company,10990000);assert.equal(s.position.availableCents,50660000);
const investor=await state('Investor');assert.equal(investor.cash,s.cash);assert.equal(investor.settled,true);assert.equal(investor.company,0);
const admin=await state('Admin');assert.equal(admin.cash,0);assert.equal(admin.company,0);assert.equal(admin.car.settlement,undefined);assert.equal(admin.bills[0].paid,350000);
console.log(JSON.stringify({status:'passed',sampleOnly:true,investorCents:s.cash,companyProfitCents:s.company-10000000,reloadKeepsRecords:true,retryDoesNotDuplicate:true,adminHasNoInvestorBalance:true}));
