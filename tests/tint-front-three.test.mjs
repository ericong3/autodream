import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const front=['front_windscreen','front_left_window','front_right_window'];
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function screen(incoming){
  const slots=[],effects=[],cache=new Map();let cursor=0,tree,navigation;
  const React={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
    useEffect(fn,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((d,j)=>!Object.is(d,prior[j]))){slots[i]=deps;effects.push(fn);}},
  };
  function load(file){
    if(cache.has(file))return cache.get(file);
    const module={exports:{}};cache.set(file,module.exports);
    const localRequire=name=>{
      if(name==='react')return React;
      if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
      if(name==='react-router-dom')return{useParams:()=>({id:'customer',vehicleId:'vehicle'}),useLocation:()=>({state:incoming}),useNavigate:()=>((path,options)=>{navigation={path,...options};})};
      if(name==='lucide-react')return{Car:'car',Layers:'layers',AlertCircle:'alert'};
      if(name.endsWith('/GarageShell')||name.endsWith('/GarageGlassSetup'))return{default:name.split('/').at(-1)};
      if(name.endsWith('/GarageRenderedGlassMap'))return{glassName:(_body,position)=>position};
      if(name.endsWith('/garageCustomers'))return{getGarageVehicle:async()=>({size:'standard',make:'Test',model:'Car',year:2026})};
      if(name.endsWith('/garageTint'))return{getFullPrices:async()=>({'royal|standard':900}),getPositionPrices:async()=>({'front_windscreen|royal':300,'door_window|royal':100,'rear_windscreen|royal':200,'rear_panel_window|royal':80})};
      if(name.endsWith('/format'))return{formatRM:value=>'RM '+value};
      if(name.startsWith('../utils/'))return load(resolve(dirname(file),name+'.ts'));
      throw Error('Unexpected dependency '+name);
    };
    const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(source,{require:localRequire,module,exports:module.exports,setTimeout,clearTimeout},{filename:file});
    return module.exports;
  }
  const Component=load(resolve(root,'src/pages/GarageTintPackage.tsx')).default;
  function all(node,out=[]){if(!node)return out;if(Array.isArray(node)){node.forEach(n=>all(n,out));return out;}if(typeof node==='object'){out.push(node);all(node.props?.children,out);}return out;}
  const render=()=>{cursor=0;tree=Component();while(effects.length)effects.shift()();};
  const find=predicate=>{const node=all(tree).find(predicate);assert.ok(node,'Expected control');return node;};
  const click=label=>find(node=>node.type==='button'&&node.props.children===label).props.onClick();
  return{render,find,click,load,text:()=>JSON.stringify(tree),navigation:()=>navigation};
}
const base={body:'sedan',roof:'split',sideRows:0};
const incoming={vehicleLayout:base,packageType:'full',fullSeries:'royal',discount:0,
  selections:[...front,'rear_left_window','rear_right_window','rear_left_panel_window','rear_right_panel_window','rear_windscreen','front_roof_glass','rear_roof_glass'].map(position=>({position,series:'royal',vlt:'70%',price:position.includes('roof')?50:0})),
  extras:[{position:'small_window',series:'royal',vlt:'70%',price:0}],
};
test('front-three shortcut prices and submits only the three front pieces, clearing roof and extras',async()=>{
  const w=screen(incoming);w.render();await tick();w.render();w.click('Front 3 pieces / Half car');w.render();
  assert.equal(w.find(n=>n.type==='GarageGlassSetup').props.value.included.join(','),front.join(','));
  assert.ok(w.text().includes('RM 500'));
  assert.ok(w.find(n=>n.type==='button'&&n.props.disabled===true));
  w.click('Review Order');const order=w.navigation().state;
  assert.equal(order.packageType,'mix');assert.equal(order.finalTotal,500);
  assert.deepEqual(Array.from(order.selections,s=>s.position),front);
  assert.deepEqual(Array.from(order.selections,s=>s.price),[300,100,100]);
  assert.equal(order.extras.length,0);assert.ok(order.selections.every(s=>s.series==='royal'&&s.vlt==='70%'));
  const back=screen(order);back.render();await tick();back.render();back.click('Review Order');
  assert.equal(back.navigation().state.finalTotal,500);
  assert.deepEqual(Array.from(back.navigation().state.selections,s=>s.position),front);
});
test('full-car shortcut restores vehicle glass and the existing package price',async()=>{
  const w=screen(incoming);w.render();await tick();w.render();w.click('Front 3 pieces / Half car');w.render();w.click('Full car');w.render();w.click('Review Order');
  assert.equal(w.navigation().state.packageType,'full');assert.equal(w.navigation().state.selections.length,10);assert.equal(w.navigation().state.finalTotal,1000);
});
test('custom setup selecting the front three uses the same per-piece pricing',async()=>{
  const w=screen(incoming);w.render();await tick();w.render();w.find(n=>n.type==='GarageGlassSetup').props.onApply({...base,included:front});w.render();w.click('Review Order');
  assert.equal(w.navigation().state.finalTotal,500);assert.equal(w.navigation().state.selections.length,3);
});
test('front-three positions exist for every supported vehicle without rear or roof glass',()=>{
  const w=screen(),glass=w.load(resolve(root,'src/utils/vehicleGlass.ts'));
  for(const body of Object.keys(glass.bodyNames)){
    const positions=glass.vehicleGlassPositions({body,roof:body==='bus'?'none':'panoramic',sideRows:body==='bus'?6:body==='van'?3:0});
    assert.ok(front.every(p=>positions.includes(p)));
  }
  assert.equal(glass.isFrontThreeGlass(front),true);
  assert.equal(glass.isFrontThreeGlass([...front,'rear_windscreen']),false);
  assert.equal(glass.isFrontThreeGlass([front[0],front[0],front[1]]),false);
});
