import {test} from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleInvestorCapital} from '../server/usedCar/investorCapital.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
import {inviteSecrets,decodeProof,PROOF_MAX_BYTES} from '../server/usedCar/investorActivation.mjs';
const origin='https://app.example',potId='11111111-1111-4111-8111-111111111111',billId='22222222-2222-4222-8222-222222222222',bankId='33333333-3333-4333-8333-333333333333',docId='44444444-4444-4444-8444-444444444444';
const scope='investor_finance',PNG=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4]);
function fixture(role='director'){
 const user={id:'private-user',username:'staff',name:'Sample',password:bcrypt.hashSync('sample-password',4),role,business_access:'both',enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[],keys=[],uploads=[];
 const rpcResult={proof_prepare:{documentId:docId,path:'investor/bill/'+docId+'.png',state:'pending'},proof_read:{path:'investor/bill/'+docId+'.png',fileName:'slip.png'},invite_investor:{potId,expiresAt:'2026-11-11T00:00:00Z'}};
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},
  throttleHit:async key=>{keys.push(key);return {allowed:true};},throttleClear:async()=>{},
  rpc:async(fn,args)=>{calls.push({fn,args});return {data:rpcResult[args.p_action]??{ok:true}};},
  uploadInvestorProof:async(path,bytes,mime)=>{uploads.push({path,bytes,mime});},investorProofUrl:async path=>'https://storage.example/signed/'+path};
 const deps={env:{USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',USED_CAR_INVESTOR_CARS_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',AUTH_INVITES_ENABLED:'1',AUTH_PUBLIC_ORIGIN:origin+'/',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie)=>({method:'POST',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 const login=async()=>{const result=await handleAppSession(req({username:'staff',password:'sample-password'}),deps);assert.equal(result.status,200);return [].concat(result.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 const call=async(body,cookie)=>{const r=await handleInvestorCapital(req(body,cookie),deps);return {...r,body:JSON.parse(r.body)};};
 return {repo,deps,calls,keys,uploads,call,login,user,rpcResult};
}
const proof=(extra={})=>({scope,action:'proof_upload',billId,kind:'bill',fileName:'slip.png',mimeType:'image/png',base64:PNG.toString('base64'),...extra});

test('scoped requests need a private session; unknown scope and actor overrides are refused',async()=>{
 const w=fixture();assert.equal((await w.call({scope,action:'banks'})).status,401);
 const cookie=await w.login();
 assert.equal((await w.call({scope:'other',action:'banks'},cookie)).status,400);
 assert.equal((await w.call({scope,action:'banks',actor:'forged'},cookie)).status,400);
 assert.equal((await w.call({scope,action:'link_account',potId,staffId:'x',requestId:'request_sample_0001'},cookie)).status,400);
 assert.equal((await w.call({scope,action:'banks'},cookie)).status,200);
 assert.equal(w.calls.length,1);assert.equal(w.calls[0].fn,'uc_investor_activation');assert.equal(w.calls[0].args.p_actor,'private-user');
});

test('roles: investor, shareholder and salesperson cannot use activation; admin limited to bill evidence',async()=>{
 for(const role of ['investor','shareholder','salesperson']){const w=fixture(role),cookie=await w.login();const r=await w.call({scope,action:'banks'},cookie);assert.equal(r.status,403);assert.equal(w.calls.length,0);}
 const a=fixture('admin'),cookie=await a.login();
 for(const body of [{scope,action:'banks'},{scope,action:'save_bank',name:'Bank',openingDate:'2026-01-01',openingCents:0,requestId:'request_sample_0001'},{scope,action:'invite_investor',potId,requestId:'request_sample_0001'}])assert.equal((await a.call(body,cookie)).status,403);
 assert.equal((await a.call({scope,action:'capital_received',potId,amountCents:100,paidOn:'2026-01-01',bankAccountId:bankId,bankReference:'r',requestId:'request_sample_0001'},cookie)).status,403);
 assert.equal(a.calls.length,0);
 assert.equal((await a.call(proof(),cookie)).status,200);
 assert.equal((await a.call(proof({kind:'payment',entryId:billId}),cookie)).status,200);
 assert.equal((await a.call({scope,action:'car_billing_list'},cookie)).status,200);
});

test('investor document links are authorised by the database without granting upload access',async()=>{
 const w=fixture('investor'),cookie=await w.login();
 assert.equal((await w.call({scope,action:'proof_url',documentId:docId},cookie)).status,200);
 assert.equal(w.calls[0].args.p_actor,w.user.id);
 assert.equal(w.calls[0].args.p_action,'proof_read');
 assert.equal((await w.call(proof(),cookie)).status,403);
 w.repo.rpc=async()=>({error:{message:'NOT_ALLOWED'}});
 assert.equal((await w.call({scope,action:'proof_url',documentId:billId},cookie)).status,403);
});

test('staff claim invoices use the narrow ownership RPC and never grant payment proof access',async()=>{
 const w=fixture('salesperson'),cookie=await w.login();
 assert.equal((await w.call(proof(),cookie)).status,200);
 assert.ok(w.calls.every((c)=>c.fn==='uc_staff_claim_proof'));
 w.calls.length=0;
 assert.equal((await w.call(proof({kind:'receipt'}),cookie)).status,403);
 assert.equal((await w.call(proof({kind:'payment',entryId:billId}),cookie)).status,403);
 assert.equal(w.calls.length,0);
 w.repo.rpc=async()=>({error:{message:'NOT_ALLOWED'}});
 assert.equal((await w.call({scope,action:'proof_url',documentId:docId},cookie)).status,403);
});

test('scoped money actions use a registered bank ID and route to uc_investor_capital',async()=>{
 const w=fixture(),cookie=await w.login(),body={scope,action:'capital_received',potId,amountCents:10000,paidOn:'2026-01-02',bankReference:'ref-1',requestId:'request_sample_0002'};
 assert.equal((await w.call({...body,bankAccount:'Maybank'},cookie)).status,400);
 assert.equal((await w.call(body,cookie)).status,400);
 assert.equal((await w.call({...body,bankAccountId:'not-a-uuid'},cookie)).status,400);
 assert.equal(w.calls.length,0);
 assert.equal((await w.call({...body,bankAccountId:bankId},cookie)).status,200);
 assert.equal(w.calls[0].fn,'uc_investor_capital');assert.equal(w.calls[0].args.p_data.bankAccountId,bankId);assert.ok(!('scope' in w.calls[0].args.p_data));
 w.repo.rpc=async()=>({error:{message:'BEFORE_BANK_OPENING detail'}});
 const r=await w.call({...body,bankAccountId:bankId},cookie);assert.equal(r.status,400);assert.equal(r.body.error?.code??r.body.code,'BEFORE_BANK_OPENING');
});

test('rollout flags: capital flag gates all scoped actions, cars flag gates car evidence',async()=>{
 const w=fixture(),cookie=await w.login();
 w.deps.env.USED_CAR_INVESTOR_CARS_ONLINE='0';
 assert.equal((await w.call(proof(),cookie)).status,503);assert.equal((await w.call({scope,action:'fundable_cars'},cookie)).status,503);
 assert.equal((await w.call({scope,action:'banks'},cookie)).status,200);
 w.deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE='0';assert.equal((await w.call({scope,action:'banks'},cookie)).status,503);
 assert.equal(w.calls.length,1);assert.equal(w.uploads.length,0);
});

test('body limits: 4096 bytes normally, 2.1 MB only for scoped proof uploads',async()=>{
 const w=fixture(),cookie=await w.login();
 assert.equal((await w.call({scope,action:'banks',pad:'x'.repeat(5000)},cookie)).status,413);
 assert.equal((await w.call({action:'snapshot',potId,pad:'x'.repeat(5000)},cookie)).status,413);
 const big=Buffer.concat([PNG,Buffer.alloc(PROOF_MAX_BYTES-PNG.length)]);
 assert.equal((await w.call(proof({base64:big.toString('base64')}),cookie)).status,200);
 const over=Buffer.concat([PNG,Buffer.alloc(PROOF_MAX_BYTES)]);
 assert.equal((await w.call(proof({base64:over.toString('base64')}),cookie)).status,400);
});

test('proof uploads check signatures, use the server path and retry idempotently',async()=>{
 const w=fixture(),cookie=await w.login();
 assert.equal((await w.call(proof({mimeType:'application/pdf'}),cookie)).status,400);
 assert.equal((await w.call(proof({mimeType:'image/gif'}),cookie)).status,400);
 assert.equal((await w.call(proof({base64:'not base64!'}),cookie)).status,400);
 assert.equal((await w.call(proof({path:'../other'}),cookie)).status,400);
 assert.equal(w.calls.length,0);
 assert.throws(()=>decodeProof('image/png',PNG.toString('base64').replace(/=*$/,'')+'A='));
 const first=await w.call(proof({fileName:'../sl\\ip.png'}),cookie);assert.equal(first.status,200);assert.equal(first.body.documentId,docId);
 const prep=w.calls.find(c=>c.args.p_action==='proof_prepare');assert.equal(prep.args.p_data.fileName,'..slip.png');assert.equal(prep.args.p_data.sizeBytes,PNG.length);assert.match(prep.args.p_data.sha256,/^[0-9a-f]{64}$/);
 assert.equal(w.uploads[0].path,w.rpcResult.proof_prepare.path);assert.equal(w.uploads[0].mime,'image/png');
 assert.ok(w.calls.some(c=>c.args.p_action==='proof_confirm'&&c.args.p_data.documentId===docId));
 await w.call(proof({fileName:'../sl\\ip.png'}),cookie);
 const preps=w.calls.filter(c=>c.args.p_action==='proof_prepare');assert.equal(preps[0].args.p_data.requestId,preps[1].args.p_data.requestId);
 w.rpcResult.proof_prepare={...w.rpcResult.proof_prepare,state:'confirmed'};const n=w.uploads.length;
 assert.equal((await w.call(proof(),cookie)).status,200);assert.equal(w.uploads.length,n);
 w.repo.uploadInvestorProof=async()=>{throw new Error('storage secret');};w.rpcResult.proof_prepare={...w.rpcResult.proof_prepare,state:'pending'};
 const failed=await w.call(proof(),cookie);assert.equal(failed.status,503);assert.ok(!JSON.stringify(failed.body).includes('storage secret'));
 delete w.repo.uploadInvestorProof;assert.equal((await w.call(proof(),cookie)).status,503);
});

test('bill payments require a receipt and accept a confirmed receipt reference',async()=>{
 const w=fixture(),cookie=await w.login();
 const body={scope,action:'pay_car_bill',carId:'car_1',billId,amountCents:100,bankAccountId:bankId,bankReference:'ref-123',paidOn:'2026-11-04',requestId:'request_receipt_001'};
 assert.equal((await w.call(body,cookie)).status,400);assert.equal(w.calls.length,0);
 const uploaded=await w.call(proof({kind:'receipt'}),cookie);
 assert.equal(uploaded.status,200);
 assert.equal(w.calls[0].args.p_data.kind,'receipt');assert.equal(w.calls[0].args.p_data.entryId,undefined);
 assert.equal((await w.call({...body,receiptDocumentId:docId},cookie)).status,200);
 assert.equal(w.calls.at(-1).args.p_data.receiptDocumentId,docId);
 w.repo.rpc=async()=>({error:{message:'SUPPLIER_INVOICE_REQUIRED'}});
 const refused=await w.call({...body,receiptDocumentId:docId},cookie);
 assert.equal(refused.status,409);assert.match(refused.body.error.message,/supplier invoice/i);
});

test('proof URLs require https and owned documents',async()=>{
 const w=fixture(),cookie=await w.login();
 assert.equal((await w.call({scope,action:'proof_url',documentId:'x'},cookie)).status,400);
 const ok=await w.call({scope,action:'proof_url',documentId:docId},cookie);assert.equal(ok.status,200);assert.ok(ok.body.url.startsWith('https://'));
 w.repo.investorProofUrl=async()=>'http://insecure.example/x';assert.equal((await w.call({scope,action:'proof_url',documentId:docId},cookie)).status,503);
 w.repo.rpc=async()=>({error:{message:'NOT_ALLOWED'}});assert.equal((await w.call({scope,action:'proof_url',documentId:docId},cookie)).status,403);
});

test('invitation links are deterministic, hashed in the database and cannot be overridden',async()=>{
 const a=inviteSecrets('s'.repeat(40),'actor','request_sample_0003',potId),b=inviteSecrets('s'.repeat(40),'actor','request_sample_0003',potId.toUpperCase());
 assert.deepEqual(a,b);assert.notEqual(a.token,inviteSecrets('s'.repeat(40),'actor','request_sample_0004',potId).token);
 const w=fixture(),cookie=await w.login(),body={scope,action:'invite_investor',potId,requestId:'request_sample_0003'};
 for(const extra of [{token:'x'.repeat(64)},{tokenHash:'x'},{invitationId:'x'},{link:'https://evil.example'}])assert.equal((await w.call({...body,...extra},cookie)).status,400);
 assert.equal(w.calls.length,0);
 const one=await w.call(body,cookie),two=await w.call(body,cookie);assert.equal(one.status,200);assert.equal(one.body.link,two.body.link);
 assert.ok(one.body.link.startsWith(origin+'/#/account/register?token='));
 const token=new URL(one.body.link.replace('#/','')).searchParams.get('token');const sent=w.calls[0].args.p_data;
 assert.notEqual(sent.tokenHash,token);assert.ok(!JSON.stringify(w.calls).includes(token));
 w.deps.env.AUTH_INVITES_ENABLED='0';const n=w.calls.length;assert.equal((await w.call(body,cookie)).status,503);assert.equal(w.calls.length,n);
});

test('throttle keys fit the installed prefix rule and stay distinct per limit',async()=>{
 const w=fixture(),cookie=await w.login();
 await w.call({scope,action:'invite_investor',potId,requestId:'request_sample_0005'},cookie);await w.call(proof(),cookie);
 for(const key of w.keys)assert.match(key,/^[a-z]{1,8}:[A-Za-z0-9_-]{16,128}$/);
 assert.equal(new Set(w.keys.filter(k=>k.startsWith('invest:'))).size,3);
});

test('save_bank validates name, real dates and save references',async()=>{
 const w=fixture(),cookie=await w.login(),body={scope,action:'save_bank',name:'  Company   Bank ',openingDate:'2026-02-28',openingCents:0,requestId:'request_sample_0006'};
 for(const bad of [{openingDate:'2026-02-30'},{openingCents:-1},{openingCents:1.5},{name:'x'},{requestId:'short'}])assert.equal((await w.call({...body,...bad},cookie)).status,400);
 assert.equal(w.calls.length,0);
 assert.equal((await w.call(body,cookie)).status,200);assert.equal(w.calls[0].args.p_data.name,'Company Bank');
 w.repo.rpc=async()=>({error:{code:'23505',message:'dup'}});assert.equal((await w.call(body,cookie)).status,409);
});
