import test from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleSales} from '../server/sales/core.mjs';import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
const origin='https://app.example',choiceId='11111111-1111-4111-8111-111111111111',potId='22222222-2222-4222-8222-222222222222';
const unusedChoose=(extra={})=>({scope:'trade_in_funding',action:'choose',incomingCarId:'incoming',fundingKind:'company',requestId:'tradein_request_001',...extra});
function fixture(role='director'){
 const user={id:'real-director',name:'Director',username:'staff',password:bcrypt.hashSync('password-for-test',4),role,business_access:'both',enabled:true,registration_status:'active'},sessions=new Map(),calls=[];
 let result={data:{orderId:choiceId,carId:'car-own'}};
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},throttleHit:async()=>({allowed:true}),throttleClear:async()=>{},rpc:async(fn,args)=>{calls.push({fn,args});return result;}};
 const deps={env:{GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin,USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',USED_CAR_INVESTOR_CARS_ONLINE:'1'},repo:()=>repo,bcrypt};
 const req=(body,cookie,extra={})=>({method:'POST',body:JSON.stringify(body),headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{}),...extra}});
 const login=async()=>{const r=await handleAppSession(req({username:'staff',password:'password-for-test'}),deps);assert.equal(r.status,200);return [].concat(r.headers['Set-Cookie']).find(x=>x.startsWith(COOKIE_NAME+'=')&&!x.includes('Max-Age=0')).split(';')[0];};
 const run=async(body,cookie,extra)=>{const r=await handleSales(req(body,cookie,extra),deps);return {...r,body:JSON.parse(r.body)};};
 return {deps,repo,calls,login,run,setResult:r=>{result=r;}};
}

const receipt=(extra={})=>({scope:'investor_finance',action:'prepare_sale_receipt',carId:'car-own',amountCents:500000,bankAccountId:potId,bankReference:'Transfer 123',paidOn:'2026-11-05',requestId:'receipt_request_0001',...extra});
test('recovery route binds actor to private session and refuses unsafe sources',async()=>{
 const f=fixture();assert.equal((await f.run(receipt())).status,401);const c=await f.login();
 assert.notEqual((await f.run(receipt(),c,{origin:'https://evil.example'})).status,200);
 assert.notEqual((await f.run(receipt(),c,{'x-garage-building':''})).status,200);
 assert.equal((await f.run(receipt({actor:'other'}),c)).status,400);
 assert.equal((await f.run(receipt(),c)).status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].fn,'uc_investor_recoveries');assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const role of ['admin','investor','salesperson']){const o=fixture(role),oc=await o.login();assert.equal((await o.run(receipt(),oc)).status,403);assert.equal(o.calls.length,0);}
});
test('bank amount, deductions, excess customer and refund recipient are validated before SQL',async()=>{
 const f=fixture(),c=await f.login();
 for(const x of [{amountCents:-1},{amountCents:1.5},{amountCents:'500'},{paidOn:'2026-02-30'},{bankAccountId:'bank'},{bankReference:''},{requestId:'short'},{excessCents:100},{withheldBills:[{billId:choiceId,amountCents:0}]},{withheldBills:[{billId:choiceId,amountCents:1},{billId:choiceId,amountCents:1}]},{withheldBills:[{billId:choiceId,amountCents:1,paid:true}]}])assert.equal((await f.run(receipt(x),c)).status,400,JSON.stringify(x));
 assert.equal((await f.run({scope:'investor_finance',action:'prepare_customer_refund',carId:'car-own',customerId:'buyer',amountCents:100,bankName:'Bank',accountNumber:'123',accountHolder:'Buyer',requestId:'refund_request_00001'},c)).status,400);assert.equal(f.calls.length,0);
});
test('rollout, SQL conflicts and malformed responses never report a successful save',async()=>{
 const f=fixture(),c=await f.login();f.deps.env.USED_CAR_INVESTOR_CARS_ONLINE='0';assert.equal((await f.run(receipt(),c)).status,503);assert.equal(f.calls.length,0);f.deps.env.USED_CAR_INVESTOR_CARS_ONLINE='1';
 f.setResult({error:{message:'REFUND_EXCEEDS_BALANCE'}});assert.equal((await f.run(receipt(),c)).status,409);
 f.setResult({data:{}});assert.equal((await f.run(receipt(),c)).status,503);
 f.setResult({data:{carId:'wrong',orders:[],documents:[]}});assert.equal((await f.run({scope:'investor_finance',action:'sale_money_snapshot',carId:'car-own'},c)).status,503);
});
test('investor can only request owned snapshot or proof through ownership-checking RPC',async()=>{
 const f=fixture('investor'),c=await f.login();f.setResult({data:{carId:'car-own',orders:[],documents:[]}});
 assert.equal((await f.run({scope:'investor_finance',action:'sale_money_snapshot',carId:'car-own'},c)).status,200);
 assert.equal(f.calls[0].args.p_action,'snapshot');f.setResult({error:{message:'NOT_ALLOWED'}});
 assert.equal((await f.run({scope:'investor_finance',action:'sale_proof_url',documentId:choiceId},c)).status,403);
 assert.equal((await f.run({scope:'investor_finance',action:'sale_proof_upload',orderId:choiceId,fileName:'bank.pdf',mimeType:'application/pdf',base64:'eA=='},c)).status,403);
});

test('proof upload failure cannot confirm proof or post money; retry uses stable document request',async()=>{
 const f=fixture(),c=await f.login(),docId='33333333-3333-4333-8333-333333333333';
 const proof={scope:'investor_finance',action:'sale_proof_upload',orderId:choiceId,fileName:'bank.pdf',mimeType:'application/pdf',base64:Buffer.from('%PDF-1.4\nproof\n%%EOF').toString('base64')};
 f.setResult({data:{documentId:docId,path:'sale-money/test/bank.pdf',state:'prepared'}});
 f.repo.uploadInvestorProof=async()=>{throw Error('private storage failed');};
 assert.equal((await f.run(proof,c)).status,503);assert.deepEqual(f.calls.map(x=>x.args.p_action),['proof_prepare']);
 const original=f.calls[0].args.p_data.requestId;f.repo.uploadInvestorProof=async()=>{};
 assert.equal((await f.run(proof,c)).status,200);assert.equal(f.calls[1].args.p_data.requestId,original);assert.deepEqual(f.calls.map(x=>x.args.p_action),['proof_prepare','proof_prepare','proof_confirm']);
 assert.ok(!f.calls.some(x=>x.args.p_action==='post'));
});
