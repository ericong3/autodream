import {test} from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleInvestorCapital} from '../server/usedCar/investorCapital.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example',potId='11111111-1111-4111-8111-111111111111';
function fixture(role='director'){
 const user={id:'private-user',username:'staff',name:'Sample',password:bcrypt.hashSync('sample-password',4),role,business_access:'both',enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[];
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return {data:{position:{cashCents:0}}};}};
 const deps={env:{USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie)=>({method:'POST',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 const login=async()=>{const result=await handleAppSession(req({username:'staff',password:'sample-password'}),deps);assert.equal(result.status,200);return [].concat(result.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 return {repo,deps,calls,req,login,user};
}
test('investor capital handler requires a private session and derives the actor',async()=>{
 const w=fixture(),body={action:'snapshot',potId};assert.equal((await handleInvestorCapital(w.req(body),w.deps)).status,401);
 const cookie=await w.login();assert.equal((await handleInvestorCapital(w.req({...body,actor:'someone-else'},cookie),w.deps)).status,400);
 const result=await handleInvestorCapital(w.req(body,cookie),w.deps);assert.equal(result.status,200);assert.equal(w.calls.length,1);assert.equal(w.calls[0].args.p_actor,w.user.id);assert.equal(w.calls[0].fn,'uc_investor_capital');
});
test('investor requests cannot record capital, review withdrawals or access payroll',async()=>{
 const w=fixture('investor'),cookie=await w.login();
 for(const action of ['capital_received','approve_withdrawal','withdrawal_paid','create_profile','link_account'])assert.equal((await handleInvestorCapital(w.req({action,potId},cookie),w.deps)).status,403);
 assert.equal((await handleInvestorCapital(w.req({action:'salary',potId},cookie),w.deps)).status,400);
 for(const action of ['toString','__proto__','constructor'])assert.equal((await handleInvestorCapital(w.req({action,potId},cookie),w.deps)).status,400);
 assert.equal((await handleInvestorCapital(w.req({action:'request_withdrawal',potId,amountCents:10000,requestId:'request_sample_001'},cookie),w.deps)).status,200);
 assert.equal(w.calls.length,1);
 assert.equal((await handleInvestorCapital(w.req({action:'snapshot'},cookie),w.deps)).status,200);
 assert.deepEqual(w.calls[1].args.p_data,{});
});
test('admin and salesperson cannot open investor records; rollout disabled never writes',async()=>{
 for(const role of ['admin','salesperson','shareholder','garage_head']){const w=fixture(role),cookie=await w.login();assert.equal((await handleInvestorCapital(w.req({action:'snapshot',potId},cookie),w.deps)).status,403);assert.equal(w.calls.length,0);}
 const w=fixture(),cookie=await w.login();w.deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE='0';assert.equal((await handleInvestorCapital(w.req({action:'snapshot',potId},cookie),w.deps)).status,503);assert.equal(w.calls.length,0);
});
test('amount errors, cross-origin calls and private database failures stay safe',async()=>{
 const w=fixture('investor'),cookie=await w.login(),body={action:'request_withdrawal',potId,amountCents:10000,requestId:'request_sample_002'};
 assert.equal((await handleInvestorCapital(w.req({...body,amountCents:1.5},cookie),w.deps)).status,400);
 const req=w.req(body,cookie);req.headers.origin='https://elsewhere.example';assert.equal((await handleInvestorCapital(req,w.deps)).status,403);
 w.repo.rpc=async()=>({error:{message:'secret database diagnostic'}});const result=await handleInvestorCapital(w.req(body,cookie),w.deps);assert.equal(result.status,503);assert.ok(!JSON.stringify(result.body).includes('secret database'));
});
