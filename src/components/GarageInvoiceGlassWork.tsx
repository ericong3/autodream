import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import GarageJobGlassMap from './GarageJobGlassMap';
import {useStore} from '../store';
import {canInstallGarageTint} from '../utils/garageRoles';
import {claimTintWorkOrderItem,releaseTintWorkOrderItem,setTintWorkOrderItemSqft,setTintWorkOrderItemStatus} from '../lib/garageTint';
import type {GarageTintWorkOrderItem,GarageWorkStatus} from '../types';
import type {VehicleGlassLayout} from '../utils/vehicleGlass';

export default function GarageInvoiceGlassWork({invoiceId,jobId,items,layout,workStatus,onChange}:{invoiceId:string;jobId?:string;items:GarageTintWorkOrderItem[];layout?:VehicleGlassLayout;workStatus:GarageWorkStatus;onChange:()=>void}){
 const user=useStore(s=>s.currentUser),scope=`${invoiceId}:${user?.id}`;
 const current=useRef<string|null>(scope);current.current=scope;
 const running=useRef<string|null>(null),[busyScope,setBusyScope]=useState<string|null>(null),[error,setError]=useState('');
 const [pendingAction,setPendingAction]=useState('');
 const [confirmed,setConfirmed]=useState<Record<string,GarageTintWorkOrderItem>>({});
 useEffect(()=>{setError('');},[scope]);
 useEffect(()=>()=>{current.current=null;},[]);
 const canWork=canInstallGarageTint(user?.role)&&['waiting_for_installer','installer_assigned','in_progress'].includes(workStatus);
 const perform=async(item:GarageTintWorkOrderItem,action:'claim'|'release'|'complete'|'usage',sqft?:number)=>{
  if(!user||!canWork||running.current===scope||item.invoiceId!==invoiceId||!items.some(p=>p.id===item.id&&p.invoiceId===invoiceId))return false;
  if(action==='release'&&(item.installerId!==user.id||item.status!=='taken'||(item.sqft??0)>0||item.needsCorrection))return false;
  const generation=scope;running.current=generation;setBusyScope(generation);setPendingAction(action);setError('');
  try{
   const saved=action==='claim'?await claimTintWorkOrderItem(item.id,user.id)
    :action==='release'?await releaseTintWorkOrderItem(item.id,user.id)
    :action==='complete'?await setTintWorkOrderItemStatus(item.id,'installed',user.id)
    :(await setTintWorkOrderItemSqft(item.id,sqft!,user.id)).item;
   if(current.current===generation){
    // The mutation already returned the committed row. Show it immediately;
    // slower invoice/activity refreshes must not turn it back to Available.
    setConfirmed(previous=>({...previous,[`${generation}:${item.id}`]:saved}));
    void Promise.resolve().then(onChange).catch(()=>{});
   }
   return true;
  }catch(e){if(current.current===generation)setError((e as Error).message||'Could not save this glass. Refresh and try again.');return false;}
  finally{if(running.current===generation)running.current=null;if(current.current===generation)setBusyScope(null);}
 };
 const displayedItems=items.map(item=>{
  const saved=confirmed[`${scope}:${item.id}`];
  return saved&&(!item.updatedAt||Date.parse(saved.updatedAt)>Date.parse(item.updatedAt))?saved:item;
 });
 return <div className="space-y-3">
  {busyScope===scope&&<p role="status" aria-live="polite" className="text-gold-300 text-sm">{pendingAction==='claim'?'Claiming glass…':pendingAction==='release'?'Unclaiming glass…':pendingAction==='usage'?'Saving film usage…':'Saving completed glass…'}</p>}
  {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}
  <GarageJobGlassMap showPipeline={false} items={displayedItems} layout={layout} userId={user?.id} workStatus={workStatus} canWork={canWork} busy={busyScope===scope} actionError={error}
   onClaim={item=>perform(item,'claim')} onUnclaim={item=>perform(item,'release')} onComplete={item=>{void perform(item,'complete');}} onUsage={(item,sqft)=>perform(item,'usage',sqft)}/>
  {jobId&&canInstallGarageTint(user?.role)&&<Link to={`/garage/installer/job/${jobId}`} className="inline-block min-h-[44px] px-4 py-3 rounded-xl border border-gold-400/40 text-gold-300 text-sm">Open installation job</Link>}
 </div>;
}
