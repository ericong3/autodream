import {useEffect,useRef,useState} from 'react';
import GarageShell from '../components/GarageShell';
import {useStore} from '../store';
import {referralAccountRequest,type ReferralAccount} from '../lib/garageReferralAccounts';
export default function GarageReferralAccounts(){
 const user=useStore(s=>s.currentUser),external=useStore(s=>s.externalSalesmen);
 const [rows,setRows]=useState<ReferralAccount[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[link,setLink]=useState(''),[existing,setExisting]=useState('');
 const epoch=useRef(0),lock=useRef(false);
 const load=async(mine:number)=>{try{const r=await referralAccountRequest<{profiles:ReferralAccount[]}>('list');if(epoch.current===mine){setRows(r.profiles);setError('');}}catch(e){if(epoch.current===mine)setError((e as Error).message);}finally{if(epoch.current===mine)setLoading(false);}};
 useEffect(()=>{const mine=++epoch.current;setRows([]);setLink('');setLoading(true);void load(mine);return()=>{epoch.current++;};},[user?.id]);
 async function act(action:string,id?:string){if(lock.current)return;const mine=epoch.current;lock.current=true;setBusy(true);setError('');
  try{const r=await referralAccountRequest<{link?:string}>(action,action==='invite'?(existing?{externalSalesmanId:existing}:{}):{id});if(mine!==epoch.current)return;if(r.link)setLink(r.link);await load(mine);}
  catch(e){if(mine===epoch.current)setError((e as Error).message);}finally{lock.current=false;if(mine===epoch.current)setBusy(false);}
 }
 const allowed=['director','garage_head'].includes(user?.role||'');
 return <GarageShell title="External referral accounts" showBack backTo="/garage/dashboard"><div className="max-w-3xl mx-auto space-y-5">
  <h1 className="font-display text-2xl text-white">External salesmen</h1><p className="text-white/60 text-sm">Invite a salesman to register their commission and tax details. Review their profile after email verification.</p>
  {!allowed?<p className="text-white/60">Garage Head or Director access is required.</p>:<>
   {error&&<p role="alert" className="text-red-200 rounded-xl border border-red-400/30 p-4">{error}</p>}
   <section className="rounded-2xl border border-gold-400/20 p-5 space-y-3"><label className="block text-white text-sm">Link to an existing external salesman<select className="block w-full rounded-xl bg-obsidian-950 border border-white/15 p-3 mt-2" value={existing} onChange={e=>setExisting(e.target.value)}><option value="">New external salesman</option>{external.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button disabled={busy||loading} onClick={()=>act('invite')} className="btn-gold px-4 py-3 rounded-xl disabled:opacity-50">Create registration link</button>
   {link&&<div className="space-y-2"><p className="text-white/60 text-xs">Share this private link with this salesman only. It expires in 7 days.</p><input aria-label="Registration link" className="w-full rounded-xl border border-white/15 bg-black/30 p-3 text-white text-sm" readOnly value={link} onFocus={e=>e.target.select()}/><button className="text-gold-400 text-sm" onClick={()=>navigator.clipboard.writeText(link).catch(()=>setError('Select the link above to copy it.'))}>Copy link</button></div>}
   </section>
   {loading&&<p className="text-white/50">Loading profiles…</p>}
   {!loading&&!error&&!rows.length&&<p className="text-white/50">No external registrations yet.</p>}
   {rows.map(p=><section key={p.id} className="rounded-2xl border border-white/10 p-5 space-y-3"><div className="flex justify-between flex-wrap gap-3"><div><h2 className="text-white font-semibold">{p.profile.legalName||external.find(x=>x.id===p.externalSalesmanId)?.name||'Registration invited'}</h2><p className="text-white/50 text-sm">{p.profile.brand} {p.profile.branch}</p></div><span className={`text-sm ${p.approvedAt&&p.enabled?'text-emerald-300':'text-yellow-300'}`}>{!p.enabled?'Disabled':p.approvedAt?'Approved':p.emailVerifiedAt?'Awaiting approval':p.registeredAt?'Awaiting email verification':'Awaiting registration'}</span></div>
    {p.registeredAt&&<details className="text-sm text-white/70"><summary className="cursor-pointer text-gold-400">Review profile and payment details</summary><dl className="grid sm:grid-cols-2 gap-3 pt-4"><div><dt className="text-white/40">Email</dt><dd>{p.email}</dd></div>{Object.entries(p.profile).map(([key,value])=><div key={key}><dt className="text-white/40">{key.replace(/([A-Z])/g,' $1')}</dt><dd className="break-words">{value}</dd></div>)}</dl></details>}
    {p.enabled&&!p.approvedAt&&p.emailVerifiedAt&&<button disabled={busy} onClick={()=>act('approve',p.id)} className="btn-gold rounded-xl px-4 py-2 disabled:opacity-50">Approve account</button>}
    {p.enabled&&<details><summary className="text-white/40 text-xs cursor-pointer">Account access</summary><button disabled={busy} className="mt-3 text-red-300 text-sm" onClick={()=>act('disable',p.id)}>Disable account and revoke its sessions</button></details>}
    {!p.enabled&&<button disabled={busy} className="text-gold-400 text-sm" onClick={()=>act('enable',p.id)}>Enable account</button>}
   </section>)}
  </>}
 </div></GarageShell>;
}
