import {Link} from 'react-router-dom';
import {useStore} from '../store';
import {secureGarageLoginEnabled} from '../lib/garageSession';
export default function StaffAccessLink(){
 const role=useStore(s=>s.currentUser?.role);
 if(!secureGarageLoginEnabled())return null;
 return <div className="border border-white/10 rounded-xl p-4 text-sm text-white/60">{role==='director'?<><Link className="text-gold-400" to="/staff-access">Invite staff & manage access</Link><p className="mt-1">Staff register with their own email and password. Existing profiles below are read-only.</p></>:<p>Only directors can invite staff or change account access.</p>}</div>;
}
