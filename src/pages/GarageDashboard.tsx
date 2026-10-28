import {Link} from 'react-router-dom';
import {useStore} from '../store';
import {canUseGarageSales} from '../utils/garageRoles';
import GarageMyWorkOrders from './GarageMyWorkOrders';
import GarageShell from '../components/GarageShell';
import GarageHomeTasks from '../components/GarageHomeTasks';
export default function GarageDashboard(){
 const user=useStore(s=>s.currentUser);
 if(canUseGarageSales(user?.role))return <GarageMyWorkOrders/>;
 return <GarageShell title="Home" nav><div className="max-w-4xl mx-auto"><h1 className="text-2xl text-white font-semibold mb-6">Home</h1><GarageHomeTasks/>{user?.role!=='admin'&&<Link to="/garage/installer" className="inline-block rounded-xl border border-white/20 px-5 py-3 text-gold-300">Browse service workspaces</Link>}</div></GarageShell>;
}
