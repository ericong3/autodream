import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {createHash} from 'node:crypto';
import {handleReferralAccounts,isReferralAccountRequest} from '../referrals/accounts.mjs';
import {handleSalesReferrals,isSalesReferralRequest,validateSalesAssignment} from '../referrals/sales.mjs';
import {handleBonusCampaigns,isBonusCampaignRequest} from '../usedCar/bonusCampaigns.mjs';
import {handleReferralSettlement,isReferralSettlementRequest} from '../referrals/settlement.mjs';
import {handlePrivateFinance,isPrivateFinanceRequest} from '../usedCar/privateFinance.mjs';
import {handleInvestorCapital} from '../usedCar/investorCapital.mjs';
import {handleInvestorCarRegistration} from '../usedCar/investorCarRegistration.mjs';
export async function handleSales(req,deps){
 let scope,action;try{const body=typeof req.body==='string'?JSON.parse(req.body):req.body;scope=body?.scope;action=body?.action;}catch{}
 if(scope==='investor_finance'&&action==='register_car')return handleInvestorCarRegistration(req,deps);
 if(scope==='investor_finance')return handleInvestorCapital(req,deps);
 if(isPrivateFinanceRequest(req))return handlePrivateFinance(req,deps);
 if(isReferralSettlementRequest(req))return handleReferralSettlement(req,deps);
 if(isBonusCampaignRequest(req))return handleBonusCampaigns(req,deps);
 if(isSalesReferralRequest(req))return handleSalesReferrals(req,deps);
 if(isReferralAccountRequest(req))return handleReferralAccounts(req,deps);
 return respond(req,deps,['POST'],async(ctx,res)=>{
  const {user}=await authenticate(req,ctx,res,canUseApp);
  if(!['garage','both'].includes(user.business_access)||!['director','shareholder','garage_head','garage_salesman'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Garage sales access is required.');
  const rate=await ctx.repo.throttleHit('sale:'+createHash('sha256').update(user.id).digest('hex'),120,900);
  if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment before trying again.');
  const data=readJson(req,64000);onlyKeys(data,['action','requestId','sale']);
  if(!['confirm','status','abandon'].includes(data.action)||typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(data.requestId))throw new ApiError(400,'INVALID','Reload this sale before confirming.');
  if(data.action==='confirm'){
   const sale=data.sale;if(!sale||typeof sale!=='object'||Array.isArray(sale))throw new ApiError(400,'INVALID','Check the sale details.');
   onlyKeys(sale,['customerId','vehicleId','paymentStatus','paymentMethod','remark','pending','addons','booking','receiptExpected','initialPayment','salesAssignment']);
   if(deps.env.GARAGE_SALES_REFERRALS_ONLINE==='1'&&sale.salesAssignment===undefined)throw new ApiError(400,'INVALID','Choose the Garage salesperson in charge before confirming.');
   if(sale.salesAssignment!==undefined){
    if(deps.env.GARAGE_SALES_REFERRALS_ONLINE!=='1')throw new ApiError(503,'SETUP','Sales referrals have not been activated. Your draft is kept.');
    validateSalesAssignment(sale.salesAssignment);
   }
   if(sale.initialPayment!==undefined){const p=sale.initialPayment;if(!p||typeof p!=='object'||Array.isArray(p))throw new ApiError(400,'INVALID','Check the payment received.');onlyKeys(p,['amount','method','reference']);if(typeof p.amount!=='number'||!Number.isFinite(p.amount)||p.amount<=0||!['cash','card','transfer','installment'].includes(p.method)||typeof p.reference!=='string'||p.reference.length>200)throw new ApiError(400,'INVALID','Check the payment received.');}
  }
  const r=await ctx.repo.rpc('garage_sale_confirmation',{p_actor:user.id,p_action:data.action,p_request:data.requestId,p_sale:data.sale??null});
  if(r.error){const msg=r.error.message||'';
   if(msg.includes('REQUEST_CHANGED'))throw new ApiError(409,'CHANGED','This recovery reference belongs to different sale details. Check the saved sale first.');
   if(msg.includes('DEAL_CHANGED'))throw new ApiError(409,'CONFLICT','The Used Car deal changed. Cancel this attempt to review and select the deal again.');
   if(msg.includes('REQUEST_ABANDONED'))throw new ApiError(409,'ABANDONED','This confirmation was cancelled. Start a new confirmation.');
   if(msg.includes('REVISION_CONFLICT')||msg.includes('ALREADY_LINKED'))throw new ApiError(409,'CONFLICT','The booking changed. Check this confirmation, then update the booking before trying again.');
   if(msg.includes('NOT_ALLOWED'))throw new ApiError(403,'FORBIDDEN','This sale is unavailable for your account.');
   if(msg.includes('INVALID')||['22007','22008','22P02','22003','23503','23514'].includes(r.error.code))throw new ApiError(400,'INVALID','Check the customer, payment, tint choices and booking times.');
   if(['42883','42P01','42703'].includes(r.error.code))throw new ApiError(503,'SETUP','Sale confirmation is being prepared. Your recovery reference is kept.');
   throw new ApiError(503,'UNCERTAIN','Could not confirm the result. Check the saved sale before trying again.');
  }
  return {status:200,body:r.data};
 });
}
