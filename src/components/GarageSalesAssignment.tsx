import {useEffect,useRef,useState} from 'react';
import {useStore} from '../store';
import {salesReferralRequest,type SalesAssignment,type SalesOptions,type UsedCarReferralDeal} from '../lib/garageSalesAssignment';
const empty:SalesOptions={enabled:false,owners:[],usedCarStaff:[],external:[]};
const selectClass='w-full min-h-[44px] rounded-xl border border-white/15 bg-obsidian-800 text-white px-3 py-2 text-sm focus:border-gold-400 focus:outline-none';
export default function GarageSalesAssignment({value,onChange,onReady}:{value?:SalesAssignment;onChange:(v:SalesAssignment)=>void;onReady:(ready:boolean)=>void}){
 const actor=useStore(s=>s.currentUser?.id);
 const [options,setOptions]=useState(empty),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [month,setMonth]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}),[deals,setDeals]=useState<UsedCarReferralDeal[]>([]),[dealLoading,setDealLoading]=useState(false),[dealError,setDealError]=useState(''),[more,setMore]=useState(false),[retry,setRetry]=useState(0);
 const generation=useRef(0),change=useRef(onChange),ready=useRef(onReady),current=useRef(value);
 change.current=onChange;ready.current=onReady;current.current=value;
 useEffect(()=>{let live=true;generation.current++;setLoading(true);setError('');setOptions(empty);ready.current(false);
  salesReferralRequest<SalesOptions>('options').then(result=>{if(!live)return;setOptions(result);
   if(result.enabled&&!current.current&&result.owners.some(u=>u.id===actor))change.current({ownerId:actor!,referrer:{kind:'none'}});
  }).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;generation.current++;};
 },[actor,retry]);
 const referrer=value?.referrer,staffId=referrer?.kind==='used_car'?referrer.staffId:'';
 useEffect(()=>{const request=++generation.current;setDeals([]);setMore(false);setDealError('');setDealLoading(false);
  if(!staffId||!options.enabled)return;
  setDealLoading(true);
  salesReferralRequest<{deals:UsedCarReferralDeal[];hasMore:boolean}>('deals',{staffId,month}).then(r=>{if(request===generation.current){setDeals(r.deals);setMore(r.hasMore);}}).catch(e=>{if(request===generation.current)setDealError(e.message);}).finally(()=>{if(request===generation.current)setDealLoading(false);});
 },[staffId,month,options.enabled]);
 const externalId=referrer?.kind==='external'?referrer.profileId:'',usedCarId=referrer?.kind==='used_car'?referrer.staffId:'';
 const valid=!loading&&!error&&(!options.enabled||!!value&&options.owners.some(u=>u.id===value.ownerId)&&(referrer?.kind==='none'||referrer?.kind==='external'&&options.external.some(p=>p.id===externalId)||referrer?.kind==='used_car'&&options.usedCarStaff.some(p=>p.id===usedCarId)));
 useEffect(()=>{ready.current(valid);},[valid]);
 if(!loading&&!error&&!options.enabled)return null;
 const update=(r:SalesAssignment['referrer'])=>change.current({ownerId:value?.ownerId??'',referrer:r});
 return <section aria-label="Salesperson and referrer" className="rounded-2xl border border-gold-400/20 bg-white/[0.03] p-4 sm:p-5 space-y-4">
  <h3 className="text-white font-semibold text-sm">Salesperson & referrer</h3>
  {loading?<p className="text-white/50 text-sm">Loading salespeople…</p>:error?<div role="alert" className="text-amber-300 text-sm">{error} <button type="button" onClick={()=>setRetry(n=>n+1)} className="underline min-h-[44px] px-2">Try again</button></div>:<>
   <div className="grid sm:grid-cols-2 gap-4">
    <label className="text-white/60 text-xs space-y-2"><span>Person in charge · required</span><select aria-label="Person in charge" className={selectClass} value={value?.ownerId??''} onChange={e=>change.current({ownerId:e.target.value,referrer:value?.referrer??{kind:'none'}})}><option value="">Choose Garage salesperson</option>{options.owners.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
    <label className="text-white/60 text-xs space-y-2"><span>Referrer · optional</span><select aria-label="Referrer type" className={selectClass} value={referrer?.kind??'none'} onChange={e=>update(e.target.value==='used_car'?{kind:'used_car',staffId:''}:e.target.value==='external'?{kind:'external',profileId:''}:{kind:'none'})}><option value="none">No referrer</option><option value="used_car">Used Car salesperson</option><option value="external">External salesperson</option></select></label>
   </div>
   {referrer?.kind==='external'&&<label className="block text-white/60 text-xs space-y-2"><span>External salesperson</span><select aria-label="External salesperson" className={selectClass} value={referrer.profileId} onChange={e=>update({kind:'external',profileId:e.target.value})}><option value="">Choose a saved profile</option>{options.external.map(p=><option key={p.id} value={p.id}>{p.name} · {p.brand} / {p.branch}</option>)}</select>{!options.external.length&&<p>No profiles yet. Ask the Garage Head or Director to add one in External salesmen.</p>}</label>}
   {referrer?.kind==='used_car'&&<div className="space-y-3">
    <label className="block text-white/60 text-xs space-y-2"><span>Used Car salesperson</span><select aria-label="Used Car salesperson" className={selectClass} value={referrer.staffId} onChange={e=>update({kind:'used_car',staffId:e.target.value})}><option value="">Choose salesperson</option>{options.usedCarStaff.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {staffId&&<div className="grid sm:grid-cols-[150px_1fr] gap-3">
     <label className="text-white/60 text-xs space-y-2"><span>Find deal by month</span><input aria-label="Deal month" type="month" className={selectClass} value={month} onChange={e=>setMonth(e.target.value)}/></label>
     <label className="text-white/60 text-xs space-y-2"><span>Link a specific deal · optional</span><select aria-label="Used Car deal" className={selectClass} disabled={dealLoading||!!dealError} value={referrer.deal?`${referrer.deal.customerId}:${referrer.deal.carId}:${referrer.deal.submittedAt}`:''} onChange={e=>{const d=deals.find(d=>`${d.customerId}:${d.carId}:${d.submittedAt}`===e.target.value);update({kind:'used_car',staffId,...(d?{deal:{customerId:d.customerId,carId:d.carId,submittedAt:d.submittedAt}}:{})});}}><option value="">{dealLoading?'Loading deals…':'Referral only · no deal linked'}</option>{referrer.deal&&!deals.some(d=>d.customerId===referrer.deal!.customerId&&d.carId===referrer.deal!.carId&&d.submittedAt===referrer.deal!.submittedAt)&&<option value={`${referrer.deal.customerId}:${referrer.deal.carId}:${referrer.deal.submittedAt}`}>Previously selected deal</option>}{deals.map(d=><option key={`${d.customerId}:${d.carId}:${d.submittedAt}`} value={`${d.customerId}:${d.carId}:${d.submittedAt}`}>{d.vehicle} · {d.customer}</option>)}</select></label>
    </div>}
    {dealError&&<p role="alert" className="text-amber-300 text-xs">{dealError}</p>}{more&&<p className="text-white/50 text-xs">More than 100 deals. Ask management to check the exact deal before linking.</p>}
    {referrer.deal&&<p className="text-white/50 text-xs">This links the deal only. Customer and vehicle details stay as entered on this Garage order.</p>}
   </div>}
   {referrer&&referrer.kind!=='none'&&<p className="text-gold-300/80 text-xs leading-relaxed">30% on the final tint and coating service price, excluding tax. Payable after Garage verifies full receipt.</p>}
  </>}
 </section>;
}
