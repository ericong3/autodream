import {test} from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {handleEnquiries} from '../server/enquiries/core.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example';
function fixture(role='garage_salesman',access='garage'){
 const user={id:'sales-a',username:'staff',name:'Sample',password:bcrypt.hashSync('test-password',4),role,business_access:access,enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[];
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return {data:{enquiries:[]}};}};
 const deps={env:{GARAGE_ENQUIRIES_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie,method='POST')=>({method,url:'/api/garage/enquiries',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'test-password'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 return {user,repo,deps,calls,req,login};
}
test('enquiries require a verified session, including reads',async()=>{const w=fixture();assert.equal((await handleEnquiries(w.req(undefined,undefined,'GET'),w.deps)).status,401);assert.equal(w.calls.length,0);});
test('actor comes from session; forged owner fields are rejected',async()=>{const w=fixture(),cookie=await w.login();const r=await handleEnquiries(w.req({action:'create',name:'Example',phone:'0123456789',services:['Tint']},cookie),w.deps);assert.equal(r.status,201);assert.equal(w.calls[0].args.p_actor,'sales-a');assert.equal((await handleEnquiries(w.req({action:'list',owner_id:'someone-else'},cookie),w.deps)).status,400);});
test('used car only accounts and workshop staff cannot read enquiries',async()=>{for(const [role,access] of [['salesperson','used_car'],['garage_installer','garage']]){const w=fixture(role,access),cookie=await w.login();assert.equal((await handleEnquiries(w.req(undefined,cookie,'GET'),w.deps)).status,403);assert.equal(w.calls.length,0);}});
test('cross-origin requests and missing CSRF header are rejected',async()=>{for(const change of [r=>r.headers.origin='https://evil.example',r=>delete r.headers['x-garage-building']]){const w=fixture(),cookie=await w.login(),req=w.req({action:'list'},cookie);change(req);assert.equal((await handleEnquiries(req,w.deps)).status,403);assert.equal(w.calls.length,0);}});
test('stale writes and missing migration give actionable errors without exposing database detail',async()=>{for(const [message,code,status] of [['REVISION_CONFLICT','P0001',409],['private database details','42883',503]]){const w=fixture(),cookie=await w.login();w.repo.rpc=async()=>({error:{message,code}});const r=await handleEnquiries(w.req({action:'list'},cookie),w.deps);assert.equal(r.status,status);assert.ok(!r.body.includes('private database details'));assert.equal(r.headers['Cache-Control'],'no-store');}});

test('workshop can read shared customer identity but cannot read private enquiries',async()=>{const w=fixture('garage_installer','garage'),cookie=await w.login();assert.equal((await handleEnquiries(w.req({action:'customer_get',id:'customer-a'},cookie),w.deps)).status,200);assert.equal((await handleEnquiries(w.req({action:'get',id:'private-enquiry'},cookie),w.deps)).status,403);});
