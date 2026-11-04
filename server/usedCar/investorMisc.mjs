// Prepared handler only. The sales router must send scope 'investor_finance'
// action 'record_misc' here before handleInvestorCapital.
// Records a MISC cost on an investor-funded car and raises ONE pending misc
// bill in a single database transaction. No cash, payment or journal is
// written; the Director approves and pays the bill later through the existing
// car bill flow. The actor, date and stored ringgit amount come from the server.
import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';

const BODY_MAX=20_000;
const SCOPE='investor_finance';
const ROLES=['director','admin'];
const MAX_CENTS=1_000_000_000_000;
const ID=/^[A-Za-z0-9_-]{1,100}$/,REQ=/^[A-Za-z0-9_-]{16,80}$/;
const bad=message=>new ApiError(400,'INVALID',message);
const text=(v,max)=>typeof v==='string'&&v.trim().length>=1&&v.trim().length<=max;

export function validateRecordMisc(body){
 onlyKeys(body,['action','carId','miscId','amountCents','purpose','payee','category','requestId']);
 if(typeof body.carId!=='string'||!ID.test(body.carId))throw bad('Open the car again.');
 if(typeof body.miscId!=='string'||!ID.test(body.miscId))throw bad('Open the cost again.');
 if(typeof body.requestId!=='string'||!REQ.test(body.requestId))throw bad('A save reference is required.');
 if(!Number.isSafeInteger(body.amountCents)||body.amountCents<1||body.amountCents>MAX_CENTS)throw bad('Check the amount.');
 if(!text(body.purpose,300))throw bad('Enter what the cost was for.');
 if(!text(body.payee,150))throw bad('Enter who was paid.');
 const out={carId:body.carId,miscId:body.miscId,amountCents:body.amountCents,purpose:body.purpose.trim(),payee:body.payee.trim(),requestId:body.requestId};
 if(body.category!==undefined&&body.category!==null){
  if(!text(body.category,80))throw bad('Check the category.');
  out.category=body.category.trim();
 }
 return out;
}

const ERRORS={
 NOT_ALLOWED:[403,'You cannot record costs on investor-funded cars.'],
 REQUEST_CHANGED:[409,'Retry the original save before changing it.'],
 NOT_INVESTOR_FUNDED:[409,'This car is not investor-funded. Add the cost from the normal car screen.'],
 MISC_CHANGED_REVIEW_REQUIRED:[409,'This cost was already recorded with different details. Ask the Director to correct it.'],
 MISC_COSTS_REVIEW_REQUIRED:[409,'This car\'s other costs need Director review first. No changes were made.'],
 CAR_SETTLED_ADJUSTMENT_REQUIRED:[409,'This car is already settled. Ask the Director to record an adjustment.'],
 INVALID:[400,'Check the cost details and try again.'],
};
const UNCONFIRMED=()=>new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same save reference.');

function validMisc(m,data){
 if(!m||typeof m!=='object'||Array.isArray(m))return false;
 const allowed=['id','description','amount','merchant','category','createdAt','createdBy'];
 if(Object.keys(m).some(k=>!allowed.includes(k)))return false;
 return m.id===data.miscId&&typeof m.description==='string'&&typeof m.merchant==='string'&&typeof m.amount==='number'&&Number.isFinite(m.amount)&&m.amount>0
  &&typeof m.createdAt==='string'&&!Number.isNaN(Date.parse(m.createdAt))&&typeof m.createdBy==='string'&&(m.category===undefined||typeof m.category==='string');
}

export async function handleInvestorMiscCost(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(user.registration_status!=='active'||!ROLES.includes(user.role)||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','You cannot record costs on investor-funded cars.');
 const raw=readJson(req,BODY_MAX);
 if(Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(raw))>BODY_MAX)throw new ApiError(413,'INVALID','Request is too large.');
 if(raw.scope!==SCOPE||raw.action!=='record_misc')throw bad('Choose a valid action.');
 const {scope,action,...body}=raw;
 const data=validateRecordMisc({action,...body});
 if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1'||deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Investor cost saving is not activated yet. No changes were made.');
 const hit=await ctx.repo.throttleHit('invest:'+createHash('sha256').update(user.id).digest('hex'),90,900);
 if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
 const out=await ctx.repo.rpc('uc_record_investor_misc',{p_actor:user.id,p_data:data});
 if(out.error){
  for(const [code,[status,message]] of Object.entries(ERRORS))if(out.error.message?.includes(code))throw new ApiError(status,code,message);
  if(out.error.message?.includes('IMMUTABLE_HISTORY')||out.error.message?.includes('MISC_COMMAND_REQUIRED'))throw new ApiError(409,'MISC_CHANGED_REVIEW_REQUIRED',ERRORS.MISC_CHANGED_REVIEW_REQUIRED[1]);
  if(['22007','22008','22P02','23514','22003','23502'].includes(out.error.code))throw bad('Check the cost details and try again.');
  throw UNCONFIRMED();
 }
 const d=out.data;
 if(!d||typeof d!=='object'||d.carId!==data.carId||!validMisc(d.misc,data)||typeof d.billId!=='string'||!d.billId||typeof d.alreadyRecorded!=='boolean')throw UNCONFIRMED();
 return {status:200,body:{carId:d.carId,misc:d.misc,billId:d.billId,alreadyRecorded:d.alreadyRecorded}};
});}
