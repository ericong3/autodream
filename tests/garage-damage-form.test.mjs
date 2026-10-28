import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript'),tick=()=>new Promise(r=>setImmediate(r));
function screen(failUpload=false){let cursor=0,tree;const slots=[],effects=[],calls=[],storage=new Map();const snapshot={invoiceId:'invoice',canReport:true,canReview:false,openCount:0,reports:[]};
 const React={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old[j]))){slots[i]=deps;effects.push(fn);}}};
 const api=async(kind,action,data)=>{calls.push({action,data});if(action==='upload'&&failUpload){failUpload=false;throw Object.assign(Error('Photo upload failed'),{code:'INVALID'});}return action==='create'?{...snapshot,reportId:'saved-report',openCount:1}:snapshot;};
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 const require=name=>name==='react'?React:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name.endsWith('/store')?{useStore:selector=>selector({currentUser:{id:'head'},users:[]})}:name.endsWith('/garageTintControl')?{tintControl:api}:name.endsWith('/damagePhoto')?{prepareDamagePhoto:async file=>file}:{default:'PhotoPicker'};
 class Reader{readAsDataURL(){this.result='data:image/jpeg;base64,cGhvdG8=';this.onload();}}
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/GarageDamageReports.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{require,module,exports:module.exports,FileReader:Reader,crypto:{randomUUID:()=> 'request-000000000001'},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setInterval:()=>1,clearInterval:()=>{},window:{addEventListener(){},removeEventListener(){}}});
 function all(n,out=[]){if(Array.isArray(n))n.forEach(v=>all(v,out));else if(n&&typeof n==='object'){out.push(n);all(n.props?.children,out);}return out;}
 const render=()=>{cursor=0;tree=module.exports.default({invoiceId:'invoice'});while(effects.length)effects.shift()();};const find=fn=>{const node=all(tree).find(fn);assert.ok(node);return node.props;};
 return{render,find,calls,storage,text:()=>JSON.stringify(tree)};
}
async function fill(w){w.render();await tick();w.render();w.find(n=>n.props?.['aria-label']==='Damage area').onChange({target:{value:'Front door'}});w.find(n=>n.props?.['aria-label']==='Damage description').onChange({target:{value:'Scratch'}});await w.find(n=>n.type==='PhotoPicker').onFiles([{name:'damage.jpg',type:'image/jpeg',size:10}]);w.render();}
test('photos are available before saving, and one Save report creates the report then attaches its photo',async()=>{
 const w=screen();await fill(w);assert.ok(!w.text().includes('After saving, attach'));assert.ok(w.text().includes('damage.jpg'));await w.find(n=>n.type==='button'&&n.props.children==='Save report').onClick();w.render();
 assert.deepEqual(w.calls.filter(c=>['create','upload'].includes(c.action)).map(c=>c.action),['create','upload']);assert.equal(w.calls.find(c=>c.action==='upload').data.reportId,'saved-report');assert.equal(w.storage.size,0);assert.ok(!w.text().includes('damage.jpg'));
});
test('photo failure retains the same report intent and pending photo, so Retry cannot create a second report',async()=>{
 const w=screen(true);await fill(w);await w.find(n=>n.type==='button'&&n.props.children==='Save report').onClick();w.render();assert.equal(w.storage.size,1);assert.ok(w.text().includes('damage.jpg'));assert.ok(w.text().includes('Report saved. Photo upload is incomplete'));
 await w.find(n=>n.type==='button'&&n.props.children==='Retry').onClick();w.render();const creates=w.calls.filter(c=>c.action==='create');assert.equal(creates.length,2);assert.deepEqual(creates[0].data,creates[1].data);assert.equal(w.storage.size,0);
});

