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
test('company purchase uses session identity, strict source values and rollout flags',async()=>{
 const f=enabled(fixture()),c=await f.login();
 f.setResult({data:{companyPurchase:true,car:{id:'company-car',company_purchase_recorded:true},payments:[],journals:[]}});assert.equal((await f.run(purchase(),c)).status,200);assert.equal(f.calls[0].fn,'uc_register_company_car');assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const change of [{sellerName:''},{lenderCents:10000001},{lenderCents:1.5},{lenderName:''},{actor:'someone-else'},{car:{...purchase().car,investor_id:'other'}}])assert.equal((await f.run(purchase(change),c)).status,400);
 f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='0';assert.equal((await f.run(purchase(),c)).status,503);
});
test('staff registration stays available while company bills and journals remain private',async()=>{
 const f=enabled(fixture('salesperson')),c=await f.login();f.setResult({data:{companyPurchase:true,car:{id:'company-car',company_purchase_recorded:true},payments:[{id:'private-bill'}],journals:[{id:'private-ledger'}]}});const saved=await f.run(purchase(),c);assert.equal(saved.status,200);assert.deepEqual(saved.body.payments,[]);assert.deepEqual(saved.body.journals,[]);
 for(const role of ['admin','investor','mechanic']){const o=enabled(fixture(role)),oc=await o.login();assert.equal((await o.run(purchase(),oc)).status,403);assert.equal(o.calls.length,0);}
 f.setResult({error:{message:'REQUEST_CHANGED'}});assert.equal((await f.run(purchase(),c)).status,409);f.setResult({data:{car:{id:'wrong'}}});assert.equal((await f.run(purchase(),c)).status,503);
});
