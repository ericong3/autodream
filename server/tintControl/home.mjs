import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
const workshop=['garage_installer','garage_detailer','garage_spray'];
const managers=['director','shareholder','garage_head'];
const allowed=[...workshop,...managers,'garage_salesman','admin'];
export function homeTaskRows(user,data){
 const isWorker=workshop.includes(user.role),isManager=managers.includes(user.role);
 const tasks=[];
 for(const inv of data.invoices){
  if(inv.work_status==='closed'||inv.work_status==='draft')continue;
  if(!isWorker&&!isManager&&(inv.sales_owner_id??inv.created_by)!==user.id)continue;
  const ownerId=inv.sales_owner_id??inv.created_by;
  const job=data.jobs.find(j=>j.invoice_id===inv.id),review=data.reviews.find(r=>r.invoice_id===inv.id);
  const pieces=data.pieces.filter(p=>p.invoice_id===inv.id&&!['door_window','rear_panel_window'].includes(p.position));
  const own=pieces.filter(p=>p.installer_id===user.id),available=pieces.filter(p=>!p.installer_id&&p.status!=='installed');
  let action=job?'Follow installation':'Open work order',priority=5,scope=isManager?'Team order':'Your order';
  let href='/garage/invoice/'+encodeURIComponent(inv.id);
  if(isWorker){
   if(inv.delivered_at||!job)continue;
   if(!own.length&&!(review?.state==='working'&&available.length))continue;
   href='/garage/installer/job/'+encodeURIComponent(job.id);scope=own.length?'Your installation':'Available work';
   if(own.some(p=>p.needs_correction)){action='Complete your correction work';priority=0;}
   else if(own.some(p=>p.status!=='installed')){action='Continue your glass';priority=1;}
   else if(own.length&&!review?.confirmations?.[user.id]&&review?.state==='working'){action='Confirm your finished installation';priority=0;}
   else if(!own.length){action='Claim available glass';priority=2;}
   else{action='Check inspection progress';priority=4;}
  }else if(user.role==='garage_head'&&['head','correction_review'].includes(review?.state)){
   action=review.state==='head'?'Review installation':'Review returned work';priority=0;
   if(job)href='/garage/installer/job/'+encodeURIComponent(job.id);
  }else if(review?.state==='sales'&&ownerId===user.id){action='Complete your final inspection';priority=0;}
  else if(inv.work_status==='payment_due'){action=ownerId===user.id?'Check payment balance':'Check order payment';priority=1;}
  else if(inv.work_status==='ready_for_delivery'){action='Arrange handover';priority=1;}
  else if(inv.work_status==='ready_for_warranty'){action='Register warranty';priority=2;}
  const openDamage=(data.damageReports??[]).filter(r=>r.invoice_id===inv.id&&r.status==='open').length;
  if(openDamage&&user.role==='garage_head'){action='Review damage report';priority=0;if(job)href='/garage/installer/job/'+encodeURIComponent(job.id);}
  else if(openDamage&&!isWorker){action='Check damage report';priority=0;}
  const vehicle=data.vehicles.find(v=>v.id===inv.vehicle_id);
  tasks.push({id:inv.id,invoiceNumber:inv.invoice_number,service:inv.service,action,priority,scope,href,
   openDamage,vehicle:vehicle?[vehicle.registration_no,vehicle.make,vehicle.model].filter(Boolean).join(' · '):'Vehicle details in job',
   owner:isManager?data.users.find(u=>u.id===ownerId)?.name:undefined,
   availableGlass:isWorker?available.length:undefined,assignedGlass:isWorker?own.length:undefined});
 }
 return tasks.sort((a,b)=>a.priority-b.priority||a.invoiceNumber.localeCompare(b.invoiceNumber));
}
export async function handleHomeTasks(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(!allowed.includes(user.role)||!['garage','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','Garage access is required.');
 const body=readJson(req,1000);onlyKeys(body,['action']);if(body.action!=='list')throw new ApiError(400,'INVALID','Choose the task list.');
 const rate=await ctx.repo.throttleHit('home:'+createHash('sha256').update(user.id).digest('hex'),300,900);
 if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Try refreshing again shortly.');
 const isWorker=workshop.includes(user.role),canVerify=['director','admin'].includes(user.role);
 let data={invoices:[],jobs:[],reviews:[],pieces:[],vehicles:[],users:[],hasMore:false};
 if(user.role!=='admin')data=await ctx.repo.homeOrders({...user,salesReferrals:deps.env.GARAGE_SALES_REFERRALS_ONLINE==='1'});
 const tasks=homeTaskRows(user,data);
 // Existing finance RPC remains authoritative for every returned balance.
 if(!isWorker){await Promise.all(tasks.slice(0,12).filter(t=>t.service==='tinted').map(async task=>{
  const result=await ctx.repo.rpc('garage_tint_finance',{p_actor:user.id,p_action:'snapshot',p_data:{invoiceId:task.id}});
  if(result.error){task.balanceUnavailable=true;return;}
  task.money={toCollect:result.data.toCollect,awaitingVerification:result.data.awaitingVerification,verifiedBalance:result.data.verifiedBalance};
  if(task.priority>=2&&task.money.toCollect>0){task.action='Check customer balance';task.priority=1;}
 }));}
 let verification=null,financeUnavailable=false;
 if(canVerify){const r=await ctx.repo.rpc('garage_tint_finance',{p_actor:user.id,p_action:'queue',p_data:{page:0}});
  if(r.error)financeUnavailable=true;else verification={count:r.data.payments.length,hasMore:r.data.hasMore,href:'/garage/payments'};
 }
 return {status:200,body:{tasks:tasks.sort((a,b)=>a.priority-b.priority||a.invoiceNumber.localeCompare(b.invoiceNumber)).slice(0,12),hasMore:data.hasMore||tasks.length>12,canSeeBalances:!isWorker,verification,financeUnavailable,checkedAt:new Date(ctx.now()).toISOString()}};
});}
