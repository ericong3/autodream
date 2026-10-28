import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {canInstallGarageTint} from '../src/utils/garageRoles.ts';
const require=createRequire(import.meta.url),ts=require('typescript'),tick=()=>new Promise(r=>setImmediate(r));
function screen(role='garage_head',api={}){
 const slots=[],calls=[];let cursor=0,tree,changes=0;
 const user={id:'head',role},React={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(){cursor++;}};
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 const mutation=name=>async(...args)=>{calls.push({name,args});if(api[name])return api[name](...args);const item={id:args[0],invoiceId:'invoice',installerId:'head',status:name==='setTintWorkOrderItemStatus'?'installed':'taken',sqft:5,updatedAt:'2026-10-28T15:00:01Z'};return name==='setTintWorkOrderItemSqft'?{item}:item;};
 const localRequire=name=>{
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name==='react-router-dom')return{Link:'Link'};
  if(name.endsWith('/GarageJobGlassMap'))return{default:'GlassMap'};
  if(name.endsWith('/store'))return{useStore:selector=>selector({currentUser:user})};
  if(name.endsWith('/garageRoles'))return{canInstallGarageTint};
  if(name.endsWith('/garageTint'))return Object.fromEntries(['claimTintWorkOrderItem','releaseTintWorkOrderItem','setTintWorkOrderItemSqft','setTintWorkOrderItemStatus'].map(name=>[name,mutation(name)]));
  throw Error(name);
 };
 const source=ts.transpileModule(readFileSync(new URL('../src/components/GarageInvoiceGlassWork.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{require:localRequire,module,exports:module.exports});
 const item={id:'piece',invoiceId:'invoice',status:'pending'},props={invoiceId:'invoice',jobId:'job',items:[item],workStatus:'waiting_for_installer',onChange:()=>{changes++;}};
 const render=extra=>{cursor=0;tree=module.exports.default({...props,...extra});return tree;};
 const map=()=>tree.props.children.find(n=>n?.type==='GlassMap').props;
 return{render,map,item,calls,changes:()=>changes,text:()=>JSON.stringify(tree)};
}
test('Garage Head invoice map exposes claim and routes the claim through the trusted installer API',async()=>{
 const w=screen();w.render();assert.equal(w.map().canWork,true);w.map().onClaim(w.item);await tick();
 assert.equal(w.calls[0].name,'claimTintWorkOrderItem');assert.deepEqual(w.calls[0].args,['piece','head']);assert.equal(w.changes(),1);
});
test('invoice map records head usage and completes their glass using existing mutations',async()=>{
 const w=screen();w.render({workStatus:'in_progress'});assert.equal(await w.map().onUsage(w.item,5),true);w.map().onComplete(w.item);await tick();
 assert.deepEqual(w.calls.map(c=>c.name),['setTintWorkOrderItemSqft','setTintWorkOrderItemStatus']);assert.deepEqual(w.calls[0].args,['piece',5,'head']);assert.deepEqual(w.calls[1].args,['piece','installed','head']);
});
test('sales and finished/review-stage maps remain read-only and cannot call worker mutations',async()=>{
 const sales=screen('garage_salesman');sales.render();assert.equal(sales.map().canWork,false);sales.map().onClaim(sales.item);await tick();assert.equal(sales.calls.length,0);
 for(const workStatus of ['pending_approval','sales_inspection','ready_for_delivery','delivered','warranty_registered']){
  const w=screen();w.render({workStatus});assert.equal(w.map().canWork,false);w.map().onClaim(w.item);await tick();assert.equal(w.calls.length,0);
 }
});
test('invoice map refuses another invoice piece and locks rapid duplicate claims',async()=>{
 let finish;const w=screen('garage_head',{claimTintWorkOrderItem:()=>new Promise(resolve=>{finish=resolve;})});w.render();w.map().onClaim({...w.item,invoiceId:'other'});await tick();assert.equal(w.calls.length,0);
 w.map().onClaim(w.item);w.map().onClaim(w.item);assert.equal(w.calls.length,1);finish();await tick();assert.equal(w.changes(),1);
});
test('a failed claim is shown on the invoice page',async()=>{
 const w=screen('garage_head',{claimTintWorkOrderItem:async()=>{throw Error('This glass was taken by another installer.');}});w.render();w.map().onClaim(w.item);await tick();w.render();assert.ok(w.text().includes('This glass was taken by another installer.'));assert.equal(w.changes(),0);
});

test('claim click shows immediate progress, then committed ownership without waiting for parent refresh',async()=>{
 let finish;const w=screen('garage_head',{claimTintWorkOrderItem:()=>new Promise(r=>{finish=r;})});
 w.render();const result=w.map().onClaim(w.item);w.render();
 assert.equal(w.map().busy,true);assert.ok(w.text().includes('Claiming glass…'));
 assert.equal(w.map().items[0].installerId,undefined);
 const saved={...w.item,status:'taken',installerId:'head',updatedAt:'2026-10-28T15:00:01Z'};
 finish(saved);await result;w.render();
 assert.equal(w.map().busy,false);assert.equal(w.map().items[0].installerId,'head');assert.equal(w.map().items[0].status,'taken');
 // An older refresh must not undo the committed result.
 w.render({items:[{...w.item,updatedAt:'2026-10-28T15:00:00Z'}]});assert.equal(w.map().items[0].installerId,'head');
 // A newer authoritative change from another worker must still win.
 w.render({items:[{...w.item,status:'taken',installerId:'other',updatedAt:'2026-10-28T15:00:02Z'}]});assert.equal(w.map().items[0].installerId,'other');
});

test('failed claims never display confirmed ownership',async()=>{
 const w=screen('garage_head',{claimTintWorkOrderItem:async()=>{throw Error('Already claimed');}});w.render();assert.equal(await w.map().onClaim(w.item),false);w.render();assert.equal(w.map().items[0].status,'pending');assert.equal(w.map().items[0].installerId,undefined);assert.equal(w.map().actionError,'Already claimed');
});

test('late claim result cannot update another invoice map or refresh its details',async()=>{
 let finish;const w=screen('garage_head',{claimTintWorkOrderItem:()=>new Promise(r=>{finish=r;})});w.render();const action=w.map().onClaim(w.item);w.render({invoiceId:'other',items:[{id:'other-piece',invoiceId:'other',status:'pending'}]});finish({...w.item,installerId:'head',status:'taken',updatedAt:'2026-10-28T15:00:01Z'});await action;assert.equal(w.changes(),0);
});

test('unclaim uses the existing release API and immediately displays the confirmed available row',async()=>{
 const w=screen('garage_head',{releaseTintWorkOrderItem:async()=>({...w.item,status:'pending',updatedAt:'2026-10-28T15:00:03Z'})});
 const item={...w.item,status:'taken',installerId:'head',sqft:0};w.render({items:[item],workStatus:'in_progress'});
 assert.equal(await w.map().onUnclaim(item),true);w.render({items:[item],workStatus:'in_progress'});
 assert.equal(w.calls[0].name,'releaseTintWorkOrderItem');assert.deepEqual(w.calls[0].args,['piece','head']);assert.equal(w.map().items[0].status,'pending');assert.equal(w.map().items[0].installerId,undefined);
});

test('unclaim refuses another installer, recorded usage, completed glass and correction work',async()=>{
 for(const patch of [{installerId:'other'},{sqft:1},{status:'installed'},{needsCorrection:true}]){
  const w=screen(),item={...w.item,status:'taken',installerId:'head',sqft:0,...patch};w.render({items:[item],workStatus:'in_progress'});assert.equal(await w.map().onUnclaim(item),false);assert.equal(w.calls.length,0);
 }
});
