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
 const deps={env:{GARAGE_SALES_REFERRALS_ONLINE:'1',GARAGE_REFERRAL_SETTLEMENT_ONLINE:'1',GARAGE_ENQUIRIES_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie,method='POST')=>({method,url:'/api/garage/sales',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'test-password'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 return {user,repo,deps,calls,req,login};
}

const body=(action,extra={})=>({scope:'referral_settlement',action,...extra});
test('staff and partner settlement use the installed private throttle key format',async()=>{
 const w=fixture('director','both'),cookie=await w.login();const keys=[];
 w.repo.throttleHit=async(key)=>{assert.match(key,/^[a-z]{1,8}:[A-Za-z0-9_-]{16,128}$/);keys.push(key);return {allowed:true};};
 assert.equal((await handleSales(w.req(body('month',{month:'2026-11'}),cookie),w.deps)).status,200);
 assert.equal((await handleSales(w.req(body('partner_month',{month:'2026-11'}),'autodream_referral_session='+'a'.repeat(64)),w.deps)).status,200);
 assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1]);
});
test('settlement derives the actor from the private session and is inactive without its rollout flag',async()=>{
 const w=fixture(),cookie=await w.login();
 assert.equal((await handleSales(w.req(body('month',{month:'2026-11'})),w.deps)).status,401);
 assert.equal((await handleSales(w.req(body('month',{month:'2026-11',actorId:'director'}),cookie),w.deps)).status,400);
 assert.equal((await handleSales(w.req(body('month',{month:'2026-11'}),cookie),w.deps)).status,200);
 assert.equal(w.calls[0].args.p_actor,'sales-a');
 w.deps.env.GARAGE_REFERRAL_SETTLEMENT_ONLINE='0';w.calls.length=0;
 const off=await handleSales(w.req(body('month',{month:'2026-11'}),cookie),w.deps);assert.equal(JSON.parse(off.body).enabled,false);assert.equal(w.calls.length,0);
});
test('Used Car salesman can request release but admin and self-paid commission are denied',async()=>{
 for(const [role,expected] of [['salesperson',200],['director',200],['admin',403]]){
  const w=fixture(role,'both'),cookie=await w.login();
  assert.equal((await handleSales(w.req(body('release',{invoiceId:'invoice',requestId:'sample-request-1234',note:'Used Car asks to deliver'}),cookie),w.deps)).status,expected);
  if(role==='salesperson')assert.equal((await handleSales(w.req(body('payout',{invoiceId:'invoice',requestId:'sample-request-1234',amount:30,reference:'Payout',paidOn:'2026-11-01'}),cookie),w.deps)).status,403);
 }
});
test('settlement validates amounts, retry identity, source fields and same-origin protection',async()=>{
 const w=fixture('director','both'),cookie=await w.login();
 const valid=body('report_transfer',{invoiceId:'invoice',requestId:'sample-request-1234',amount:60,reference:'Bank reference'});
 for(const bad of [{...valid,amount:1.005},{...valid,amount:-1},{...valid,requestId:'short'},{...valid,profileId:'someone-else'},{...valid,reference:''}])assert.equal((await handleSales(w.req(bad,cookie),w.deps)).status,400);
 const cross=w.req(valid,cookie);cross.headers.origin='https://untrusted.example';assert.equal((await handleSales(cross,w.deps)).status,403);
});
test('partner income uses only its separate cookie and cannot choose a profile',async()=>{
 const w=fixture(),cookie=await w.login();
 assert.equal((await handleSales(w.req(body('partner_month',{month:'2026-11'}),cookie),w.deps)).status,401);
 const partnerCookie='autodream_referral_session='+'a'.repeat(64);
 assert.equal((await handleSales(w.req(body('partner_month',{month:'2026-11',profileId:'someone-else'}),partnerCookie),w.deps)).status,400);
 assert.equal((await handleSales(w.req(body('partner_month',{month:'2026-11'}),partnerCookie),w.deps)).status,200);
 assert.equal(w.calls.at(-1).fn,'garage_referral_partner_income');assert.equal('p_actor' in w.calls.at(-1).args,false);
});
