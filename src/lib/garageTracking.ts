import {rowToInvoice} from './garageInvoices';
import {rowToVehicle} from './garageCustomers';
import {rowToJob} from './garageInstallerJobs';
import {rowToItem,isRequiredGlass} from './garageTint';
import {getWorkOrderStage,WORK_ORDER_STAGE_ORDER} from '../utils/garageWorkOrderStatus';
import type {GarageInvoice,GarageVehicle,GarageInstallerJob,GarageTintWorkOrderItem} from '../types';
import type {WorkOrderStage} from '../utils/garageWorkOrderStatus';
export type GarageTrackingRow={invoice:GarageInvoice;vehicle:GarageVehicle|null;customer:{id:string;name:string}|null;job:GarageInstallerJob|null;glass:GarageTintWorkOrderItem[];stage:WorkOrderStage};
export type GarageTrackingState={rows:GarageTrackingRow[];loading:boolean;refreshing:boolean;error:string;reload:()=>void};
export async function loadGarageTracking():Promise<GarageTrackingRow[]>{
 const response=await fetch('/api/garage/installation',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Garage-Building':'1'},body:JSON.stringify({action:'tracking'})});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(data?.error?.message||'Could not load work orders. Try again.');
 if(!Array.isArray(data?.orders))throw new Error('The work-order response was incomplete. Try again.');
 return data.orders.map((r:any)=>{
  const invoice=rowToInvoice(r);
  const jobs=(Array.isArray(r.jobs)?r.jobs:r.jobs?[r.jobs]:[]).sort((a:any,b:any)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id)));
  return {invoice,vehicle:r.vehicle?rowToVehicle(r.vehicle):null,customer:r.customer?{id:r.customer.id,name:r.customer.name}:null,
   job:invoice.service==='tinted'&&jobs[0]?rowToJob(jobs[0]):null,
   glass:(r.glass??[]).map(rowToItem).filter(isRequiredGlass),stage:getWorkOrderStage(invoice)};
 }).sort((a:GarageTrackingRow,b:GarageTrackingRow)=>WORK_ORDER_STAGE_ORDER[a.stage]-WORK_ORDER_STAGE_ORDER[b.stage]);
}
