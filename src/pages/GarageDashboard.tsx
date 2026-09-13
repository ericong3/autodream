import { LayoutDashboard } from 'lucide-react';
import GarageShell, { SALESMAN_TABS } from '../components/GarageShell';

// Empty on purpose — real dashboard content (targets, recent jobs, etc.)
// gets added once it's decided what a Garage salesman actually needs to see.
export default function GarageDashboard() {
  return (
    <GarageShell title="AutoDream Garage" tabs={SALESMAN_TABS}>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="relative mb-5 flex items-center justify-center">
          <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl" />
          <LayoutDashboard size={34} strokeWidth={1.5} className="relative text-gold-400/70" />
        </div>
        <p className="text-white/40 text-sm">Nothing here yet</p>
      </div>
    </GarageShell>
  );
}
