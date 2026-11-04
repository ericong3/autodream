// Company (non-investor) payment evidence: supplier invoices and payment
// receipts for public.payments rows, kept in the private finance-evidence
// bucket. Prepared handler only; a request carrying scope 'company_evidence'
// reaches it once the private finance bridge routes it here.
// The browser never chooses the actor, the storage path or a URL: the
// database authorises every document and the server signs links on demand.
import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {decodeProof,cleanFileName} from './investorActivation.mjs';

export const SCOPE='company_evidence';
const BODY_MAX=4096,UPLOAD_BODY_MAX=2_100_000;
export const FIELDS={upload:['paymentId','kind','fileName','mimeType','base64','requestId'],list:['paymentId'],open:['documentId']};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const paymentId=value=>typeof value==='string'&&value.length>=1&&value.length<=180&&!/[\u0000-\u001f\u007f]/.test(value);
const REQUEST=/^[A-Za-z0-9_-]{16,80}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const invalid=message=>new ApiError(400,'INVALID',message);

export function isCompanyEvidenceRequest(req){try{return (typeof req.body==='string'?JSON.parse(req.body):req.body)?.scope===SCOPE;}catch{return false;}}

const ERRORS={
 SUPPLIER_INVOICE_REQUIRED:[409,'Upload the supplier invoice before approving this bill.'],
 PAYMENT_RECEIPT_REQUIRED:[409,'Upload the payment receipt before recording payment.'],
 INVOICE_NOT_REQUIRED:[409,'This payment needs a payment receipt, not a supplier invoice.'],
 RECEIPT_SAME_AS_INVOICE:[409,'Upload proof of payment, separately from the supplier invoice.'],
 CLAIM_LOCKED:[409,'This claim has already been checked. Ask admin to review a correction.'],
 EVIDENCE_REVIEW_REQUIRED:[409,'This payment has confirmed documents. The Director must review a correction.'],
 USE_INVESTOR_CAR_BILLS:[409,'This car is funded from an investor account. Use its car bills.'],
 PROOF_LIMIT:[409,'This payment already has the maximum number of attachments.'],
 UPLOAD_MISSING:[503,'The file did not finish uploading. Retry the same file.'],
 REQUEST_CHANGED:[409,'Retry the original upload before changing it.'],
 NOT_ALLOWED:[403,'You cannot open or change this record.'],
};
/** Maps database errors without exposing diagnostics. */
export function evidenceError(error){
 const message=String(error?.message??'');
 for(const [code,[status,text]] of Object.entries(ERRORS))if(message.includes(code))return new ApiError(status,code,text);
 if(error?.code==='23505')return new ApiError(409,'DUPLICATE','This document is already saved.');
 if(message.includes('INVALID')||['22007','22008','22P02','23514','22003'].includes(error?.code))return invalid('Check the details and try again.');
 return new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same upload.');
}

async function call(ctx,actor,action,data){
 let out;
 try{out=await ctx.repo.rpc('uc_company_evidence',{p_actor:actor,p_action:action,p_data:data});}
 catch{throw new ApiError(503,'UNAVAILABLE','Could not confirm the save. Retry the same upload.');}
 if(out?.error)throw evidenceError(out.error);
 return out?.data;
}

// Browser-facing document fields only: never the storage path or digest.
const safeDocument=d=>({documentId:d.documentId,kind:d.kind,fileName:d.fileName,mimeType:d.mimeType,sizeBytes:d.sizeBytes,state:d.state,uploadedAt:d.uploadedAt,createdBy:d.createdBy,actorName:d.actorName});

/** Input checks before rollout flags and rate limits. Returns cleaned data. */
export function validateEvidence(user,action,data){
 if(action==='open'){if(!uuid(data.documentId))throw invalid('Open the document again.');return data;}
 if(!paymentId(data.paymentId))throw invalid('Open the payment again.');
 if(action==='list')return data;
 if(!['invoice','payment'].includes(data.kind))throw invalid('Choose a supplier invoice or a payment receipt.');
 // Staff attach the invoice for their own claim only; the database re-checks.
 if(!['director','admin'].includes(user.role)&&data.kind!=='invoice')throw new ApiError(403,'FORBIDDEN','You can attach the invoice for your own claim only.');
 if(typeof data.requestId!=='string'||!REQUEST.test(data.requestId))throw invalid('A save reference is required.');
 return {...data,fileName:cleanFileName(data.fileName)};
}

// The installed throttle accepts only short prefixes (^[a-z]{1,8}:).
async function limit(ctx,kind,actorId,count,windowSeconds){
 const hit=await ctx.repo.throttleHit('compev:'+sha(kind+'\n'+actorId),count,windowSeconds);
 if(!hit.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
}

export async function handleCompanyEvidence(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(user.role==='investor')throw new ApiError(403,'FORBIDDEN','Use your investor account page.');
 if(!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','Used Car access is required.');
 const body=readJson(req,UPLOAD_BODY_MAX);
 if(body.scope!==SCOPE)throw invalid('Choose a valid action.');
 // Only an upload may exceed the normal body size.
 if(body.action!=='upload'&&Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(body))>BODY_MAX)throw new ApiError(413,'INVALID','Request is too large.');
 if(typeof body.action!=='string'||!Object.hasOwn(FIELDS,body.action))throw invalid('Choose a valid action.');
 onlyKeys(body,['scope','action',...FIELDS[body.action]]);
 const {scope:_,action,...input}=body;
 const data=validateEvidence(user,action,input);
 if(deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE!=='1')throw new ApiError(503,'SETUP','Private finance saving is waiting for activation.');
 await limit(ctx,'all',user.id,120,900);

 if(action==='upload'){
  if(typeof ctx.repo.uploadInvestorProof!=='function')throw new ApiError(503,'SETUP','Receipt storage is not activated yet. No changes were made.');
  await limit(ctx,'upload',user.id,30,900);
  const {bytes,digest}=decodeProof(data.mimeType,data.base64);
  const prepared=await call(ctx,user.id,'prepare',{paymentId:data.paymentId,kind:data.kind,fileName:data.fileName,mimeType:data.mimeType,sha256:digest,sizeBytes:bytes.length,requestId:data.requestId});
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
 const out=await call(ctx,user.id,'list',{paymentId:data.paymentId});
 return {status:200,body:{...out,documents:(Array.isArray(out?.documents)?out.documents:[]).map(safeDocument)}};
});}
