import test from 'node:test';import assert from 'node:assert/strict';
import {planSaleReceipt,planTradeIn,planCustomerRefund} from '../server/usedCar/investorSettlementRules.mjs';
const bill={carId:'car',potId:'pot',id:'bank-fee',amountCents:100000,unpaidCents:100000,approved:true,invoiceConfirmed:true,directCarCost:true};
test('bank deductions and overloan recover the sale without inventing bank receipts',()=>{
 const p=planSaleReceipt({carId:'car',potId:'pot',remainingSaleCents:6500000,bankReceivedCents:7400000,withheldBills:[bill],customerExcessCents:1000000,refundRecipient:{id:'customer',name:'Customer'}});
 assert.equal(p.saleRecoveryCents,6500000);assert.equal(p.bankDeltaCents,7400000);assert.equal(p.availableCashDeltaCents,6400000);assert.equal(p.refundReservedCents,1000000);assert.equal(p.billClearances[0].bankDeltaCents,0);assert.ok(Object.isFrozen(p.billClearances[0]));
});
test('missing invoice, duplicate deductions and unassigned excess money are refused',()=>{
 const base={carId:'car',potId:'pot',remainingSaleCents:500000,bankReceivedCents:400000,withheldBills:[bill]};
 assert.throws(()=>planSaleReceipt({...base,withheldBills:[{...bill,invoiceConfirmed:false}]}),/INVOICED/);
 assert.throws(()=>planSaleReceipt({...base,withheldBills:[bill,bill]}),/DUPLICATE/);
 assert.throws(()=>planSaleReceipt({...base,withheldBills:[{...bill,potId:'other'}]}),/WRONG_CAR_OR_POT/);
 assert.throws(()=>planSaleReceipt({...base,customerExcessCents:1000}),/RECIPIENT/);
 assert.throws(()=>planSaleReceipt({...base,bankReceivedCents:500001}),/EXCEEDS/);
});
const trade={outgoingCarId:'old',outgoingPotId:'investor-a',incomingCarId:'new',grossValueCents:4000000,lenderSettlementCents:1000000,saleRemainingCents:7000000};
test('the Director must explicitly choose one incoming funding pot',()=>{
 assert.throws(()=>planTradeIn(trade),/CHOICE_REQUIRED/);
 assert.throws(()=>planTradeIn({...trade,funding:{kind:'investor',directorApproved:true,availableCents:4000000}}),/INVALID_FUNDING/);
 assert.throws(()=>planTradeIn({...trade,funding:{kind:'company',potId:'investor-a',directorApproved:true,availableCents:4000000}}),/INVALID_FUNDING/);
});
test('company or another investor funds the full incoming value, with no fake bank transfer',()=>{
 for(const funding of [{kind:'company'},{kind:'investor',potId:'investor-b'}]){
  const p=planTradeIn({...trade,funding:{...funding,directorApproved:true,availableCents:4000000}});
  assert.equal(p.saleRecoveryCents,3000000);assert.equal(p.bankDeltaCents,0);assert.equal(p.ownershipMovements.reduce((s,x)=>s+x.amountCents,0),0);assert.equal(p.incomingPurchase.cashStillToPayCents,1000000);
 }
 assert.throws(()=>planTradeIn({...trade,funding:{kind:'company',directorApproved:true,availableCents:3999999}}),/INSUFFICIENT/);
});
test('same-pot trade-in reinvests the asset and reserves only the lender cash needed',()=>{
 const p=planTradeIn({...trade,funding:{kind:'investor',potId:'investor-a',directorApproved:true,availableCents:1000000}});
 assert.deepEqual(p.ownershipMovements,[]);assert.equal(p.requiredAvailableCents,1000000);assert.equal(p.incomingPurchase.noncashPaidCents,3000000);
 assert.throws(()=>planTradeIn({...trade,lenderSettlementCents:4000001,funding:{kind:'company',directorApproved:true,availableCents:5000000}}),/NEGATIVE_EQUITY/);
});
test('customer refunds clear the reserved liability, not car profit',()=>{
 const p=planCustomerRefund({outstandingCents:1000000,amountCents:600000,approved:true,receiptConfirmed:true,recipientConfirmed:true});
 assert.equal(p.bankDeltaCents,-600000);assert.equal(p.remainingCents,400000);assert.equal(p.profitDeltaCents,0);
 assert.throws(()=>planCustomerRefund({outstandingCents:1,amountCents:2,approved:true,receiptConfirmed:true,recipientConfirmed:true}),/EXCEEDS/);
 assert.throws(()=>planCustomerRefund({outstandingCents:1,amountCents:1,approved:true,receiptConfirmed:false,recipientConfirmed:true}),/RECEIPT/);
});
