export type SalesAssignment = {
  ownerId: string;
  referrer: { kind: 'none' } | { kind: 'used_car'; staffId: string; deal?: { customerId: string; carId: string; submittedAt: string } } | { kind: 'external'; profileId: string };
};
export type SalesOptions = { enabled: boolean; owners: {id:string;name:string}[]; usedCarStaff: {id:string;name:string}[]; external: {id:string;name:string;brand:string;branch:string}[] };
export type UsedCarReferralDeal = {customerId:string;carId:string;submittedAt:string;vehicle:string;customer:string};
export async function salesReferralRequest<T>(action:string, data:Record<string,unknown>={}):Promise<T> {
  const response=await fetch('/api/garage/sales',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Garage-Building':'1'},body:JSON.stringify({scope:'sales_referrals',action,...data})});
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(result?.error?.message||'Could not load the sales details. Try again.');
  return result;
}
