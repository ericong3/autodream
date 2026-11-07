// Disposable local database only. Reproduces production types/checks/triggers.
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {productionFinanceFixture} from './helpers/production-finance-fixture.mjs';
const db=await productionFinanceFixture(process.argv[2]);
try{
 const password=bcrypt.hashSync('Disposable-test-only',10);
 for(const [id,role] of [['d','director'],['a','admin'],['i','investor'],['other','investor']]){await db.query("insert into users(id,name,username,password,role,business_access) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end)",[id,password,role]);await db.query("insert into garage_building_staff(id,name,username,password,role,business_access,registration_status,enabled) values($1,$1,$1,$2,$3,case when $3='director' then 'both' else 'used_car' end,'active',true)",[id,password,role]);}
 let serial=0;const req=()=> 'investor_adjust_'+String(++serial).padStart(8,'0');const call=async(fn,actor,action,data={})=>(await db.query('select '+fn+'($1,$2,$3) result',[actor,action,data])).rows[0].result;
 const cap=(action,data={})=>call('uc_investor_capital','d',action,{...data,requestId:req()});const act=(action,data={})=>call('uc_investor_bill_adjustment','d',action,data);
 const day=(await db.query("select to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 const bank=(await call('uc_investor_activation','d','save_bank',{name:'Public Bank test',openingDate:day,openingCents:1000000,requestId:req()})).bank;
 const money=()=>({bankAccount:'bank:'+bank.id,bankReference:req(),paidOn:day});
 const profile=await cap('create_profile',{name:'Test investor'}),potId=profile.potId;await cap('link_account',{potId,staffId:'i'});await cap('capital_received',{potId,amountCents:50000000,...money()});
 await db.query("insert into cars(id,make,model,year,status,purchase_price,investor_split,waive_commission) values('car','Toyota','Vios',2026,'available',50000,null,true)");await cap('fund_car',{carId:'car',potId,purchaseCents:5000000,investorBasisPoints:3750});
 const document=async(billId,kind)=>{const d=await call('uc_investor_activation','d','proof_prepare',{billId,kind,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++serial).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_investor_activation','d','proof_confirm',{documentId:d.documentId});return d.documentId;};
 const billId=(await cap('add_car_bill',{carId:'car',category:'repair',purpose:'Workshop repair',payee:'Workshop',amountCents:300000})).billId;await document(billId,'bill');await cap('approve_car_bill',{carId:'car',billId});
 const originalPayment={carId:'car',billId,amountCents:200000,receiptDocumentId:await document(billId,'receipt'),...money(),requestId:req()};const originalPaymentResult=await call('uc_investor_capital','d','pay_car_bill',originalPayment);
 const correct=async(amountCents)=>{const data={carId:'car',billId,amountCents,invoiceDocumentId:await document(billId,'bill'),reason:'Supplier corrected invoice amount'};const preview=(await act('preview',data)).preview;const command={...data,expectedRevision:preview.sourceRevision,requestId:req()};const saved=await act('apply',command);assert.deepEqual(await act('apply',command),saved);return saved;};
 let result=await correct(250000);assert.equal(result.payableCents,50000);assert.equal(result.totalCents,250000);assert.equal((await db.query('select amount_cents from uc_investor_car_bills where id=$1',[billId])).rows[0].amount_cents,300000);
 assert.deepEqual(await call('uc_investor_capital','d','pay_car_bill',originalPayment),originalPaymentResult,'A pre-adjustment payment retry retains its original response');
 await cap('pay_car_bill',{carId:'car',billId,amountCents:50000,receiptDocumentId:await document(billId,'receipt'),...money()});
 result=await correct(350000);assert.equal(result.payableCents,100000);await cap('pay_car_bill',{carId:'car',billId,amountCents:100000,receiptDocumentId:await document(billId,'receipt'),...money()});
 result=await correct(200000);assert.equal(result.receivableCents,150000);const before=(await db.query('select uc_investor_position($1) p',[potId])).rows[0].p.cashCents;
 const refund={carId:'car',billId,amountCents:150000,receiptDocumentId:await document(billId,'receipt'),...money(),requestId:req()};await act('refund',refund);await act('refund',refund);
 assert.equal((await db.query('select uc_investor_position($1) p',[potId])).rows[0].p.cashCents,before+150000);
 await assert.rejects(()=>act('refund',{...refund,requestId:req()}),/PAYMENT_EXCEEDS_BALANCE/);
 const own=await call('uc_investor_capital','i','car_snapshot',{carId:'car'});assert.equal(own.bills[0].amountCents,200000);assert.equal(own.bills[0].originalAmountCents,300000);assert.equal(own.bills[0].paidCents,200000);assert.equal(own.bills[0].documents.find(d=>d.id===refund.receiptDocumentId).used,true);
 await assert.rejects(()=>call('uc_investor_bill_adjustment','a','snapshot',{carId:'car',billId}),/NOT_ALLOWED/);await assert.rejects(()=>call('uc_investor_bill_adjustment','other','snapshot',{carId:'car',billId}),/NOT_ALLOWED/);
 await assert.rejects(()=>cap('void_car_bill',{carId:'car',billId,note:'Cannot erase corrections'}),/PAID_BILL_ADJUSTMENT_REQUIRED/);
 const correctBill=async(target,amountCents)=>{const data={carId:'car',billId:target,amountCents,invoiceDocumentId:await document(target,'bill'),reason:'Supplier revised the bill'};const plan=(await act('preview',data)).preview;return act('apply',{...data,expectedRevision:plan.sourceRevision,requestId:req()});};
 // FIRST correction: a waiting pay request must route again after the lock.
 const firstBill=(await cap('add_car_bill',{carId:'car',category:'repair',purpose:'First correction race',payee:'Workshop',amountCents:100000})).billId;await document(firstBill,'bill');await cap('approve_car_bill',{carId:'car',billId:firstBill});
 const firstPayProof=await document(firstBill,'receipt'),firstData={carId:'car',billId:firstBill,amountCents:50000,invoiceDocumentId:await document(firstBill,'bill'),reason:'First supplier correction'},firstPlan=(await act('preview',firstData)).preview;
 if(db.isPostgres){const one=await db.connection(),two=await db.connection();try{
  const pid=(await two.query('select pg_backend_pid() pid')).rows[0].pid;
  await one.query('begin');await one.query("select uc_investor_bill_adjustment('d','apply',$1)",[{...firstData,expectedRevision:firstPlan.sourceRevision,requestId:req()}]);
  const stale=two.query("select uc_investor_capital('d','pay_car_bill',$1)",[{carId:'car',billId:firstBill,amountCents:100000,receiptDocumentId:firstPayProof,...money(),requestId:req()}]);const caught=stale.then(()=>null,e=>e);
  let waiting=false;for(let i=0;i<100&&!waiting;i++){waiting=(await db.query("select wait_event_type='Lock' and lower(wait_event)='advisory' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting;if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(waiting,true,'Pay request must reach the blocked advisory lock before correction commits');
  await one.query('commit');assert.match((await caught)?.message||'',/PAYMENT_EXCEEDS_BALANCE/);
 }finally{await one.end();await two.end();}}
 await correctBill(firstBill,0);
 // A legacy approved bill may receive its original invoice after approval.
 // That original document is not a fresh credit note for changing its amount.
 const legacy=(await cap('add_car_bill',{carId:'car',category:'misc',purpose:'Legacy invoice floor',payee:'Supplier',amountCents:50000})).billId;
 await db.exec('alter table uc_investor_car_bills disable trigger uc_bill_invoice_required');await db.query("update uc_investor_car_bills set state='approved',reviewed_by='d',reviewed_at=now() where id=$1",[legacy]);await db.exec('alter table uc_investor_car_bills enable trigger uc_bill_invoice_required');
 const lateOriginal=await document(legacy,'bill');await assert.rejects(()=>act('preview',{carId:'car',billId:legacy,amountCents:10000,invoiceDocumentId:lateOriginal,reason:'Wrong original reused'}),/NEW_CREDIT_NOTE_REQUIRED/);await correctBill(legacy,0);
 // Settle with a bill paid by deduction from the sale proceeds. It is paid,
 // despite having no car_expense cash row of its own.
 const purchase={};for(const kind of ['invoice','payment']){const d=await call('uc_investor_money_evidence','d','prepare',{target:'purchase',carId:'car',kind,amountCents:5000000,fileName:kind+'.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++serial).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await call('uc_investor_money_evidence','d','confirm',{documentId:d.documentId});purchase[kind]=d.documentId;}
 await cap('purchase_paid',{carId:'car',invoiceDocumentId:purchase.invoice,receiptDocumentId:purchase.payment,...money()});await cap('agree_sale',{carId:'car',amountCents:7000000});
 const recovery=(action,data)=>call('uc_investor_recoveries','d',action,data);
 const saleProof=async(orderId)=>{const d=await recovery('proof_prepare',{orderId,fileName:'sale.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++serial).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[d.path]);await recovery('proof_confirm',{documentId:d.documentId});return d.documentId;};
 const staleFee=(await cap('add_car_bill',{carId:'car',category:'invoicing',purpose:'Adjusted withheld fee',payee:'Bank',amountCents:100000})).billId;await document(staleFee,'bill');await cap('approve_car_bill',{carId:'car',billId:staleFee});
 const staleOrder=await recovery('prepare_receipt',{carId:'car',amountCents:0,withheldBills:[{billId:staleFee,amountCents:100000}],bankAccountId:bank.id,bankReference:req(),paidOn:day,requestId:req()}),staleDoc=await saleProof(staleOrder.orderId);
 await correctBill(staleFee,50000);await assert.rejects(()=>recovery('post',{orderId:staleOrder.orderId,documentId:staleDoc,requestId:req()}),/PAYMENT_EXCEEDS_BALANCE/);
 await correctBill(staleFee,200000);const increasedOrder=await recovery('prepare_receipt',{carId:'car',amountCents:0,withheldBills:[{billId:staleFee,amountCents:200000}],bankAccountId:bank.id,bankReference:req(),paidOn:day,requestId:req()});await recovery('post',{orderId:increasedOrder.orderId,documentId:await saleProof(increasedOrder.orderId),requestId:req()});
 await recovery('cancel',{orderId:staleOrder.orderId,note:'Replaced by corrected bank deduction',requestId:req()});
 const beforeRefundCorrection=await document(staleFee,'receipt');await correctBill(staleFee,0);
 const feeId=(await cap('add_car_bill',{carId:'car',category:'invoicing',purpose:'Bank processing',payee:'Bank',amountCents:100000})).billId;await document(feeId,'bill');await cap('approve_car_bill',{carId:'car',billId:feeId});
 const beforeWithholdingNote=await document(feeId,'bill');
 const order=await recovery('prepare_receipt',{carId:'car',amountCents:6700000,withheldBills:[{billId:feeId,amountCents:100000}],excessCents:0,bankAccountId:bank.id,bankReference:req(),paidOn:day,requestId:req()});
 const saleDoc=await recovery('proof_prepare',{orderId:order.orderId,fileName:'sale.pdf',mimeType:'application/pdf',sizeBytes:100,sha256:(++serial).toString(16).padStart(64,'0'),requestId:req()});await db.query("insert into storage.objects values('finance-evidence',$1)",[saleDoc.path]);await recovery('proof_confirm',{documentId:saleDoc.documentId});await recovery('post',{orderId:order.orderId,documentId:saleDoc.documentId,requestId:req()});
 await assert.rejects(()=>act('preview',{carId:'car',billId:feeId,amountCents:50000,invoiceDocumentId:beforeWithholdingNote,reason:'Old note before bank deduction'}),/NEW_CREDIT_NOTE_REQUIRED/);
 await assert.rejects(()=>cap('settle_car',{carId:'car',confirmCosts:true}),/SUPPLIER_REFUND_STILL_DUE/);
 await assert.rejects(()=>act('refund',{carId:'car',billId:staleFee,amountCents:200000,receiptDocumentId:beforeRefundCorrection,...money(),requestId:req()}),/SUPPLIER_REFUND_PROOF_REQUIRED/);
 const staleRefund={carId:'car',billId:staleFee,amountCents:200000,receiptDocumentId:await document(staleFee,'receipt'),...money(),requestId:req()};
 await db.query("delete from ledger_accounts where id='acct-bank-uc-'||md5($1)",['bank:'+bank.id]);await act('refund',staleRefund);
 assert.equal((await db.query("select count(*) n from ledger_accounts where id='acct-bank-uc-'||md5($1)",['bank:'+bank.id])).rows[0].n,1,'Refund recreates its bank ledger account when needed');
 await cap('settle_car',{carId:'car',confirmCosts:true});
 const original=(await db.query("select to_jsonb(s) s from uc_investor_car_settlements s where car_id='car'")).rows[0].s;assert.equal(original.company_profit_cents,1062500);assert.equal(original.investor_basis_points,3750);
 const originalCash=(await db.query('select uc_investor_position($1) p',[potId])).rows[0].p.cashCents;
 // Simulate company money already spent, retaining investor-owned cash. This
 // fixture movement is not an assertion about the payment-entry workflow.
 const company=(await db.query('select uc_company_cash_position() p')).rows[0].p;
 await db.query("insert into uc_bank_movements(bank_id,amount_cents,paid_on,bank_reference,source_kind,source_id,recorded_by) values($1,$2,$3,$4,'company',gen_random_uuid(),'d')",[bank.id,-company.companyCashCents,day,req()]);
 result=await correct(2500000);assert.equal(result.companyOwesInvestorCents,1062500);assert.equal(result.car.settlement.company_profit_cents,0);assert.equal(result.car.settlement.investor_result_cents,-600000);assert.equal(result.position.cashCents,originalCash,'A company profit clawback is not cash until funded');
 assert.equal((await db.query('select uc_company_cash_position() p')).rows[0].p.availableCents,-1062500,'Owed investor money reserves company funds');
 await assert.rejects(()=>act('apply_profit_transfer',{carId:'car',billId,amountCents:1062500,requestId:req()}),/INSUFFICIENT_TRANSFER_FUNDS/);
 await db.query("insert into uc_bank_movements(bank_id,amount_cents,paid_on,bank_reference,source_kind,source_id,recorded_by) values($1,1062500,$2,$3,'company',gen_random_uuid(),'d')",[bank.id,day,req()]);
 const movementCount=(await db.query('select count(*) n from uc_bank_movements')).rows[0].n;
 const transfer={carId:'car',billId,amountCents:1062500,requestId:req()};await act('apply_profit_transfer',transfer);await act('apply_profit_transfer',transfer);
 assert.equal((await db.query('select count(*) n from uc_bank_movements')).rows[0].n,movementCount,'An internal ownership transfer never creates bank cash');
 assert.equal((await db.query('select uc_investor_position($1) p',[potId])).rows[0].p.cashCents,originalCash+1062500);
 result=await correct(200000);assert.equal(result.heldCompanyProfitAdjustmentCents,1062500);await act('apply_profit_transfer',{carId:'car',billId,amountCents:1062500,requestId:req()});
 // Correct the withheld bill. Its 1,000 deduction must not be lost or replayed.
 const feeData={carId:'car',billId:feeId,amountCents:50000,invoiceDocumentId:await document(feeId,'bill'),reason:'Bank supplied credit note'};const feePlan=(await act('preview',feeData)).preview;assert.equal(feePlan.receivableCents,50000);assert.equal(feePlan.payableCents,0);
 const feeCorrection=await act('apply',{...feeData,expectedRevision:feePlan.sourceRevision,requestId:req()});assert.equal(feeCorrection.paidCents,100000);assert.equal(feeCorrection.withheldCents,100000);assert.equal(feeCorrection.heldCompanyProfitAdjustmentCents,31250);
 await assert.rejects(()=>act('apply_profit_transfer',{carId:'car',billId:feeId,amountCents:31250,requestId:req()}),/SUPPLIER_REFUND_STILL_DUE/);
 const feeRefund={carId:'car',billId:feeId,amountCents:50000,receiptDocumentId:await document(feeId,'receipt'),...money(),requestId:req()};
 if(db.isPostgres){const clients=await Promise.all([db.connection(),db.connection()]);try{const replies=await Promise.all(clients.map(client=>client.query("select uc_investor_bill_adjustment('d','refund',$1) r",[feeRefund])));assert.deepEqual(replies[0].rows[0],replies[1].rows[0]);}finally{await Promise.all(clients.map(client=>client.end()));}}else await act('refund',feeRefund);
 await act('apply_profit_transfer',{carId:'car',billId:feeId,amountCents:31250,requestId:req()});
 assert.deepEqual((await db.query("select to_jsonb(s) s from uc_investor_car_settlements s where car_id='car'")).rows[0].s,original,'Original settlement is immutable');
 assert.equal((await db.query("select uc_investor_car_summary('car') s")).rows[0].s.settlement.company_profit_cents,1093750);
 await db.exec("update garage_building_staff set enabled=false where id='d'");await assert.rejects(()=>act('refund',feeRefund),/NOT_ALLOWED/);await db.exec("update garage_building_staff set enabled=true where id='d'");
 // A stale pay request waits behind the correction and then sees zero left.
 await correct(300000);const payProof=await document(billId,'receipt'),raceData={carId:'car',billId,amountCents:200000,invoiceDocumentId:await document(billId,'bill'),reason:'Corrected before transfer'};const racePreview=(await act('preview',raceData)).preview;
 if(db.isPostgres){const one=await db.connection(),two=await db.connection();try{
  await one.query('begin');await one.query("select uc_investor_bill_adjustment('d','apply',$1)",[{...raceData,expectedRevision:racePreview.sourceRevision,requestId:req()}]);
  const paying=two.query("select uc_investor_capital('d','pay_car_bill',$1)",[{carId:'car',billId,amountCents:100000,receiptDocumentId:payProof,...money(),requestId:req()}]);const caught=paying.then(()=>null,e=>e);
  await one.query('commit');assert.match((await caught)?.message||'',/PAYMENT_EXCEEDS_BALANCE/);
 }finally{await one.end();await two.end();}}
 const fullCredit=await correct(0);assert.equal(fullCredit.totalCents,0);assert.equal(fullCredit.payableCents,0);assert.equal(fullCredit.receivableCents,200000);
 assert.equal((await call('uc_investor_activation','d','list_profiles',{})).companyProfitCents,1218750,'Company profit report uses the amended saved percentage');
 const auditView=await call('uc_investor_capital','i','car_snapshot',{carId:'car'});assert.ok(auditView.bills.find(b=>b.id===billId).adjustments.length>=5);assert.equal(auditView.bills.find(b=>b.id===billId).adjustments[0].afterTotalCents,0);
 const investorHistory=await call('uc_investor_capital','i','snapshot',{});assert.ok(investorHistory.entries.some(e=>e.kind==='profit_adjustment_in'));assert.ok(investorHistory.entries.some(e=>e.kind==='profit_adjustment_out'));
 const balances=(await db.query("select l->>'accountId' id,sum((l->>'debit')::numeric-(l->>'credit')::numeric) n from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where j.car_id='car' and not j.voided group by l->>'accountId'")).rows;
 const balanceOf=id=>Number(balances.find(b=>b.id===id)?.n||0);
 assert.equal(balanceOf('acct-ap'),0);assert.equal(balanceOf('acct-inv-investor'),0);assert.equal(balanceOf('acct-investor-supplier-credit'),2000);assert.equal(balanceOf('acct-rev-investor-share'),-12187.5);
 await assert.rejects(()=>db.exec("insert into journal_entries(id,date,description,source_type,source_id,lines) values('wrong-supplier-credit',current_date,'Not allowed','manual','wrong','[{\"accountId\":\"acct-investor-supplier-credit\",\"debit\":1,\"credit\":0},{\"accountId\":\"acct-equity\",\"debit\":0,\"credit\":1}]')"),/USE_INVESTOR_POSTING/);
 const unbalanced=(await db.query("select count(*) n from journal_entries j where (select sum((l->>'debit')::numeric-(l->>'credit')::numeric) from jsonb_array_elements(j.lines) l)<>0")).rows[0].n;assert.equal(unbalanced,0);
 console.log('PASS investor bill corrections: original records, partial/increase/full credit, refund replay, withheld bills, settled profit/loss at saved percentage, funded ownership transfers, held unreceived refund, concurrent stale payment, own audit and role isolation.');
}finally{await db.close();}
