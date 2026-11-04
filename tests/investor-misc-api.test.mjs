import {test} from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleInvestorMiscCost as rawHandler} from '../server/usedCar/investorMisc.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
async function record(req,deps){const r=await rawHandler(req,deps);return {...r,body:JSON.parse(r.body)};}
const origin='https://app.example',billId='22222222-2222-4222-8222-222222222222';
const body=(extra={})=>({scope:'investor_finance',action:'record_misc',carId:'car_0001',miscId:'misc_0001',amountCents:12550,purpose:'Car wash',payee:'Shine Auto',category:'Cleaning',requestId:'request_misc_0001',...extra});
const item=(a,actor)=>({id:a.p_data.miscId,description:a.p_data.purpose,amount:a.p_data.amountCents/100,merchant:a.p_data.payee,...(a.p_data.category?{category:a.p_data.category}:{}),createdAt:'2026-11-04T01:02:03.000Z',createdBy:actor});
function fixture(role='director',rpcResult,access=role==='director'?'both':'used_car',status='active'){
 const user={id:'private-user',username:'staff',name:'Sample',password:bcrypt.hashSync('sample-password',4),role,business_access:access,enabled:true,registration_status:status};
 const sessions=new Map(),calls=[];
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},
  rpc:async(fn,args)=>{calls.push({fn,args});return typeof rpcResult==='function'?rpcResult(args):rpcResult??{data:{carId:args.p_data.carId,misc:item(args,args.p_actor),billId,alreadyRecorded:false}};}};
 const deps={env:{USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',USED_CAR_INVESTOR_CARS_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(b,cookie,headers={})=>({method:'POST',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{}),...headers},body:JSON.stringify(b)});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'sample-password'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 return {deps,calls,req,login,user};
}
test('record_misc needs a session, same origin and the CSRF header, and derives the actor',async()=>{
 const w=fixture();assert.equal((await record(w.req(body()),w.deps)).status,401);
 const cookie=await w.login();
 assert.notEqual((await record(w.req(body(),cookie,{origin:'https://evil.example'}),w.deps)).status,200);
 assert.notEqual((await record(w.req(body(),cookie,{'x-garage-building':''}),w.deps)).status,200);
 for(const forged of [{actor:'someone-else'},{p_actor:'x'},{createdBy:'someone-else'},{createdAt:'2020-01-01T00:00:00Z'},{date:'2020-01-01'},{amount:125.5},{role:'director'},{billId:billId},{receiptPhoto:'https://example.supabase.co/storage/v1/object/a.jpg'},{receiptNo:'R-1'}])
  assert.equal((await record(w.req(body(forged),cookie),w.deps)).status,400,JSON.stringify(forged));
 assert.equal(w.calls.length,0);
 const r=await record(w.req(body(),cookie),w.deps);
 assert.equal(r.status,200);assert.equal(r.body.carId,'car_0001');assert.equal(r.body.billId,billId);assert.equal(r.body.alreadyRecorded,false);
 assert.equal(r.body.misc.createdBy,w.user.id);assert.equal(r.body.misc.amount,125.5);assert.equal(r.body.misc.merchant,'Shine Auto');
 assert.equal(w.calls.length,1);assert.equal(w.calls[0].fn,'uc_record_investor_misc');
 assert.deepEqual(Object.keys(w.calls[0].args).sort(),['p_actor','p_data']);assert.equal(w.calls[0].args.p_actor,w.user.id);
 assert.deepEqual(w.calls[0].args.p_data,{carId:'car_0001',miscId:'misc_0001',amountCents:12550,purpose:'Car wash',payee:'Shine Auto',category:'Cleaning',requestId:'request_misc_0001'});
});
test('active Director and admin with used-car access only',async()=>{
 for(const role of ['director','admin']){const w=fixture(role),c=await w.login();assert.equal((await record(w.req(body(),c),w.deps)).status,200,role);}
 for(const role of ['mechanic','investor','salesperson','shareholder','garage_head']){const w=fixture(role,undefined,'both'),c=await w.login();assert.equal((await record(w.req(body(),c),w.deps)).status,403,role);assert.equal(w.calls.length,0);}
 const g=fixture('admin',undefined,'garage'),c=await g.login();assert.equal((await record(g.req(body(),c),g.deps)).status,403);assert.equal(g.calls.length,0);
 const p=fixture('director',undefined,'both','pending');let pc;try{pc=await p.login();}catch{pc=null;}
 if(pc)assert.notEqual((await record(p.req(body(),pc),p.deps)).status,200);
 assert.equal(p.calls.length,0);
});
test('invalid cents, text, ids and oversized bodies never reach the database',async()=>{
 const w=fixture(),cookie=await w.login();
 const bads=[{amountCents:0},{amountCents:-1},{amountCents:1.5},{amountCents:'12550'},{amountCents:1e12+1},{amountCents:null},
  {carId:'../x'},{carId:''},{carId:7},{miscId:'a b'},{miscId:'x'.repeat(101)},{requestId:'short'},{requestId:undefined},
  {purpose:''},{purpose:'   '},{purpose:'x'.repeat(301)},{purpose:5},{payee:''},{payee:'x'.repeat(151)},{payee:undefined},
  {category:''},{category:'x'.repeat(81)},{category:3},{scope:'other'},{action:'add_car_bill'},{action:'complete_repair'}];
 for(const extra of bads)assert.equal((await record(w.req(body(extra),cookie),w.deps)).status,400,JSON.stringify(extra));
 assert.ok((await record(w.req(body({purpose:'x'.repeat(300),pad:'y'.repeat(25_000)}),cookie),w.deps)).status>=400);
 assert.ok((await record(w.req(body({purpose:'y'.repeat(25_000)}),cookie),w.deps)).status>=400);
 assert.equal(w.calls.length,0);
 const edge=await record(w.req({scope:'investor_finance',action:'record_misc',carId:'car_0001',miscId:'misc_0002',amountCents:1e12,purpose:' Tow  ',payee:' Tow Co ',requestId:'request_misc_0002'},cookie),w.deps);
 assert.equal(edge.status,200);assert.deepEqual(w.calls[0].args.p_data,{carId:'car_0001',miscId:'misc_0002',amountCents:1e12,purpose:'Tow',payee:'Tow Co',requestId:'request_misc_0002'});
 assert.equal('category' in edge.body.misc,false);
});
test('either rollout flag off makes no database call',async()=>{
 for(const flag of ['USED_CAR_INVESTOR_CAPITAL_ONLINE','USED_CAR_INVESTOR_CARS_ONLINE']){
  const w=fixture(),c=await w.login();w.deps.env[flag]='0';
  assert.equal((await record(w.req(body(),c),w.deps)).status,503);assert.equal(w.calls.length,0);
 }
});
test('database errors map to plain English, including changed details',async()=>{
 for(const [message,status,code] of [['REQUEST_CHANGED',409,'REQUEST_CHANGED'],['MISC_CHANGED_REVIEW_REQUIRED',409,'MISC_CHANGED_REVIEW_REQUIRED'],['IMMUTABLE_HISTORY',409,'MISC_CHANGED_REVIEW_REQUIRED'],
  ['MISC_COMMAND_REQUIRED',409,'MISC_CHANGED_REVIEW_REQUIRED'],['MISC_COSTS_REVIEW_REQUIRED',409,'MISC_COSTS_REVIEW_REQUIRED'],['NOT_INVESTOR_FUNDED',409,'NOT_INVESTOR_FUNDED'],
  ['CAR_SETTLED_ADJUSTMENT_REQUIRED',409,'CAR_SETTLED_ADJUSTMENT_REQUIRED'],['NOT_ALLOWED',403,'NOT_ALLOWED'],['INVALID',400,'INVALID'],['boom',503,'UNAVAILABLE']]){
  const w=fixture('director',{error:{message}}),c=await w.login();
  const r=await record(w.req(body(),c),w.deps);
  assert.equal(r.status,status,message);assert.equal(r.body.error.code,code);assert.doesNotMatch(r.body.error.message,/[A-Z]{4,}_[A-Z]/);
 }
 const w=fixture('director',{error:{message:'x',code:'22P02'}}),c=await w.login();assert.equal((await record(w.req(body(),c),w.deps)).status,400);
});
test('malformed database responses are never reported as saved',async()=>{
 const good=a=>({carId:a.p_data.carId,misc:item(a,'private-user'),billId,alreadyRecorded:false});
 for(const bend of [a=>null,a=>({...good(a),billId:null}),a=>({...good(a),billId:''}),a=>({...good(a),alreadyRecorded:'no'}),a=>({...good(a),carId:'other_car'}),
  a=>({...good(a),misc:null}),a=>({...good(a),misc:[]}),a=>({...good(a),misc:{...good(a).misc,id:'misc_other'}}),a=>({...good(a),misc:{...good(a).misc,amount:'125.50'}}),
  a=>({...good(a),misc:{...good(a).misc,createdBy:undefined}}),a=>({...good(a),misc:{...good(a).misc,createdAt:'not a date'}}),a=>({...good(a),misc:{...good(a).misc,secret:1}})]){
  const w=fixture('director',a=>({data:bend(a)})),c=await w.login();
  assert.equal((await record(w.req(body(),c),w.deps)).status,503,String(bend));
 }
});
test('replay passes alreadyRecorded through and sends identical payloads',async()=>{
 const w=fixture('director',a=>({data:{carId:a.p_data.carId,misc:item(a,'first-actor'),billId,alreadyRecorded:true}})),c=await w.login();
 const a=await record(w.req(body(),c),w.deps),b=await record(w.req(body(),c),w.deps);
 assert.equal(a.status,200);assert.equal(a.body.alreadyRecorded,true);assert.equal(a.body.billId,billId);assert.equal(a.body.misc.createdBy,'first-actor');
 assert.deepEqual(w.calls[0].args,w.calls[1].args);assert.equal(b.status,200);
});
