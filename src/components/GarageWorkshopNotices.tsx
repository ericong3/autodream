import {useEffect,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useStore} from '../store';
import {installationNotices} from '../lib/garageInstallationReview';
export default function GarageWorkshopNotices(){
 const user=useStore(s=>s.currentUser),navigate=useNavigate();
 const [notices,setNotices]=useState<Awaited<ReturnType<typeof installationNotices>>>([]),[failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;setNotices([]);setFailed(false);if(!user||user.role==='admin')return;const load=()=>installationNotices().then(r=>{if(active){setNotices(r);setFailed(false);}}).catch(()=>{if(active)setFailed(true);});void load();const timer=setInterval(load,15000);window.addEventListener('focus',load);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',load);};},[user?.id]);
 if(user?.role==='admin'||(!notices.length&&!failed))return null;
 return <aside aria-label="Workshop notifications" className="mb-5 rounded-xl border border-gold-400/25 bg-black/30 p-4 space-y-2">{failed&&<p className="text-xs text-white/50">Workshop notifications could not refresh. Open your work orders to check.</p>}{notices.map(n=><button key={n.invoiceId} className="block w-full text-left text-sm text-gold-300 py-2" onClick={()=>navigate(user?.role==='garage_head'?`/garage/installer/job/${n.jobId}`:`/garage/invoice/${n.invoiceId}`)}>{n.invoiceNumber} · {n.state==='sales'?'Ready for your final inspection':n.state==='correction_review'?'Salesman reported a problem':'Ready for Garage Head inspection'} →</button>)}</aside>;
}
