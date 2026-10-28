import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpRight,RefreshCw,ClipboardCheck} from 'lucide-react';
import {useStore} from '../store';
import {tintControl} from '../lib/garageTintControl';
import {formatRM} from '../utils/format';
type Task={id:string;invoiceNumber:string;vehicle:string;service:string;scope:string;action:string;href:string;owner?:string;availableGlass?:number;assignedGlass?:number;balanceUnavailable?:boolean;money?:{toCollect:number;awaitingVerification:number;verifiedBalance:number}};
type Home={tasks:Task[];hasMore:boolean;canSeeBalances:boolean;financeUnavailable:boolean;verification:null|{count:number;hasMore:boolean;href:string};checkedAt:string};
export default function GarageHomeTasks(){
 const user=useStore(s=>s.currentUser),sequence=useRef(0);
 const [state,setState]=useState<{owner?:string;data?:Home;error?:string;loading:boolean}>({loading:true});
 const [retry,setRetry]=useState(0);
 const workshop=['garage_installer','garage_detailer','garage_spray'].includes(user?.role??'');
 const manager=['director','shareholder','garage_head'].includes(user?.role??'');
 const workspace=user?.role==='admin'?'/garage/payments':workshop?'/garage/installer/tinted':manager?'/garage/work-order-tracking':'/garage/my-work-orders';
 useEffect(()=>{let active=true;setState({loading:true});if(!user)return;
  const load=async()=>{const request=++sequence.current;try{const data=await tintControl<Home>('home','list');if(active&&request===sequence.current)setState({owner:user.id,data,loading:false});}catch(e){if(active&&request===sequence.current)setState({owner:user.id,error:(e as Error).message,loading:false});}};
  void load();const timer=setInterval(load,15000);window.addEventListener('focus',load);return()=>{active=false;sequence.current++;clearInterval(timer);window.removeEventListener('focus',load);};
 },[user?.id,retry]);
 const current=state.owner===user?.id?state.data:undefined;
 return <section aria-label="Your next steps" className="mb-8 rounded-2xl border border-gold-400/20 bg-black/30 p-5 sm:p-6 space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-white flex items-center gap-2"><ClipboardCheck className="text-gold-400" size={20}/>Your next steps</h2><p className="text-sm text-white/60 mt-1">Open a task to continue where work is needed.</p></div><button aria-label="Refresh your tasks" onClick={()=>setRetry(n=>n+1)} className="p-3 rounded-xl border border-white/20 text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"><RefreshCw size={18}/></button></div>
  {state.loading||state.owner!==user?.id?<p role="status" className="text-white/60 text-sm">Checking your tasks…</p>:state.error?<p role="alert" className="text-amber-200 text-sm">Tasks could not refresh. {state.error} <Link className="underline" to={workspace}>Open your workspace</Link></p>:current&&<>
   {current.verification&&<Link to={current.verification.href} className="block rounded-xl border border-amber-300/30 p-4 text-white hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"><span className="flex items-center justify-between gap-3 font-medium">Verify company money received<ArrowUpRight size={18}/></span><span className="block mt-2 text-sm text-amber-200">{current.verification.count}{current.verification.hasMore?'+':''} collection{current.verification.count===1?'':'s'} awaiting verification</span></Link>}
   {current.financeUnavailable&&<p role="alert" className="text-amber-200 text-sm">Payment verification could not refresh. <Link className="underline" to="/garage/payments">Open payment verification</Link></p>}
   {!!current.tasks.length&&<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{current.tasks.map(task=><Link key={task.id} to={task.href} className="block min-w-0 rounded-xl border border-white/15 p-4 hover:border-gold-400/40 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400">
    <div className="flex justify-between gap-3"><span className="text-gold-300 text-sm font-semibold">{task.action}</span><ArrowUpRight className="text-white/50 shrink-0" size={18}/></div>
    <p className="text-white font-medium mt-3 break-words">{task.invoiceNumber}</p><p className="text-white/70 text-sm mt-1 break-words">{task.vehicle}</p><p className="text-white/50 text-xs mt-2">{task.scope}{task.owner?' · '+task.owner:''} · {task.service==='tinted'?'Car tint':task.service}</p>
    {task.assignedGlass!==undefined&&<p className="text-white/60 text-sm mt-2">{task.assignedGlass} glass assigned to you{task.availableGlass?` · ${task.availableGlass} available to claim`:''}</p>}
    {current.canSeeBalances&&task.money&&<div className="border-t border-white/10 mt-3 pt-3 text-sm"><p className="text-white">Customer still to pay: <strong>{formatRM(task.money.toCollect)}</strong></p>{task.money.awaitingVerification>0&&<p className="text-amber-200 mt-1">{formatRM(task.money.awaitingVerification)} already collected · company verification pending</p>}</div>}
    {current.canSeeBalances&&task.balanceUnavailable&&<p className="text-amber-200 text-sm mt-3">Open the order to check its balance.</p>}
   </Link>)}</div>}
   {!current.tasks.length&&!current.financeUnavailable&&(!current.verification||current.verification.count===0)&&<p className="text-white/60 text-sm">No tasks waiting for you right now. New work will appear here automatically.</p>}
   <Link to={workspace} className="inline-flex items-center gap-2 min-h-11 text-gold-300 text-sm underline">{current.hasMore?'More tasks · ':''}{workshop?'Open full job list':manager?'Open team orders':user?.role==='admin'?'Open payment review':'Open your order pipeline'}<ArrowUpRight size={16}/></Link>
   {current.hasMore&&<p className="text-white/50 text-xs">This is a quick view of your first 12 tasks. Open the full list for remaining work.</p>}
  </>}
 </section>;
}
