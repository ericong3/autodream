import {test} from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {handleInstallation} from '../server/installation/core.mjs';
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
const payload={action:'confirm',jobId:'test-job',revision:2,requestId:'sample-request-00001'};
test('workshop requires a verified session',async()=>{const w=fixture('garage_installer');assert.equal((await handleInstallation(w.req(payload),w.deps)).status,401);assert.equal(w.calls.length,0);});
test('actor is session-derived; supplied actor is rejected',async()=>{const w=fixture('garage_installer'),cookie=await w.login();assert.equal((await handleInstallation(w.req(payload,cookie),w.deps)).status,200);assert.equal(w.calls[0].args.p_actor,'sales-a');assert.equal((await handleInstallation(w.req({...payload,actorId:'head'},cookie),w.deps)).status,400);});
test('only Garage Head can approve or return workshop work',async()=>{for(const role of ['director','shareholder','garage_salesman','garage_installer']){const w=fixture(role,['director','shareholder'].includes(role)?'both':'garage'),cookie=await w.login();for(const action of ['head_approve','head_return'])assert.equal((await handleInstallation(w.req({...payload,action,value:true},cookie),w.deps)).status,403);assert.equal(w.calls.length,0);}});
test('inspection acknowledgement, revisions and film usage are validated',async()=>{const w=fixture('garage_head'),cookie=await w.login();for(const bad of [{action:'head_approve'},{revision:-1},{revision:1.5},{requestId:'bad'},{action:'sqft',value:-1},{action:'sqft',value:'abc'}])assert.equal((await handleInstallation(w.req({...payload,...bad},cookie),w.deps)).status,400);assert.equal(w.calls.length,0);});
test('Used Car access and cross-origin calls are refused',async()=>{const w=fixture('salesperson','used_car'),cookie=await w.login();assert.equal((await handleInstallation(w.req(payload,cookie),w.deps)).status,403);const v=fixture('garage_head'),c=await v.login(),req=v.req(payload,c);req.headers.origin='https://other.example';assert.equal((await handleInstallation(req,v.deps)).status,403);});
test('conflict and internal errors do not expose database details',async()=>{const w=fixture('garage_installer'),cookie=await w.login();for(const [message,status] of [['REVISION_CONFLICT',409],['NOT_ALLOWED',403],['secret detail',503]]){w.repo.rpc=async()=>({error:{message}});const r=await handleInstallation(w.req(payload,cookie),w.deps);assert.equal(r.status,status);assert.ok(!r.body.includes('secret detail'));}});
