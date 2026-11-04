import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {decodeProof,cleanFileName} from './investorActivation.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const fields={upload:['choiceId','fileName','mimeType','base64'],open:['documentId'],apply:['choiceId','documentId','requestId']};
const errors={NOT_ALLOWED:[403,'Only the Director can apply this funding choice.'],UPLOAD_MISSING:[503,'The invoice upload did not finish. Retry the same file.'],TRADE_IN_INVOICE_REQUIRED:[409,'Upload the trade-in invoice or signed purchase document first.'],REQUEST_CHANGED:[409,'Retry the original funding save before changing it.'],CHOICE_CHANGED:[409,'The funding choice changed. Refresh this car.'],TRADE_IN_VALUE_CHANGED:[409,'The car value or lender balance changed. Review the funding choice again.'],OUTGOING_INVESTOR_CAR_REQUIRED:[409,'The outgoing car needs its investor funding record first.'],COMPANY_FUNDING_NOT_READY:[409,'Company-funded trade-ins are awaiting company-bank setup. Nothing was funded.'],LENDER_SETTLEMENT_NOT_READY:[409,'This trade-in has a lender balance. Its lender payment workflow must be completed first. Nothing was funded.'],SALE_PRICE_REQUIRED:[409,'Agree the outgoing car sale price before applying this trade-in.'],TRADE_IN_CREDIT_EXCEEDS_SALE:[409,'The trade-in credit is more than the unpaid sale price. Review the deal.'],TRADE_IN_FUNDING_LOCKED:[409,'This incoming car is already funded. Refresh its records.'],TRADE_IN_HISTORY_REVIEW_REQUIRED:[409,'Review the incoming car’s existing financial history first.'],INSUFFICIENT_FUNDING_POT:[409,'The selected pot cannot cover this car and its reserved money.']};
async function call(ctx,actor,action,data){
 const out=await ctx.repo.rpc('uc_apply_investor_trade_in',{p_actor:actor,p_action:action,p_data:data});
 if(out?.error){for(const [code,[status,message]]of Object.entries(errors))if(out.error.message?.includes(code))throw new ApiError(status,code,message);if(out.error.message?.includes('INVALID')||['22P02','22003','23514'].includes(out.error.code))throw new ApiError(400,'INVALID','Check the trade-in details.');throw new ApiError(503,'UNAVAILABLE','Could not confirm this funding save. Retry the original save.');}
 return out?.data;
}
export async function handleInvestorTradeInApplication(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 const raw=readJson(req,2_100_000);
 if(user.registration_status!=='active'||!['used_car','both'].includes(user.business_access)||!(user.role==='director'&&user.business_access==='both'||user.role==='investor'&&raw.action==='open'))throw new ApiError(403,'FORBIDDEN',errors.NOT_ALLOWED[1]);
 if(raw.scope!=='trade_in_application'||!Object.hasOwn(fields,raw.action))throw new ApiError(400,'INVALID','Choose a valid funding action.');
 onlyKeys(raw,['scope','action',...fields[raw.action]]);const {scope,action,...data}=raw;
 if(action!=='upload'&&Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(raw))>6000)throw new ApiError(413,'INVALID','This request is too large.');
 if(action!=='open'&&!uuid(data.choiceId)||action!=='upload'&&!uuid(data.documentId)||action==='apply'&&(typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(data.requestId)))throw new ApiError(400,'INVALID','Open the funding choice again.');
 if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1'||deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Trade-in funding is not switched on yet. Nothing was funded.');
 const hit=await ctx.repo.throttleHit('uctapply:'+createHash('sha256').update(user.id).digest('hex'),90,900);if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment before trying again.');
 if(action==='upload'){
  if(typeof ctx.repo.uploadInvestorProof!=='function')throw new ApiError(503,'SETUP','Private invoice storage is not ready.');
  const fileName=cleanFileName(data.fileName),{bytes,digest}=decodeProof(data.mimeType,data.base64);
  const doc=await call(ctx,user.id,'proof_prepare',{choiceId:data.choiceId,fileName,mimeType:data.mimeType,sizeBytes:bytes.length,sha256:digest});
  if(!uuid(doc?.documentId)||typeof doc?.path!=='string')throw new ApiError(503,'UNAVAILABLE','Could not confirm the upload. Retry the same file.');
  if(!doc.confirmed){try{await ctx.repo.uploadInvestorProof(doc.path,bytes,data.mimeType);}catch{throw new ApiError(503,'UNAVAILABLE','The invoice could not be stored. Retry the same file.');}await call(ctx,user.id,'proof_confirm',{documentId:doc.documentId});}
  return {status:200,body:{documentId:doc.documentId}};
 }
 if(action==='open'){
  const d=await call(ctx,user.id,'proof_read',data);
  if(typeof d?.path!=='string'||typeof ctx.repo.investorProofUrl!=='function')throw new ApiError(503,'UNAVAILABLE','Could not open the invoice.');
  const url=await ctx.repo.investorProofUrl(d.path);if(typeof url!=='string'||!url.startsWith('https://'))throw new ApiError(503,'UNAVAILABLE','Could not open the invoice.');
  return {status:200,body:{url}};
 }
 const r=await call(ctx,user.id,'apply',data);
 if(r?.choice?.id!==data.choiceId||r.choice.financiallyApplied!==true)throw new ApiError(503,'UNAVAILABLE','Could not confirm funding. Retry the original save.');
 return {status:200,body:r};
});}
