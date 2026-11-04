import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
const FIELDS={submit:['carId','claimKind','category','purpose','payee','amountCents','requestId'],list:['page','state','carId','mine'],details:['claimId'],approve:['claimId','requestId'],reject:['claimId','note','requestId']};
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const bad=message=>new ApiError(400,'INVALID',message);
const ERRORS={NOT_ALLOWED:[403,'You cannot open or review this claim.'],DIRECTOR_APPROVAL_REQUIRED:[403,'The Director must approve this claim.'],NOT_INVESTOR_FUNDED:[409,'Use the normal claim form for this car.'],CAR_SETTLED_ADJUSTMENT_REQUIRED:[409,'This car is already settled. The Director must review a correction.'],CLAIM_LIMIT:[409,'Review the waiting claims before submitting more.'],REQUEST_CHANGED:[409,'Retry the original claim details before changing them.'],SUPPLIER_INVOICE_REQUIRED:[409,'Upload the supplier invoice before approving this claim.'],ALREADY_REVIEWED:[409,'This claim has already been reviewed. Refresh its status.'],REASON_REQUIRED:[400,'Enter a reason for rejecting the claim.'],IMMUTABLE_HISTORY:[409,'Keep this claim history. Ask the Director to review a correction.']};
function safeClaim(c){
 if(!c||!uuid(c.claimId)||!uuid(c.billId)||typeof c.carId!=='string'||!Number.isSafeInteger(c.amountCents)||c.amountCents<=0)throw new ApiError(503,'UNAVAILABLE','Could not confirm the saved claim. Retry the original save.');
 const keys=['claimId','billId','carId','claimKind','category','purpose','payee','amountCents','paidCents','state','supplierInvoiceConfirmed','submittedAt','claimantName','mine','reviewedAt','reviewNote'];
 const out=Object.fromEntries(keys.filter(k=>c[k]!==undefined).map(k=>[k,c[k]]));
 if(c.car)out.car={make:c.car.make,model:c.car.model,year:c.car.year,plate:c.car.plate};
 out.documents=(Array.isArray(c.documents)?c.documents:[]).filter(d=>uuid(d.id)&&typeof d.name==='string').map(d=>({id:d.id,name:d.name}));
 return out;
}
export async function handleInvestorClaims(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(!['director','admin','salesperson','mechanic'].includes(user.role)||user.registration_status!=='active'||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','Used Car staff access is required.');
 const body=readJson(req,12000);if(body.scope!=='investor_claims'||!Object.hasOwn(FIELDS,body.action))throw bad('Choose a valid claim action.');
 onlyKeys(body,['scope','action',...FIELDS[body.action]]);const {scope,action,...data}=body;
 if(action==='approve'&&user.role!=='director')throw new ApiError(403,'DIRECTOR_APPROVAL_REQUIRED',ERRORS.DIRECTOR_APPROVAL_REQUIRED[1]);
 if(action==='reject'&&!['director','admin'].includes(user.role))throw new ApiError(403,'FORBIDDEN','A Director or admin must review this claim.');
 if(['submit','approve','reject'].includes(action)&&(typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(data.requestId)))throw bad('A save reference is required.');
 if(['details','approve','reject'].includes(action)&&!uuid(data.claimId))throw bad('Open the claim again.');
 if(data.carId!==undefined&&(typeof data.carId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(data.carId)))throw bad('Choose a valid car.');
 if(action==='submit'){
  if(!data.carId||!['repair','misc'].includes(data.claimKind)||!text(data.purpose,300)||!text(data.payee,150)||!Number.isSafeInteger(data.amountCents)||data.amountCents<1||data.amountCents>1e12||data.category!==undefined&&!text(data.category,80))throw bad('Check the car, cost, purpose and person to pay.');
  data.purpose=data.purpose.trim();data.payee=data.payee.trim();if(data.category!==undefined)data.category=data.category.trim();
 }
 if(action==='reject'&&!text(data.note,500))throw bad('Enter the reason for rejecting this claim.');
 if(action==='list'&&(data.page!==undefined&&(!Number.isInteger(data.page)||data.page<0||data.page>1000)||data.state!==undefined&&!['pending','approved','rejected'].includes(data.state)||data.mine!==undefined&&typeof data.mine!=='boolean'))throw bad('Reload the claim list.');
 if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1'||deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Investor claims are not switched on yet. Nothing was saved.');
 const rate=await ctx.repo.throttleHit('invclm:'+createHash('sha256').update(user.id).digest('hex'),120,900);if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment before trying again.');
 const out=await ctx.repo.rpc('uc_investor_claims',{p_actor:user.id,p_action:action,p_data:data});
 if(out.error){for(const [code,[status,message]]of Object.entries(ERRORS))if(out.error.message?.includes(code))throw new ApiError(status,code,message);if(out.error.message?.includes('INVALID')||['22003','22P02','23514'].includes(out.error.code))throw bad('Check the claim details.');throw new ApiError(503,'UNAVAILABLE','Could not confirm the claim. Retry the original save.');}
 if(action==='list')return {status:200,body:{claims:(out.data?.claims??[]).map(safeClaim),hasMore:out.data?.hasMore===true,page:data.page??0}};
 return {status:200,body:{claim:safeClaim(out.data?.claim),alreadyRecorded:out.data?.alreadyRecorded===true}};
});}
