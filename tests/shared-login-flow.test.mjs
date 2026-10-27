import {test} from 'node:test';
import assert from 'node:assert/strict';
import {confirmSharedSignIn} from '../src/lib/sharedSignIn.ts';
const identity={id:'sample-a',username:'staff',name:'Sample',role:'garage_salesman',businessAccess:'garage'};
test('login confirms the browser session and never clears it before confirmation',async()=>{
 const calls=[];const request=async(method,body)=>{calls.push({method,body});return identity;};
 assert.deepEqual(await confirmSharedSignIn(request,' staff ','test-only-password'),identity);
 assert.deepEqual(calls.map(c=>c.method),['POST','GET']);assert.equal(calls[0].body.username,'staff');
});
test('a rejected cookie stays on sign-in with useful browser instructions',async()=>{
 let cleared=false;await assert.rejects(()=>confirmSharedSignIn(async method=>method==='POST'?identity:null,'staff','test-only-password',()=>{cleared=true;}),/Safari or Chrome/);assert.equal(cleared,true,'previous account cache is cleared even when the new cookie fails');
});
test('a changed session cannot select another account silently',async()=>{
 await assert.rejects(()=>confirmSharedSignIn(async method=>method==='POST'?identity:{...identity,id:'someone-else'},'staff','test-only-password'),/account changed/);
});
