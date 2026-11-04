import test from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleSales} from '../server/sales/core.mjs';import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example',claimId='11111111-1111-4111-8111-111111111111',billId='22222222-2222-4222-8222-222222222222';
const submit=(extra={})=>({scope:'investor_claims',action:'submit',carId:'car1',claimKind:'misc',category:'Petrol',purpose:'Petrol for stock car',payee:'Staff',amountCents:5000,requestId:'claim_request_0001',...extra});
function fixture(role='salesperson',access=role==='director'?'both':'used_car'){
 const user={id:'staff',name:'Staff',username:'staff',password:bcrypt.hashSync('password-for-test',4),role,business_access:access,enabled:true,registration_status:'active'},sessions=new Map(),calls=[];
 let reply={data:{claim:{claimId,billId,carId:'car1',purpose:'Petrol',payee:'Staff',amountCents:5000,paidCents:0,state:'pending',mine:true,documents:[],potBalance:999999,storagePath:'never-expose'},alreadyRecorded:false}};
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return reply;}};
 const deps={env:{GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin,USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',USED_CAR_INVESTOR_CARS_ONLINE:'1'},repo:()=>repo,bcrypt};
 const req=(body,cookie,extra={})=>({method:'POST',body:JSON.stringify(body),headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{}),...extra}});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'password-for-test'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(x=>x.startsWith(COOKIE_NAME+'=')&&!x.includes('Max-Age=0')).split(';')[0];};
 const run=async(body,cookie,extra)=>{const r=await handleSales(req(body,cookie,extra),deps);return {...r,body:JSON.parse(r.body)};};
 return {deps,user,calls,login,run,setReply:r=>{reply=r;}};
}
test('claim route needs a private session, derives actor and returns no balances or storage paths',async()=>{
 const f=fixture();assert.equal((await f.run(submit())).status,401);const c=await f.login();
 assert.notEqual((await f.run(submit(),c,{origin:'https://evil.example'})).status,200);
 assert.notEqual((await f.run(submit(),c,{'x-garage-building':''})).status,200);
 for(const forged of [{actor:'director'},{claimantId:'other'},{createdAt:'2020-01-01'}])assert.equal((await f.run(submit(forged),c)).status,400);
 const r=await f.run(submit(),c);assert.equal(r.status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].fn,'uc_investor_claims');assert.equal(f.calls[0].args.p_actor,'staff');
 assert.equal(r.body.claim.potBalance,undefined);assert.equal(r.body.claim.storagePath,undefined);
});
test('admin can review but only Director approves, and staff cannot reject',async()=>{
 const a=fixture('admin'),ac=await a.login();assert.equal((await a.run({scope:'investor_claims',action:'approve',claimId,requestId:'request_approve_0001'},ac)).status,403);assert.equal(a.calls.length,0);
 assert.equal((await a.run({scope:'investor_claims',action:'reject',claimId,note:'Duplicate',requestId:'request_reject_0001'},ac)).status,200);
 const s=fixture(),sc=await s.login();assert.equal((await s.run({scope:'investor_claims',action:'reject',claimId,note:'Reject',requestId:'request_reject_0002'},sc)).status,403);assert.equal(s.calls.length,0);
 const i=fixture('investor'),ic=await i.login();assert.equal((await i.run(submit(),ic)).status,403);
});
test('invalid amounts, IDs, pagination and flags are refused before a database call',async()=>{
 const f=fixture(),c=await f.login();for(const extra of [{amountCents:1.5},{amountCents:'50'},{amountCents:0},{amountCents:1e12+1},{carId:'../x'},{payee:''},{purpose:'x'.repeat(301)},{claimKind:'salary'},{requestId:'short'}])assert.equal((await f.run(submit(extra),c)).status,400);
 assert.equal((await f.run({scope:'investor_claims',action:'list',page:-1},c)).status,400);assert.equal(f.calls.length,0);
 f.deps.env.USED_CAR_INVESTOR_CARS_ONLINE='0';assert.equal((await f.run(submit(),c)).status,503);assert.equal(f.calls.length,0);
});
test('known database refusals have plain messages and uncertain saves stay failures',async()=>{
 const f=fixture('director'),c=await f.login();f.setReply({error:{message:'SUPPLIER_INVOICE_REQUIRED'}});const r=await f.run(submit(),c);assert.equal(r.status,409);assert.match(r.body.error.message,/invoice/);
 f.setReply({error:{message:'REQUEST_CHANGED'}});assert.equal((await f.run(submit(),c)).status,409);
 f.setReply({data:{claim:null}});assert.equal((await f.run(submit(),c)).status,503);
});
