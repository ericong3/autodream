import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Car, FileText, ChevronRight } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { getGarageVehicle } from '../lib/garageCustomers';
import { listInvoicesForVehicle } from '../lib/garageInvoices';
import { GARAGE_SERVICES, GARAGE_SERVICE_MAP } from '../utils/garageServices';
import type { GarageVehicle, GarageInvoice } from '../types';

// Reached once a vehicle is picked (new or existing) for the work order.
// Picking a service leads to that service's package/pricing step — the
// next thing to build. Below it, this vehicle's invoice history — where a
// warranty claim (supplier's cost) or replacement (company's cost) gets
// filed once the car's already been delivered.
export default function GarageWorkOrderContinue() {
  const { id, vehicleId } = useParams<{ id: string; vehicleId: string }>();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const [invoices, setInvoices] = useState<GarageInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);

  useEffect(() => {
    if (!vehicleId) return;
    getGarageVehicle(vehicleId).then(setVehicle);
    listInvoicesForVehicle(vehicleId).then(setInvoices).finally(() => setLoadingInvoices(false));
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

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 w-full max-w-3xl mb-12">
          {GARAGE_SERVICES.map((s) => (
            <ServiceCard
              key={s.key}
              icon={<s.icon size={30} strokeWidth={1.5} />}
              label={s.label}
              onClick={() => navigate(`/garage/work-order/customer/${id}/vehicle/${vehicleId}/service/${s.key}`)}
            />
          ))}
        </div>

        {/* Purchase history — where warranty claims / replacements get filed */}
        <div className="w-full max-w-3xl">
          <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-3">Purchase History</h3>

          {loadingInvoices ? (
            <p className="text-white/30 text-sm">Loading…</p>
          ) : invoices.length === 0 ? (
            <div className="flex items-center gap-2.5 text-white/40 text-sm bg-white/[0.03] border border-white/10 rounded-xl p-4">
              <FileText size={15} className="shrink-0" /> No previous services for this vehicle yet
            </div>
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => {
                const meta = GARAGE_SERVICE_MAP[inv.service];
                return (
                  <button
                    key={inv.id}
                    onClick={() => navigate(`/garage/invoice/${inv.id}`)}
                    className="w-full flex items-center gap-3 text-left rounded-xl p-4
                      bg-white/[0.04] backdrop-blur-xl border border-gold-400/15
                      hover:border-gold-400/40 hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="shrink-0 w-9 h-9 rounded-lg bg-gold-400/10 flex items-center justify-center text-gold-400">
                      <meta.icon size={16} strokeWidth={1.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{inv.invoiceNumber} · {meta.label}</p>
                      <p className="text-white/40 text-xs mt-0.5">{new Date(inv.invoiceDate).toLocaleDateString('en-MY')}</p>
                    </div>
                    <ChevronRight size={15} className="text-gold-400/50 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
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
