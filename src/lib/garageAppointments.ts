import type { GarageAppointment, GarageService } from '../types';
export type AppointmentService=GarageService|'building_tint';
export type AppointmentInput={customerId:string;vehicleId?:string;enquiryId?:string;kind:'visit'|'installation';service:AppointmentService;title?:string;notes?:string;startsAt:string;endsAt:string};
export const appointmentKindLabel=(kind:string)=>kind==='installation'?'Installation':'Customer visit';
async function request(data:Record<string,unknown>){
 const res=await fetch('/api/garage/appointments',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Garage-Building':'1'},body:JSON.stringify(data)});
 const result=await res.json().catch(()=>null);
 if(!res.ok)throw Object.assign(new Error(result?.error?.message||'Appointments are unavailable. Try again.'),{code:result?.error?.code});
 return result;
}
function fromRow(r:any):GarageAppointment{return {id:r.id,customerId:r.customer_id,vehicleId:r.vehicle_id||undefined,enquiryId:r.enquiry_id||undefined,invoiceId:r.invoice_id||undefined,kind:r.appointment_kind,revision:r.revision,service:r.service,title:r.title||undefined,notes:r.notes||undefined,startsAt:r.starts_at,endsAt:r.ends_at,createdBy:r.created_by||undefined,createdAt:r.created_at};}
export async function listAppointmentsInRange(rangeStart:string,rangeEnd:string):Promise<GarageAppointment[]>{
 const rows:GarageAppointment[]=[];let page=0,more=true;
 while(more){const r=await request({action:'list',rangeStart,rangeEnd,page:page++});rows.push(...(r.appointments||[]).map(fromRow));more=!!r.hasMore;}
 return rows;
}
export async function createGarageAppointment(input:AppointmentInput&{requestId:string}):Promise<GarageAppointment>{const r=await request({action:'create',...input});return fromRow(r.saved);}
export async function updateGarageAppointment(id:string,input:AppointmentInput&{revision:number}):Promise<GarageAppointment>{const r=await request({action:'update',id,...input});return fromRow(r.saved);}
export async function deleteGarageAppointment(id:string,revision:number):Promise<void>{await request({action:'cancel',id,revision});}

export async function saleAppointmentOptions(customerId:string,vehicleId:string,service:GarageService):Promise<{appointments:GarageAppointment[];hasMore:boolean}>{const r=await request({action:'sale_options',customerId,vehicleId,service});return {appointments:(r.appointments||[]).map(fromRow),hasMore:!!r.hasMore};}
export async function confirmSaleAppointment(invoiceId:string,booking:{appointmentId:string;revision:number}|{startsAt:string;endsAt:string}):Promise<GarageAppointment>{const data={action:'confirm_sale',invoiceId,...booking};let result;try{result=await request(data);}catch(error){if((error as {code?:string}).code!=='RETRYABLE')throw error;result=await request(data);}return fromRow(result.saved);}
