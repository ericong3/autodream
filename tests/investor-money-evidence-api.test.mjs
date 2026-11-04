import {test} from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';
import {handleInvestorMoneyEvidence,isInvestorMoneyEvidenceRequest,validatePaymentProof,moneyEvidenceError,PAYMENT_PROOF_FIELDS} from '../server/usedCar/investorMoneyEvidence.mjs';
import {handleAppSession,COOKIE_NAME} from '../server/garageBuilding/core.mjs';
import {PROOF_MAX_BYTES} from '../server/usedCar/investorActivation.mjs';
import {handleSales} from '../server/sales/core.mjs';
const origin='https://app.example',docId='44444444-4444-4444-8444-444444444444',withdrawalId='55555555-5555-4555-8555-555555555555',potId='66666666-6666-4666-8666-666666666666',carId='car-sample-1';
const scope='investor_money_evidence',PNG=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4]);
const path='investor-money/purchase/'+'a'.repeat(64)+'/invoice-'+'b'.repeat(64)+'.png';
test('the hosted sales route serves own investor money documents',async()=>{
 const w=fixture(),cookie=await w.login();
 const result=await handleSales(w.req({scope,action:'list',target:'purchase',carId},cookie),w.deps);
 assert.equal(result.status,200);assert.equal(w.calls[0].fn,'uc_investor_money_evidence');
});
const meta={documentId:docId,target:'purchase',carId,kind:'invoice',fileName:'invoice.png',mimeType:'image/png',sizeBytes:12,amountCents:5000000,used:false};
function fixture(role='director',access=role==='director'?'both':'used_car'){
 const user={id:'private-user',username:'staff',name:'Sample',password:bcrypt.hashSync('sample-password',4),role,business_access:access,enabled:true,registration_status:'active'};
 const sessions=new Map(),calls=[],keys=[],uploads=[];
 const rpcResult={prepare:{...meta,state:'prepared',path},confirm:{...meta,state:'confirmed',uploadedAt:'2026-11-04T00:00:00Z'},
  read:{documentId:docId,path,fileName:'invoice.png',mimeType:'image/png'},
  list:{target:'purchase',carId,amountCents:5000000,paid:false,invoiceConfirmed:true,receiptConfirmed:false,storagePath:path,documents:[{...meta,state:'confirmed',path,sha256:'b'.repeat(64)}]}};
 const repo={findUserByUsername:async()=>user,findUserById:async()=>user,createSession:async s=>sessions.set(s.tokenHash,s),findSession:async h=>sessions.get(h),touchSession:async()=>{},deleteSession:async h=>sessions.delete(h),deleteExpiredSessions:async()=>{},
  throttleHit:async key=>{keys.push(key);return {allowed:true};},throttleClear:async()=>{},
  rpc:async(fn,args)=>{calls.push({fn,args});return {data:rpcResult[args.p_action]??{ok:true}};},
  uploadInvestorProof:async(p,bytes,mime)=>{uploads.push({path:p,bytes,mime});},investorProofUrl:async p=>'https://storage.example/signed/'+p};
 const deps={env:{USED_CAR_INVESTOR_CAPITAL_ONLINE:'1',USED_CAR_INVESTOR_CARS_ONLINE:'1',GARAGE_BUILDING_ONLINE:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'not-real-service-key-123456789',GARAGE_SESSION_SECRET:'not-real-session-secret-123456789012345',GARAGE_ALLOWED_ORIGINS:origin},bcrypt,repo:()=>repo};
 const req=(body,cookie)=>({method:'POST',headers:{origin,'x-garage-building':'1','content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 const login=async()=>{const result=await handleAppSession(req({username:'staff',password:'sample-password'}),deps);assert.equal(result.status,200);return [].concat(result.headers['Set-Cookie']).find(c=>c.startsWith(COOKIE_NAME+'=')&&!c.includes('Max-Age=0')).split(';')[0];};
 const call=async(body,cookie)=>{const r=await handleInvestorMoneyEvidence(req(body,cookie),deps);return {...r,body:JSON.parse(r.body)};};
 return {repo,deps,calls,keys,uploads,call,login,user,rpcResult,req};
}
const upload=(extra={})=>({scope,action:'upload',target:'purchase',carId,kind:'invoice',fileName:'invoice.png',mimeType:'image/png',base64:PNG.toString('base64'),amountCents:5000000,requestId:'money_upload_00001',...extra});
const withdrawalUpload=(extra={})=>{const {carId:_,...rest}=upload({target:'withdrawal',withdrawalId,kind:'payment',amountCents:250000,...extra});return rest;};
const rpcs=(w,action)=>w.calls.filter(c=>c.args.p_action===action);

test('needs a private session; the session user is always the actor',async()=>{
 const w=fixture();assert.equal((await w.call({scope,action:'list',target:'purchase',carId})).status,401);
 const cookie=await w.login();
 for(const forged of [{actor:'forged'},{p_actor:'forged'},{path:'investor-money/x'}])
  assert.equal((await w.call({scope,action:'list',target:'purchase',carId,...forged},cookie)).status,400);
 assert.equal(w.calls.length,0);
 assert.equal((await w.call({scope,action:'list',target:'purchase',carId},cookie)).status,200);
 assert.equal(w.calls[0].fn,'uc_investor_money_evidence');assert.equal(w.calls[0].args.p_actor,'private-user');assert.deepEqual(w.calls[0].args.p_data,{target:'purchase',carId});
 assert.equal(isInvestorMoneyEvidenceRequest(w.req({scope,action:'list'})),true);assert.equal(isInvestorMoneyEvidenceRequest(w.req({scope:'company_evidence'})),false);
});

test('scope, actions, targets and fields are strict',async()=>{
 const w=fixture(),cookie=await w.login();
 for(const body of [{scope:'investor_finance',action:'list',target:'purchase',carId},{action:'list',target:'purchase',carId},{scope,action:'delete',target:'purchase',carId},
  {scope,action:'prepare',target:'purchase',carId},{scope,action:'open',documentId:'not-a-uuid'},{scope,action:'list',target:'purchase'},
  {scope,action:'list',target:'bill',carId},{scope,action:'list',target:'purchase',carId:'../x'},{scope,action:'list',target:'withdrawal',withdrawalId:'nope'},
  {scope,action:'list',target:'purchase',carId,withdrawalId},{scope,action:'list',target:'pot',potId,carId},
  upload({target:'pot',potId,carId:undefined}),upload({withdrawalId}),upload({kind:'receipt'}),upload({kind:'bill'}),withdrawalUpload({kind:'invoice'}),
  upload({amountCents:undefined}),upload({amountCents:0}),upload({amountCents:12.5}),upload({amountCents:'5000000'}),
  upload({requestId:undefined}),upload({requestId:'short'}),upload({fileName:''}),upload({url:'https://evil.example'}),upload({entryId:docId})])
  assert.equal((await w.call(body,cookie)).status,400,JSON.stringify(body).slice(0,90));
 assert.equal(w.calls.length,0);assert.equal(w.uploads.length,0);
});

test('Director uploads; investors list and open only; admin, staff and unflagged deployments never reach the database',async()=>{
 for(const [role,access] of [['admin','used_car'],['salesperson','used_car'],['mechanic','both'],['investor','garage']]){
  const w=fixture(role,access),cookie=await w.login();
  for(const body of [upload(),{scope,action:'list',target:'purchase',carId},{scope,action:'open',documentId:docId}])assert.equal((await w.call(body,cookie)).status,403,role);
  assert.equal(w.calls.length,0);assert.equal(w.uploads.length,0);
 }
 const i=fixture('investor'),own=await i.login();
 assert.equal((await i.call(upload(),own)).status,403);assert.equal((await i.call(withdrawalUpload(),own)).status,403);
 assert.equal(i.calls.length,0);assert.equal(i.uploads.length,0);
 assert.equal((await i.call({scope,action:'list',target:'pot',potId},own)).status,200);
 assert.equal((await i.call({scope,action:'open',documentId:docId},own)).status,200);
 assert.deepEqual(i.calls.map(c=>c.args.p_action),['list','read']);
 for(const flag of ['USED_CAR_INVESTOR_CAPITAL_ONLINE','USED_CAR_INVESTOR_CARS_ONLINE']){
  const w=fixture(),cookie=await w.login();w.deps.env[flag]='0';
  assert.equal((await w.call(upload(),cookie)).status,503);assert.equal((await w.call({scope,action:'list',target:'purchase',carId},cookie)).status,503);
  assert.equal(w.calls.length,0);assert.equal(w.uploads.length,0);
 }
});

test('body limits: 4096 bytes normally, 2.1 MB only for uploads',async()=>{
 const w=fixture(),cookie=await w.login();
 assert.equal((await w.call({scope,action:'list',target:'purchase',carId,pad:'x'.repeat(5000)},cookie)).status,413);
 assert.equal((await w.call({scope,action:'open',documentId:docId,pad:'x'.repeat(5000)},cookie)).status,413);
 const big=Buffer.concat([PNG,Buffer.alloc(PROOF_MAX_BYTES-PNG.length)]);
 assert.equal((await w.call(upload({base64:big.toString('base64')}),cookie)).status,200);
 const over=Buffer.concat([PNG,Buffer.alloc(PROOF_MAX_BYTES)]);
 assert.equal((await w.call(upload({base64:over.toString('base64')}),cookie)).status,400);
 assert.equal((await w.call(upload({base64:'x'.repeat(2_200_000)}),cookie)).status,413);
});

test('upload: signature check, storage before confirm, server path, bound amount, no path returned',async()=>{
 const w=fixture(),cookie=await w.login();
 for(const bad of [{mimeType:'application/pdf'},{mimeType:'image/gif'},{base64:'not base64!'}])assert.equal((await w.call(upload(bad),cookie)).status,400);
 assert.equal(w.calls.length,0);
 const r=await w.call(upload({fileName:'../in\\voice.png'}),cookie);
 assert.equal(r.status,200);assert.equal(r.body.document.documentId,docId);assert.equal(r.body.document.state,'confirmed');assert.equal(r.body.document.amountCents,5000000);
 assert.ok(!JSON.stringify(r.body).includes('investor-money/'));assert.equal(r.body.document.path,undefined);
 const prep=rpcs(w,'prepare')[0].args.p_data;
 assert.deepEqual(Object.keys(prep).sort(),['amountCents','carId','fileName','kind','mimeType','requestId','sha256','sizeBytes','target']);
 assert.equal(prep.fileName,'..invoice.png');assert.equal(prep.sizeBytes,PNG.length);assert.match(prep.sha256,/^[0-9a-f]{64}$/);assert.equal(prep.amountCents,5000000);
 assert.equal(w.uploads[0].path,path);assert.equal(w.uploads[0].mime,'image/png');
 assert.deepEqual(w.calls.map(c=>c.args.p_action),['prepare','confirm']);
 assert.deepEqual(rpcs(w,'confirm')[0].args.p_data,{documentId:docId});
 // Withdrawal receipts name the withdrawal only.
 await w.call(withdrawalUpload(),cookie);
 const wd=rpcs(w,'prepare')[1].args.p_data;
 assert.deepEqual(Object.keys(wd).sort(),['amountCents','fileName','kind','mimeType','requestId','sha256','sizeBytes','target','withdrawalId']);
 assert.equal(wd.target,'withdrawal');assert.equal(wd.kind,'payment');assert.equal(wd.withdrawalId,withdrawalId);
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
 // A prepare reply without a usable path is not trusted.
 w.repo.uploadInvestorProof=async()=>{};w.repo.rpc=async()=>({data:{documentId:docId,state:'prepared'}});
 assert.equal((await w.call(upload(),cookie)).status,503);
});

test('database refusals map to safe messages',async()=>{
 const w=fixture(),cookie=await w.login();
 const cases={REQUEST_CHANGED:409,PROOF_LIMIT:409,PROOF_AMOUNT_CHANGED:409,ALREADY_PAID:409,APPROVAL_REQUIRED:409,RECEIPT_SAME_AS_INVOICE:409,RECEIPT_USED_ELSEWHERE:409,NOT_ALLOWED:403,INVALID:400};
 for(const [code,status] of Object.entries(cases)){
  w.repo.rpc=async()=>({error:{message:code+' secret-detail',code:'P0001'}});
  const r=await w.call(upload(),cookie);assert.equal(r.status,status,code);assert.ok(!JSON.stringify(r.body).includes('secret-detail'));
 }
 w.repo.rpc=async()=>{throw new Error('network secret');};
 const thrown=await w.call({scope,action:'list',target:'purchase',carId},cookie);assert.equal(thrown.status,503);assert.ok(!JSON.stringify(thrown.body).includes('secret'));
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

test('list returns safe summary and document metadata only',async()=>{
 const w=fixture(),cookie=await w.login();
 const r=await w.call({scope,action:'list',target:'purchase',carId},cookie);
 assert.equal(r.status,200);assert.equal(r.body.invoiceConfirmed,true);assert.equal(r.body.receiptConfirmed,false);assert.equal(r.body.paid,false);assert.equal(r.body.documents.length,1);
 assert.ok(!JSON.stringify(r.body).includes('investor-money/'));assert.equal(r.body.documents[0].sha256,undefined);assert.equal(r.body.storagePath,undefined);
 await w.call({scope,action:'list',target:'withdrawal',withdrawalId},cookie);await w.call({scope,action:'list',target:'pot',potId},cookie);
 assert.deepEqual(rpcs(w,'list').map(c=>c.args.p_data),[{target:'purchase',carId},{target:'withdrawal',withdrawalId},{target:'pot',potId}]);
});

test('throttle keys fit the installed prefix rule and stay distinct per limit',async()=>{
 const w=fixture(),cookie=await w.login();
 await w.call(upload(),cookie);await w.call({scope,action:'list',target:'purchase',carId},cookie);
 for(const key of w.keys)assert.match(key,/^[a-z]{1,8}:[A-Za-z0-9_-]{16,128}$/);
 assert.equal(new Set(w.keys.filter(k=>k.startsWith('invmon:'))).size,2);
});

test('payment command helpers: required document IDs and safe error mapping',()=>{
 assert.deepEqual(PAYMENT_PROOF_FIELDS,{purchase_paid:['invoiceDocumentId','receiptDocumentId'],withdrawal_paid:['receiptDocumentId']});
 assert.throws(()=>validatePaymentProof('purchase_paid',{receiptDocumentId:docId}),e=>e.code==='PURCHASE_INVOICE_REQUIRED');
 assert.throws(()=>validatePaymentProof('purchase_paid',{invoiceDocumentId:docId}),e=>e.code==='PAYMENT_RECEIPT_REQUIRED');
 assert.throws(()=>validatePaymentProof('withdrawal_paid',{}),e=>e.code==='PAYMENT_RECEIPT_REQUIRED');
 assert.throws(()=>validatePaymentProof('withdrawal_paid',{receiptDocumentId:'x'}),e=>e.code==='INVALID');
 validatePaymentProof('purchase_paid',{invoiceDocumentId:docId,receiptDocumentId:docId});
 validatePaymentProof('capital_received',{});validatePaymentProof('pay_car_bill',{});
 for(const code of ['MONEY_PROOF_REQUIRED','PROOF_NOT_FOR_PAYMENT','PROOF_NOT_CONFIRMED','PROOF_ALREADY_USED','PURCHASE_INVOICE_REQUIRED']){
  const e=moneyEvidenceError({message:code+' internal detail'});assert.equal(e.code,code);assert.equal(e.status,409);assert.ok(!e.message.includes('internal'));
 }
 assert.equal(moneyEvidenceError({message:'INSUFFICIENT_FUNDS'}),null);
});
