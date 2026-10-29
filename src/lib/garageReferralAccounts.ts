export type ReferralProfile={legalName:string;recipientType:'individual'|'business';identityNumber:string;tin:string;address:string;phone:string;brand:string;branch:string;bank:string;bankAccount:string;bankHolder:string};
export type ReferralAccount={id:string;externalSalesmanId?:string;email?:string;profile:Partial<ReferralProfile>;registeredAt?:string;emailVerifiedAt?:string;approvedAt?:string;enabled:boolean};
export async function referralAccountRequest<T=Record<string,unknown>>(action:string,data:Record<string,unknown>={}):Promise<T>{
 const response=await fetch('/api/garage/sales',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Garage-Building':'1'},body:JSON.stringify({scope:'referral_accounts',action,...data})});
 const result=await response.json().catch(()=>null);
 if(!response.ok)throw Object.assign(new Error(result?.error?.message||'Could not connect. Please try again.'),{code:result?.error?.code});
 return result;
}
