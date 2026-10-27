import {useEffect,useState} from 'react';
import {tintControl,type TintUsage} from '../lib/garageTintControl';
import {GLASS_LABEL} from '../utils/tintPricing';
import {useStore} from '../store';
export default function GarageTintUsage({invoiceId,version}:{invoiceId:string;version?:string}){
 const users=useStore(s=>s.users),user=useStore(s=>s.currentUser);
 const [usage,setUsage]=useState<TintUsage|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;tintControl<TintUsage>('stock','snapshot',{invoiceId}).then(r=>{if(active){setUsage(r);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[invoiceId,version,user?.id]);
 return <section aria-label="Film usage and replacements" className="rounded-2xl border border-white/10 p-4 space-y-3">
  <h2 className="text-white font-semibold">Film usage & replacements</h2>
  {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}
  {usage&&<><p className="text-white/70 text-sm">{Number(usage.totalUsage).toFixed(2)} sqft consumed in total · {usage.replacementCount} replacement{usage.replacementCount===1?'':'s'}</p>
   {usage.afterSalesReplacementCount>0&&<p className="text-white/70 text-sm">After delivery: {usage.afterSalesReplacementCount} glass replacement{usage.afterSalesReplacementCount===1?'':'s'} in linked jobs · {Number(usage.afterSalesUsage).toFixed(2)} sqft additionally consumed.</p>}
   <p className="text-white/40 text-xs">This job's total includes original and replacement film. Replacing glass never returns old film to stock.</p>
   <details className="text-sm text-white/60"><summary>Usage history</summary><div className="space-y-2 mt-3">{usage.attempts.map(a=><p key={a.item_id+':'+a.attempt}>{a.kind==='replacement'?'Replacement':'Original'} · attempt {a.attempt} · {a.series} · {Number(a.sqft).toFixed(2)} sqft · {users.find(u=>u.id===a.installer_id)?.name??'Installer'} · {GLASS_LABEL[a.position as keyof typeof GLASS_LABEL]??a.position?.replace(/_/g,' ')}</p>)}</div></details>
  </>}
 </section>;
}
