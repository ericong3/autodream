import type {ReferralSettlement} from '../../src/lib/garageReferralSettlement';
export type {ReferralSettlement} from '../../src/lib/garageReferralSettlement';
const order={invoiceId:'sample-order',invoiceNumber:'INV-SAMPLE',createdAt:new Date().toISOString(),referrerKind:'used_car',recipient:{name:'Sample Salesman'},total:100,verified:40,balance:60,commission:30,payable:false,paid:0,remainingCommission:0,releaseAuthorised:true,linkedDeal:{}};
let transfer={id:'sample-transfer',amount:60,reference:'SAMPLE-TRANSFER',state:'reported',reported_at:new Date().toISOString(),reported_by:'sample-sales'};
const payouts:any[]=[],seen=new Set();
export async function referralSettlement(action:string,data:Record<string,unknown>={}):Promise<ReferralSettlement>{
 if(action==='month')return {enabled:true,canPay:true,canReport:true,orders:[{...order}],paidThisMonth:order.paid};
 if(action==='partner_month')return {enabled:true,orders:[{...order}],paidThisMonth:order.paid};
 if(action==='snapshot')return {enabled:true,canPay:true,canReport:true,canRelease:true,order:{...order},transfers:[{...transfer}],payouts:[...payouts],release:{reason:'Sample Used Car request; transfer follows',authorised_by:'sample-sales',authorised_at:new Date().toISOString()}};
 if(!seen.has(data.requestId)){
  if(action==='accept_transfer'){order.verified=100;order.balance=0;order.payable=true;order.remainingCommission=30;transfer.state='accepted';}
  if(action==='payout'){const amount=Number(data.amount);if(amount>order.remainingCommission)throw Object.assign(new Error('Amount exceeds available commission.'),{status:409});order.paid+=amount;order.remainingCommission-=amount;payouts.push({id:crypto.randomUUID(),amount,paid_on:String(data.paidOn),reference:String(data.reference),recorded_by:'sample-director'});}
  seen.add(data.requestId);
 }
 return {enabled:true,order:{...order}};
}
