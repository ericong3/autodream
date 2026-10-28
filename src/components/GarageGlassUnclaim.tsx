import {useRef,useState} from 'react';
export default function GarageGlassUnclaim({busy,onConfirm}:{busy:boolean;onConfirm:()=>Promise<boolean|void>|void}){
 const [confirming,setConfirming]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const running=useRef(false);
 const confirm=async()=>{
  if(busy||running.current)return;
  running.current=true;setSaving(true);setError('');
  try{const ok=await onConfirm();if(ok!==false)setConfirming(false);}
  catch(e){setError((e as Error).message||'Could not unclaim. Refresh and try again.');}
  finally{running.current=false;setSaving(false);}
 };
 return <div className="mt-4 space-y-3">
  {!confirming?<button type="button" disabled={busy||saving} onClick={()=>setConfirming(true)} className="w-full min-h-[44px] rounded-xl border border-orange-300/40 text-orange-200 py-3">Unclaim glass</button>
   :<div className="rounded-xl border border-orange-300/30 p-4 space-y-3" role="group" aria-label="Confirm unclaim">
    <p className="text-white text-sm">Unclaim this glass?</p>
    <p className="text-white/60 text-sm">It will become available for another installer to claim.</p>
    <div className="grid grid-cols-2 gap-3">
     <button type="button" disabled={busy||saving} onClick={()=>{setConfirming(false);setError('');}} className="min-h-[44px] rounded-xl border border-white/20 text-white py-3">Keep my claim</button>
     <button type="button" disabled={busy||saving} onClick={()=>{void confirm();}} className="min-h-[44px] rounded-xl border border-orange-300/50 text-orange-200 py-3">{busy||saving?'Unclaiming…':'Yes, unclaim'}</button>
    </div>
   </div>}
  {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}
 </div>;
}
