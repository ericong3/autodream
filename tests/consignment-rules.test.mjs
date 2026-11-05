import test from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../shared/consignmentRules.mjs';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import * as pdfLib from 'pdf-lib';
const {settleIncomingConsignment:settle,consignmentBasisPoints:bp}=rules;
const base={terms:'profit_split',capitalCents:5000000,netProfitCents:1000000,lenderCents:1000000,dealerBasisPoints:3000};

test('profit-sharing uses the Director percentage on positive net profit only',()=>{
 const r=settle(base);assert.equal(r.dealerProfitCents,300000);assert.equal(r.dealerPayableCents,4300000);assert.equal(r.companyResultCents,700000);
 assert.equal(settle({...base,dealerBasisPoints:bp(72.5)}).dealerProfitCents,725000);
 assert.equal(settle({...base,dealerBasisPoints:0}).companyResultCents,1000000);
 assert.equal(settle({...base,dealerBasisPoints:10000}).companyResultCents,0);
});
test('a profit-sharing loss reduces dealer capital, with zero company loss',()=>{
 const r=settle({...base,netProfitCents:-500000});assert.equal(r.dealerProfitCents,0);assert.equal(r.dealerLossCents,500000);assert.equal(r.dealerPayableCents,3500000);assert.equal(r.companyResultCents,0);
 const debt=settle({...base,netProfitCents:-6000000});assert.equal(debt.dealerPayableCents,0);assert.equal(debt.dealerOwesCompanyCents,2000000);assert.equal(debt.companyResultCents,0);
});
test('fixed amount stays fixed through profit or loss and does not use a sharing percentage',()=>{
 for(const netProfitCents of [-1000000,0,1000000]){
  const r=settle({...base,terms:'fixed_amount',netProfitCents,dealerBasisPoints:undefined});assert.equal(r.dealerPayableCents,4000000);assert.equal(r.dealerLossCents,0);assert.equal(r.companyResultCents,netProfitCents);
 }
 const distinct=settle({...base,terms:'fixed_amount',fixedAmountCents:5500000});assert.equal(distinct.dealerPayableCents,4500000);assert.equal(distinct.companyResultCents,500000);
});
test('an old pending payout is flagged for review and never rewritten to a recalculated zero',()=>{
 const saved={recordedCents:5000000,calculatedCents:2750000,paidCents:0};const before={...saved};
 const review=rules.reviewConsignmentPayout(saved);assert.equal(review.requiresReview,true);assert.equal(review.remainingRecordedCents,5000000);assert.deepEqual(saved,before);
 assert.equal(rules.reviewConsignmentPayout({...saved,calculatedCents:0}).remainingRecordedCents,5000000);
 assert.equal(rules.reviewConsignmentPayout({...saved,calculatedCents:null}).requiresReview,true);
 assert.equal(rules.reviewConsignmentPayout({...saved,calculatedCents:5000000,paidCents:2000000}).requiresReview,false);
 assert.equal(rules.reviewConsignmentPayout({...saved,paidCents:3000000}).overpaidCents,250000);
});
test('cent rounding conserves all money for variable rates, zero profit and losses',()=>{
 for(const percent of [0,0.01,12.34,33.33,50,72.5,99.99,100])for(const profit of [-6000001,-1,0,1,3,101,1000001]){
  const r=settle({...base,dealerBasisPoints:bp(percent),netProfitCents:profit});
  assert.equal(r.dealerBalanceCents+r.lenderCents+r.companyResultCents,r.capitalCents+profit);
  assert.equal(r.dealerPayableCents-r.dealerOwesCompanyCents,r.dealerBalanceCents);assert.ok(Number.isSafeInteger(r.companyResultCents));
 }
 for(const percent of [-1,100.01,NaN,Infinity,1.001,'30'])assert.throws(()=>bp(percent),/PERCENT/);
 for(const change of [{capitalCents:1.5},{netProfitCents:NaN},{lenderCents:-1},{dealerBasisPoints:10001},{dealerBasisPoints:30.5}])assert.throws(()=>settle({...base,...change}),/INVALID|PERCENT/);
});

const cache=new Map();
function load(path){
 const url=new URL(path,import.meta.url);if(cache.has(url.href))return cache.get(url.href);
 const module={exports:{}};cache.set(url.href,module.exports);
 const code=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const requireMock=n=>n.endsWith('consignmentRules.mjs')?rules:n==='pdf-lib'?pdfLib:n==='./payslip'?{COMPANY_INFO:{name:'AutoDream',tagline:'Cars',address:'Kuching',phone:'123',website:'autodream.test'}}:load(new URL(n+'.ts',url).href);
 const noLogo=async()=>{throw Error('no logo in rehearsal');};
 // pdf-lib validates native Array/Object prototypes. Run this trusted module
 // in the host realm so its page geometry has the same prototypes as pdf-lib.
 if(url.pathname.endsWith('generateConsignmentSettlement.ts'))new Function('module','exports','require','fetch',code)(module,module.exports,requireMock,noLogo);
 else vm.runInNewContext(code,{module,exports:module.exports,require:requireMock,Date,Math,fetch:noLogo,crypto:{randomUUID:()=>String(Math.random())}});
 return module.exports;
}
const payments=load('../src/utils/generatePayments.ts');
const car={id:'consign',make:'Toyota',model:'Vios',year:2022,status:'delivered',sellingPrice:70000,purchasePrice:50000,dateAdded:'2026-11-05',
 consignment:{terms:'profit_split',dealer:'Dealer',splitPercent:30},settlementAmount:10000,miscCosts:[{amount:1500}],disbursementCharges:[{amount:600}],sourceCommission:300,intakeCommission:200,panelChargeAmount:400,salesCommission:1000};
