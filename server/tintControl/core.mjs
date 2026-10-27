import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
const financeRoles=['director','admin','shareholder','garage_head','garage_salesman'];
const stockRoles=['director','shareholder','garage_head','garage_salesman','garage_installer','garage_detailer','garage_spray'];
const messages={NOT_ALLOWED:'You cannot perform this action.',FINANCE_NOT_READY:'Payment tracking is not activated for this order.',REQUEST_CHANGED:'This retry contains different details. Reload before continuing.',PAYMENT_EXCEEDS_BALANCE:'The amount exceeds the balance still to collect.',PAYMENT_ALREADY_REVIEWED:'This payment was already reviewed. Reload to see its status.',REASON_REQUIRED:'Enter a reason.',ORDER_DELIVERED:'This order was already delivered.',RECEIPT_ALREADY_ATTACHED:'Proof is already attached to this payment.',NO_FILM_STOCK:'Film stock could not be found.',QUOTE_LOCKED:'The confirmed quote cannot be changed.',DELIVERY_REQUIRED:'After-sales claims are available after delivery.',REPLACEMENT_OPEN:'One of these glass panels already has an unfinished replacement job.'};
export function handleTintControl(kind){
 return (req,deps)=>respond(req,deps,['POST'],async(ctx,res)=>{
  const {user}=await authenticate(req,ctx,res,canUseApp);
  const roles=kind==='claims'?['director','shareholder','garage_head','garage_salesman']:kind==='finance'?financeRoles:stockRoles;
  if(!roles.includes(user.role)||!['garage','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','Garage access is required.');
  const data=readJson(req,16000);
  onlyKeys(data,['action','invoiceId','requestId','paymentId','amount','method','reference','note','path','name','page','series','sqft','reason','rollSqft','lowStockThreshold','kind','itemIds']);
  const actions=kind==='claims'?['snapshot','create']:kind==='finance'?['snapshot','queue','record','verify','reject','void']:['list','snapshot','receive','reconcile','config'];
  if(!actions.includes(data.action))throw new ApiError(400,'INVALID','Choose a valid action.');
  if(kind==='finance'&&['verify','reject','void','queue'].includes(data.action)&&!['director','admin'].includes(user.role))throw new ApiError(403,'FORBIDDEN','A director or authorised Garage admin must verify company receipt.');
  if(kind==='stock'&&['receive','reconcile','config'].includes(data.action)&&!['director','shareholder','garage_head'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Stock management access is required.');
  for(const key of ['invoiceId','paymentId'])if(data[key]!==undefined&&(typeof data[key]!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(data[key])))throw new ApiError(400,'INVALID','Invalid work-order reference.');
  if(data.itemIds!==undefined&&(!Array.isArray(data.itemIds)||data.itemIds.length>32||data.itemIds.some(x=>typeof x!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(x))))throw new ApiError(400,'INVALID','Choose valid glass panels.');
  const reading=['snapshot','queue','list'].includes(data.action);
  if(!reading&&(typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(data.requestId)))throw new ApiError(400,'INVALID','A retry reference is required.');
  for(const key of ['amount','sqft','rollSqft','lowStockThreshold'])if(data[key]!==undefined&&(typeof data[key]!=='number'||!Number.isFinite(data[key])||data[key]<0||data[key]>10000000))throw new ApiError(400,'INVALID','Enter a valid amount.');
  if(data.amount!==undefined&&(!Number.isSafeInteger(Math.round(data.amount*100))||Math.abs(data.amount*100-Math.round(data.amount*100))>0.00001))throw new ApiError(400,'INVALID','Use no more than two decimal places.');
  for(const key of ['reference','note','reason','path','name','method','series','kind'])if(data[key]!==undefined&&(typeof data[key]!=='string'||data[key].length>(['note','reason'].includes(key)?2000:key==='path'?1000:255)))throw new ApiError(400,'INVALID','Check the entered details.');
  if(data.page!==undefined&&(!Number.isInteger(data.page)||data.page<0||data.page>999999))throw new ApiError(400,'INVALID','Invalid page.');
  const rate=await ctx.repo.throttleHit((kind==='finance'?'money:':'stock:')+createHash('sha256').update(user.id).digest('hex'),300,900);
  if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment before trying again.');
  const {action,...payload}=data;
  const result=await ctx.repo.rpc(kind==='claims'?'garage_tint_rework':kind==='finance'?'garage_tint_finance':'garage_tint_stock',{p_actor:user.id,p_action:action,p_data:payload});
  if(result.error){const message=result.error.message||'';for(const [code,text] of Object.entries(messages))if(message.includes(code))throw new ApiError(code==='NOT_ALLOWED'?403:409,code,text);
   if(message.includes('INVALID')||['22P02','22003','23514'].includes(result.error.code))throw new ApiError(400,'INVALID','Check the amount, method and references.');
   if(['42883','42P01','42703'].includes(result.error.code))throw new ApiError(503,'SETUP','This update has not been activated yet.');
   throw new ApiError(503,'UNAVAILABLE','The result could not be confirmed. Retry the same action before entering it again.');
  }
  return {status:200,body:result.data};
 });
}
