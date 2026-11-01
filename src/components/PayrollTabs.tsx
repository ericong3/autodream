import {NavLink} from 'react-router-dom';
export default function PayrollTabs(){return <nav aria-label="Payroll sections" className="flex gap-1 border-b border-white/10 text-sm">
 {[["/payroll","Payroll"],["/payroll/bonus-campaigns","Bonus Campaigns"]].map(([to,label])=><NavLink key={to} to={to} end className={({isActive})=>`min-h-[44px] px-4 py-3 border-b-2 transition-colors ${isActive?'border-gold-400 text-gold-300':'border-transparent text-white/50 hover:text-white'}`}>{label}</NavLink>)}
 </nav>;}
