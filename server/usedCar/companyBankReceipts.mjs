import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const cents=(v,zero=false)=>Number.isSafeInteger(v)&&v>=(zero?0:1)&&v<=1e12;
const date=v=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const errors={NOT_ALLOWED:[403,'Only the Director can record company money received.'],REQUEST_CHANGED:[409,'Retry the original receipt before changing it.'],COLLECTION_WORKFLOW_REQUIRED:[409,'Use the correct collection workflow for this payment.'],COLLECTION_HISTORY_REVIEW_REQUIRED:[409,'This car already has collection history. Review it before recording more bank money.'],USE_INVESTOR_CAR_BILLS:[409,'Open the investor car account to record this receipt.'],PAYMENT_EXCEEDS_BALANCE:[409,'The amount covered is more than the unpaid balance. Check the actual bank amount, deductions and customer excess.'],PAYMENT_RECEIPT_REQUIRED:[409,'Upload bank proof for the receipt and each selected deduction.'],RECEIPT_ALREADY_USED:[409,'This proof already records an earlier transaction. Use the receipt for this bank transaction.'],SUPPLIER_INVOICE_REQUIRED:[409,'Upload the deduction bill’s invoice first.'],WITHHELD_BILL_REQUIRED:[409,'Choose an unpaid car bill for this car. Staff claims and commissions cannot be bank deductions.'],BILL_LEDGER_REVIEW_REQUIRED:[409,'The deduction bill’s accounting record needs review first.'],INVALID_BANK_PAYMENT:[400,'Check the bank, actual date and reference.'],CUSTOMER_REQUIRED:[400,'Choose the customer linked to this car for the extra money.']};
export async function handleCompanyBankReceipts(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 const b=readJson(req,20000);const balance=b.action==='balance';
 if(!(balance?['director','admin','shareholder','salesperson'].includes(user.role):user.role==='director')||user.registration_status!=='active'||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN',errors.NOT_ALLOWED[1]);
 onlyKeys(b,balance?['scope','action','carId']:['scope','action','paymentId','amountCents','excessCents','customerId','withheldBills','receiptDocumentId','bankAccountId','bankReference','paidOn','requestId']);
 const {scope,action,...data}=b;const bad=()=>new ApiError(400,'INVALID','Check the company receipt details.');
 if(balance){if(scope!=='company_bank_receipts'||!text(data.carId,180))throw bad();}
 else {
 if(scope!=='company_bank_receipts'||action!=='record'||!text(data.paymentId,180)||!cents(data.amountCents,true)||data.excessCents!==undefined&&!cents(data.excessCents,true)||!uuid(data.receiptDocumentId)||!uuid(data.bankAccountId)||!text(data.bankReference,200)||!date(data.paidOn)||typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(data.requestId))throw bad();
 if(data.customerId!==undefined&&!text(data.customerId,180)||(data.excessCents??0)>0&&!data.customerId)throw bad();
 if(data.withheldBills!==undefined&&(!Array.isArray(data.withheldBills)||data.withheldBills.length>20))throw bad();
 let fees=0;const ids=new Set([data.paymentId]);
 for(const item of data.withheldBills??[]){if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['paymentId','amountCents','documentId'].includes(k))||!text(item.paymentId,180)||!cents(item.amountCents)||!uuid(item.documentId)||ids.has(item.paymentId))throw bad();ids.add(item.paymentId);fees+=item.amountCents;}
 if(fees>1e12||data.amountCents+fees-(data.excessCents??0)<=0)throw bad();
 }
 if(deps.env.USED_CAR_BANK_PAYMENTS_ONLINE!=='1'||deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE!=='1'||deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Company bank receipts are not switched on yet. Nothing was recorded.');
 const hit=await ctx.repo.throttleHit('ucreceiv:'+createHash('sha256').update(user.id).digest('hex'),120,900);if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment before trying again.');
 const out=await ctx.repo.rpc('uc_company_bank_receipt',{p_actor:user.id,p_action:action,p_data:data});
 if(out?.error){for(const [code,[status,message]]of Object.entries(errors))if(out.error.message?.includes(code))throw new ApiError(status,code,message);if(out.error.code==='23505')throw new ApiError(409,'BANK_REFERENCE_USED','This bank reference was already recorded. Check the earlier transaction.');if(out.error.message?.includes('INVALID')||['22P02','22007','22003','23514'].includes(out.error.code))throw bad();throw new ApiError(503,'UNAVAILABLE','Could not confirm the receipt. Retry the original save.');}
 const r=out?.data;
 if(balance){if(r?.carId!==data.carId||!cents(r.customerCoveredCents,true)||!cents(r.loanCoveredCents,true)||Object.keys(r).some(k=>!['carId','customerCoveredCents','loanCoveredCents'].includes(k)))throw new ApiError(503,'UNAVAILABLE','Could not load the customer balance.');return {status:200,body:r};}
 if(!uuid(r?.receiptId)||!Array.isArray(r?.payments)||!r.payments.some(p=>p?.id===data.paymentId)||!Array.isArray(r?.journals)||r.journals.length!==1||r?.car?.id!==r.payments.find(p=>p?.id===data.paymentId)?.car_id)throw new ApiError(503,'UNAVAILABLE','Could not confirm the receipt. Retry the original save.');
 return {status:200,body:r};
});}
