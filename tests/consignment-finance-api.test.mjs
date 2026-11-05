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


const enabled=f=>{f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='1';f.deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE='1';return f;};
test('sending company stock to a dealer uses private session and current source, not supplied ownership fields',async()=>{
 const f=enabled(fixture()),c=await f.login(),data={scope:'outgoing_collections',carId:'company-car',dealer:'Dealer',amountCents:6000000,soldOn:'2026-11-05'};
 f.setResult({data:{carId:'company-car',sourceRevision:'a'.repeat(32)}});assert.equal((await f.run({...data,action:'prepare_send'},c)).status,200);assert.equal(f.calls[0].fn,'uc_outgoing_send');
 const save={...data,action:'send',expectedRevision:'a'.repeat(32),requestId:'outgoing_send_0001'};f.setResult({data:{carId:'company-car',car:{id:'company-car'},payments:[],journals:[]}});assert.equal((await f.run(save,c)).status,200);assert.equal(f.calls[1].args.p_actor,'real-director');
 for(const change of [{investorId:'other'},{amountCents:1.5},{soldOn:'2026-02-30'},{requestId:''}])assert.equal((await f.run({...save,...change},c)).status,400);
 const a=enabled(fixture('admin')),ac=await a.login();assert.equal((await a.run(save,ac)).status,403);assert.equal(a.calls.length,0);
 f.setResult({data:{carId:'other',car:{id:'other'},payments:[],journals:[]}});assert.equal((await f.run(save,c)).status,503);
});
test('outgoing collections require Director statement review without accepting supplied accounting totals',async()=>{
 const f=enabled(fixture()),c=await f.login(),body={scope:'outgoing_collections',action:'approve',paymentId:'outgoing-bill',expectedRevision:'a'.repeat(32),reviewConfirmed:true,requestId:'outgoing_approval_01'};
 f.setResult({data:{paymentId:'outgoing-bill',approved:true,costReviewPending:true,payments:[],journals:[]}});assert.equal((await f.run(body,c)).status,200);assert.equal(f.calls[0].fn,'uc_outgoing_collection');assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const change of [{reviewConfirmed:false},{sourceCostCents:1},{actor:'other'},{expectedRevision:'bad'}])assert.equal((await f.run({...body,...change},c)).status,400);
 for(const role of ['admin','shareholder','salesperson','investor']){const g=enabled(fixture(role)),gc=await g.login();assert.equal((await g.run(body,gc)).status,403);assert.equal(g.calls.length,0);}
 f.setResult({error:{message:'COLLECTION_HISTORY_REVIEW_REQUIRED'}});assert.equal((await f.run(body,c)).status,409);
});
test('outgoing final cost review validates invoice, source and explicit history acknowledgement',async()=>{
 const f=enabled(fixture()),c=await f.login(),body={scope:'outgoing_collections',action:'close_costs',paymentId:'outgoing-bill',expectedRevision:'a'.repeat(32),purchaseInvoiceId:choiceId,reviewConfirmed:true,missingPurchaseAcknowledged:true,requestId:'outgoing_close_0001'};
 f.setResult({data:{paymentId:'outgoing-bill',approved:true,costReviewPending:false,payments:[],journals:[]}});assert.equal((await f.run(body,c)).status,200);assert.equal(f.calls[0].args.p_action,'close_costs');
 for(const change of [{purchaseInvoiceId:'bad'},{reviewConfirmed:false},{missingPurchaseAcknowledged:'yes'},{purchaseCents:1}])assert.equal((await f.run({...body,...change},c)).status,400);
 f.setResult({data:{paymentId:'outgoing-bill',approved:true,costReviewPending:false}});assert.equal((await f.run(body,c)).status,503);
 f.setResult({error:{message:'PURCHASE_HISTORY_ACKNOWLEDGEMENT_REQUIRED'}});assert.equal((await f.run(body,c)).status,409);
});
test('panel refresh throttling cannot consume the approval allowance',async()=>{
 const f=enabled(fixture()),c=await f.login(),hits=[];f.repo.throttleHit=async(key,limit,window)=>{hits.push({key,limit,window});return{allowed:true};};
 f.setResult({data:{paymentId:'panel-bill',approved:false}});assert.equal((await f.run({scope:'company_panel',action:'review',paymentId:'panel-bill'},c)).status,200);
 f.setResult({data:{paymentId:'panel-bill',approved:true,payments:[],journals:[]}});assert.equal((await f.run({scope:'company_panel',action:'approve',paymentId:'panel-bill',expectedRevision:'a'.repeat(32),requestId:'panel_approval_0001'},c)).status,200);
 const panel=hits.filter(h=>h.key.startsWith('company-panel:'));assert.equal(panel.length,2);assert.notEqual(panel[0].key,panel[1].key);assert.equal(panel[0].limit,600);assert.equal(panel[1].limit,90);
});
test('panel approval uses session identity, current source and Director permission',async()=>{
 const f=enabled(fixture()),c=await f.login(),body={scope:'company_panel',action:'approve',paymentId:'panel-bill',expectedRevision:'a'.repeat(32),requestId:'panel_approval_0001'};
 f.setResult({data:{paymentId:'panel-bill',approved:true,payments:[],journals:[]}});
 assert.equal((await f.run(body)).status,401);assert.equal((await f.run(body,c)).status,200);assert.equal(f.calls[0].fn,'uc_company_panel');assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const change of [{actor:'other'},{amountCents:1},{expectedRevision:'bad'},{requestId:''}])assert.equal((await f.run({...body,...change},c)).status,400);
 for(const role of ['admin','shareholder','salesperson','investor']){const g=enabled(fixture(role)),gc=await g.login();assert.equal((await g.run(body,gc)).status,403);assert.equal(g.calls.length,0);}
 f.setResult({error:{message:'SOURCE_CHANGED'}});assert.equal((await f.run(body,c)).status,409);f.setResult({data:{paymentId:'other',approved:true,payments:[],journals:[]}});assert.equal((await f.run(body,c)).status,503);
 f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='0';assert.equal((await f.run(body,c)).status,503);
});
const open=(extra={})=>({scope:'consignment_finance',action:'open',carId:'consign',dealerBasisPoints:5725,expectedRevision:'a'.repeat(32),requestId:'consign_request_0001',...extra});
const saved=()=>({data:{carId:'consign',case:{car_id:'consign',approved_at:null},car:{id:'consign'},payments:[],journals:[]}});
test('Director case confirmation uses session identity and rejects supplied financial totals',async()=>{
 const f=enabled(fixture()),c=await f.login();f.setResult(saved());assert.equal((await f.run(open())).status,401);assert.equal((await f.run(open(),c)).status,200);assert.equal(f.calls[0].fn,'uc_consignment_finance');assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const change of [{actor:'other'},{revenueCents:1},{dealerBasisPoints:10001},{dealerBasisPoints:1.5},{expectedRevision:'bad'},{requestId:''}])assert.equal((await f.run(open(change),c)).status,400);
});
test('admins/shareholders read nonsalary consignment records but cannot approve; staff and investors cannot inspect them',async()=>{
 for(const role of ['admin','shareholder']){const f=enabled(fixture(role)),c=await f.login();f.setResult(saved());assert.equal((await f.run({scope:'consignment_finance',action:'snapshot',carId:'consign'},c)).status,200);assert.equal((await f.run(open(),c)).status,403);assert.equal((await f.run(open({action:'approve',costsConfirmed:true}),c)).status,403);}
 for(const role of ['salesperson','investor','mechanic']){const f=enabled(fixture(role)),c=await f.login();assert.equal((await f.run({scope:'consignment_finance',action:'snapshot',carId:'consign'},c)).status,403);assert.equal(f.calls.length,0);}
});
test('approval requires current-source reference and explicit car-cost confirmation; changed source is a conflict',async()=>{
 const f=enabled(fixture()),c=await f.login(),approve={scope:'consignment_finance',action:'approve',carId:'consign',costsConfirmed:true,expectedRevision:'a'.repeat(32),requestId:'consign_approve_0001'};
 assert.equal((await f.run({...approve,costsConfirmed:false},c)).status,400);f.setResult({error:{message:'SOURCE_CHANGED'}});assert.equal((await f.run(approve,c)).status,409);f.setResult({error:{message:'EXISTING_PAYMENT_REVIEW_REQUIRED'}});assert.equal((await f.run(approve,c)).status,409);
 f.setResult({data:{...saved().data,case:{car_id:'other',approved_at:'now'}}});assert.equal((await f.run(approve,c)).status,503);
 f.deps.env.USED_CAR_BANK_PAYMENTS_ONLINE='0';assert.equal((await f.run(approve,c)).status,503);
});
test('private agreement upload failure cannot confirm proof or approve a settlement',async()=>{
 const f=enabled(fixture('admin')),c=await f.login();f.setResult({data:{documentId:choiceId,path:'consignment/consign/proof.pdf',confirmed:false}});f.repo.uploadInvestorProof=async()=>{throw Error('storage failed');};
 const upload={scope:'consignment_finance',action:'upload',carId:'consign',fileName:'agreement.pdf',mimeType:'application/pdf',base64:Buffer.from('%PDF-1.4\nproof\n%%EOF').toString('base64')};
 assert.equal((await f.run(upload,c)).status,503);assert.deepEqual(f.calls.map(c=>c.args.p_action),['proof_prepare']);f.repo.uploadInvestorProof=async()=>{};assert.equal((await f.run(upload,c)).status,200);assert.deepEqual(f.calls.map(c=>c.args.p_action),['proof_prepare','proof_prepare','proof_confirm']);
});
test('agreement links require authorised source and never expose private storage paths',async()=>{
 const f=enabled(fixture('shareholder')),c=await f.login();f.setResult({data:{path:'private-case-document'}});f.repo.investorProofUrl=async()=> 'https://storage.example/signed/private';const r=await f.run({scope:'consignment_finance',action:'open_document',documentId:choiceId},c);assert.deepEqual(r.body,{url:'https://storage.example/signed/private'});f.setResult({error:{message:'NOT_ALLOWED'}});assert.equal((await f.run({scope:'consignment_finance',action:'open_document',documentId:choiceId},c)).status,403);
});

