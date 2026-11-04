// Transaction plans only. Callers must load balances, approvals and documents
// from trusted server records and commit the plan under account/car locks.
import {money} from './investorFinanceRules.mjs';
const fail=code=>{throw new Error(code);};
const sum=(...values)=>{const n=values.reduce((a,v)=>a+BigInt(money(v,{signed:true})),0n);return money(Number(n),{signed:true});};
const id=v=>typeof v==='string'&&v.length>0&&v.length<=180;
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

export function planSaleReceipt({carId,potId,remainingSaleCents,bankReceivedCents,withheldBills=[],customerExcessCents=0,refundRecipient}){
 if(!id(carId)||!id(potId))fail('CAR_AND_POT_REQUIRED');
 money(remainingSaleCents);money(bankReceivedCents);money(customerExcessCents);
 const ids=new Set();
 for(const bill of withheldBills){
  if(!id(bill.id)||ids.has(bill.id))fail('DUPLICATE_WITHHELD_BILL');ids.add(bill.id);
  if(bill.carId!==carId||bill.potId!==potId)fail('WRONG_CAR_OR_POT_EXPENSE');
  money(bill.amountCents);money(bill.unpaidCents);
  if(!bill.amountCents||bill.amountCents>bill.unpaidCents||bill.approved!==true||bill.invoiceConfirmed!==true||bill.directCarCost!==true)fail('APPROVED_INVOICED_CAR_BILL_REQUIRED');
 }
 const withheldCents=sum(...withheldBills.map(b=>b.amountCents));
 const saleRecoveryCents=sum(bankReceivedCents,withheldCents,-customerExcessCents);
 if(saleRecoveryCents<=0||saleRecoveryCents>remainingSaleCents)fail('SALE_RECOVERY_EXCEEDS_BALANCE');
 if(customerExcessCents>0&&(!refundRecipient||!id(refundRecipient.id)||!id(refundRecipient.name)))fail('REFUND_RECIPIENT_REQUIRED');
 return freeze({bankDeltaCents:bankReceivedCents,saleRecoveryCents,withheldCents,refundReservedCents:customerExcessCents,
  availableCashDeltaCents:sum(bankReceivedCents,-customerExcessCents),
  billClearances:withheldBills.map(b=>({billId:b.id,amountCents:b.amountCents,bankDeltaCents:0})),
  refund:customerExcessCents?{recipientId:refundRecipient.id,recipientName:refundRecipient.name,amountCents:customerExcessCents}:null});
}

export function planTradeIn({outgoingCarId,outgoingPotId,incomingCarId,grossValueCents,lenderSettlementCents,saleRemainingCents,funding}){
 if(!id(outgoingCarId)||!id(outgoingPotId)||!id(incomingCarId)||incomingCarId===outgoingCarId)fail('INVALID_TRADE_IN_CARS');
 for(const value of [grossValueCents,lenderSettlementCents,saleRemainingCents])money(value);
 if(grossValueCents<=0)fail('TRADE_IN_VALUE_REQUIRED');
 if(lenderSettlementCents>grossValueCents)fail('NEGATIVE_EQUITY_REVIEW_REQUIRED');
 if(!funding||!['company','investor'].includes(funding.kind)||funding.directorApproved!==true)fail('DIRECTOR_FUNDING_CHOICE_REQUIRED');
 if(funding.kind==='investor'&&(!id(funding.potId)||funding.potId==='company')||funding.kind==='company'&&funding.potId!==undefined)fail('INVALID_FUNDING_POT');
 const targetPotId=funding.kind==='company'?'company':funding.potId;
 const netCreditCents=sum(grossValueCents,-lenderSettlementCents);
 if(netCreditCents>saleRemainingCents)fail('TRADE_IN_CREDIT_EXCEEDS_SALE');
 const requiredAvailableCents=targetPotId===outgoingPotId?lenderSettlementCents:grossValueCents;
 money(funding.availableCents,{signed:true});
 if(funding.availableCents<requiredAvailableCents)fail('INSUFFICIENT_FUNDING_POT');
 return freeze({outgoingCarId,incomingCarId,incomingPotId:targetPotId,purchaseCents:grossValueCents,saleRecoveryCents:netCreditCents,
  lenderPayableCents:lenderSettlementCents,requiredAvailableCents,bankDeltaCents:0,
  ownershipMovements:targetPotId===outgoingPotId?[]:[{potId:outgoingPotId,amountCents:netCreditCents},{potId:targetPotId,amountCents:-netCreditCents}],
  incomingPurchase:{noncashPaidCents:netCreditCents,cashStillToPayCents:lenderSettlementCents}});
}

export function planCustomerRefund({outstandingCents,amountCents,approved,receiptConfirmed,recipientConfirmed}){
 money(outstandingCents);money(amountCents);
 if(!approved||!receiptConfirmed||!recipientConfirmed)fail('APPROVED_REFUND_WITH_RECEIPT_REQUIRED');
 if(!amountCents||amountCents>outstandingCents)fail('REFUND_EXCEEDS_BALANCE');
 return freeze({bankDeltaCents:-amountCents,liabilityDeltaCents:-amountCents,remainingCents:sum(outstandingCents,-amountCents),profitDeltaCents:0});
}
