export const enquiryServices=['Tint','Coating','PPF','Spray','Building tint'] as const;
export type EnquiryService=typeof enquiryServices[number];
export interface Enquiry {id:string;customer_id:string;owner_id:string;name:string;phone:string;asset:string;next_action:string;reminder_date:string|null;revision:number;services:{name:EnquiryService;status:string}[]}
export interface CustomerMatch {id:string;name:string;phone:string;ic_number?:string}
export class EnquiryError extends Error {constructor(public code:string,message:string){super(message);}}
export async function enquiryRequest(data?:Record<string,unknown>):Promise<{enquiries?:Enquiry[];customers?:CustomerMatch[];saved?:Enquiry;hasMore?:boolean;customer?:Record<string,unknown>|null}>{
 const res=await fetch('/api/garage/enquiries',{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'X-Garage-Building':'1',...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
 const result=await res.json().catch(()=>null);
 if(!res.ok)throw new EnquiryError(result?.error?.code||'CLOUD',result?.error?.message||'Enquiries are unavailable. Try again.');
 return result;
}
