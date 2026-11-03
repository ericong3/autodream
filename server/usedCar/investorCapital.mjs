// Prepared handler only. No hosted route is wired to it in this phase.
import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
const fields={
 create_profile:['name','requestId'],link_account:['potId','staffId','requestId'],snapshot:['potId'],
 capital_received:['potId','amountCents','paidOn','bankAccount','bankReference','requestId'],
 request_withdrawal:['potId','amountCents','requestId'],approve_withdrawal:['potId','withdrawalId','requestId'],
 reject_withdrawal:['potId','withdrawalId','note','requestId'],withdrawal_paid:['potId','withdrawalId','paidOn','bankAccount','bankReference','requestId'],
 cancel_withdrawal:['potId','withdrawalId','note','requestId'],
};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function handleInvestorCapital(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(!['director','investor'].includes(user.role)||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','This account cannot open investor records.');
 const body=readJson(req,4096),allowed=Object.hasOwn(fields,body.action)?fields[body.action]:null;
 if(!allowed)throw new ApiError(400,'INVALID','Choose a valid action.');
 if(user.role!=='director'&&!['snapshot','request_withdrawal'].includes(body.action))throw new ApiError(403,'FORBIDDEN','A Director must approve this action.');
 if(user.role!=='investor'&&body.action==='request_withdrawal')throw new ApiError(403,'FORBIDDEN','The investor must request their own withdrawal.');
 onlyKeys(body,['action',...allowed]);
 const ownSnapshot=body.action==='snapshot'&&user.role==='investor'&&body.potId===undefined;
 if(body.action!=='create_profile'&&!ownSnapshot&&!uuid(body.potId)||body.withdrawalId!==undefined&&!uuid(body.withdrawalId))throw new ApiError(400,'INVALID','Open the account again.');
 if(body.action!=='snapshot'&&(typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(body.requestId)))throw new ApiError(400,'INVALID','A save reference is required.');
 if(body.amountCents!==undefined&&(!Number.isSafeInteger(body.amountCents)||body.amountCents<1||body.amountCents>1000000000000))throw new ApiError(400,'INVALID','Enter a valid amount.');
 if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1')throw new ApiError(503,'SETUP','Investor saving is not activated yet. No changes were made.');
 const hit=await ctx.repo.throttleHit('invest:'+createHash('sha256').update(user.id).digest('hex'),90,900);
 if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
 const {action,...data}=body;
 const out=await ctx.repo.rpc('uc_investor_capital',{p_actor:user.id,p_action:action,p_data:data});
 if(out.error){
  const mappings={NOT_ALLOWED:[403,'You cannot open or change this record.'],REQUEST_CHANGED:[409,'Retry the original save before changing it.'],INSUFFICIENT_FUNDS:[409,'There is not enough money available.'],ALREADY_LINKED:[409,'This investor already has a linked account.'],INVALID_INVESTOR_ACCOUNT:[400,'Choose an active investor account.'],ALREADY_REVIEWED:[409,'This request has already been checked.'],APPROVAL_REQUIRED:[409,'The Director must approve this withdrawal first.'],REASON_REQUIRED:[400,'Enter a reason.'],FUTURE_PAYMENT:[400,'Choose the date the payment was made.'],INVALID:[400,'Check the details and try again.']};
  for(const [code,[status,message]] of Object.entries(mappings))if(out.error.message?.includes(code))throw new ApiError(status,code,message);
  if(out.error.code==='23505')throw new ApiError(409,'DUPLICATE','This account or payment reference is already recorded.');
  if(out.error.message?.includes('BALANCE_LIMIT'))throw new ApiError(409,'BALANCE_LIMIT','This amount exceeds the account limit. Ask the Director to review it.');
  if(out.error.message?.includes('PAYMENT_BEFORE_APPROVAL'))throw new ApiError(400,'INVALID','Payment cannot be dated before the withdrawal approval.');
  if(['22007','22008','22P02','23514','22003'].includes(out.error.code))throw new ApiError(400,'INVALID','Check the amount and payment date.');
  throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same save reference.');
 }
 return {status:200,body:out.data};
});}
