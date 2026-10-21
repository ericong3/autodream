import {useState} from 'react';
import StaffAccountAccess from '../pages/StaffAccountAccess';
export default function StaffAccessLink(){
 const [open,setOpen]=useState(false);
 return <section className="border border-white/10 rounded-xl bg-black/20 text-sm text-white/60"><div className="p-4 flex items-center justify-between gap-4"><div><p className="text-white font-medium">Staff setup</p><p className="mt-1">Directors can create registration links for the team.</p></div><button type="button" className="text-gold-400 shrink-0" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?'Close':'Open'}</button></div>{open&&<div className="border-t border-white/10"><StaffAccountAccess embedded/></div>}</section>;
}
