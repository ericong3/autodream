import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const errors={NOT_ALLOWED:[403,'Only the Director can choose trade-in funding.'],FUNDING_CHOICE_REQUIRED:[400,'Choose the company pot or an investor pot.'],INVALID_INVESTOR_ACCOUNT:[400,'Choose an existing investor pot.'],NOT_A_TRADE_IN:[409,'This car has no linked trade-in deal.'],CHOICE_CHANGED:[409,'The funding choice changed. Refresh it before saving.'],REASON_REQUIRED:[400,'Enter why the funding choice is changing.'],TRADE_IN_FUNDING_LOCKED:[409,'This car already has financial history. The Director must review a correction.'],TRADE_IN_HISTORY_REVIEW_REQUIRED:[409,'Review the existing trade-in postings before changing funding.'],NEGATIVE_EQUITY_REVIEW_REQUIRED:[409,'The lender balance is higher than the trade-in value. Review who pays that difference first.'],TRADE_IN_VALUE_REQUIRED:[400,'Set the agreed trade-in value first.'],REQUEST_CHANGED:[409,'Retry the original funding choice before changing its details.']};
export async function handleTradeInFunding(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(user.role!=='director'||user.business_access!=='both'||user.registration_status!=='active')throw new ApiError(403,'FORBIDDEN',errors.NOT_ALLOWED[1]);
 const raw=readJson(req,6000);if(raw.scope!=='trade_in_funding'||!['snapshot','choose'].includes(raw.action))throw new ApiError(400,'INVALID','Choose a valid action.');
 onlyKeys(raw,['scope','action','incomingCarId',...(raw.action==='choose'?['fundingKind','potId','investorBasisPoints','expectedChoiceId','reason','requestId']:[])]);
 const {scope,action,...data}=raw;
 const bad=()=>new ApiError(400,'INVALID','Check the trade-in and funding choice.');
 if(typeof data.incomingCarId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(data.incomingCarId))throw bad();
 if(action==='choose'){
  if(!['company','investor'].includes(data.fundingKind)||typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(data.requestId))throw bad();
  if(data.fundingKind==='investor'&&(!uuid(data.potId)||!Number.isInteger(data.investorBasisPoints)||data.investorBasisPoints<0||data.investorBasisPoints>10000))throw bad();
  if(data.fundingKind==='company'&&(data.potId!==undefined||data.investorBasisPoints!==undefined)||data.expectedChoiceId!==undefined&&!uuid(data.expectedChoiceId)||data.reason!==undefined&&(typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>500))throw bad();
 }
 if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1'||deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Trade-in funding is not switched on yet. Nothing was saved.');
 const hit=await ctx.repo.throttleHit('uctrade:'+createHash('sha256').update(user.id).digest('hex'),120,900);if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
 const out=await ctx.repo.rpc('uc_trade_in_funding',{p_actor:user.id,p_action:action,p_data:data});
 if(out.error){for(const [code,[status,message]]of Object.entries(errors))if(out.error.message?.includes(code))throw new ApiError(status,code,message);if(out.error.message?.includes('INVALID')||['22003','22P02','23514'].includes(out.error.code))throw bad();throw new ApiError(503,'UNAVAILABLE','Could not confirm the choice. Retry the original save.');}
 const choice=out.data?.choice;
 const validRecord=choice!==null&&typeof choice==='object'&&uuid(choice.id)&&choice.incomingCarId===data.incomingCarId&&['company','investor'].includes(choice.fundingKind);
 const validSnapshot=!!out.data&&Object.hasOwn(out.data,'choice')&&(choice===null||validRecord);
 const matchesSave=validRecord&&choice.fundingKind===data.fundingKind&&(data.fundingKind==='company'?choice.potId==null:choice.potId===data.potId&&choice.investorBasisPoints===data.investorBasisPoints);
 if(!validSnapshot||action==='choose'&&!matchesSave)throw new ApiError(503,'UNAVAILABLE','Could not confirm the choice. Retry the original save.');
 return {status:200,body:{choice:out.data.choice,...(action==='snapshot'?{history:Array.isArray(out.data.history)?out.data.history:[]}: {})}};
});}
