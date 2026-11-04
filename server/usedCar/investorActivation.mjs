// Phase 3 investor finance: registered banks, stable invitations, private
// evidence and read models. Prepared only; reached through
// handleInvestorCapital when a request carries scope 'investor_finance'.
// The browser never chooses the actor, the storage path or the invite token.
import {createHash,createHmac} from 'node:crypto';
import {ApiError} from '../garageBuilding/core.mjs';
import {accountConfig} from '../accounts/core.mjs';

export const SCOPE='investor_finance';
export const PROOF_MAX_BYTES=1_400_000;
export const MONEY_ACTIONS=new Set(['capital_received','withdrawal_paid','purchase_paid','pay_car_bill','sale_received']);
export const ACTIVATION_FIELDS={
 save_bank:['name','openingDate','openingCents','requestId'],banks:[],list_profiles:[],
 fundable_cars:['page'],car_billing_list:['page'],invite_investor:['potId','requestId'],
 proof_upload:['billId','entryId','kind','fileName','mimeType','base64','requestId'],proof_url:['documentId'],
};
// Shareholder read-only access is not vetted yet and stays refused.
const ROLE_ACTIONS={director:new Set(Object.keys(ACTIVATION_FIELDS)),admin:new Set(['car_billing_list','proof_upload','proof_url'])};
export const ADMIN_ACTIONS=new Set(['add_car_bill','car_snapshot',...ROLE_ACTIONS.admin]);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const REQUEST=/^[A-Za-z0-9_-]{16,80}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const invalid=message=>new ApiError(400,'INVALID',message);
const PNG=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const SIGNATURES={
 'image/png':bytes=>bytes.length>=8&&bytes.subarray(0,8).equals(PNG),
 'image/jpeg':bytes=>bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff,
 'application/pdf':bytes=>bytes.length>=5&&bytes.subarray(0,5).toString('latin1')==='%PDF-',
};

/** Strips an optional scope. Unscoped requests keep the phase 1/2 contract. */
export function readScope(body){
 if(!Object.hasOwn(body,'scope'))return {scoped:false,body};
 const {scope,...rest}=body;
 if(scope!==SCOPE)throw invalid('Choose a valid action.');
 return {scoped:true,body:rest};
}

/** Field list for a scoped action, or null. Money actions name a registered bank by ID; arbitrary staff linking is not offered. */
export function scopedFields(action,fields){
 if(typeof action!=='string')return null;
 if(Object.hasOwn(ACTIVATION_FIELDS,action))return ACTIVATION_FIELDS[action];
 if(action==='link_account'||!Object.hasOwn(fields,action))return null;
 return MONEY_ACTIONS.has(action)?fields[action].map(key=>key==='bankAccount'?'bankAccountId':key):fields[action];
}

/** Same Director + request + account always yields the same link; only the hash is stored. */
export function inviteSecrets(secret,actorId,requestId,potId){
 const material=['autodream-investor-invite',actorId,requestId,potId.toLowerCase()].join('\n');
 const token=createHmac('sha256',secret).update(material).digest('hex');
 return {token,tokenHash:sha(token),invitationId:createHmac('sha256',secret).update('invitation-id\n'+material).digest('hex').slice(0,32)};
}

