// Real React panel + browser interactions; all API calls intercepted, no production writes.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser;
const review=(revision='a')=>({sourceRevision:revision.repeat(32),costCents:350000,companyResultCents:1155000,dealerPayableCents:5495000,dealerOwesCompanyCents:0});
const isolate=page=>page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
const snapshot=(approved=false)=>({carId:'test-car',termsRevision:'d'.repeat(32),case:{car_id:'test-car',dealer:{name:'Dealer',bankName:'Bank',accountNumber:'123456',accountHolder:'Dealer'},terms:'profit_split',dealer_basis_points:3000,opened_at:'2026-11-05T00:00:00Z',approved_at:approved?'2026-11-05T01:00:00Z':null,settlement:approved?review():null},review:approved?null:review(),documents:[{id:'proof',name:'Agreement.pdf'}],payments:[]});
try{
 await server.listen();const base=server.resolvedUrls.local[0];browser=await chromium.launch({headless:true,...(process.env.CONSIGNMENT_BROWSER_PATH?{executablePath:process.env.CONSIGNMENT_BROWSER_PATH}:existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
 for(const role of ['director','admin','shareholder']){
  const page=await browser.newPage({viewport:{width:390,height:844}});let state=snapshot(),calls=[];
  await isolate(page);
  await page.route('**/api/**',async route=>{const body=route.request().postDataJSON();calls.push(body);if(body.action==='approve')state=snapshot(true);await route.fulfill({json:state});});
  await page.goto(base+'tests/consignment-ui/index.html?role='+role);await page.getByText('Car bills are still under review.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Approve dealer amount',exact:true}).count(),role==='director'?1:0);
  assert.equal(await page.getByText('Dealer agreement or statement',{exact:true}).count(),role==='shareholder'?0:1);
  if(role==='director'){
   const approve=page.getByRole('button',{name:'Approve dealer amount',exact:true});assert.equal(await approve.isDisabled(),true);
   await page.getByRole('button',{name:'Correct dealer terms',exact:true}).click();await page.getByLabel('Reason',{exact:true}).fill('Correct agreed percentage');await page.getByLabel('Dealer share (%)',{exact:true}).fill('101');assert.equal(await page.getByRole('button',{name:'Review correction',exact:true}).isDisabled(),true);await page.getByLabel('Dealer share (%)',{exact:true}).fill('40');await page.getByRole('button',{name:'Review correction',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(calls.filter(c=>c.action==='correct_terms').length,0);
   await page.getByRole('checkbox').check();await approve.click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(calls.filter(c=>c.action==='approve').length,0);
   state={...snapshot(),review:review('b')};await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('input[type=checkbox]')?.checked);assert.equal(await approve.isDisabled(),true);
   await page.getByRole('checkbox').check();await approve.click();await page.getByRole('button',{name:'Approve settlement',exact:true}).click();await page.getByText('Dealer amount approved by',{exact:false}).waitFor();
   const writes=calls.filter(c=>c.action==='approve');assert.equal(writes.length,1);assert.equal(writes[0].expectedRevision,'b'.repeat(32));assert.equal(writes[0].costsConfirmed,true);assert.ok(writes[0].requestId);assert.equal('actor' in writes[0],false);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile horizontal overflow');await page.close();
 }
 // Initial review keeps percentage editable and bank details visible before confirmation.
 const page=await browser.newPage();const calls=[];let opened=false;
 await isolate(page);
 await page.route('**/api/**',async route=>{const b=route.request().postDataJSON();calls.push(b);if(b.action==='open')opened=true;await route.fulfill({json:b.action==='preview_open'?{preview:{carId:'test-car',sourceRevision:'c'.repeat(32),terms:'profit_split',dealerBasisPoints:b.dealerBasisPoints,dealer:{name:'Dealer',bankName:'Bank',accountNumber:'123456',accountHolder:'Dealer'},revenueCents:7000000,loanCents:0,lenderCents:0}}:opened?snapshot():{carId:'test-car',case:null}});});
 await page.goto(base+'tests/consignment-ui/index.html?role=director');await page.getByRole('spinbutton').fill('57.25');await page.getByRole('button',{name:'Review deal',exact:true}).click();await page.getByText('Dealer bank:',{exact:false}).waitFor();await page.getByRole('button',{name:'Open this deal',exact:true}).click();assert.equal(calls.filter(c=>c.action==='open').length,0);await page.getByRole('button',{name:'Open deal',exact:true}).click();await page.getByText('Car bills are still under review.',{exact:false}).waitFor();assert.equal(calls.find(c=>c.action==='open').dealerBasisPoints,5725);await page.close();
 const billsPage=await browser.newPage();await isolate(billsPage);let billState={...snapshot(),billRevision:'e'.repeat(32),billInvoices:[{paymentId:'bill',documentId:'11111111-1111-4111-8111-111111111111',name:'Repair.pdf'}],payments:[{id:'bill',car_id:'test-car',type:'repair',status:'pending',amount:3500,recipient_name:'Workshop',bank_paid_cents:0}]};const billCalls=[];
 await billsPage.route('**/api/**',async route=>{const b=route.request().postDataJSON();billCalls.push(b);if(b.action==='correct_bill')billState={...billState,billRevision:'f'.repeat(32),payments:[{...billState.payments[0],amount:3000}]};await route.fulfill({json:billState});});
 await billsPage.goto(base+'tests/consignment-ui/index.html?role=director');await billsPage.getByRole('button',{name:'Correct bill',exact:true}).click();await billsPage.getByLabel('Correct amount (RM)',{exact:true}).fill('3000');await billsPage.getByRole('combobox').selectOption('11111111-1111-4111-8111-111111111111');await billsPage.getByLabel('Reason for bill correction',{exact:true}).fill('Correct invoice amount');await billsPage.getByRole('button',{name:'Review bill correction',exact:true}).click();await billsPage.getByRole('button',{name:'Save bill correction',exact:true}).click();await billsPage.getByRole('button',{name:'Review bill correction',exact:true}).waitFor({state:'hidden'});const billWrite=billCalls.find(c=>c.action==='correct_bill');assert.equal(billWrite.amountCents,300000);assert.equal(billWrite.paymentId,'bill');assert.equal(billWrite.expectedRevision,'e'.repeat(32));await billsPage.close();
 console.log('PASS isolated real-browser consignment UI: Director confirmation/cancel/source refresh; admin/shareholder controls; adjustable percentage; mobile layout. APIs mocked; production sessions not tested.');
}finally{await browser?.close();await server.close();}
