import {test} from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';import {readFileSync} from 'node:fs';
import {handleInvestorCarRegistration as rawRegistrationHandler} from '../server/usedCar/investorCarRegistration.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
async function handleInvestorCarRegistration(req,deps){const r=await rawRegistrationHandler(req,deps);return {...r,body:JSON.parse(r.body)};}
const origin='https://app.example',potId='11111111-1111-4111-8111-111111111111';
const car={id:'car_new_0001',make:'Toyota',model:'Vios',colour:'White',year:2020,mileage:50000,purchase_price:45000.5,selling_price:52000,status:'available',photos:['https://example.supabase.co/storage/v1/object/public/cars/a.jpg'],date_added:'2026-11-04'};
const body=(extra={})=>({scope:'investor_finance',action:'register_car',car,potId,investorBasisPoints:4000,requestId:'request_sample_0001',...extra});
function fixture(role='director',rpcResult){
 const user={id:'private-user',username:'staff',name:'Sample',password:bcrypt.hashSync('sample-password',4),role,business_access:'both',enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[];
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},
  rpc:async(fn,args)=>{calls.push({fn,args});return rpcResult??{data:{car:{id:args.p_data.car.id,investor_funded:true},account:{carId:args.p_data.car.id}}};}};
 const deps={env:{USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',USED_CAR_INVESTOR_CARS_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(b,cookie,headers={})=>({method:'POST',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{}),...headers},body:JSON.stringify(b)});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'sample-password'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 return {deps,calls,req,login,user};
}
test('register_car requires a Director session and derives the actor',async()=>{
 const w=fixture();assert.equal((await handleInvestorCarRegistration(w.req(body()),w.deps)).status,401);
 const cookie=await w.login();
 assert.equal((await handleInvestorCarRegistration(w.req(body({actor:'someone-else'}),cookie),w.deps)).status,400);
 assert.notEqual((await handleInvestorCarRegistration(w.req(body(),cookie,{origin:'https://evil.example'}),w.deps)).status,200);
 const r=await handleInvestorCarRegistration(w.req(body(),cookie),w.deps);
 assert.equal(r.status,200);assert.equal(r.body.car.id,car.id);assert.ok('account' in r.body);
 assert.equal(w.calls.length,1);assert.equal(w.calls[0].fn,'uc_register_investor_car');assert.equal(w.calls[0].args.p_actor,w.user.id);
 assert.deepEqual(Object.keys(w.calls[0].args).sort(),['p_actor','p_data']);
 assert.deepEqual(w.calls[0].args.p_data,{car,potId,investorBasisPoints:4000,requestId:'request_sample_0001'});
});
test('only Directors can register; other roles never reach the database',async()=>{
 for(const role of ['admin','investor','salesperson','shareholder','garage_head']){const w=fixture(role),cookie=await w.login();assert.equal((await handleInvestorCarRegistration(w.req(body(),cookie),w.deps)).status,403);assert.equal(w.calls.length,0);}
});
test('forged car fields, bad ids, prices and URLs are refused',async()=>{
 const w=fixture(),cookie=await w.login();
 const forged=[{investor_id:'x'},{investor_split:50},{consignment:{dealer:'d'}},{outgoing_consignment:null},{trade_in_source_car_id:'c'},{final_deal:{}},{deal_progress:{}},{disbursement_amount:1},{settlement_amount:1},{investor_funded:true},{status:'sold'},{status:'delivered'},{id:'../x'},{purchase_price:0},{purchase_price:-5},{purchase_price:1.234},{purchase_price:'45000'},{year:20.5},{photos:['http://insecure.example/a.jpg']},{photos:['javascript:alert(1)']},{photo:'https://user:pw@example.com/a.jpg'},{make:''}];
 for(const extra of forged)assert.equal((await handleInvestorCarRegistration(w.req(body({car:{...car,...extra}}),cookie),w.deps)).status,400,JSON.stringify(extra));
 for(const extra of [{potId:'not-a-uuid'},{investorBasisPoints:10001},{investorBasisPoints:40.5},{requestId:'short'},{role:'director'},{scope:'other'},{action:'fund_car'}])assert.equal((await handleInvestorCarRegistration(w.req(body(extra),cookie),w.deps)).status,400,JSON.stringify(extra));
 assert.equal((await handleInvestorCarRegistration(w.req(body({car:{...car,notes:'x'.repeat(90_000)}}),cookie),w.deps)).status>=400,true);
 assert.equal(w.calls.length,0);
});
test('rollout flags gate saving and database errors map to plain English',async()=>{
 const off=fixture(),c1=await off.login();off.deps.env.USED_CAR_INVESTOR_CARS_ONLINE='0';
 assert.equal((await handleInvestorCarRegistration(off.req(body(),c1),off.deps)).status,503);assert.equal(off.calls.length,0);
 for(const [message,status,code] of [['REQUEST_CHANGED',409,'REQUEST_CHANGED'],['CAR_EXISTS',409,'CAR_EXISTS'],['INSUFFICIENT_FUNDS',409,'INSUFFICIENT_FUNDS'],['NOT_ALLOWED',403,'NOT_ALLOWED'],['boom',503,'UNAVAILABLE']]){
  const w=fixture('director',{error:{message}}),cookie=await w.login();
  const r=await handleInvestorCarRegistration(w.req(body(),cookie),w.deps);
  assert.equal(r.status,status);assert.equal(r.body.error.code,code);assert.doesNotMatch(r.body.error.message,/[A-Z]{4,}_[A-Z]/);
 }
});
test('identical retry sends the identical original payload (server replays it)',async()=>{
 const w=fixture(),cookie=await w.login();
 await handleInvestorCarRegistration(w.req(body(),cookie),w.deps);await handleInvestorCarRegistration(w.req(body(),cookie),w.deps);
 assert.deepEqual(w.calls[0].args,w.calls[1].args);
});
test('migration delegates to fund_car with a deterministic request id and never posts a journal',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261104060000_investor_car_registration.sql',import.meta.url),'utf8');
 assert.match(sql,/security definer/);
 assert.match(sql,/uc_investor_capital\(p_actor,'fund_car'/);
 assert.match(sql,/'fund_'\|\|md5\(p_actor\|\|':'\|\|req\)/);
 assert.match(sql,/jsonb_populate_record\(null::public\.cars/);
 assert.match(sql,/prior\.payload is distinct from p_data then raise exception 'REQUEST_CHANGED'/);
 assert.match(sql,/grant execute on function public\.uc_register_investor_car\(text,jsonb\) to service_role/);
 assert.doesNotMatch(sql,/journal_entries|uc_post_journal|insert into (public\.)?payments/);
 for(const col of ['investor_id','investor_split','consignment','trade_in_source_car_id','final_deal','settlement_amount','investor_funded\''])assert.doesNotMatch(sql.match(/allowed text\[\]:=array\[[^\]]+\]/)[0],new RegExp(`'${col}`));
});
