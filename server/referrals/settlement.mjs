import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys,parseCookies} from '../garageBuilding/core.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
export function isReferralSettlementRequest(req){try{return (typeof req.body==='string'?JSON.parse(req.body):req.body)?.scope==='referral_settlement';}catch{return false;}}
export async function handleReferralSettlement(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const b=readJson(req,6000),partner=b.action==='partner_month';
 const fields={month:['month'],partner_month:['month'],snapshot:['invoiceId'],release:['invoiceId','requestId','note'],report_transfer:['invoiceId','requestId','amount','reference'],accept_transfer:['invoiceId','requestId','transferId'],reject_transfer:['invoiceId','requestId','transferId','note'],payout:['invoiceId','requestId','amount','reference','paidOn']};
 if(!fields[b.action])throw new ApiError(400,'INVALID','Choose a valid referral action.');
 onlyKeys(b,['scope','action',...fields[b.action]]);
 if(['month','partner_month'].includes(b.action)&&!(typeof b.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month)))throw new ApiError(400,'INVALID','Choose a month.');
 for(const key of ['invoiceId','requestId','transferId'])if(fields[b.action].includes(key)&&!(typeof b[key]==='string'&&new RegExp(key==='requestId'?'^[A-Za-z0-9_-]{16,64}$':'^[A-Za-z0-9_-]{1,80}$').test(b[key])))throw new ApiError(400,'INVALID','Reload the order and try again.');
 if(fields[b.action].includes('amount')&&!(typeof b.amount==='number'&&Number.isFinite(b.amount)&&b.amount>0&&b.amount<=100000000&&Math.abs(b.amount*100-Math.round(b.amount*100))<0.00001))throw new ApiError(400,'INVALID','Enter a positive amount with at most two decimal places.');
 for(const key of ['reference','note'])if(fields[b.action].includes(key)&&!(typeof b[key]==='string'&&b[key].trim()&&b[key].length<=(key==='reference'?180:2000)))throw new ApiError(400,'INVALID','Enter the reference or reason.');
 if(b.action==='payout'&&!(typeof b.paidOn==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(b.paidOn)))throw new ApiError(400,'INVALID','Choose the actual payment date.');
 if(b.action==='payout'){const day=new Date(b.paidOn+'T00:00:00Z');if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==b.paidOn||b.paidOn<'1900-01-01')throw new ApiError(400,'INVALID','Choose a valid payment date.');}
 let user,tokenHash;
 if(partner){const raw=parseCookies(req.headers.cookie).autodream_referral_session;if(!/^[a-f0-9]{64}$/.test(raw??''))throw new ApiError(401,'AUTH','Sign in to your referral account.');tokenHash=hash(raw);}
 else {
  ({user}=await authenticate(req,ctx,res,canUseApp));
  const garage=['garage','both'].includes(user.business_access)&&['director','shareholder','garage_head','garage_salesman'].includes(user.role);
  const used=['used_car','both'].includes(user.business_access)&&['director','salesperson'].includes(user.role);
  if(!garage&&!used)throw new ApiError(403,'FORBIDDEN','Referral access is unavailable for this account.');
  if(['release','report_transfer'].includes(b.action)&&!used)throw new ApiError(403,'FORBIDDEN','The linked Used Car salesman or Director must authorise this action.');
  if(['accept_transfer','reject_transfer','payout'].includes(b.action)&&!(user.role==='director'&&garage))throw new ApiError(403,'FORBIDDEN','A Garage Director must confirm this record.');
 }
 if(deps.env.GARAGE_REFERRAL_SETTLEMENT_ONLINE!=='1'){
  if(['month','partner_month','snapshot'].includes(b.action))return {status:200,body:{enabled:false,orders:[]}};
  throw new ApiError(503,'SETUP','Referral settlement has not been activated yet.');
 }
 const throttle=await ctx.repo.throttleHit('referral:'+hash('settlement:'+(user?.id??tokenHash)),180,900);
 if(!throttle.allowed)throw new ApiError(429,'RATE_LIMITED','Try again shortly.');
 const {scope,action,...data}=b;
 const r=partner?await ctx.repo.rpc('garage_referral_partner_income',{p_token_hash:tokenHash,p_month:b.month}):await ctx.repo.rpc('garage_referral_settlement',{p_actor:user.id,p_action:action,p_data:data});
 if(r.error){
  const messages={NOT_ALLOWED:[403,'This referral is unavailable for your account.'],SESSION_REQUIRED:[401,'Sign in to your referral account.'],REQUEST_CHANGED:[409,'Retry the original request before changing its details.'],AMOUNT_EXCEEDS_BALANCE:[409,'The amount exceeds the balance available.'],PAYMENT_EXCEEDS_BALANCE:[409,'A customer payment already reserves part of this balance. Check Payment first.'],PAYMENT_NOT_VERIFIED:[409,'Garage must verify the full bill before commission can be paid.'],ALREADY_REVIEWED:[409,'This transfer was already reviewed. Reload its history.'],DEAL_CHANGED:[409,'The linked Used Car deal changed. Check it before authorising release.'],REASON_REQUIRED:[400,'Enter a reason.'],INVALID:[400,'Check the entered details.']};
  for(const [code,[status,message]] of Object.entries(messages))if(r.error.message?.includes(code))throw new ApiError(status,code,message);
  throw new ApiError(503,'UNAVAILABLE','The result could not be confirmed. Retry the same action.');
 }
 return {status:200,body:r.data};
});}
