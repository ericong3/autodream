import test from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleSales} from '../server/sales/core.mjs';import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example',choiceId='11111111-1111-4111-8111-111111111111',potId='22222222-2222-4222-8222-222222222222';
const choose=(extra={})=>({scope:'trade_in_funding',action:'choose',incomingCarId:'incoming',fundingKind:'company',requestId:'tradein_request_001',...extra});
function fixture(role='director'){
 const user={id:'real-director',name:'Director',username:'staff',password:bcrypt.hashSync('password-for-test',4),role,business_access:'both',enabled:true,registration_status:'active'},sessions=new Map(),calls=[];
 let result={data:{choice:{id:choiceId,incomingCarId:'incoming',fundingKind:'company',financiallyApplied:false}}};
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return result;}};
 const deps={env:{GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin,USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',USED_CAR_INVESTOR_CARS_ONLINE:'1'},repo:()=>repo,bcrypt};
 const req=(body,cookie,extra={})=>({method:'POST',body:JSON.stringify(body),headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{}),...extra}});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'password-for-test'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(x=>x.startsWith(COOKIE_NAME+'=')&&!x.includes('Max-Age=0')).split(';')[0];};
 const run=async(body,cookie,extra)=>{const r=await handleSales(req(body,cookie,extra),deps);return {...r,body:JSON.parse(r.body)};};
 return {deps,calls,login,run,setResult:r=>{result=r;}};
}
test('hosted route requires private Director session and server-derived actor',async()=>{
 const f=fixture();assert.equal((await f.run(choose())).status,401);const c=await f.login();
 assert.notEqual((await f.run(choose(),c,{origin:'https://evil.example'})).status,200);
 assert.notEqual((await f.run(choose(),c,{'x-garage-building':''})).status,200);
 assert.equal((await f.run(choose({actor:'someone'}),c)).status,400);
 assert.equal((await f.run(choose(),c)).status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].fn,'uc_trade_in_funding');assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const role of ['admin','investor','salesperson','mechanic']){const other=fixture(role),oc=await other.login();assert.equal((await other.run(choose(),oc)).status,403);assert.equal(other.calls.length,0);}
});
test('choice is mandatory, investor pot is explicit, and browser financial postings are refused',async()=>{
 const f=fixture(),c=await f.login();
 for(const data of [{fundingKind:undefined},{fundingKind:'investor'},{fundingKind:'investor',potId,investorBasisPoints:10001},{potId},{incomingCarId:'../x'},{requestId:'short'},{bankDeltaCents:123},{grossCents:4000000},{investorBasisPoints:4000}])assert.equal((await f.run(choose(data),c)).status,400,JSON.stringify(data));
 assert.equal(f.calls.length,0);f.setResult({data:{choice:{id:choiceId,incomingCarId:'incoming',fundingKind:'investor',potId,investorBasisPoints:4000,financiallyApplied:false}}});assert.equal((await f.run(choose({fundingKind:'investor',potId,investorBasisPoints:4000}),c)).status,200);
 assert.equal(f.calls[0].args.p_data.potId,potId);
});
test('rollout and changed-history errors do not pretend funding was applied',async()=>{
 const f=fixture(),c=await f.login();f.deps.env.USED_CAR_INVESTOR_CARS_ONLINE='0';assert.equal((await f.run(choose(),c)).status,503);assert.equal(f.calls.length,0);
 f.deps.env.USED_CAR_INVESTOR_CARS_ONLINE='1';f.setResult({error:{message:'CHOICE_CHANGED'}});const r=await f.run(choose(),c);assert.equal(r.status,409);assert.match(r.body.error.message,/Refresh/);
 f.setResult({data:{choice:null}});const snapshot=await f.run({scope:'trade_in_funding',action:'snapshot',incomingCarId:'incoming'},c);assert.equal(snapshot.status,200);assert.equal(snapshot.body.choice,null);
 assert.equal((await f.run(choose(),c)).status,503);
 f.setResult({data:{choice:{id:choiceId,incomingCarId:'wrong'}}});assert.equal((await f.run(choose(),c)).status,503);
});
