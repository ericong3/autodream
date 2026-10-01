import { ShieldAlert } from 'lucide-react';
import GarageShell from '../components/GarageShell';

// Landing spot for a Garage account whose role has no Garage pages (see
// garageHome) — so the role guards have somewhere to send it instead of
// bouncing between routes.
export default function GarageNoAccess() {
  return (
    <GarageShell title="AutoDream Garage">
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="relative mb-5 flex items-center justify-center">
          <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl" />
          <ShieldAlert size={34} strokeWidth={1.5} className="relative text-gold-400/70" />
        </div>
        <p className="text-white/70 text-sm mb-1">Your account doesn't have a Garage role yet.</p>
        <p className="text-white/40 text-xs">Ask a manager to set your role in Team Members.</p>
      </div>
    </GarageShell>
  );
}
