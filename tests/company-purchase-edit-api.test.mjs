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


const purchase=(extra={})=>({scope:'investor_finance',action:'register_company_car',car:{id:'company-car',make:'Toyota',model:'Noah',colour:'White',purchase_price:100000,status:'available'},sellerName:'Seller',lenderCents:3000000,lenderName:'Bank',requestId:'company_purchase_request_01',...extra});
const enabled=f=>{f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='1';f.deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE='1';return f;};

// Changing a recorded purchase while nothing is paid. The database does the work
// (and refuses once money is paid); the server checks who asks and what is sent.
const edit=(extra={})=>({scope:'investor_finance',action:'edit_company_purchase',carId:'company-car',purchaseCents:3205000,sellerName:'Carsome Sdn Bhd',lenderCents:0,requestId:'company_purchase_edit_01',...extra});
const ok={data:{companyPurchase:true,car:{id:'company-car',company_purchase_recorded:true},payments:[],journals:[],removedPaymentIds:[]}};

test('Director change goes to the database with the session identity and clean values',async()=>{
 const f=enabled(fixture()),c=await f.login();f.setResult(ok);
 const r=await f.run(edit({sellerName:'  Carsome Sdn Bhd '}),c);
 assert.equal(r.status,200);assert.deepEqual(r.body.removedPaymentIds,[]);
 assert.equal(f.calls[0].fn,'uc_edit_company_purchase');assert.equal(f.calls[0].args.p_actor,'real-director');
 assert.deepEqual(f.calls[0].args.p_data,{carId:'company-car',purchaseCents:3205000,sellerName:'Carsome Sdn Bhd',lenderCents:0,requestId:'company_purchase_edit_01'});
 f.calls.length=0;assert.equal((await f.run(edit({lenderCents:1000000,lenderName:' Public Bank '}),c)).status,200);
 assert.deepEqual(f.calls[0].args.p_data,{carId:'company-car',purchaseCents:3205000,sellerName:'Carsome Sdn Bhd',lenderCents:1000000,lenderName:'Public Bank',requestId:'company_purchase_edit_01'});
});

test('bad values are refused before the database is asked',async()=>{
 const f=enabled(fixture()),c=await f.login();f.setResult(ok);
 for(const change of [{purchaseCents:0},{purchaseCents:12.5},{purchaseCents:-1},{lenderCents:3205001},{lenderCents:100,lenderName:''},{lenderCents:100},{sellerName:''},{sellerName:'   '},{sellerName:'a'.repeat(151)},{sellerName:'line'+String.fromCharCode(10)+'break'},{carId:'bad id!'},{requestId:'short'},{actor:'someone-else'},{car:{id:'company-car'}}])
  assert.equal((await f.run(edit(change),c)).status,400,JSON.stringify(change));
 assert.equal(f.calls.length,0);
});

test('only the Director can change a recorded purchase, and only when switched on',async()=>{
 for(const role of ['salesperson','admin','investor','mechanic']){const o=enabled(fixture(role)),oc=await o.login();o.setResult(ok);assert.equal((await o.run(edit(),oc)).status,403,role);assert.equal(o.calls.length,0);}
 const f=enabled(fixture()),c=await f.login();f.setResult(ok);
 f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='0';assert.equal((await f.run(edit(),c)).status,503);assert.equal(f.calls.length,0);
});

test('database refusals come back as plain messages',async()=>{
 const f=enabled(fixture()),c=await f.login();
 for(const [error,status,text] of [
  [{message:'PURCHASE_PAID_LOCKED'},409,/locked/],
  [{message:'PURCHASE_DOCUMENT_LOCKED'},409,/document/],
  [{message:'CAR_NOT_IN_STOCK'},409,/in stock/],
  [{message:'NOT_RECORDED'},409,/Record purchase/],
  [{message:'NO_CHANGE'},400,/Nothing was changed/],
  [{message:'REQUEST_CHANGED'},409,/Retry/],
  [{code:'23503',message:'violates foreign key constraint'},409,/cannot be removed/],
  [{code:'PGRST202',message:'Could not find the function public.uc_edit_company_purchase'},503,/not switched on/],
 ]){f.setResult({error});const r=await f.run(edit(),c);assert.equal(r.status,status,error.message);assert.match(JSON.stringify(r.body),text);}
 f.setResult({data:{companyPurchase:true,car:{id:'other-car',company_purchase_recorded:true},payments:[],journals:[],removedPaymentIds:[]}});assert.equal((await f.run(edit(),c)).status,503);
 f.setResult({data:{companyPurchase:true,car:{id:'company-car',company_purchase_recorded:true},payments:[],journals:[]}});assert.equal((await f.run(edit(),c)).status,503);
});

test('Record purchase explains a car that already has purchase money booked',async()=>{
 const f=enabled(fixture()),c=await f.login();f.setResult({error:{message:'PURCHASE_ALREADY_BOOKED'}});
 const r=await f.run(purchase(),c);assert.equal(r.status,409);assert.match(JSON.stringify(r.body),/purchase bill or a purchase entry/);
});
