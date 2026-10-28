import {useRef,useState} from 'react';

export default function GarageDamagePhotoPicker({remaining,busy,onFiles}:{remaining:number;busy:boolean;onFiles:(files:File[])=>Promise<void>}){
 const camera=useRef<HTMLInputElement>(null),upload=useRef<HTMLInputElement>(null);
 const [error,setError]=useState(''),[saving,setSaving]=useState(false),running=useRef(false);
 const disabled=busy||saving||remaining<=0;
 const select=async(input:HTMLInputElement)=>{
  const files=Array.from(input.files??[]);input.value='';
  if(!files.length||disabled||running.current)return;
  if(files.length>remaining){setError(`Choose up to ${remaining} more photo${remaining===1?'':'s'}.`);return;}
  running.current=true;setSaving(true);setError('');
  try{await onFiles(files);}catch(e){setError((e as Error).message||'Could not upload the photos.');}
  finally{running.current=false;setSaving(false);}
 };
 return <div className="space-y-3 pt-2">
  <p className="text-white/60 text-xs">Up to {remaining} more photo{remaining===1?'':'s'}.</p>
  <div className="flex flex-wrap gap-3">
   <button type="button" disabled={disabled} onClick={()=>camera.current?.click()} className="min-h-[44px] px-4 py-3 rounded-xl border border-gold-400/40 text-gold-300 disabled:opacity-40">Take photo</button>
   <button type="button" disabled={disabled} onClick={()=>upload.current?.click()} className="min-h-[44px] px-4 py-3 rounded-xl border border-white/20 text-white/80 disabled:opacity-40">Upload photos</button>
  </div>
  <input ref={camera} type="file" aria-label="Take damage photo" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={disabled} className="hidden" onChange={e=>{void select(e.currentTarget);}}/>
  <input ref={upload} type="file" aria-label="Upload damage photos" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled} className="hidden" onChange={e=>{void select(e.currentTarget);}}/>
  {saving&&<p role="status" className="text-gold-300 text-sm">Uploading photos…</p>}
  {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}
 </div>;
}
