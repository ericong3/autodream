// Approved settlement changes are noncash cancellations/reissues of obligations.
// Actual bank receipts and payouts always remain unchanged.
import {settleIncomingConsignment} from './consignmentRules.mjs';
const money=n=>{if(!Number.isSafeInteger(n)||n<0||n>1e12)throw Error('INVALID_ADJUSTMENT');return n;};
export function planConsignmentSettlementAdjustment({terms,capitalCents,revenueCents,costCents,lenderCents=0,dealerBasisPoints,fixedAmountCents,previousCompanyResultCents,previousDealerBalanceCents,paidToDealerCents=0,receivedFromDealerCents=0,openDealerPayableCents=0,openDealerReceivableCents=0}){
 for(const n of [capitalCents,revenueCents,costCents,lenderCents,paidToDealerCents,receivedFromDealerCents,openDealerPayableCents,openDealerReceivableCents])money(n);
 if(!Number.isSafeInteger(previousCompanyResultCents)||!Number.isSafeInteger(previousDealerBalanceCents))throw Error('INVALID_ADJUSTMENT');
 const netPaidCents=paidToDealerCents-receivedFromDealerCents;
 if(openDealerPayableCents-openDealerReceivableCents!==previousDealerBalanceCents-netPaidCents)throw Error('DEALER_HISTORY_REVIEW_REQUIRED');
 const next=settleIncomingConsignment({terms,capitalCents,netProfitCents:revenueCents-capitalCents-costCents,lenderCents,dealerBasisPoints,fixedAmountCents});
 const remaining=next.dealerBalanceCents-netPaidCents;
 const payableCents=Math.max(0,remaining),receivableCents=Math.max(0,-remaining);
 const lines=[];const add=(accountId,debitCents,creditCents)=>{if(debitCents)lines.push({accountId,debitCents,creditCents:0});if(creditCents)lines.push({accountId,debitCents:0,creditCents});};
 add('acct-ap',openDealerPayableCents,payableCents);add('acct-consignor-ar',receivableCents,openDealerReceivableCents);
 add('acct-rev-consign',Math.max(0,previousCompanyResultCents),Math.max(0,next.companyResultCents));
 add('acct-exp-consign-loss',Math.max(0,-next.companyResultCents),Math.max(0,-previousCompanyResultCents));
 if(lines.reduce((n,l)=>n+BigInt(l.debitCents)-BigInt(l.creditCents),0n)!==0n)throw Error('UNBALANCED_ADJUSTMENT');
 return {settlement:next,netPaidCents,payableCents,receivableCents,companyChangeCents:next.companyResultCents-previousCompanyResultCents,bankMovementCents:0,lines};
}
