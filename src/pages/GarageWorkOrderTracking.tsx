import {lazy,Suspense,useEffect,useState} from 'react';
import {useNavigate,useParams,useSearchParams} from 'react-router-dom';
import {Building2,ClipboardList} from 'lucide-react';
import GarageShell from '../components/GarageShell';
import GarageServiceWorkOrders from './GarageServiceWorkOrders';
const GarageBuildingProjects=lazy(()=>import('./GarageBuildingProjects'));
import {GARAGE_SERVICES} from '../utils/garageServices';
import {useStore} from '../store';
import {useGarageTracking} from '../hooks/useGarageTracking';

// One manager workspace; visited panels retain their own search and filters.
const tabs=[{key:'all',label:'All',icon:ClipboardList},...GARAGE_SERVICES.map(s=>({...s,label:s.key==='tinted'?'Car Tint':s.label})),{key:'building',label:'Building Tint',icon:Building2}];
export default function GarageWorkOrderTracking(){
 const {service}=useParams(),[params,setParams]=useSearchParams(),navigate=useNavigate();
 const actor=useStore(s=>s.currentUser?.id);
 const tracking=useGarageTracking();
 const requested=params.get('service')??service??'all';
 const selected=tabs.some(t=>t.key===requested)?requested:'all';
 const [visited,setVisited]=useState([selected]);
 useEffect(()=>{setVisited(previous=>previous.includes(selected)?previous:[...previous,selected]);},[selected]);
 useEffect(()=>{setVisited([selected]);},[actor]);
 useEffect(()=>{if(service){const next=new URLSearchParams(params);next.set('service',selected);if(next.has('view')){next.set('view-'+selected,next.get('view')!);next.delete('view');}navigate('/garage/work-order-tracking?'+next.toString(),{replace:true});}},[service]);
 const select=(key:string)=>setParams(previous=>{const next=new URLSearchParams(previous);if(key==='all')next.delete('service');else next.set('service',key);return next;});
 const vehicleTabs=tabs.filter(t=>t.key!=='building'&&(visited.includes(t.key)||selected===t.key));
 return <GarageShell title="Work orders" nav>
  <div className="space-y-5">
   <div role="tablist" aria-label="Work order services" className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
    {tabs.map(({key,label,icon:Icon},index)=><button key={key} id={'work-orders-tab-'+key} type="button" role="tab" aria-selected={selected===key} aria-controls="work-orders-panel" tabIndex={selected===key?0:-1}
     onClick={()=>select(key)} onKeyDown={event=>{let next:number|undefined;if(event.key==='ArrowRight')next=(index+1)%tabs.length;if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;if(event.key==='Home')next=0;if(event.key==='End')next=tabs.length-1;if(next!==undefined){event.preventDefault();select(tabs[next].key);document.getElementById('work-orders-tab-'+tabs[next].key)?.focus();}}}
     className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 active:opacity-75 ${selected===key?'border-gold-400/50 bg-gold-400/15 text-gold-300':'border-white/10 bg-white/[.03] text-white/60 hover:border-white/25 hover:text-white'}`}><Icon aria-hidden="true" size={16}/>{label}</button>)}
   </div>
   <div id="work-orders-panel" role="tabpanel" aria-labelledby={'work-orders-tab-'+selected}>
    {tracking.refreshing&&<p role="status" className="text-white/40 text-xs mb-2">Updating work orders…</p>}
    {vehicleTabs.map(tab=><div key={actor+':'+tab.key} hidden={selected!==tab.key}><GarageServiceWorkOrders embedded serviceKey={tab.key as 'all'|'tinted'|'coating'|'ppf'|'spray'} tracking={tracking}/></div>)}
    {(!tracking.loading&&(visited.includes('building')||visited.includes('all')||selected==='building'||selected==='all'))&&<div hidden={selected!=='building'&&selected!=='all'} className={selected==='all'?'mt-8 border-t border-white/10 pt-6':''}><Suspense fallback={<p className="text-white/50 text-sm">Loading building projects…</p>}><GarageBuildingProjects key={actor} embedded/></Suspense></div>}
   </div>
  </div>
 </GarageShell>;
}
