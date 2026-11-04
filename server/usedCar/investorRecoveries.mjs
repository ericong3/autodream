import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {decodeProof,cleanFileName} from './investorActivation.mjs';
const FIELDS={
 prepare_sale_receipt:['carId','amountCents','withheldBills','excessCents','customerId','bankAccountId','bankReference','paidOn','requestId'],
 prepare_customer_refund:['carId','customerId','amountCents','bankName','accountNumber','accountHolder','note','requestId'],
 confirm_sale_money:['orderId','documentId','bankAccountId','bankReference','paidOn','requestId'],cancel_sale_money:['orderId','note','requestId'],sale_money_snapshot:['carId'],
 sale_proof_upload:['orderId','fileName','mimeType','base64','requestId'],sale_proof_url:['documentId'],
};
export const RECOVERY_ACTIONS=new Set(Object.keys(FIELDS));
const SQL_ACTION={prepare_sale_receipt:'prepare_receipt',prepare_customer_refund:'prepare_refund',confirm_sale_money:'post',cancel_sale_money:'cancel',sale_money_snapshot:'snapshot'};
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const money=(v,zero=false)=>Number.isSafeInteger(v)&&v>=(zero?0:1)&&v<=1e12;
const request=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(v);
const date=v=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const ERRORS={NOT_ALLOWED:[403,'You cannot open or record this car’s money.'],REQUEST_CHANGED:[409,'Retry the original save before changing it.'],SALE_PRICE_REQUIRED:[409,'Agree the car sale price first.'],SALE_RECOVERY_EXCEEDS_BALANCE:[409,'The sale amount covered is more than the remaining car price. Check the actual bank amount, deductions and customer excess.'],REFUND_EXCEEDS_BALANCE:[409,'This refund is more than the customer money still available. Check any other waiting refunds.'],CUSTOMER_REQUIRED:[400,'Choose the customer linked to this car.'],REFUND_RECIPIENT_REQUIRED:[400,'Enter the customer’s refund bank details and reason.'],WITHHELD_BILL_REQUIRED:[409,'Choose an approved bill for this car. Commission and staff claims cannot be treated as bank deductions.'],SUPPLIER_INVOICE_REQUIRED:[409,'Upload the deduction bill’s invoice before recording it.'],PAYMENT_EXCEEDS_BALANCE:[409,'This bill has already been paid or deducted. Refresh its balance.'],DUPLICATE_WITHHELD_BILL:[400,'Choose each deduction bill once.'],PAYMENT_RECEIPT_REQUIRED:[409,'Upload and choose the bank proof first.'],UPLOAD_MISSING:[503,'The proof upload did not finish. Retry the same file.'],ORDER_ALREADY_REVIEWED:[409,'This entry was already recorded or cancelled. Refresh its status.'],INVALID_BANK_PAYMENT:[400,'Check the registered bank, actual transaction date and reference.'],CAR_SETTLED_ADJUSTMENT_REQUIRED:[409,'Profit is already confirmed. The Director must review a correction.'],REVIEW_WAITING_ORDERS:[409,'Review or cancel the waiting entries before adding more.'],REASON_REQUIRED:[400,'Enter the reason for cancelling this entry.'],INSUFFICIENT_FUNDS:[409,'The investor account cannot cover this payment and its other reserved money. Review funding first.']};
async function rpc(ctx,actor,action,data){
 const out=await ctx.repo.rpc('uc_investor_recoveries',{p_actor:actor,p_action:action,p_data:data});
 if(out.error){for(const [code,[status,message]]of Object.entries(ERRORS))if(out.error.message?.includes(code))throw new ApiError(status,code,message);if(out.error.message?.includes('INVALID')||['22003','22007','22P02','23514'].includes(out.error.code))throw new ApiError(400,'INVALID','Check the receipt or refund details.');throw new ApiError(503,'UNAVAILABLE','Could not confirm this entry. Retry the original save.');}
 return out.data;
}
export async function handleInvestorRecoveries(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(!['director','investor'].includes(user.role)||user.registration_status!=='active'||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN',ERRORS.NOT_ALLOWED[1]);
 const raw=readJson(req,2_100_000);
 if(!['investor_finance','investor_recoveries'].includes(raw.scope)||!RECOVERY_ACTIONS.has(raw.action))throw new ApiError(400,'INVALID','Choose a valid money action.');
 onlyKeys(raw,['scope','action',...FIELDS[raw.action]]);const {scope,action,...data}=raw;
 if(user.role==='investor'&&!['sale_money_snapshot','sale_proof_url'].includes(action))throw new ApiError(403,'FORBIDDEN','The Director records receipts and refunds.');
 const invalid=()=>new ApiError(400,'INVALID','Check the receipt or refund details.');
 if(action!=='sale_proof_upload'&&Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(raw))>16000)throw new ApiError(413,'INVALID','This entry is too large.');
 if(data.carId!==undefined&&(typeof data.carId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(data.carId)))throw invalid();
 for(const key of ['orderId','documentId','bankAccountId'])if(data[key]!==undefined&&!uuid(data[key]))throw invalid();
 if(data.customerId!==undefined&&!text(data.customerId,180))throw invalid();
 if(['prepare_sale_receipt','prepare_customer_refund','sale_money_snapshot'].includes(action)&&!data.carId)throw invalid();
 if(['confirm_sale_money','cancel_sale_money','sale_proof_upload'].includes(action)&&!data.orderId)throw invalid();
 if(['confirm_sale_money','sale_proof_url'].includes(action)&&!data.documentId)throw invalid();
 if(!['sale_money_snapshot','sale_proof_url','sale_proof_upload'].includes(action)&&!request(data.requestId))throw invalid();
 if(action==='prepare_sale_receipt'){
  if(!money(data.amountCents,true)||!uuid(data.bankAccountId)||!text(data.bankReference,200)||!date(data.paidOn)||data.excessCents!==undefined&&!money(data.excessCents,true))throw invalid();
  if(data.withheldBills!==undefined&&(!Array.isArray(data.withheldBills)||data.withheldBills.length>20))throw invalid();
  const ids=new Set();for(const b of data.withheldBills??[]){if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['billId','amountCents'].includes(k))||!uuid(b.billId)||!money(b.amountCents)||ids.has(b.billId))throw invalid();ids.add(b.billId);}
  if((data.excessCents??0)>0&&!data.customerId)throw invalid();
 }
 if(action==='prepare_customer_refund'&&(!money(data.amountCents)||!data.customerId||!['bankName','accountNumber','accountHolder','note'].every(k=>text(data[k],200))))throw invalid();
 if(action==='confirm_sale_money'&&['bankAccountId','bankReference','paidOn'].some(k=>data[k]!==undefined)&&(!uuid(data.bankAccountId)||!text(data.bankReference,200)||!date(data.paidOn)))throw invalid();
 if(action==='cancel_sale_money'&&(!text(data.note,500)||data.note.trim().length<3))throw invalid();
 if(action==='sale_proof_upload'&&data.requestId!==undefined&&!request(data.requestId))throw invalid();
 if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1'||deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Investor sale receipts and refunds are not switched on yet. Nothing was saved.');
 const hit=await ctx.repo.throttleHit('ucrecov:'+createHash('sha256').update(user.id).digest('hex'),120,900);if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment before trying again.');
 if(action==='sale_proof_upload'){
  if(typeof ctx.repo.uploadInvestorProof!=='function')throw new ApiError(503,'SETUP','Private proof storage is not ready.');
  const fileName=cleanFileName(data.fileName),{bytes,digest}=decodeProof(data.mimeType,data.base64);
  const requestId=data.requestId??'sale_doc_'+createHash('sha256').update([data.orderId,fileName,data.mimeType,digest].join('\n')).digest('hex');
  const doc=await rpc(ctx,user.id,'proof_prepare',{orderId:data.orderId,fileName,mimeType:data.mimeType,sha256:digest,sizeBytes:bytes.length,requestId});
  if(!uuid(doc?.documentId)||typeof doc?.path!=='string')throw new ApiError(503,'UNAVAILABLE','Could not confirm the upload. Retry the same file.');
  if(doc.state!=='confirmed'){
   try{await ctx.repo.uploadInvestorProof(doc.path,bytes,data.mimeType);}catch{throw new ApiError(503,'UNAVAILABLE','The file could not be stored. Retry the same file.');}
   await rpc(ctx,user.id,'proof_confirm',{documentId:doc.documentId});
  }
  return {status:200,body:{documentId:doc.documentId}};
 }
 if(action==='sale_proof_url'){
  const doc=await rpc(ctx,user.id,'proof_read',{documentId:data.documentId});
  if(typeof ctx.repo.investorProofUrl!=='function'||typeof doc?.path!=='string')throw new ApiError(503,'UNAVAILABLE','Could not open the proof. Try again.');
  const url=await ctx.repo.investorProofUrl(doc.path);if(typeof url!=='string'||!url.startsWith('https://'))throw new ApiError(503,'UNAVAILABLE','Could not open the proof. Try again.');
  return {status:200,body:{url}};
 }
 const result=await rpc(ctx,user.id,SQL_ACTION[action],data);
 if(action==='sale_money_snapshot'){
  if(result?.carId!==data.carId||!Array.isArray(result.orders)||!Array.isArray(result.documents))throw new ApiError(503,'UNAVAILABLE','Could not load the money entries.');
 }else if(!uuid(result?.orderId)||typeof result?.carId!=='string'||data.carId!==undefined&&result.carId!==data.carId||data.orderId!==undefined&&result.orderId!==data.orderId)throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the original entry.');
 return {status:200,body:result};
});}
