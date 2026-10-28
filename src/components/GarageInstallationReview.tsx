import {useEffect,useRef,useState} from 'react';
import {useStore} from '../store';
import {installationSnapshot,installationMutation,type InstallationSnapshot} from '../lib/garageInstallationReview';
import type {GarageTintWorkOrderItem} from '../types';
import {GLASS_LABEL} from '../utils/tintPricing';
const labels={working:'Installers working',head:'Garage Head inspection',sales:'Salesman final inspection',correction_review:'Garage Head: correction requested',ready:'Both inspections passed'};
export default function GarageInstallationReview({invoiceId,ownerId,items,onChange,onReady,viewStage}:{invoiceId:string;ownerId?:string;items:GarageTintWorkOrderItem[];onChange?:()=>void;onReady?:(ready:boolean)=>void;viewStage?:string}){
 const user=useStore(s=>s.currentUser),users=useStore(s=>s.users);
 const [data,setData]=useState<InstallationSnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[checked,setChecked]=useState(false),[reason,setReason]=useState(''),[selected,setSelected]=useState<string[]>([]),[replacement,setReplacement]=useState(false);
 const itemVersion=items.map(i=>[i.id,i.status,i.installerId,i.sqft,i.remark,i.needsCorrection,i.completedAt].join(':')).join('|');
 const lastRevision=useRef<number|null>(null);
 const generation=useRef(0),callbacks=useRef({onChange,onReady});callbacks.current={onChange,onReady};
 useEffect(()=>{const epoch=++generation.current;lastRevision.current=null;setData(null);setChecked(false);setError('');callbacks.current.onReady?.(false);
  const load=()=>installationSnapshot({invoiceId}).then(r=>{if(epoch!==generation.current)return;const changed=lastRevision.current!==null&&lastRevision.current!==r.review.revision;lastRevision.current=r.review.revision;setData(r);if(changed)callbacks.current.onChange?.();callbacks.current.onReady?.(r.review.state==='ready');}).catch(e=>{if(epoch===generation.current)setError(e.message);});
  void load();const timer=setInterval(load,15000);window.addEventListener('focus',load);return()=>{generation.current++;clearInterval(timer);window.removeEventListener('focus',load);};
 },[invoiceId,user?.id,itemVersion]);
 useEffect(()=>{setChecked(false);setSelected([]);},[data?.review.revision]);
 const perform=async(action:string,extra:Record<string,unknown>={})=>{if(!data)return;const epoch=generation.current;setBusy(true);setError('');try{const r=await installationMutation(action,{invoiceId},extra,data.review.revision);if(epoch!==generation.current)return;lastRevision.current=r.review.revision;setData(r);setChecked(false);setReason('');setSelected([]);callbacks.current.onReady?.(r.review.state==='ready');callbacks.current.onChange?.();}catch(e){if(epoch===generation.current)setError((e as Error).message);}finally{if(epoch===generation.current)setBusy(false);}};
 const showInstallation=!viewStage||viewStage==='installation',showApproval=!viewStage||viewStage==='approval',showInspection=!viewStage||viewStage==='inspection';
 const w=data?.review,own=items.filter(i=>!['door_window','rear_panel_window'].includes(i.glassPosition)&&i.installerId===user?.id),workers=[...new Set(items.filter(i=>!['door_window','rear_panel_window'].includes(i.glassPosition)).map(i=>i.installerId).filter(Boolean))];
 const headTurn=user?.role==='garage_head'&&['head','correction_review'].includes(w?.state??'');
 const name=(id?:string)=>users.find(u=>u.id===id)?.name??'Team member';
 return <section className="rounded-2xl border border-gold-400/25 bg-black/30 p-5 space-y-4" aria-label="Installation checks">
  <h2 className="text-white font-semibold">{viewStage==='installation'?'Installer confirmation':viewStage==='approval'?'Garage Head inspection':viewStage==='inspection'?'Salesman final inspection':w?labels[w.state]:'Loading installation checks…'}</h2>
  {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}
  {viewStage&&w&&<p className="text-white/60 text-sm">Current check status: {labels[w.state]}</p>}
  {w?.reason&&<p className="text-orange-200 text-sm">{w.reason}</p>}
  {showInstallation&&w?.state==='working'&&<><p className="text-white/60 text-sm">Each installer confirms their own work. Once everyone confirms, this goes to Garage Head automatically.</p>
   <div className="flex flex-wrap gap-2">{workers.map(id=><span key={id} className="text-xs rounded-lg border border-white/10 px-3 py-2 text-white/70">{name(id)} · {w.confirmations[id!]?'Confirmed':'Not confirmed'}</span>)}</div>
   {own.length>0&&!w.confirmations[user!.id]&&<button disabled={busy||own.some(i=>i.status!=='installed')} onClick={()=>perform('confirm')} className="btn-gold px-4 py-3 rounded-xl disabled:opacity-40">Confirm my work</button>}
   {own.some(i=>i.status!=='installed')&&<p className="text-xs text-white/50">Finish your own pieces before confirming.</p>}
  </>}
  {showApproval&&w?.state==='head'&&user?.role!=='garage_head'&&<p className="text-white/60 text-sm">Waiting for Garage Head to inspect and approve.</p>}
  {showInspection&&w?.state==='sales'&&<p className="text-white/60 text-sm">Garage Head has approved. The salesman handling this order must check the finished work before handover.</p>}
  {((showApproval&&w?.state==='head'&&user?.role==='garage_head')||(showInspection&&w?.state==='sales'&&user?.id===ownerId))&&<>
   <label className="flex gap-3 items-start text-white/80 text-sm"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} className="mt-1"/>I checked the finished work and it is satisfactory.</label>
   <button disabled={busy||!checked} onClick={()=>perform(w.state==='head'?'head_approve':'sales_approve',{value:true})} className="btn-gold px-4 py-3 rounded-xl disabled:opacity-40">{w.state==='head'?'Approve workshop work':'Pass final inspection'}</button>
  </>}
  {((showApproval&&user?.role==='garage_head'&&['head','correction_review'].includes(w?.state??''))||(showInspection&&w?.state==='sales'&&user?.id===ownerId))&&<div className="space-y-3 border-t border-white/10 pt-4">
   <p className="text-white/80 text-sm">{headTurn?'Return pieces to their original installers':'Found a problem? Send it to Garage Head.'}</p>
   <textarea aria-label="Inspection issue" placeholder="What needs fixing?" value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000} className="w-full rounded-xl bg-white/5 border border-white/15 p-3 text-white text-sm"/>
   {headTurn&&<><label className="flex gap-2 text-sm text-white/70"><input type="checkbox" checked={replacement} onChange={e=>setReplacement(e.target.checked)}/>Replacement needed</label>
   {items.filter(i=>i.installerId).map(i=><label key={i.id} className="flex gap-2 text-sm text-white/70"><input type="checkbox" checked={selected.includes(i.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,i.id]:old.filter(id=>id!==i.id))}/>{GLASS_LABEL[i.glassPosition]??i.glassPosition} · {name(i.installerId)}</label>)}</>}
   <button disabled={busy||!reason.trim()||(headTurn&&!selected.length)} onClick={()=>perform(headTurn?'head_return':'sales_return',{reason:reason.trim(),...(headTurn?{itemIds:selected,value:replacement?'replacement':'correction'}:{})})} className="border border-orange-400/40 text-orange-200 rounded-xl px-4 py-3 text-sm disabled:opacity-40">{headTurn?'Return to original installer':'Send to Garage Head'}</button>
  </div>}
  {w?.state==='ready'&&<p className="text-emerald-300 text-sm">{w.sales_at?'Garage Head and salesman checks recorded. Payment must be cleared before delivery.':'Previously delivered order. Historical checks are unchanged.'}</p>}
  {!!data?.history?.length&&<details className="text-xs text-white/50"><summary className="cursor-pointer">Check history</summary><div className="space-y-2 mt-3">{data.history.map(e=><p key={e.id}>{new Date(e.created_at).toLocaleString('en-MY')} · {name(e.actor_id)} · {e.action.replace(/_/g,' ')}{e.details.reason?` · ${e.details.reason}`:''}</p>)}</div></details>}
 </section>;
}
