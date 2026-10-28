import {useEffect,useRef,useState} from 'react';
import Modal from './Modal';
import GarageDamagePhotoPicker from './GarageDamagePhotoPicker';
import {photoRequest} from './GarageDamageReports';
import {prepareDamagePhoto} from '../utils/damagePhoto';
import {tintControl} from '../lib/garageTintControl';
import {useStore} from '../store';
import type {GarageWorkStatus} from '../types';

type Photo={id:number;name:string;uploaded_by:string;created_at:string};
type Entry={id:string;area:string;description:string;kind:string;status:string;reported_by:string;created_at:string;photos:Photo[];resolution?:string;reviewed_by?:string;reviewed_at?:string};
type Snapshot={reportId?:string;canReport:boolean;canReview:boolean;unlimitedPhotos?:boolean;openCount:number;reports:Entry[]};
type Intent={invoiceId:string;area:string;kind:string;description:string;requestId:string};
const areas=['Front windscreen','Rear windscreen','Front left window','Front right window','Rear left window','Rear right window','Front bumper','Rear bumper','Bonnet','Boot','Roof','Front left door','Front right door','Rear left door','Rear right door','Left body panel','Right body panel','Interior','Other'];
const time=(value:string)=>new Date(value).toLocaleString('en-MY');

function ConditionPhoto({invoiceId,entryId,photo,name}:{invoiceId:string;entryId:string;photo:Photo;name:(id:string)=>string}){
 const [url,setUrl]=useState(''),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setFailed(false);photoRequest(invoiceId,entryId,undefined,Number(photo.id)).then(r=>{if(active)setUrl(r.url??'');}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[invoiceId,entryId,photo.id,retry]);
 return <figure className="min-w-0 space-y-2">
  {url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Car condition: ${photo.name}`} loading="lazy" onError={()=>{setUrl('');setFailed(true);}} className="w-full aspect-square rounded-xl object-cover border border-white/15"/></a>:<button type="button" disabled={!failed} onClick={()=>setRetry(n=>n+1)} className="w-full aspect-square rounded-xl border border-white/15 text-white/60 text-sm">{failed?'Retry photo':'Loading photo…'}</button>}
  <figcaption className="text-xs text-white/50">{name(photo.uploaded_by)} · {time(photo.created_at)}</figcaption>
 </figure>;
}
function ConditionEntry({entry,invoiceId,name,canReview,canAttach,busy,onReview,onAddPhotos}:{entry:Entry;invoiceId:string;name:(id:string)=>string;canReview:boolean;canAttach:boolean;busy:boolean;onAddPhotos:(files:File[])=>Promise<void>;onReview:(id:string,note:string)=>Promise<void>}){
 const [photoLimit,setPhotoLimit]=useState(6),[review,setReview]=useState(false),[note,setNote]=useState('');
 return <article className="rounded-2xl border border-white/15 p-4 space-y-3">
  <div className="flex justify-between gap-3 flex-wrap"><h3 className="font-semibold text-white">{entry.area}</h3><span className={entry.status==='open'?'text-amber-200 text-xs':'text-emerald-300 text-xs'}>{entry.status==='open'?'Needs review':'Reviewed'}</span></div>
  <p className="text-white/60 text-xs">{name(entry.reported_by)} · {time(entry.created_at)} · {entry.kind==='arrival'?'Before work':'During work'}</p>
  {entry.description!=='Car condition photos'&&entry.description!=='Car condition photo entry'&&<p className="text-white/70 text-sm whitespace-pre-wrap">{entry.description}</p>}
  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{entry.photos.slice(0,photoLimit).map(photo=><ConditionPhoto key={photo.id} invoiceId={invoiceId} entryId={entry.id} photo={photo} name={name}/>)}</div>
  {!entry.photos.length&&<p className="text-white/50 text-sm">No photos attached yet.</p>}
  {entry.photos.length>photoLimit&&<button type="button" onClick={()=>setPhotoLimit(n=>n+6)} className="min-h-[44px] px-3 text-gold-300 text-sm">Show more photos ({entry.photos.length-photoLimit})</button>}
  {canAttach&&entry.status==='open'&&<details><summary className="cursor-pointer min-h-[44px] py-3 text-gold-300 text-sm">Add photos</summary><GarageDamagePhotoPicker busy={busy} onFiles={onAddPhotos}/></details>}
  {entry.resolution&&<p className="text-white/60 text-sm">{entry.resolution}<span className="block text-xs mt-1">Reviewed by {name(entry.reviewed_by!)} · {time(entry.reviewed_at!)}</span></p>}
  {canReview&&entry.status==='open'&&(review?<div className="space-y-3 border-t border-white/10 pt-3"><label className="block text-white/70 text-sm">Review outcome<textarea aria-label="Condition review outcome" maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} className="block w-full mt-2 rounded-xl bg-white/5 border border-white/20 p-3 text-white"/></label><button type="button" disabled={busy||!note.trim()} onClick={async()=>{try{await onReview(entry.id,note);setReview(false);}catch{/* Parent shows the error. */}}} className="btn-gold min-h-[44px] px-4 py-3 rounded-xl disabled:opacity-40">Save review</button><button type="button" disabled={busy} onClick={()=>setReview(false)} className="min-h-[44px] px-4 text-white/60">Cancel</button></div>:<button type="button" disabled={busy} onClick={()=>setReview(true)} className="min-h-[44px] px-4 py-3 border border-white/20 rounded-xl text-gold-300 text-sm">Review entry</button>)}
 </article>;
}

export default function GarageCarCondition({invoiceId,workStatus,onChange,onClear}:{invoiceId:string;workStatus:GarageWorkStatus;onChange:()=>void;onClear:(clear:boolean)=>void}){
 const user=useStore(s=>s.currentUser),users=useStore(s=>s.users);
 const [open,setOpen]=useState(false),[adding,setAdding]=useState(false),[data,setData]=useState<Snapshot|null>(null),[error,setError]=useState('');
 const [area,setArea]=useState(''),[photos,setPhotos]=useState<File[]>([]),[pending,setPending]=useState<Intent|null>(null),[busy,setBusy]=useState(false),[preparing,setPreparing]=useState(false),[blocked,setBlocked]=useState(false),[entryLimit,setEntryLimit]=useState(10);
 const epoch=useRef(0),running=useRef(false),preparingRef=useRef(false),callbacks=useRef({onChange,onClear});callbacks.current={onChange,onClear};
 const storageKey=`autodream-car-condition:${user?.id}:${invoiceId}`,legacyKey=`autodream-damage-report:${user?.id}:${invoiceId}`;
 const name=(id:string)=>users.find(u=>u.id===id)?.name??id??'Staff member';
 const accept=(snapshot:Snapshot)=>{setData(snapshot);callbacks.current.onClear(snapshot.openCount===0);};
 useEffect(()=>{const generation=++epoch.current;setOpen(false);setAdding(false);setData(null);setArea('');setPhotos([]);setPending(null);setError('');setBusy(false);setPreparing(false);setBlocked(false);running.current=false;preparingRef.current=false;callbacks.current.onClear(false);
  try{const raw=localStorage.getItem(storageKey)??localStorage.getItem(legacyKey);if(raw){const intent=JSON.parse(raw);if(intent.invoiceId!==invoiceId||typeof intent.requestId!=='string')throw Error();setPending(intent);setAdding(true);}}catch{setBlocked(true);setError('An earlier entry needs checking before another is saved.');}
  const refresh=()=>tintControl<Snapshot>('damage','snapshot',{invoiceId}).then(snapshot=>{if(epoch.current===generation)accept(snapshot);}).catch(()=>{if(epoch.current===generation){callbacks.current.onClear(false);setError('Could not load car condition. Try opening it again.');}});
  void refresh();const timer=setInterval(refresh,15000);return()=>{epoch.current++;clearInterval(timer);};
 },[invoiceId,user?.id]);
 const pick=async(files:File[])=>{if(running.current||preparingRef.current)return;const generation=epoch.current;preparingRef.current=true;setPreparing(true);try{const ready:File[]=[];for(const file of files)ready.push(await prepareDamagePhoto(file));if(epoch.current===generation)setPhotos(previous=>[...previous,...ready]);}finally{if(epoch.current===generation){preparingRef.current=false;setPreparing(false);}}};
 const submit=async()=>{
  if(running.current||preparingRef.current||blocked)return;const generation=epoch.current;running.current=true;setBusy(true);setError('');let saved=false;
  try{
   if(!pending&&(!area||!photos.length))throw Error('Add a photo and select the area.');
   if(photos.length>4&&!data?.unlimitedPhotos)throw Error('Removing the four-photo limit needs the prepared backend update. Your selected photos are kept.');
   const intent=pending??{invoiceId,area,description:'Car condition photos',kind:['waiting_for_installer','installer_assigned'].includes(workStatus)?'arrival':'installation',requestId:crypto.randomUUID()};
   if(!pending){localStorage.setItem(storageKey,JSON.stringify(intent));setPending(intent);}
   const result=await tintControl<Snapshot>('damage','create',intent);if(generation!==epoch.current)return;saved=true;accept(result);callbacks.current.onChange();
   if(photos.length&&!result.reportId)throw Error('Could not confirm the saved entry reference. Retry this entry.');
   for(const file of photos){if(generation!==epoch.current)return;await photoRequest(invoiceId,result.reportId!,file);if(generation!==epoch.current)return;setPhotos(previous=>previous.filter(p=>p!==file));}
   const latest=await tintControl<Snapshot>('damage','snapshot',{invoiceId});if(generation!==epoch.current)return;accept(latest);localStorage.removeItem(storageKey);localStorage.removeItem(legacyKey);setPending(null);setArea('');setAdding(false);callbacks.current.onChange();
  }catch(e){if(generation===epoch.current)setError((saved?'Entry saved. Retry to finish attaching its photos. ':'')+(e as Error).message);}
  finally{if(generation===epoch.current){running.current=false;setBusy(false);}}
 };
 const appendPhotos=async(entry:Entry,files:File[])=>{
  if(running.current)return;const generation=epoch.current;running.current=true;setBusy(true);let failure:unknown;
  try{if(entry.photos.length+files.length>4&&!data?.unlimitedPhotos)throw Error('Unlimited photos needs the prepared backend update.');for(const original of files){if(generation!==epoch.current)return;const file=await prepareDamagePhoto(original);if(generation!==epoch.current)return;await photoRequest(invoiceId,entry.id,file);}}
  catch(e){failure=e;}
  finally{if(generation===epoch.current){try{const result=await tintControl<Snapshot>('damage','snapshot',{invoiceId});if(generation===epoch.current){accept(result);callbacks.current.onChange();}}catch(e){failure??=e;}if(generation===epoch.current){running.current=false;setBusy(false);}}}
  if(failure&&generation===epoch.current)throw failure;
 };
 const review=async(reportId:string,note:string)=>{if(running.current)return;const generation=epoch.current;running.current=true;setBusy(true);setError('');try{const result=await tintControl<Snapshot>('damage','resolve',{invoiceId,reportId,note:note.trim(),requestId:crypto.randomUUID()});if(generation!==epoch.current)return;accept(result);callbacks.current.onChange();}catch(e){if(generation===epoch.current)setError((e as Error).message);throw e;}finally{if(generation===epoch.current){running.current=false;setBusy(false);}}};
 return <>
  <button type="button" onClick={()=>setOpen(true)} className="min-h-[44px] border border-gold-400/30 text-gold-300 rounded-xl px-4 py-3 text-sm" aria-haspopup="dialog">Car Condition{data&&data.openCount>0?` · ${data.openCount} open`:''}</button>
  <Modal isOpen={open} onClose={()=>{if(!busy&&!preparing)setOpen(false);}} title="Car Condition" maxWidth="max-w-3xl">
   <div className="space-y-5">
    {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}
    {!data&&<p role="status" className="text-white/60 text-sm">Loading car condition…</p>}
    {data?.canReport&&!adding&&<button type="button" disabled={blocked} onClick={()=>setAdding(true)} className="btn-gold min-h-[44px] px-5 py-3 rounded-xl disabled:opacity-40">Add entry</button>}
    {adding&&<section className="rounded-2xl border border-gold-400/25 p-4 space-y-4" aria-label="New car condition entry">
     <GarageDamagePhotoPicker busy={busy||!!pending} onFiles={pick}/>
     {!!photos.length&&<div className="flex flex-wrap gap-2">{photos.map((file,index)=><span key={index} className="text-sm text-white/70 border border-white/15 rounded-lg px-3 py-2">Photo {index+1}<button type="button" disabled={busy||!!pending} aria-label={`Remove photo ${index+1}`} onClick={()=>setPhotos(previous=>previous.filter((_,i)=>i!==index))} className="ml-2 px-2 text-white/50">×</button><span className="sr-only">{file.name}</span></span>)}</div>}
     {!pending&&!!photos.length&&<label className="block text-white/80 text-sm">Which area?<select aria-label="Car condition area" value={area} onChange={e=>setArea(e.target.value)} disabled={busy} className="block w-full mt-2 rounded-xl bg-obsidian-900 border border-white/20 p-3"><option value="">Select area</option>{areas.map(value=><option key={value} value={value}>{value}</option>)}</select></label>}
     {pending&&<p className="text-amber-200 text-sm">Finish the earlier entry: {pending.area}. {photos.length?'Selected photos are kept for retry.':'If the page was refreshed, photos not yet uploaded must be added to the saved entry.'}</p>}
     {photos.length>4&&!data?.unlimitedPhotos&&<p className="text-amber-200 text-sm">Unlimited photos will work after the prepared backend update is installed. Your photos remain selected.</p>}
     <div className="flex gap-3"><button type="button" disabled={busy||preparing||blocked||(!pending&&(!area||!photos.length))} onClick={()=>{void submit();}} className="btn-gold min-h-[44px] px-5 py-3 rounded-xl disabled:opacity-40">{busy?'Submitting…':pending?'Retry entry':'Submit entry'}</button>{!pending&&<button type="button" disabled={busy||preparing} onClick={()=>{setAdding(false);setPhotos([]);setArea('');}} className="min-h-[44px] px-4 text-white/60">Cancel</button>}</div>
    </section>}
    {data&&!data.reports.length&&<p className="text-white/60 text-sm">No entries yet.</p>}
    {data?.reports.slice().reverse().slice(0,entryLimit).map(entry=><ConditionEntry key={entry.id} entry={entry} invoiceId={invoiceId} name={name} canReview={data.canReview} canAttach={data.canReport&&(entry.reported_by===user?.id||data.canReview)} busy={busy} onReview={review} onAddPhotos={files=>appendPhotos(entry,files)}/>)}
    {data&&data.reports.length>entryLimit&&<button type="button" onClick={()=>setEntryLimit(n=>n+10)} className="min-h-[44px] px-4 py-3 rounded-xl border border-white/20 text-white/70">Show more entries</button>}
   </div>
  </Modal>
 </>;
}
