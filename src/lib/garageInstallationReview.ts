import {useStore} from '../store';
export type InstallationReview={invoice_id:string;revision:number;state:'working'|'head'|'sales'|'correction_review'|'ready';confirmations:Record<string,string>;head_by?:string;head_at?:string;sales_by?:string;sales_at?:string;reason?:string};
export type InstallationSnapshot={review:InstallationReview;job:any;result?:any;itemIds?:string[];history?:{id:number;actor_id:string;action:string;details:Record<string,unknown>;created_at:string}[]};
// Frontend owner only namespaces revision cache. The server derives actual identity.
const cache=new Map<string,InstallationSnapshot>(),references=new Map<string,string>();let cacheOwner:string|undefined;
function owner(){const id=useStore.getState().currentUser?.id;if(id!==cacheOwner){cache.clear();references.clear();cacheOwner=id;}return id;}
async function request(body:Record<string,unknown>){
 const actor=owner();const r=await fetch('/api/garage/installation',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Garage-Building':'1'},body:JSON.stringify(body)});
 const data=await r.json().catch(()=>null);
 if(owner()!==actor)throw new Error('Your account changed. Refresh this work order.');
 if(!r.ok){cache.clear();references.clear();throw new Error(data?.error?.message||'Could not confirm the result. Refresh this work order before trying again.');}
 if(data.review&&data.job){const invoice=data.review.invoice_id,existing=cache.get(invoice);if(existing&&existing.review.revision>data.review.revision){if(body.action==='snapshot')return existing;return data;}cache.set(invoice,data);references.set('invoiceId:'+invoice,invoice);references.set('jobId:'+data.job.id,invoice);for(const id of data.itemIds??[])references.set('itemId:'+id,invoice);}return data;
}
export async function installationSnapshot(ref:{invoiceId?:string;jobId?:string;itemId?:string}):Promise<InstallationSnapshot>{return request({action:'snapshot',...ref});}
export async function installationMutation(action:string,ref:{invoiceId?:string;jobId?:string;itemId?:string},value:Record<string,unknown>={},revision?:number):Promise<InstallationSnapshot>{
 owner();const pair=Object.entries(ref)[0],key=pair[0]+':'+pair[1],invoice=references.get(key);
 const existing=(invoice?cache.get(invoice):undefined)??await installationSnapshot(ref);
 return request({action,...ref,...value,revision:revision??existing.review.revision,requestId:crypto.randomUUID()});
}
export async function installationNotices():Promise<{invoiceId:string;jobId:string;invoiceNumber:string;state:string;reason?:string}[]>{return (await request({action:'notices'})).notices;}
