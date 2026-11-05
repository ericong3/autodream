import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const cache=new Map();
function load(path){
 const url=new URL(path,import.meta.url);if(cache.has(url.href))return cache.get(url.href);
 const module={exports:{}};cache.set(url.href,module.exports);
 const code=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:n=>load(new URL(n+'.ts',url).href),Date,Math,crypto:{randomUUID:()=>String(Math.random())}});
 return module.exports;
}

const {companyReceiptParts}=load('../src/utils/companyReceiptParts.ts');const {buildCarSaleEntry}=load('../src/utils/generateJournalEntries.ts');const {generateDeliveryPayments}=load('../src/utils/generatePayments.ts');
const car={id:'car',make:'Toyota',model:'Vios',year:2022,status:'delivered',sellingPrice:70000,purchasePrice:50000,dateAdded:'2026-11-05'};
const customer={id:'buyer',name:'Buyer',interestedCarId:'car',cashWorkOrder:{sellingPrice:70000,bookingFee:10000,downpayment:5000}};
test('bank receipt mode keeps booking and downpayment in the receivable until actual proof',async()=>{
 const rows=[];const opts={car,payments:[],users:[],externalSalesmen:[],dealers:[],customers:[customer],repairs:[],addPayment:async p=>rows.push(p)};
 await generateDeliveryPayments({...opts,bankReceiptMode:true});const target=rows.find(p=>p.type==='customer_collection');assert.equal(target.amount,70000);assert.equal(target.status,'pending');
 const retry=[];await generateDeliveryPayments({...opts,bankReceiptMode:true,payments:[target],addPayment:async p=>retry.push(p)});assert.equal(retry.filter(p=>p.type==='customer_collection').length,0);
 const old=[];await generateDeliveryPayments({...opts,addPayment:async p=>old.push(p)});assert.equal(old.find(p=>p.type==='customer_collection').amount,55000);
});
test('loan, booking and trade-in contract amounts balance including the customer refund',()=>{
 const parts=companyReceiptParts({dealPrice:70000,isLoan:true,loanAmount:60000,bookingFee:5000,tradeInValue:20000});assert.equal(parts.customerAmount,5000);assert.equal(parts.refundAmount,15000);
 const entry=buildCarSaleEntry({car,dealPrice:70000,cost:50000,isLoan:true,loanAmount:60000,bookingFee:5000,tradeInValue:20000,createdBy:'director',bankReceiptMode:true});
 const dr=entry.lines.reduce((s,l)=>s+l.debit,0),cr=entry.lines.reduce((s,l)=>s+l.credit,0);assert.equal(dr,cr);assert.ok(!entry.lines.some(l=>l.accountId.startsWith('acct-bank-')));assert.equal(entry.lines.find(l=>l.accountId==='acct-customer-refunds').credit,15000);
});
test('new cash sale books a receivable while legacy sale behaviour remains available',()=>{
 const input={car,dealPrice:70000,cost:50000,isLoan:false,createdBy:'director'};
 assert.equal(buildCarSaleEntry({...input,bankReceiptMode:true}).lines[0].accountId,'acct-ar');assert.equal(buildCarSaleEntry(input).lines[0].accountId,'acct-bank-operating');
});
test('new loan customer receivable includes its booking portion and is stable across retries',async()=>{
 const buyer={...customer,cashWorkOrder:undefined,loanWorkOrder:{sellingPrice:70000,loanAmount:60000,bookingFee:5000,hasTradeIn:true,tradeInPrice:20000,settlementFigure:0}};
 const rows=[];await generateDeliveryPayments({bankReceiptMode:true,car,payments:[],users:[],externalSalesmen:[],dealers:[],customers:[buyer],repairs:[],addPayment:async p=>rows.push(p)});assert.equal(rows.find(p=>p.type==='customer_collection').amount,5000);
});

test('new receivables retain a saved final price when a legacy work order contains zero',async()=>{
 const rows=[];await generateDeliveryPayments({bankReceiptMode:true,car:{...car,sellingPrice:0,finalDeal:{dealPrice:114000}},payments:[],users:[],externalSalesmen:[],dealers:[],customers:[{...customer,cashWorkOrder:{sellingPrice:0}}],repairs:[],addPayment:async p=>rows.push(p)});assert.equal(rows.find(p=>p.type==='customer_collection').amount,114000);
});
