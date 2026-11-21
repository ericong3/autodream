// Money received first, paperwork later: the Director records money that came
// in for any car (amount, date, bank, optional slip). The database decides
// everything else; the browser never chooses the actor or a storage path.
import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {decodeProof,cleanFileName} from './investorActivation.mjs';

export const SCOPE='money_received';
const BODY_MAX=4096,RECORD_BODY_MAX=16384,UPLOAD_BODY_MAX=2_100_000;
const GROUPS=['panel_fee','bank_fee','insurance','jpj_road_tax','runner','other'];
export const FIELDS={record:['carId','amountCents','receivedOn','bankAccountId','bankReference','note','requestId','loanPaymentId','deductions'],list:['carId'],summary:[],slip:['id','fileName','mimeType','base64'],open_slip:['id']};
const READ_ONLY=new Set(['list','summary','open_slip']);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const invalid=m=>new ApiError(400,'INVALID',m);
const ERRORS={
 NOT_ALLOWED:[403,'Only the Director can record money received.'],
 INVALID_DATE:[400,'Choose the date the money came in (not in the future).'],
 BANK_REQUIRED:[400,'Choose the bank the money went into.'],
 DUPLICATE_REFERENCE:[409,'This bank reference is already recorded. Check it is not the same money twice.'],
 REQUEST_CHANGED:[409,'Retry the original save before changing it.'],
 SLIP_ALREADY_SAVED:[409,'A slip is already saved for this money.'],
 UPLOAD_MISSING:[503,'The slip did not finish uploading. Retry the same file.'],
 IMMUTABLE_HISTORY:[409,'This record cannot be changed.'],
 LOAN_PAYMENT_REQUIRED:[409,'This bank loan is already settled or changed. Reload the car.'],
 PAYMENT_EXCEEDS_BALANCE:[409,'The money plus the deductions is more than the loan still to receive.'],
 WITHHELD_BILL_REQUIRED:[409,'A bill picked for a deduction is already paid or smaller than the deduction. Reload the car.'],
 BILL_LEDGER_REVIEW_REQUIRED:[409,'A bill picked for a deduction is not in the accounts yet. Leave it as a new cost or ask the developer.'],
 CONSIGNMENT_COST_CORRECTION_REQUIRED:[409,'The dealer amount is already approved, so costs cannot be added here. Use a cost correction.'],
 USE_INVESTOR_CAR_BILLS:[409,'Investor cars use investor bills for deductions.'],
 COLLECTION_WORKFLOW_REQUIRED:[409,'This car uses the dealer collection workflow.'],
 PAYMENT_WORKFLOW_REQUIRED:[409,'This panel bill must be approved before it is paid.'],
};
export function moneyError(error){
 const message=String(error?.message??'');
 for(const [code,[status,text]] of Object.entries(ERRORS))if(message.includes(code))return new ApiError(status,code,text);
 if(message.includes('INVALID')||['22007','22008','22P02','23514','22003'].includes(error?.code))return invalid('Check the amount, date and bank.');
 const code=/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/.exec(message)?.[0];
 return new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same request.'+(code?` (${code})`:/^[0-9A-Z]{5}$/.test(error?.code??'')?` (error ${error.code})`:''));
}
async function call(ctx,actor,action,data){
 let out;
 try{out=await ctx.repo.rpc('uc_money_received_action',{p_actor:actor,p_action:action,p_data:data});}
 catch{throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same request.');}
 if(out?.error)throw moneyError(out.error);
 return out?.data;
}
async function limit(ctx,kind,actorId,count,windowSeconds){
 const hit=await ctx.repo.throttleHit('money:'+createHash('sha256').update(kind+'\n'+actorId).digest('hex'),count,windowSeconds);
 if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
}

/** Input checks before the database. Returns cleaned data. */
export function validateMoney(user,action,data){
 if(action==='record'){
  if(user.role!=='director')throw new ApiError(403,'FORBIDDEN',ERRORS.NOT_ALLOWED[1]);
  if(typeof data.carId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(data.carId))throw invalid('Open the car again.');
  if(!Number.isSafeInteger(data.amountCents)||data.amountCents<=0||data.amountCents>999999999999)throw invalid('Enter the amount received.');
  if(typeof data.receivedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.receivedOn))throw invalid(ERRORS.INVALID_DATE[1]);
  if(!uuid(data.bankAccountId))throw invalid(ERRORS.BANK_REQUIRED[1]);
  for(const k of ['bankReference','note'])if(data[k]!==undefined&&(typeof data[k]!=='string'||data[k].length>(k==='note'?500:200)))throw invalid('Check the reference and note.');
  if(typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(data.requestId))throw invalid('A save reference is required.');
  if(data.loanPaymentId!==undefined||data.deductions!==undefined){
   if(typeof data.loanPaymentId!=='string'||!/^[A-Za-z0-9_:.-]{1,180}$/.test(data.loanPaymentId))throw invalid('Open the car again.');
   if(!Array.isArray(data.deductions)||data.deductions.length<1||data.deductions.length>30)throw invalid('Add each deduction (up to 30).');
   for(const d of data.deductions){
    if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['label','group','amountCents','paymentId'].includes(k)))throw invalid('Check the deductions.');
    if(typeof d.label!=='string'||!d.label.trim()||d.label.length>120)throw invalid('Give each deduction a name.');
    if(!GROUPS.includes(d.group))throw invalid('Choose a group for each deduction.');
    if(!Number.isSafeInteger(d.amountCents)||d.amountCents<=0||d.amountCents>99999999999)throw invalid('Enter each deduction amount.');
    if(d.paymentId!==undefined&&(typeof d.paymentId!=='string'||!/^[A-Za-z0-9_:.-]{1,180}$/.test(d.paymentId)))throw invalid('Check the deductions.');
   }
  }
  return data;
 }
 if(!['director','admin'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Only the Director or admin can see this.');
 if(action==='list'&&(typeof data.carId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(data.carId)))throw invalid('Open the car again.');
 if((action==='slip'||action==='open_slip')&&!uuid(data.id))throw invalid('Open the record again.');
 if(action==='slip'){
  if(!['image/png','image/jpeg','application/pdf'].includes(data.mimeType))throw invalid('Upload a PNG, JPG or PDF.');
  return {...data,fileName:cleanFileName(data.fileName)};
 }
 return data;
}

export async function handleMoneyReceived(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(user.role==='investor'||!['used_car','both'].includes(user.business_access)||user.registration_status!=='active')throw new ApiError(403,'FORBIDDEN','Used Car access is required.');
 const body=readJson(req,UPLOAD_BODY_MAX);
 if(body.scope!==SCOPE||typeof body.action!=='string'||!Object.hasOwn(FIELDS,body.action))throw invalid('Choose a valid action.');
 if(body.action!=='slip'&&Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(body))>(body.action==='record'?RECORD_BODY_MAX:BODY_MAX))throw new ApiError(413,'INVALID','Request is too large.');
 onlyKeys(body,['scope','action',...FIELDS[body.action]]);
 const {scope:_,action,...input}=body;
 const data=validateMoney(user,action,input);
 if(deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE!=='1')throw new ApiError(503,'SETUP','Private finance saving is waiting for activation.');
 await limit(ctx,READ_ONLY.has(action)?'read':'write',user.id,READ_ONLY.has(action)?240:60,900);

 if(action==='slip'){
  if(typeof ctx.repo.uploadInvestorProof!=='function')throw new ApiError(503,'SETUP','Receipt storage is not activated yet. No changes were made.');
  const {bytes,digest}=decodeProof(data.mimeType,data.base64);
  const prepared=await call(ctx,user.id,'slip_prepare',{id:data.id,fileName:data.fileName,mimeType:data.mimeType,sha256:digest});
  if(typeof prepared?.path!=='string'||!prepared.path.startsWith('money-received/'))throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same file.');
  let stored=true;
  try{await ctx.repo.uploadInvestorProof(prepared.path,bytes,data.mimeType);}catch{stored=false;}
  try{return {status:200,body:await call(ctx,user.id,'slip_confirm',{id:data.id,path:prepared.path,fileName:data.fileName})};}
  catch(error){if(!stored&&error.code==='UPLOAD_MISSING')throw new ApiError(503,'UNAVAILABLE','The slip could not be stored. Retry the same file.');throw error;}
 }
 if(action==='open_slip'){
  if(typeof ctx.repo.investorProofUrl!=='function')throw new ApiError(503,'SETUP','Receipt storage is not activated yet.');
  const out=await call(ctx,user.id,'slip_read',{id:data.id});
  let url;try{url=await ctx.repo.investorProofUrl(out.path);}catch{throw new ApiError(503,'UNAVAILABLE','Could not open the slip. Try again.');}
  if(typeof url!=='string'||!url.startsWith('https://'))throw new ApiError(503,'UNAVAILABLE','Could not open the slip. Try again.');
  return {status:200,body:{url,name:out.fileName}};
 }
 const out=await call(ctx,user.id,action,data);
 if(action==='record'&&!out?.entry?.id)throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same request.');
 return {status:200,body:out};
});}
