import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Car, Layers, Settings, AlertCircle } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { useStore } from '../store';
import { getGarageVehicle } from '../lib/garageCustomers';
import { createGarageInvoice } from '../lib/garageInvoices';
import { getFullPrices, getPositionPrices, createTintOrder } from '../lib/garageTint';
import { TINT_SERIES, GLASS_POSITIONS, VLT_OPTIONS } from '../utils/tintPricing';
import { formatRM } from '../utils/format';
import type { GarageVehicle, TintPackageType, TintSeries, GlassPosition, TintPositionSelection } from '../types';

type MixState = Record<GlassPosition, { series: TintSeries | ''; vlt: string }>;

const emptyMix: MixState = {
  front_windscreen: { series: '', vlt: '' },
  front_side: { series: '', vlt: '' },
  rear_side: { series: '', vlt: '' },
  rear_windscreen: { series: '', vlt: '' },
};

export default function GarageTintPackage() {
  const { id, vehicleId } = useParams<{ id: string; vehicleId: string }>();
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const canEditPricing = currentUser?.role === 'director' || currentUser?.role === 'shareholder';

  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const [fullPrices, setFullPrices] = useState<Record<string, number>>({});
  const [positionPrices, setPositionPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [packageType, setPackageType] = useState<TintPackageType>('full');
  const [fullSeries, setFullSeries] = useState<TintSeries | ''>('');
  const [mix, setMix] = useState<MixState>(emptyMix);
  const [discount, setDiscount] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!vehicleId) return;
    Promise.all([getGarageVehicle(vehicleId), getFullPrices(), getPositionPrices()])
      .then(([v, f, p]) => { setVehicle(v); setFullPrices(f); setPositionPrices(p); })
      .finally(() => setLoading(false));
  }, [vehicleId]);

  const size = vehicle?.size ?? 'standard';
  const fullPrice = fullSeries ? (fullPrices[`${fullSeries}|${size}`] ?? 0) : 0;
  const mixTotal = GLASS_POSITIONS.reduce((sum, pos) => {
    const sel = mix[pos.key];
    if (!sel.series) return sum;
    return sum + (positionPrices[`${pos.key}|${sel.series}|${size}`] ?? 0);
  }, 0);
  const subtotal = packageType === 'full' ? fullPrice : mixTotal;
  const finalTotal = Math.max(0, subtotal - discount);

  const handleSave = async () => {
    if (packageType === 'full' && !fullSeries) { setError('Choose a series for the Full Package'); return; }
    if (packageType === 'mix' && GLASS_POSITIONS.some((p) => !mix[p.key].series || !mix[p.key].vlt)) {
      setError('Choose a series and VLT for every glass position');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const invoice = await createGarageInvoice({
        customerId: id!, vehicleId: vehicleId!, service: 'tinted', createdBy: currentUser?.id,
      });
      const selections: TintPositionSelection[] = packageType === 'mix'
        ? GLASS_POSITIONS.map((p) => ({
            position: p.key,
            series: mix[p.key].series as TintSeries,
            vlt: mix[p.key].vlt,
            price: positionPrices[`${p.key}|${mix[p.key].series}|${size}`] ?? 0,
          }))
        : [];
      await createTintOrder({
        invoiceId: invoice.id,
        packageType,
        fullSeries: packageType === 'full' ? (fullSeries as TintSeries) : undefined,
        selections,
        discount,
        finalTotal,
      });
      navigate(`/garage/invoice/${invoice.id}`);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong — please try again');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <GarageShell title="Tint Package" showBack backTo={`/garage/work-order/customer/${id}/vehicle/${vehicleId}`}>
        <p className="text-white/40 text-sm text-center py-20">Loading…</p>
      </GarageShell>
    );
  }

  return (
    <GarageShell title="Tint Package" showBack backTo={`/garage/work-order/customer/${id}/vehicle/${vehicleId}`}>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
          {vehicle && (
            <div className="flex items-center gap-2.5 text-white/50 text-sm bg-white/[0.03] border border-white/10 rounded-full px-4 py-2">
              <Car size={14} /> {vehicle.year} {vehicle.make} {vehicle.model} · Size: {size[0].toUpperCase() + size.slice(1)}
            </div>
          )}
          {canEditPricing && (
            <button
              onClick={() => navigate('/garage/tint-pricing')}
              className="flex items-center gap-1.5 text-white/40 hover:text-gold-400 text-xs transition-colors"
            >
              <Settings size={13} /> Edit Pricing
            </button>
          )}
        </div>

        {/* Package type toggle */}
        <div className="grid grid-cols-2 gap-3 mb-6 max-w-sm">
          {(['full', 'mix'] as TintPackageType[]).map((t) => (
            <button
              key={t}
              onClick={() => setPackageType(t)}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                packageType === t
                  ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                  : 'bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
              }`}
            >
              <Layers size={15} /> {t === 'full' ? 'Full Package' : 'Mix & Match'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
          {/* Selection panel */}
          <div className="relative overflow-hidden rounded-[28px] p-6 sm:p-8 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
            {packageType === 'full' ? (
              <>
                <h2 className="font-display text-lg text-white font-semibold tracking-wide mb-1">Full Package</h2>
                <p className="text-white/40 text-sm mb-6">Choose one series for all windows</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {TINT_SERIES.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setFullSeries(s.key)}
                      className={`px-3 py-3 rounded-xl border text-sm font-medium transition-colors ${
                        fullSeries === s.key
                          ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                          : 'bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h2 className="font-display text-lg text-white font-semibold tracking-wide mb-1">Mix &amp; Match</h2>
                <p className="text-white/40 text-sm mb-6">Select series and VLT for each glass position</p>
                <div className="space-y-3">
                  {GLASS_POSITIONS.map((pos) => (
                    <div key={pos.key} className="grid grid-cols-1 sm:grid-cols-[140px_1fr_100px] gap-2 items-center">
                      <span className="text-white/70 text-sm">{pos.label}</span>
                      <select
                        className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                          text-white text-sm outline-none transition-colors appearance-none"
                        value={mix[pos.key].series}
                        onChange={(e) => setMix({ ...mix, [pos.key]: { ...mix[pos.key], series: e.target.value as TintSeries } })}
                      >
                        <option value="" className="bg-obsidian-800">Select series</option>
                        {TINT_SERIES.map((s) => <option key={s.key} value={s.key} className="bg-obsidian-800">{s.label}</option>)}
                      </select>
                      <select
                        className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                          text-white text-sm outline-none transition-colors appearance-none"
                        value={mix[pos.key].vlt}
                        onChange={(e) => setMix({ ...mix, [pos.key]: { ...mix[pos.key], vlt: e.target.value } })}
                      >
                        <option value="" className="bg-obsidian-800">VLT</option>
                        {VLT_OPTIONS.map((v) => <option key={v} value={v} className="bg-obsidian-800">{v}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Price summary */}
          <div className="relative overflow-hidden rounded-[28px] p-6 sm:p-8 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg h-fit">
            <h2 className="font-display text-lg text-white font-semibold tracking-wide mb-5">Price Summary</h2>

            <div className="space-y-2.5 text-sm mb-4">
              <div className="flex justify-between text-white/50">
                <span>Full Package Price</span>
                <span className={packageType === 'full' ? 'text-white' : ''}>{formatRM(packageType === 'full' ? fullPrice : 0)}</span>
              </div>
              <div className="flex justify-between text-white/50">
                <span>Mix &amp; Match Total</span>
                <span className={packageType === 'mix' ? 'text-white' : ''}>{formatRM(packageType === 'mix' ? mixTotal : 0)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 py-3 border-t border-white/10">
              <label className="text-white/50 text-sm">Discount</label>
              <div className="relative w-32">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 text-xs">RM</span>
                <input
                  type="number"
                  min={0}
                  className="w-full bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg
                    pl-8 pr-2 py-1.5 text-white text-sm text-right outline-none transition-colors"
                  value={discount || ''}
                  onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="flex justify-between items-baseline pt-3 border-t border-white/10 mb-6">
              <span className="text-white font-semibold">Final Total</span>
              <span className="text-gold-400 font-display text-xl font-bold">{formatRM(finalTotal)}</span>
            </div>

            {error && (
              <p className="text-red-400 text-xs mb-3 flex items-center gap-1.5"><AlertCircle size={12} /> {error}</p>
            )}

            <button onClick={handleSave} disabled={saving} className="w-full btn-gold py-3 rounded-xl text-sm disabled:opacity-60">
              {saving ? 'Saving…' : 'Confirm Work Order'}
            </button>
          </div>
        </div>
      </div>
    </GarageShell>
  );
}
