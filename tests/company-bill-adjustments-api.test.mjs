import test from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleSales} from '../server/sales/core.mjs';import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example',choiceId='11111111-1111-4111-8111-111111111111',potId='22222222-2222-4222-8222-222222222222';
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


const enabled=f=>{f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='1';f.deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE='1';return f;};
const correction={scope:'company_bill_adjustments',action:'apply',paymentId:'repair-bill',amountCents:250000,invoiceDocumentId:choiceId,reason:'Supplier revised invoice',expectedRevision:'a'.repeat(32),requestId:'company_bill_0001'};
test('company correction uses authenticated Director and rejects forged totals, actor and invalid evidence',async()=>{
 const f=enabled(fixture()),cookie=await f.login();f.setResult({data:{paymentId:'repair-bill',carId:'company-car',payments:[],journals:[]}});
 assert.equal((await f.run(correction)).status,401);assert.equal((await f.run(correction,cookie)).status,200);assert.equal(f.calls[0].fn,'uc_company_bill_adjustment');assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const patch of [{actor:'other'},{paidCents:1},{costAccount:'bank'},{amountCents:-1},{amountCents:1.5},{invoiceDocumentId:'bad'},{reason:'a\nbad reason'},{requestId:''},{expectedRevision:'bad'}])assert.equal((await f.run({...correction,...patch},cookie)).status,400);
 assert.equal((await f.run({...correction,amountCents:0},cookie)).status,200);
 for(const role of ['admin','shareholder','salesperson','investor']){const g=enabled(fixture(role)),gc=await g.login();assert.equal((await g.run(correction,gc)).status,403);assert.equal(g.calls.length,0);}
 f.setResult({error:{message:'SOURCE_CHANGED'}});assert.equal((await f.run(correction,cookie)).status,409);
 f.setResult({data:{paymentId:'other',carId:'company-car',payments:[],journals:[]}});assert.equal((await f.run(correction,cookie)).status,503);
 f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='0';assert.equal((await f.run(correction,cookie)).status,503);
});
test('correction snapshot and preview require matching source result and carry no supplied accounting authority',async()=>{
 const f=enabled(fixture()),cookie=await f.login();f.setResult({data:{paymentId:'repair-bill',carId:'company-car',sourceRevision:'a'.repeat(32),invoices:[]}});
 assert.equal((await f.run({scope:'company_bill_adjustments',action:'snapshot',paymentId:'repair-bill'},cookie)).status,200);
 const {expectedRevision,requestId,...preview}=correction;assert.equal((await f.run({...preview,action:'preview'},cookie)).status,200);
 assert.equal((await f.run({...preview,action:'preview',payableCents:1},cookie)).status,400);
 f.setResult({data:{paymentId:'repair-bill',carId:'company-car',sourceRevision:'invalid'}});assert.equal((await f.run({...preview,action:'preview'},cookie)).status,503);
});
