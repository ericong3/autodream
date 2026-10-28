import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript'),tick=()=>new Promise(r=>setImmediate(r));
function screen({unlimited=true,failPhoto=false}={}){
 let cursor=0,tree;const slots=[],effects=[],calls=[],storage=new Map(),clears=[];
 const snapshot={canReport:true,canReview:false,unlimitedPhotos:unlimited,openCount:0,reports:[]};
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old[j]))){slots[i]=deps;effects.push(fn);}}};
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 const api=async(_kind,action,data)=>{calls.push({action,data});return action==='create'?{...snapshot,reportId:'entry',openCount:1}:snapshot;};
 const require=name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name.endsWith('/store'))return{useStore:selector=>selector({currentUser:{id:'head'},users:[]})};
  if(name.endsWith('/garageTintControl'))return{tintControl:api};
  if(name.endsWith('/damagePhoto'))return{prepareDamagePhoto:async f=>f};
  if(name.endsWith('/GarageDamageReports'))return{photoRequest:async(invoiceId,reportId,file)=>{calls.push({action:'upload',data:{invoiceId,reportId,file}});if(failPhoto){failPhoto=false;throw Error('Network interrupted');}return{attached:true};}};
  return{default:name.endsWith('/Modal')?'Modal':'PhotoPicker'};
 };
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/GarageCarCondition.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require,crypto:{randomUUID:()=> 'condition-request-00000001'},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setInterval:()=>1,clearInterval:()=>{}});
 function nodes(n,out=[],visible=true){if(Array.isArray(n))n.forEach(x=>nodes(x,out,visible));else if(n&&typeof n==='object'){out.push(n);if(!(visible&&n.type==='Modal'&&!n.props.isOpen))nodes(n.props?.children,out,visible);}return out;}
 const render=()=>{cursor=0;tree=module.exports.default({invoiceId:'invoice',workStatus:'in_progress',onChange:()=>{},onClear:value=>clears.push(value)});while(effects.length)effects.shift()();};
 const find=fn=>{const n=nodes(tree).find(fn);assert.ok(n,'Expected control');return n.props;};
 return{render,find,calls,storage,clears,visible:()=>nodes(tree)};
}
async function add(w,count=1){w.render();await tick();w.render();w.find(n=>n.type==='button'&&n.props['aria-haspopup']==='dialog').onClick();w.render();w.find(n=>n.type==='button'&&n.props.children==='Add entry').onClick();w.render();await w.find(n=>n.type==='PhotoPicker').onFiles(Array.from({length:count},(_,i)=>({name:`photo-${i}.jpg`})));w.render();w.find(n=>n.props?.['aria-label']==='Car condition area').onChange({target:{value:'Front left door'}});w.render();}
test('Car Condition starts as one button; form and photo history are inside the popup',async()=>{
 const w=screen();w.render();await tick();w.render();assert.equal(w.visible().some(n=>n.type==='PhotoPicker'),false);assert.equal(w.visible().filter(n=>n.type==='button').length,1);assert.equal(w.clears.at(-1),true);
 await add(w);assert.ok(w.find(n=>n.type==='PhotoPicker'));assert.equal(w.visible().some(n=>n.type==='textarea'),false);assert.equal(w.visible().filter(n=>n.type==='select').length,1);
});
test('one entry accepts six photos without truncation once the backend capability is installed',async()=>{
 const w=screen();await add(w,6);w.find(n=>n.type==='button'&&n.props.children==='Submit entry').onClick();await tick();w.render();assert.equal(w.calls.filter(c=>c.action==='upload').length,6);const create=w.calls.find(c=>c.action==='create');assert.equal(create.data.area,'Front left door');assert.equal(create.data.description,'Car condition photos');assert.equal(create.data.kind,'installation');assert.equal(w.storage.size,0);
});
test('pending backend rollout is explicit and never partially saves a six-photo entry',async()=>{
 const w=screen({unlimited:false});await add(w,6);w.find(n=>n.type==='button'&&n.props.children==='Submit entry').onClick();await tick();assert.equal(w.calls.filter(c=>c.action==='create'||c.action==='upload').length,0);
});
test('a failed photo retries the same durable entry instead of creating another',async()=>{
 const w=screen({failPhoto:true});await add(w);w.find(n=>n.type==='button'&&n.props.children==='Submit entry').onClick();await tick();w.render();assert.equal(w.storage.size,1);w.find(n=>n.type==='button'&&n.props.children==='Retry entry').onClick();await tick();w.render();const creates=w.calls.filter(c=>c.action==='create');assert.equal(creates.length,2);assert.deepEqual(creates[0].data,creates[1].data);assert.equal(w.storage.size,0);
});
