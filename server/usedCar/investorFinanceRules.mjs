// Pure accounting rules. No database writes or session authentication happen here.
// API callers must authenticate the actor and perform writes under database locks.
const MAX_CENTS = 1_000_000_000_000;
const fail = code => { throw new Error(code); };
export function money(value, {signed=false}={}) {
  if (!Number.isSafeInteger(value) || Math.abs(value)>MAX_CENTS || (!signed&&value<0)) fail('INVALID_MONEY');
  return value;
}
const sum = values => money(Number(values.reduce((n,value)=>n+BigInt(money(value,{signed:true})),0n)),{signed:true});
const uniqueIds = rows => {const seen=new Set();for(const row of rows){if(typeof row.id!=='string'||!row.id||seen.has(row.id))fail('DUPLICATE_OR_MISSING_ID');seen.add(row.id);}};
const positions=new WeakSet(),previews=new WeakSet();
const scopedExpense=(b,potId,carId)=>{if(b.potId!==potId||(carId&&b.carId!==carId)||!b.carId||b.directCarCost!==true||b.kind!=='expense')fail('WRONG_CAR_OR_POT_EXPENSE');};

// A negative balance is visible as a deficit; it must never be silently clamped.
export function potPosition({potId,cashCents,billCommitments=[],withdrawalCommitments=[],profitHolds=[]}) {
  if(typeof potId!=='string'||!potId)fail('POT_REQUIRED');
  money(cashCents,{signed:true});
  uniqueIds(billCommitments);uniqueIds(withdrawalCommitments);uniqueIds(profitHolds.map(h=>({id:h.carId})));
  const bills=sum(billCommitments.map(b=>{scopedExpense(b,potId);if(b.status!=='approved')fail('APPROVED_BILL_REQUIRED');money(b.amountCents);money(b.paidCents);if(b.paidCents>b.amountCents)fail('BILL_OVERPAID');return b.amountCents-b.paidCents;}));
  const withdrawals=sum(withdrawalCommitments.map(w=>{if(w.potId!==potId||w.status!=='approved')fail('APPROVED_WITHDRAWAL_REQUIRED');return money(w.amountCents);}));
  const companyProfitHeldCents=sum(profitHolds.map(h=>{if(h.potId!==potId)fail('WRONG_POT');return money(h.amountCents);}));
  const reservedCents=sum([bills,withdrawals,companyProfitHeldCents]);
  const availableCents=sum([cashCents,-reservedCents]);
  const result=Object.freeze({potId,cashCents,billReservedCents:bills,withdrawalReservedCents:withdrawals,companyProfitHeldCents,profitHolds:Object.freeze(profitHolds.map(h=>Object.freeze({...h}))),reservedCents,availableCents,deficitCents:Math.max(0,-availableCents)});
  positions.add(result);return result;
}

export function requireAvailable(position,amountCents) {
  if(!positions.has(position))fail('CALCULATED_POSITION_REQUIRED');
  money(amountCents);if(amountCents<=0)fail('POSITIVE_AMOUNT_REQUIRED');
  if(position.availableCents<amountCents)fail('INSUFFICIENT_AVAILABLE_FUNDS');
}

// Revenue is the agreed cash-sale amount after discounts, excluding a separate
// noncash trade-in. Receipts must already be verified, net of verified refunds.
// Trade-ins require a separately approved treatment before final settlement.
export function settlementPreview({carId,potId,purchaseCents,saleCents,verifiedNetReceiptsCents,agreement,bills=[],costReviewComplete=false,noncashProceedsCents=0}) {
  if(typeof carId!=='string'||!carId||typeof potId!=='string'||!potId)fail('CAR_AND_POT_REQUIRED');
  for(const v of [purchaseCents,saleCents,verifiedNetReceiptsCents,noncashProceedsCents])money(v);
  // Must come from the server-loaded, approved agreement, not browser input.
  if(!agreement||agreement.carId!==carId||agreement.potId!==potId||agreement.approved!==true||agreement.locked!==true)fail('LOCKED_APPROVED_AGREEMENT_REQUIRED');
  const investorBasisPoints=agreement.investorBasisPoints;
  if(!Number.isInteger(investorBasisPoints)||investorBasisPoints<0||investorBasisPoints>10000)fail('INVALID_PROFIT_SPLIT');
  uniqueIds(bills);
  for(const b of bills){money(b.amountCents);money(b.paidCents);if(b.paidCents>b.amountCents)fail('BILL_OVERPAID');if(!['pending','approved','voided'].includes(b.status)||typeof b.directCarCost!=='boolean')fail('INVALID_BILL');}
  const direct=bills.filter(b=>b.directCarCost&&b.status!=='voided');
  direct.forEach(b=>scopedExpense(b,potId,carId));
  const unreviewed=direct.filter(b=>b.status!=='approved');
  const directCostCents=sum(direct.filter(b=>b.status==='approved').map(b=>b.amountCents));
  const unpaidDirectCostCents=sum(direct.filter(b=>b.status==='approved').map(b=>b.amountCents-b.paidCents));
  const profitCents=sum([saleCents,noncashProceedsCents,-purchaseCents,-directCostCents]);
  // BigInt multiplication prevents binary-float rounding and unsafe intermediates.
  const investorResultCents=profitCents>0?Number((BigInt(profitCents)*BigInt(investorBasisPoints)+5000n)/10000n):profitCents;
  const companyProfitCents=profitCents>0?profitCents-investorResultCents:0;
  const blockers=[];
  if(verifiedNetReceiptsCents!==saleCents)blockers.push('SALE_RECEIPTS_NOT_BALANCED');
  if(costReviewComplete!==true)blockers.push('COST_REVIEW_REQUIRED');
  if(unreviewed.length)blockers.push('CAR_BILLS_NOT_APPROVED');
  if(noncashProceedsCents)blockers.push('NONCASH_PROCEEDS_REVIEW_REQUIRED');
  if(!purchaseCents||!saleCents)blockers.push('ZERO_PRICE_REVIEW_REQUIRED');
  const result=Object.freeze({carId,potId,purchaseCents,saleCents,investorBasisPoints,directCostCents,unpaidDirectCostCents,profitCents,investorResultCents,companyProfitCents,ready:blockers.length===0,blockers:Object.freeze(blockers)});
  previews.add(result);return result;
}

