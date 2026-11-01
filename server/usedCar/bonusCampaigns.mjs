import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
export function isBonusCampaignRequest(req){try{return (typeof req.body==='string'?JSON.parse(req.body):req.body)?.scope==='bonus_campaigns';}catch{return false;}}
export async function handleBonusCampaigns(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(!['director','shareholder'].includes(user.role)||!['both','used_car'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','Used Car payroll access is required.');
 const b=readJson(req,20000),month=v=>typeof v==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(v),id=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
 if(b.action==='list'){
  onlyKeys(b,['scope','action','page']);if(b.page!==undefined&&(!Number.isInteger(b.page)||b.page<0||b.page>99999))throw new ApiError(400,'INVALID','Reload the campaigns.');
 }else if(b.action==='save'){
  onlyKeys(b,['scope','action','requestId','id','revision','campaign']);const c=b.campaign;
  if(!c||typeof c!=='object'||Array.isArray(c))throw new ApiError(400,'INVALID','Complete the campaign.');
  onlyKeys(c,['title','startMonth','endMonth','minimumUnits','amountPerUnit','participantIds']);
  if(typeof c.title!=='string'||!c.title.trim()||c.title.length>120||!month(c.startMonth)||!month(c.endMonth)||c.startMonth>c.endMonth||!Number.isInteger(c.minimumUnits)||c.minimumUnits<1||c.minimumUnits>10000||typeof c.amountPerUnit!=='number'||!Number.isFinite(c.amountPerUnit)||c.amountPerUnit<0||c.amountPerUnit>100000||Math.abs(c.amountPerUnit*100-Math.round(c.amountPerUnit*100))>0.00001||!Array.isArray(c.participantIds)||!c.participantIds.length||c.participantIds.length>200||new Set(c.participantIds).size!==c.participantIds.length||c.participantIds.some(v=>typeof v!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(v)))throw new ApiError(400,'INVALID','Check the dates, target, amount and enrolled salespeople.');
  if(b.id!==undefined&&(!id(b.id)||!Number.isInteger(b.revision)||b.revision<1))throw new ApiError(400,'INVALID','Reopen this campaign before editing.');
 }else if(['publish','preview','confirm_month'].includes(b.action)){
  onlyKeys(b,b.action==='preview'?['scope','action','id','month']:b.action==='publish'?['scope','action','id','revision','requestId']:['scope','action','id','month','requestId','previewHash']);
  if(!id(b.id)||b.action!=='publish'&&!month(b.month)||b.action==='publish'&&(!Number.isInteger(b.revision)||b.revision<1)||b.action==='confirm_month'&&(typeof b.previewHash!=='string'||!/^[a-f0-9]{32}$/.test(b.previewHash)))throw new ApiError(400,'INVALID','Check the campaign and month.');
 }else throw new ApiError(400,'INVALID','Choose a valid campaign action.');
 if(!['list','preview'].includes(b.action)&&user.role!=='director')throw new ApiError(403,'FORBIDDEN','A director must change campaign rules or confirm results.');
 if(b.action==='save'){const c=b.campaign,start=c.startMonth.split('-').map(Number),end=c.endMonth.split('-').map(Number);if((end[0]-start[0])*12+end[1]-start[1]>=60)throw new ApiError(400,'INVALID','Keep one campaign within 60 months.');}
 if(b.action!=='list'&&b.action!=='preview'&&(typeof b.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(b.requestId)))throw new ApiError(400,'INVALID','A save reference is required.');
 if(deps.env.USED_CAR_BONUS_CAMPAIGNS_ONLINE!=='1'){
  if(b.action==='list')return {status:200,body:{enabled:false,campaigns:[],participants:[],hasMore:false}};
  throw new ApiError(503,'SETUP','Bonus campaigns are waiting for activation. Your details are kept.');
 }
 const hit=await ctx.repo.throttleHit('bonus:'+createHash('sha256').update(user.id).digest('hex'),120,900);
 if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment before trying again.');
 const {scope,action,...data}=b;
 const r=await ctx.repo.rpc('used_car_bonus_campaign',{p_actor:user.id,p_action:action,p_data:data});
 if(r.error){
  const errors={NOT_ALLOWED:[403,'This campaign is unavailable for your account.'],REQUEST_CHANGED:[409,'Retry the original save before changing its details.'],REVISION_CONFLICT:[409,'This campaign changed. Reopen it before saving.'],PUBLISHED_LOCKED:[409,'Published rules stay fixed. Copy this campaign to create different rules.'],PREVIEW_CHANGED:[409,'Sales or enrolment changed. Review the updated monthly result before confirming.'],DELIVERY_REVIEW_REQUIRED:[409,'Resolve the listed delivery records before confirming this month.'],FUTURE_MONTH:[409,'Wait until the month has ended before confirming its bonus.'],INVALID:[400,'Check the campaign details.']};
  for(const [code,[status,message]] of Object.entries(errors))if(r.error.message?.includes(code))throw new ApiError(status,code,message);
  if(['22P02','23514','22003','22007','22008'].includes(r.error.code))throw new ApiError(400,'INVALID','Check the campaign dates, amounts and enrolment.');
  throw new ApiError(503,'UNAVAILABLE','The result could not be confirmed. Retry the same save before entering it again.');
 }
 return {status:200,body:r.data};
});}
