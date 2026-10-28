import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
const ROLES=['garage_installer','garage_detailer','garage_spray','garage_head','garage_salesman','director','shareholder'];
const ACTIONS=['snapshot','notices','claim','release','complete','reopen','remark','sqft','start','eta','confirm','head_approve','head_return','sales_approve','sales_return','pay','deliver','warranty','receipt'];
export async function handleInstallation(req,deps){
 return respond(req,deps,['POST'],async(ctx,res)=>{
  const {user}=await authenticate(req,ctx,res,canUseApp);
  if(!['garage','both'].includes(user.business_access)||!ROLES.includes(user.role))throw new ApiError(403,'FORBIDDEN','Garage access is required.');
  const data=readJson(req,16000);onlyKeys(data,['action','jobId','itemId','invoiceId','revision','requestId','value','reason','itemIds']);
  if(!ACTIONS.includes(data.action))throw new ApiError(400,'INVALID','Choose a valid workshop action.');
  if(['pay','deliver','warranty','receipt'].includes(data.action)&&!['garage_salesman','garage_head','director','shareholder'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Workshop staff cannot perform sales actions.');
  const reading=['snapshot','notices'].includes(data.action);
  if(!reading&&(!Number.isSafeInteger(data.revision)||data.revision<0||typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(data.requestId)))throw new ApiError(400,'INVALID','Refresh this work order before trying again.');
  for(const k of ['jobId','itemId','invoiceId'])if(data[k]!==undefined&&(typeof data[k]!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(data[k])))throw new ApiError(400,'INVALID','Invalid work order reference.');
  if(data.reason!==undefined&&(typeof data.reason!=='string'||data.reason.length>2000))throw new ApiError(400,'INVALID','Use a shorter reason.');
  if(data.itemIds!==undefined&&(!Array.isArray(data.itemIds)||data.itemIds.length>100||data.itemIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id))))throw new ApiError(400,'INVALID','Choose the affected pieces.');
  if(['head_approve','head_return','eta'].includes(data.action)&&user.role!=='garage_head')throw new ApiError(403,'FORBIDDEN','Only Garage Head can do that.');
  if(['head_approve','sales_approve'].includes(data.action)&&data.value!==true)throw new ApiError(400,'INVALID','Confirm that you inspected the finished work.');
  if(data.action==='sqft'&&(typeof data.value!=='number'||!Number.isFinite(data.value)||data.value<0||data.value>10000))throw new ApiError(400,'INVALID','Enter valid film usage.');
  if(data.action==='remark'&&(typeof data.value!=='string'||data.value.length>2000))throw new ApiError(400,'INVALID','Use a shorter remark.');
  if(data.action==='receipt'&&(!data.value||typeof data.value!=='object'||Array.isArray(data.value)||typeof data.value.path!=='string'||typeof data.value.name!=='string'||data.value.path.length>1000||data.value.name.length>255))throw new ApiError(400,'INVALID','Check the receipt file.');
  const rate=await ctx.repo.throttleHit('install:'+createHash('sha256').update(user.id).digest('hex'),500,900);if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment before trying again.');
  const r=await ctx.repo.rpc('garage_installation_workflow',{p_actor:user.id,p_action:data.action,p_data:data});
  if(r.error){const m=r.error.message||'';
   if(m.includes('NOT_ALLOWED'))throw new ApiError(403,'FORBIDDEN','This action is not available for your account.');
   if(m.includes('REVISION_CONFLICT')||m.includes('REQUEST_CHANGED'))throw new ApiError(409,'CONFLICT','This job changed. Refresh and check it before trying again.');
   if(m.includes('DAMAGE_REVIEW_REQUIRED'))throw new ApiError(409,'DAMAGE_REVIEW_REQUIRED','Garage Head must review all open damage reports before handover.');
   if(m.includes('FILM_USAGE_REQUIRED'))throw new ApiError(409,'FILM_USAGE_REQUIRED','Record the film used for this installation attempt before marking this glass complete.');
   if(m.includes('FILM_USAGE_CANNOT_DECREASE'))throw new ApiError(409,'FILM_USAGE_CANNOT_DECREASE','Previously used film cannot be returned by lowering usage. Ask management to record an audited stock correction.');
   if(m.includes('PAYMENT_LEDGER_REQUIRED')||m.includes('PAYMENT_NOT_VERIFIED'))throw new ApiError(409,'PAYMENT_NOT_VERIFIED','Record payments under Payment tracking and have a director/admin verify company receipt before handover.');
   const messages={ALREADY_PAID:'Payment was already recorded. Refresh this work order.',CANNOT_TAKE_PAYMENT:'Payment cannot be recorded at this stage.',NOT_READY_FOR_DELIVERY:'The car is not ready for delivery.',NOT_IN_PROGRESS:'The job changed. Refresh before working on this piece.',GLASS_ALREADY_TAKEN:'This piece has already been claimed. Refresh to see its installer.',GLASS_HAS_FILM_LOGGED:'Clear recorded film usage before releasing a piece.',NOT_YOUR_GLASS:'Only the original installer can change this piece.',INSUFFICIENT_FILM_STOCK:'There is not enough film recorded in stock. Check with Garage Head.',OWN_WORK_INCOMPLETE:'Finish your own pieces before confirming.',NOT_READY:'This job is not ready for that step.',REASON_REQUIRED:'Add a reason and select the affected pieces.',ORIGINAL_INSTALLER:'Correction work stays with the original installer.',INSPECTION_REQUIRED:'Complete both inspections before delivery.',INVALID:'Check the details and try again.'};
   for(const [key,message] of Object.entries(messages))if(m.includes(key))throw new ApiError(409,key,message);
   if(['22P02','22003','22007','22008'].includes(r.error.code))throw new ApiError(400,'INVALID','Check the entered details.');
   throw new ApiError(503,'UNAVAILABLE','Could not confirm the result. Refresh this work order before trying again.');
  }
  return {status:200,body:r.data};
 });
}
