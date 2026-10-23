import {useState} from 'react';
import StaffAccountAccess from './StaffAccountAccess';
import UsedCarStaffDetails from './UsedCarStaffDetails';
import GarageStaffDetails from './GarageStaffDetails';

export default function SharedTeamMembers(){
 const [department,setDepartment]=useState<'used_car'|'garage'>('used_car');
 return <div className="space-y-6"><StaffAccountAccess embedded/><details className="border border-white/10 rounded-xl p-5"><summary className="text-white/70 cursor-pointer">Staff details & records</summary><p className="text-white/40 text-sm mt-3">Existing staff profiles, targets and records.</p><div className="flex gap-4 my-5" role="group" aria-label="Staff records department"><button className="text-gold-400" aria-pressed={department==='used_car'} onClick={()=>setDepartment('used_car')}>Used Car records</button><button className="text-gold-400" aria-pressed={department==='garage'} onClick={()=>setDepartment('garage')}>Garage records</button></div>{department==='used_car'?<UsedCarStaffDetails/>:<GarageStaffDetails/>}</details></div>;
}
