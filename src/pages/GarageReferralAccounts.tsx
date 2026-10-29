import {useEffect,useRef,useState} from 'react';
import GarageShell from '../components/GarageShell';
import {useStore} from '../store';
import {referralAccountRequest,type ReferralAccount} from '../lib/garageReferralAccounts';
import GarageReferralProfileForm,{type ReferralProfileSave} from '../components/GarageReferralProfileForm';
export default function GarageReferralAccounts(){
 const user=useStore(s=>s.currentUser),external=useStore(s=>s.externalSalesmen);
 const [rows,setRows]=useState<ReferralAccount[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[link,setLink]=useState(''),[existing,setExisting]=useState('');
 const [message,setMessage]=useState('');
 const [editing,setEditing]=useState<ReferralAccount|null>(null);
 const epoch=useRef(0),lock=useRef(false);
 const load=async(mine:number)=>{try{const r=await referralAccountRequest<{profiles:ReferralAccount[]}>('list');if(epoch.current===mine){setRows(r.profiles);setError('');}}catch(e){if(epoch.current===mine)setError((e as Error).message);}finally{if(epoch.current===mine)setLoading(false);}};
 useEffect(()=>{const mine=++epoch.current;lock.current=false;setBusy(false);setExisting('');setRows([]);setLink('');setMessage('');setEditing(null);setLoading(true);void load(mine);return()=>{epoch.current++;};},[user?.id]);
 async function updateProfile(target:ReferralAccount,data:ReferralProfileSave){if(lock.current)throw new Error('Wait for the current profile action to finish.');const mine=epoch.current;lock.current=true;setBusy(true);setError('');
  try{await referralAccountRequest('update_profile',{id:target.id,revision:target.profileRevision,profile:data.profile,requestId:data.requestId,remainAccountless:!target.registeredAt&&!data.createAccount});if(mine!==epoch.current)return;
   if(!target.registeredAt&&!data.createAccount)setLink('');
   setEditing(null);setMessage('Profile updated. Its linked history is unchanged.');await load(mine);
   if(data.createAccount&&!target.registeredAt&&mine===epoch.current){try{const r=await referralAccountRequest<{link:string}>('invite',{profileId:target.id});if(mine===epoch.current)setLink(r.link);}catch(e){if(mine===epoch.current)setError('Profile updated. '+(e as Error).message+' Retry Create account on the same profile.');}}
  }catch(e){if((e as {code?:string}).code==='CONFLICT'&&mine===epoch.current){setEditing(null);await load(mine);setError((e as Error).message);}throw e;}
  finally{if(mine===epoch.current){lock.current=false;setBusy(false);}}
 }
 async function saveProfile(data:ReferralProfileSave){if(lock.current)throw new Error('Wait for the current profile action to finish.');const mine=epoch.current;lock.current=true;setBusy(true);setError('');setLink('');
  try{const r=await referralAccountRequest<{profileId:string}>('create_profile',{profile:data.profile,requestId:data.requestId,...(existing?{externalSalesmanId:existing}:{})});
   if(mine!==epoch.current)return;setExisting('');setMessage('Salesman profile saved.');await load(mine);
   if(data.createAccount&&mine===epoch.current){try{const invited=await referralAccountRequest<{link:string}>('invite',{profileId:r.profileId});if(mine===epoch.current){setLink(invited.link);setMessage('Profile saved. Share the setup link so they can create their account.');}}catch(e){if(mine===epoch.current)setError('Profile saved without a login. '+(e as Error).message+' You can retry Create account on the saved profile.');}}
  }finally{if(mine===epoch.current){lock.current=false;setBusy(false);}}
 }
 async function act(action:string,id?:string){if(lock.current)return;const mine=epoch.current;lock.current=true;setBusy(true);setError('');
  try{const r=await referralAccountRequest<{link?:string}>(action,action==='invite'?{profileId:id}:{id});if(mine!==epoch.current)return;if(r.link)setLink(r.link);if(action==='cancel_invite')setLink('');await load(mine);}
  catch(e){if(mine===epoch.current)setError((e as Error).message);}finally{if(mine===epoch.current){lock.current=false;setBusy(false);}}
 }
 const allowed=['director','garage_head'].includes(user?.role||'');
 const selected=external.find(p=>p.id===existing);
 return <GarageShell title="External salesmen" showBack backTo="/garage/dashboard"><div className="max-w-3xl mx-auto space-y-5">
  <h1 className="font-display text-2xl text-white">External salesmen</h1><p className="text-white/60 text-sm">Save one salesman profile. Choose whether they remain accountless or create a login for the same profile.</p>
  {!allowed?<p className="text-white/60">Garage Head or Director access is required.</p>:<>
   {error&&<p role="alert" className="text-red-200 rounded-xl border border-red-400/30 p-4">{error}</p>}
   {message&&<p role="status" className="text-emerald-200 text-sm">{message}</p>}
   <section className="rounded-2xl border border-gold-400/20 p-5 space-y-5"><label className="block text-white text-sm">Salesman<select disabled={busy||loading} className="block w-full rounded-xl bg-obsidian-950 border border-white/15 p-3 mt-2" value={existing} onChange={e=>setExisting(e.target.value)}><option value="">New external salesman</option>{external.filter(p=>!rows.some(r=>r.externalSalesmanId===p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <GarageReferralProfileForm key={`${user?.id}:${existing}`} staff disabled={busy||loading} initialProfile={selected?{legalName:selected.name,phone:selected.phone,identityNumber:selected.ic,bank:selected.bank,bankAccount:selected.bankAccount}:undefined} onSave={saveProfile}/>
   {link&&<div className="space-y-2"><p className="text-white/60 text-xs">Share this private link with this salesman only. It expires in 7 days.</p><input aria-label="Registration link" className="w-full rounded-xl border border-white/15 bg-black/30 p-3 text-white text-sm" readOnly value={link} onFocus={e=>e.target.select()}/><button className="text-gold-400 text-sm" onClick={()=>navigator.clipboard.writeText(link).catch(()=>setError('Select the link above to copy it.'))}>Copy link</button></div>}
   </section>
   {loading&&<p className="text-white/50">Loading profiles…</p>}
   {!loading&&!error&&!rows.length&&<p className="text-white/50">No external salesman profiles yet.</p>}
   {rows.map(p=><section key={p.id} className="rounded-2xl border border-white/10 p-5 space-y-3"><div className="flex justify-between flex-wrap gap-3"><div><h2 className="text-white font-semibold">{p.profile.legalName||external.find(x=>x.id===p.externalSalesmanId)?.name||'Setup invited'}</h2><p className="text-white/50 text-sm">{p.profile.brand} {p.profile.branch}</p></div><span className={`text-sm ${!p.registeredAt||p.approvedAt&&p.enabled?'text-emerald-300':'text-yellow-300'}`}>{!p.registeredAt?'Accountless':!p.enabled?'Login disabled':p.approvedAt?'Account ready':p.emailVerifiedAt?'Account approval pending':'Email verification pending'}</span></div>
    {p.profileSavedAt&&<><p className="text-white/50 text-xs">{p.profileApprovedAt?'Profile ready':'Profile review pending'}{p.hasInvite?' · Account setup link pending':''}</p><details className="text-sm text-white/70"><summary className="cursor-pointer text-gold-400">Profile & payment details</summary><dl className="grid sm:grid-cols-2 gap-3 pt-4">{p.email&&<div><dt className="text-white/40">Login email</dt><dd>{p.email}</dd></div>}{Object.entries(p.profile).map(([key,value])=><div key={key}><dt className="text-white/40">{key.replace(/([A-Z])/g,' $1')}</dt><dd className="break-words">{value||'—'}</dd></div>)}</dl></details></>}
    {p.profileSavedAt&&editing?.id!==p.id&&<button disabled={busy} className="text-white/60 text-sm" onClick={()=>setEditing(p)}>Edit profile</button>}
    {editing?.id===p.id&&<div className="border-t border-white/10 pt-4 space-y-3"><GarageReferralProfileForm key={`${editing.id}:${editing.profileRevision}`} staff hasAccount={!!editing.registeredAt} disabled={busy} initialProfile={editing.profile} onSave={data=>updateProfile(editing,data)}/><button disabled={busy} className="text-white/50 text-sm" onClick={()=>setEditing(null)}>Cancel editing</button></div>}
    {p.enabled&&p.profileSavedAt&&(!p.profileApprovedAt||p.registeredAt&&!p.approvedAt)&&(!p.registeredAt||p.emailVerifiedAt)&&<button disabled={busy} onClick={()=>act('approve',p.id)} className="btn-gold rounded-xl px-4 py-2 disabled:opacity-50">{p.registeredAt?'Approve account':'Approve profile'}</button>}
    {p.enabled&&!p.registeredAt&&p.profileSavedAt&&<button disabled={busy} className="text-gold-400 text-sm" onClick={()=>act('invite',p.id)}>{p.hasInvite?'New account setup link':'Create account'}</button>}
    {p.hasInvite&&!p.registeredAt&&<button disabled={busy} className="text-white/50 text-sm ml-4" onClick={()=>act('cancel_invite',p.id)}>Remain accountless</button>}
    {p.enabled&&p.registeredAt&&<details><summary className="text-white/40 text-xs cursor-pointer">Account access</summary><button disabled={busy} className="mt-3 text-red-300 text-sm" onClick={()=>act('disable',p.id)}>Disable login and revoke its sessions</button></details>}
    {!p.enabled&&p.registeredAt&&<button disabled={busy} className="text-gold-400 text-sm" onClick={()=>act('enable',p.id)}>Enable login</button>}
   </section>)}
  </>}
 </div></GarageShell>;
}
