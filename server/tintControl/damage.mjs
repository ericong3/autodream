import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
const roles=['director','shareholder','garage_head','garage_salesman','garage_installer','garage_detailer','garage_spray'];
const hash=v=>createHash('sha256').update(v).digest('hex');
export async function handleDamage(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(!roles.includes(user.role)||!['garage','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','Garage work-order access is required.');
 const data=readJson(req,3*1024*1024);onlyKeys(data,['action','invoiceId','reportId','photoId','kind','area','description','note','requestId','fileName','mime','content']);
 if(!['snapshot','create','resolve','upload','photo'].includes(data.action))throw new ApiError(400,'INVALID','Choose a damage-report action.');
 onlyKeys(data,{snapshot:['action','invoiceId'],create:['action','invoiceId','kind','area','description','requestId'],resolve:['action','invoiceId','reportId','note','requestId'],upload:['action','invoiceId','reportId','fileName','mime','content'],photo:['action','invoiceId','reportId','photoId']}[data.action]);
 if(typeof data.invoiceId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(data.invoiceId))throw new ApiError(400,'INVALID','Choose a work order.');
 for(const key of ['reportId'])if(data[key]!==undefined&&(typeof data[key]!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(data[key])))throw new ApiError(400,'INVALID','Choose a damage report.');
 if(data.action==='photo'&&(typeof data.photoId!=='number'||!Number.isSafeInteger(data.photoId)||data.photoId<1))throw new ApiError(400,'INVALID','Choose a photo.');
 if(data.action==='resolve'&&user.role!=='garage_head')throw new ApiError(403,'FORBIDDEN','Garage Head must review damage reports.');
 if(['create','resolve'].includes(data.action)&&(typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(data.requestId)))throw new ApiError(400,'INVALID','A retry reference is required.');
 for(const key of ['kind','area','description','note'])if(data[key]!==undefined&&(typeof data[key]!=='string'||data[key].length>(key==='area'?200:key==='kind'?20:2000)))throw new ApiError(400,'INVALID','Check the report details.');
 const rate=await ctx.repo.throttleHit('damage:'+hash(user.id),120,900);if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Try again shortly.');
 const rpc=async(action,payload)=>{const r=await ctx.repo.rpc('garage_tint_damage',{p_actor:user.id,p_action:action,p_data:payload});if(r.error){const m=r.error.message??'';const errors={NOT_ALLOWED:[403,'You cannot access this damage report.'],ORDER_DELIVERED:[409,'This order was delivered. Keep its damage history unchanged; use the replacement job for new reports.'],REQUEST_CHANGED:[409,'This retry has different details. Reload before continuing.'],DAMAGE_ALREADY_REVIEWED:[409,'This report was already reviewed.'],REASON_REQUIRED:[400,'Enter the review outcome.'],PHOTO_LIMIT:[409,'A report can have up to four photos.'],INVALID:[400,'Check the report details.']};for(const [code,[status,message]]of Object.entries(errors))if(m.includes(code))throw new ApiError(status,code,message);throw new ApiError(503,'UNAVAILABLE','The result could not be confirmed. Retry the same report before entering another.');}return r.data;};
 if(['snapshot','create','resolve'].includes(data.action)){const {action,...payload}=data;return {status:200,body:await rpc(action,payload)};}
 const snapshot=await rpc('snapshot',{invoiceId:data.invoiceId}),report=snapshot.reports.find(r=>r.id===data.reportId);
 if(!report)throw new ApiError(403,'FORBIDDEN','This report is unavailable.');
 if(data.action==='photo'){const photo=report.photos.find(p=>Number(p.id)===data.photoId);if(!photo)throw new ApiError(404,'NOT_FOUND','Photo not found.');return {status:200,body:{url:await ctx.repo.damageProofUrl(photo.path)}};}
 if(!snapshot.canReport||report.status!=='open'||(report.reported_by!==user.id&&user.role!=='garage_head'))throw new ApiError(403,'FORBIDDEN','The reporter or Garage Head can add photos while the report is open.');
 if(typeof data.content!=='string'||data.content.length>2800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(data.content)||typeof data.fileName!=='string'||data.fileName.length<1||data.fileName.length>255)throw new ApiError(400,'INVALID','Choose a JPEG, PNG or WebP photo up to 2 MB.');
 const bytes=Buffer.from(data.content,'base64'),valid=data.mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):data.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:data.mime==='image/webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':false;
 if(!valid||bytes.length<8||bytes.length>2097152)throw new ApiError(400,'INVALID','Choose a valid JPEG, PNG or WebP photo up to 2 MB.');
 const digest=hash(bytes),path=`${data.invoiceId}/${report.id}/${digest}`;
 if(report.photos.some(p=>p.path===path))return {status:200,body:{attached:true}};
 // The private database function remains authoritative for evidence limits during rollout.
 await ctx.repo.uploadDamageProof(path,bytes,data.mime);
 await rpc('evidence',{invoiceId:data.invoiceId,reportId:report.id,path,name:data.fileName,requestId:'damage_'+hash(report.id+digest)});
 return {status:200,body:{attached:true}};
});}
