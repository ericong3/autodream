import test from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleSales} from '../server/sales/core.mjs';import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example',potId='22222222-2222-4222-8222-222222222222';
const view={dealer:{id:'2tn',name:'2TN'},investor:null,cars:[],payouts:[],conversions:[],totals:{owedCents:0}};
function fixture(role='director'){
 const user={id:'real-'+role,name:role,username:'staff',password:bcrypt.hashSync('password-for-test',4),role,business_access:role==='director'?'both':'used_car',enabled:true,registration_status:'active'},sessions=new Map(),calls=[];
 let result={data:view};
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return result;}};
 const deps={env:{GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin,USED_CAR_INVESTOR_CAPITAL_ONLINE:'1'},repo:()=>repo,bcrypt};
 const req=(body,cookie)=>({method:'POST',body:JSON.stringify(body),headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})}});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'password-for-test'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(x=>x.startsWith(COOKIE_NAME+'=')&&!x.includes('Max-Age=0')).split(';')[0];};
 const run=async(body,cookie)=>{const r=await handleSales(req(body,cookie),deps);return {...r,body:JSON.parse(r.body)};};
 return {deps,calls,login,run,setResult:r=>{result=r;}};
}
const convert={scope:'dealer_accounts',action:'lock_draft',dealerId:'2tn',convertedOn:'2026-11-15',note:'Signed agreement: kept as investment',requestId:'dealer_convert_0001'};

test('dealer account: director locks the draft through the database with the server actor',async()=>{
 const f=fixture();const cookie=await f.login();
 const r=await f.run(convert,cookie);assert.equal(r.status,200);
 assert.deepEqual(f.calls.at(-1),{fn:'uc_dealer_account',args:{p_actor:'real-director',p_action:'lock_draft',p_data:{dealerId:'2tn',convertedOn:'2026-11-15',note:'Signed agreement: kept as investment',requestId:'dealer_convert_0001'}}});
 assert.equal((await f.run({scope:'dealer_accounts',action:'link',dealerId:'2tn',potId,requestId:'dealer_link_00001'},cookie)).status,200);
 assert.equal((await f.run({scope:'dealer_accounts',action:'prepare_payouts',dealerId:'2tn',requestId:'dealer_prep_000001'},cookie)).status,200);
 assert.deepEqual(f.calls.at(-1).args,{p_actor:'real-director',p_action:'prepare_payouts',p_data:{dealerId:'2tn',requestId:'dealer_prep_000001'}});
 assert.equal((await f.run({scope:'dealer_accounts',action:'prepare_payouts',dealerId:'2tn',amountCents:1,requestId:'dealer_prep_000002'},cookie)).status,400,'No amount: it prepares what is unpaid');
 for(const body of [{action:'confirm_costs',paymentId:'pay-1',requestId:'dealer_conf_000001'},{action:'unconfirm_costs',paymentId:'pay-1',requestId:'dealer_conf_000002'},{action:'save_draft',targetCents:50000000,paymentIds:['pay-1','pay-2'],requestId:'dealer_draft_00001'},{action:'undo_lock',conversionId:potId,reason:'Locked before costs were final',requestId:'dealer_undo_000001'}]){
  assert.equal((await f.run({scope:'dealer_accounts',dealerId:'2tn',...body},cookie)).status,200,body.action);
  assert.equal(f.calls.at(-1).args.p_action,body.action);
 }
 assert.equal((await f.run({scope:'dealer_accounts',action:'convert',dealerId:'2tn',amountCents:1,convertedOn:'2026-11-15',note:'Old one-step lock',requestId:'dealer_convert_0002'},cookie)).status,400,'Old one-step lock is retired');
 f.setResult({data:{dealers:[],investors:[]}});assert.equal((await f.run({scope:'dealer_accounts',action:'list'},cookie)).status,200);
});

test('dealer account: input is validated before reaching the database',async()=>{
 const f=fixture();const cookie=await f.login();
 for(const bad of [{amountCents:1},{convertedOn:'15/11/2026'},{note:'x'},{note:'line\nbreak here'},{requestId:'short'},{dealerId:'bad id!'},{extra:1}])
  assert.equal((await f.run({...convert,...bad},cookie)).status,400,JSON.stringify(bad));
 assert.equal((await f.run({scope:'dealer_accounts',action:'link',dealerId:'2tn',potId:'not-a-uuid',requestId:'dealer_link_00001'},cookie)).status,400);
 assert.equal((await f.run({scope:'dealer_accounts',action:'delete',dealerId:'2tn'},cookie)).status,400);
 for(const bad of [{action:'save_draft',targetCents:0,paymentIds:[]},{action:'save_draft',targetCents:100,paymentIds:['a','a']},{action:'save_draft',targetCents:100,paymentIds:['bad id!']},{action:'save_draft',targetCents:100,paymentIds:'p1'},{action:'confirm_costs',paymentId:'bad id!'},{action:'undo_lock',conversionId:'not-a-uuid',reason:'Costs were not final'},{action:'undo_lock',conversionId:potId,reason:'x'}])
  assert.equal((await f.run({scope:'dealer_accounts',dealerId:'2tn',requestId:'dealer_bad_0000001',...bad},cookie)).status,400,JSON.stringify(bad));
 assert.equal(f.calls.length,0);
});

