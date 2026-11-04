import {createHash} from 'node:crypto';
import {ApiError,authenticate,canUseApp,respond,readJson,onlyKeys} from '../garageBuilding/core.mjs';
export const PRIVATE_FINANCE_TABLES=['users','payments','payslips','journal_entries','bank_transactions','bank_statement_uploads','investor_transactions','ledger_accounts'];
const salaryTypes=new Set(['salary','allowance','director_fee','campaign_bonus','payroll','payslip','salary_paid','allowance_paid','director_fee_paid','campaign_bonus_paid']);
const salaryFields=['basic_salary','allowance','salary_increment','temporary_boost','temporary_boost_until'];
const profileFields=new Set(['name','phone','avatar','position','bio','email','whatsapp','instagram','facebook','website','bank_name','bank_account_number','bank_account_holder']);
const payrollAccounts=new Set(['acct-exp-salary','acct-exp-allowance','acct-exp-director-fee','acct-exp-campaign-bonus','acct-investor-payable','acct-inv-investor','acct-rev-investor-share','acct-bank-investor','acct-uc-sale-clearing']);
const salaryJournal=r=>r.source_type==='investor_finance'||salaryTypes.has(r.source_type)||Array.isArray(r.lines)&&r.lines.some(l=>payrollAccounts.has(l.accountId));
const id=v=>typeof v==='string'&&v.length>0&&v.length<=180;
export function isPrivateFinanceRequest(req){try{return (typeof req.body==='string'?JSON.parse(req.body):req.body)?.scope==='private_finance';}catch{return false;}}
export async function handlePrivateFinance(req,deps){return respond(req,deps,['POST'],async(ctx,res)=>{
 const {user}=await authenticate(req,ctx,res,canUseApp);
 if(user.role==='investor')throw new ApiError(403,'FORBIDDEN','Use your investor account page.');
 const b=readJson(req,1500000);onlyKeys(b,['scope','table','operation','data','filters','orders','range']);
 if(!['used_car','both'].includes(user.business_access))throw new ApiError(403,'FORBIDDEN','Used Car access is required.');
 if(!PRIVATE_FINANCE_TABLES.includes(b.table)||!['select','insert','update','delete'].includes(b.operation))throw new ApiError(400,'INVALID','Choose a valid finance record.');
 if(deps.env.USED_CAR_PRIVATE_FINANCE_ONLINE!=='1')throw new ApiError(503,'SETUP','Private finance saving is waiting for activation.');
 const filters=b.filters??[],orders=b.orders??[],range=b.range??[0,499];
 if(!Array.isArray(filters)||filters.length>10||filters.some(f=>!f||!['eq','in'].includes(f.op)||!['id','user_id','recipient_id','type','status','source_type','source_id','car_id','username'].includes(f.column)||f.op==='eq'&&!(typeof f.value==='string'||typeof f.value==='number'||typeof f.value==='boolean')||f.op==='in'&&(!Array.isArray(f.value)||f.value.length>200||f.value.some(v=>typeof v!=='string'))) || !Array.isArray(orders)||orders.length>3||orders.some(o=>!['id','date','created_at','uploaded_at','name'].includes(o.column)||typeof o.ascending!=='boolean') || !Array.isArray(range)||range.length!==2||range.some(n=>!Number.isInteger(n)||n<0)||range[1]<range[0]||range[1]-range[0]>999||range[1]>1000000)throw new ApiError(400,'INVALID','Reload the finance records.');
 const manager=['director','shareholder'].includes(user.role),director=user.role==='director',admin=user.role==='admin';
 const write=b.operation!=='select';
 if(write&&b.table==='payments'&&(filters.some(f=>f.column==='id'&&typeof f.value==='string'&&f.value.startsWith('uc_commission_'))||(Array.isArray(b.data)?b.data:[b.data]).some(r=>typeof r?.id==='string'&&r.id.startsWith('uc_commission_'))))throw new ApiError(409,'INVESTOR_BILL','Open the investor car bill to review or pay this commission.');
 if(write){
  if(b.operation!=='delete'&&(!b.data||typeof b.data!=='object'||Array.isArray(b.data)&&(b.data.length===0||b.data.length>500||b.data.some(r=>!r||typeof r!=='object'||Array.isArray(r)))))throw new ApiError(400,'INVALID','Choose valid records to save.');
  if(user.role==='shareholder'||user.role==='banker'||user.business_access==='garage')throw new ApiError(403,'FORBIDDEN','A Director must make this finance change.');
  if(b.table==='ledger_accounts'&&!director)throw new ApiError(403,'FORBIDDEN','A Director manages the account list.');
  if(b.table==='investor_transactions')throw new ApiError(409,'LEGACY','Use the new investor accounts.');
  if(['bank_transactions','bank_statement_uploads','payslips'].includes(b.table)&&!director)throw new ApiError(403,'FORBIDDEN','Only a Director can change this record.');
  if(['update','delete'].includes(b.operation)&&!(filters.length===1&&filters[0].op==='eq'&&filters[0].column==='id'&&id(filters[0].value)))throw new ApiError(400,'INVALID','Choose one record to update.');
  if(b.table==='users'){
   if(b.operation!=='update'||!b.data||Array.isArray(b.data))throw new ApiError(403,'FORBIDDEN','Use Staff access to create or disable accounts.');
   const own=filters[0].value===user.id;
   if(!director&&!own)throw new ApiError(403,'FORBIDDEN','You can update your own profile only.');
   if(Object.keys(b.data).some(k=>!profileFields.has(k)&&!(director&&[...salaryFields,'employment_type','employee_id','department','joining_date','monthly_target','cars_in_month'].includes(k))))throw new ApiError(403,'FORBIDDEN','Manage account access separately.');
  }
  if(b.table==='payments'&&!director){
   if(b.operation==='delete')throw new ApiError(403,'FORBIDDEN','Ask the Director to review a correction.');
   if(b.operation==='update'&&Object.keys(b.data??{}).some(k=>!['receipt_url','delete_requested_by','delete_requested_at','claim_confirmed_by','claim_confirmed_at'].includes(k)))throw new ApiError(403,'FORBIDDEN','The Director records payments.');
   const rows=Array.isArray(b.data)?b.data:[b.data];
   if(b.operation==='insert'&&rows.some(r=>!r||salaryTypes.has(r.type)||r.status!=='pending'||!admin&&(r.type!=='expense_claim'||r.recipient_id!==user.id)))throw new ApiError(403,'FORBIDDEN','Only your own unpaid claim can be submitted.');
  }
  if(b.table==='journal_entries'&&!director){
   const rows=Array.isArray(b.data)?b.data:[b.data];
   if(!admin||b.operation!=='insert'||rows.some(r=>!r||salaryJournal(r)||!['expense_claim_confirmed'].includes(r.source_type)))throw new ApiError(403,'FORBIDDEN','A Director must change the accounts.');
  }
 }
 if(write&&b.table==='payments'&&!director&&b.operation==='update'){
  const stamp=new Date().toISOString();
  if(Object.hasOwn(b.data,'delete_requested_by')){b.data.delete_requested_by=user.id;b.data.delete_requested_at=stamp;}
  if(Object.hasOwn(b.data,'claim_confirmed_by')){if(!admin)throw new ApiError(403,'FORBIDDEN','Ask admin to check this claim.');b.data.claim_confirmed_by=user.id;b.data.claim_confirmed_at=stamp;}
 }
 const rate=await ctx.repo.throttleHit('privfin:'+createHash('sha256').update(user.id).digest('hex'),240,900);
 if(!rate.allowed)throw new ApiError(429,'RATE_LIMITED','Wait a moment and try again.');
 // The production repo applies these capabilities to the query before any rows
 // are returned or updated; browser filters can only narrow that scope.
 const policy={actorId:user.id,manager,director,admin,readBank:director,readPayroll:manager,ownPayroll:!admin,write,investorCommissions:deps.env.USED_CAR_INVESTOR_CARS_ONLINE==='1'};
 let out;
 if(admin&&b.table==='journal_entries'&&write){
  const row=Array.isArray(b.data)?b.data.length===1?b.data[0]:null:b.data;
  if(!row||!id(row.source_id)||!id(row.id))throw new ApiError(400,'INVALID','Confirm one recorded claim at a time.');
  const saved=await ctx.repo.rpc('uc_confirm_claim_journal',{p_actor:user.id,p_claim:row.source_id,p_entry:row.id});
  out={...saved,data:saved.data?[saved.data]:[]};
 }else out=await ctx.repo.privateFinance({table:b.table,operation:b.operation,data:b.data,filters,orders,range,policy});
 if(!out.error&&write&&['update','delete'].includes(b.operation)&&Array.isArray(out.data)&&!out.data.length)throw new ApiError(409,'CHANGED','This record is unavailable or has changed. Reload it first.');
 if(out.error){
  const documentErrors={EVIDENCE_REVIEW_REQUIRED:'This payment has confirmed documents. Ask the Director to review a correction.',SUPPLIER_INVOICE_REQUIRED:'Upload the supplier invoice in Invoices & receipts first.',PAYMENT_RECEIPT_REQUIRED:'Upload proof of payment in Invoices & receipts first.',INVOICE_REQUIRED:'Upload the invoice in Invoices & receipts first.',PAYMENT_DOCUMENTS_REQUIRED:'Upload the bill and payment receipt before completing this payment.',PAYMENT_DETAILS_LOCKED:'This payment has uploaded documents. Ask the Director to review a correction.'};
  for(const [code,message] of Object.entries(documentErrors))if(out.error.message?.includes(code))throw new ApiError(409,code,message);
  throw new ApiError(out.error.code==='23503'?409:503,'UNAVAILABLE',out.error.code==='23503'?'Keep this record because it has linked history.':'Could not confirm this finance change. Refresh before trying again.');
 }
 let rows=out.data??[];
 if(!Array.isArray(rows))rows=[rows];
 if(b.table==='users')rows=rows.map(r=>{const safe={...r};delete safe.password;if(!manager&&!(r.id===user.id&&!admin))for(const k of salaryFields)delete safe[k];return safe;});
 if(b.table==='payments'&&!manager)rows=rows.filter(r=>!salaryTypes.has(r.type)&& (admin||r.recipient_id===user.id));
 if(b.table==='journal_entries'&&!manager)rows=admin?rows.filter(r=>!salaryJournal(r)):[];
 if(b.table==='payslips'&&!manager)rows=!admin?rows.filter(r=>r.user_id===user.id):[];
 if(['bank_transactions','bank_statement_uploads'].includes(b.table)&&!director)rows=[];
 if(b.table==='investor_transactions'&&!director)rows=[];
 return {status:200,body:{data:rows}};
});}
