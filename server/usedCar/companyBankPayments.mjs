import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const day=v=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const errors={NOT_ALLOWED:[403,'Only the Director can record this payment.'],REQUEST_CHANGED:[409,'Retry the original payment before changing its details.'],PAYMENT_EXCEEDS_BALANCE:[409,'This payment is already recorded or is more than the balance. Refresh it first.'],PAYMENT_RECEIPT_REQUIRED:[409,'Upload the bank receipt for each payment first.'],SUPPLIER_INVOICE_REQUIRED:[409,'Upload the bill’s supplier invoice before recording payment.'],BILL_LEDGER_REVIEW_REQUIRED:[409,'The bill’s accounting record needs review before payment can be recorded.'],PAYMENT_HISTORY_REVIEW_REQUIRED:[409,'This payment already has accounting history. Review it before recording more money.'],PAYMENT_WORKFLOW_REQUIRED:[409,'This payment needs its separate collection or settlement workflow.'],USE_INVESTOR_CAR_BILLS:[409,'Open the investor car bill to record this payment.'],CLAIM_NOT_APPROVED:[409,'Have this claim checked before recording payment.'],BONUS_FULL_PAYMENT_REQUIRED:[409,'Record the confirmed bonus as one full payment.'],DUPLICATE_PAYMENT:[400,'Choose each payment once.'],INVALID_BANK_PAYMENT:[400,'Check the company bank, actual date and reference.']};
errors.RECEIPT_ALREADY_USED=[409,'This receipt already records an earlier bank payment. Upload the receipt for this transaction.'];
errors.COMPANY_FUNDS_REQUIRED=[409,'There is not enough available company money for this payment. Investor money and amounts owed back to investors are protected.'];
errors.SEPARATE_SALARY_PAYMENTS=[409,'Record salary and bonus payments separately from ordinary bills to keep payroll private.'];
errors.PAYROLL_FULL_PAYMENT_REQUIRED=[409,'Record the full confirmed payroll amount. Partial payroll payments are not supported.'];
export async function handleCompanyBankPayments(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 const raw=readJson(req,20000);
 if(!(user.role==='director'||user.role==='admin'&&raw.action==='history')||user.registration_status!=='active'||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN',errors.NOT_ALLOWED[1]);
 if(raw.scope!=='company_bank_payments'||!['banks','record','history','month','company'].includes(raw.action))throw new ApiError(400,'INVALID','Choose a valid payment action.');
 onlyKeys(raw,['scope','action',...(raw.action==='record'?['bankAccountId','paidOn','bankReference','notes','allocations','requestId']:raw.action==='history'?['paymentId']:raw.action==='company'?['page']:[])]);const {scope,action,...data}=raw;
 const invalid=()=>new ApiError(400,'INVALID','Check the bank payment details.');
 if(action==='history'&&!text(data.paymentId,180))throw invalid();
 if(action==='company'&&data.page!==undefined&&(!Number.isInteger(data.page)||data.page<0||data.page>999999))throw invalid();
 if(action==='record'){
  if(!uuid(data.bankAccountId)||!day(data.paidOn)||!text(data.bankReference,200)||typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(data.requestId)||data.notes!==undefined&&(typeof data.notes!=='string'||data.notes.length>2000))throw invalid();
  if(!Array.isArray(data.allocations)||data.allocations.length<1||data.allocations.length>50)throw invalid();
  const ids=new Set();let total=0;
  for(const a of data.allocations){if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['paymentId','amountCents','documentId'].includes(k))||!text(a.paymentId,180)||!uuid(a.documentId)||!Number.isSafeInteger(a.amountCents)||a.amountCents<1||a.amountCents>1e12||ids.has(a.paymentId))throw invalid();ids.add(a.paymentId);total+=a.amountCents;}
  if(total>1e12)throw invalid();
 }
 if(deps.env.USED_CAR_BANK_PAYMENTS_ONLINE!=='1'||deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE!=='1'||deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Company-bank payment recording is not switched on yet. Nothing was recorded.');
 const hit=await ctx.repo.throttleHit('ucbank:'+createHash('sha256').update(user.id).digest('hex'),120,900);if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment before trying again.');
 const out=await ctx.repo.rpc('uc_company_bank_money',{p_actor:user.id,p_action:action,p_data:data});
 if(out?.error){for(const [code,[status,message]]of Object.entries(errors))if(out.error.message?.includes(code))throw new ApiError(status,code,message);if(out.error.code==='23505')throw new ApiError(409,'BANK_REFERENCE_USED','This bank reference was already recorded. Check the earlier transaction.');if(out.error.message?.includes('INVALID')||['22P02','22003','22007','23514'].includes(out.error.code))throw invalid();throw new ApiError(503,'UNAVAILABLE','Could not confirm this payment. Retry the original save.');}
 const r=out?.data;
 if(action==='banks'){if(!Array.isArray(r?.banks)||!r?.company)throw new ApiError(503,'UNAVAILABLE','Could not load company banks.');}
 else if(action==='company'){if(!r?.company||!Array.isArray(r.cars)||r.cars.length>25||typeof r.hasMore!=='boolean')throw new ApiError(503,'UNAVAILABLE','Could not load the company pot.');}
 else if(action==='month'){if(!Number.isSafeInteger(r?.month?.receivedCents)||!Number.isSafeInteger(r?.month?.paidCents))throw new ApiError(503,'UNAVAILABLE','Could not load monthly bank movements.');}
 else if(action==='history'){if(r?.paymentId!==data.paymentId||!Array.isArray(r?.entries))throw new ApiError(503,'UNAVAILABLE','Could not load the payment history.');}
 else if(!uuid(r?.bankPaymentId)||!Array.isArray(r?.payments)||!Array.isArray(r?.journals)||r.journals.length!==data.allocations.length||r.payments.length!==data.allocations.length||r.payments.some(p=>!data.allocations.some(a=>a.paymentId===p.id)))throw new ApiError(503,'UNAVAILABLE','Could not confirm this payment. Retry the original save.');
 return {status:200,body:r};
});}
