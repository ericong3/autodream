import {useEffect,useState} from 'react';
import {referralSettlement,type ReferralSettlement} from '../lib/garageReferralSettlement';
import {formatRM} from '../utils/format';
export default function GaragePartnerIncome(){
 const [month,setMonth]=useState(()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'}).slice(0,7));
 const [data,setData]=useState<ReferralSettlement|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setData(null);setError('');referralSettlement('partner_month',{month}).then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[month]);
 return <section className="rounded-2xl border border-white/10 p-5 mb-6 space-y-4" aria-label="Monthly referral income">
  <div className="flex flex-wrap justify-between items-center gap-3"><h2 className="font-semibold">Monthly income</h2><input aria-label="Income month" type="month" value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}} className="bg-white/5 border border-white/15 rounded-lg p-2 text-white"/></div>
  {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}
  {!data&&!error&&<p className="text-white/50 text-sm">Loading income…</p>}
  {data&&!data.enabled&&<p className="text-white/50 text-sm">Monthly income has not been activated yet.</p>}
  {data?.enabled&&<><div><p className="text-white/50 text-xs">Actually paid during {month}</p><p className="text-2xl font-semibold">{formatRM(data.paidThisMonth??0)}</p></div>
   <p className="text-white/40 text-xs">Orders referred this month, plus older orders paid this month. Your past referrals remain linked when you create a login.</p>
   {!data.orders?.length&&<p className="text-white/50 text-sm">No referrals or payouts for this month.</p>}
   {data.orders?.map((o,i)=><div key={o.invoiceNumber+':'+i} className="border-t border-white/10 pt-3 text-sm"><p>{o.invoiceNumber} · {formatRM(o.commission??0)}</p><p className="text-white/50 text-xs mt-1">{o.payable?'Full Garage receipt verified':'Awaiting full Garage receipt'} · Paid to date {formatRM(o.paid)}</p></div>)}
  </>}
 </section>;
}
