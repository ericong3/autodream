export const cents = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) throw Error('Enter a valid amount with up to two decimal places.');
  return Math.round(n * 100);
};
export const seed = () => ({
  role:'Director', cash:50000000, company:10000000, purchase:5000000, bought:false, proceeds:7000000, collected:false, settled:false,
  share:40, bills:[{id:'repair',purpose:'Repair · front suspension',payee:'Sample workshop',amount:350000,approved:false,paid:0,proof:''}],
  withdrawals:[], events:[{label:'Opening capital received',amount:50000000,time:'Sample opening entry'}], matches:[], statement:[], serial:0,
});
export function totals(s) {
  const billsReserved=s.bills.filter(b=>b.approved).reduce((n,b)=>n+b.amount-b.paid,0);
  const withdrawalsReserved=s.withdrawals.filter(w=>w.status==='approved').reduce((n,w)=>n+w.amount,0);
  const cost=s.bills.filter(b=>b.approved).reduce((n,b)=>n+b.amount,0);
  const profit=s.proceeds-s.purchase-cost;
  const companyShare=profit>0?profit-Math.round(profit*s.share/100):0;
  const companyReserved=s.collected&&!s.settled?companyShare:0;
  const committed=billsReserved+withdrawalsReserved+companyReserved;
  return {committed,billsReserved,withdrawalsReserved,companyReserved,available:s.cash-committed,cost,profit,companyShare,investorShare:profit>0?profit-companyShare:profit,invested:s.bought&&!s.collected?s.purchase+s.bills.reduce((n,b)=>n+b.paid,0):0};
}
export function act(source, action, payload={}) {
  const s=structuredClone(source);
  const director=()=>{if(s.role!=='Director')throw Error('Director approval required.');};
  const log=(label,amount=0,bank=false)=>{const id=++s.serial;s.events.unshift({id,label,amount,time:new Date().toLocaleTimeString(),bank});if(bank)s.statement.push({id,label,amount});};
  if(action==='role'){s.role=payload.role;return s;}
  if(action==='purchase') {director();if(s.bought)throw Error('Purchase already recorded.');if(totals(s).available<s.purchase)throw Error('Not enough available capital.');s.cash-=s.purchase;s.bought=true;log('Car purchase paid',-s.purchase,true);}
  if(action==='bill') {if(s.role==='Investor')throw Error('Staff access required.');if(s.settled)throw Error('This car is settled. A Director must approve a correction.');const amount=cents(payload.amount);if(!amount||!payload.payee?.trim()||!payload.purpose?.trim())throw Error('Enter the payee, purpose and amount.');s.bills.push({id:'bill-'+(++s.serial),purpose:payload.purpose.trim(),payee:payload.payee.trim(),amount,approved:false,paid:0,proof:''});log('Bill recorded: '+payload.purpose);}
  if(action==='approve') {director();const b=s.bills.find(b=>b.id===payload.id);if(!b||b.approved)throw Error('Bill already approved or not found.');if(totals(s).available<b.amount)throw Error('Not enough available capital. Record an approved funding decision first.');b.approved=true;log('Bill approved: '+b.purpose);}
  if(action==='pay') {director();const b=s.bills.find(b=>b.id===payload.id);if(!b?.approved)throw Error('Approve the bill first.');const amount=cents(payload.amount);if(amount<=0||amount>b.amount-b.paid)throw Error('Payment must be within the unpaid balance.');if(amount>s.cash)throw Error('Not enough cash.');b.paid+=amount;s.cash-=amount;log('Payment to '+b.payee,-amount,true);}
  if(action==='proof') {if(s.role==='Investor')throw Error('Staff access required.');const b=s.bills.find(b=>b.id===payload.id);if(!b?.paid)throw Error('Record a payment first.');b.proof=payload.name;log('Sample receipt name saved: '+b.payee);}
  if(action==='collect') {director();if(!s.bought||s.collected)throw Error('Purchase required; collection can only be recorded once.');s.collected=true;s.cash+=s.proceeds;log('Sale money received',s.proceeds,true);}
  if(action==='settle') {director();if(s.settled)throw Error('Already settled.');if(!s.collected)throw Error('Receive all sale money first.');if(s.bills.some(b=>!b.approved||b.paid!==b.amount))throw Error('Review and clear every car bill first.');const t=totals(s);if(t.available<0)throw Error('More money is set aside than the cash available. Check the bills and withdrawals first.');s.cash-=t.companyShare;s.company+=t.companyShare;s.settled=true;log(t.companyShare?'Company profit moved to company account (no bank transfer)':'Loss recorded; no company profit',-t.companyShare);}
  if(action==='withdraw') {if(s.role==='Admin')throw Error('Investor or Director access required.');const amount=cents(payload.amount);if(!amount||amount>totals(s).available)throw Error('Withdrawal exceeds available capital.');s.withdrawals.push({id:'w-'+(++s.serial),amount,status:'requested'});log('Withdrawal requested');}
  if(action==='approveWithdrawal') {director();const w=s.withdrawals.find(w=>w.id===payload.id);if(!w||w.status!=='requested')throw Error('Request already reviewed.');if(w.amount>totals(s).available)throw Error('Not enough available capital.');w.status='approved';log('Withdrawal approved');}
  if(action==='payWithdrawal') {director();const w=s.withdrawals.find(w=>w.id===payload.id);if(!w||w.status!=='approved')throw Error('Approval required.');if(w.amount>s.cash)throw Error('Not enough cash.');s.cash-=w.amount;w.status='paid';log('Investor withdrawal paid',-w.amount,true);}
  if(action==='match') {director();if(!s.statement.some(x=>x.id===payload.id)||s.matches.includes(payload.id))throw Error('Line already matched or not found.');s.matches.push(payload.id);}
  return s;
}
