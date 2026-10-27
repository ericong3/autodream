import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
import {createHash} from 'node:crypto';
export async function handleAppointments(req,deps){
 return respond(req,deps,['POST'],async(ctx,res)=>{
  const {user}=await authenticate(req,ctx,res,canUseApp);
  if(!['garage','both'].includes(user.business_access)||!['director','shareholder','garage_head','garage_salesman'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Garage sales access is required.');
  const rate=await ctx.repo.throttleHit('appt:'+createHash('sha256').update(user.id).digest('hex'),300,900);
  if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment before trying again.');
  const data=readJson(req,16000);
  onlyKeys(data,['action','id','revision','requestId','customerId','vehicleId','enquiryId','kind','service','title','notes','startsAt','endsAt','rangeStart','rangeEnd','page','invoiceId','appointmentId']);
  if(!['list','create','update','cancel','sale_options','confirm_sale'].includes(data.action))throw new ApiError(400,'INVALID','Unknown appointment action.');
  const invalid=()=>{throw new ApiError(400,'INVALID','Check the customer, service and appointment times.');};
  for(const key of ['id','requestId','customerId','vehicleId','enquiryId','kind','service','title','notes','invoiceId','appointmentId'])if(data[key]!==undefined&&(typeof data[key]!=='string'||data[key].length>(key==='notes'?2000:200)))invalid();
  for(const key of ['revision','page'])if(data[key]!==undefined&&(!Number.isInteger(data[key])||data[key]<0||data[key]>2147483647))invalid();
  if(data.action==='confirm_sale'&&data.appointmentId&&(!Number.isInteger(data.revision)||data.revision<1))invalid();
  const timeKeys=data.action==='list'?['rangeStart','rangeEnd']:['cancel','sale_options'].includes(data.action)||(data.action==='confirm_sale'&&data.appointmentId)?[]:['startsAt','endsAt'];
  for(const key of timeKeys)if(typeof data[key]!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(data[key])||!Number.isFinite(Date.parse(data[key])))invalid();
  const result=await ctx.repo.rpc(['sale_options','confirm_sale'].includes(data.action)?'garage_appointment_invoice_action':'garage_appointment_action',{p_actor:user.id,p_action:data.action,p_data:data});
  if(result.error){
   const msg=result.error.message||'';
   if(['40P01','40001'].includes(result.error.code))throw new ApiError(503,'RETRYABLE','Another change is finishing. Try saving again.');
   if(result.error.code==='23505')throw new ApiError(409,'CONFLICT','This booking changed. Reload before confirming.');
   if(msg.includes('ALREADY_LINKED'))throw new ApiError(409,'CONFLICT','This booking is already linked to another sale. Reload the bookings before confirming.');
   if(msg.includes('REQUEST_REUSED'))throw new ApiError(409,'ALREADY_SAVED','An earlier attempt already saved this booking. Close this form and reopen it from the calendar to edit it.');
   if(msg.includes('REVISION_CONFLICT'))throw new ApiError(409,'CONFLICT','This appointment changed. Reload the calendar before editing.');
   if(msg.includes('NOT_ALLOWED'))throw new ApiError(404,'NOT_FOUND','Appointment unavailable.');
   if(msg.includes('INVALID')||['22007','22008','22003','22P02','23514','23503'].includes(result.error.code))throw new ApiError(400,'INVALID','Check the customer, service and appointment times.');
   if(['42883','42P01','42703'].includes(result.error.code))throw new ApiError(503,'SETUP','Appointments are being prepared. Please try again later.');
   throw new ApiError(502,'CLOUD','Could not save the appointment. Your details are kept; try again.');
  }
  return {status:data.action==='create'?201:200,body:result.data};
 });
}
