import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
function screen(confirm=async()=>true){let cursor=0,tree,calls=0;const slots=[],module={exports:{}};
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=v;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});}};
 const jsx=(type,props)=>({type,props});const require=name=>name==='react'?react:{jsx,jsxs:jsx};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/GarageGlassUnclaim.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{require,module,exports:module.exports});
 const render=(busy=false)=>{cursor=0;tree=module.exports.default({busy,onConfirm:()=>{calls++;return confirm();}});};
 function nodes(n,out=[]){if(Array.isArray(n)){n.forEach(x=>nodes(x,out));}else if(n&&typeof n==='object'){out.push(n);nodes(n.props?.children,out);}return out;}
 const button=label=>{const n=nodes(tree).find(n=>n.type==='button'&&n.props.children===label);assert.ok(n,'Expected '+label);return n.props;};return{render,button,calls:()=>calls};
}
test('unclaim requires a second explicit click; keeping claim sends no request',async()=>{
 const w=screen();w.render();w.button('Unclaim glass').onClick();w.render();assert.equal(w.calls(),0);w.button('Keep my claim').onClick();w.render();assert.equal(w.calls(),0);
 w.button('Unclaim glass').onClick();w.render();w.button('Yes, unclaim').onClick();await new Promise(r=>setImmediate(r));assert.equal(w.calls(),1);
});
test('rapid confirmation clicks issue only one release and show pending feedback',async()=>{
 let finish;const w=screen(()=>new Promise(r=>{finish=r;}));w.render();w.button('Unclaim glass').onClick();w.render();const click=w.button('Yes, unclaim').onClick;click();click();assert.equal(w.calls(),1);w.render();assert.equal(w.button('Unclaiming…').disabled,true);finish(true);
});
