// Unit execution with a small fake DOM; not a browser or visual test.
import {test} from 'node:test';import assert from 'node:assert/strict';import {seed} from '../work/investor-finance-preview/model.mjs';
test('saved investor screens render cards and simple details; admin gets expense screens only',async()=>{
 const old={fetch:globalThis.fetch,document:globalThis.document,storage:Object.getOwnPropertyDescriptor(globalThis,'sessionStorage')};
 const storage=new Map([['investor-sample-role','Investor']]),nodes=new Map(),listeners=new Map();
 const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',setAttribute(){},focus(){},insertAdjacentHTML(_position,html){this.innerHTML+=html;}});return nodes.get(key);};
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
 globalThis.document={querySelector:node,addEventListener:(name,callback)=>listeners.set(name,callback)};
 globalThis.fetch=async url=>{const role=new URL(String(url),'http://sample.test').searchParams.get('role');const s=seed();s.role=role;s.position={reservedCents:5000000,availableCents:45000000,investedCents:0};s.car={saleCents:null};s.bills[0].purpose='<img src=x onerror=alert(1)>';if(role==='Admin'){s.cash=0;s.company=0;}return {ok:true,status:200,json:async()=>s};};
 const click=dataset=>listeners.get('click')({target:{closest:()=>({dataset})}});
 try{
  await import('../work/investor-finance-preview/app.mjs?render-test');
  assert.match(node('#content').innerHTML,/Your available balance/);assert.match(node('#content').innerHTML,/450,000/);assert.doesNotMatch(node('#content').innerHTML,/Company account/);
  click({tab:'My Cars'});assert.match(node('#content').innerHTML,/car-card/);assert.match(node('#content').innerHTML,/In Stock/);
  click({car:'open'});assert.match(node('#content').innerHTML,/<details class="detail-section">/);assert.match(node('#content').innerHTML,/Car expenses/);assert.match(node('#content').innerHTML,/&lt;img/);assert.doesNotMatch(node('#content').innerHTML,/<img src=x/);
  click({car:'back'});assert.match(node('#content').innerHTML,/car-card/);
  listeners.get('change')({target:{id:'role',value:'Admin',classList:{contains:()=>false}}});await new Promise(resolve=>setImmediate(resolve));
  assert.match(node('#tabs').innerHTML,/Bills &amp; Claims|Bills & Claims/);assert.doesNotMatch(node('#tabs').innerHTML,/Overview|Bank Matching|Withdrawals/);assert.doesNotMatch(node('#content').innerHTML,/available balance|Company account/);
 }finally{globalThis.fetch=old.fetch;globalThis.document=old.document;if(old.storage)Object.defineProperty(globalThis,'sessionStorage',old.storage);else delete globalThis.sessionStorage;}
});
