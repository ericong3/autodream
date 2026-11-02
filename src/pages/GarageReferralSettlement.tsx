import {useEffect,useRef,useState} from 'react';
import {useLocation} from 'react-router-dom';
import {useStore} from '../store';
import GarageShell from '../components/GarageShell';
import {referralSettlement,type ReferralSettlement} from '../lib/garageReferralSettlement';
import {formatRM} from '../utils/format';
const input='w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2.5 text-white text-sm';
const localMonth=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit'}).format(new Date()).replace(/^(\d{2})\/(\d{4})$/,'$2-$1');
type Pending={action:string;data:Record<string,unknown>};
export default function GarageReferralSettlement(){
 const actor=useStore(s=>s.currentUser?.id),users=useStore(s=>s.users),location=useLocation();
 const [month,setMonth]=useState(localMonth),[list,setList]=useState<ReferralSettlement|null>(null),[detail,setDetail]=useState<ReferralSettlement|null>(null),[selected,setSelected]=useState('');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[amount,setAmount]=useState(''),[reference,setReference]=useState(''),[note,setNote]=useState(''),[paidOn,setPaidOn]=useState(()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'}));
 const [pending,setPending]=useState<Pending|null>(null),[confirm,setConfirm]=useState<Pending|null>(null);
 const epoch=useRef(0),lock=useRef(false),key=`autodream-referral-settlement:${actor}`;
 const who=(id:string)=>users.find(u=>u.id===id)?.name??'Staff';
 useEffect(()=>{const mine=++epoch.current;lock.current=false;setList(null);setDetail(null);setSelected('');setError('');setNotice('');setBusy(false);setConfirm(null);setPending(null);
  try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw);if(!p?.action||typeof p.data?.requestId!=='string')throw Error();setPending(p);setSelected(p.data.invoiceId);}}catch{setError('Saved action could not be read. Contact your Director before entering it again.');lock.current=true;}
  referralSettlement('month',{month}).then(r=>{if(epoch.current===mine)setList(r);}).catch(e=>{if(epoch.current===mine)setError(e.message);});
  return()=>{epoch.current++;};
 },[actor,month]);
 useEffect(()=>{let active=true;setDetail(null);if(selected)referralSettlement('snapshot',{invoiceId:selected}).then(r=>{if(active)setDetail(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[selected,actor]);
 const refresh=async(mine:number)=>{
  const [l,d]=await Promise.all([referralSettlement('month',{month}),selected?referralSettlement('snapshot',{invoiceId:selected}):Promise.resolve(null)]);
  if(mine===epoch.current){setList(l);setDetail(d);}
 };
 const prepare=(action:string,data:Record<string,unknown>)=>{setConfirm({action,data:{invoiceId:selected,requestId:crypto.randomUUID(),...data}});};
 async function save(operation:Pending){
  if(lock.current)return;const mine=epoch.current;lock.current=true;setBusy(true);setError('');setNotice('');
  try{localStorage.setItem(key,JSON.stringify(operation));setPending(operation);setConfirm(null);
   await referralSettlement(operation.action,operation.data);
   localStorage.removeItem(key);
   if(mine!==epoch.current)return;
   setPending(null);setAmount('');setReference('');setNote('');setNotice('Record saved. No bank transfer was performed.');await refresh(mine);
  }catch(e){if(mine===epoch.current){setError((e as Error).message);const {status,code}=e as {status?:number;code?:string};if((status===400||status===409)&&code!=='REQUEST_CHANGED'){localStorage.removeItem(key);setPending(null);}}}
  finally{if(mine===epoch.current){lock.current=false;setBusy(false);}}
 }
 const order=detail?.order,disabled=busy||!!pending;
 const visibleOrders=[...new Map([...(list?.outstandingOrders??[]),...(list?.orders??[])].map(o=>[o.invoiceId,o])).values()];
 const body=<div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5 text-white">
  <div className="flex flex-wrap justify-between items-center gap-4"><div><h1 className="text-xl font-semibold">Garage referrals</h1><p className="text-white/50 text-sm mt-1">Transfers, commission and monthly income</p></div><input aria-label="Referral month" type="month" value={month} disabled={disabled} onChange={e=>{if(e.target.value)setMonth(e.target.value);}} className={input+' max-w-48'}/></div>
  {error&&<p role="alert" className="text-red-300">{error}</p>}{notice&&<p role="status" className="text-emerald-300">{notice}</p>}
  {pending&&<div className="border border-amber-400/30 rounded-xl p-4"><p className="text-amber-200 text-sm">This action is awaiting confirmation. Retry it before entering another record.</p><button disabled={busy} onClick={()=>void save(pending)} className="btn-gold rounded-lg px-4 py-2 mt-3">Retry original action</button></div>}
  {!list&&!error&&<p className="text-white/50">Loading referrals…</p>}
  {list&&!list.enabled&&<p className="text-amber-200">Referral settlement is prepared but has not been activated.</p>}
  {list?.enabled&&<><div className="rounded-xl border border-white/10 p-4"><p className="text-white/50 text-xs">Commission actually paid in {month}</p><p className="text-xl font-semibold mt-1">{formatRM(list.paidThisMonth??0)}</p><p className="text-white/40 text-xs mt-2">Orders placed or paid this month, plus all outstanding referrals carried forward.</p></div>
   <div className="space-y-2">{!visibleOrders.length&&<p className="text-white/50 text-sm">No referral orders, payouts or outstanding balances.</p>}{visibleOrders.map(o=><button key={o.invoiceId} disabled={disabled} onClick={()=>{setSelected(o.invoiceId);setError('');setConfirm(null);}} className={`w-full text-left rounded-xl border p-4 ${selected===o.invoiceId?'border-gold-400/50 bg-gold-400/5':'border-white/10 bg-black/30'}`}><div className="flex flex-wrap justify-between gap-2"><span>{o.invoiceNumber} · {o.recipient.name??'Referrer'}</span><span className={o.payable?'text-emerald-300':'text-amber-300'}>{o.payable?(o.remainingCommission>0?'Commission payable':'Commission paid'):'Awaiting full Garage receipt'}</span></div><p className="text-white/50 text-xs mt-2">{new Date(o.createdAt).toLocaleDateString()} · Garage balance {formatRM(o.balance)} · Commission {formatRM(o.commission??0)} · Paid {formatRM(o.paid)}</p></button>)}</div>
  </>}
  {order&&<section className="rounded-xl border border-white/15 bg-black/40 p-4 sm:p-5 space-y-4"><h2 className="font-semibold">{order.invoiceNumber}</h2><p className="text-white/60 text-sm">Bill {formatRM(order.total)} · Garage verified {formatRM(order.verified)} · Still due {formatRM(order.balance)}</p>
   {order.releaseAuthorised&&<p className="text-amber-200 text-sm">Used Car release authorised. This does not mark the bill paid.</p>}
   {detail?.release&&<p className="text-white/50 text-xs">{who(detail.release.authorised_by)} · {new Date(detail.release.authorised_at).toLocaleString()} · {detail.release.reason}</p>}
   {(detail?.canReport||detail?.canPay)&&<div className="grid sm:grid-cols-2 gap-3"><label className="text-sm space-y-1"><span>Amount (RM)</span><input type="number" min="0.01" step="0.01" value={amount} disabled={disabled} onChange={e=>setAmount(e.target.value)} className={input}/></label><label className="text-sm space-y-1"><span>Transfer / payout reference</span><input maxLength={180} value={reference} disabled={disabled} onChange={e=>setReference(e.target.value)} className={input}/></label></div>}
   {(detail?.canRelease||detail?.canPay)&&<label className="block text-sm space-y-1"><span>Reason / review note</span><input maxLength={2000} value={note} disabled={disabled} onChange={e=>setNote(e.target.value)} className={input}/></label>}
   {detail?.canReport&&<button disabled={disabled||!amount||!reference.trim()} onClick={()=>prepare('report_transfer',{amount:Number(amount),reference})} className="btn-gold rounded-lg px-4 py-2.5">Record Used Car transfer already sent</button>}
   {detail?.canRelease&&!order.releaseAuthorised&&!order.deliveredAt&&<button disabled={disabled||!note.trim()} onClick={()=>prepare('release',{note})} className="border border-amber-400/30 text-amber-200 rounded-lg px-4 py-2.5">Authorise release before transfer</button>}
   <p className="text-white/40 text-xs">Customer payments made directly to Garage are entered in the work order’s Payment tab. Do not report them again as Used Car transfers.</p>
   <h3 className="text-sm font-semibold">Transfer history</h3>{!detail?.transfers?.length&&<p className="text-white/40 text-sm">No Used Car transfers reported.</p>}
   {detail?.transfers?.map(t=><article key={t.id} className="border border-white/10 rounded-lg p-3 space-y-2 text-sm"><p>{formatRM(t.amount)} · {t.state} · {t.reference}</p><p className="text-white/40 text-xs">{who(t.reported_by)} · {new Date(t.reported_at).toLocaleString()}{t.reviewed_by?` · Reviewed by ${who(t.reviewed_by)}`:''}</p>{t.review_note&&<p className="text-white/50 text-xs">{t.review_note}</p>}{detail.canPay&&t.state==='reported'&&<div className="flex flex-wrap gap-3"><button disabled={disabled} onClick={()=>prepare('accept_transfer',{transferId:t.id})} className="text-emerald-300">Confirm Garage received {formatRM(t.amount)}</button><button disabled={disabled||!note.trim()} onClick={()=>prepare('reject_transfer',{transferId:t.id,note})} className="text-red-300">Reject with reason</button></div>}</article>)}
   <h3 className="text-sm font-semibold">Commission</h3><p className="text-sm text-white/60">{formatRM(order.commission??0)} total · {formatRM(order.paid)} paid · {formatRM(order.remainingCommission)} currently payable</p>
   {detail?.canPay&&order.payable&&order.remainingCommission>0&&<div className="flex flex-wrap gap-3 items-end"><label className="text-sm space-y-1"><span>Actual payout date</span><input type="date" className={input} value={paidOn} disabled={disabled} onChange={e=>setPaidOn(e.target.value)}/></label><button disabled={disabled||!amount||!reference.trim()||!paidOn} onClick={()=>prepare('payout',{amount:Number(amount),reference,paidOn})} className="btn-gold rounded-lg px-4 py-2.5">Record commission already paid</button></div>}
   {detail?.payouts?.map(p=><p key={p.id} className="text-white/50 text-xs">{p.paid_on} · {formatRM(p.amount)} · {p.reference} · {who(p.recorded_by)}</p>)}
  </section>}
  {confirm&&<div role="dialog" aria-label="Confirm referral record" className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-5"><div className="rounded-2xl bg-obsidian-900 border border-white/15 p-6 max-w-md w-full space-y-4"><h2 className="font-semibold">Confirm this record?</h2><p className="text-white/60 text-sm">{confirm.action==='release'?'Authorise early release for this exact Used Car deal. Installation inspections and car-condition checks still apply.':confirm.action==='accept_transfer'?'Confirm the funds have actually reached Garage. This adds one verified receipt to the existing bill.':confirm.action==='payout'?`Record ${formatRM(Number(confirm.data.amount))} commission already paid. This does not send money.`:confirm.action==='report_transfer'?`Report ${formatRM(Number(confirm.data.amount))} already sent by Used Car. Garage must verify receipt.`:'Reject this transfer report with the recorded reason.'}</p><div className="flex gap-3"><button onClick={()=>setConfirm(null)} className="btn-ghost rounded-lg px-4 py-2">Cancel</button><button disabled={busy} onClick={()=>void save(confirm)} className="btn-gold rounded-lg px-4 py-2">Confirm</button></div></div></div>}
 </div>;
 return location.pathname.startsWith('/garage/')?<GarageShell title="Referral settlement" nav>{body}</GarageShell>:body;
}
