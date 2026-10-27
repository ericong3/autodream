import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {createHash} from 'node:crypto';
const salesRoles=new Set(['director','garage_salesman','garage_head','shareholder']);
export async function handleEnquiries(req,deps){
 return respond(req,deps,['GET','POST'],async(ctx,res)=>{
  if(deps.env.GARAGE_ENQUIRIES_ONLINE!=='1')throw new ApiError(503,'SETUP','Enquiries will open after the staff account rollout. Existing sales remain available.');
  const {user}=await authenticate(req,ctx,res,canUseApp);
  const data=req.method==='GET'?{action:'list'}:readJson(req,16000);
  const workshopCustomer=data.action==='customer_get'&&['garage_installer','garage_detailer','garage_spray'].includes(user.role);
  if(!['garage','both'].includes(user.business_access)||(!salesRoles.has(user.role)&&!workshopCustomer))throw new ApiError(403,'FORBIDDEN','Garage sales access is required.');
  const rate=await ctx.repo.throttleHit('enquiry:'+createHash('sha256').update(user.id).digest('hex'),300,900);
  if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Too many enquiry requests. Wait a moment and try again.');
  onlyKeys(data,['action','id','revision','customerId','name','phone','separatePerson','services','asset','nextAction','reminderDate','status','service','page','icNumber','email']);
  if(!['list','get','due','customers','customer_get','customer_ic','customer_create','customer_complete','create','update'].includes(data.action))throw new ApiError(400,'INVALID','Unknown enquiry action.');
  if(data.action==='customers'&&(typeof data.name!=='string'||data.name.trim().length<2||data.name.length>100))throw new ApiError(400,'INVALID','Enter at least two characters.');
  if(data.page!==undefined&&(!Number.isInteger(data.page)||data.page<0||data.page>100000))throw new ApiError(400,'INVALID','Choose a valid page.');
  if(data.action==='update'&&(!Number.isInteger(data.revision)||data.revision<1||data.revision>2147483647))throw new ApiError(400,'INVALID','Reload this enquiry before editing.');
  if(data.separatePerson!==undefined&&typeof data.separatePerson!=='boolean')throw new ApiError(400,'INVALID','Confirm whether this is a different person.');
  const result=await ctx.repo.rpc('garage_enquiry_action',{p_actor:user.id,p_action:data.action,p_data:data});
  if(result.error){
   const message=result.error.message||'';
   if(message.includes('REVISION_CONFLICT'))throw new ApiError(409,'CONFLICT','This enquiry changed on another screen. Reload before saving.');
   if(message.includes('CUSTOMER_MATCH'))throw new ApiError(409,'CUSTOMER_MATCH','A customer uses this phone number. Choose their profile, or confirm this is a different person.');
   if(message.includes('NOT_ALLOWED'))throw new ApiError(404,'NOT_FOUND','Enquiry unavailable.');
   if(message.includes('INVALID'))throw new ApiError(400,'INVALID','Check the enquiry details.');
   if(['42883','42P01','42703'].includes(result.error.code))throw new ApiError(503,'SETUP','Enquiry saving is being prepared. Existing sales remain available.');
   throw new ApiError(502,'CLOUD','Could not save the enquiry. Try again.');
  }
  return {status:data.action==='create'?201:200,body:result.data};
 });
}
