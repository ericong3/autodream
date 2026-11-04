// Investor purchase and withdrawal evidence: the supplier invoice and payment
// receipt for an investor car purchase, and the payment receipt for a
// withdrawal payout, kept in the private finance-evidence bucket. Prepared
// handler only; a request carrying scope 'investor_money_evidence' reaches it
// once the private finance bridge routes it here.
// The browser never chooses the actor, the storage path or a URL: the
// database authorises every document and the server signs links on demand.
// Director uploads; a linked investor lists and opens their own account's
// documents. Admin and other staff are refused.
import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {decodeProof,cleanFileName} from './investorActivation.mjs';

export const SCOPE='investor_money_evidence';
const BODY_MAX=4096,UPLOAD_BODY_MAX=2_100_000;
export const FIELDS={upload:['target','carId','withdrawalId','kind','fileName','mimeType','base64','amountCents','requestId'],list:['target','carId','withdrawalId','potId'],open:['documentId']};
// Target -> the one ID field it uses. 'pot' lists a whole account's history.
const TARGET_ID={purchase:'carId',withdrawal:'withdrawalId',pot:'potId'};
const KINDS={purchase:['invoice','payment'],withdrawal:['payment']};
/** Document fields the payment commands must send (uc_investor_capital). */
export const PAYMENT_PROOF_FIELDS={purchase_paid:['invoiceDocumentId','receiptDocumentId'],withdrawal_paid:['receiptDocumentId']};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const carId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const REQUEST=/^[A-Za-z0-9_-]{16,80}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const invalid=message=>new ApiError(400,'INVALID',message);

export function isInvestorMoneyEvidenceRequest(req){try{return (typeof req.body==='string'?JSON.parse(req.body):req.body)?.scope===SCOPE;}catch{return false;}}

const ERRORS={
 PURCHASE_INVOICE_REQUIRED:[409,'Upload and choose the supplier invoice before recording the car payment.'],
 PAYMENT_RECEIPT_REQUIRED:[409,'Upload and choose the payment receipt before recording payment.'],
 MONEY_PROOF_REQUIRED:[409,'Upload and choose the payment documents before recording payment.'],
 PROOF_NOT_FOR_PAYMENT:[409,'Choose the documents uploaded for this payment.'],
 PROOF_NOT_CONFIRMED:[409,'The file did not finish uploading. Upload it again.'],
 PROOF_AMOUNT_CHANGED:[409,'The payment amount has changed. Check it and upload the documents again.'],
 PROOF_ALREADY_USED:[409,'This document already proves another payment.'],
 RECEIPT_USED_ELSEWHERE:[409,'This receipt already proves another payment.'],
 RECEIPT_SAME_AS_INVOICE:[409,'Upload proof of payment, separately from the supplier invoice.'],
 ALREADY_PAID:[409,'This payment is already recorded.'],
 APPROVAL_REQUIRED:[409,'The Director must approve this withdrawal first.'],
 PROOF_LIMIT:[409,'This payment already has the maximum number of attachments.'],
 UPLOAD_MISSING:[503,'The file did not finish uploading. Retry the same file.'],
 REQUEST_CHANGED:[409,'Retry the original save before changing it.'],
 NOT_ALLOWED:[403,'You cannot open or change this record.'],
};
/** Known evidence refusals as safe API errors, or null. Also for purchase_paid / withdrawal_paid replies. */
export function moneyEvidenceError(error){
 const message=String(error?.message??'');
 for(const [code,[status,text]] of Object.entries(ERRORS))if(message.includes(code))return new ApiError(status,code,text);
 return null;
}
function evidenceError(error){
 const known=moneyEvidenceError(error);if(known)return known;
 if(error?.code==='23505')return new ApiError(409,'DUPLICATE','This document is already saved.');
 if(String(error?.message??'').includes('INVALID')||['22007','22008','22P02','23514','22003'].includes(error?.code))return invalid('Check the details and try again.');
 return new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same upload.');
}

/** Checks the document IDs a payment command carries before it reaches the database. */
export function validatePaymentProof(action,body){
 const keys=PAYMENT_PROOF_FIELDS[action];if(!keys)return;
 for(const key of keys){
  if(body[key]===undefined)throw new ApiError(400,key==='invoiceDocumentId'?'PURCHASE_INVOICE_REQUIRED':'PAYMENT_RECEIPT_REQUIRED',key==='invoiceDocumentId'?ERRORS.PURCHASE_INVOICE_REQUIRED[1]:ERRORS.PAYMENT_RECEIPT_REQUIRED[1]);
  if(!uuid(body[key]))throw invalid('Choose the uploaded document again.');
 }
}

