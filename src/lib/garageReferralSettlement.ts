export type ReferralIncomeOrder={invoiceId:string;invoiceNumber:string;createdAt:string;referrerKind:string;recipient:{name?:string};total:number;verified:number;balance:number;commission:number|null;payable:boolean;paid:number;remainingCommission:number;releaseAuthorised:boolean;linkedDeal?:unknown;deliveredAt?:string};
export type ReferralSettlement={enabled:boolean;orders?:ReferralIncomeOrder[];outstandingOrders?:ReferralIncomeOrder[];order?:ReferralIncomeOrder;canPay?:boolean;canReport?:boolean;canRelease?:boolean;paidThisMonth?:number;transfers?:{id:string;amount:number;reference:string;state:string;reported_at:string;reported_by:string;reviewed_by?:string;reviewed_at?:string;review_note?:string}[];payouts?:{id:string;amount:number;paid_on:string;reference:string;recorded_by:string}[];release?:{reason:string;authorised_by:string;authorised_at:string}};
export async function referralSettlement(action:string,data:Record<string,unknown>={}):Promise<ReferralSettlement>{
 const response=await fetch('/api/garage/sales',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Garage-Building':'1'},body:JSON.stringify({scope:'referral_settlement',action,...data})});
 const result=await response.json().catch(()=>null);
 if(!response.ok)throw Object.assign(new Error(result?.error?.message||'Could not load referral settlement. Try again.'),{status:response.status,code:result?.error?.code});
 return result;
}
