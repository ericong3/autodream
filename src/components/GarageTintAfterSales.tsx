import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {tintControl} from '../lib/garageTintControl';
import {useStore} from '../store';
import {GLASS_LABEL} from '../utils/tintPricing';
import type {GarageInvoiceClaim} from '../types';
type Rework={id:string;invoice_id:string;source_invoice_id:string;invoice_number:string;kind:string;reason:string;claim_id?:string;delivered_at?:string};
type Snapshot={delivered:boolean;items:{id:string;position:string;series:string;vlt:string}[];reworks:Rework[];source:Rework|null};
const labels:Record<string,string>={warranty:'Warranty claim · supplier cost',replacement:'Company replacement',paid:'Customer-paid replacement'};
export default function GarageTintAfterSales({invoiceId,claims,onChange}:{invoiceId:string;claims:GarageInvoiceClaim[];onChange:()=>void}){
 const user=useStore(s=>s.currentUser),storageKey=`autodream-after-sales:${user?.id}:${invoiceId}`;
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false);
 const [kind,setKind]=useState('warranty'),[selected,setSelected]=useState<string[]>([]),[reason,setReason]=useState(''),[amount,setAmount]=useState('');
 const [pending,setPending]=useState<Record<string,unknown>|null>(null);
 const refresh=()=>tintControl<Snapshot>('claims','snapshot',{invoiceId}).then(setSnapshot);
 useEffect(()=>{let active=true;setSnapshot(null);setPending(null);setBlocked(false);setError('');setSelected([]);setReason('');setAmount('');
  try{const raw=localStorage.getItem(storageKey);if(raw){const p=JSON.parse(raw);if(p?.invoiceId!==invoiceId||typeof p.requestId!=='string'||!Array.isArray(p.itemIds))throw Error();setPending(p);}}catch{setBlocked(true);}
  tintControl<Snapshot>('claims','snapshot',{invoiceId}).then(r=>{if(active)setSnapshot(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[invoiceId,user?.id]);
 const submit=async()=>{if(busy||blocked)return;setBusy(true);setError('');try{
  const value=kind==='paid'?Number(amount):0;
  if(!pending&&(!reason.trim()||!selected.length||!Number.isFinite(value)||(kind==='paid'&&value<=0)||Math.abs(value*100-Math.round(value*100))>0.00001))throw Error('Choose the glass, enter a reason and check the agreed price.');
  const intent=pending??{invoiceId,kind,reason:reason.trim(),itemIds:selected,amount:value,requestId:crypto.randomUUID()};
  if(!pending){localStorage.setItem(storageKey,JSON.stringify(intent));setPending(intent);}
  await tintControl('claims','create',intent);localStorage.removeItem(storageKey);setPending(null);setSelected([]);setReason('');setAmount('');await refresh();onChange();
 }catch(e){if(['INVALID','REASON_REQUIRED','DELIVERY_REQUIRED','REPLACEMENT_OPEN'].includes((e as {code?:string}).code??'')){localStorage.removeItem(storageKey);setPending(null);}setError((e as Error).message);}finally{setBusy(false);}};
 const legacy=claims.filter(c=>!snapshot?.reworks.some(r=>r.claim_id===c.id));
 return <section aria-label="After-sales claims" className="rounded-[24px] p-6 bg-white/[0.04] border border-gold-400/15 space-y-4">
  <h3 className="text-white font-semibold">After-sales · warranty & replacements</h3>
  {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}
  {blocked&&<p role="alert" className="text-red-300 text-sm">An earlier claim could not be read. Ask a manager to check the purchase history before submitting again.</p>}
  {snapshot?.source&&<p className="text-white/70 text-sm">{labels[snapshot.source.kind]} for <Link className="text-gold-300 underline" to={`/garage/invoice/${snapshot.source.source_invoice_id}`}>{snapshot.source.invoice_number}</Link> · {snapshot.source.reason}</p>}
  {snapshot?.delivered?<div className="space-y-4 border-t border-white/10 pt-4">
   <p className="text-white/60 text-sm">Choose the affected glass from this past purchase. Submitting creates a linked installer job with fresh usage and inspections.</p>
   {pending?<p className="text-amber-200 text-sm">An earlier claim needs confirmation. Retry that same claim before starting another.</p>:<>
    <label className="block text-white/70 text-sm">Claim or replacement type<select aria-label="After-sales type" value={kind} onChange={e=>setKind(e.target.value)} className="block mt-2 p-3 rounded-lg w-full bg-obsidian-900 border border-white/20">{Object.entries(labels).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label>
    <fieldset className="space-y-2"><legend className="text-white/70 text-sm mb-2">Affected glass</legend>{snapshot.items.map(p=><label key={p.id} className="flex items-center gap-3 min-h-11 text-white/80 text-sm"><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>setSelected(s=>e.target.checked?[...s,p.id]:s.filter(id=>id!==p.id))}/>{GLASS_LABEL[p.position as keyof typeof GLASS_LABEL]??p.position.replace(/_/g,' ')} · {p.series} · {p.vlt}</label>)}</fieldset>
    <label className="block text-white/70 text-sm">Reason (required)<textarea aria-label="After-sales reason" maxLength={1800} value={reason} onChange={e=>setReason(e.target.value)} className="block mt-2 p-3 rounded-lg w-full bg-white/5 border border-white/20"/></label>
    {kind==='paid'?<label className="block text-white/70 text-sm">Agreed replacement price (RM)<input aria-label="Replacement price" type="number" min="0.01" max="10000000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} className="block mt-2 p-3 rounded-lg w-full bg-white/5 border border-white/20"/></label>:<p className="text-white/50 text-sm">No customer charge. {kind==='warranty'?'Cost is borne by the supplier.':'Cost is borne by the company.'} Film usage still reduces stock.</p>}
   </>}
   <button disabled={busy||blocked||(!pending&&(!reason.trim()||!selected.length))} onClick={submit} className="btn-gold rounded-xl px-4 py-3 text-sm disabled:opacity-50">{busy?'Checking…':pending?'Retry saved claim':'Submit & create replacement job'}</button>
  </div>:snapshot&&<p className="text-white/50 text-sm">After-sales claims become available after this order is delivered.</p>}
  {snapshot?.reworks.map(r=><article key={r.id} className="rounded-xl border border-white/15 p-4 text-sm space-y-2"><p className="text-white">{labels[r.kind]} · {r.delivered_at?'Delivered':'In progress'}</p><p className="text-white/70">{r.reason}</p><Link to={`/garage/invoice/${r.invoice_id}`} className="inline-block text-gold-300 underline py-2">Open replacement job {r.invoice_number}</Link></article>)}
  {legacy.map(c=><article key={c.id} className="text-white/60 text-sm border border-white/10 rounded-xl p-4"><p>{labels[c.type]} · {new Date(c.createdAt).toLocaleDateString('en-MY')}</p><p>{c.reason}</p><p className="text-amber-200 mt-2">Earlier claim record. No linked replacement job is recorded.</p></article>)}
 </section>;
}
