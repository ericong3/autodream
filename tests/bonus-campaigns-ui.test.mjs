import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const libModule={exports:{}};vm.runInNewContext(transpile(readFileSync(new URL('../src/lib/bonusCampaigns.ts',import.meta.url),'utf8')),{module:libModule,exports:libModule.exports,Intl,Date});
const library=libModule.exports;
const sample={id:'11111111-1111-4111-8111-111111111111',title:'Example campaign',startMonth:'2026-10',endMonth:'2026-12',minimumUnits:6,amountPerUnit:500,revision:1,publishedAt:null,participants:[{id:'sales',name:'Example salesperson'}],confirmedMonths:[]};
function fixture({role='director',request,storage=new Map()}={}){
 let cursor=0,tree,dirty=true,actor='director',serial=0;const slots=[],effects=[],calls=[];
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(next!==slots[i]){slots[i]=next;dirty=true;}}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,k)=>d!==old.deps[k])){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 const list={enabled:true,campaigns:[sample],participants:sample.participants,hasMore:false};
 const api=async(action,data)=>{calls.push({action,data:JSON.parse(JSON.stringify(data??{}))});return request?request(action,data):list;};
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 vm.runInNewContext(transpile(readFileSync(new URL('../src/pages/BonusCampaigns.tsx',import.meta.url),'utf8')),{module,exports:module.exports,Intl,Date,crypto:{randomUUID:()=>`bonus-request-${++serial}`},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},require:n=>n==='react'?react:n==='react/jsx-runtime'?{jsx,jsxs:jsx}:n.endsWith('/store')?{useStore:select=>select({currentUser:{id:actor,role}})}:n.endsWith('/bonusCampaigns')?{...library,bonusCampaignRequest:api}:n.endsWith('/format')?{formatRM:n=>`RM${n}`}:n==='lucide-react'?new Proxy({},{get:(_,name)=>String(name)}):{default:n.split('/').at(-1)}});
 function nodes(n,out=[]){if(Array.isArray(n))n.forEach(v=>nodes(v,out));else if(n&&typeof n==='object'){if(n.type==='Modal'&&!n.props.isOpen)return out;out.push(n);nodes(n.props?.children,out);}return out;}
 function text(n){if(Array.isArray(n))return n.map(text).join('');if(n&&typeof n==='object')return text(n.props?.children);return typeof n==='string'||typeof n==='number'?String(n):'';}
 const render=()=>{cursor=0;dirty=false;tree=module.exports.default();while(effects.length)effects.shift()();};
 const all=()=>nodes(tree),flush=async()=>{for(let i=0;i<8;i++){if(dirty)render();await new Promise(setImmediate);}};
 const button=name=>all().find(n=>n.type==='button'&&text(n).trim()===name);
 const input=name=>{const label=all().find(n=>n.type==='label'&&text(n).startsWith(name));return nodes(label).find(n=>n.type==='input');};
 return {calls,storage,flush,all,text:()=>text(tree),button,click(name){const b=button(name);assert.ok(b,`Button missing: ${name}`);assert.ok(!b.props.disabled,`Button disabled: ${name}`);b.props.onClick();},change(name,value){input(name).props.onChange({target:{value}});},submit(){all().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});},actor(next){actor=next;dirty=true;}};
}
test('campaign statuses distinguish drafts, future enrolment, active months and completed periods',()=>{
 assert.equal(library.campaignView(sample,'2026-11'),'upcoming');assert.equal(library.campaignView({...sample,publishedAt:'2026-10-01'},'2026-11'),'active');assert.equal(library.campaignView({...sample,publishedAt:'2026-10-01'},'2027-01'),'completed');assert.equal(library.campaignView({...sample,publishedAt:'2026-10-01'},'2026-09'),'upcoming');
 assert.deepEqual(Array.from(library.campaignMonths({...sample,startMonth:'2026-11',endMonth:'2027-01'})),['2026-11','2026-12','2027-01']);assert.equal(library.malaysiaMonth(new Date('2026-10-31T16:00:00Z')),'2026-11');
});
test('year-end template uses five-unit monthly threshold, RM500 and the selected enrolment',async()=>{
 const w=fixture();await w.flush();w.click('New campaign');await w.flush();w.click('Use year-end 2026 rules');await w.flush();w.submit();w.submit();await w.flush();
 const saves=w.calls.filter(c=>c.action==='save');assert.equal(saves.length,1);assert.deepEqual(saves[0].data.campaign,{title:'Year-end 2026',startMonth:'2026-10',endMonth:'2026-12',minimumUnits:5,amountPerUnit:500,participantIds:['sales']});
});
test('unknown saves keep a durable original request and a usable retry button inside the form',async()=>{
 let attempts=0;const w=fixture({request:async action=>{if(action==='list')return {enabled:true,campaigns:[],participants:sample.participants,hasMore:false};if(++attempts===1)throw Object.assign(Error('Connection lost'),{code:'UNAVAILABLE'});return {id:sample.id,revision:1};}});
 await w.flush();w.click('New campaign');await w.flush();w.change('Campaign name','Retry example');await w.flush();w.submit();await w.flush();assert.equal(w.storage.size,1);assert.ok(!w.button('Retry original save').props.disabled);w.submit();await w.flush();assert.equal(w.storage.size,0);const saves=w.calls.filter(c=>c.action==='save');assert.deepEqual(saves[0],saves[1]);
});
test('reload recovers a pending save instead of creating a duplicate campaign',async()=>{
 const operation={action:'save',data:{requestId:'original-bonus-request-001',campaign:{title:'Original',startMonth:'2026-10',endMonth:'2026-12',minimumUnits:6,amountPerUnit:500,participantIds:['sales']}}};
 const storage=new Map([['autodream-bonus-pending:director',JSON.stringify(operation)]]);const w=fixture({storage});await w.flush();assert.ok(w.button('New campaign').props.disabled);w.click('Retry original save');await w.flush();assert.deepEqual(w.calls.find(c=>c.action==='save').data,operation.data);assert.equal(storage.size,0);
});
test('late previous-account lists cannot populate the next account',async()=>{
 const pending=[];const w=fixture({request:()=>new Promise(resolve=>pending.push(resolve))});await w.flush();w.actor('next-director');await w.flush();pending[0]({enabled:true,campaigns:[sample],participants:sample.participants,hasMore:false});await w.flush();assert.ok(!w.text().includes('Example campaign'));pending[1]({enabled:true,campaigns:[],participants:[],hasMore:false});await w.flush();assert.ok(w.text().includes('No active campaigns yet.'));
});
test('shareholder oversight cannot open campaign creation',async()=>{const w=fixture({role:'shareholder'});await w.flush();assert.ok(w.button('New campaign').props.disabled);});