test('dealer account: investor may only read their own dealer',async()=>{
 const f=fixture('investor');const cookie=await f.login();
 assert.equal((await f.run({scope:'dealer_accounts',action:'mine'},cookie)).status,200);
 assert.deepEqual(f.calls.at(-1).args,{p_actor:'real-investor',p_action:'mine',p_data:{}});
 for(const body of [convert,{scope:'dealer_accounts',action:'view',dealerId:'2tn'},{scope:'dealer_accounts',action:'list'},{scope:'dealer_accounts',action:'prepare_payouts',dealerId:'2tn',requestId:'dealer_prep_000003'}])assert.equal((await f.run(body,cookie)).status,403);
 f.setResult({data:{dealer:null}});assert.equal((await f.run({scope:'dealer_accounts',action:'mine'},cookie)).status,200);
});

test('dealer account: database refusals become clear messages; nothing saved when switched off',async()=>{
 const f=fixture();const cookie=await f.login();
 f.setResult({error:{message:'DRAFT_SHORT'}});let r=await f.run(convert,cookie);assert.equal(r.status,409);assert.match(r.body.error.message,/do not add up to the target/);
 f.setResult({error:{message:'INVESTMENT_IN_USE'}});r=await f.run(convert,cookie);assert.equal(r.status,409);assert.match(r.body.error.message,/already used/);
 f.setResult({error:{message:'INVESTOR_LINK_REQUIRED'}});assert.equal((await f.run(convert,cookie)).status,409);
 f.setResult({error:{code:'42883',message:'function does not exist'}});assert.equal((await f.run(convert,cookie)).status,503);
 f.setResult({data:{}});assert.equal((await f.run(convert,cookie)).status,503,'A malformed reply is not reported as saved');
 const before=f.calls.length;f.deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE='0';assert.equal((await f.run(convert,cookie)).status,503);assert.equal(f.calls.length,before);
 const other=fixture('admin');const c=await other.login();assert.equal((await other.run({scope:'dealer_accounts',action:'list'},c)).status,403);
});

test('dealer stock: investor adds and edits own cars with uploaded photos only',async()=>{
 const f=fixture('investor');const cookie=await f.login();
 const photo='https://example.supabase.co/storage/v1/object/public/car-photos/dealer/1.jpg';
 const add={scope:'dealer_accounts',action:'add_car',make:'Honda',model:'Civic',year:2021,carPlate:'VGT 1234',transmission:'auto',mileage:42000,photos:[photo],requestId:'dealer_car_000001'};
 assert.equal((await f.run(add,cookie)).status,200);
 assert.deepEqual(f.calls.at(-1),{fn:'uc_dealer_account',args:{p_actor:'real-investor',p_action:'add_car',p_data:{make:'Honda',model:'Civic',year:2021,carPlate:'VGT 1234',transmission:'auto',mileage:42000,photos:[photo],requestId:'dealer_car_000001'}}});
 const before=f.calls.length;
 for(const bad of [{photos:[]},{photos:['https://evil.example/x.jpg']},{photos:['https://example.supabase.co/storage/v1/object/public/car-photos/../secret']},{year:1800},{transmission:'cvt'},{make:''},{mileage:-1},{terms:'fixed_amount'},{sellingPrice:1}])
  assert.equal((await f.run({...add,...bad},cookie)).status,400,JSON.stringify(bad));
 assert.equal(f.calls.length,before,'Invalid stock never reaches the database');
 assert.equal((await f.run({scope:'dealer_accounts',action:'edit_car',carId:'car-1',mileage:43000,photos:[photo],requestId:'dealer_car_000002'},cookie)).status,200);
 f.setResult({error:{message:'CAR_LOCKED'}});assert.equal((await f.run({scope:'dealer_accounts',action:'edit_car',carId:'car-1',photos:[photo],requestId:'dealer_car_000003'},cookie)).status,409);
 const d=fixture();const dc=await d.login();assert.equal((await d.run(add,dc)).status,403,'The Director adds stock from Inventory');
});
