// Prepared handler only. The sales router must send scope 'investor_finance'
// action 'register_car' here before handleInvestorCapital.
// Registers a brand-new car and funds it from one investor account in a single
// database transaction. No legacy purchase journal or payment is written here;
// the purchase payment is recorded later with purchase_paid.
import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';

const BODY_MAX=80_000;
const SCOPE='investor_finance';
// Normal registration columns (snake_case, as produced by carToRow). Anything
// else — consignment, trade-in, sale, deal, disbursement, settlement, legacy
// investor tagging — is refused rather than ignored.
const TEXT={make:100,model:100,variant:150,car_plate:30,colour:60,condition:60,transmission:30,notes:4000,current_location:150,
 assigned_salesperson:100,photo_taken_by:100,source_salesman:100,source_type:30,external_salesman_id:100,source_salesman_id:100,
 coming_soon_type:30,panel_dealer_id:100,shipment_id:100};
const INTS={year:[1950,2100],mileage:[0,10_000_000]};
const MONEY=['purchase_price','selling_price','price_floor','sales_commission','source_commission','intake_commission','panel_charge_amount'];
const BOOLS=['thumbprint_done','intake_complete','is_recon','is_staff_sale','waive_commission','seller_thumbprint_saved'];
const DATES=['date_added','car_in_date'];
export const REGISTRATION_COLUMNS=Object.freeze(['id',...Object.keys(TEXT),...Object.keys(INTS),...MONEY,...BOOLS,...DATES,'status','photo','green_card','photos','checklist_items']);
export const FUNDABLE_STATUSES=Object.freeze(['available','coming_soon','in_workshop','ready','photo_complete','submitted']);

