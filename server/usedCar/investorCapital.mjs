// Prepared handler only. No hosted route is wired to it in this phase.
import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {readScope,scopedFields,validateActivation,runInvestorActivation,activationError,ACTIVATION_FIELDS,ADMIN_ACTIONS,MONEY_ACTIONS} from './investorActivation.mjs';
import {validatePaymentProof,moneyEvidenceError} from './investorMoneyEvidence.mjs';
// Unscoped bodies are the phase 1/2 contract (fixtures only). Hosted routes send scope 'investor_finance'.
const BODY_MAX=4096,PROOF_BODY_MAX=2_100_000;
const fields={
 create_profile:['name','requestId'],link_account:['potId','staffId','requestId'],snapshot:['potId'],
 capital_received:['potId','amountCents','paidOn','bankAccount','bankReference','requestId'],
 request_withdrawal:['potId','amountCents','requestId'],approve_withdrawal:['potId','withdrawalId','destinationBank','destinationHolder','destinationAccount','destinationConfirmed','requestId'],
 reject_withdrawal:['potId','withdrawalId','note','requestId'],withdrawal_paid:['potId','withdrawalId','paidOn','bankAccount','bankReference','receiptDocumentId','destinationId','requestId'],
 cancel_withdrawal:['potId','withdrawalId','note','requestId'],
 confirm_withdrawal_destination:['potId','withdrawalId','destinationBank','destinationHolder','destinationAccount','destinationConfirmed','requestId'],
 fund_car:['carId','potId','purchaseCents','investorBasisPoints','requestId'],car_snapshot:['carId'],
 purchase_paid:['carId','bankAccount','bankReference','paidOn','invoiceDocumentId','receiptDocumentId','requestId'],
 add_car_bill:['carId','category','purpose','payee','amountCents','requestId'],
 approve_car_bill:['carId','billId','requestId'],void_car_bill:['carId','billId','note','requestId'],
 pay_car_bill:['carId','billId','amountCents','bankAccount','bankReference','paidOn','receiptDocumentId','requestId'],
 agree_sale:['carId','amountCents','requestId'],sale_received:['carId','amountCents','bankAccount','bankReference','paidOn','requestId'],
 settle_car:['carId','confirmCosts','requestId'],
};
const carActions=new Set(['fund_car','car_snapshot','purchase_paid','add_car_bill','approve_car_bill','void_car_bill','pay_car_bill','agree_sale','sale_received','settle_car']);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
// The investor's payout account, typed and confirmed by the Director. Never read from a profile.
const DESTINATION_ACTIONS=new Set(['approve_withdrawal','confirm_withdrawal_destination']);
const destinationText=(value,max)=>typeof value==='string'&&value.trim().length>=2&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const DESTINATION_ERRORS={DESTINATION_NOT_CONFIRMED:[400,'Confirm the investor\'s bank details before approving.'],DESTINATION_INVALID:[400,'Check the bank name, account holder and account number.'],
 DESTINATION_REQUIRED:[409,'Enter and confirm the investor\'s bank details before paying this withdrawal.'],DESTINATION_CHANGED:[409,'The payout bank details do not match this withdrawal. Reload it first.'],
 DESTINATION_LOCKED:[409,'The payout bank details are already confirmed and cannot be changed.']};
