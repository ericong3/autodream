import {test} from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {transformSync} from 'esbuild';
import {handleSales} from '../server/sales/core.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example';
const plain=v=>JSON.parse(JSON.stringify(v));
const compile=(file,require,globals)=>{const module={exports:{}};vm.runInNewContext(transformSync(readFileSync(new URL(file,import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,require,...globals});return module.exports;};

// Fake database mirroring uc_record_investor_misc: replay by requestId, one bill per (car, miscId).
function fixture({role='director',access='both'}={}){
 const user={id:'private-user',username:'staff',name:'Sample',password:bcrypt.hashSync('sample-password',4),role,business_access:access,enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[],commands=new Map(),bills=new Map();let fail=null;
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},
  rpc:async(fn,args)=>{calls.push({fn,args:plain(args)});
   if(fn!=='uc_record_investor_misc')return {data:{ok:true}};
   if(fail)return {error:{message:fail}};
   const d=args.p_data,cmd=JSON.stringify(d),prior=commands.get(d.requestId);
   if(prior){if(prior.cmd!==cmd)return {error:{message:'REQUEST_CHANGED'}};return {data:{...prior.result,alreadyRecorded:true}};}
   const key=d.carId+':'+d.miscId,{requestId,...detail}=d;let result;
   if(bills.has(key)){if(JSON.stringify(bills.get(key).detail)!==JSON.stringify(detail))return {error:{message:'MISC_CHANGED_REVIEW_REQUIRED'}};result={...bills.get(key).result,alreadyRecorded:true};}
   else{result={carId:d.carId,misc:{id:d.miscId,description:d.purpose,amount:d.amountCents/100,merchant:d.payee,...(d.category?{category:d.category}:{}),createdAt:'2026-11-04T01:02:03.000Z',createdBy:args.p_actor},billId:'bill-'+(bills.size+1),alreadyRecorded:false};bills.set(key,{detail,result});}
   commands.set(d.requestId,{cmd,result});return {data:result};}};
 const deps={env:{USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',USED_CAR_INVESTOR_CARS_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie)=>({method:'POST',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:typeof body==='string'?body:JSON.stringify(body)});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'sample-password'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 const sales=async(body,cookie)=>{const r=await handleSales(req(body,cookie),deps);return {...r,body:JSON.parse(r.body)};};
 return {deps,calls,bills,login,sales,req,user,setFail:m=>{fail=m;}};
}
const misc=(extra={})=>({scope:'investor_finance',action:'record_misc',carId:'car_0001',miscId:'misc_0001',amountCents:12550,purpose:'Car wash',payee:'Shine Auto',requestId:'request_misc_0001',...extra});

test('sales router sends investor_finance record_misc to the misc handler only',async()=>{
 const w=fixture(),cookie=await w.login();
 const r=await w.sales(misc(),cookie);
 assert.equal(r.status,200);assert.equal(r.body.billId,'bill-1');assert.equal(r.body.misc.createdBy,w.user.id);
 assert.deepEqual(w.calls.map(c=>c.fn),['uc_record_investor_misc']);assert.equal(w.calls[0].args.p_actor,w.user.id);
 // Misc handler validation (not the capital handler or Garage sales) answers malformed record_misc bodies.
 const noRef=await w.sales(misc({requestId:undefined}),cookie);assert.equal(noRef.status,400);assert.equal(noRef.body.error.message,'A save reference is required.');
 assert.equal((await w.sales(misc({actor:'someone-else'}),cookie)).status,400);
 assert.equal(w.calls.length,1);
 // Other investor actions still reach the capital handler; record_misc is never sent there.
 await w.sales({scope:'investor_finance',action:'snapshot'},cookie);
 assert.ok(w.calls.slice(1).every(c=>c.fn!=='uc_record_investor_misc'));
});
test('record_misc through the router keeps the misc role gate and rollout flags',async()=>{
 for(const [role,access] of [['shareholder','both'],['garage_head','both'],['admin','garage']]){const w=fixture({role,access}),c=await w.login();assert.equal((await w.sales(misc(),c)).status,403,role+'/'+access);assert.equal(w.calls.length,0);}
 const w=fixture(),c=await w.login();w.deps.env.USED_CAR_INVESTOR_CARS_ONLINE='0';
 assert.equal((await w.sales(misc(),c)).status,503);assert.equal(w.calls.length,0);
 assert.equal((await fixture().sales(misc())).status,401);
});

// Client: real investorFinance.ts sendMutation over a fetch that calls the real sales router.
async function client(w,{loseReply=()=>false}={}){
 const cookie=await w.login(),store=new Map(),fetches=[];
 const fetch=async(url,init)=>{assert.equal(url,'/api/garage/sales');fetches.push(JSON.parse(init.body));
  const r=await handleSales(w.req(init.body,cookie),w.deps);
  if(loseReply(fetches.length))throw new TypeError('Failed to fetch');
  return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>JSON.parse(r.body)};};
 const globals={fetch,crypto:globalThis.crypto,sessionStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}};
 const finance=compile('../src/lib/investorFinance.ts',n=>n==='react'?{useCallback:f=>f,useEffect:()=>{},useRef:v=>({current:v}),useState:v=>[v,()=>{}]}:{},globals);
 const helper=compile('../src/utils/completeInvestorMisc.ts',n=>n.includes('investorFinance')?finance:{},globals);
 const effects=[];
 const legacy={addMiscCost:async()=>effects.push('public-update'),addPayment:async()=>effects.push('payment'),addJournalEntry:async()=>effects.push('journal'),updateCar:async()=>effects.push('public-update')};
 const base={car:{id:'car_0001',investorFunded:true},miscId:'misc_0001',amount:125.5,purpose:' Car wash ',payee:'Shine Auto',category:'',currentUserId:w.user.id,...legacy,applySaved:(actor,saved)=>effects.push(['apply',actor,plain(saved)])};
 return {fetches,effects,finance,helper,pending:()=>plain(finance.readPending(w.user.id)),record:opts=>helper.recordInvestorMiscCost({...base,...opts})};
}

test('investor misc save makes one private request, applies the saved row and writes nothing public',async()=>{
 const w=fixture(),c=await client(w);
 const saved=plain(await c.record({}));
 assert.equal(c.fetches.length,1);
 const {requestId,...sent}=c.fetches[0];assert.match(requestId,/^[A-Za-z0-9_-]{16,80}$/);
 assert.deepEqual(sent,{scope:'investor_finance',action:'record_misc',carId:'car_0001',miscId:'misc_0001',amountCents:12550,purpose:'Car wash',payee:'Shine Auto'});
 assert.equal(saved.billId,'bill-1');assert.equal(saved.alreadyRecorded,false);
 assert.deepEqual(c.effects,[['apply',w.user.id,saved]]);
 assert.deepEqual(c.pending(),[]);assert.equal(w.bills.size,1);
});
test('a lost reply keeps the original; edited values are refused and retry resends it exactly once-recorded',async()=>{
 const w=fixture(),c=await client(w,{loseReply:n=>n===1});
 await assert.rejects(c.record({}),/Connection lost/);
 assert.deepEqual(c.effects,[]);assert.equal(w.bills.size,1);
 const [kept]=c.pending();assert.equal(kept.slot,'misc-record:car_0001');assert.equal(kept.action,'record_misc');
 // A fresh save with edited details (or a new miscId) is blocked while the first is unconfirmed.
 await assert.rejects(c.record({amount:999,miscId:'misc_0002'}),e=>e.code==='PENDING');
 assert.equal(c.fetches.length,1);
 // Retry ignores the edited form and resends the identical payload with the same reference.
 const saved=plain(await c.record({retryOriginal:true,amount:999,miscId:'misc_0009',payee:'Someone else'}));
 assert.equal(c.fetches.length,2);assert.deepEqual(c.fetches[1],c.fetches[0]);
 assert.equal(saved.alreadyRecorded,true);assert.equal(saved.billId,'bill-1');assert.equal(saved.misc.id,'misc_0001');assert.equal(saved.misc.amount,125.5);
 assert.deepEqual(c.effects,[['apply',w.user.id,saved]]);
 assert.equal(w.bills.size,1);assert.deepEqual(c.pending(),[]);
 await assert.rejects(c.record({retryOriginal:true}),/no unconfirmed cost save/);assert.equal(c.fetches.length,2);
});
test('company-funded cars, fractional cents and missing details never reach the server',async()=>{
 const w=fixture(),c=await client(w);
 await assert.rejects(c.record({car:{id:'car_0001'}}),/not investor-funded/);
 await assert.rejects(c.record({amount:1.234}),/2 decimal/);
 await assert.rejects(c.record({amount:0}),/2 decimal/);
 await assert.rejects(c.record({payee:'  '}),/who was paid/);
 await assert.rejects(c.record({purpose:''}),/what the cost was for/);
 await assert.rejects(c.record({miscId:'bad id'}),/Open the cost again/);
 assert.equal(c.fetches.length,0);assert.deepEqual(c.effects,[]);assert.deepEqual(c.pending(),[]);
});
test('a definite server refusal clears the reference and applies nothing; an uncertain one keeps it',async()=>{
 const w=fixture(),c=await client(w);
 w.setFail('boom');
 await assert.rejects(c.record({}),e=>e.code==='UNAVAILABLE'&&e.retryable===true);
 assert.equal(c.pending().length,1);assert.deepEqual(c.effects,[]);
 w.setFail('CAR_SETTLED_ADJUSTMENT_REQUIRED');
 await assert.rejects(c.record({retryOriginal:true}),e=>e.code==='CAR_SETTLED_ADJUSTMENT_REQUIRED'&&e.retryable===false);
 assert.deepEqual(c.pending(),[]);assert.deepEqual(c.effects,[]);assert.equal(w.bills.size,0);
});