const repairs=[{carId:'consign',status:'done',actualCost:3500,totalCost:3500}];
test('car costs, estimates and payout generation use the same loss rule, without changing existing payments',async()=>{
 const b=payments.calcCarNetProfitBreakdown(car,[],repairs);assert.equal(b.netProfit,12500);assert.equal(b.panelCost,400);
 assert.equal(payments.calcConsignmentPayoutAmount(car,[],repairs),43750);
 const loss={...car,sellingPrice:45000};assert.equal(payments.calcConsignmentPayoutAmount(loss,[],repairs),27500);
 assert.equal(payments.calcConsignmentSettlement(loss,[],repairs).companyResultCents,0);
 const fixed={...loss,consignment:{...loss.consignment,terms:'fixed_amount',fixedAmount:50000}};assert.equal(payments.calcConsignmentPayoutAmount(fixed,[],repairs),40000);
 assert.equal(payments.calcConsignmentPayoutAmount({...fixed,consignment:{...fixed.consignment,splitPercent:33.333}},[],repairs),40000);
 const old={id:'saved',type:'consignment_payout',carId:car.id,status:'transferred',amount:50000},created=[];
 await payments.generateDeliveryPayments({car:loss,customers:[],repairs,payments:[old],users:[],externalSalesmen:[],dealers:[],addPayment:async p=>created.push(p)});
 assert.equal(old.amount,50000);assert.equal(created.filter(p=>p.type==='consignment_payout').length,0);
});
test('staff commission waiver does not erase an actual consignment loss, and saved prices beat zero placeholders',()=>{
 const loss={...car,sellingPrice:45000,isStaffSale:true};assert.ok(payments.calcCarNetProfitBreakdown(loss,[],repairs).netProfit<0);assert.equal(payments.calcConsignmentSettlement(loss,[],repairs).companyResultCents,0);
 const saved={...car,finalDeal:{dealPrice:65000}};const customer={interestedCarId:car.id,cashWorkOrder:{sellingPrice:0,discount:1000}};
 assert.equal(payments.calcCarNetProfitBreakdown(saved,[customer],repairs).dealPrice,65000);
 assert.equal(payments.calcConsignmentSettlement({...car,consignment:{...car.consignment,splitPercent:101}},[],repairs),null);
});
test('legacy disbursement is blocked before any car, payment or journal write in bank mode',async()=>{
 const {recordDisbursement}=load('../src/utils/recordDisbursement.ts');const writes=[];
 const deps=Object.fromEntries(['updateCar','addPayment','updatePayment','addLedgerAccount','addJournalEntry','voidJournalEntry'].map(k=>[k,async()=>writes.push(k)]));
 await assert.rejects(()=>recordDisbursement({car,bankReceiptMode:true},deps),/No collection was recorded/);assert.equal(writes.length,0);
});
test('settlement PDFs match profit-sharing loss and fixed-amount results, with no false payment claim',async()=>{
 const docs=load('../src/utils/generateConsignmentSettlement.ts');
 const input={dealerName:'Dealer',carLabel:'Toyota Vios',carPlate:'ABC123',sellingPrice:45000,discount:0,addOnTotal:0,purchasePrice:50000,repairCost:3500,miscCost:1500,disbursementCharges:600,commission:1000,intakeBonus:200,sourceCommission:300,panelCharge:400,netProfit:-12500,terms:'profit_split',splitPercent:30,settlementAmount:10000,generatedAt:new Date('2026-11-05T04:00:00Z')};
 assert.equal(docs.consignmentDocumentResult(input).dealerPayableCents,2750000);assert.equal(docs.consignmentDocumentResult({...input,terms:'fixed_amount'}).dealerPayableCents,4000000);
 assert.equal(docs.consignmentDocumentResult({...input,terms:'fixed_amount',splitPercent:NaN}).dealerPayableCents,4000000);
 const original=pdfLib.PDFPage.prototype.drawText;let text=[];
 pdfLib.PDFPage.prototype.drawText=function(value,options){text.push({value,...options});return original.call(this,value,options);};
 try{
  for(const terms of ['profit_split','fixed_amount']){
   text=[];const bytes=await docs.buildConsignmentSettlementPdf({...input,terms});assert.equal((await pdfLib.PDFDocument.load(bytes)).getPageCount(),1);
   assert.ok(text.some(t=>t.value===(terms==='profit_split'?'RM 27,500.00':'RM 40,000.00')));assert.ok(!text.some(t=>/Already Settled|Purchase Price \(returned\)/.test(t.value)));
   const footer=text.find(t=>t.value.startsWith('Generated '));assert.ok(footer);assert.ok(text.filter(t=>!t.value.startsWith('Generated ')).every(t=>t.y>=94));
  }
  text=[];await docs.buildConsignmentSummaryPdf({...input,netProfit:-60000});assert.ok(text.some(t=>t.value==='DEALER OWES COMPANY'));assert.ok(text.some(t=>t.value==='RM 20,000.00'));
 }finally{pdfLib.PDFPage.prototype.drawText=original;}
});