test('terms corrections require Director, source revision and reason; approved changes never become retryable saves',async()=>{
 const body={scope:'consignment_finance',action:'correct_terms',carId:'consign',dealerBasisPoints:4000,reason:'Correct agreed share',expectedRevision:'a'.repeat(32),requestId:'correction_request_01'};
 const f=enabled(fixture()),c=await f.login();f.setResult(saved());assert.equal((await f.run(body,c)).status,200);assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const changes of [{reason:'bad'},{reason:'Reason with\u0000null'},{fixedAmountCents:-1},{expectedRevision:'bad'},{dealerBasisPoints:10001},{amount:1}])assert.equal((await f.run({...body,...changes},c)).status,400);
 for(const role of ['admin','shareholder','salesperson','investor']){const g=enabled(fixture(role)),cookie=await g.login();assert.equal((await g.run(body,cookie)).status,403);assert.equal(g.calls.length,0);}
 for(const code of ['CONSIGNMENT_APPROVED_CORRECTION_REQUIRED','NO_CORRECTION_CHANGE','CORRECTION_REASON_REQUIRED']){f.setResult({error:{message:code}});const r=await f.run(body,c);assert.equal(r.status,409);assert.equal(r.body.error.code,code);}
});

test('unpaid bill corrections validate invoice, amount and actor; paid bills return a review conflict',async()=>{
 const body={scope:'consignment_finance',action:'correct_bill',carId:'consign',paymentId:'bill',amountCents:300000,invoiceDocumentId:choiceId,reason:'Correct invoice amount',expectedRevision:'a'.repeat(32),requestId:'bill_correction_0001'};
 const f=enabled(fixture()),c=await f.login();f.setResult(saved());assert.equal((await f.run(body,c)).status,200);assert.equal(f.calls[0].args.p_action,'correct_bill');assert.equal(f.calls[0].args.p_actor,'real-director');
 for(const changes of [{amountCents:0},{amountCents:1.5},{invoiceDocumentId:'bad'},{reason:'bad'},{actor:'other'}])assert.equal((await f.run({...body,...changes},c)).status,400);
 const a=enabled(fixture('admin')),ac=await a.login();assert.equal((await a.run(body,ac)).status,403);assert.equal(a.calls.length,0);
 f.setResult({error:{message:'PAID_BILL_ADJUSTMENT_REQUIRED'}});assert.equal((await f.run(body,c)).status,409);
});

