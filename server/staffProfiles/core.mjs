import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {createHash} from 'node:crypto';
export async function handleStaffProfiles(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(!['director','admin'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Director or admin access is required.');
 const rate=await ctx.repo.throttleHit('staff-profile:'+createHash('sha256').update(user.id).digest('hex'),120,900);if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Please wait and try again.');
 const data=readJson(req,12000);onlyKeys(data,['action','id','revision','data','lastWorkingDate']);
 if(!['directory','get','save','leave','restore'].includes(data.action)||data.action!=='directory'&&(typeof data.id!=='string'||!data.id||data.id.length>100))throw new ApiError(400,'INVALID','Choose a staff member.');
 if(['save','leave','restore'].includes(data.action)&&(!Number.isInteger(data.revision)||data.revision<0))throw new ApiError(400,'INVALID','Reload the profile before saving.');
 if(['leave','restore'].includes(data.action)&&user.role!=='director')throw new ApiError(403,'FORBIDDEN','Only directors can change employment status.');
 if(data.lastWorkingDate!==undefined&&(typeof data.lastWorkingDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.lastWorkingDate)))throw new ApiError(400,'INVALID','Enter a valid last working date.');
 if(data.data?.joiningDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(data.data.joiningDate)))throw new ApiError(400,'INVALID','Enter a valid joining date.');
 const out=await ctx.repo.rpc('autodream_staff_profile_action',{p_action:data.action,p_actor:user.id,p_data:data});
 if(out.error){const m=out.error.message||'';if(m.includes('PROFILE_FORBIDDEN'))throw new ApiError(403,'FORBIDDEN','Use a verified director or admin account.');if(m.includes('PROFILE_CONFLICT'))throw new ApiError(409,'CONFLICT','This profile changed on another screen. Your draft is kept. Compare it with the latest version before saving.');if(m.includes('LAST_DIRECTOR'))throw new ApiError(409,'INVALID','Keep at least one enabled director.');if(m.includes('PROFILE_NOT_FOUND'))throw new ApiError(404,'NOT_FOUND','Staff member unavailable.');if(/INVALID|22[0-9A-Z]{3}/.test(m+' '+out.error.code))throw new ApiError(400,'INVALID','Check the profile details and dates.');throw new ApiError(503,'UNAVAILABLE','Staff profiles are unavailable. Please try again.');}
 return {status:200,body:out.data};
});}
