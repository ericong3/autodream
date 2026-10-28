import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
function compile(path,globals={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,...globals});return module.exports;}
function picker(remaining=4){const slots=[],calls=[];let i=0,tree;const react={useState(initial){const index=i++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{slots[index]=value;}];},useRef(initial){const index=i++;return slots[index]??(slots[index]={current:initial});}};const jsx=(type,props)=>({type,props});const Component=compile('components/GarageDamagePhotoPicker.tsx',{require:name=>name==='react'?react:{jsx,jsxs:jsx}}).default;function all(n,out=[]){if(Array.isArray(n))n.forEach(x=>all(x,out));else if(n&&typeof n==='object'){out.push(n);all(n.props?.children,out);}return out;}const render=()=>{i=0;tree=Component({remaining,busy:false,onFiles:async files=>{calls.push(files);}});};render();return{render,calls,inputs:()=>all(tree).filter(n=>n.type==='input'),text:()=>JSON.stringify(tree)};}
test('damage report has separate rear-camera and multi-photo upload inputs',()=>{
 const w=picker(),inputs=w.inputs();assert.equal(inputs[0].props.capture,'environment');assert.equal(inputs[0].props.multiple,undefined);assert.equal(inputs[1].props.multiple,true);assert.ok(w.text().includes('Take photo'));assert.ok(w.text().includes('Upload photos'));
});
test('photo selection passes multiple files and clears the picker so the same file can be chosen again',async()=>{
 const w=picker(),input={files:[{name:'first.jpg'},{name:'second.jpg'}],value:'selection'};w.inputs()[1].props.onChange({currentTarget:input});await new Promise(r=>setImmediate(r));assert.equal(w.calls.length,1);assert.equal(w.calls[0].length,2);assert.equal(input.value,'');
});
test('selecting too many photos uploads nothing and explains the remaining limit',()=>{
 const w=picker(1);w.inputs()[1].props.onChange({currentTarget:{files:[{},{}],value:'selection'}});w.render();assert.equal(w.calls.length,0);assert.ok(w.text().includes('Choose up to 1 more photo.'));
});
test('small photos are preserved and unsupported formats are rejected before upload',async()=>{
 const prepare=compile('utils/damagePhoto.ts',{File}).prepareDamagePhoto,file=new File(['small'],'photo.png',{type:'image/png'});assert.equal(await prepare(file),file);await assert.rejects(()=>prepare(new File(['x'],'photo.heic',{type:'image/heic'})),/JPEG, PNG or WebP/);
});
test('large phone photos are resized to JPEG within the existing limit and bitmap memory is released',async()=>{
 let closed=false,drawn=false;const bitmap={width:4000,height:3000,close:()=>{closed=true;}};const canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(){drawn=true;}}),toBlob:callback=>callback(new Blob([new Uint8Array(100000)],{type:'image/jpeg'}))};
 const prepare=compile('utils/damagePhoto.ts',{File,createImageBitmap:async()=>bitmap,document:{createElement:()=>canvas}}).prepareDamagePhoto;
 const result=await prepare(new File([new Uint8Array(3000000)],'camera.png',{type:'image/png'}));assert.equal(result.type,'image/jpeg');assert.equal(result.name,'camera.jpg');assert.ok(result.size<=2097152);assert.equal(canvas.width,1920);assert.equal(canvas.height,1440);assert.ok(drawn&&closed);
});
