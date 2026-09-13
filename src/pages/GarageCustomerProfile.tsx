import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Fingerprint, Phone, Mail, Car, Plus, ChevronRight, AlertCircle } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { getGarageCustomer, listGarageVehicles } from '../lib/garageCustomers';
import type { GarageCustomer, GarageVehicle } from '../types';

const SIZE_LABEL: Record<GarageVehicle['size'], string> = {
  standard: 'Standard',
  large: 'Large',
  xlarge: 'X-Large',
};

export default function GarageCustomerProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<GarageCustomer | null>(null);
  const [vehicles, setVehicles] = useState<GarageVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([getGarageCustomer(id), listGarageVehicles(id)])
      .then(([c, v]) => {
        if (cancelled) return;
        if (!c) { setNotFound(true); return; }
        setCustomer(c);
        setVehicles(v);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <GarageShell title="Customer Profile" showBack backTo="/garage/work-order/new">
        <p className="text-white/40 text-sm text-center py-20">Loading…</p>
      </GarageShell>
    );
  }

  if (notFound || !customer) {
    return (
      <GarageShell title="Customer Profile" showBack backTo="/garage/work-order/new">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle size={30} className="text-white/30 mb-3" />
          <p className="text-white/40 text-sm">Customer not found</p>
        </div>
      </GarageShell>
    );
  }

  return (
    <GarageShell title="Customer Profile" showBack backTo="/garage/work-order/new">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Customer info */}
        <div className="relative overflow-hidden rounded-[28px] p-8
          bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-full bg-gold-400/10 border border-gold-400/20 flex items-center justify-center text-gold-400 font-bold text-xl uppercase shrink-0">
              {customer.name.charAt(0)}
            </div>
            <div>
              <h2 className="font-display text-lg text-white font-semibold tracking-wide">{customer.name}</h2>
              <p className="text-white/40 text-xs">Customer since {new Date(customer.createdAt).toLocaleDateString('en-MY')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2.5 text-white/70">
              <Fingerprint size={15} className="text-white/30 shrink-0" /> {customer.icNumber}
            </div>
            <div className="flex items-center gap-2.5 text-white/70">
              <Phone size={15} className="text-white/30 shrink-0" /> {customer.phone}
            </div>
            {customer.email && (
              <div className="flex items-center gap-2.5 text-white/70 sm:col-span-2">
                <Mail size={15} className="text-white/30 shrink-0" /> {customer.email}
              </div>
            )}
          </div>
        </div>

        {/* Vehicles */}
        <div>
          <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-3">Vehicles</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {vehicles.map((v) => (
              <button
                key={v.id}
                onClick={() => navigate(`/garage/work-order/customer/${customer.id}/vehicle/${v.id}`)}
                className="group relative overflow-hidden text-left rounded-2xl p-5 flex items-center gap-4
                  bg-white/[0.04] backdrop-blur-xl border border-gold-400/15
                  hover:border-gold-400/50 hover:bg-white/[0.06] hover:-translate-y-0.5
                  transition-all duration-300 shadow-card"
              >
                <div className="shrink-0 w-11 h-11 rounded-xl bg-gold-400/10 flex items-center justify-center text-gold-400">
                  <Car size={20} strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-white font-semibold text-sm truncate">{v.year} {v.make} {v.model}</h4>
                  <p className="text-white/40 text-xs mt-0.5">{v.registrationNo} · {SIZE_LABEL[v.size]}</p>
                </div>
                <ChevronRight size={16} className="text-gold-400/50 group-hover:text-gold-400 transition-colors shrink-0" />
              </button>
            ))}

            <button
              onClick={() => navigate(`/garage/work-order/customer/${customer.id}/add-car`)}
              className="group relative overflow-hidden text-left rounded-2xl p-5 flex items-center gap-4
                bg-white/[0.02] border border-dashed border-gold-400/25
                hover:border-gold-400/50 hover:bg-white/[0.04] hover:-translate-y-0.5
                transition-all duration-300"
            >
              <div className="shrink-0 w-11 h-11 rounded-xl bg-gold-400/10 flex items-center justify-center text-gold-400">
                <Plus size={20} strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-white font-semibold text-sm">Add Vehicle</h4>
                <p className="text-white/40 text-xs mt-0.5">Register a new car for this customer</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </GarageShell>
  );
}
