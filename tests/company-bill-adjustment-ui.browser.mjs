// Isolated real React interactions. All APIs mocked; no production access.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true,...(existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844}});const calls=[];let total=300000;
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.route('**/api/**',async route=>{
  const b=route.request().postDataJSON();calls.push(b);let result;
  if(b.action==='snapshot')result={paymentId:'company-bill',rootPaymentId:'company-bill',carId:'test-car',totalCents:total,paidCents:300000,returnedCents:0,invoices:[{documentId:'11111111-1111-4111-8111-111111111111',name:'Supplier credit note.pdf'}]};
  else if(b.action==='preview')result={paymentId:'company-bill',sourceRevision:'a'.repeat(32),beforeTotalCents:total,afterTotalCents:b.amountCents,payableCents:Math.max(0,b.amountCents-300000),receivableCents:Math.max(0,300000-b.amountCents),costAccount:'acct-cogs-own'};
  else if(b.action==='apply'){total=b.amountCents;result={paymentId:'company-bill',payments:[],journals:[]};}
  else throw Error('Unexpected request '+JSON.stringify(b));
  await route.fulfill({json:result});
 });
 await page.goto(server.resolvedUrls.local[0]+'tests/consignment-ui/index.html?screen=bill-adjustment');
 assert.equal(calls.length,0,'Closed adjustment must not fetch');
 await page.getByRole('button',{name:'Correct bill amount',exact:true}).click();
 const amount=page.getByLabel('Correct total (RM)',{exact:true});await amount.fill('2500');await page.getByRole('combobox').selectOption('11111111-1111-4111-8111-111111111111');await page.getByLabel('Reason',{exact:true}).fill('Workshop corrected its original bill');
 await page.getByRole('button',{name:'Review correction',exact:true}).click();await page.getByText('Supplier owes back:',{exact:false}).waitFor();
 assert.equal(calls.filter(c=>c.action==='apply').length,0);
 await page.getByRole('button',{name:'Save correction',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(calls.filter(c=>c.action==='apply').length,0);
 await amount.fill('0');await page.getByRole('button',{name:'Save correction',exact:true}).waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Review correction',exact:true}).click();await page.getByText('New bill total:',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Save correction',exact:true}).click();await page.getByRole('button',{name:'Save correction',exact:true}).last().click();await page.getByText('Bill correction saved.',{exact:false}).waitFor();
 const saved=calls.filter(c=>c.action==='apply');assert.equal(saved.length,1);assert.equal(saved[0].amountCents,0);assert.equal(saved[0].expectedRevision,'a'.repeat(32));assert.ok(saved[0].requestId);assert.equal('actor' in saved[0],false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 console.log('PASS company paid-bill UI: lazy load, corrected invoice, refund preview, cancel, changed-value invalidation, full credit, durable request and mobile layout. APIs mocked.');
}finally{await browser?.close();await server.close();}