export function validateDestination(action,body,scoped){
 if(body.destinationId!==undefined&&!uuid(body.destinationId))throw new ApiError(400,'INVALID','Open the withdrawal again.');
 if(scoped&&action==='withdrawal_paid'&&body.destinationId===undefined)throw new ApiError(400,'DESTINATION_REQUIRED',DESTINATION_ERRORS.DESTINATION_REQUIRED[1]);
 if(!DESTINATION_ACTIONS.has(action))return;
 const given=['destinationBank','destinationHolder','destinationAccount','destinationConfirmed'].some(key=>body[key]!==undefined);
 if(!given&&!scoped)return;
 if(!destinationText(body.destinationBank,80)||!destinationText(body.destinationHolder,150)||typeof body.destinationAccount!=='string'||!/^[0-9 -]{6,40}$/.test(body.destinationAccount)||!/^[0-9]{6,20}$/.test(body.destinationAccount.replace(/[ -]/g,'')))throw new ApiError(400,'DESTINATION_INVALID',DESTINATION_ERRORS.DESTINATION_INVALID[1]);
 if(body.destinationConfirmed!==true)throw new ApiError(400,'DESTINATION_NOT_CONFIRMED',DESTINATION_ERRORS.DESTINATION_NOT_CONFIRMED[1]);
}
export async function handleInvestorCapital(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 const raw=readJson(req,PROOF_BODY_MAX);
 const {scoped,body}=readScope(raw);
 const ownClaimProof=scoped&&['proof_upload','proof_url'].includes(body.action)&&['salesperson','mechanic'].includes(user.role);
 if((!['director','investor','admin'].includes(user.role)&&!ownClaimProof)||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','This account cannot open investor records.');
 // Only a scoped proof upload may exceed the normal body size.
 if(!(scoped&&body.action==='proof_upload')&&Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(raw))>BODY_MAX)throw new ApiError(413,'INVALID','Request is too large.');
 const allowed=scoped?scopedFields(body.action,fields):Object.hasOwn(fields,body.action)?fields[body.action]:null;
 if(!allowed)throw new ApiError(400,'INVALID','Choose a valid action.');
 if(scoped&&Object.hasOwn(ACTIVATION_FIELDS,body.action)){
  onlyKeys(body,['action',...allowed]);
  const {action,...input}=body;
  const data=validateActivation(user,action,input);
  if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1')throw new ApiError(503,'SETUP','Investor saving is not activated yet. No changes were made.');
  if(['fundable_cars','car_billing_list','proof_upload','proof_url'].includes(action)&&deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Investor car saving is not activated yet. No changes were made.');
  const hit=await ctx.repo.throttleHit('invest:'+createHash('sha256').update(user.id).digest('hex'),90,900);
  if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
  return runInvestorActivation(ctx,deps,user,action,data);
 }
 if(user.role==='admin'&&!(scoped?ADMIN_ACTIONS:new Set(['add_car_bill','car_snapshot'])).has(body.action))throw new ApiError(403,'FORBIDDEN','This account can record and view car expenses only.');
 if(scoped&&MONEY_ACTIONS.has(body.action)&&!uuid(body.bankAccountId))throw new ApiError(400,'INVALID','Choose a registered company bank account.');
 if(scoped)validatePaymentProof(body.action,body);
 if(scoped&&body.action==='pay_car_bill'&&!uuid(body.receiptDocumentId))throw new ApiError(400,'PAYMENT_RECEIPT_REQUIRED','Upload and choose the payment receipt first.');
 if(user.role==='investor'&&!['snapshot','car_snapshot','request_withdrawal'].includes(body.action))throw new ApiError(403,'FORBIDDEN','A Director must approve this action.');
 if(user.role!=='investor'&&body.action==='request_withdrawal')throw new ApiError(403,'FORBIDDEN','The investor must request their own withdrawal.');
 onlyKeys(body,['action',...allowed]);
 validateDestination(body.action,body,scoped);
 const ownSnapshot=body.action==='snapshot'&&user.role==='investor'&&body.potId===undefined;
 const carAction=carActions.has(body.action);
 if((!carAction&&body.action!=='create_profile'&&!ownSnapshot&&!uuid(body.potId))||(body.action==='fund_car'&&!uuid(body.potId))||body.withdrawalId!==undefined&&!uuid(body.withdrawalId)||body.billId!==undefined&&!uuid(body.billId))throw new ApiError(400,'INVALID','Open the account again.');
 if(carAction&&(typeof body.carId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(body.carId)))throw new ApiError(400,'INVALID','Open the car again.');
 if(!['snapshot','car_snapshot'].includes(body.action)&&(typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(body.requestId)))throw new ApiError(400,'INVALID','A save reference is required.');
 if(body.amountCents!==undefined&&(!Number.isSafeInteger(body.amountCents)||body.amountCents<1||body.amountCents>1000000000000))throw new ApiError(400,'INVALID','Enter a valid amount.');
 if(body.purchaseCents!==undefined&&(!Number.isSafeInteger(body.purchaseCents)||body.purchaseCents<1||body.purchaseCents>1000000000000)||body.investorBasisPoints!==undefined&&(!Number.isInteger(body.investorBasisPoints)||body.investorBasisPoints<0||body.investorBasisPoints>10000))throw new ApiError(400,'INVALID','Check the purchase price and profit split.');
 if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1')throw new ApiError(503,'SETUP','Investor saving is not activated yet. No changes were made.');
 if(carAction&&deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Investor car saving is not activated yet. No changes were made.');
 const hit=await ctx.repo.throttleHit('invest:'+createHash('sha256').update(user.id).digest('hex'),90,900);
 if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
 const {action,...data}=body;
 const out=await ctx.repo.rpc('uc_investor_capital',{p_actor:user.id,p_action:action,p_data:data});
 if(out.error){
  for(const [code,[status,message]] of Object.entries(DESTINATION_ERRORS))if(out.error.message?.includes(code))throw new ApiError(status,code,message);
  const moneyError=scoped?moneyEvidenceError(out.error):null;
  if(moneyError)throw moneyError;
  const known=scoped?activationError(out.error):null;
  if(known)throw known;
  const carErrors={REPAIR_BUSY:'This repair is being updated. Retry the original save.',CAR_REPAIR_HISTORY_REVIEW_REQUIRED:'This car has completed repairs. Review those costs before investor funding.',CAR_NOT_ELIGIBLE:'This car cannot be funded from an investor account.',CAR_ALREADY_FUNDED:'This car already has a funding account.',PURCHASE_PRICE_CHANGED:'The car purchase price has changed. Check it again.',PURCHASE_ALREADY_PAID:'The car payment is already recorded.',CAR_SETTLED_ADJUSTMENT_REQUIRED:'Profit is already confirmed. The Director must review a correction.',PAID_BILL_ADJUSTMENT_REQUIRED:'This bill has a payment. The Director must review a correction.',PAYMENT_EXCEEDS_BALANCE:'The payment is more than the amount still owing.',SALE_AGREEMENT_LOCKED:'The sale price is already agreed, or the car purchase is not yet paid.',SETTLEMENT_NOT_READY:'Receive all sale money and check every car bill before confirming profit.'};
  for(const [code,message] of Object.entries(carErrors))if(out.error.message?.includes(code))throw new ApiError(409,code,message);
  const mappings={NOT_ALLOWED:[403,'You cannot open or change this record.'],REQUEST_CHANGED:[409,'Retry the original save before changing it.'],INSUFFICIENT_FUNDS:[409,'There is not enough money available.'],ALREADY_LINKED:[409,'This investor already has a linked account.'],INVALID_INVESTOR_ACCOUNT:[400,'Choose an active investor account.'],ALREADY_REVIEWED:[409,'This request has already been checked.'],APPROVAL_REQUIRED:[409,'The Director must approve this first.'],REASON_REQUIRED:[400,'Enter a reason.'],FUTURE_PAYMENT:[400,'Choose the date the payment was made.'],INVALID:[400,'Check the details and try again.']};
  for(const [code,[status,message]] of Object.entries(mappings))if(out.error.message?.includes(code))throw new ApiError(status,code,message);
  if(out.error.code==='23505')throw new ApiError(409,'DUPLICATE','This account or payment reference is already recorded.');
  if(out.error.message?.includes('BALANCE_LIMIT'))throw new ApiError(409,'BALANCE_LIMIT','This amount exceeds the account limit. Ask the Director to review it.');
  if(out.error.message?.includes('CAR_BILLS_REVIEW_REQUIRED'))throw new ApiError(409,'BILLS_REVIEW_REQUIRED','Check the waiting car bills before approving or paying a withdrawal.');
  if(out.error.message?.includes('SALE_PRICE_REQUIRED'))throw new ApiError(409,'SALE_PRICE_REQUIRED','Agree the sale price before recording sale money.');
  if(out.error.message?.includes('PAYMENT_BEFORE_APPROVAL'))throw new ApiError(400,'INVALID','Payment cannot be dated before the related approval.');
  if(['22007','22008','22P02','23514','22003'].includes(out.error.code))throw new ApiError(400,'INVALID','Check the amount and payment date.');
  throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same save reference.');
 }
 return {status:200,body:out.data};
});}
