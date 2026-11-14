// Dealer accounts: a consignment dealer linked to an investor account, and
// "lock as investment" of unpaid dealer payouts. Director manages; the linked
// investor may only read their own dealer ('mine').
import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';

const CAR_FIELDS=['make','model','variant','year','carPlate','colour','mileage','transmission','notes','photos','requestId'];
export const DEALER_FIELDS={mine:[],list:[],view:['dealerId'],link:['dealerId','potId','requestId'],convert:['dealerId','amountCents','convertedOn','note','requestId'],prepare_payouts:['dealerId','requestId'],
 add_car:CAR_FIELDS,edit_car:['carId','variant','colour','mileage','notes','photos','requestId']};
const READS=new Set(['mine','list','view']);
const DEALER_STOCK=new Set(['mine','add_car','edit_car']);
const text=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
// Photos must be files this app uploaded to the public car-photos bucket.
function validateCar(b,env){
 const base=String(env.SUPABASE_URL||'').replace(/\/+$/,'')+'/storage/v1/object/public/car-photos/';
 if(!Array.isArray(b.photos)||b.photos.length<1||b.photos.length>20||!b.photos.every(p=>typeof p==='string'&&p.length<=2000&&base.length>40&&p.startsWith(base)&&!p.includes('..')))throw new ApiError(400,'PHOTOS_REQUIRED','Add at least one car photo.');
 for(const k of ['variant','colour'])if(b[k]!==undefined&&!text(b[k],0,150))throw new ApiError(400,'INVALID','Check the car details.');
 if(b.notes!==undefined&&(typeof b.notes!=='string'||b.notes.length>2000))throw new ApiError(400,'INVALID','Notes are too long.');
 if(b.mileage!==undefined&&(!Number.isSafeInteger(b.mileage)||b.mileage<0||b.mileage>10_000_000))throw new ApiError(400,'INVALID','Enter the mileage in km.');
 if(b.action==='add_car'){
  if(!text(b.make,1,100)||!text(b.model,1,100)||!text(b.carPlate,1,30))throw new ApiError(400,'INVALID','Enter the make, model and plate number.');
  if(!Number.isInteger(b.year)||b.year<1950||b.year>new Date().getFullYear()+1)throw new ApiError(400,'INVALID','Enter the car year.');
  if(!['auto','manual'].includes(b.transmission))throw new ApiError(400,'INVALID','Choose auto or manual.');
 }else if(!id(b.carId))throw new ApiError(400,'INVALID','Open the car again.');
}
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(v);
const messages={NOT_ALLOWED:[403,'You cannot open or change this dealer account.'],DEALER_NOT_FOUND:[404,'This dealer no longer exists. Refresh the page.'],
 ALREADY_LINKED:[409,'This dealer or investor is already linked to another account.'],INVESTOR_LINK_REQUIRED:[409,'Link this dealer to an investor account first.'],
 CONVERSION_EXCEEDS_OWED:[409,'This is more than the unpaid dealer payouts. Update the disbursements and payouts first.'],
 REQUEST_CHANGED:[409,'Retry the original save before changing it.'],FUTURE_DATE:[400,'The date cannot be in the future.'],IMMUTABLE_HISTORY:[409,'Saved investment locks cannot be changed.'],
 PLATE_EXISTS:[409,'A car with this plate number is already in stock.'],PHOTOS_REQUIRED:[400,'Add at least one car photo.'],CAR_LOCKED:[409,'This car already has a deal. Ask AutoDream to change it.']};

export async function handleDealerAccounts(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp),b=readJson(req,16384);
 if(!['director','investor'].includes(user.role)||user.registration_status!=='active'||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'NOT_ALLOWED',messages.NOT_ALLOWED[1]);
 if(b.scope!=='dealer_accounts'||!Object.hasOwn(DEALER_FIELDS,b.action))throw new ApiError(400,'INVALID','Choose a valid dealer action.');
 if(user.role==='investor'?!DEALER_STOCK.has(b.action):['mine','add_car','edit_car'].includes(b.action))throw new ApiError(403,'NOT_ALLOWED',messages.NOT_ALLOWED[1]);
 onlyKeys(b,['scope','action',...DEALER_FIELDS[b.action]]);
 if(['add_car','edit_car'].includes(b.action))validateCar(b,deps.env);
 else if(b.action!=='mine'&&b.action!=='list'&&!id(b.dealerId))throw new ApiError(400,'INVALID','Open the dealer again.');
 if(b.action==='link'&&!uuid(b.potId))throw new ApiError(400,'INVALID','Choose an investor account.');
 if(b.action==='convert'){
  if(!Number.isSafeInteger(b.amountCents)||b.amountCents<1||b.amountCents>1000000000000)throw new ApiError(400,'INVALID','Enter a valid amount.');
  if(typeof b.convertedOn!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(b.convertedOn))throw new ApiError(400,'INVALID','Choose the date of the agreement.');
  if(typeof b.note!=='string'||b.note.trim().length<5||b.note.trim().length>1000||/[\u0000-\u001f\u007f]/.test(b.note))throw new ApiError(400,'INVALID','Describe the agreement in 5 to 1000 characters.');
 }
 if(!READS.has(b.action)&&(typeof b.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(b.requestId)))throw new ApiError(400,'INVALID','Retry the original save.');
 if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1')throw new ApiError(503,'SETUP','Investor accounts are not switched on yet. Nothing was saved.');
 const hit=await ctx.repo.throttleHit('dealer:'+createHash('sha256').update((READS.has(b.action)?'r:':'w:')+user.id).digest('hex'),READS.has(b.action)?600:60,900);
 if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
 const {scope,action,...data}=b;
 const out=await ctx.repo.rpc('uc_dealer_account',{p_actor:user.id,p_action:action,p_data:data});
 if(out.error){
  for(const [code,[status,message]] of Object.entries(messages))if(out.error.message?.includes(code))throw new ApiError(status,code,message);
  if(['42883','42P01'].includes(out.error.code))throw new ApiError(503,'SETUP','Dealer accounts are not installed yet. Nothing was saved.');
  if(out.error.message?.includes('INVALID')||['22P02','23514','22003','22007','22008'].includes(out.error.code))throw new ApiError(400,'INVALID','Check the details and try again.');
  throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the original save.');
 }
 const r=out.data;
 if(action==='list'?!Array.isArray(r?.dealers):r?.dealer!==null&&(!r?.dealer?.id||!Array.isArray(r.cars)||!Array.isArray(r.payouts)||!r.totals))throw new ApiError(503,'UNAVAILABLE','Could not read the dealer account. Retry.');
 return {status:200,body:r};
});}
