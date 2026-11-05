import {test} from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleInvestorCapital as handleInvestorCapitalRaw} from '../server/usedCar/investorCapital.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const handleInvestorCapital=async(...args)=>{const r=await handleInvestorCapitalRaw(...args);return {...r,body:typeof r.body==='string'?JSON.parse(r.body):r.body};};
const origin='https://app.example',potId='11111111-1111-4111-8111-111111111111',withdrawalId='22222222-2222-4222-8222-222222222222',
 destinationId='33333333-3333-4333-8333-333333333333',bankAccountId='44444444-4444-4444-8444-444444444444',receiptDocumentId='55555555-5555-4555-8555-555555555555';
function fixture(role='director'){
 const user={id:'private-user',username:'staff',name:'Sample',password:bcrypt.hashSync('sample-password',4),role,business_access:'both',enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[];
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return {data:{potId}};}};
 const deps={env:{USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',USED_CAR_INVESTOR_CARS_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie)=>({method:'POST',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 const login=async()=>{const result=await handleAppSession(req({username:'staff',password:'sample-password'}),deps);assert.equal(result.status,200);return [].concat(result.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 return {repo,deps,calls,req,login};
}
const scope='investor_finance';
const destination={destinationBank:'Maybank',destinationHolder:'Sample Investor',destinationAccount:'5140 1234 5678',destinationConfirmed:true};
const approve=(extra={})=>({scope,action:'approve_withdrawal',potId,withdrawalId,...destination,requestId:'approve_sample_0001',...extra});
const paid=(extra={})=>({scope,action:'withdrawal_paid',potId,withdrawalId,paidOn:'2026-11-05',bankAccountId,bankReference:'REF-1',receiptDocumentId,destinationId,requestId:'payout_sample_00001',...extra});

test('approval carries a complete, Director-confirmed destination to the database unchanged',async()=>{
 const w=fixture(),cookie=await w.login();
 const ok=await handleInvestorCapital(w.req(approve(),cookie),w.deps);
 assert.equal(ok.status,200);assert.equal(w.calls.length,1);
 assert.deepEqual(w.calls[0].args.p_data,{potId,withdrawalId,...destination,requestId:'approve_sample_0001'});
 for(const [extra,code] of [[{destinationConfirmed:false},'DESTINATION_NOT_CONFIRMED'],[{destinationConfirmed:'true'},'DESTINATION_NOT_CONFIRMED'],[{destinationAccount:'12ab34'},'DESTINATION_INVALID'],
  [{destinationAccount:'12345'},'DESTINATION_INVALID'],[{destinationHolder:'x'},'DESTINATION_INVALID'],[{destinationBank:'Bank\u0000'},'DESTINATION_INVALID'],[{destinationBank:undefined},'DESTINATION_INVALID']]){
  const r=await handleInvestorCapital(w.req(approve(extra),cookie),w.deps);assert.equal(r.status,400,code);assert.equal(r.body.error.code,code);
 }
 const {destinationBank:_b,destinationHolder:_h,destinationAccount:_a,destinationConfirmed:_c,...bare}=approve();
 assert.equal((await handleInvestorCapital(w.req(bare,cookie),w.deps)).body.error.code,'DESTINATION_INVALID');
 assert.equal((await handleInvestorCapital(w.req(approve({destinationId}),cookie),w.deps)).status,400);
 assert.equal(w.calls.length,1);
});

test('payout names its locked destination; the receipt is still required',async()=>{
 const w=fixture(),cookie=await w.login();
 assert.equal((await handleInvestorCapital(w.req(paid(),cookie),w.deps)).status,200);
 assert.equal(w.calls[0].args.p_data.destinationId,destinationId);
 assert.equal((await handleInvestorCapital(w.req(paid({destinationId:undefined}),cookie),w.deps)).body.error.code,'DESTINATION_REQUIRED');
 assert.equal((await handleInvestorCapital(w.req(paid({destinationId:'not-a-uuid'}),cookie),w.deps)).status,400);
 assert.equal((await handleInvestorCapital(w.req(paid({receiptDocumentId:undefined}),cookie),w.deps)).body.error.code,'PAYMENT_RECEIPT_REQUIRED');
 // Destination details cannot be swapped in at payment time.
 assert.equal((await handleInvestorCapital(w.req(paid({destinationAccount:'999999999'}),cookie),w.deps)).status,400);
 assert.equal(w.calls.length,1);
});

test('one-time setup for an earlier approval is Director only; investors and admin cannot approve, set or pay',async()=>{
 const d=fixture(),cookie=await d.login();
 const setup={scope,action:'confirm_withdrawal_destination',potId,withdrawalId,...destination,requestId:'setup_sample_00001'};
 assert.equal((await handleInvestorCapital(d.req(setup,cookie),d.deps)).status,200);
 assert.equal(d.calls[0].args.p_action,'confirm_withdrawal_destination');
 for(const role of ['investor','admin']){
  const w=fixture(role),c=await w.login();
  for(const body of [approve(),paid(),setup])assert.equal((await handleInvestorCapital(w.req(body,c),w.deps)).status,403,role+' '+body.action);
  assert.equal(w.calls.length,0);
 }
});

test('database destination refusals map to safe messages',async()=>{
 const w=fixture(),cookie=await w.login();
 for(const [code,status] of [['DESTINATION_CHANGED',409],['DESTINATION_LOCKED',409],['DESTINATION_REQUIRED',409],['DESTINATION_INVALID',400],['DESTINATION_NOT_CONFIRMED',400]]){
  w.repo.rpc=async()=>({error:{message:code+' secret diagnostic'}});
  const r=await handleInvestorCapital(w.req(paid(),cookie),w.deps);
  assert.equal(r.status,status,code);assert.equal(r.body.error.code,code);assert.ok(!JSON.stringify(r.body).includes('secret'));
 }
});

test('unscoped phase 1/2 bodies are unchanged; the database enforces the destination',async()=>{
 const w=fixture(),cookie=await w.login();
 assert.equal((await handleInvestorCapital(w.req({action:'approve_withdrawal',potId,withdrawalId,requestId:'legacy_sample_0001'},cookie),w.deps)).status,200);
 assert.deepEqual(w.calls[0].args.p_data,{potId,withdrawalId,requestId:'legacy_sample_0001'});
});
