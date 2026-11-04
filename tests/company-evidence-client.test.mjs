import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../src/lib/companyEvidence.ts',import.meta.url),'utf8');
function fixture({failed=false}={}){
 const module={exports:{}},calls=[];
 const fetch=async(url,options)=>{calls.push(['upload',url,JSON.parse(options.body)]);return {ok:!failed,json:async()=>failed?{error:{message:'Upload could not be stored'}}:{document:{documentId:'doc',kind:'payment'}}};};
 vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs',define:{'import.meta.env.VITE_USED_CAR_PRIVATE_FINANCE':'"1"'}}).code,{module,exports:module.exports,require:()=>({prepareProof:async()=>({fileName:'proof.pdf',mimeType:'application/pdf',base64:'JVBERi0='})}),fetch,crypto:webcrypto,TextEncoder});
 const opts={car:{id:'car1',make:'Toyota',model:'Vios'},amount:50000,payments:[],file:{name:'proof.pdf'},addPayment:async p=>calls.push(['add',p]),updatePayment:async(...args)=>calls.push(['update',...args])};
 return {api:module.exports,calls,opts};
}
test('bank collection prepares one unpaid receivable and private proof before any collection',async()=>{
 const f=fixture(),rows=await f.api.prepareDisbursementEvidence(f.opts);
 assert.deepEqual(f.calls.map(c=>c[0]),['add','upload']);
 assert.equal(f.calls[0][1].status,'pending');assert.equal(rows.length,1);assert.equal(rows[0].status,'pending');
 const body=f.calls[1][2];assert.equal(body.scope,'company_evidence');assert.equal(body.kind,'payment');assert.equal(body.paymentId,rows[0].id);
 assert.equal(body.actor,undefined);assert.equal(body.path,undefined);assert.equal(body.url,undefined);
});
test('a failed upload leaves the collection unpaid and is reported to the caller',async()=>{
 const f=fixture({failed:true});await assert.rejects(()=>f.api.prepareDisbursementEvidence(f.opts),/could not be stored/);
 assert.equal(f.calls[0][1].status,'pending');assert.equal(f.calls.some(c=>c[0]==='update'),false);
});
test('the same file and payment retry with one reference, while existing rows are reused',async()=>{
 const f=fixture();const original={id:'existing',type:'loan_disbursement',carId:'car1',amount:50000,status:'pending'};
 const opts={...f.opts,payments:[original]};await f.api.prepareDisbursementEvidence(opts);await f.api.prepareDisbursementEvidence(opts);
 assert.deepEqual(f.calls.map(c=>c[0]),['upload','upload']);assert.equal(f.calls[0][2].requestId,f.calls[1][2].requestId);
});
test('investor receipts and changes to already collected amounts are refused before any write',async()=>{
 const f=fixture();await assert.rejects(()=>f.api.prepareDisbursementEvidence({...f.opts,car:{...f.opts.car,investorFunded:true}}),/investor/);
 await assert.rejects(()=>f.api.prepareDisbursementEvidence({...f.opts,payments:[{id:'paid',carId:'car1',type:'loan_disbursement',amount:40000,status:'transferred'}]}),/already recorded/);
 assert.equal(f.calls.length,0);
});
