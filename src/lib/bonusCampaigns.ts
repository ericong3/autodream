export type BonusParticipant={id:string;name:string};
export type BonusCampaign={id:string;title:string;startMonth:string;endMonth:string;minimumUnits:number;amountPerUnit:number;revision:number;publishedAt:string|null;participants:BonusParticipant[];confirmedMonths:string[]};
export type BonusResult={campaignId:string;month:string;units:number;minimumUnits:number;pool:number;qualified:boolean;previewHash:string;confirmed?:boolean;payrollPosted?:boolean;shares:{id:string;name:string;amount:number}[];issues:{id:string;label:string;reason:string}[];cars:{id:string;label:string;basis?:'early_credit'|'delivery';creditedMonth?:string}[];confirmedAt?:string};
export type BonusCampaignDraft={title:string;startMonth:string;endMonth:string;minimumUnits:number;amountPerUnit:number;participantIds:string[]};
export type CampaignView='active'|'upcoming'|'completed';
export function campaignView(campaign:BonusCampaign,month:string):CampaignView{
 if(!campaign.publishedAt)return 'upcoming';
 return month<campaign.startMonth?'upcoming':month>campaign.endMonth?'completed':'active';
}
export function malaysiaMonth(date=new Date()):string{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit'}).formatToParts(date);return `${parts.find(p=>p.type==='year')!.value}-${parts.find(p=>p.type==='month')!.value}`;}
export function campaignMonths(c:Pick<BonusCampaign,'startMonth'|'endMonth'>):string[]{
 const result:string[]=[];let [year,month]=c.startMonth.split('-').map(Number);
 for(let n=0;n<60;n++){const value=`${year}-${String(month).padStart(2,'0')}`;if(value>c.endMonth)break;result.push(value);if(++month===13){month=1;year++;}}
 return result;
}
export async function bonusCampaignRequest<T>(action:string,data:Record<string,unknown>={}):Promise<T>{
 const response=await fetch('/api/garage/sales',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Garage-Building':'1'},body:JSON.stringify({scope:'bonus_campaigns',action,...data})});
 const result=await response.json().catch(()=>null);
 if(!response.ok)throw Object.assign(new Error(result?.error?.message||'Could not connect. Try again.'),{code:result?.error?.code});
 return result;
}
