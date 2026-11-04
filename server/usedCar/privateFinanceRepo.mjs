// All row restrictions apply before pagination and before mutations. Caller
// authentication and permitted write fields are checked by privateFinance.mjs.
const payroll=['salary','allowance','director_fee','campaign_bonus','payroll','payslip','salary_paid','allowance_paid','director_fee_paid','campaign_bonus_paid'];
const accounts=['acct-exp-salary','acct-exp-allowance','acct-exp-director-fee','acct-exp-campaign-bonus','acct-investor-payable','acct-inv-investor','acct-rev-investor-share','acct-bank-investor','acct-uc-sale-clearing'];
export async function privateFinanceQuery(sb,{table,operation,data,filters,orders,range,policy:p}){
 const bank=['bank_transactions','bank_statement_uploads'].includes(table);
 if(operation==='select'&&((bank&&!p.director)||(table==='investor_transactions'&&!p.director)||(table==='payslips'&&!p.manager&&!p.ownPayroll)||(table==='journal_entries'&&!p.manager&&!p.admin)))return {data:[],error:null};
 let q=sb.from(table);
 if(operation==='select')q=q.select('*');
 else if(operation==='insert')q=q.insert(data).select('*');
 else if(operation==='update')q=q.update(data).select('*');
 else q=q.delete().select('*');
 if(!p.manager&&table==='payments'){
  q=q.not('type','in','('+payroll.join(',')+')');
  if(!p.admin)q=q.eq('recipient_id',p.actorId);
 }
 if(!p.manager&&table==='journal_entries'){
  q=q.or('source_type.is.null,source_type.not.in.('+[...payroll,'investor_finance'].join(',')+')');
  for(const accountId of accounts)q=q.not('lines','cs',JSON.stringify([{accountId}]));
 }
 if(!p.manager&&table==='payslips')q=q.eq('user_id',p.actorId);
 for(const f of filters)q=f.op==='in'?q.in(f.column,f.value):q.eq(f.column,f.value);
 if(operation==='select'){
  for(const o of orders)q=q.order(o.column,{ascending:o.ascending});
  q=q.range(...range);
 }
 return await q;
}
