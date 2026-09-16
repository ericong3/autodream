import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Car, User, Phone, Layers, CheckCircle2, Send } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { useStore } from '../store';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import { createGarageInvoice } from '../lib/garageInvoices';
import { createTintOrder } from '../lib/garageTint';
import { createInstallerJob } from '../lib/garageInstallerJobs';
import { TINT_SERIES, GLASS_POSITIONS, EXTRA_GLASS_OPTIONS } from '../utils/tintPricing';
import { formatRM } from '../utils/format';
import type {
  GarageVehicle, GarageCustomer, TintPackageType, TintSeries, TintPositionSelection,
} from '../types';

const TINT_SERIES_LABEL = Object.fromEntries(TINT_SERIES.map((s) => [s.key, s.label]));
const GLASS_POSITION_LABEL = Object.fromEntries([...GLASS_POSITIONS, ...EXTRA_GLASS_OPTIONS].map((p) => [p.key, p.label]));

// Built by GarageTintPackage and handed over via router state — nothing is
// persisted until this page's Confirm button is pressed.
interface PendingTintOrder {
  packageType: TintPackageType;
  fullSeries?: TintSeries;
  selections: TintPositionSelection[];
  extras: TintPositionSelection[];
  discount: number;
  finalTotal: number;
}

export default function GarageWorkOrderSummary() {
  const { id, vehicleId } = useParams<{ id: string; vehicleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = useStore((s) => s.currentUser);

  const pending = location.state as PendingTintOrder | undefined;

  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const [customer, setCustomer] = useState<GarageCustomer | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!pending) {
      navigate(`/garage/work-order/customer/${id}/vehicle/${vehicleId}/service/tinted`, { replace: true });
      return;
    }
    if (!id || !vehicleId) return;
    Promise.all([getGarageVehicle(vehicleId), getGarageCustomer(id)])
      .then(([v, c]) => { setVehicle(v); setCustomer(c); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!pending) return null;

  const backToPackage = `/garage/work-order/customer/${id}/vehicle/${vehicleId}/service/tinted`;

  const handleConfirm = async () => {
    setConfirming(true);
    setError('');
    try {
      const invoice = await createGarageInvoice({
        customerId: id!, vehicleId: vehicleId!, service: 'tinted', createdBy: currentUser?.id,
      });
      await createTintOrder({
        invoiceId: invoice.id,
        packageType: pending.packageType,
        fullSeries: pending.fullSeries,
        selections: pending.selections,
        extras: pending.extras,
        discount: pending.discount,
        finalTotal: pending.finalTotal,
      });
      // Only Tint has an installer queue so far — Coating/PPF/Spray will get
      // their own worker queues later.
      if (invoice.service === 'tinted') {
        await createInstallerJob({ invoiceId: invoice.id, service: invoice.service });
      }
      setDone(true);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong — please try again');
    } finally {
      setConfirming(false);
    }
  };

  if (done) {
    return (
      <GarageShell title="Order Summary" showBack={false}>
        <div className="max-w-lg mx-auto flex flex-col items-center text-center py-16">
          <div className="relative mb-5 flex items-center justify-center">
            <div className="absolute w-20 h-20 rounded-full bg-emerald-400/10 blur-xl" />
            <CheckCircle2 size={40} strokeWidth={1.5} className="relative text-emerald-400" />
          </div>
          <h2 className="font-display text-xl text-white font-semibold tracking-wide mb-2">Work Order Confirmed</h2>
          <p className="text-white/50 text-sm mb-8">Sent to the installer — they can now accept the job.</p>
          <button
            onClick={() => navigate('/garage/dashboard')}
            className="btn-gold px-6 py-2.5 rounded-xl text-sm"
          >
            Back to Dashboard
          </button>
        </div>
      </GarageShell>
    );
  }

  return (
    <GarageShell title="Order Summary" showBack backTo={backToPackage}>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="relative overflow-hidden rounded-[28px] p-8
          bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
          {loading ? (
            <p className="text-white/40 text-sm text-center py-10">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mb-6">
                {vehicle && (
                  <div className="flex items-center gap-2.5 text-white/70">
                    <Car size={15} className="text-white/30 shrink-0" /> {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.registrationNo}
                  </div>
                )}
                {customer && (
                  <div className="flex items-center gap-2.5 text-white/70">
                    <User size={15} className="text-white/30 shrink-0" /> {customer.name}
                  </div>
                )}
                {customer?.phone && (
                  <div className="flex items-center gap-2.5 text-white/70">
                    <Phone size={15} className="text-white/30 shrink-0" /> {customer.phone}
                  </div>
                )}
              </div>

              <div className="pt-5 border-t border-white/10">
                <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Layers size={13} /> {pending.packageType === 'full' ? 'Full Package' : 'Mix & Match'}
                </h3>

                {pending.packageType === 'full' && pending.fullSeries && (
                  <p className="text-white text-sm mb-3">{TINT_SERIES_LABEL[pending.fullSeries]} — same series for every window</p>
                )}
                <div className="space-y-1.5">
                  {pending.selections.map((sel) => (
                    <div key={sel.position} className="flex items-center justify-between text-sm">
                      <span className="text-white/60">{GLASS_POSITION_LABEL[sel.position]}</span>
                      <span className="text-white">
                        {pending.packageType === 'mix' ? `${TINT_SERIES_LABEL[sel.series]} · ` : ''}{sel.vlt}
                      </span>
                    </div>
                  ))}
                </div>

                {pending.extras.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-white/10 space-y-1.5">
                    <p className="text-white/40 text-xs mb-1">Extras</p>
                    {pending.extras.map((sel) => (
                      <div key={sel.position} className="flex items-center justify-between text-sm">
                        <span className="text-white/60">{GLASS_POSITION_LABEL[sel.position]}</span>
                        <span className="text-white">{TINT_SERIES_LABEL[sel.series]} · {sel.vlt}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-5 pt-4 border-t border-white/10 space-y-1.5">
                  {pending.discount > 0 && (
                    <div className="flex justify-between text-sm text-white/50">
                      <span>Discount</span>
                      <span>-{formatRM(pending.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-baseline">
                    <span className="text-white font-semibold text-sm">Final Total</span>
                    <span className="text-gold-400 font-display text-lg font-bold">{formatRM(pending.finalTotal)}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {error && <p className="text-red-400 text-xs text-center">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={() => navigate(backToPackage)}
            className="flex-1 px-4 py-3 btn-ghost rounded-xl text-sm"
          >
            Edit
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming || loading}
            className="flex-[2] flex items-center justify-center gap-2 btn-gold px-4 py-3 rounded-xl text-sm disabled:opacity-60"
          >
            <Send size={15} /> {confirming ? 'Sending…' : 'Confirm & Send to Installer'}
          </button>
        </div>
      </div>
    </GarageShell>
  );
}
