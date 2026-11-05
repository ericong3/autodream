import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {validateRegistrationCar} from './investorCarRegistration.mjs';
export function validateCompanyPurchase(raw){
 onlyKeys(raw,['scope','action','car','sellerName','lenderCents','lenderName','requestId']);
 if(raw.scope!=='investor_finance'||raw.action!=='register_company_car'||typeof raw.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(raw.requestId))throw new ApiError(400,'INVALID','Reopen the car form.');
 const car=validateRegistrationCar(raw.car),lender=raw.lenderCents??0;
 if(typeof raw.sellerName!=='string'||raw.sellerName.trim().length<1||raw.sellerName.length>150||/[\u0000-\u001f\u007f]/.test(raw.sellerName)||!Number.isSafeInteger(lender)||lender<0||lender>Math.round(car.purchase_price*100)||lender>0&&(typeof raw.lenderName!=='string'||!raw.lenderName.trim()||raw.lenderName.length>150||/[\u0000-\u001f\u007f]/.test(raw.lenderName))||raw.lenderName!==undefined&&typeof raw.lenderName!=='string')throw new ApiError(400,'INVALID','Check the seller name, lender and purchase amounts.');
 return {car,sellerName:raw.sellerName.trim(),lenderCents:lender,...(lender>0?{lenderName:raw.lenderName.trim()}:{}),requestId:raw.requestId};
}
export async function handleCompanyCarPurchase(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(user.registration_status!=='active'||!['director','salesperson'].includes(user.role)||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','Only the Director or Used Car salesperson can register this car.');
 const data=validateCompanyPurchase(readJson(req,80000));
 if(deps.env.USED_CAR_BANK_PAYMENTS_ONLINE!=='1'||deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE!=='1'||deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Company purchase recording is not switched on yet. Nothing was saved.');
 const hit=await ctx.repo.throttleHit('ucpurchase:'+createHash('sha256').update(user.id).digest('hex'),90,900);if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment before trying again.');
 const out=await ctx.repo.rpc('uc_register_company_car',{p_actor:user.id,p_data:data});
 if(out.error){for(const [code,status,message] of [['REQUEST_CHANGED',409,'Retry the original car save before changing it.'],['CAR_EXISTS',409,'This car is already registered. Open its stock record.'],['NOT_ALLOWED',403,'You cannot register this car.']])if(out.error.message?.includes(code))throw new ApiError(status,code,message);if(out.error.message?.includes('INVALID')||['22P02','23514','22003','23502'].includes(out.error.code))throw new ApiError(400,'INVALID','Check the car, seller and lender details.');throw new ApiError(503,'UNAVAILABLE','Could not confirm this purchase. Retry the original save.');}
 const r=out.data;if(r?.companyPurchase!==true||r?.car?.id!==data.car.id||r.car.company_purchase_recorded!==true||!Array.isArray(r.payments)||!Array.isArray(r.journals))throw new ApiError(503,'UNAVAILABLE','Could not confirm this purchase. Retry the original save.');
 return {status:200,body:{companyPurchase:true,car:r.car,payments:user.role==='director'?r.payments:[],journals:user.role==='director'?r.journals:[]}};
});}