const ID=/^[A-Za-z0-9_-]{1,100}$/,REQ=/^[A-Za-z0-9_-]{16,80}$/,DAY=/^\d{4}-\d{2}-\d{2}$/;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const bad=message=>new ApiError(400,'INVALID',message);
const httpsUrl=v=>{if(typeof v!=='string'||v.length>2000)return false;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const isMoney=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=10_000_000_000&&Number.isInteger(Math.round(v*100))&&Math.abs(Math.round(v*100)-v*100)<1e-6;

/** Validates the car body and returns a clean copy with only registration columns. */
export function validateRegistrationCar(car){
 if(!car||typeof car!=='object'||Array.isArray(car))throw bad('Enter the car details again.');
 const extra=Object.keys(car).filter(k=>!REGISTRATION_COLUMNS.includes(k));
 if(extra.length)throw bad('Investor-funded cars cannot include consignment, trade-in, sale, settlement or old investor details. Remove them and try again.');
 const out={};
 for(const [k,v] of Object.entries(car)){
  if(v===null||v===undefined){if(['id','make','model','colour','purchase_price','status'].includes(k))throw bad('Enter the car details again.');continue;}
  if(k==='id'){if(typeof v!=='string'||!ID.test(v))throw bad('Open the car form again.');}
  else if(Object.hasOwn(TEXT,k)){if(typeof v!=='string'||v.length>TEXT[k])throw bad('Check the car details.');}
  else if(Object.hasOwn(INTS,k)){if(!Number.isInteger(v)||v<INTS[k][0]||v>INTS[k][1])throw bad('Check the year and mileage.');}
  else if(MONEY.includes(k)){if(!isMoney(v))throw bad('Check the car prices.');}
  else if(BOOLS.includes(k)){if(typeof v!=='boolean')throw bad('Check the car details.');}
  else if(DATES.includes(k)){if(typeof v!=='string'||!DAY.test(v)||Number.isNaN(Date.parse(v)))throw bad('Check the car dates.');}
  else if(k==='status'){if(!FUNDABLE_STATUSES.includes(v))throw bad('This car status cannot be investor-funded.');}
  else if(k==='photo'||k==='green_card'){if(v!==''&&!httpsUrl(v))throw bad('Upload the car photos again.');}
  else if(k==='photos'){if(!Array.isArray(v)||v.length>40||!v.every(httpsUrl))throw bad('Upload the car photos again.');}
  else if(k==='checklist_items'){if(!Array.isArray(v)||v.length>200||JSON.stringify(v).length>20_000)throw bad('Check the car checklist.');}
  out[k]=v;
 }
 for(const k of ['id','make','model','colour','purchase_price','status'])if(!Object.hasOwn(out,k))throw bad('Enter the make, model, colour, status and purchase price.');
 for(const k of ['make','model','colour'])if(!out[k].trim())throw bad('Enter the make, model and colour.');
 if(!(out.purchase_price>0))throw bad('Enter the purchase price paid for this car.');
 return out;
}

export function validateRegistration(body){
 onlyKeys(body,['action','car','potId','investorBasisPoints','requestId']);
 if(!uuid(body.potId))throw bad('Choose an investor account.');
 if(!Number.isInteger(body.investorBasisPoints)||body.investorBasisPoints<0||body.investorBasisPoints>10000)throw bad('Enter an investor profit share between 0% and 100%.');
 if(typeof body.requestId!=='string'||!REQ.test(body.requestId))throw bad('A save reference is required.');
 return {car:validateRegistrationCar(body.car),potId:body.potId,investorBasisPoints:body.investorBasisPoints,requestId:body.requestId};
}

const ERRORS={
 REPAIR_BUSY:[409,'This car is being updated. Retry the original save.'],
 CAR_REPAIR_HISTORY_REVIEW_REQUIRED:[409,'Review the completed repair costs before investor funding.'],
 NOT_ALLOWED:[403,'Only an active Director can register an investor-funded car.'],
 REQUEST_CHANGED:[409,'Retry the original save before changing it.'],
 CAR_EXISTS:[409,'This car is already registered. Open it from the stock list instead of registering it again.'],
 CAR_NOT_ELIGIBLE:[409,'This car cannot be funded from an investor account.'],
 CAR_ALREADY_FUNDED:[409,'This car already has a funding account.'],
 CAR_HISTORY_REVIEW_REQUIRED:[409,'This car already has payment history and cannot be investor-funded here.'],
 INSUFFICIENT_FUNDS:[409,'This investor account does not have enough money available for the purchase.'],
 CAR_BILLS_REVIEW_REQUIRED:[409,'Check the waiting car bills on this investor account first.'],
 PURCHASE_PRICE_CHANGED:[409,'The car purchase price has changed. Check it again.'],
 BALANCE_LIMIT:[409,'This amount exceeds the account limit. Ask the Director to review it.'],
 INVALID:[400,'Check the car details and try again.'],
};

export async function handleInvestorCarRegistration(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(user.role!=='director'||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','Only a Director can register an investor-funded car.');
 const raw=readJson(req,BODY_MAX);
 if(Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(raw))>BODY_MAX)throw new ApiError(413,'INVALID','Request is too large.');
 if(raw.scope!==SCOPE||raw.action!=='register_car')throw bad('Choose a valid action.');
 const {scope,...body}=raw;
 const data=validateRegistration(body);
 if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1'||deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Investor car saving is not activated yet. No changes were made.');
 const hit=await ctx.repo.throttleHit('invest:'+createHash('sha256').update(user.id).digest('hex'),90,900);
 if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
 const out=await ctx.repo.rpc('uc_register_investor_car',{p_actor:user.id,p_data:data});
 if(out.error){
  for(const [code,[status,message]] of Object.entries(ERRORS))if(out.error.message?.includes(code))throw new ApiError(status,code,message);
  if(out.error.code==='23505')throw new ApiError(409,'CAR_EXISTS',ERRORS.CAR_EXISTS[1]);
  if(['22007','22008','22P02','23514','22003','23502'].includes(out.error.code))throw bad('Check the car details and try again.');
  throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same save reference.');
 }
 if(!out.data||typeof out.data!=='object'||!out.data.car)throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same save reference.');
 return {status:200,body:{car:out.data.car,account:out.data.account??null}};
});}
