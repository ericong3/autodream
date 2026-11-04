import {test} from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {handlePrivateFinance,isPrivateFinanceRequest} from '../server/usedCar/privateFinance.mjs';
import {privateFinanceQuery} from '../server/usedCar/privateFinanceRepo.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example';
async function fixture(role,businessAccess='both'){
 const user={id:'private-user',username:'staff',name:'Sample',password:bcrypt.hashSync('sample-password',4),role,business_access:businessAccess,enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[];
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},privateFinance:async input=>{calls.push(input);return {data:[]};}};
 const deps={env:{USED_CAR_PRIVATE_FINANCE_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie)=>({method:'POST',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify({scope:'private_finance',...body})});
 const loginRequest=req({username:'staff',password:'sample-password'});loginRequest.body=JSON.stringify({username:'staff',password:'sample-password'});const login=await handleAppSession(loginRequest,deps);
 assert.equal(login.status,200);
 const cookie=[].concat(login.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];
 return {user,repo,deps,calls,run:async body=>{const r=await handlePrivateFinance(req(body,cookie),deps);return {...r,body:JSON.parse(r.body)};},req,cookie};
}
test('private finance requires a private session, strict table allowlist and rollout flag',async()=>{
 const f=await fixture('director'),body={table:'payments',operation:'select'};
 assert.equal((await handlePrivateFinance(f.req(body),f.deps)).status,401);
 for(const table of ['garage_building_staff','__proto__','cars'])assert.equal((await f.run({...body,table})).status,400);
 assert.equal((await f.run({...body,actor:'someone-else'})).status,400);
 f.deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE='0';assert.equal((await f.run(body)).status,503);assert.equal(f.calls.length,0);
 assert.equal(isPrivateFinanceRequest(f.req(body)),true);
});
test('investors cannot read shared finance and admin cannot read salary data',async()=>{
 const i=await fixture('investor');assert.equal((await i.run({table:'users',operation:'select'})).status,403);assert.equal(i.calls.length,0);
 const a=await fixture('admin');
 a.repo.privateFinance=async()=>({data:[{id:a.user.id,name:'Admin',password:'NEVER',basic_salary:9000},{id:'other',name:'Other',allowance:500}]});
 const users=await a.run({table:'users',operation:'select'});assert.equal(users.status,200);assert.deepEqual(users.body.data,[{id:a.user.id,name:'Admin'},{id:'other',name:'Other'}]);
 a.repo.privateFinance=async()=>({data:[{id:'salary',type:'salary'},{id:'claim',type:'expense_claim',recipient_id:'other'}]});
 assert.deepEqual((await a.run({table:'payments',operation:'select'})).body.data.map(x=>x.id),['claim']);
 a.repo.privateFinance=async()=>({data:[{user_id:a.user.id,amount:9000}]});
 assert.deepEqual((await a.run({table:'payslips',operation:'select'})).body.data,[]);
 assert.equal((await a.run({table:'payments',operation:'update',data:{status:'transferred'},filters:[{op:'eq',column:'id',value:'claim'}]})).status,403);
 assert.equal((await a.run({table:'bank_transactions',operation:'insert',data:{id:'statement'}})).status,403);
});
test('staff can see their own payslip but cannot forge salary, access rights or claim approval',async()=>{
 const f=await fixture('salesperson');
 f.repo.privateFinance=async()=>({data:[{user_id:'private-user',amount:2000},{user_id:'someone-else',amount:9000}]});
 assert.deepEqual((await f.run({table:'payslips',operation:'select'})).body.data,[{user_id:'private-user',amount:2000}]);
 for(const data of [{role:'director'},{password:'oops'},{basic_salary:9000}])assert.equal((await f.run({table:'users',operation:'update',data,filters:[{op:'eq',column:'id',value:f.user.id}]})).status,403);
 assert.equal((await f.run({table:'payments',operation:'insert',data:{type:'salary',recipient_id:f.user.id,status:'pending'}})).status,403);
 assert.equal((await f.run({table:'payments',operation:'update',data:{claim_confirmed_by:'forged'},filters:[{op:'eq',column:'id',value:'claim'}]})).status,403);
});
test('production query applies ownership and salary filters before pagination and mutation',async()=>{
 const calls=[];const q=new Proxy({}, {get:(_,key)=>key==='then'?(resolve)=>resolve({data:[]}):(...args)=>{calls.push([key,...args]);return q;}});
 const sb={from:table=>{calls.push(['from',table]);return q;}},policy={actorId:'real-actor',manager:false,director:false,admin:false,ownPayroll:true};
 await privateFinanceQuery(sb,{table:'payments',operation:'update',data:{receipt_url:'proof'},filters:[{op:'eq',column:'id',value:'other-claim'}],orders:[],range:[0,10],policy});
 assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='recipient_id'&&c[2]==='real-actor'));
 assert.ok(calls.some(c=>c[0]==='not'&&c[1]==='type'&&c[3].includes('salary')));
 calls.length=0;
 await privateFinanceQuery(sb,{table:'bank_transactions',operation:'select',filters:[],orders:[],range:[0,10],policy});
 assert.deepEqual(calls,[]);
 await privateFinanceQuery(sb,{table:'payslips',operation:'select',filters:[],orders:[],range:[0,10],policy});
 assert.ok(calls.findIndex(c=>c[0]==='eq'&&c[1]==='user_id')<calls.findIndex(c=>c[0]==='range'));
 calls.length=0;
 await privateFinanceQuery(sb,{table:'payments',operation:'select',filters:[],orders:[],range:[0,10],policy:{...policy,investorCommissions:true}});
 assert.ok(calls.some(c=>c[0]==='from'&&c[1]==='uc_private_payment_rows'));
 assert.ok(calls.findIndex(c=>c[0]==='eq'&&c[1]==='recipient_id')<calls.findIndex(c=>c[0]==='range'));
});

test('garage-only sessions cannot query Used Car finance or investor ledger data',async()=>{const g=await fixture('admin','garage');assert.equal((await g.run({table:'users',operation:'select'})).status,403);assert.equal(g.calls.length,0);const a=await fixture('admin');a.repo.privateFinance=async()=>({data:[{id:'private',source_type:'investor_finance',lines:[]},{id:'withdrawal',source_type:null,lines:[{accountId:'acct-investor-payable'}]},{id:'ordinary',source_type:null,lines:[{accountId:'acct-exp-general'}]}]});assert.deepEqual((await a.run({table:'journal_entries',operation:'select'})).body.data.map(r=>r.id),['ordinary']);});
