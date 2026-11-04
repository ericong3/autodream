import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {decodeProof,cleanFileName} from './investorActivation.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=200&&!/[\u0000-\u001f\u007f]/.test(v);
const date=v=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const fields={snapshot:['applicationId'],upload:['applicationId','kind','fileName','mimeType','base64'],open:['documentId'],pay:['applicationId','statementDocumentId','receiptDocumentId','bankAccountId','bankReference','paidOn','recipientBank','recipientAccount','recipientName','note','requestId']};
const errors={NOT_ALLOWED:[403,'You cannot open or pay this lender balance.'],REQUEST_CHANGED:[409,'Retry the original lender payment before changing its details.'],LENDER_ALREADY_PAID:[409,'This lender balance is already paid. Refresh the car.'],LENDER_PAYMENT_PROOF_REQUIRED:[409,'Upload the lender statement and a separate bank payment receipt.'],LENDER_RECIPIENT_REQUIRED:[400,'Enter the lender’s bank details and payment reason.'],UPLOAD_MISSING:[503,'The document upload did not finish. Retry the same file.'],INVALID_BANK_PAYMENT:[400,'Check the company bank, transaction date and reference.'],INSUFFICIENT_FUNDS:[409,'The investor pot cannot cover this payment and its other reserved money.']};
async function call(ctx,actor,action,data){
 const out=await ctx.repo.rpc('uc_trade_in_lender_money',{p_actor:actor,p_action:action,p_data:data});
 if(out?.error){for(const [code,[status,message]]of Object.entries(errors))if(out.error.message?.includes(code))throw new ApiError(status,code,message);if(out.error.code==='23505')throw new ApiError(409,'BANK_REFERENCE_USED','This bank reference was already recorded. Check the earlier payment.');if(out.error.message?.includes('INVALID')||['22P02','22007','22003','23514'].includes(out.error.code))throw new ApiError(400,'INVALID','Check the lender payment details.');throw new ApiError(503,'UNAVAILABLE','Could not confirm the lender payment. Retry the original save.');}
 return out?.data;
}
export async function handleInvestorTradeInLenders(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);const raw=readJson(req,2_100_000);
 if(!['director','investor'].includes(user.role)||user.registration_status!=='active'||!['used_car','both'].includes(user.business_access)||user.role==='investor'&&!['snapshot','open'].includes(raw.action))throw new ApiError(403,'FORBIDDEN',errors.NOT_ALLOWED[1]);
 if(raw.scope!=='trade_in_lender'||!Object.hasOwn(fields,raw.action))throw new ApiError(400,'INVALID','Choose a valid lender action.');
 onlyKeys(raw,['scope','action',...fields[raw.action]]);const {scope,action,...data}=raw;
 const bad=()=>new ApiError(400,'INVALID','Check the lender payment details.');
 if(action!=='upload'&&Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(raw))>6000)throw bad();
 if(action==='open'?!uuid(data.documentId):!uuid(data.applicationId))throw bad();
 if(action==='upload'&&!['statement','payment'].includes(data.kind))throw bad();
 if(action==='pay'&&(!uuid(data.statementDocumentId)||!uuid(data.receiptDocumentId)||!uuid(data.bankAccountId)||!date(data.paidOn)||!text(data.bankReference)||!['recipientBank','recipientAccount','recipientName','note'].every(k=>text(data[k]))||typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(data.requestId)))throw bad();
 if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1'||deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1'||deps.env.USED_CAR_BANK_PAYMENTS_ONLINE!=='1')throw new ApiError(503,'SETUP','Trade-in lender payments are not switched on yet. Nothing was recorded.');
 const hit=await ctx.repo.throttleHit('uclender:'+createHash('sha256').update(user.id).digest('hex'),90,900);if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment before trying again.');
 if(action==='upload'){
  if(typeof ctx.repo.uploadInvestorProof!=='function')throw new ApiError(503,'SETUP','Private document storage is not ready.');
  const fileName=cleanFileName(data.fileName),{bytes,digest}=decodeProof(data.mimeType,data.base64);
  const doc=await call(ctx,user.id,'proof_prepare',{applicationId:data.applicationId,kind:data.kind,fileName,mimeType:data.mimeType,sizeBytes:bytes.length,sha256:digest});
  if(!uuid(doc?.documentId)||typeof doc?.path!=='string')throw new ApiError(503,'UNAVAILABLE','Could not confirm the upload. Retry the same file.');
  if(!doc.confirmed){try{await ctx.repo.uploadInvestorProof(doc.path,bytes,data.mimeType);}catch{throw new ApiError(503,'UNAVAILABLE','The document could not be stored. Retry the same file.');}await call(ctx,user.id,'proof_confirm',{documentId:doc.documentId});}
  return {status:200,body:{documentId:doc.documentId}};
 }
 if(action==='open'){
  const d=await call(ctx,user.id,'proof_read',data);if(typeof d?.path!=='string'||typeof ctx.repo.investorProofUrl!=='function')throw new ApiError(503,'UNAVAILABLE','Could not open this file.');
  const url=await ctx.repo.investorProofUrl(d.path);if(typeof url!=='string'||!url.startsWith('https://'))throw new ApiError(503,'UNAVAILABLE','Could not open this file.');return {status:200,body:{url}};
 }
 const r=await call(ctx,user.id,action,data);
 if(r?.applicationId!==data.applicationId||action==='snapshot'&&(!Array.isArray(r.documents)||typeof r.paid!=='boolean')||action==='pay'&&!uuid(r.paymentId))throw new ApiError(503,'UNAVAILABLE','Could not confirm this lender record. Retry the original save.');
 return {status:200,body:r};
});}
