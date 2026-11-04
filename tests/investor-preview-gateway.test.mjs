import {test} from 'node:test';import assert from 'node:assert/strict';
import {saveAction,retrySave,pendingSave} from '../work/investor-finance-preview/gateway.mjs';
test('sample gateway retries a lost response with exactly the original save reference',async()=>{
 const oldFetch=globalThis.fetch,oldStorage=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),data=new Map(),bodies=[];
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}});
 try{
  globalThis.fetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));if(bodies.length===1)throw Error('Sample connection lost');return {ok:true,status:200,json:async()=>({cash:50660000})};};
  await assert.rejects(()=>saveAction('Director','pay',{id:'sample-bill',amount:'3500'}),/connection lost/);assert.ok(pendingSave());
  await assert.rejects(()=>saveAction('Director','pay',{id:'other-bill',amount:'1'}),/save is waiting/);
  assert.equal((await retrySave()).cash,50660000);assert.deepEqual(bodies[0],bodies[1]);assert.equal(pendingSave(),null);
  globalThis.fetch=async()=>({ok:false,status:400,json:async()=>({message:'Check the amount'})});
  await assert.rejects(()=>saveAction('Director','pay',{amount:'bad'}),/Check the amount/);assert.equal(pendingSave(),null);
 }finally{globalThis.fetch=oldFetch;if(oldStorage)Object.defineProperty(globalThis,'sessionStorage',oldStorage);else delete globalThis.sessionStorage;}
});