async function call(ctx,actor,action,data){
 let out;
 try{out=await ctx.repo.rpc('uc_investor_money_evidence',{p_actor:actor,p_action:action,p_data:data});}
 catch{throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same upload.');}
 if(out?.error)throw evidenceError(out.error);
 return out?.data;
}

// Browser-facing fields only: never the storage path or digest.
const safeDocument=d=>({documentId:d.documentId,target:d.target,carId:d.carId,withdrawalId:d.withdrawalId,kind:d.kind,fileName:d.fileName,mimeType:d.mimeType,
 sizeBytes:d.sizeBytes,amountCents:d.amountCents,state:d.state,uploadedAt:d.uploadedAt,actorName:d.actorName,used:d.used,entryId:d.entryId});
const LIST_KEYS=['target','carId','withdrawalId','potId','amountCents','paid','withdrawalState','invoiceConfirmed','receiptConfirmed'];

/** Input checks before rollout flags and rate limits. Returns cleaned data. */
export function validateEvidence(user,action,data){
 if(action==='open'){if(!uuid(data.documentId))throw invalid('Open the document again.');return data;}
 const targets=action==='upload'?['purchase','withdrawal']:['purchase','withdrawal','pot'];
 if(!targets.includes(data.target))throw invalid('Choose the car purchase or the withdrawal.');
 const idKey=TARGET_ID[data.target];
 for(const key of Object.values(TARGET_ID))if(key!==idKey&&data[key]!==undefined)throw invalid('Open the payment again.');
 if(!(idKey==='carId'?carId(data.carId):uuid(data[idKey])))throw invalid('Open the payment again.');
 if(action==='list')return data;
 if(user.role!=='director')throw new ApiError(403,'FORBIDDEN','A Director must upload payment documents.');
 if(!KINDS[data.target].includes(data.kind))throw invalid(data.target==='withdrawal'?'A withdrawal needs the payment receipt.':'Choose the supplier invoice or the payment receipt.');
 if(!Number.isSafeInteger(data.amountCents)||data.amountCents<1||data.amountCents>1000000000000)throw invalid('Enter the payment amount.');
 if(typeof data.requestId!=='string'||!REQUEST.test(data.requestId))throw invalid('A save reference is required.');
 return {...data,fileName:cleanFileName(data.fileName)};
}

// The installed throttle accepts only short prefixes (^[a-z]{1,8}:).
async function limit(ctx,kind,actorId,count,windowSeconds){
 const hit=await ctx.repo.throttleHit('invmon:'+sha(kind+'\n'+actorId),count,windowSeconds);
 if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
}

export async function handleInvestorMoneyEvidence(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(!['director','investor'].includes(user.role)||!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','This account cannot open investor payment documents.');
 const body=readJson(req,UPLOAD_BODY_MAX);
 if(body.scope!==SCOPE)throw invalid('Choose a valid action.');
 // Only an upload may exceed the normal body size.
 if(body.action!=='upload'&&Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(body))>BODY_MAX)throw new ApiError(413,'INVALID','Request is too large.');
 if(typeof body.action!=='string'||!Object.hasOwn(FIELDS,body.action))throw invalid('Choose a valid action.');
 onlyKeys(body,['scope','action',...FIELDS[body.action]]);
 const {scope:_,action,...input}=body;
 const data=validateEvidence(user,action,input);
 if(deps.env.USED_CAR_INVESTOR_CAPITAL_ONLINE!=='1'||deps.env.USED_CAR_INVESTOR_CARS_ONLINE!=='1')throw new ApiError(503,'SETUP','Investor saving is not activated yet. No changes were made.');
 await limit(ctx,'all',user.id,120,900);
 const target=action==='open'?null:{target:data.target,[TARGET_ID[data.target]]:data[TARGET_ID[data.target]]};

 if(action==='upload'){
  if(typeof ctx.repo.uploadInvestorProof!=='function')throw new ApiError(503,'SETUP','Receipt storage is not activated yet. No changes were made.');
  await limit(ctx,'upload',user.id,30,900);
  const {bytes,digest}=decodeProof(data.mimeType,data.base64);
  const prepared=await call(ctx,user.id,'prepare',{...target,kind:data.kind,fileName:data.fileName,mimeType:data.mimeType,sha256:digest,sizeBytes:bytes.length,amountCents:data.amountCents,requestId:data.requestId});
  if(prepared?.state==='confirmed')return {status:200,body:{document:safeDocument(prepared)}};
  if(typeof prepared?.path!=='string'||!uuid(prepared.documentId))throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same upload.');
  // Storage first, then the database confirms the object exists. The path is
  // content-addressed, so an object left by an earlier attempt is this file.
  let stored=true;
  try{await ctx.repo.uploadInvestorProof(prepared.path,bytes,data.mimeType);}catch{stored=false;}
  let confirmed;
  try{confirmed=await call(ctx,user.id,'confirm',{documentId:prepared.documentId});}
  catch(error){if(!stored&&error.code==='UPLOAD_MISSING')throw new ApiError(503,'UNAVAILABLE','The file could not be stored. Retry the same file.');throw error;}
  return {status:200,body:{document:safeDocument(confirmed)}};
 }
 if(action==='open'){
  if(typeof ctx.repo.investorProofUrl!=='function')throw new ApiError(503,'SETUP','Receipt storage is not activated yet.');
  const out=await call(ctx,user.id,'read',{documentId:data.documentId});
  let url;
  try{url=await ctx.repo.investorProofUrl(out.path);}catch{throw new ApiError(503,'UNAVAILABLE','Could not open the file. Try again.');}
  if(typeof url!=='string'||!url.startsWith('https://'))throw new ApiError(503,'UNAVAILABLE','Could not open the file. Try again.');
  return {status:200,body:{url,name:out.fileName,mimeType:out.mimeType}};
 }
 const out=await call(ctx,user.id,'list',target);
 const summary=Object.fromEntries(LIST_KEYS.filter(key=>out?.[key]!==undefined).map(key=>[key,out[key]]));
 return {status:200,body:{...summary,documents:(Array.isArray(out?.documents)?out.documents:[]).map(safeDocument)}};
});}
