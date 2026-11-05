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


const receipt=(extra={})=>({scope:'company_bank_receipts',action:'record',paymentId:'loan',amountCents:500000,receiptDocumentId:choiceId,bankAccountId:potId,bankReference:'Loan transfer',paidOn:'2026-11-05',requestId:'company_receipt_request_01',...extra});
const enabled=f=>{f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='1';f.deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE='1';return f;};
test('assigned deal balance uses server identity and exposes no bank or salary data',async()=>{
 const f=enabled(fixture('salesperson')),c=await f.login(),body={scope:'company_bank_receipts',action:'balance',carId:'own-car'};
 f.setResult({data:{carId:'own-car',customerCoveredCents:12000,loanCoveredCents:0}});
 assert.equal((await f.run(body,c)).status,200);assert.equal(f.calls[0].args.p_actor,'real-director');
 assert.equal((await f.run({...body,paymentId:'salary'},c)).status,400);
 f.setResult({data:{carId:'own-car',customerCoveredCents:12000,loanCoveredCents:0,bankId:potId}});assert.equal((await f.run(body,c)).status,503);
 f.setResult({error:{message:'NOT_ALLOWED'}});assert.equal((await f.run(body,c)).status,403);
});
test('company receipt requires private Director identity, stable source IDs and server actor',async()=>{
 const f=enabled(fixture());assert.equal((await f.run(receipt())).status,401);const c=await f.login();assert.notEqual((await f.run(receipt(),c,{origin:'https://evil.example'})).status,200);assert.equal((await f.run(receipt({actor:'other'}),c)).status,400);
 f.setResult({data:{receiptId:choiceId,payments:[{id:'loan',car_id:'car-own'}],journals:[{id:'receipt'}],car:{id:'car-own'}}});assert.equal((await f.run(receipt(),c)).status,200);assert.equal(f.calls[0].fn,'uc_company_bank_receipt');assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const role of ['admin','investor','salesperson']){const o=enabled(fixture(role)),oc=await o.login();assert.equal((await o.run(receipt(),oc)).status,403);assert.equal(o.calls.length,0);}
});
test('receipt validates cents, date, deductions and selected excess customer before SQL',async()=>{
 const f=enabled(fixture()),c=await f.login();
 for(const x of [{amountCents:1.5},{amountCents:-1},{amountCents:0},{paidOn:'2026-02-30'},{receiptDocumentId:'bad'},{excessCents:1},{withheldBills:[{paymentId:'loan',amountCents:1,documentId:choiceId}]},{withheldBills:[{paymentId:'fee',amountCents:0,documentId:choiceId}]},{withheldBills:[{paymentId:'fee',amountCents:1,documentId:choiceId,approved:true}]}])assert.equal((await f.run(receipt(x),c)).status,400,JSON.stringify(x));assert.equal(f.calls.length,0);
});
test('disabled rollout, historical collection conflicts and malformed results never report new money',async()=>{
 const f=enabled(fixture()),c=await f.login();f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='0';assert.equal((await f.run(receipt(),c)).status,503);assert.equal(f.calls.length,0);f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='1';
 for(const code of ['COLLECTION_HISTORY_REVIEW_REQUIRED','PAYMENT_EXCEEDS_BALANCE','RECEIPT_ALREADY_USED','WITHHELD_BILL_REQUIRED','SUPPLIER_INVOICE_REQUIRED']){f.setResult({error:{message:code}});assert.equal((await f.run(receipt(),c)).status,409);}
 f.setResult({data:{receiptId:choiceId,payments:[{id:'wrong',car_id:'car-own'}],journals:[{}],car:{id:'car-own'}}});assert.equal((await f.run(receipt(),c)).status,503);
});
