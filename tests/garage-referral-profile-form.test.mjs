import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
function setup({staff=false,onSave=async()=>{}}={}){
 let cursor=0,tree,serial=0;const slots=[],calls=[];
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});}};
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/GarageReferralProfileForm.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:n=>n==='react'?react:{jsx,jsxs:jsx},TextEncoder,crypto:{randomUUID:()=>`profile-request-${++serial}`}});
 function all(n,out=[]){if(Array.isArray(n))n.forEach(v=>all(v,out));else if(n&&typeof n==='object'){out.push(n);all(n.props?.children,out);}return out;}
 function text(n){if(Array.isArray(n))return n.map(text).join('');if(n&&typeof n==='object')return text(n.props?.children);return typeof n==='string'?n:'';}
 const render=()=>{cursor=0;tree=module.exports.default({staff,onSave:async data=>{calls.push(JSON.parse(JSON.stringify(data)));await onSave(data);}});};
 function label(name){const found=all(tree).find(n=>n.type==='label'&&text(n).startsWith(name));assert.ok(found,`Missing ${name}`);return all(found).find(n=>n.type==='input').props;}
 return {calls,render,all:()=>all(tree),text:()=>text(tree),input:label,change(name,value){label(name).onChange({target:{value}});render();},choose(name){label(name).onChange();render();},submit:()=>all(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}})};
}
function basic(w){for(const [label,value] of [['Name / registered business name','Sample Partner'],['Phone','0100000000'],['Dealership brand','Sample'],['Dealership / branch','Sample branch']])w.change(label,value);}
test('one profile form defaults to accountless and saves without email, password or mandatory tax details',async()=>{
 const w=setup();w.render();basic(w);
 assert.equal(w.input('Remain accountless').checked,true);assert.equal(w.input('Create account').checked,false);
 assert.equal(w.all().filter(n=>n.type==='input'&&n.props.required).length,4);
 assert.equal(w.all().some(n=>n.type==='input'&&['email','password'].includes(n.props.type)),false);
 await w.submit();assert.equal(w.calls[0].createAccount,false);assert.equal(w.calls[0].profile.legalName,'Sample Partner');assert.equal(w.calls[0].email,undefined);assert.equal(w.calls[0].password,undefined);
});
test('Create account reveals credentials on the same form; choosing accountless clears and omits them',async()=>{
 const w=setup();w.render();basic(w);w.choose('Create account');
 assert.equal(w.all().filter(n=>n.type==='input'&&n.props.type==='password').length,2);
 w.change('Email','partner@example.test');w.change('Password','sample-password');w.change('Confirm password','sample-password');
 w.choose('Remain accountless');assert.equal(w.all().some(n=>n.type==='input'&&n.props.type==='password'),false);
 w.choose('Create account');assert.equal(w.input('Email').value,'');assert.equal(w.input('Password').value,'');assert.equal(w.input('Confirm password').value,'');
 w.choose('Remain accountless');await w.submit();assert.equal(w.calls[0].email,undefined);assert.equal(w.calls[0].password,undefined);
});
test('staff choose account setup on the same profile without choosing the salesman password',async()=>{
 const w=setup({staff:true});w.render();basic(w);w.choose('Create account');
 assert.equal(w.all().some(n=>n.type==='input'&&['email','password'].includes(n.props.type)),false);
 await w.submit();assert.equal(w.calls[0].createAccount,true);assert.equal(w.calls[0].profile.phone,'0100000000');assert.equal(w.calls[0].password,undefined);
});
test('uncertain saves retry the original profile and reference; rapid clicks cannot duplicate a save',async()=>{
 let fail=true;const w=setup({onSave:async()=>{if(fail){fail=false;throw Object.assign(Error('Connection interrupted'),{code:'CLOUD'});}}});w.render();basic(w);await w.submit();w.render();
 assert.ok(w.text().includes('Retry save'));assert.equal(w.all().find(n=>n.type==='fieldset').props.disabled,true);
 await w.submit();assert.deepEqual(w.calls[1],w.calls[0]);
 let finish;const locked=setup({onSave:()=>new Promise(resolve=>finish=resolve)});locked.render();basic(locked);const first=locked.submit();await locked.submit();assert.equal(locked.calls.length,1);finish();await first;
});
test('a late response from the previous staff login cannot unlock a new staff member’s pending save',async()=>{
 let actor={id:'head',role:'garage_head'},cursor=0,tree;const slots=[],effects=[],pending=[],writes=[];
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();const entry={deps};slots[i]=entry;effects.push(()=>entry.cleanup=fn());}}};
 const api=async(action,data)=>{if(action==='list')return {profiles:[]};writes.push({action,data});if(writes.length>2)return {profileId:'next-profile'};return new Promise(resolve=>pending.push(resolve));};
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 const require=n=>n==='react'?react:n==='react/jsx-runtime'?{jsx,jsxs:jsx}:n.endsWith('/store')?{useStore:selector=>selector({currentUser:actor,externalSalesmen:[]})}:n.endsWith('/garageReferralAccounts')?{referralAccountRequest:api}:{default:n.endsWith('/GarageReferralProfileForm')?'ProfileForm':'Shell'};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/pages/GarageReferralAccounts.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{require,module,exports:module.exports});
 function all(n,out=[]){if(Array.isArray(n))n.forEach(x=>all(x,out));else if(n&&typeof n==='object'){out.push(n);all(n.props?.children,out);}return out;}
 function render(){cursor=0;tree=module.exports.default();while(effects.length)effects.shift()();}
 const flush=()=>new Promise(resolve=>setImmediate(resolve)),form=()=>all(tree).find(n=>n.type==='ProfileForm').props;
 render();await flush();render();const oldSave=form().onSave({profile:{legalName:'Old staff'},requestId:'old-staff-request-01',createAccount:false});
 actor={id:'director',role:'director'};render();await flush();render();const newSave=form().onSave({profile:{legalName:'New staff'},requestId:'new-staff-request-01',createAccount:false});
 pending[0]({profileId:'old-profile'});await oldSave;render();
 await assert.rejects(()=>form().onSave({profile:{legalName:'Duplicate'},requestId:'duplicate-request-01',createAccount:false}),/Wait for the current profile action/);
 assert.equal(writes.length,2);pending[1]({profileId:'new-profile'});await newSave;
});
