import {test} from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleInvestorRepairCompletion as rawHandler} from '../server/usedCar/investorRepair.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
async function complete(req,deps){const r=await rawHandler(req,deps);return {...r,body:JSON.parse(r.body)};}
const origin='https://app.example',receipt='https://example.supabase.co/storage/v1/object/public/repairs/r1.jpg';
const billDetails={parts:[{name:'Brake pads',cost:120.5},{name:'Oil',cost:0}],labourCostCents:8000};
const body=(extra={})=>({scope:'investor_finance',action:'complete_repair',repairId:'repair_0001',amountCents:20050,receiptPhoto:receipt,billDetails,requestId:'request_repair_0001',...extra});
function fixture(role='mechanic',rpcResult,access=role==='director'?'both':'used_car'){
 const user={id:'private-user',username:'staff',name:'Sample',password:bcrypt.hashSync('sample-password',4),role,business_access:access,enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[];
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},
  rpc:async(fn,args)=>{calls.push({fn,args});return rpcResult??{data:{repair:{id:args.p_data.repairId,status:'done'},billId:'22222222-2222-4222-8222-222222222222',alreadyRecorded:false}};}};
 const deps={env:{USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',USED_CAR_INVESTOR_CARS_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(b,cookie,headers={})=>({method:'POST',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{}),...headers},body:JSON.stringify(b)});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'sample-password'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 return {deps,calls,req,login,user};
}
test('complete_repair needs a session, same origin, and derives the actor',async()=>{
 const w=fixture();assert.equal((await complete(w.req(body()),w.deps)).status,401);
 const cookie=await w.login();
 assert.notEqual((await complete(w.req(body(),cookie,{origin:'https://evil.example'}),w.deps)).status,200);
 for(const forged of [{actor:'someone-else'},{p_actor:'x'},{role:'director'},{completedAt:'2020-01-01'},{carId:'car_1'},{status:'done'}])
  assert.equal((await complete(w.req(body(forged),cookie),w.deps)).status,400,JSON.stringify(forged));
 const r=await complete(w.req(body(),cookie),w.deps);
 assert.equal(r.status,200);assert.equal(r.body.repair.id,'repair_0001');assert.equal(r.body.alreadyRecorded,false);assert.equal(typeof r.body.billId,'string');
 assert.equal(w.calls.length,1);assert.equal(w.calls[0].fn,'uc_complete_investor_repair');
 assert.deepEqual(Object.keys(w.calls[0].args).sort(),['p_actor','p_data']);assert.equal(w.calls[0].args.p_actor,w.user.id);
 assert.deepEqual(w.calls[0].args.p_data,{repairId:'repair_0001',amountCents:20050,requestId:'request_repair_0001',receiptPhoto:receipt,billDetails});
});
test('Director, admin and mechanic with used-car access only',async()=>{
 for(const role of ['director','admin','mechanic']){const w=fixture(role),c=await w.login();assert.equal((await complete(w.req(body(),c),w.deps)).status,200,role);}
 for(const role of ['investor','salesperson','shareholder','garage_head']){const w=fixture(role,undefined,'both'),c=await w.login();assert.equal((await complete(w.req(body(),c),w.deps)).status,403,role);assert.equal(w.calls.length,0);}
 const g=fixture('mechanic',undefined,'garage'),c=await g.login();assert.equal((await complete(g.req(body(),c),g.deps)).status,403);assert.equal(g.calls.length,0);
});
test('invalid cents, parts, URLs and oversized bodies never reach the database',async()=>{
 const w=fixture(),cookie=await w.login();
 const bads=[{amountCents:-1},{amountCents:1.5},{amountCents:'20050'},{amountCents:1e12+1},{repairId:'../x'},{requestId:'short'},
  {receiptPhoto:'http://example.supabase.co/storage/v1/object/a.jpg'},{receiptPhoto:'https://evil.example/storage/v1/object/a.jpg'},
  {receiptPhoto:'https://user:pw@example.supabase.co/storage/v1/object/a.jpg'},{receiptPhoto:'https://example.supabase.co:8443/storage/v1/object/a.jpg'},
  {receiptPhoto:'https://example.supabase.co/rest/v1/repairs'},{receiptPhoto:'javascript:alert(1)'},{receiptPhoto:'https://169.254.169.254/storage/v1/object/a'},
  {billDetails:{...billDetails,labourCostCents:8001}},{billDetails:{parts:[{name:'Pads',cost:-1}],labourCostCents:20150}},
  {billDetails:{parts:[{name:'Pads',cost:1.234}],labourCostCents:0},amountCents:123},{billDetails:{parts:[{name:'',cost:1}],labourCostCents:20049}},
  {billDetails:{parts:[{name:'x',cost:1,extra:1}],labourCostCents:20049}},{billDetails:{...billDetails,discount:1}},{billDetails:{parts:'x',labourCostCents:0}},
  {billDetails:{parts:Array.from({length:101},()=>({name:'p',cost:0})),labourCostCents:20050}},{billDetails:{parts:[],labourCostCents:-5}},
  {scope:'other'},{action:'add_car_bill'}];
 for(const extra of bads)assert.equal((await complete(w.req(body(extra),cookie),w.deps)).status,400,JSON.stringify(extra));
 assert.ok((await complete(w.req(body({billDetails:{parts:[{name:'x'.repeat(200),cost:0}],labourCostCents:20050},pad:'y'.repeat(25_000)}),cookie),w.deps)).status>=400);
 assert.equal(w.calls.length,0);
 const minimal=await complete(w.req({scope:'investor_finance',action:'complete_repair',repairId:'repair_0001',amountCents:100,requestId:'request_repair_0002'},cookie),w.deps);
 assert.equal(minimal.status,200);assert.deepEqual(w.calls[0].args.p_data,{repairId:'repair_0001',amountCents:100,requestId:'request_repair_0002'});
});
test('either rollout flag off makes no database call',async()=>{
 for(const flag of ['USED_CAR_INVESTOR_CAPITAL_ONLINE','USED_CAR_INVESTOR_CARS_ONLINE']){
  const w=fixture(),c=await w.login();w.deps.env[flag]='0';
  assert.equal((await complete(w.req(body(),c),w.deps)).status,503);assert.equal(w.calls.length,0);
 }
});
test('database errors map to plain English, including changed cost',async()=>{
 for(const [message,status,code] of [['REQUEST_CHANGED',409,'REQUEST_CHANGED'],['REPAIR_CHANGED_REVIEW_REQUIRED',409,'REPAIR_CHANGED_REVIEW_REQUIRED'],['IMMUTABLE_HISTORY',409,'REPAIR_CHANGED_REVIEW_REQUIRED'],
  ['REPAIR_REVIEW_REQUIRED',409,'REPAIR_REVIEW_REQUIRED'],['NOT_INVESTOR_FUNDED',409,'NOT_INVESTOR_FUNDED'],['REPAIR_LOCATION_REQUIRED',409,'REPAIR_LOCATION_REQUIRED'],
  ['CAR_SETTLED_ADJUSTMENT_REQUIRED',409,'CAR_SETTLED_ADJUSTMENT_REQUIRED'],['REPAIR_NOT_FOUND',404,'REPAIR_NOT_FOUND'],['NOT_ALLOWED',403,'NOT_ALLOWED'],['boom',503,'UNAVAILABLE']]){
  const w=fixture('mechanic',{error:{message}}),c=await w.login();
  const r=await complete(w.req(body(),c),w.deps);
  assert.equal(r.status,status,message);assert.equal(r.body.error.code,code);assert.doesNotMatch(r.body.error.message,/[A-Z]{4,}_[A-Z]/);
 }
 const odd=fixture('mechanic',{data:{repair:{id:'r'}}}),c=await odd.login();assert.equal((await complete(odd.req(body(),c),odd.deps)).status,503);
});
test('replay passes alreadyRecorded through and sends identical payloads',async()=>{
 const w=fixture('mechanic',{data:{repair:{id:'repair_0001'},billId:'b',alreadyRecorded:true}}),c=await w.login();
 const a=await complete(w.req(body(),c),w.deps),b=await complete(w.req(body(),c),w.deps);
 assert.equal(a.body.alreadyRecorded,true);assert.deepEqual(w.calls[0].args,w.calls[1].args);assert.equal(b.status,200);
});
test('a confirmed no-cost repair returns no bill or payment',async()=>{const w=fixture('mechanic',{data:{repair:{id:'repair_0001',actual_cost:0,status:'done'},billId:null,alreadyRecorded:false}}),cookie=await w.login();const r=await complete(w.req(body({amountCents:0,billDetails:{parts:[],labourCostCents:0}}),cookie),w.deps);assert.equal(r.status,200);assert.equal(r.body.billId,null);});
