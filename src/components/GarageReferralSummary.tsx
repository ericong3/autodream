import {useEffect,useState} from 'react';
import {useStore} from '../store';
import {salesReferralRequest} from '../lib/garageSalesAssignment';
import {formatRM} from '../utils/format';
type Assignment={ownerName:string;referrerKind:string;recipient:{name?:string;brand?:string;branch?:string};basis:number;rate:number|null;commission:number|null;payable:boolean;linkedDeal?:unknown};
export default function GarageReferralSummary({invoiceId,version}:{invoiceId:string;version:string}){
 const actor=useStore(s=>s.currentUser?.id);
 const [data,setData]=useState<Assignment|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setData(null);setError('');salesReferralRequest<{assignment:Assignment|null}>('snapshot',{invoiceId}).then(r=>{if(active)setData(r.assignment);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[invoiceId,actor,version]);
 if(error)return <p role="alert" className="text-amber-300 text-xs">Sales details: {error}</p>;
 if(!data)return null;
 return <section className="rounded-xl border border-white/10 p-4 space-y-2 text-sm" aria-label="Sales referral summary">
  <p className="text-white/70">Person in charge <span className="text-white font-medium">· {data.ownerName}</span></p>
  {data.referrerKind!=='none'&&<><p className="text-white/70">Referrer · {data.recipient.name}{data.recipient.branch?` · ${data.recipient.branch}`:''}</p>
   <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-white/60">Commission · {formatRM(data.commission??0)} <span className="text-xs">(30% of {formatRM(data.basis)})</span></p><span className={`rounded-full px-2.5 py-1 text-xs ${data.payable?'bg-emerald-400/10 text-emerald-300':'bg-amber-400/10 text-amber-300'}`}>{data.payable?'Payable · payment verified':'Awaiting full verified receipt'}</span></div>
   {data.linkedDeal&&<p className="text-xs text-white/45">Linked to a specific Used Car deal.</p>}
  </>}
 </section>;
}
