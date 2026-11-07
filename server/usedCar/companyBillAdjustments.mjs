import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';

const messages={
 NOT_ALLOWED:'Only the Director can correct company car bills.',
 DIRECT_COMPANY_CAR_BILL_REQUIRED:'Choose a direct company car repair or car expense bill. Investor and consignment bills use their own review.',
 OUTGOING_COST_REVIEW_REQUIRED:'Finish the dealer sale cost review first, then correct this bill.',
 SUPPLIER_HISTORY_REVIEW_REQUIRED:'The previous supplier payments need review before this bill can be corrected.',
 BILL_LEDGER_REVIEW_REQUIRED:'The original bill accounting entry needs review first.',
 SUPPLIER_INVOICE_REQUIRED:'Upload a new supplier invoice or credit note after the latest payment or correction.',
 NO_CORRECTION_CHANGE:'Enter the revised total bill amount.',
 SOURCE_CHANGED:'This bill changed. Refresh and review it again.',
 REQUEST_CHANGED:'Retry the original correction before changing its details.',
 REASON_REQUIRED:'Enter a short reason for the correction.',
};
export async function handleCompanyBillAdjustments(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp),b=readJson(req,6000);
 if(user.role!=='director'||user.registration_status!=='active'||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'NOT_ALLOWED',messages.NOT_ALLOWED);
 if(b.scope!=='company_bill_adjustments'||!['snapshot','preview','apply'].includes(b.action))throw new ApiError(400,'INVALID','Choose a valid bill correction action.');
 const write=b.action==='apply',review=b.action!=='snapshot';
 onlyKeys(b,['scope','action','paymentId',...(review?['amountCents','invoiceDocumentId','reason']:[]),...(write?['expectedRevision','requestId']:[])]);
 if(typeof b.paymentId!=='string'||!/^[A-Za-z0-9_:-]{1,180}$/.test(b.paymentId)||review&&(!Number.isSafeInteger(b.amountCents)||b.amountCents<0||b.amountCents>1e12||typeof b.invoiceDocumentId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.invoiceDocumentId)||typeof b.reason!=='string'||b.reason.trim().length<5||b.reason.trim().length>1000||/[\u0000-\u001f\u007f]/.test(b.reason))||write&&(typeof b.expectedRevision!=='string'||!/^[0-9a-f]{32}$/.test(b.expectedRevision)||typeof b.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(b.requestId)))throw new ApiError(400,'INVALID','Check the revised bill amount, invoice and reason.');
 if(deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE!=='1'||deps.env.USED_CAR_BANK_PAYMENTS_ONLINE!=='1')throw new ApiError(503,'SETUP','Company bill corrections are not switched on yet. Nothing was saved.');
 const hit=await ctx.repo.throttleHit('company-bill-adjustments:'+b.action+':'+createHash('sha256').update(user.id).digest('hex'),write?90:600,900);if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and retry.');
 const {scope,action,...data}=b,out=await ctx.repo.rpc('uc_company_bill_adjustment',{p_actor:user.id,p_action:action,p_data:data});
 if(out.error){for(const[code,message]of Object.entries(messages))if(out.error.message?.includes(code))throw new ApiError(code==='NOT_ALLOWED'?403:409,code,message);if(out.error.message?.includes('INVALID')||['22P02','23514','22003'].includes(out.error.code))throw new ApiError(400,'INVALID','Check the bill correction details.');throw new ApiError(503,'UNAVAILABLE','Could not confirm this correction. Retry the original save.');}
 if(out.data?.paymentId!==data.paymentId||typeof out.data?.carId!=='string'||(write?(!Array.isArray(out.data?.payments)||!Array.isArray(out.data?.journals)):(typeof out.data?.sourceRevision!=='string'||!/^[0-9a-f]{32}$/.test(out.data.sourceRevision))))throw new ApiError(503,'UNAVAILABLE','Could not confirm this correction. Retry the original save.');
 return{status:200,body:out.data};
});}
