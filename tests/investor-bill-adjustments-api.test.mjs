import test from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleInvestorBillAdjustments} from '../server/usedCar/investorBillAdjustments.mjs';import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example',billId='11111111-1111-4111-8111-111111111111',doc='22222222-2222-4222-8222-222222222222',bank='3333aaaa-3333-4333-8333-333333333333';
function fixture(role='director'){
 const user={id:'session-staff',name:'Staff',username:'staff',password:bcrypt.hashSync('password-for-test',4),role,business_access:'both',enabled:true,registration_status:'active'},sessions=new Map(),calls=[];
 let result={data:{carId:'car',billId,totalCents:100000,invoices:[],receipts:[]}};
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return result;}};
 const deps={env:{GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin,USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',USED_CAR_INVESTOR_CARS_ONLINE:'1',USED_CAR_PRIVATE_FINANCE_ONLINE:'1',USED_CAR_BANK_PAYMENTS_ONLINE:'1'},repo:()=>repo,bcrypt};
 const req=(body,cookie)=>({method:'POST',body:JSON.stringify(body),headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})}});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'password-for-test'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(x=>x.startsWith(COOKIE_NAME+'=')&&!x.includes('Max-Age=0')).split(';')[0];};
 return{deps,calls,user,login,run:async(body,cookie)=>{const r=await handleInvestorBillAdjustments(req(body,cookie),deps);return{...r,body:JSON.parse(r.body)};},setResult:r=>{result=r;}};
}
const body=(extra={})=>({scope:'investor_bill_adjustments',action:'apply',carId:'car',billId,amountCents:0,invoiceDocumentId:doc,reason:'Supplier cancelled invoice',expectedRevision:'a'.repeat(32),requestId:'investor_adjust_0001',...extra});
test('investor correction requires session Director and accepts full supplier credit with immutable request',async()=>{
 const f=fixture(),c=await f.login();assert.equal((await f.run(body())).status,401);assert.equal((await f.run(body(),c)).status,200);assert.equal(f.calls[0].fn,'uc_investor_bill_adjustment');assert.equal(f.calls[0].args.p_actor,'session-staff');assert.equal(f.calls[0].args.p_data.amountCents,0);
 for(const change of [{actor:'other'},{amountCents:-1},{amountCents:1.5},{reason:'Bad\nreason'},{expectedRevision:'bad'},{invoiceDocumentId:'wrong'},{requestId:''}])assert.equal((await f.run(body(change),c)).status,400);
 for(const role of ['admin','shareholder','salesperson','investor']){const g=fixture(role),gc=await g.login();assert.equal((await g.run(body(),gc)).status,403);assert.equal(g.calls.length,0);}
 f.setResult({error:{message:'SOURCE_CHANGED'}});assert.equal((await f.run(body(),c)).status,409);f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='0';assert.equal((await f.run(body(),c)).status,503);
});
test('supplier refund requires registered bank ID and maps it server-side without accepting bank text',async()=>{
 const f=fixture(),c=await f.login(),r={scope:'investor_bill_adjustments',action:'refund',carId:'car',billId,amountCents:50000,bankAccountId:bank.toUpperCase(),bankReference:'BANK-001',paidOn:'2026-11-06',receiptDocumentId:doc,requestId:'investor_refund_0001'};
 assert.equal((await f.run(r,c)).status,200);assert.equal(f.calls[0].args.p_data.bankAccount,'bank:'+bank);assert.equal('bankAccountId' in f.calls[0].args.p_data,false);
 for(const change of [{bankAccount:'Other bank'},{bankAccountId:'text'},{amountCents:0},{receiptDocumentId:'bad'},{bankReference:'bad\nreference'}])assert.equal((await f.run({...r,...change},c)).status,400);
 f.setResult({data:{carId:'someone-else',billId,totalCents:100000,invoices:[],receipts:[]}});assert.equal((await f.run(r,c)).status,503);
});
test('investor snapshot is read-only and still delegates ownership to private SQL',async()=>{
 const f=fixture('investor'),c=await f.login();assert.equal((await f.run({scope:'investor_bill_adjustments',action:'snapshot',carId:'car',billId},c)).status,200);assert.equal(f.calls[0].args.p_actor,'session-staff');
 f.setResult({error:{message:'NOT_ALLOWED'}});assert.equal((await f.run({scope:'investor_bill_adjustments',action:'snapshot',carId:'car',billId},c)).status,403);
});
