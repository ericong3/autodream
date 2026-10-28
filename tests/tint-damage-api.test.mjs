import {handleDamage} from '../server/tintControl/damage.mjs';
import {handleTintRequest} from '../server/tintControl/router.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {handleTintControl} from '../server/tintControl/core.mjs';
import {handlePaymentProof} from '../server/tintControl/proofs.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example';
function fixture(role='garage_salesman',access='garage'){
 const user={id:'sales-a',username:'staff',name:'Sample',password:bcrypt.hashSync('test-password',4),role,business_access:access,enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[];
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return {data:{enquiries:[]}};}};
 const deps={env:{GARAGE_ENQUIRIES_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie,method='POST')=>({method,url:'/api/garage/sales',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'test-password'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 return {user,repo,deps,calls,req,login};
}


const entry={action:'create',invoiceId:'inv',kind:'arrival',area:'Rear bumper',description:'Sample pre-existing scratch',requestId:'sample-damage-00001'};
test('damage reports require active Garage work-order access and server-derived reporter',async()=>{const w=fixture('garage_installer');assert.equal((await handleDamage(w.req(entry),w.deps)).status,401);const c=await w.login();assert.equal((await handleDamage(w.req(entry,c),w.deps)).status,200);assert.equal(w.calls[0].args.p_actor,w.user.id);for(const extra of [{reportedBy:'someone'},{path:'forged'},{content:'fake'}])assert.equal((await handleDamage(w.req({...entry,...extra},c),w.deps)).status,400);for(const role of ['admin','salesperson']){const f=fixture(role,'used_car'),cookie=await f.login();assert.equal((await handleDamage(f.req(entry,cookie),f.deps)).status,403);}});
test('only Garage Head can close a damage report and browser cannot attach arbitrary storage paths',async()=>{for(const role of ['garage_installer','garage_salesman','director','garage_head']){const w=fixture(role,role==='director'?'both':'garage'),c=await w.login();assert.equal((await handleDamage(w.req({action:'resolve',invoiceId:'inv',reportId:'r',note:'Checked outcome',requestId:entry.requestId},c),w.deps)).status,role==='garage_head'?200:403);assert.equal((await handleDamage(w.req({action:'evidence',invoiceId:'inv',reportId:'r',path:'forged'},c),w.deps)).status,400);}});
test('damage photo uploads are private, limited, repeat-safe and checked against actual image signature',async()=>{const w=fixture('garage_installer'),c=await w.login();let uploaded=0;const report={id:'r',reported_by:w.user.id,status:'open',photos:[]};w.repo.rpc=async(fn,args)=>{w.calls.push({fn,args});return {data:args.p_action==='snapshot'?{canReport:true,reports:[report]}:{}};};w.repo.uploadDamageProof=async()=>{uploaded++;};w.repo.damageProofUrl=async()=> 'https://example.test/signed';const body={action:'upload',invoiceId:'inv',reportId:'r',fileName:'sample.png',mime:'image/png',content:Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64')};
assert.equal((await handleDamage(w.req({...body,content:Buffer.from('<html>bad</html>').toString('base64')},c),w.deps)).status,400);assert.equal(uploaded,0);
assert.equal((await handleDamage(w.req(body,c),w.deps)).status,200);assert.equal(uploaded,1);report.photos=[{id:1,path:w.calls.at(-1).args.p_data.path}];assert.equal((await handleDamage(w.req(body,c),w.deps)).status,200);assert.equal(uploaded,1);assert.equal((await handleDamage(w.req({action:'photo',invoiceId:'inv',reportId:'r',photoId:1},c),w.deps)).status,200);
report.reported_by='someone';assert.equal((await handleDamage(w.req(body,c),w.deps)).status,403);report.reported_by=w.user.id;report.status='resolved';assert.equal((await handleDamage(w.req(body,c),w.deps)).status,403);
});
test('damage storage actions enforce cross-order references through the authorised snapshot',async()=>{const w=fixture('garage_installer'),c=await w.login();w.repo.rpc=async()=>({data:{reports:[],canReport:true}});assert.equal((await handleDamage(w.req({action:'photo',invoiceId:'inv',reportId:'another-report',photoId:1},c),w.deps)).status,403);});

test('photo upload API delegates the photo-count decision to the private database during cap-removal rollout',async()=>{
 const w=fixture('garage_installer'),c=await w.login();let uploaded=0;const report={id:'r',reported_by:w.user.id,status:'open',photos:Array.from({length:4},(_,i)=>({id:i+1,path:'existing-'+i}))};
 w.repo.rpc=async(fn,args)=>{w.calls.push({fn,args});return {data:args.p_action==='snapshot'?{canReport:true,reports:[report]}:{}};};w.repo.uploadDamageProof=async()=>{uploaded++;};
 const body={action:'upload',invoiceId:'inv',reportId:'r',fileName:'fifth.png',mime:'image/png',content:Buffer.from([137,80,78,71,13,10,26,10,5]).toString('base64')};
 assert.equal((await handleDamage(w.req(body,c),w.deps)).status,200);assert.equal(uploaded,1);assert.equal(w.calls.at(-1).args.p_action,'evidence');
});
