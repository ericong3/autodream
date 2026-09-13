import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Car, Layers, Sparkles, Shield, SprayCan, Wrench } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { getGarageVehicle } from '../lib/garageCustomers';
import type { GarageVehicle } from '../types';

const SERVICE_LABEL: Record<string, { label: string; icon: typeof Layers }> = {
  tinted: { label: 'Tinted', icon: Layers },
  coating: { label: 'Coating', icon: Sparkles },
  ppf: { label: 'PPF', icon: Shield },
  spray: { label: 'Spray', icon: SprayCan },
};

// Reached once a service is picked. Package/pricing/confirm for each
// service is the next thing to build.
export default function GarageServiceStub() {
  const { id, vehicleId, service } = useParams<{ id: string; vehicleId: string; service: string }>();
  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const meta = (service && SERVICE_LABEL[service]) || { label: 'Service', icon: Wrench };

  useEffect(() => {
    if (!vehicleId) return;
    getGarageVehicle(vehicleId).then(setVehicle);
  }, [vehicleId]);

  return (
    <GarageShell title="New Work Order" showBack backTo={`/garage/work-order/customer/${id}/vehicle/${vehicleId}`}>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        {vehicle && (
          <div className="flex items-center gap-2.5 text-white/50 text-sm mb-6 bg-white/[0.03] border border-white/10 rounded-full px-4 py-2">
            <Car size={14} /> {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.registrationNo}
          </div>
        )}
        <div className="relative mb-5 flex items-center justify-center">
          <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl" />
          <meta.icon size={34} strokeWidth={1.5} className="relative text-gold-400/70" />
        </div>
        <p className="text-white/40 text-sm">{meta.label} package &amp; pricing — coming soon</p>
      </div>
    </GarageShell>
  );
}
