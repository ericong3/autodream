import {test} from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {handleSales} from '../server/sales/core.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example';
function fixture(role='garage_salesman',access='garage'){
 const user={id:'sales-a',username:'staff',name:'Sample',password:bcrypt.hashSync('test-password',4),role,business_access:access,enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[];
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return {data:{enquiries:[]}};}};
 const deps={env:{GARAGE_SALES_REFERRALS_ONLINE:'1',GARAGE_ENQUIRIES_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie,method='POST')=>({method,url:'/api/garage/sales',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'test-password'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 return {user,repo,deps,calls,req,login};
}

test('referral choices require a private Garage sales session and cannot forge actor',async()=>{
 const w=fixture();assert.equal((await handleSales(w.req({scope:'sales_referrals',action:'options'}),w.deps)).status,401);
 const cookie=await w.login();assert.equal((await handleSales(w.req({scope:'sales_referrals',action:'options',actorId:'director'},cookie),w.deps)).status,400);
 const r=await handleSales(w.req({scope:'sales_referrals',action:'options'},cookie),w.deps);assert.equal(r.status,200);assert.equal(w.calls[0].args.p_actor,'sales-a');
});
test('referral rollout is inert until explicitly activated and rejects new assignment writes',async()=>{
 const w=fixture(),cookie=await w.login();w.deps.env.GARAGE_SALES_REFERRALS_ONLINE='0';
 const r=await handleSales(w.req({scope:'sales_referrals',action:'options'},cookie),w.deps);assert.equal(JSON.parse(r.body).enabled,false);assert.equal(w.calls.length,0);
 const sale={salesAssignment:{ownerId:'sales-a',referrer:{kind:'none'}}};
 assert.equal((await handleSales(w.req({action:'confirm',requestId:'referral-request-0001',sale},cookie),w.deps)).status,503);
});
test('one referrer and exact deal reference pass through unchanged; forged rates and multiple recipients fail',async()=>{
 const w=fixture(),cookie=await w.login();
 const salesAssignment={ownerId:'garage-owner',referrer:{kind:'used_car',staffId:'used-car-sales',deal:{customerId:'customer-id',carId:'car-id',submittedAt:'2026-10-10T10:00:00Z'}}};
 const request=assignment=>w.req({action:'confirm',requestId:'referral-request-0001',sale:{salesAssignment:assignment}},cookie);
 assert.equal((await handleSales(request(salesAssignment),w.deps)).status,200);assert.deepEqual(w.calls[0].args.p_sale.salesAssignment,salesAssignment);
 for(const a of [{...salesAssignment,rate:0.99},{...salesAssignment,referrer:{...salesAssignment.referrer,profileId:'12345678-1234-1234-1234-123456789abc'}},{...salesAssignment,referrer:[salesAssignment.referrer]},{...salesAssignment,ownerId:''}])assert.equal((await handleSales(request(a),w.deps)).status,400);
});
test('disabled department access, cross-origin requests and invalid month filters are refused',async()=>{
 for(const [role,access] of [['salesperson','used_car'],['garage_installer','garage']]){const w=fixture(role,access),cookie=await w.login();assert.equal((await handleSales(w.req({scope:'sales_referrals',action:'options'},cookie),w.deps)).status,403);}
 const w=fixture(),cookie=await w.login();assert.equal((await handleSales(w.req({scope:'sales_referrals',action:'deals',staffId:'uc',month:'2026-13'},cookie),w.deps)).status,400);
 const req=w.req({scope:'sales_referrals',action:'options'},cookie);req.headers.origin='https://unrelated.example';assert.equal((await handleSales(req,w.deps)).status,403);
});
test('database permission and rollout errors do not leak customer details',async()=>{
 const w=fixture(),cookie=await w.login();w.repo.rpc=async()=>({error:{message:'secret customer data',code:'XX000'}});
 const r=await handleSales(w.req({scope:'sales_referrals',action:'options'},cookie),w.deps);assert.equal(r.status,503);assert.ok(!r.body.includes('secret customer'));
});
