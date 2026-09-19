import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { GARAGE_SERVICES } from '../utils/garageServices';

// Manager-level hub — one card per service, each leading to a tracking list
// of every work order for that service across every salesman (see
// GarageServiceWorkOrders). Replaces the old disabled Tinting/Coating/Car
// Spray Home tiles, which never led anywhere.
export default function GarageWorkOrderTracking() {
  const navigate = useNavigate();

  return (
    <GarageShell title="Work Order Tracking" showBack>
      <div className="max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
        {GARAGE_SERVICES.map((s) => (
          <button
            key={s.key}
            onClick={() => navigate(`/garage/work-order-tracking/${s.key}`)}
            className="group relative overflow-hidden text-left rounded-2xl p-6 flex items-center gap-4
              bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card
              hover:border-gold-400/50 hover:bg-white/[0.06] hover:-translate-y-0.5 transition-all duration-300"
          >
            <div className="shrink-0 w-12 h-12 rounded-xl bg-gold-400/10 flex items-center justify-center text-gold-400">
              <s.icon size={22} strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-white font-semibold tracking-wide">{s.label}</h3>
              <p className="text-white/40 text-xs mt-0.5">Track every {s.label.toLowerCase()} work order</p>
            </div>
            <ChevronRight size={18} className="text-gold-400/60 group-hover:text-gold-400 group-hover:translate-x-0.5 transition-all shrink-0" />
          </button>
        ))}
      </div>
    </GarageShell>
  );
}
