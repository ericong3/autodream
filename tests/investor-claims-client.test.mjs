import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {transformSync} from 'esbuild';import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../src/lib/investorClaims.ts',import.meta.url),'utf8');
function fixture(){
 const module={exports:{}},store=new Map(),calls=[];let failed=false;class InvestorFinanceError extends Error{constructor(message,code,status,retryable){super(message);Object.assign(this,{code,status,retryable});}}
 const fetch=async(_url,req)=>{calls.push(JSON.parse(req.body));if(failed)throw Error('offline');return {ok:true,json:async()=>({claim:{claimId:'claim',billId:'bill'}})};};
 vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,require:()=>({InvestorFinanceError}),fetch,crypto:webcrypto,sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});
 return {api:module.exports,calls,setFailed:v=>{failed=v;}};
}
test('a lost claim reply retries the exact reference and refuses edited details',async()=>{
 const f=fixture(),data={carId:'car',amountCents:5000};f.setFailed(true);await assert.rejects(()=>f.api.saveClaimCommand('staff','submit','submit',data,true));
 await assert.rejects(()=>f.api.saveClaimCommand('staff','submit','submit',{...data,amountCents:6000},true),/original/);
 f.setFailed(false);await f.api.saveClaimCommand('staff','submit','submit',data,true);assert.equal(f.calls.length,2);assert.equal(f.calls[0].requestId,f.calls[1].requestId);assert.equal(f.calls[0].scope,'investor_claims');
});
test('a saved claim is reused after an invoice failure until upload is confirmed',async()=>{
 const f=fixture(),data={carId:'car',amountCents:5000};await f.api.saveClaimCommand('staff','submit','submit',data,true);await f.api.saveClaimCommand('staff','submit','submit',data,true);assert.equal(f.calls.length,1);
 assert.equal(f.api.readClaimIntent('other','submit'),null);f.api.finishClaimIntent('staff','submit');assert.equal(f.api.readClaimIntent('staff','submit'),null);
});
