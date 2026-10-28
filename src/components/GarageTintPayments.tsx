import {useEffect,useState} from 'react';
import {useStore} from '../store';
import {tintControl,paymentProof,type TintMoney} from '../lib/garageTintControl';
import {formatRM} from '../utils/format';
export default function GarageTintPayments({invoiceId,onChange}:{invoiceId:string;onChange?:()=>void}){
 const user=useStore(s=>s.currentUser),users=useStore(s=>s.users);
 const [money,setMoney]=useState<TintMoney|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [amount,setAmount]=useState(''),[method,setMethod]=useState('cash'),[reference,setReference]=useState('');
 const [pending,setPending]=useState<Record<string,unknown>|null>(null);
 const [blocked,setBlocked]=useState(false),[rejecting,setRejecting]=useState<string|null>(null),[reviewNote,setReviewNote]=useState(''),[proofUrl,setProofUrl]=useState('');
 const storageKey=`autodream-tint-payment:${user?.id}:${invoiceId}`;
 const name=(id?:string)=>users.find(u=>u.id===id)?.name??'Staff member';
 const refresh=()=>tintControl<TintMoney>('finance','snapshot',{invoiceId}).then(setMoney);
 useEffect(()=>{let active=true;setMoney(null);setError('');setPending(null);
  setBlocked(false);try{const raw=localStorage.getItem(storageKey);if(raw){const p=JSON.parse(raw);if(!p||p.invoiceId!==invoiceId||typeof p.requestId!=='string')throw Error();setPending(p);}}catch{setBlocked(true);}
  const load=()=>tintControl<TintMoney>('finance','snapshot',{invoiceId}).then(r=>{if(active){setMoney(r);setError('');}}).catch(e=>{if(active)setError(e.message);});
  void load();const timer=setInterval(load,15000);return()=>{active=false;clearInterval(timer);};
 },[invoiceId,user?.id]);
 const record=async()=>{
  if(busy||blocked)return;setBusy(true);setError('');
  try{
   const value=Number(amount);
   if(!pending&&(!Number.isFinite(value)||value<=0||!Number.isInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>0.00001||value>(money?.toCollect??0)))throw new Error('Enter an amount within the balance still to collect, with at most two decimal places.');
   const intent=pending??{invoiceId,amount:value,method,reference:reference.trim(),requestId:crypto.randomUUID()};
   if(!pending){localStorage.setItem(storageKey,JSON.stringify(intent));setPending(intent);}
   await tintControl<TintMoney>('finance','record',intent);
   localStorage.removeItem(storageKey);setPending(null);setAmount('');setReference('');await refresh();onChange?.();
  }catch(e){if(['INVALID','PAYMENT_EXCEEDS_BALANCE','ORDER_DELIVERED'].includes((e as {code?:string}).code??'')){localStorage.removeItem(storageKey);setPending(null);}setError((e as Error).message);}finally{setBusy(false);}
 };
 const review=async(paymentId:string,action:'verify'|'reject'|'void')=>{
  if(action!=='verify'&&!reviewNote.trim())return;
  setBusy(true);setError('');try{await tintControl('finance',action,{invoiceId,paymentId,note:action!=='verify'?reviewNote:'',requestId:crypto.randomUUID()});setRejecting(null);setReviewNote('');await refresh();onChange?.();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 return <section aria-label="Payment tracking" className="rounded-2xl border border-gold-400/20 bg-black/30 p-5 space-y-4">
  <h2 className="text-white font-semibold">Payments & company receipt</h2>
  {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}
  {blocked&&<p role="alert" className="text-red-300 text-sm">A previous payment entry could not be read. Ask a director to check before collecting again.</p>}
  {proofUrl&&<a className="text-gold-300 underline text-sm" href={proofUrl} target="_blank" rel="noreferrer">Open payment proof (link expires shortly)</a>}
  {money&&<>
   <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">{[['Order total',money.total],['Collected from customer',money.collected],['Company verified',money.verified],['Still to collect',money.toCollect]].map(([label,value])=><div key={String(label)}><p className="text-white/50 text-xs">{label}</p><p className="text-white mt-1">{formatRM(Number(value))}</p></div>)}</div>
   {money.awaitingVerification>0&&<p className="text-amber-200 text-sm">{formatRM(money.awaitingVerification)} collected, awaiting director/admin verification. Do not collect this amount from the customer again.</p>}
   <p className="text-white/50 text-xs">Handover requires all {formatRM(money.total)} to be company-verified, plus both inspections.</p>
   {(money.toCollect>0||pending)&&<div className="border-t border-white/10 pt-4 space-y-3">
    {pending?<p className="text-amber-200 text-sm">An earlier payment entry needs confirmation. Retry that same entry before recording another payment.</p>:<div className="grid sm:grid-cols-3 gap-3">
     <label className="text-sm text-white/70">Amount received (RM)<input aria-label="Payment amount received" type="number" min="0.01" step="0.01" max={money.toCollect} value={amount} onChange={e=>setAmount(e.target.value)} className="w-full mt-1 bg-white/5 border border-white/20 rounded-lg p-3 text-white"/></label>
     <label className="text-sm text-white/70">Method<select aria-label="Payment collection method" value={method} onChange={e=>setMethod(e.target.value)} className="w-full mt-1 bg-obsidian-900 border border-white/20 rounded-lg p-3 text-white">{['cash','card','transfer','installment'].map(m=><option key={m}>{m}</option>)}</select></label>
     <label className="text-sm text-white/70">Reference / note<input aria-label="Payment reference" maxLength={200} value={reference} onChange={e=>setReference(e.target.value)} className="w-full mt-1 bg-white/5 border border-white/20 rounded-lg p-3 text-white"/></label>
    </div>}
    <button disabled={busy||blocked} onClick={record} className="btn-gold rounded-xl px-4 py-3 text-sm disabled:opacity-50">{busy?'Checking…':pending?'Retry saved payment entry':'Record money received'}</button>
   </div>}
   <div className="space-y-3">{money.payments.map(p=><article key={p.id} className="border border-white/10 rounded-xl p-4 text-sm space-y-2">
    <p className="text-white">{formatRM(Number(p.amount))} · {p.method} · <span className={p.state==='verified'?'text-emerald-300':p.state==='rejected'?'text-red-300':'text-amber-200'}>{p.state==='pending'?'Awaiting company verification':p.state==='rejected'?'Not received — investigate':p.state==='voided'?'Incorrect entry cancelled':p.state}</span></p>
    <p className="text-white/50 text-xs">Recorded by {name(p.recorded_by)} · {new Date(p.received_at).toLocaleString('en-MY')}{p.reference?` · ${p.reference}`:''}</p>
    {p.reviewed_by&&<p className="text-white/50 text-xs">Reviewed by {name(p.reviewed_by)} · {new Date(p.reviewed_at!).toLocaleString('en-MY')}{p.review_note?` · ${p.review_note}`:''}</p>}
    {p.receipt_path?<button className="text-gold-300 text-xs" onClick={async()=>{try{setProofUrl((await paymentProof(invoiceId,p.id)).url??'');}catch(e){setError((e as Error).message);}}}>Prepare proof link</button>:(p.state==='pending'||p.state==='rejected'||p.state==='verified')&&(p.recorded_by===user?.id||money.canVerify)&&<label className="block text-gold-300 text-xs">Attach proof (JPEG, PNG, WebP or PDF, max 2 MB)<input aria-label="Payment proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setBusy(true);try{await paymentProof(invoiceId,p.id,file);await refresh();}catch(err){setError((err as Error).message);}finally{setBusy(false);}}} className="block mt-2"/></label>}
    {money.canVerify&&(p.state==='pending'||p.state==='rejected')&&(rejecting===p.id?<div className="space-y-2"><textarea aria-label="Reason for investigation or cancelling an incorrect entry" maxLength={2000} value={reviewNote} onChange={e=>setReviewNote(e.target.value)} className="bg-white/5 border border-white/20 rounded-lg p-3 w-full text-white"/><button disabled={busy||!reviewNote.trim()} onClick={()=>review(p.id,'reject')} className="text-red-300">Confirm not received</button><p className="text-white/60 text-xs">Cancel an incorrect entry only when no customer money was collected; it reopens the balance to collect.</p><button disabled={busy||!reviewNote.trim()} onClick={()=>review(p.id,'void')} className="text-red-300 ml-4">Cancel incorrect entry</button><button className="text-white/50 ml-4" onClick={()=>setRejecting(null)}>Cancel</button></div>:<div className="flex gap-3"><button disabled={busy} onClick={()=>review(p.id,'verify')} className="text-emerald-300 border border-emerald-400/30 rounded-lg px-3 py-2">Confirm company received</button><button disabled={busy} onClick={()=>{setRejecting(p.id);setReviewNote('');}} className="text-red-300 border border-red-400/30 rounded-lg px-3 py-2">Not received</button></div>)}
   </article>)}</div>
  </>}
 </section>;
}
