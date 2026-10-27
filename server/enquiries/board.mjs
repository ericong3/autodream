import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {createHash} from 'node:crypto';
export async function handleEnquiryBoard(req,deps){
 return respond(req,deps,['GET','POST'],async(ctx,res)=>{
  if(deps.env.GARAGE_ENQUIRIES_ONLINE!=='1')throw new ApiError(503,'SETUP','Follow-ups are being prepared.');
  const {user}=await authenticate(req,ctx,res,canUseApp);
  if(!['garage','both'].includes(user.business_access)||!['director','shareholder','garage_head','garage_salesman'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Garage sales access is required.');
  const rate=await ctx.repo.throttleHit('board:'+createHash('sha256').update(user.id).digest('hex'),300,900);
  if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Please wait a moment before saving again.');
  const data=req.method==='GET'?{action:'get'}:readJson(req,220000);
  onlyKeys(data,['action','revision','preferences','accountId']);
  if(data.action==='save'&&data.accountId!==user.id)throw new ApiError(409,'ACCOUNT_CHANGED','Your signed-in account changed. Reload before saving.');
  if(!['get','save'].includes(data.action)||data.action==='save'&&(!Number.isInteger(data.revision)||data.revision<0))throw new ApiError(400,'INVALID','Reload your board before saving.');
  const {accountId,...payload}=data;
  const result=await ctx.repo.rpc('garage_enquiry_board_action',{p_actor:user.id,p_action:data.action,p_data:payload});
  if(result.error){const message=result.error.message||'';
   if(message.includes('REVISION_CONFLICT'))throw new ApiError(409,'CONFLICT','Your board changed on another device. Reload to see the saved arrangement.');
   if(message.includes('NOT_ALLOWED'))throw new ApiError(403,'FORBIDDEN','This board is unavailable.');
   if(message.includes('INVALID'))throw new ApiError(400,'INVALID','Check your column names and board settings.');
   throw new ApiError(503,'CLOUD','Could not save your board. Your changes are still on this screen.');
  }
  return {status:200,body:result.data};
 });
}
