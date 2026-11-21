// Dashboard to-do for paperwork: admin uploads or sends an item back to the
// Director with a reason; the Director deletes or edits the bill, or answers.
import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';

export const SCOPE='doc_todo';
export const FIELDS={list:[],cases:[],send_back:['paymentId','moneyId','carId','reason'],resolve:['id','resolution','note'],delete_bill:['id','note'],edit_bill:['id','amountCents','note']};
const DIRECTOR_ONLY=new Set(['resolve','delete_bill','edit_bill']);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const invalid=m=>new ApiError(400,'INVALID',m);
const ERRORS={
 NOT_ALLOWED:[403,'Only the Director can do this.'],
 REASON_REQUIRED:[400,'Write a short reason (at least 3 characters).'],
 NOTE_REQUIRED:[400,'Write a short note for admin.'],
 ALREADY_SENT_BACK:[409,'This is already with the Director.'],
 ALREADY_ANSWERED:[409,'This was already answered. Refresh the list.'],
 BILL_NOT_FOUND:[409,'This bill no longer exists. Refresh the list.'],
 BILL_ALREADY_PAID:[409,'This bill already has money paid. It cannot be deleted or edited here.'],
 BILL_TYPE_NOT_ALLOWED:[409,'Only car bills can be deleted or edited here.'],
 USE_INVESTOR_CAR_BILLS:[409,'This is an investor car. Change it in the investor account.'],
 BILL_HAS_DOCUMENTS:[409,'This bill has an uploaded invoice or slip, so it cannot be deleted or edited. Use Correct bill on the car page.'],
 CONSIGNMENT_APPROVED_CORRECTION_REQUIRED:[409,'The dealer amount for this car is already approved. Use Adjust approved bill on the car page.'],
 BILL_IN_ACCOUNTS:[409,'This bill is already in the accounts. Delete it and add the right one instead.'],
};
export function todoError(error){
 const message=String(error?.message??'');
 for(const [code,[status,text]] of Object.entries(ERRORS))if(message.includes(code))return new ApiError(status,code,text);
 if(error?.code==='23503')return new ApiError(409,'BILL_HAS_DOCUMENTS',ERRORS.BILL_HAS_DOCUMENTS[1]);
 if(message.includes('INVALID')||['22P02','23514','22003'].includes(error?.code))return invalid('Check the details and try again.');
 const code=/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/.exec(message)?.[0];
 return new ApiError(503,'UNAVAILABLE','Could not save. Try again.'+(code?` (${code})`:/^[0-9A-Z]{5}$/.test(error?.code??'')?` (error ${error.code})`:''));
}
export function validateTodo(user,action,data){
 if(action==='cases'){if(!['director','admin','shareholder'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Only the Director, admin or shareholders can see this.');return data;}
 if(!['director','admin'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Only the Director or admin can use this list.');
 if(DIRECTOR_ONLY.has(action)&&user.role!=='director')throw new ApiError(403,'FORBIDDEN',ERRORS.NOT_ALLOWED[1]);
 if(action==='send_back'){
  const targets=['paymentId','moneyId','carId'].filter(k=>data[k]!==undefined);
  if(targets.length!==1||typeof data[targets[0]]!=='string'||!data[targets[0]]||data[targets[0]].length>180||targets[0]==='moneyId'&&!uuid(data.moneyId))throw invalid('Open the item again.');
  if(typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>500)throw invalid(ERRORS.REASON_REQUIRED[1]);
 }
 if(action!=='list'&&action!=='send_back'&&!uuid(data.id))throw invalid('Open the item again.');
 if(data.note!==undefined&&(typeof data.note!=='string'||data.note.length>500))throw invalid('The note is too long.');
 if(action==='resolve'&&!['returned','done'].includes(data.resolution))throw invalid('Choose how to answer.');
 if(action==='edit_bill'&&(!Number.isSafeInteger(data.amountCents)||data.amountCents<=0||data.amountCents>999999999999))throw invalid('Enter the correct amount.');
 return data;
}
export async function handleDocTodo(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(!['used_car','both'].includes(user.business_access)||user.registration_status!=='active')throw new ApiError(403,'FORBIDDEN','Used Car access is required.');
 const body=readJson(req,4096);
 if(body.scope!==SCOPE||typeof body.action!=='string'||!Object.hasOwn(FIELDS,body.action))throw invalid('Choose a valid action.');
 onlyKeys(body,['scope','action',...FIELDS[body.action]]);
 const {scope:_,action,...input}=body;
 const data=validateTodo(user,action,input);
 if(deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE!=='1')throw new ApiError(503,'SETUP','Private finance saving is waiting for activation.');
 const hit=await ctx.repo.throttleHit('todo:'+createHash('sha256').update(action+'\n'+user.id).digest('hex'),action==='list'||action==='cases'?240:60,900);
 if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
 let out;
 try{out=await ctx.repo.rpc('uc_doc_todo',{p_actor:user.id,p_action:action,p_data:data});}
 catch{throw new ApiError(503,'UNAVAILABLE','Could not save. Try again.');}
 if(out?.error)throw todoError(out.error);
 if(action==='cases'){if(!out?.data?.cars||typeof out.data.cars!=='object')throw new ApiError(503,'UNAVAILABLE','Could not load. Try again.');return {status:200,body:out.data};}
 if(action==='list'?!Array.isArray(out?.data?.items)||!Array.isArray(out?.data?.open):!out?.data?.entry?.id)throw new ApiError(503,'UNAVAILABLE','Could not confirm. Refresh and try again.');
 return {status:200,body:out.data};
});}
