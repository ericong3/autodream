import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {useStore} from '../store';
import {garageSessionRequest} from '../lib/garageSession';
import {enquiryRequest,type Enquiry} from '../lib/garageEnquiries';

export default function GarageEnquiryReminders(){
 const userId=useStore(s=>s.currentUser?.id);
 const [state,setState]=useState<{owner?:string;rows:Enquiry[];error?:boolean;more?:boolean}>({rows:[]});
 useEffect(()=>{let active=true;setState({rows:[]});
  garageSessionRequest('GET').then(async u=>{if(!active||!u||u.id!==userId)return;try{const r=await enquiryRequest({action:'due'});if(active)setState({owner:userId,rows:r.enquiries||[],more:r.hasMore});}catch{if(active)setState({owner:userId,rows:[],error:true});}}).catch(()=>undefined);
  return()=>{active=false;};
 },[userId]);
 if(!userId||state.owner!==userId)return null;
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const today=['year','month','day'].map(type=>parts.find(p=>p.type===type)?.value).join('-');
 const due=state.rows.filter(e=>e.owner_id===userId&&e.reminder_date&&e.reminder_date<=today).sort((a,b)=>(a.reminder_date||'').localeCompare(b.reminder_date||''));
 return <section className="mt-6 border border-white/10 rounded-2xl p-5 bg-white/[0.03]"><div className="flex justify-between gap-4"><h2 className="text-white">Follow-ups</h2><Link className="text-gold-400 text-sm" to="/garage/enquiries">Enquiries</Link></div>{state.error?<p role="alert" className="text-white/60 text-sm mt-4">Could not load follow-ups. Open Enquiries to try again.</p>:due.length?due.map(e=><Link key={e.id} to={`/garage/enquiries?open=${encodeURIComponent(e.id)}`} className="block border-t border-white/10 mt-4 pt-4"><span className="text-white">{e.name}</span><span className="text-amber-300 text-xs ml-3">{e.reminder_date!<today?'Overdue':'Today'}</span><span className="block text-white/50 text-sm">{e.next_action||e.services.map(s=>s.name).join(' + ')}</span></Link>):<p className="text-white/50 text-sm mt-4">No follow-ups due today.</p>}{state.more&&<Link className="block text-gold-400 text-sm mt-4" to="/garage/enquiries">More follow-ups · Open Enquiries</Link>}</section>;
}
