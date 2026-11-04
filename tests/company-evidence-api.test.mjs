import {test} from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleCompanyEvidence,isCompanyEvidenceRequest} from '../server/usedCar/companyEvidence.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
import {PROOF_MAX_BYTES} from '../server/usedCar/investorActivation.mjs';
import {handleSales} from '../server/sales/core.mjs';
const origin='https://app.example',docId='44444444-4444-4444-8444-444444444444',paymentId='pay-repair-1';
test('the hosted sales route serves private company documents',async()=>{
 const w=fixture(),cookie=await w.login();
 const result=await handleSales(w.req({scope,action:'list',paymentId},cookie),w.deps);
 assert.equal(result.status,200);assert.equal(w.calls[0].fn,'uc_company_evidence');
});
const scope='company_evidence',PNG=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4]);
const path='company-payments/'+'a'.repeat(64)+'/invoice-'+'b'.repeat(64)+'.png';
const meta={documentId:docId,kind:'invoice',fileName:'invoice.png',mimeType:'image/png',sizeBytes:12};
function fixture(role='director',access=role==='director'?'both':'used_car'){
 const user={id:'private-user',username:'staff',name:'Sample',password:bcrypt.hashSync('sample-password',4),role,business_access:access,enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[],keys=[],uploads=[];
 const rpcResult={prepare:{...meta,state:'prepared',path},confirm:{...meta,state:'confirmed',uploadedAt:'2026-11-04T00:00:00Z'},
  read:{documentId:docId,path,fileName:'invoice.png',mimeType:'image/png'},
  list:{paymentId,invoiceRequired:true,invoiceConfirmed:true,receiptConfirmed:false,documents:[{...meta,state:'confirmed',path,sha256:'b'.repeat(64)}]}};
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},
  throttleHit:async key=>{keys.push(key);return {allowed:true};},throttleClear:async()=>{},
  rpc:async(fn,args)=>{calls.push({fn,args});return {data:rpcResult[args.p_action]??{ok:true}};},
  uploadInvestorProof:async(p,bytes,mime)=>{uploads.push({path:p,bytes,mime});},investorProofUrl:async p=>'https://storage.example/signed/'+p};
 const deps={env:{USED_CAR_PRIVATE_FINANCE_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie)=>({method:'POST',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 const login=async()=>{const result=await handleAppSession(req({username:'staff',password:'sample-password'}),deps);assert.equal(result.status,200);return [].concat(result.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 const call=async(body,cookie)=>{const r=await handleCompanyEvidence(req(body,cookie),deps);return {...r,body:JSON.parse(r.body)};};
 return {repo,deps,calls,keys,uploads,call,login,user,rpcResult,req};
}
const upload=(extra={})=>({scope,action:'upload',paymentId,kind:'invoice',fileName:'invoice.png',mimeType:'image/png',base64:PNG.toString('base64'),requestId:'company_upload_0001',...extra});
const rpcs=(w,action)=>w.calls.filter(c=>c.args.p_action===action);

test('needs a private session; the session user is always the actor',async()=>{
 const w=fixture();assert.equal((await w.call({scope,action:'list',paymentId})).status,401);
 const cookie=await w.login();
 assert.equal((await w.call({scope,action:'list',paymentId,actor:'forged'},cookie)).status,400);
 assert.equal((await w.call({scope,action:'list',paymentId,p_actor:'forged'},cookie)).status,400);
 assert.equal(w.calls.length,0);
 assert.equal((await w.call({scope,action:'list',paymentId},cookie)).status,200);
 assert.equal(w.calls[0].fn,'uc_company_evidence');assert.equal(w.calls[0].args.p_actor,'private-user');assert.deepEqual(w.calls[0].args.p_data,{paymentId});
 assert.equal(isCompanyEvidenceRequest(w.req({scope,action:'list'})),true);assert.equal(isCompanyEvidenceRequest(w.req({scope:'private_finance'})),false);
});

test('scope, actions and fields are strict',async()=>{
 const w=fixture(),cookie=await w.login();
 for(const body of [{scope:'investor_finance',action:'list',paymentId},{action:'list',paymentId},{scope,action:'delete',paymentId},{scope,action:'prepare',paymentId},
  {scope,action:'open',documentId:'not-a-uuid'},{scope,action:'list',paymentId:''},{scope,action:'list',paymentId:'x'.repeat(181)},{scope,action:'list',paymentId:'a\nb'},
  upload({path:'../other'}),upload({url:'https://evil.example'}),upload({kind:'bill'}),upload({requestId:undefined}),upload({requestId:'short'}),upload({fileName:''})])
  assert.equal((await w.call(body,cookie)).status,400,JSON.stringify(body).slice(0,80));
 assert.equal(w.calls.length,0);assert.equal(w.uploads.length,0);
});

test('investors, Garage-only staff and unflagged deployments are refused before the database',async()=>{
 for(const [role,access] of [['investor','used_car'],['salesperson','garage']]){const w=fixture(role,access),cookie=await w.login();assert.equal((await w.call({scope,action:'list',paymentId},cookie)).status,403);assert.equal(w.calls.length,0);}
 const w=fixture(),cookie=await w.login();w.deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE='0';
 assert.equal((await w.call(upload(),cookie)).status,503);assert.equal((await w.call({scope,action:'list',paymentId},cookie)).status,503);
 assert.equal(w.calls.length,0);assert.equal(w.uploads.length,0);
});

test('staff may only send their own claim invoice; payment receipts are Director/admin',async()=>{
 const s=fixture('salesperson'),cookie=await s.login();
 assert.equal((await s.call(upload({kind:'payment'}),cookie)).status,403);assert.equal(s.calls.length,0);
 assert.equal((await s.call(upload(),cookie)).status,200);assert.equal(rpcs(s,'prepare')[0].args.p_data.kind,'invoice');
 s.repo.rpc=async()=>({error:{message:'NOT_ALLOWED'}});assert.equal((await s.call({scope,action:'open',documentId:docId},cookie)).status,403);
 const a=fixture('admin'),adminCookie=await a.login();
 assert.equal((await a.call(upload({kind:'payment'}),adminCookie)).status,200);
});

test('body limits: 4096 bytes normally, 2.1 MB only for uploads',async()=>{
 const w=fixture(),cookie=await w.login();
 assert.equal((await w.call({scope,action:'list',paymentId,pad:'x'.repeat(5000)},cookie)).status,413);
 assert.equal((await w.call({scope,action:'open',documentId:docId,pad:'x'.repeat(5000)},cookie)).status,413);
 const big=Buffer.concat([PNG,Buffer.alloc(PROOF_MAX_BYTES-PNG.length)]);
 assert.equal((await w.call(upload({base64:big.toString('base64')}),cookie)).status,200);
 const over=Buffer.concat([PNG,Buffer.alloc(PROOF_MAX_BYTES)]);
 assert.equal((await w.call(upload({base64:over.toString('base64')}),cookie)).status,400);
 assert.equal((await w.call(upload({base64:'x'.repeat(2_200_000)}),cookie)).status,413);
});

test('upload: signature check, storage before confirm, server path, no path returned',async()=>{
 const w=fixture(),cookie=await w.login();
 for(const bad of [{mimeType:'application/pdf'},{mimeType:'image/gif'},{base64:'not base64!'}])assert.equal((await w.call(upload(bad),cookie)).status,400);
 assert.equal(w.calls.length,0);
 const r=await w.call(upload({fileName:'../in\\voice.png'}),cookie);
 assert.equal(r.status,200);assert.equal(r.body.document.documentId,docId);assert.equal(r.body.document.state,'confirmed');
 assert.ok(!JSON.stringify(r.body).includes('company-payments/'));assert.equal(r.body.document.path,undefined);
 const prep=rpcs(w,'prepare')[0].args.p_data;
 assert.deepEqual(Object.keys(prep).sort(),['fileName','kind','mimeType','paymentId','requestId','sha256','sizeBytes']);
 assert.equal(prep.fileName,'..invoice.png');assert.equal(prep.sizeBytes,PNG.length);assert.match(prep.sha256,/^[0-9a-f]{64}$/);assert.equal(prep.requestId,'company_upload_0001');
 assert.equal(w.uploads[0].path,path);assert.equal(w.uploads[0].mime,'image/png');
 const order=w.calls.map(c=>c.args.p_action);assert.deepEqual(order,['prepare','confirm']);
 assert.deepEqual(rpcs(w,'confirm')[0].args.p_data,{documentId:docId});
});

test('upload retries: confirmed replays skip storage; a stored object from an earlier try still confirms',async()=>{
 const w=fixture(),cookie=await w.login();
 w.rpcResult.prepare={...w.rpcResult.confirm,path};
 const replay=await w.call(upload(),cookie);assert.equal(replay.status,200);assert.equal(w.uploads.length,0);assert.equal(rpcs(w,'confirm').length,0);
 assert.equal(replay.body.document.path,undefined);
 w.rpcResult.prepare={...meta,state:'prepared',path};
 w.repo.uploadInvestorProof=async()=>{throw new Error('The resource already exists');};
 assert.equal((await w.call(upload(),cookie)).status,200);
 const rpc=w.repo.rpc;w.repo.rpc=async(fn,args)=>args.p_action==='confirm'?{error:{message:'UPLOAD_MISSING storage detail'}}:rpc(fn,args);
 const failed=await w.call(upload(),cookie);assert.equal(failed.status,503);assert.equal(failed.body.error.code,'UNAVAILABLE');assert.ok(!JSON.stringify(failed.body).includes('detail'));
 delete w.repo.uploadInvestorProof;const n=w.calls.length;assert.equal((await w.call(upload(),cookie)).status,503);assert.equal(w.calls.length,n);
});

test('database refusals map to safe messages',async()=>{
 const w=fixture(),cookie=await w.login();
 const cases={REQUEST_CHANGED:409,PROOF_LIMIT:409,INVOICE_NOT_REQUIRED:409,CLAIM_LOCKED:409,RECEIPT_SAME_AS_INVOICE:409,USE_INVESTOR_CAR_BILLS:409,NOT_ALLOWED:403,INVALID:400};
 for(const [code,status] of Object.entries(cases)){
  w.repo.rpc=async()=>({error:{message:code+' secret-detail',code:'P0001'}});
  const r=await w.call(upload(),cookie);assert.equal(r.status,status,code);assert.ok(!JSON.stringify(r.body).includes('secret-detail'));
 }
 w.repo.rpc=async()=>{throw new Error('network secret');};
 const thrown=await w.call({scope,action:'list',paymentId},cookie);assert.equal(thrown.status,503);assert.ok(!JSON.stringify(thrown.body).includes('secret'));
});

test('open returns a short-lived https link for an authorised document only',async()=>{
 const w=fixture(),cookie=await w.login();
 const ok=await w.call({scope,action:'open',documentId:docId},cookie);
 assert.equal(ok.status,200);assert.ok(ok.body.url.startsWith('https://'));assert.equal(ok.body.name,'invoice.png');
 assert.deepEqual(rpcs(w,'read')[0].args.p_data,{documentId:docId});
 w.repo.investorProofUrl=async()=>'http://insecure.example/x';assert.equal((await w.call({scope,action:'open',documentId:docId},cookie)).status,503);
 w.repo.investorProofUrl=async()=>{throw new Error('storage secret');};const r=await w.call({scope,action:'open',documentId:docId},cookie);assert.equal(r.status,503);assert.ok(!JSON.stringify(r.body).includes('storage secret'));
 w.repo.rpc=async()=>({error:{message:'NOT_ALLOWED'}});let signed=0;w.repo.investorProofUrl=async()=>{signed++;return 'https://x';};
 assert.equal((await w.call({scope,action:'open',documentId:docId},cookie)).status,403);assert.equal(signed,0);
});

test('list returns safe document metadata only',async()=>{
 const w=fixture(),cookie=await w.login();
 const r=await w.call({scope,action:'list',paymentId},cookie);
 assert.equal(r.status,200);assert.equal(r.body.invoiceRequired,true);assert.equal(r.body.documents.length,1);
 assert.ok(!JSON.stringify(r.body).includes('company-payments/'));assert.equal(r.body.documents[0].sha256,undefined);
});

test('throttle keys fit the installed prefix rule and stay distinct per limit',async()=>{
 const w=fixture(),cookie=await w.login();
 await w.call(upload(),cookie);await w.call({scope,action:'list',paymentId},cookie);
 for(const key of w.keys)assert.match(key,/^[a-z]{1,8}:[A-Za-z0-9_-]{16,128}$/);
 assert.equal(new Set(w.keys.filter(k=>k.startsWith('compev:'))).size,2);
});
