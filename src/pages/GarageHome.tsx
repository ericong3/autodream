import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Wrench, Users, Layers, Sparkles, SprayCan, Settings2, ClipboardList, ChevronRight } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { useStore } from '../store';

const MODULES = [
  { key: 'dashboard', label: 'Dashboard', desc: 'Overview', icon: LayoutDashboard, path: '/garage/dashboard', active: true },
  { key: 'sales-tools', label: 'Sales Tools', desc: 'Work orders & more', icon: Wrench, path: '/garage/sales-tools', active: true },
  { key: 'team', label: 'Team Members', desc: 'Staff, roles & access', icon: Users, path: '/garage/team', active: true },
  { key: 'tint', label: 'Tinting', desc: 'Car & building tint jobs', icon: Layers, path: null, active: false },
  { key: 'coating', label: 'Coating', desc: 'Detailing jobs', icon: Sparkles, path: null, active: false },
  { key: 'spray', label: 'Car Spray', desc: 'Spray jobs', icon: SprayCan, path: null, active: false },
];

export default function GarageHome() {
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const isManager = currentUser?.role === 'director' || currentUser?.role === 'shareholder';

  const modules = isManager
    ? [
        ...MODULES,
        { key: 'installer-jobs', label: 'Installer Job Queue', desc: 'Pending & in-progress tint jobs', icon: ClipboardList, path: '/garage/installer', active: true },
        { key: 'tint-pricing', label: 'Tint Pricing', desc: 'Package & VLT price grid', icon: Settings2, path: '/garage/tint-pricing', active: true },
      ]
    : MODULES;

  return (
    <GarageShell title="AutoDream Garage">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {modules.map((m) => (
          <button
            key={m.key}
            disabled={!m.active}
            onClick={() => m.path && navigate(m.path)}
            className={`group relative overflow-hidden text-left rounded-2xl p-6 flex items-center gap-4
              bg-white/[0.04] backdrop-blur-xl border border-gold-400/15
              transition-all duration-300
              ${m.active
                ? 'hover:border-gold-400/50 hover:bg-white/[0.06] hover:-translate-y-0.5 cursor-pointer shadow-card'
                : 'opacity-50 cursor-not-allowed'}`}
          >
            <div className="shrink-0 w-12 h-12 rounded-xl bg-gold-400/10 flex items-center justify-center text-gold-400">
              <m.icon size={22} strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-white font-semibold tracking-wide">{m.label}</h3>
              <p className="text-white/40 text-xs mt-0.5">{m.active ? m.desc : 'Coming soon'}</p>
            </div>
            {m.active && (
              <ChevronRight size={18} className="text-gold-400/60 group-hover:text-gold-400 group-hover:translate-x-0.5 transition-all shrink-0" />
            )}
          </button>
        ))}
      </div>
    </GarageShell>
  );
}
