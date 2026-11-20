import {test} from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleSales} from '../server/sales/core.mjs';
import {moneyError} from '../server/usedCar/moneyReceived.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example',scope='money_received',bankId='55555555-5555-4555-8555-555555555555',entryId='66666666-6666-4666-8666-666666666666';
const PNG=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4]);
function fixture(role='director'){
 const user={id:'private-user',username:'staff',name:'Sample',password:bcrypt.hashSync('sample-password',4),role,business_access:role==='director'?'both':'used_car',enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[],uploads=[];
 const results={record:{entry:{id:entryId,amountCents:100}},list:{entries:[]},summary:{cars:{}},slip_prepare:{path:'money-received/'+entryId+'/'+'a'.repeat(64)+'.png'},slip_confirm:{entry:{id:entryId,hasSlip:true}},slip_read:{path:'money-received/x.png',fileName:'x.png'}};
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},
  throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},
  rpc:async(fn,args)=>{calls.push({fn,args});return {data:results[args.p_action]};},
  uploadInvestorProof:async(p,bytes,mime)=>{uploads.push({path:p,bytes,mime});},investorProofUrl:async p=>'https://storage.example/signed/'+p};
 const deps={env:{USED_CAR_PRIVATE_FINANCE_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie)=>({method:'POST',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'sample-password'}),deps);assert.equal(r.status,200,r.body);return [].concat(r.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 const call=async(body,cookie)=>{const r=await handleSales(req(body,cookie),deps);return {...r,body:JSON.parse(r.body)};};
 return {calls,uploads,call,login,results};
}
const record=(extra={})=>({scope,action:'record',carId:'car-1',amountCents:5320000,receivedOn:'2026-11-20',bankAccountId:bankId,requestId:'money_request_000001',...extra});

test('Director records money received with only amount, date and bank',async()=>{
 const f=fixture(),c=await f.login();
 const out=await f.call(record(),c);
 assert.equal(out.status,200);assert.equal(out.body.entry.id,entryId);
 assert.equal(f.calls[0].fn,'uc_money_received_action');assert.equal(f.calls[0].args.p_actor,'private-user');
 assert.deepEqual(f.calls[0].args.p_data,{carId:'car-1',amountCents:5320000,receivedOn:'2026-11-20',bankAccountId:bankId,requestId:'money_request_000001'});
});
test('admin cannot record money, but can list and add a slip; bad input never reaches the database',async()=>{
 const a=fixture('admin'),c=await a.login();
 assert.equal((await a.call(record(),c)).status,403);assert.equal(a.calls.length,0);
 assert.equal((await a.call({scope,action:'summary'},c)).status,200);
 const slip=await a.call({scope,action:'slip',id:entryId,fileName:'slip.png',mimeType:'image/png',base64:PNG.toString('base64')},c);
 assert.equal(slip.status,200);assert.equal(a.uploads.length,1);assert.ok(a.uploads[0].path.startsWith('money-received/'));
 assert.deepEqual(a.calls.map(x=>x.args.p_action),['summary','slip_prepare','slip_confirm']);
 const d=fixture(),dc=await d.login();
 for(const bad of [{amountCents:0},{amountCents:1.5},{receivedOn:'20-11-2026'},{bankAccountId:'x'},{requestId:'short'},{extra:true}])assert.equal((await d.call(record(bad),dc)).status,400);
 assert.equal(d.calls.length,0);
 const s=fixture('salesperson'),sc=await s.login();
 assert.equal((await s.call({scope,action:'summary'},sc)).status,403);
});
test('database refusals become plain messages',()=>{
 for(const [code,status] of [['DUPLICATE_REFERENCE',409],['INVALID_DATE',400],['BANK_REQUIRED',400],['NOT_ALLOWED',403]]){const e=moneyError({message:code});assert.equal(e.status,status);assert.equal(e.code,code);}
 assert.match(moneyError({message:'SOMETHING_NEW'}).message,/SOMETHING_NEW/);
});