/** Decodes canonical base64 and checks size and file signature against the declared type. */
export function decodeProof(mimeType,base64){
 if(!Object.hasOwn(SIGNATURES,mimeType))throw invalid('Choose a PNG or JPEG photo, or a PDF.');
 if(typeof base64!=='string'||base64.length<8||base64.length%4!==0||base64.length>Math.ceil(PROOF_MAX_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw invalid('Choose a PNG, JPEG or PDF up to 1.4 MB.');
 const bytes=Buffer.from(base64,'base64');
 if(bytes.length>PROOF_MAX_BYTES||bytes.toString('base64')!==base64)throw invalid('Choose a PNG, JPEG or PDF up to 1.4 MB.');
 if(!SIGNATURES[mimeType](bytes))throw invalid('The file content does not match a PNG, JPEG or PDF.');
 return {bytes,digest:sha(bytes)};
}

export function cleanFileName(name){
 if(typeof name!=='string')throw invalid('Name the file.');
 const clean=name.normalize('NFC').replace(/[\u0000-\u001f\u007f/\\]/g,'').trim();
 if(!clean||clean.length>120)throw invalid('Use a file name of up to 120 characters.');
 return clean;
}

const realDate=value=>{
 if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
 const d=new Date(value+'T00:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
};
const page=value=>value===undefined||(Number.isInteger(value)&&value>=0&&value<=1000);

/** Input checks for scoped activation actions, before rollout flags and rate limits. Returns cleaned data. */
export function validateActivation(user,action,data){
 if(!ROLE_ACTIONS[user.role]?.has(action))throw new ApiError(403,'FORBIDDEN',user.role==='admin'?'This account can record and view car expenses only.':'Only the Director can do this.');
 if(['save_bank','invite_investor'].includes(action)&&(typeof data.requestId!=='string'||!REQUEST.test(data.requestId)))throw invalid('A save reference is required.');
 if(action==='save_bank'){
  const name=typeof data.name==='string'?data.name.trim().replace(/\s+/g,' '):'';
  if(name.length<2||name.length>80||/[\u0000-\u001f\u007f]/.test(name))throw invalid('Enter the bank account name.');
  if(!realDate(data.openingDate))throw invalid('Choose the opening balance date.');
  if(!Number.isSafeInteger(data.openingCents)||data.openingCents<0||data.openingCents>1000000000000)throw invalid('Enter a valid opening balance.');
  return {...data,name};
 }
 if(['fundable_cars','car_billing_list'].includes(action)&&!page(data.page))throw invalid('Choose a valid page.');
 if(action==='invite_investor'&&!uuid(data.potId))throw invalid('Open the account again.');
 if(action==='proof_url'&&!uuid(data.documentId))throw invalid('Open the document again.');
 if(action==='proof_upload'){
  if(!uuid(data.billId)||!['bill','payment'].includes(data.kind)||(data.kind==='payment')!==(data.entryId!==undefined)||(data.entryId!==undefined&&!uuid(data.entryId)))throw invalid('Open the bill again.');
  if(data.requestId!==undefined&&(typeof data.requestId!=='string'||!REQUEST.test(data.requestId)))throw invalid('A save reference is required.');
  return {...data,fileName:cleanFileName(data.fileName)};
 }
 return data;
}

const ERRORS={
 INVALID_BANK:[400,'Choose a registered company bank account.'],
 BEFORE_BANK_OPENING:[400,'The payment date is before this bank account\'s opening balance date.'],
 REGISTERED_BANK_REQUIRED:[400,'Choose a registered company bank account.'],
 FUTURE_DATE:[400,'Choose a date that is not in the future.'],
 ALREADY_LINKED:[409,'This investor can already sign in. Ask them to use Forgot password on the sign-in page.'],
 BILL_VOIDED:[409,'This bill was voided. Attach evidence to an active bill.'],
 PROOF_LIMIT:[409,'This bill already has the maximum number of attachments.'],
 UPLOAD_MISSING:[503,'The file did not finish uploading. Retry the same file.'],
 NOT_DIRECTOR:[403,'You cannot open or change this record.'],
};
/** Maps phase 3 database errors without exposing diagnostics; null when not a phase 3 error. */
export function activationError(error){
 const message=String(error?.message??'');
 for(const [code,[status,text]] of Object.entries(ERRORS))if(message.includes(code))return new ApiError(status,code==='NOT_DIRECTOR'?'NOT_ALLOWED':code,text);
 return null;
}

async function call(ctx,actor,action,data){
 const out=await ctx.repo.rpc('uc_investor_activation',{p_actor:actor,p_action:action,p_data:data});
 if(!out.error)return out.data;
 const known=activationError(out.error);
 if(known)throw known;
 const message=String(out.error.message??'');
 if(message.includes('REQUEST_CHANGED'))throw new ApiError(409,'REQUEST_CHANGED','Retry the original save before changing it.');
 if(message.includes('NOT_ALLOWED'))throw new ApiError(403,'NOT_ALLOWED','You cannot open or change this record.');
 if(out.error.code==='23505')throw new ApiError(409,'DUPLICATE',action==='save_bank'?'A bank account with this name is already registered.':'This record is already saved.');
 if(message.includes('INVALID')||['22007','22008','22P02','23514','22003'].includes(out.error.code))throw invalid('Check the details and try again.');
 throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same save reference.');
}

// The installed throttle accepts only short prefixes (^[a-z]{1,8}:), so each
// limit shares 'invest:' with its own hashed key and never another's counter.
async function limit(ctx,kind,actorId,count,windowSeconds){
 const hit=await ctx.repo.throttleHit('invest:'+sha(kind+'\n'+actorId),count,windowSeconds);
 if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
}

/** Runs a validated scoped activation action for the authenticated actor. */
export async function runInvestorActivation(ctx,deps,user,action,data){
 if(action==='invite_investor'){
  // Refuse before creating anything when invitation links cannot be served.
  const config=accountConfig(deps.env,ctx.config.origins,{mail:false});
  await limit(ctx,'invite',user.id,10,3600);
  const secrets=inviteSecrets(ctx.config.secret,user.id,data.requestId,data.potId);
  const out=await call(ctx,user.id,'invite_investor',{potId:data.potId,requestId:data.requestId,invitationId:secrets.invitationId,tokenHash:secrets.tokenHash});
  // Nothing is emailed: the Director shares this link personally.
  return {status:200,body:{potId:out.potId,expiresAt:out.expiresAt,link:`${config.origin}/#/account/register?token=${secrets.token}`}};
 }
 if(action==='proof_upload'){
  if(typeof ctx.repo.uploadInvestorProof!=='function')throw new ApiError(503,'SETUP','Receipt storage is not activated yet. No changes were made.');
  await limit(ctx,'proof',user.id,30,900);
  const {bytes,digest}=decodeProof(data.mimeType,data.base64);
  // Without a client reference the same file on the same bill retries as one save.
  const requestId=data.requestId??'proof_'+sha([data.billId,data.entryId??'',data.kind,data.fileName,data.mimeType,digest].join('\n')).slice(0,40);
  const prepared=await call(ctx,user.id,'proof_prepare',{billId:data.billId,...(data.entryId?{entryId:data.entryId}:{}),kind:data.kind,fileName:data.fileName,mimeType:data.mimeType,sha256:digest,sizeBytes:bytes.length,requestId});
  if(prepared.state!=='confirmed'){
   try{await ctx.repo.uploadInvestorProof(prepared.path,bytes,data.mimeType);}
   catch{throw new ApiError(503,'UNAVAILABLE','The file could not be stored. Retry the same file.');}
   await call(ctx,user.id,'proof_confirm',{documentId:prepared.documentId});
  }
  return {status:200,body:{documentId:prepared.documentId}};
 }
 if(action==='proof_url'){
  if(typeof ctx.repo.investorProofUrl!=='function')throw new ApiError(503,'SETUP','Receipt storage is not activated yet.');
  const out=await call(ctx,user.id,'proof_read',{documentId:data.documentId});
  let url;
  try{url=await ctx.repo.investorProofUrl(out.path);}catch{throw new ApiError(503,'UNAVAILABLE','Could not open the file. Try again.');}
  if(typeof url!=='string'||!url.startsWith('https://'))throw new ApiError(503,'UNAVAILABLE','Could not open the file. Try again.');
  return {status:200,body:{url,name:out.fileName}};
 }
 return {status:200,body:await call(ctx,user.id,action,data)};
}
