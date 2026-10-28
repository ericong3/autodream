import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript'),jsx=(type,props)=>({type,props});
function compile(file,require){const module={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/'+file+'.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{require,module,exports:module.exports});return module.exports.default;}
function nodes(n,out=[],visible=true){if(Array.isArray(n))n.forEach(x=>nodes(x,out,visible));else if(n&&typeof n==='object'){if(visible&&n.props?.hidden)return out;out.push(n);nodes(n.props?.children,out,visible);}return out;}
const Workspace=compile('GarageTintStageWorkspace',name=>{
 if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
 if(name.endsWith('/tintPricing'))return{GLASS_LABEL:{},TINT_SERIES:[]};
 return{default:name.split('/').at(-1)};
});
const props={invoice:{id:'invoice',workStatus:'in_progress',createdBy:'sales'},order:{selections:[],extras:[]},items:[],claims:[],orderSummary:jsx('OrderSummary',{}),action:jsx('DeliveryOrWarrantyAction',{}),onChange:()=>{},onReady:()=>{},onDamageClear:()=>{},onPayment:()=>{}};
const visible=stage=>nodes(Workspace({...props,stage})).map(n=>n.type);
test('the existing pipeline selects the correct functions without stacked duplicate panels',()=>{
 const expected={created:['OrderSummary',],installation:['GarageInvoiceGlassWork','GarageTintUsage','GarageInstallationPhotos','GarageInstallationReview',],approval:['GarageInstallationReview',],inspection:['GarageInstallationReview'],payment:['GarageTintPayments'],delivery:['DeliveryOrWarrantyAction'],warranty:['GarageTintAfterSales','DeliveryOrWarrantyAction'],closed:['GarageTintAfterSales']};
 for(const [stage,components] of Object.entries(expected)){
  const actual=visible(stage).filter(type=>typeof type==='string'&&(type.startsWith('Garage')||['OrderSummary','DeliveryOrWarrantyAction'].includes(type)));
  assert.deepEqual(actual.sort(),components.sort(),stage);
 }
});
test('switching stages retains exactly one mounted instance of live checks, payments and glass work',()=>{
 for(const stage of ['installation','approval','payment','delivery']){
  const all=nodes(Workspace({...props,stage}),[],false);
  for(const name of ['GarageInstallationReview','GarageTintPayments','GarageInvoiceGlassWork'])assert.equal(all.filter(n=>n.type===name).length,1);
  assert.equal(all.find(n=>n.type==='GarageInstallationReview').props.viewStage,stage);
  assert.equal(all.find(n=>n.type==='GarageInstallationReview').props.onReady,props.onReady);
 }
});
test('delivery payment shortcut changes the selected stage without executing a work order mutation',()=>{
 let selected=false;const tree=Workspace({...props,stage:'delivery',onPayment:()=>{selected=true;}});const button=nodes(tree).find(n=>n.type==='button');button.props.onClick();assert.equal(selected,true);
});
function review(viewStage,state,role,id='head'){
 let index=0;const data={review:{state,revision:1,confirmations:{}},history:[]};const react={useState(initial){return[index++===0?data:initial,()=>{}];},useRef:value=>({current:value}),useEffect:()=>{}};
 const Component=compile('GarageInstallationReview',name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name.endsWith('/store'))return{useStore:selector=>selector({currentUser:{id,role},users:[]})};
  if(name.endsWith('/garageInstallationReview'))return{};
  if(name.endsWith('/tintPricing'))return{GLASS_LABEL:{}};
  throw Error(name);
 });return nodes(Component({invoiceId:'invoice',ownerId:'sales',items:[],viewStage})).filter(n=>n.type==='button').map(n=>n.props.children);
}
test('Head and salesman approvals appear only in their own selected stages and for their authorised role',()=>{
 assert.ok(review('approval','head','garage_head').includes('Approve workshop work'));
 assert.ok(!review('installation','head','garage_head').includes('Approve workshop work'));
 assert.ok(!review('inspection','head','garage_head').includes('Approve workshop work'));
 assert.ok(!review('approval','head','garage_salesman','sales').includes('Approve workshop work'));
 assert.ok(review('inspection','sales','garage_salesman','sales').includes('Pass final inspection'));
 assert.ok(!review('installation','sales','garage_salesman','sales').includes('Pass final inspection'));
});
