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

const apply=(extra={})=>({scope:'trade_in_application',action:'apply',choiceId,documentId:potId,requestId:'tradein_apply_request_01',...extra});
test('trade-in application uses Director private session, strict source fields and rollout gates',async()=>{
 const f=fixture();assert.equal((await f.run(apply())).status,401);const c=await f.login();
 assert.notEqual((await f.run(apply(),c,{origin:'https://evil.example'})).status,200);assert.notEqual((await f.run(apply(),c,{'x-garage-building':''})).status,200);
 for(const extra of [{actor:'other'},{bankDeltaCents:1},{amountCents:1},{choiceId:'bad'},{documentId:'bad'},{requestId:'short'}])assert.equal((await f.run(apply(extra),c)).status,400);
 f.deps.env.USED_CAR_INVESTOR_CARS_ONLINE='0';assert.equal((await f.run(apply(),c)).status,503);assert.equal(f.calls.length,0);
 f.deps.env.USED_CAR_INVESTOR_CARS_ONLINE='1';f.setResult({data:{choice:{id:choiceId,financiallyApplied:true}}});assert.equal((await f.run(apply(),c)).status,200);assert.equal(f.calls[0].fn,'uc_apply_investor_trade_in');assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const role of ['admin','investor','salesperson']){const other=fixture(role),oc=await other.login();assert.equal((await other.run(apply(),oc)).status,403);assert.equal(other.calls.length,0);}
});
test('company and lender blockers do not pretend a trade-in was funded',async()=>{
 const f=fixture(),c=await f.login();for(const code of ['COMPANY_FUNDING_NOT_READY','LENDER_SETTLEMENT_NOT_READY','TRADE_IN_INVOICE_REQUIRED','INSUFFICIENT_FUNDING_POT']){f.setResult({error:{message:code}});assert.equal((await f.run(apply(),c)).status,409);}
 f.setResult({data:{choice:{id:choiceId,financiallyApplied:false}}});assert.equal((await f.run(apply(),c)).status,503);
 f.setResult({data:{choice:{id:potId,financiallyApplied:true}}});assert.equal((await f.run(apply(),c)).status,503);
});
test('trade-in proof is uploaded and confirmed before application, with no money action on upload failure',async()=>{
 const f=fixture(),c=await f.login();f.setResult({data:{documentId:potId,path:'trade-in/private/invoice.pdf',confirmed:false}});
 const proof={scope:'trade_in_application',action:'upload',choiceId,fileName:'invoice.pdf',mimeType:'application/pdf',base64:Buffer.from('%PDF-1.4\nproof\n%%EOF').toString('base64')};
 f.repo.uploadInvestorProof=async()=>{throw Error('storage failure');};assert.equal((await f.run(proof,c)).status,503);assert.deepEqual(f.calls.map(x=>x.args.p_action),['proof_prepare']);
 f.repo.uploadInvestorProof=async()=>{};assert.equal((await f.run(proof,c)).status,200);assert.deepEqual(f.calls.map(x=>x.args.p_action),['proof_prepare','proof_prepare','proof_confirm']);
});
test('investors request only authorised invoice links and never receive storage paths',async()=>{
 const f=fixture('investor'),c=await f.login();f.setResult({error:{message:'NOT_ALLOWED'}});const open={scope:'trade_in_application',action:'open',documentId:potId};assert.equal((await f.run(open,c)).status,403);
 f.setResult({data:{documentId:potId,path:'trade-in/private/invoice.pdf'}});f.repo.investorProofUrl=async()=> 'https://storage.example/signed/invoice';const r=await f.run(open,c);assert.equal(r.status,200);assert.deepEqual(r.body,{url:'https://storage.example/signed/invoice'});assert.equal(f.calls.at(-1).args.p_action,'proof_read');
});
