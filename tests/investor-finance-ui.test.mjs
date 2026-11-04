import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
const source=readFileSync(new URL('../src/lib/investorFinance.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load({responses=[]}={}){
 const store=new Map(),calls=[];let serial=0;
 const sessionStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 const fetch=async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});const next=responses.shift();if(next instanceof Error)throw next;return {ok:next.status<400,status:next.status,json:async()=>next.body};};
 const module={exports:{}};
 vm.runInNewContext(js,{module,exports:module.exports,require:n=>n==='react'?{}:null,fetch,sessionStorage,crypto:{randomUUID:()=>`req-0000-0000-000${++serial}`},Intl,Date,JSON,Error,Number,Math});
 return {lib:module.exports,store,calls};
}
test('ringgit input is parsed strictly into whole cents',()=>{
 const {lib}=load();
 assert.equal(lib.parseRinggit('1,234.5'),123450);assert.equal(lib.parseRinggit('RM 10'),1000);assert.equal(lib.parseRinggit('0.01'),1);
 for(const bad of ['', '0', '-5', '1.234', '1e5', 'abc', '12.'])assert.equal(lib.parseRinggit(bad),null,bad);
 assert.equal(lib.parsePercentToBasisPoints('40'),4000);assert.equal(lib.parsePercentToBasisPoints('101'),null);
 assert.equal(lib.formatCents(-12345),'-RM 123.45');assert.equal(lib.investorShare(10001,4000),4000);
});
test('requests use the private scope, same-origin credentials and the garage header',async()=>{
 const {lib,calls}=load({responses:[{status:200,body:{banks:[]}}]});
 await lib.investorRequest('banks',{});
 assert.equal(calls[0].url,'/api/garage/sales');assert.equal(calls[0].init.credentials,'same-origin');assert.equal(calls[0].init.headers['X-Garage-Building'],'1');
 assert.deepEqual(calls[0].body,{scope:'investor_finance',action:'banks'});
});
test('network loss and 503 keep the original request id; retry resends it unchanged',async()=>{
 const {lib,store,calls}=load({responses:[new TypeError('offline'),{status:503,body:{error:{code:'UNAVAILABLE',message:'Retry the same save reference.'}}},{status:200,body:{ok:true}}]});
 const data={potId:'p1',amountCents:5000};
 await assert.rejects(lib.sendMutation('staff-a','withdraw:p1','request_withdrawal',data,'Withdraw'),e=>e.retryable&&e.code==='NETWORK');
 assert.equal(lib.readPending('staff-a').length,1);assert.equal(lib.readPending('staff-b').length,0);
 await assert.rejects(lib.sendMutation('staff-a','withdraw:p1','request_withdrawal',data,'Withdraw'),e=>e.retryable);
 await lib.sendMutation('staff-a','withdraw:p1','request_withdrawal',data,'Withdraw');
 assert.equal(new Set(calls.map(c=>c.body.requestId)).size,1);assert.equal(store.size,0);
});
test('a different save in the same slot is blocked while one is unconfirmed',async()=>{
 const {lib,calls}=load({responses:[new TypeError('offline')]});
 await assert.rejects(lib.sendMutation('staff-a','capital:p1','capital_received',{amountCents:1},'Capital'));
 await assert.rejects(lib.sendMutation('staff-a','capital:p1','capital_received',{amountCents:2},'Capital'),e=>e.code==='PENDING');
 assert.equal(calls.length,1);
});
test('setup and definite rejections clear the reference and explain plainly',async()=>{
 const {lib}=load({responses:[{status:503,body:{error:{code:'SETUP',message:'x'}}},{status:404,body:null}]});
 await assert.rejects(lib.sendMutation('staff-a','s1','save_bank',{name:'A'},'Bank'),e=>e.code==='SETUP'&&!e.retryable&&/not switched on yet/.test(e.message));
 assert.equal(lib.readPending('staff-a').length,0);
 await assert.rejects(lib.investorRequest('snapshot',{}),e=>e.code==='SETUP');
});
