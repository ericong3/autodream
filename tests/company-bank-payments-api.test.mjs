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

const record=(extra={})=>({scope:'company_bank_payments',action:'record',bankAccountId:potId,paidOn:'2026-11-05',bankReference:'Transfer 1',requestId:'company_bank_request_001',allocations:[{paymentId:'bill-1',amountCents:40000,documentId:choiceId}],...extra});
const enabled=f=>{f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='1';f.deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE='1';return f;};
test('company bank recording requires private Director identity and enabled finance rollout',async()=>{
 const f=enabled(fixture());assert.equal((await f.run(record())).status,401);const c=await f.login();
 assert.notEqual((await f.run(record(),c,{origin:'https://evil.example'})).status,200);assert.notEqual((await f.run(record(),c,{'x-garage-building':''})).status,200);assert.equal((await f.run(record({actor:'other'}),c)).status,400);
 f.setResult({data:{bankPaymentId:choiceId,payments:[{id:'bill-1',bank_paid_cents:40000}],journals:[{id:'posted'}]}});assert.equal((await f.run(record(),c)).status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].fn,'uc_company_bank_money');assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const role of ['admin','investor','salesperson','shareholder']){const o=enabled(fixture(role)),oc=await o.login();assert.equal((await o.run(record(),oc)).status,403);assert.equal(o.calls.length,0);}
});
test('allocation amount, exact dates, unique bills and source identifiers are checked before SQL',async()=>{
 const f=enabled(fixture()),c=await f.login();
 for(const x of [{bankAccountId:'bank'},{paidOn:'2026-02-30'},{bankReference:''},{requestId:'short'},{allocations:[]},{allocations:[{paymentId:'bill-1',amountCents:1.1,documentId:choiceId}]},{allocations:[{paymentId:'bill-1',amountCents:1,documentId:choiceId,approved:true}]},{allocations:[{paymentId:'bill-1',amountCents:1,documentId:choiceId},{paymentId:'bill-1',amountCents:1,documentId:choiceId}]}])assert.equal((await f.run(record(x),c)).status,400,JSON.stringify(x));assert.equal(f.calls.length,0);
});
test('disabled rollout, used proof, duplicate bank reference and inconsistent results do not return success',async()=>{
 const f=enabled(fixture()),c=await f.login();f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='0';assert.equal((await f.run(record(),c)).status,503);assert.equal(f.calls.length,0);f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='1';
 for(const code of ['PAYMENT_RECEIPT_REQUIRED','SUPPLIER_INVOICE_REQUIRED','RECEIPT_ALREADY_USED','BILL_LEDGER_REVIEW_REQUIRED','PAYMENT_EXCEEDS_BALANCE']){f.setResult({error:{message:code}});assert.equal((await f.run(record(),c)).status,409);}
 f.setResult({error:{code:'23505',message:'duplicate key'}});assert.equal((await f.run(record(),c)).status,409);
 f.setResult({data:{bankPaymentId:choiceId,payments:[{id:'wrong'}],journals:[]}});assert.equal((await f.run(record(),c)).status,503);
 f.setResult({data:{banks:[],company:{bankMatched:false}}});assert.equal((await f.run({scope:'company_bank_payments',action:'banks'},c)).status,200);
});

test('admin reads only source-authorised payment history and never bank balances or payroll',async()=>{
 const f=enabled(fixture('admin')),c=await f.login();f.setResult({data:{paymentId:'bill-1',entries:[]}});
 assert.equal((await f.run({scope:'company_bank_payments',action:'history',paymentId:'bill-1'},c)).status,200);assert.equal(f.calls[0].args.p_action,'history');assert.equal((await f.run({scope:'company_bank_payments',action:'banks'},c)).status,403);
 f.setResult({error:{message:'NOT_ALLOWED'}});assert.equal((await f.run({scope:'company_bank_payments',action:'history',paymentId:'salary'},c)).status,403);
});

test('monthly bank summary uses actual server movements and stays Director-only',async()=>{
 const f=enabled(fixture()),c=await f.login();f.setResult({data:{month:{receivedCents:7900000,paidCents:1000000}}});assert.equal((await f.run({scope:'company_bank_payments',action:'month'},c)).status,200);
 f.setResult({data:{month:{receivedCents:'7900000',paidCents:0}}});assert.equal((await f.run({scope:'company_bank_payments',action:'month'},c)).status,503);
 const a=enabled(fixture('admin')),ac=await a.login();assert.equal((await a.run({scope:'company_bank_payments',action:'month'},ac)).status,403);
});
test('company pot stock and balances are paginated and Director-only',async()=>{
 const f=enabled(fixture()),c=await f.login(),body={scope:'company_bank_payments',action:'company',page:0};
 f.setResult({data:{company:{bankMatched:false},cars:[{id:'company-car'}],hasMore:false}});assert.equal((await f.run(body,c)).status,200);assert.equal(f.calls[0].args.p_action,'company');
 for(const page of [-1,0.1,'1',1000000])assert.equal((await f.run({...body,page},c)).status,400);
 const a=enabled(fixture('admin')),ac=await a.login();assert.equal((await a.run(body,ac)).status,403);assert.equal(a.calls.length,0);
 f.setResult({data:{company:{},cars:[],hasMore:'yes'}});assert.equal((await f.run(body,c)).status,503);
});
