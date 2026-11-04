// Prepared handler only. The sales router must send scope 'investor_finance'
// action 'complete_repair' here before handleInvestorCapital.
// Completes a repair on an investor-funded car and raises ONE pending repair
// bill on that car in a single database transaction. No cash, payment or
// journal is written; the Director approves and pays the bill later through the
// existing car bill flow. Company-funded repairs keep the old browser flow.
import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';

const BODY_MAX=20_000;
const SCOPE='investor_finance';
const ROLES=['director','admin','mechanic'];
const MAX_CENTS=1_000_000_000_000;
const MAX_PARTS=100;
const ID=/^[A-Za-z0-9_-]{1,100}$/,REQ=/^[A-Za-z0-9_-]{16,80}$/;
const bad=message=>new ApiError(400,'INVALID',message);
const isCents=v=>Number.isSafeInteger(v)&&v>=0&&v<=MAX_CENTS;
// Ringgit with at most two decimals -> exact integer cents, or null.
const ringgitToCents=v=>{
 if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>MAX_CENTS/100)return null;
 const c=Math.round(v*100);return Math.abs(c-v*100)<1e-6&&isCents(c)?c:null;
};

/** Receipt must already be uploaded to this project's Supabase storage. Never fetched. */
export function trustedReceiptUrl(v,supabaseUrl){
 if(typeof v!=='string'||v.length>2000||!supabaseUrl)return false;
 let u,base;try{u=new URL(v);base=new URL(supabaseUrl);}catch{return false;}
 return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.host===base.host&&u.pathname.startsWith('/storage/v1/object/')&&!u.pathname.includes('..');
}

function validateBillDetails(d,amountCents){
 if(!d||typeof d!=='object'||Array.isArray(d))throw bad('Check the parts and labour.');
 onlyKeys(d,['parts','labourCostCents']);
 if(!Array.isArray(d.parts)||d.parts.length>MAX_PARTS)throw bad(`Enter up to ${MAX_PARTS} parts.`);
 if(!isCents(d.labourCostCents))throw bad('Check the labour cost.');
 let sum=d.labourCostCents;
 const parts=d.parts.map(p=>{
  if(!p||typeof p!=='object'||Array.isArray(p))throw bad('Check the parts list.');
  onlyKeys(p,['name','cost']);
  if(typeof p.name!=='string'||!p.name.trim()||p.name.length>200)throw bad('Enter a name for every part.');
  const c=ringgitToCents(p.cost);if(c===null)throw bad('Check the part prices.');
  sum+=c;return {name:p.name.trim(),cost:c/100};
 });
 if(sum!==amountCents)throw bad('The parts and labour do not add up to the repair cost.');
 return {parts,labourCostCents:d.labourCostCents};
}

export function validateCompleteRepair(body,supabaseUrl){
 onlyKeys(body,['action','repairId','amountCents','receiptPhoto','billDetails','requestId']);
 if(typeof body.repairId!=='string'||!ID.test(body.repairId))throw bad('Open the repair again.');
 if(typeof body.requestId!=='string'||!REQ.test(body.requestId))throw bad('A save reference is required.');
 if(!isCents(body.amountCents))throw bad('Check the repair cost.');

 const out={repairId:body.repairId,amountCents:body.amountCents,requestId:body.requestId};
 if(body.receiptPhoto!==undefined&&body.receiptPhoto!==null){
  if(!trustedReceiptUrl(body.receiptPhoto,supabaseUrl))throw bad('Upload the receipt photo again.');
  out.receiptPhoto=body.receiptPhoto;
 }
 if(body.billDetails!==undefined&&body.billDetails!==null)out.billDetails=validateBillDetails(body.billDetails,body.amountCents);
 return out;
}

const ERRORS={
 NOT_ALLOWED:[403,'You cannot complete repairs on investor-funded cars.'],
 REQUEST_CHANGED:[409,'Retry the original save before changing it.'],
 REPAIR_NOT_FOUND:[404,'This repair could not be found. Refresh and try again.'],
 NOT_INVESTOR_FUNDED:[409,'This car is not investor-funded. Complete the repair from the normal repair screen.'],
 REPAIR_CHANGED_REVIEW_REQUIRED:[409,'This repair was already completed with a different cost. Ask the Director to correct it.'],
 REPAIR_REVIEW_REQUIRED:[409,'This repair is already marked done without a bill. Ask the Director to review it.'],
 REPAIR_LOCATION_REQUIRED:[409,'Set the workshop on this repair before completing it.'],
 CAR_SETTLED_ADJUSTMENT_REQUIRED:[409,'This car is already settled. Ask the Director to record an adjustment.'],
 ZERO_COST_REVIEW_REQUIRED:[409,'A free repair on an investor car needs Director review. No changes were made.'],
 REPAIR_BUSY:[409,'This repair is being saved by someone else. Try again.'],
 INVALID:[400,'Check the repair details and try again.'],
};

export async function handleInvestorRepairCompletion(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(user.registration_status!=='active'||!ROLES.includes(user.role)||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','You cannot complete repairs on investor-funded cars.');
 const raw=readJson(req,BODY_MAX);
 if(Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(raw))>BODY_MAX)throw new ApiError(413,'INVALID','Request is too large.');
 if(raw.scope!==SCOPE||raw.action!=='complete_repair')throw bad('Choose a valid action.');
 const {scope,action,...body}=raw;
 const data=validateCompleteRepair({action,...body},deps.env.SUPABASE_URL);
 if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1'||deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Investor repair saving is not activated yet. No changes were made.');
 const hit=await ctx.repo.throttleHit('invest:'+createHash('sha256').update(user.id).digest('hex'),90,900);
 if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
 const out=await ctx.repo.rpc('uc_complete_investor_repair',{p_actor:user.id,p_data:data});
 if(out.error){
  for(const [code,[status,message]] of Object.entries(ERRORS))if(out.error.message?.includes(code))throw new ApiError(status,code,message);
  if(out.error.message?.includes('IMMUTABLE_HISTORY'))throw new ApiError(409,'REPAIR_CHANGED_REVIEW_REQUIRED',ERRORS.REPAIR_CHANGED_REVIEW_REQUIRED[1]);
  if(['22007','22008','22P02','23514','22003','23502'].includes(out.error.code))throw bad('Check the repair details and try again.');
  throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same save reference.');
 }
 const d=out.data;
 if(!d||typeof d!=='object'||!d.repair||(d.billId!==null&&typeof d.billId!=='string')||typeof d.alreadyRecorded!=='boolean')throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same save reference.');
 return {status:200,body:{repair:d.repair,billId:d.billId,alreadyRecorded:d.alreadyRecorded}};
});}
