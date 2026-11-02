import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
export function isSalesReferralRequest(req){try{return (typeof req.body==='string'?JSON.parse(req.body):req.body)?.scope==='sales_referrals';}catch{return false;}}
export function validateSalesAssignment(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'INVALID','Choose the Garage salesperson in charge.');
 onlyKeys(value,['ownerId','referrer']);
 const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
 if(!id(value.ownerId)||!value.referrer||typeof value.referrer!=='object'||Array.isArray(value.referrer))throw new ApiError(400,'INVALID','Check the salesperson and referrer.');
 const r=value.referrer;
 onlyKeys(r,r.kind==='none'?['kind']:r.kind==='external'?['kind','profileId']:['kind','staffId','deal']);
 if(!['none','used_car','external'].includes(r.kind)||r.kind==='external'&&!(typeof r.profileId==='string'&&/^[a-f0-9-]{36}$/i.test(r.profileId))||r.kind==='used_car'&&!id(r.staffId))throw new ApiError(400,'INVALID','Choose one valid referrer.');
 if(r.kind==='used_car'&&r.deal!==undefined){
  if(!r.deal||typeof r.deal!=='object'||Array.isArray(r.deal))throw new ApiError(400,'INVALID','Choose the Used Car deal again.');
  onlyKeys(r.deal,['customerId','carId','submittedAt']);
  if(!id(r.deal.customerId)||!id(r.deal.carId)||typeof r.deal.submittedAt!=='string'||r.deal.submittedAt.length>80||!Number.isFinite(Date.parse(r.deal.submittedAt)))throw new ApiError(400,'INVALID','Choose the Used Car deal again.');
 }
}
export async function handleSalesReferrals(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(!['garage','both'].includes(user.business_access)||!['director','shareholder','garage_head','garage_salesman'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Garage sales access is required.');
 const b=readJson(req,2000);
 if(['options','orders'].includes(b.action))onlyKeys(b,['scope','action']);
 else if(b.action==='deals'){
  onlyKeys(b,['scope','action','staffId','month']);
  if(typeof b.staffId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(b.staffId)||typeof b.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month))throw new ApiError(400,'INVALID','Choose the salesman and month.');
 }else if(b.action==='snapshot'){
  onlyKeys(b,['scope','action','invoiceId']);if(typeof b.invoiceId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(b.invoiceId))throw new ApiError(400,'INVALID','Choose a work order.');
 }else throw new ApiError(400,'INVALID','Choose a valid sales action.');
 if(deps.env.GARAGE_SALES_REFERRALS_ONLINE!=='1'){
  if(['options','orders'].includes(b.action))return {status:200,body:{enabled:false,owners:[],usedCarStaff:[],external:[]}};
  if(b.action==='snapshot')return {status:200,body:{enabled:false,assignment:null}};
  throw new ApiError(503,'SETUP','Sales referrals have not been activated yet.');
 }
 const rate=await ctx.repo.throttleHit('referral:'+createHash('sha256').update('sales:'+user.id).digest('hex'),120,900);
 if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Try again shortly.');
 const {scope,action,...data}=b;
 const r=await ctx.repo.rpc('garage_sales_referrals',{p_actor:user.id,p_action:action,p_data:data});
 if(r.error){
  if(r.error.message?.includes('NOT_ALLOWED'))throw new ApiError(403,'FORBIDDEN','These sales details are unavailable for your account.');
  if(r.error.message?.includes('INVALID'))throw new ApiError(400,'INVALID','Check the selected salesman and deal.');
  throw new ApiError(503,'SETUP','Sales referrals are being prepared. Try again later.');
 }
 return {status:200,body:r.data};
});}
