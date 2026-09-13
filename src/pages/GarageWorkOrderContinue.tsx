import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Car, Layers, Sparkles, Shield, SprayCan } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { getGarageVehicle } from '../lib/garageCustomers';
import type { GarageVehicle } from '../types';

const SERVICES = [
  { key: 'tinted', label: 'Tinted', icon: Layers },
  { key: 'coating', label: 'Coating', icon: Sparkles },
  { key: 'ppf', label: 'PPF', icon: Shield },
  { key: 'spray', label: 'Spray', icon: SprayCan },
] as const;

// Reached once a vehicle is picked (new or existing) for the work order.
// Picking a service leads to that service's package/pricing step — the
// next thing to build.
export default function GarageWorkOrderContinue() {
  const { id, vehicleId } = useParams<{ id: string; vehicleId: string }>();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    getGarageVehicle(vehicleId).then(setVehicle);
  }, [vehicleId]);

  return (
    <GarageShell title="New Work Order" showBack backTo={`/garage/work-order/customer/${id}`}>
      <div className="flex flex-col items-center">
        {vehicle && (
          <div className="flex items-center gap-2.5 text-white/50 text-sm mb-8 bg-white/[0.03] border border-white/10 rounded-full px-4 py-2">
            <Car size={14} /> {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.registrationNo}
          </div>
        )}

        <p className="text-white/40 text-sm tracking-wide mb-8">Which service is this for?</p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 w-full max-w-3xl">
          {SERVICES.map((s) => (
            <ServiceCard
              key={s.key}
              icon={<s.icon size={30} strokeWidth={1.5} />}
              label={s.label}
              onClick={() => navigate(`/garage/work-order/customer/${id}/vehicle/${vehicleId}/service/${s.key}`)}
            />
          ))}
        </div>
      </div>
    </GarageShell>
  );
}

function ServiceCard({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-[24px] p-6 sm:p-8 flex flex-col items-center justify-center text-center
        sm:aspect-square
        bg-white/[0.04] backdrop-blur-xl border border-gold-400/15
        shadow-card-lg hover:shadow-gold-lg hover:border-gold-400/50 hover:bg-white/[0.06]
        hover:-translate-y-1.5 active:translate-y-0 active:scale-[0.99]
        transition-all duration-500 ease-out"
    >
      <div className="pointer-events-none absolute -inset-x-10 -top-24 h-40 rotate-[-18deg]
        bg-gradient-to-b from-white/[0.14] to-transparent blur-md
        opacity-50 group-hover:opacity-90 transition-opacity duration-500" />

      <div className="absolute top-4 left-4 w-4 h-4 border-l border-t border-gold-400/25
        group-hover:border-gold-400/70 transition-colors duration-500" />
      <div className="absolute bottom-4 right-4 w-4 h-4 border-r border-b border-gold-400/25
        group-hover:border-gold-400/70 transition-colors duration-500" />

      <div className="relative mb-5 flex items-center justify-center">
        <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl
          group-hover:bg-gold-400/25 transition-colors duration-500" />
        <div className="relative text-gold-400">{icon}</div>
      </div>

      <h2 className="font-display text-base md:text-lg font-semibold text-white tracking-wide">{label}</h2>
    </button>
  );
}