// This allocates money already received. It must not create another bank receipt
// or return purchase/repair capital a second time.
export function profitAllocation(preview,position) {
  if(!previews.has(preview)||!preview.ready)fail('SETTLEMENT_NOT_READY');
  if(!positions.has(position)||position.potId!==preview.potId)fail('WRONG_POT_POSITION');
  const share=money(preview.companyProfitCents);
  const held=position.profitHolds.find(h=>h.carId===preview.carId)?.amountCents??0;
  if(held!==share)fail('CAR_PROFIT_HOLD_MISMATCH');
  if(position.availableCents<0)fail('INSUFFICIENT_UNRESERVED_CASH');
  return {investorPotDeltaCents:-share,companyPotDeltaCents:share,releaseHoldCents:share,bankDeltaCents:0};
}

// One actual transfer can cover several bills; one bill can have many transfers.
// Purchase, withdrawals and payroll use separate authorised allocation targets.
export function billPaymentPlan({potId,amountCents,bills,allocations}) {
  if(typeof potId!=='string'||!potId)fail('POT_REQUIRED');
  money(amountCents);if(!amountCents||!allocations.length)fail('POSITIVE_AMOUNT_REQUIRED');
  uniqueIds(bills);uniqueIds(allocations.map(a=>({id:a.billId})));
  const byId=new Map(bills.map(b=>[b.id,b]));
  const updates=allocations.map(a=>{const b=byId.get(a.billId);if(!b||b.status!=='approved')fail('APPROVED_BILL_REQUIRED');scopedExpense(b,potId);money(b.amountCents);money(b.paidCents);money(a.amountCents);if(!a.amountCents||b.paidCents>b.amountCents||a.amountCents>b.amountCents-b.paidCents)fail('PAYMENT_EXCEEDS_BILL_BALANCE');return {billId:b.id,paidCents:sum([b.paidCents,a.amountCents]),remainingCents:b.amountCents-b.paidCents-a.amountCents};});
  if(sum(allocations.map(a=>a.amountCents))!==amountCents)fail('PAYMENT_ALLOCATION_MISMATCH');
  return {bankDeltaCents:-amountCents,updates};
}

// Director approval is required by the future command handler. This is a delta
// preview only: no rewrite of an approved historical settlement.
export function settlementAdjustment(previous,next,{investorPosition,companyPosition}) {
  if(!previews.has(previous)||!previews.has(next)||!previous.ready||!next.ready)fail('SETTLEMENT_NOT_READY');
  if(previous.carId!==next.carId||previous.potId!==next.potId||previous.investorBasisPoints!==next.investorBasisPoints)fail('SETTLEMENT_IDENTITY_CHANGED');
  const companyDeltaCents=sum([next.companyProfitCents,-previous.companyProfitCents]);
  if(!positions.has(investorPosition)||investorPosition.potId!==next.potId||!positions.has(companyPosition)||companyPosition.potId!=='company-main')fail('WRONG_POT_POSITION');
  if(companyDeltaCents>0)requireAvailable(investorPosition,companyDeltaCents);
  if(companyDeltaCents<0)requireAvailable(companyPosition,-companyDeltaCents);
  return {companyPotDeltaCents:companyDeltaCents,investorPotDeltaCents:-companyDeltaCents,bankDeltaCents:0,investorResultChangeCents:sum([next.investorResultCents,-previous.investorResultCents])};
}
