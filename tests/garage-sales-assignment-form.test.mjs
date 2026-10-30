import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
const options={enabled:true,owners:[{id:'sales',name:'Sales'},{id:'director',name:'Director'}],usedCarStaff:[{id:'uc',name:'Used Car'}],external:[{id:'profile',name:'External',brand:'Sample',branch:'Branch'}]};
function fixture(request=async action=>action==='options'?options:{deals:[],hasMore:false}){
 let cursor=0,value,actor='sales',tree,dirty=true,ready=false;
 const slots=[],effects=[];
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{const next=typeof v==='function'?v(slots[i]):v;if(next!==slots[i]){slots[i]=next;dirty=true;}}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,k)=>d!==old.deps[k])){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/GarageSalesAssignment.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Date,require:n=>n==='react'?react:n==='react/jsx-runtime'?{jsx,jsxs:jsx}:n.endsWith('/store')?{useStore:select=>select({currentUser:{id:actor}})}:{salesReferralRequest:request}});
 const render=()=>{cursor=0;dirty=false;tree=module.exports.default({value,onChange:v=>{value=v;dirty=true;},onReady:v=>{ready=v;}});while(effects.length)effects.shift()();};
 const flush=async()=>{for(let i=0;i<8;i++){if(dirty)render();await new Promise(setImmediate);}};
 const nodes=(n,out=[])=>{if(Array.isArray(n))n.forEach(v=>nodes(v,out));else if(n&&typeof n==='object'){out.push(n);nodes(n.props?.children,out);}return out;};
 const field=name=>nodes(tree).find(n=>n.props?.['aria-label']===name);
 return {flush,get value(){return value;},get ready(){return ready;},field,choose(name,v){field(name).props.onChange({target:{value:v}});dirty=true;},actor(v){actor=v;dirty=true;}};
}
test('own eligible Garage salesperson defaults as required PIC; one optional referrer switches cleanly',async()=>{
 const w=fixture();await w.flush();assert.equal(w.value.ownerId,'sales');assert.equal(w.value.referrer.kind,'none');assert.equal(w.ready,true);
 w.choose('Referrer type','external');await w.flush();assert.equal(w.ready,false);assert.ok(w.field('External salesperson'));assert.equal(w.field('Used Car salesperson'),undefined);
 w.choose('External salesperson','profile');await w.flush();assert.equal(w.ready,true);
 w.choose('Referrer type','used_car');await w.flush();assert.equal(w.value.referrer.profileId,undefined);assert.equal(w.ready,false);
 w.choose('Used Car salesperson','uc');await w.flush();assert.equal(w.ready,true);assert.ok(w.field('Deal month'));assert.equal(w.field('External salesperson'),undefined);
});
test('changing the month filters choices but preserves an already selected exact deal',async()=>{
 const deal={customerId:'customer',carId:'car',submittedAt:'2026-10-10T10:00:00Z',vehicle:'Example car',customer:'Example customer'};
 const w=fixture(async(action,data)=>action==='options'?options:{deals:data.month==='2026-09'?[]:[deal],hasMore:false});await w.flush();w.choose('Referrer type','used_car');await w.flush();w.choose('Used Car salesperson','uc');await w.flush();w.choose('Deal month','2026-10');await w.flush();w.choose('Used Car deal','customer:car:2026-10-10T10:00:00Z');await w.flush();w.choose('Deal month','2026-09');await w.flush();assert.equal(w.value.referrer.deal.carId,'car');assert.equal(w.field('Used Car deal').props.value,'customer:car:2026-10-10T10:00:00Z');
});
test('late previous-account options cannot populate the new staff account',async()=>{
 const requests=[];const w=fixture(()=>new Promise(resolve=>requests.push(resolve)));await w.flush();assert.equal(w.ready,false);w.actor('director');await w.flush();requests[0](options);await w.flush();assert.equal(w.value,undefined);assert.equal(w.ready,false);requests[1](options);await w.flush();assert.equal(w.value.ownerId,'director');assert.equal(w.ready,true);
});
test('rollout off leaves existing orders usable without a new assignment',async()=>{
 const w=fixture(async()=>({enabled:false,owners:[],usedCarStaff:[],external:[]}));await w.flush();assert.equal(w.value,undefined);assert.equal(w.ready,true);assert.equal(w.field('Person in charge'),undefined);
});
