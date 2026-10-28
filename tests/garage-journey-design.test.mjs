import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript'),jsx=(type,props)=>({type,props}),module={exports:{}};
let expansionState=null;
const require=name=>name==='react'?{useState:initial=>[expansionState??initial,value=>{expansionState=value;}]}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='lucide-react'?new Proxy({},{get:(_target,key)=>key}):{};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/GarageJourneyNavigator.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{require,module,exports:module.exports});
const Navigator=module.exports.default,keys=['created','installation','approval','inspection','payment','delivery','warranty','closed'];
const stages=keys.map((key,i)=>({key,label:key==='inspection'?'Salesman Check':key,state:i===0?'done':i===1?'current':'upcoming',responsible:'Garage team',by:i===0?'Sample staff':undefined}));
function nodes(n,out=[]){if(Array.isArray(n))n.forEach(x=>nodes(x,out));else if(n&&typeof n==='object'){out.push(n);nodes(n.props?.children,out);}return out;}
function render(selectedKey='installation',extra={}){expansionState=null;const selected=[];let tree;const refresh=()=>{tree=Navigator({stages,selectedKey,onSelect:key=>selected.push(key),...extra});};refresh();return{get all(){return nodes(tree);},selected,refresh};}
test('all eight workflow stages remain visible as navigation targets exactly once, with full labels',()=>{
 const w=render(),buttons=w.all.filter(n=>n.props?.['data-stage-key']);assert.deepEqual(buttons.map(n=>n.props['data-stage-key']),keys);assert.ok(JSON.stringify(buttons).includes('Salesman Check'));for(const button of buttons)button.props.onClick();assert.deepEqual(w.selected,keys);
});
test('viewing payment preserves installation as the current step and offers return navigation',()=>{
 const w=render('payment'),buttons=w.all.filter(n=>n.props?.['data-stage-key']);assert.equal(buttons.find(n=>n.props['aria-current']==='step').props['data-stage-key'],'installation');assert.equal(buttons.find(n=>n.props['aria-pressed']).props['data-stage-key'],'payment');w.all.find(n=>n.props?.className==='gj-return').props.onClick();assert.deepEqual(w.selected,['installation']);
});
test('compact navigator contains eight direct steps without chapter groups or a large stage header',()=>{
 const w=render();assert.equal(w.all.filter(n=>n.props?.['data-stage-key']).length,8);assert.equal(w.all.some(n=>n.props?.className==='gj-chapter'||n.props?.className==='gj-current'),false);assert.equal(w.all.filter(n=>n.type==='h3').length,1);
});
test('closed and empty pipelines do not invent an in-progress stage',()=>{
 assert.equal(Navigator({stages:[],selectedKey:'created',onSelect:()=>{}}),null);const w=render('closed',{stages:stages.map(s=>({...s,state:'done'}))});assert.equal(w.all.some(n=>n.props?.['aria-current']==='step'),false);assert.ok(JSON.stringify(w.all).includes('All stages completed'));
});
