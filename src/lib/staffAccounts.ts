export interface StaffAccount { id:string;name:string;username:string;email:string|null;verified:boolean;role:string;businessAccess:string;enabled:boolean;status:string;existingOnly?:boolean;employmentStatus?:'current'|'former';lastWorkingDate?:string|null }
export interface StaffInvitation { id:string;role:string;businessAccess:string;expiresAt:string;used:boolean;revoked:boolean }
export async function accountRequest(data?:Record<string,unknown>):Promise<Record<string,unknown>> {
 const res=await fetch('/api/auth/accounts',{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'X-Garage-Building':'1',...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
 const result=await res.json().catch(()=>null);
 if(!res.ok)throw new Error(result?.error?.message||'Account service is unavailable. Please try again.');
 if(!result||typeof result!=='object')throw new Error('Account service returned an invalid response.');
 return result;
}
export const STAFF_ROLE_LABELS:Record<string,string>={director:'Director',shareholder:'Shareholder',salesperson:'Salesperson',admin:'Admin',mechanic:'Mechanic',investor:'Investor',banker:'Banker',garage_head:'Garage head',garage_salesman:'Garage salesperson',garage_installer:'Installer',garage_detailer:'Detailer',garage_spray:'Spray painter'};
export const BUSINESS_LABELS:Record<string,string>={used_car:'Used Car',garage:'Garage',both:'Both businesses'};
