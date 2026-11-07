// Real React interactions with fake API data and all external network blocked.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true,...(existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844}}),calls=[];
 let total=300000,returned=0;const documentId='11111111-1111-4111-8111-111111111111';
 const snapshot=()=>({carId:'test-car',billId:'investor-bill',eligible:true,totalCents:total,paidCents:300000,returnedCents:returned,payableCents:0,receivableCents:300000-returned-total,companyOwesInvestorCents:0,heldCompanyProfitAdjustmentCents:0,invoices:[{documentId,name:'Supplier credit note.pdf'}],receipts:[{documentId:'33333333-3333-4333-8333-333333333333',name:'Supplier refund.pdf'}],adjustments:[]});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.route('**/api/**',async route=>{const b=route.request().postDataJSON();calls.push(b);let result;if(b.action==='snapshot')result=snapshot();else if(b.action==='preview')result={preview:{carId:'test-car',billId:'investor-bill',sourceRevision:'b'.repeat(32),beforeTotalCents:total,afterTotalCents:b.amountCents,payableCents:0,receivableCents:300000-b.amountCents}};else if(b.action==='apply'){total=b.amountCents;result=snapshot();}else if(b.action==='refund'){returned+=b.amountCents;result=snapshot();}else throw Error('Unexpected API '+JSON.stringify(b));await route.fulfill({json:result});});
 await page.goto(server.resolvedUrls.local[0]+'tests/consignment-ui/index.html?screen=investor-bill-adjustment');assert.equal(calls.length,0);
 await page.getByRole('button',{name:'Bill corrections & refunds',exact:true}).click();await page.getByLabel('Correct total (RM)',{exact:true}).fill('2500');await page.getByLabel('Corrected invoice / credit note',{exact:true}).selectOption(documentId);await page.getByLabel('Reason',{exact:true}).fill('Supplier corrected the repair bill');await page.getByRole('button',{name:'Review correction',exact:true}).click();await page.getByText('Supplier owes back:',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Save correction',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(calls.filter(c=>c.action==='apply').length,0);
 await page.getByRole('button',{name:'Save correction',exact:true}).click();await page.getByRole('button',{name:'Save correction',exact:true}).last().click();await page.getByText('Saved. Original payments remain in history.',{exact:true}).waitFor();assert.equal(calls.find(c=>c.action==='apply').expectedRevision,'b'.repeat(32));
 await page.getByText('Record supplier refund ·',{exact:false}).click();await page.getByLabel('Refund received (RM)',{exact:true}).fill('200');await page.getByLabel('Bank account',{exact:true}).selectOption('22222222-2222-4222-8222-222222222222');await page.getByLabel('Bank reference',{exact:false}).fill('Actual supplier refund');await page.getByLabel('Refund receipt',{exact:true}).selectOption('33333333-3333-4333-8333-333333333333');await page.getByRole('button',{name:'Record refund received',exact:true}).click();assert.equal(calls.filter(c=>c.action==='refund').length,0);await page.getByRole('button',{name:'Record refund',exact:true}).click();await page.waitForFunction(()=>document.body.innerText.includes('Refunded RM 200'));
 const money=calls.find(c=>c.action==='refund');assert.equal(money.amountCents,20000);assert.equal(money.bankAccountId,'22222222-2222-4222-8222-222222222222');assert.ok(money.requestId);assert.equal('bankAccount' in money,false);assert.equal('actor' in money,false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const card=await browser.newPage({viewport:{width:390,height:844}});
 await card.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await card.route('**/api/**',route=>route.fulfill({json:{}}));
 await card.goto(server.resolvedUrls.local[0]+'tests/consignment-ui/index.html?screen=car-detail-investor');
 await card.getByRole('button',{name:'View current costs and profit in investor account →',exact:true}).waitFor();
 assert.equal(await card.getByText('Net Profit',{exact:true}).count(),0,'Original source calculations must not appear as current investor profit');
 assert.equal(await card.getByText('Total Repair Cost',{exact:true}).count(),0);
 await card.close();
 console.log('PASS investor bill correction/refund UI: invoice/reason, confirmation/cancel, actual refund proof, registered bank, durable request, mobile. APIs mocked.');
}finally{await browser?.close();await server.close();}
