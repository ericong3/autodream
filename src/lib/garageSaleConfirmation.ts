import type {PendingPayment} from '../pages/GarageWorkOrderPayment';
export type SalePayload={customerId:string;vehicleId:string;paymentStatus:'paid'|'pending';paymentMethod?:string;remark:string;pending:PendingPayment['pending'];addons:{name:string;price:number;qty:number}[];booking:{mode:'none'}|{mode:'existing';appointmentId:string;revision:number}|{mode:'new';startsAt:string;endsAt:string};receiptExpected:boolean;initialPayment?:{amount:number;method:string;reference:string}};
export type SaleIntent={requestId:string;sale:SalePayload;routeKey:string};
export type SaleResult={state:'saved'|'missing'|'abandoned'|'removed';invoiceId?:string;invoiceNumber?:string;receiptPath?:string|null;receiptExpected?:boolean;paymentStatus?:'paid'|'pending';replacementRequestId?:string;paymentId?:string;collectionPending?:boolean};
export async function saleConfirmation(action:'confirm'|'status'|'abandon',intent:SaleIntent):Promise<SaleResult>{
 const response=await fetch('/api/garage/sales',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Garage-Building':'1'},body:JSON.stringify({action,requestId:intent.requestId,...(action==='confirm'?{sale:intent.sale}:{})})});
 const result=await response.json().catch(()=>null);
 if(!response.ok)throw Object.assign(new Error(result?.error?.message||'Connection interrupted. Check the saved sale before trying again.'),{code:result?.error?.code});
 return result;
}
const pendingKey=(owner:string,customer:string,vehicle:string)=>`autodream-sale-pending:${owner}:${customer}:${vehicle}`;
const completedKey=(owner:string,route:string)=>`autodream-sale-completed:${owner}:${route}`;
function read(storage:Storage,key:string):SaleIntent|null{
 try{const raw=storage.getItem(key);if(!raw)return null;const value=JSON.parse(raw),sale=value?.sale;
  if(typeof value?.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(value.requestId)||typeof value.routeKey!=='string'
   ||!sale||typeof sale.customerId!=='string'||typeof sale.vehicleId!=='string'||!['paid','pending'].includes(sale.paymentStatus)||typeof sale.receiptExpected!=='boolean'
   ||!sale.pending||!Number.isFinite(sale.pending.finalTotal)||!Array.isArray(sale.pending.selections)||!Array.isArray(sale.pending.extras)
   ||!Array.isArray(sale.addons)||sale.addons.some((a:{price:number;qty:number})=>!a||!Number.isFinite(a.price)||!Number.isFinite(a.qty)))throw Error();
  return value;
 }catch{throw new Error('Recovery details could not be read. Please tell a director before confirming this sale again.');}
}
export function readSaleRecovery(owner:string,customer:string,vehicle:string,route:string):SaleIntent|null{const intent=read(sessionStorage,completedKey(owner,route))||read(localStorage,pendingKey(owner,customer,vehicle));if(intent&&(intent.sale.customerId!==customer||intent.sale.vehicleId!==vehicle))throw new Error('Recovery details belong to another vehicle. Please check with a director.');return intent;}
export async function keepSaleIntent(owner:string,intent:SaleIntent){
 const key=pendingKey(owner,intent.sale.customerId,intent.sale.vehicleId);
 const save=()=>{const existing=read(localStorage,key);if(existing&&(existing.requestId!==intent.requestId||JSON.stringify(existing.sale)!==JSON.stringify(intent.sale)))throw Object.assign(new Error('Another confirmation for this customer needs checking first.'),{code:'PENDING'});localStorage.setItem(key,JSON.stringify(intent));};
 if(typeof navigator!=='undefined'&&navigator.locks){let failure:unknown;await navigator.locks.request(key,()=>{try{save();}catch(error){failure=error;}});if(failure)throw failure;}else save();
}
export function finishSaleIntent(owner:string,intent:SaleIntent){sessionStorage.setItem(completedKey(owner,intent.routeKey),JSON.stringify(intent));clearSaleIntent(owner,intent);}
export function clearSaleIntent(owner:string,intent:SaleIntent){const key=pendingKey(owner,intent.sale.customerId,intent.sale.vehicleId);try{if(read(localStorage,key)?.requestId===intent.requestId)localStorage.removeItem(key);}catch{/* Keep unrecognisable recovery data; a known committed sale must still finish. */}}

export function forgetSaleIntent(owner:string,intent:SaleIntent){clearSaleIntent(owner,intent);const key=completedKey(owner,intent.routeKey);try{if(read(sessionStorage,key)?.requestId===intent.requestId)sessionStorage.removeItem(key);}catch{/* Do not erase an unrelated completion marker. */}}

export function saleDraftId(route:string,customer:string,vehicle:string){const key=`autodream-sale-draft:${route}:${customer}:${vehicle}`;try{const existing=sessionStorage.getItem(key);if(existing&&/^[A-Za-z0-9_-]{16,80}$/.test(existing))return existing;const id=crypto.randomUUID();sessionStorage.setItem(key,id);return id;}catch{return crypto.randomUUID();}}

export function currentSaleDraftId(base:string){let id=base;for(let n=0;n<100;n++){const next=localStorage.getItem(`autodream-sale-successor:${id}`);if(!next||!/^[A-Za-z0-9_-]{16,80}$/.test(next)||next===id)return id;id=next;}throw new Error('Please check this sale with a director before confirming.');}
export function supersedeSaleDraft(oldId:string,newId:string){if(!/^[A-Za-z0-9_-]{16,80}$/.test(newId))throw new Error('Could not prepare a new confirmation. Check the saved sale again.');localStorage.setItem(`autodream-sale-successor:${oldId}`,newId);}
