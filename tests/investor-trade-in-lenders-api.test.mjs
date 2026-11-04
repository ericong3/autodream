import test from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleSales} from '../server/sales/core.mjs';import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example',choiceId='11111111-1111-4111-8111-111111111111',potId='22222222-2222-4222-8222-222222222222';
const unusedChoose=(extra={})=>({scope:'trade_in_funding',action:'choose',incomingCarId:'incoming',fundingKind:'company',requestId:'tradein_request_001',...extra});
function fixture(role='director'){
 const user={id:'real-director',name:'Director',username:'staff',password:bcrypt.hashSync('password-for-test',4),role,business_access:'both',enabled:true,registration_status:'active'},sessions=new Map(),calls=[];
 let result={data:{choice:{id:choiceId,incomingCarId:'incoming',fundingKind:'company',financiallyApplied:false}}};
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return result;}};
 const deps={env:{GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin,USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',USED_CAR_INVESTOR_CARS_ONLINE:'1'},repo:()=>repo,bcrypt};
 const req=(body,cookie,extra={})=>({method:'POST',body:JSON.stringify(body),headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{}),...extra}});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'password-for-test'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(x=>x.startsWith(COOKIE_NAME+'=')&&!x.includes('Max-Age=0')).split(';')[0];};
 const run=async(body,cookie,extra)=>{const r=await handleSales(req(body,cookie,extra),deps);return {...r,body:JSON.parse(r.body)};};
 return {deps,repo,calls,login,run,setResult:r=>{result=r;}};
}

const pay=(extra={})=>({scope:'trade_in_lender',action:'pay',applicationId:choiceId,statementDocumentId:potId,receiptDocumentId:'33333333-3333-4333-8333-333333333333',bankAccountId:'44444444-4444-4444-8444-444444444444',paidOn:'2026-11-05',bankReference:'Lender transfer',recipientBank:'Bank',recipientAccount:'12345678',recipientName:'Lender',note:'Loan settlement',requestId:'lender_payment_000001',...extra});
const enabled=f=>{f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='1';return f;};
test('lender payment binds Director actor and refuses caller amounts, roles and invalid recipient/date fields',async()=>{
 const f=enabled(fixture());assert.equal((await f.run(pay())).status,401);const c=await f.login();assert.notEqual((await f.run(pay(),c,{origin:'https://evil.example'})).status,200);
 for(const x of [{amountCents:1},{actor:'other'},{applicationId:'bad'},{recipientAccount:''},{paidOn:'2026-02-30'},{requestId:'short'},{statementDocumentId:'bad'}])assert.equal((await f.run(pay(x),c)).status,400,JSON.stringify(x));
 f.setResult({data:{applicationId:choiceId,paymentId:potId}});assert.equal((await f.run(pay(),c)).status,200);assert.equal(f.calls[0].fn,'uc_trade_in_lender_money');assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const role of ['admin','investor','salesperson']){const o=enabled(fixture(role)),oc=await o.login();assert.equal((await o.run(pay(),oc)).status,403);assert.equal(o.calls.length,0);}
});
test('lender rollout, proof and replay errors never pretend payment succeeded',async()=>{
 const f=enabled(fixture()),c=await f.login();f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='0';assert.equal((await f.run(pay(),c)).status,503);assert.equal(f.calls.length,0);f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='1';
 for(const code of ['LENDER_PAYMENT_PROOF_REQUIRED','LENDER_ALREADY_PAID','REQUEST_CHANGED']){f.setResult({error:{message:code}});assert.equal((await f.run(pay(),c)).status,409);}
 f.setResult({data:{applicationId:potId,paymentId:potId}});assert.equal((await f.run(pay(),c)).status,503);
});
test('lender document storage failure cannot confirm a file or record cash',async()=>{
 const f=enabled(fixture()),c=await f.login();f.setResult({data:{documentId:potId,path:'trade-in-lender/private/receipt.pdf',confirmed:false}});f.repo.uploadInvestorProof=async()=>{throw Error('storage failed');};
 const input={scope:'trade_in_lender',action:'upload',applicationId:choiceId,kind:'payment',fileName:'receipt.pdf',mimeType:'application/pdf',base64:Buffer.from('%PDF-1.4\nproof\n%%EOF').toString('base64')};
 assert.equal((await f.run(input,c)).status,503);assert.deepEqual(f.calls.map(x=>x.args.p_action),['proof_prepare']);f.repo.uploadInvestorProof=async()=>{};assert.equal((await f.run(input,c)).status,200);assert.deepEqual(f.calls.map(x=>x.args.p_action),['proof_prepare','proof_prepare','proof_confirm']);
});
test('investor reads only source-authorised lender snapshot and signed proof',async()=>{
 const f=enabled(fixture('investor')),c=await f.login();f.setResult({data:{applicationId:choiceId,paid:false,documents:[]}});assert.equal((await f.run({scope:'trade_in_lender',action:'snapshot',applicationId:choiceId},c)).status,200);
 f.setResult({error:{message:'NOT_ALLOWED'}});assert.equal((await f.run({scope:'trade_in_lender',action:'open',documentId:potId},c)).status,403);
 assert.equal((await f.run({scope:'trade_in_lender',action:'upload',applicationId:choiceId,kind:'statement'},c)).status,403);
});