test('approved settlement amendments use Director source review and a new agreement',async()=>{
 const f=enabled(fixture()),c=await f.login();const preview={scope:'consignment_finance',action:'preview_adjustment',carId:'consign',dealerBasisPoints:2000};f.setResult({data:{preview:{carId:'consign',sourceRevision:'b'.repeat(32)}}});assert.equal((await f.run(preview,c)).status,200);
 const body={...preview,action:'adjust_settlement',expectedRevision:'b'.repeat(32),agreementDocumentId:choiceId,reason:'Amend agreed dealer share',requestId:'settlement_amend_0001'};f.setResult(saved());assert.equal((await f.run(body,c)).status,200);assert.equal(f.calls[1].args.p_actor,'real-director');
 assert.equal((await f.run({...body,agreementDocumentId:'bad'},c)).status,400);assert.equal((await f.run({...body,reason:'bad'},c)).status,400);
 for(const role of ['admin','shareholder','investor']){const g=enabled(fixture(role)),gc=await g.login();assert.equal((await g.run(preview,gc)).status,403);assert.equal((await g.run(body,gc)).status,403);}
 f.setResult({error:{message:'NEW_SETTLEMENT_AGREEMENT_REQUIRED'}});assert.equal((await f.run(body,c)).status,409);
});

test('approved supplier bill preview and amendment are Director-only and source-bound',async()=>{
 const f=enabled(fixture()),c=await f.login();const body={scope:'consignment_finance',action:'preview_bill_adjustment',carId:'consign',paymentId:'repair-bill',amountCents:250000,invoiceDocumentId:choiceId,reason:'Correct supplier final invoice'};
 f.setResult({data:{preview:{carId:'consign',sourceRevision:'a'.repeat(32),supplier:{receivableCents:50000}}}});assert.equal((await f.run(body,c)).status,200);
 const save={...body,action:'adjust_approved_bill',expectedRevision:'a'.repeat(32),requestId:'approved_bill_adjust_01'};f.setResult(saved());assert.equal((await f.run(save,c)).status,200);assert.equal(f.calls[1].args.p_actor,'real-director');
 for(const changes of [{amountCents:0},{invoiceDocumentId:'bad'},{reason:'bad'},{costCents:1}])assert.equal((await f.run({...save,...changes},c)).status,400);
 for(const role of ['admin','shareholder','investor']){const g=enabled(fixture(role)),gc=await g.login();assert.equal((await g.run(body,gc)).status,403);assert.equal((await g.run(save,gc)).status,403);}
 f.setResult({error:{message:'SUPPLIER_HISTORY_REVIEW_REQUIRED'}});assert.equal((await f.run(save,c)).status,409);
});
