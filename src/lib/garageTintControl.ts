import {useStore} from '../store';
export type TintPayment={id:string;invoice_id:string;invoice_number?:string;amount:number;method:string;reference:string;received_at:string;recorded_by:string;state:'pending'|'verified'|'rejected'|'voided';reviewed_by?:string;reviewed_at?:string;review_note?:string;receipt_path?:string;receipt_name?:string};
export type TintMoney={invoiceId:string;invoiceNumber:string;total:number;collected:number;verified:number;awaitingVerification:number;toCollect:number;verifiedBalance:number;canVerify:boolean;paymentId?:string;payments:TintPayment[]};
export type TintUsage={afterSalesReplacementCount:number;afterSalesUsage:number;replacementCount:number;totalUsage:number;attempts:{position:string;item_id:string;attempt:number;installer_id:string;series:string;kind:string;sqft:number;closed_at?:string}[]};
export async function tintControl<T>(kind:'finance'|'stock'|'claims',action:string,data:Record<string,unknown>={}):Promise<T>{
 const owner=useStore.getState().currentUser?.id;
 const r=await fetch('/api/garage/tint?operation='+kind,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Garage-Building':'1'},body:JSON.stringify({action,...data})});
 const result=await r.json().catch(()=>null);
 if(owner!==useStore.getState().currentUser?.id)throw new Error('Your account changed. Reload this work order.');
 if(!r.ok)throw Object.assign(new Error(result?.error?.message||'Could not confirm the result. Retry the same action.'),{code:result?.error?.code});
 return result;
}
export async function paymentProof(invoiceId:string,paymentId:string,file?:File):Promise<{url?:string;attached?:boolean}>{
 const owner=useStore.getState().currentUser?.id;
 let content:string|undefined;
 if(file){if(file.size>2097152)throw new Error('Choose proof up to 2 MB.');content=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read this file.'));reader.readAsDataURL(file);});}
 const response=await fetch('/api/garage/tint?operation=payment-proof',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Garage-Building':'1'},body:JSON.stringify({action:file?'upload':'read',invoiceId,paymentId,...(file?{fileName:file.name,mime:file.type,content}:{})})});
 const result=await response.json().catch(()=>null);
 if(owner!==useStore.getState().currentUser?.id)throw new Error('Your account changed. Reload this work order.');
 if(!response.ok)throw new Error(result?.error?.message||'Proof could not be confirmed. Retry the same file.');
 return result;
}
