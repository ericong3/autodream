import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function handlePaymentProof(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(!['garage','both'].includes(user.business_access)||!['director','admin','shareholder','garage_head','garage_salesman'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Garage financial access is required.');
 const data=readJson(req,3*1024*1024);onlyKeys(data,['action','invoiceId','paymentId','fileName','mime','content']);
 if(!['upload','read'].includes(data.action)||![data.invoiceId,data.paymentId].every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v)))throw new ApiError(400,'INVALID','Choose a payment.');
 const rate=await ctx.repo.throttleHit('proof:'+hash(user.id),60,900);if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Try again shortly.');
 const snapshot=await ctx.repo.rpc('garage_tint_finance',{p_actor:user.id,p_action:'snapshot',p_data:{invoiceId:data.invoiceId}});
 if(snapshot.error)throw new ApiError(403,'FORBIDDEN','This payment is unavailable for your account.');
 const payment=snapshot.data.payments.find(p=>p.id===data.paymentId);
 if(!payment)throw new ApiError(403,'FORBIDDEN','This payment is unavailable for your account.');
 if(data.action==='read'){
  if(!payment.receipt_path)throw new ApiError(404,'NOT_FOUND','No proof has been attached.');
  return {status:200,body:{url:await ctx.repo.paymentProofUrl(payment.receipt_path)}};
 }
 if(!['pending','rejected'].includes(payment.state)||(payment.recorded_by!==user.id&&!['director','admin'].includes(user.role)))throw new ApiError(403,'FORBIDDEN','Only the collector or authorised finance staff can attach proof before verification.');
 if(typeof data.content!=='string'||data.content.length>2800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(data.content)||typeof data.fileName!=='string'||data.fileName.length<1||data.fileName.length>255)throw new ApiError(400,'INVALID','Choose an image or PDF up to 2 MB.');
 const bytes=Buffer.from(data.content,'base64');
 const signatures={
  'image/png':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
  'image/jpeg':bytes[0]===255&&bytes[1]===216&&bytes[2]===255,
  'application/pdf':bytes.subarray(0,5).toString()==='%PDF-',
  'image/webp':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP',
 };
 if(bytes.length<5||bytes.length>2097152||!signatures[data.mime])throw new ApiError(400,'INVALID','Choose a valid JPEG, PNG, WebP or PDF up to 2 MB.');
 const digest=hash(bytes),path=`${data.invoiceId}/${data.paymentId}/${digest}`;
 if(payment.receipt_path){if(payment.receipt_path!==path)throw new ApiError(409,'PROOF_LOCKED','Proof is already attached; its evidence cannot be replaced.');return {status:200,body:{attached:true}};}
 await ctx.repo.uploadPaymentProof(path,bytes,data.mime);
 const attached=await ctx.repo.rpc('garage_tint_finance',{p_actor:user.id,p_action:'receipt',p_data:{invoiceId:data.invoiceId,paymentId:data.paymentId,path,name:data.fileName,requestId:'proof_'+hash(data.paymentId+digest)}});
 if(attached.error)throw new ApiError(409,'RECHECK','The file uploaded but attachment was not confirmed. Retry the same file.');
 return {status:200,body:{attached:true}};
});}
