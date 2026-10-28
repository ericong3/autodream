import GarageDamagePhotoPicker from './GarageDamagePhotoPicker';
import {prepareDamagePhoto} from '../utils/damagePhoto';
import {useEffect,useRef,useState} from 'react';
import {useStore} from '../store';
import {tintControl} from '../lib/garageTintControl';
type Photo={id:number;name:string;uploaded_by:string;created_at:string};
type Report={id:string;kind:'arrival'|'installation';area:string;description:string;status:'open'|'acknowledged'|'resolved';reported_by:string;created_at:string;reviewed_by?:string;reviewed_at?:string;resolution?:string;photos:Photo[]};
type Snapshot={reportId?:string;invoiceId:string;canReport:boolean;canReview:boolean;openCount:number;reports:Report[]};
async function photoRequest(invoiceId:string,reportId:string,file?:File,photoId?:number){
 let content:string|undefined;if(file){if(file.size>2097152)throw Error('Choose a photo up to 2 MB.');content=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('The photo could not be read.'));reader.readAsDataURL(file);});}
 return tintControl<{attached?:boolean;url?:string}>('damage',file?'upload':'photo',{invoiceId,reportId,...(file?{fileName:file.name,mime:file.type,content}:{photoId})});
}
export default function GarageDamageReports({invoiceId,onChange,onClear}:{invoiceId:string;onChange?:()=>void;onClear?:(clear:boolean)=>void}){
 const user=useStore(s=>s.currentUser),users=useStore(s=>s.users),epoch=useRef(0),callbacks=useRef({onChange,onClear});callbacks.current={onChange,onClear};
 const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false);
 const [kind,setKind]=useState('arrival'),[area,setArea]=useState(''),[description,setDescription]=useState(''),[pending,setPending]=useState<Record<string,unknown>|null>(null);
 const [reviewId,setReviewId]=useState<string|null>(null),[note,setNote]=useState(''),[photoUrl,setPhotoUrl]=useState('');
 const [draftPhotos,setDraftPhotos]=useState<File[]>([]),[preparing,setPreparing]=useState(false);
 const submitBusy=useRef(false);
 const key=`autodream-damage-report:${user?.id}:${invoiceId}`;
 const name=(id?:string)=>users.find(u=>u.id===id)?.name??'Staff member';
 const accept=(next:Snapshot)=>{setData(next);callbacks.current.onClear?.(next.openCount===0);};
 useEffect(()=>{const generation=++epoch.current;setData(null);setError('');setPhotoUrl('');setPending(null);setBusy(false);setBlocked(false);setReviewId(null);setNote('');setArea('');setDescription('');setDraftPhotos([]);setPreparing(false);submitBusy.current=false;callbacks.current.onClear?.(false);
  try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw);if(p?.invoiceId!==invoiceId||typeof p.requestId!=='string')throw Error();setPending(p);}}catch{setBlocked(true);}
  const load=()=>tintControl<Snapshot>('damage','snapshot',{invoiceId}).then(r=>{if(epoch.current===generation){accept(r);setError('');}}).catch(e=>{if(epoch.current===generation){setError(e.message);callbacks.current.onClear?.(false);}});
  void load();const timer=setInterval(load,15000);window.addEventListener('focus',load);return()=>{epoch.current++;clearInterval(timer);window.removeEventListener('focus',load);};
 },[invoiceId,user?.id]);
 const submit=async()=>{if(busy||blocked||preparing||submitBusy.current)return;const generation=epoch.current;submitBusy.current=true;setBusy(true);setError('');let reportSaved=false;try{
  if(!pending&&(!area.trim()||!description.trim()))throw Error('Enter the affected area and what happened.');
  const intent=pending??{invoiceId,kind,area:area.trim(),description:description.trim(),requestId:crypto.randomUUID()};
  if(!pending){localStorage.setItem(key,JSON.stringify(intent));setPending(intent);}
  const r=await tintControl<Snapshot>('damage','create',intent);if(epoch.current!==generation)return;
  reportSaved=true;accept(r);callbacks.current.onChange?.();
  if(draftPhotos.length&&!r.reportId)throw Error('The saved report reference is unavailable. Reload and attach the photos to the saved report.');
  for(const file of draftPhotos){if(epoch.current!==generation)return;await photoRequest(invoiceId,r.reportId!,file);if(epoch.current!==generation)return;setDraftPhotos(previous=>previous.filter(p=>p!==file));}
  if(draftPhotos.length||pending){const latest=await tintControl<Snapshot>('damage','snapshot',{invoiceId});if(epoch.current!==generation)return;accept(latest);}
  localStorage.removeItem(key);setPending(null);setArea('');setDescription('');callbacks.current.onChange?.();
 }catch(e){if(epoch.current===generation){if(!reportSaved&&['INVALID','ORDER_DELIVERED'].includes((e as {code?:string}).code??'')){localStorage.removeItem(key);setPending(null);}setError(reportSaved?'Report saved. Photo upload is incomplete—tap Retry to finish. '+(e as Error).message:(e as Error).message);}}finally{if(epoch.current===generation){submitBusy.current=false;setBusy(false);}}};
 const review=async(reportId:string)=>{if(!note.trim()||busy)return;const generation=epoch.current;setBusy(true);setError('');try{const r=await tintControl<Snapshot>('damage','resolve',{invoiceId,reportId,note:note.trim(),requestId:crypto.randomUUID()});if(generation!==epoch.current)return;accept(r);setReviewId(null);setNote('');callbacks.current.onChange?.();}catch(e){if(generation===epoch.current)setError((e as Error).message);}finally{if(generation===epoch.current)setBusy(false);}};
 return <section aria-label="Damage reports" className="rounded-2xl border border-orange-400/25 bg-black/30 p-5 space-y-4 mb-5">
  <h2 className="text-white font-semibold">Damage reports</h2><p className="text-white/60 text-sm">Add photos and a short description of the damage.</p>
  {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}{blocked&&<p role="alert" className="text-red-300 text-sm">An earlier report could not be read. Ask Garage Head to check before reporting it again.</p>}
  {photoUrl&&<a href={photoUrl} target="_blank" rel="noreferrer" className="block text-gold-300 underline text-sm">Open damage photo (link expires shortly)</a>}
  {!data&&!error&&<p role="status" className="text-white/60 text-sm">Checking damage reports…</p>}
  {data&&<>{data.openCount>0?<p className="text-amber-200 text-sm">{data.openCount} open report{data.openCount===1?'':'s'}. Garage Head must review these before handover.</p>:<p className="text-white/60 text-sm">No open damage reports.</p>}
   {data.canReport&&<div className="text-sm text-white/80"><div className="space-y-3 py-3">
    <GarageDamagePhotoPicker remaining={4-draftPhotos.length} busy={busy||!!pending} onFiles={async files=>{const generation=epoch.current;setPreparing(true);try{const ready:File[]=[];for(const file of files)ready.push(await prepareDamagePhoto(file));if(generation===epoch.current)setDraftPhotos(previous=>[...previous,...ready].slice(0,4));}finally{if(generation===epoch.current)setPreparing(false);}}}/>
    {draftPhotos.length>0&&<ul className="space-y-2">{draftPhotos.map((file,index)=><li key={index} className="flex items-center justify-between gap-3 rounded-lg border border-white/15 p-3 text-sm"><span className="text-white/80">Photo {index+1} · {file.name}</span><button type="button" disabled={busy||!!pending} onClick={()=>setDraftPhotos(previous=>previous.filter((_,i)=>i!==index))} className="min-h-[44px] px-3 text-white/60">Remove</button></li>)}</ul>}
    {pending?<p className="text-amber-200">An earlier report needs confirmation. Retry that same report.</p>:<>
     <label className="block">When did it happen?<select aria-label="Damage report type" value={kind} onChange={e=>setKind(e.target.value)} className="block w-full mt-1 p-3 bg-obsidian-900 border border-white/20 rounded-lg"><option value="arrival">Before work / on arrival</option><option value="installation">During installation</option></select></label>
     <label className="block">Where is the damage?<input placeholder="e.g. Front left door" aria-label="Damage area" maxLength={200} value={area} onChange={e=>setArea(e.target.value)} className="block w-full mt-1 p-3 bg-white/5 border border-white/20 rounded-lg"/></label>
     <label className="block">What happened?<textarea placeholder="Briefly describe the damage" aria-label="Damage description" maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)} className="block w-full mt-1 p-3 bg-white/5 border border-white/20 rounded-lg"/></label>
    </>}
    <button disabled={busy||blocked||preparing} onClick={submit} className="btn-gold rounded-xl px-4 py-3 disabled:opacity-50">{busy?'Saving report and photos…':pending?'Retry':'Save report'}</button>
   </div></div>}
   <div className="space-y-3">{data.reports.map(r=><article key={r.id} className="rounded-xl border border-white/15 p-4 text-sm space-y-2">
    <p className="text-white font-medium">{r.kind==='arrival'?'Present on arrival':'Installation incident'} · {r.area}</p><p className="text-white/80 whitespace-pre-wrap">{r.description}</p><p className="text-white/50 text-xs">Reported by {name(r.reported_by)} · {new Date(r.created_at).toLocaleString('en-MY')}</p>
    <p className={r.status==='open'?'text-amber-200':'text-emerald-300'}>{r.status==='open'?'Awaiting Garage Head review':r.status==='acknowledged'?'Arrival damage acknowledged':'Incident resolved'}</p>
    {r.resolution&&<p className="text-white/70 whitespace-pre-wrap">{r.resolution}<span className="block text-xs text-white/50 mt-1">{name(r.reviewed_by)} · {new Date(r.reviewed_at!).toLocaleString('en-MY')}</span></p>}
    {r.photos.map(p=><button key={p.id} disabled={busy} onClick={async()=>{const generation=epoch.current;try{const result=await photoRequest(invoiceId,r.id,undefined,Number(p.id));if(generation===epoch.current)setPhotoUrl(result.url??'');}catch(e){if(generation===epoch.current)setError((e as Error).message);}}} className="block py-2 text-gold-300 underline">View photo: {p.name}</button>)}
    {data.canReport&&r.status==='open'&&r.photos.length<4&&(r.reported_by===user?.id||data.canReview)&&<GarageDamagePhotoPicker remaining={4-r.photos.length} busy={busy} onFiles={async files=>{
     const generation=epoch.current;setBusy(true);setError('');let failure:unknown;
     try{for(const original of files){if(generation!==epoch.current)return;const file=await prepareDamagePhoto(original);if(generation!==epoch.current)return;await photoRequest(invoiceId,r.id,file);}}
     catch(err){failure=err;}
     finally{if(generation===epoch.current){try{const result=await tintControl<Snapshot>('damage','snapshot',{invoiceId});if(generation===epoch.current){accept(result);callbacks.current.onChange?.();}}catch(err){failure??=err;}if(generation===epoch.current)setBusy(false);}}
     if(failure&&generation===epoch.current)throw failure;
    }}/>}
    {data.canReview&&r.status==='open'&&(reviewId===r.id?<div className="space-y-3"><label className="block text-white/80">Review / resolution outcome<textarea aria-label="Damage review outcome" maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} className="block w-full mt-1 p-3 bg-white/5 border border-white/20 rounded-lg"/></label><button disabled={busy||!note.trim()} onClick={()=>review(r.id)} className="btn-gold px-4 py-3 rounded-lg">{r.kind==='arrival'?'Acknowledge arrival damage':'Mark incident resolved'}</button><button className="ml-4 text-white/60" onClick={()=>setReviewId(null)}>Cancel</button></div>:<button onClick={()=>{setReviewId(r.id);setNote('');}} className="border border-gold-400/30 text-gold-300 rounded-lg px-4 py-3">Review report</button>)}
   </article>)}</div>
  </>}
 </section>;
}
