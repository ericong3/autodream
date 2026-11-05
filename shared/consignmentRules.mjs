// Shared browser/server domain rules. Integer cents; no database or bank writes.
const cents=(n,signed=false)=>Number.isSafeInteger(n)&&Math.abs(n)<=1e12&&(signed||n>=0);
export function consignmentBasisPoints(percent){
 if(typeof percent!=='number'||!Number.isFinite(percent)||percent<0||percent>100||Math.abs(percent*100-Math.round(percent*100))>1e-7)throw new Error('CONSIGNMENT_PERCENT_REQUIRED');
 return Math.round(percent*100);
}
export function settleIncomingConsignment({terms,capitalCents,netProfitCents,lenderCents=0,dealerBasisPoints,fixedAmountCents=capitalCents}){
 if(!['fixed_amount','profit_split'].includes(terms)||!cents(capitalCents)||!cents(netProfitCents,true)||!cents(lenderCents)||!cents(fixedAmountCents))throw new Error('CONSIGNMENT_DETAILS_INVALID');
 if(terms==='profit_split'&&(!Number.isInteger(dealerBasisPoints)||dealerBasisPoints<0||dealerBasisPoints>10000))throw new Error('CONSIGNMENT_PERCENT_REQUIRED');
 const dealerProfitCents=terms==='profit_split'&&netProfitCents>0?Number((BigInt(netProfitCents)*BigInt(dealerBasisPoints)+5000n)/10000n):0;
 const dealerLossCents=terms==='profit_split'?Math.max(0,-netProfitCents):0;
 const dealerGrossCents=terms==='fixed_amount'?fixedAmountCents:capitalCents+dealerProfitCents-dealerLossCents;
 const dealerBalanceCents=dealerGrossCents-lenderCents;
 const companyResultCents=terms==='fixed_amount'?netProfitCents+capitalCents-fixedAmountCents:Math.max(0,netProfitCents)-dealerProfitCents;
 return {terms,dealerBasisPoints:terms==='profit_split'?dealerBasisPoints:null,capitalCents,fixedAmountCents:terms==='fixed_amount'?fixedAmountCents:null,
  netProfitCents,lenderCents,dealerProfitCents,dealerLossCents,dealerGrossCents,dealerBalanceCents,
  dealerPayableCents:Math.max(0,dealerBalanceCents),dealerOwesCompanyCents:Math.max(0,-dealerBalanceCents),companyResultCents};
}
export function reviewConsignmentPayout({recordedCents,calculatedCents,paidCents=0}){
 if(!cents(recordedCents)||!cents(paidCents)||calculatedCents!==null&&!cents(calculatedCents))throw new Error('CONSIGNMENT_DETAILS_INVALID');
 return {requiresReview:calculatedCents===null||recordedCents!==calculatedCents||paidCents>recordedCents,
  recordedCents,calculatedCents,remainingRecordedCents:Math.max(0,recordedCents-paidCents),overpaidCents:calculatedCents===null?null:Math.max(0,paidCents-calculatedCents)};
}
