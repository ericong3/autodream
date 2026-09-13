import { UserPlus } from 'lucide-react';
import GarageShell from '../components/GarageShell';

// Stub — the actual new-customer profile + work order form gets built next.
export default function GarageWorkOrderNewCustomer() {
  return (
    <GarageShell title="New Customer" showBack backTo="/garage/work-order/new">
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="relative mb-5 flex items-center justify-center">
          <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl" />
          <UserPlus size={34} strokeWidth={1.5} className="relative text-gold-400/70" />
        </div>
        <p className="text-white/40 text-sm">Customer profile form — coming soon</p>
      </div>
    </GarageShell>
  );
}
