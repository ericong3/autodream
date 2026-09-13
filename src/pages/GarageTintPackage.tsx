import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Car, Layers, Settings, AlertCircle } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { useStore } from '../store';
import { getGarageVehicle } from '../lib/garageCustomers';
import { createGarageInvoice } from '../lib/garageInvoices';
import { getFullPrices, getPositionPrices, createTintOrder } from '../lib/garageTint';
import { TINT_SERIES, GLASS_POSITIONS, EXTRA_GLASS_OPTIONS, VLT_OPTIONS } from '../utils/tintPricing';
import { formatRM } from '../utils/format';
import type {
  GarageVehicle, TintPackageType, TintSeries, GlassPosition, ExtraGlassKey, TintPositionSelection,
} from '../types';

type MixState = Record<GlassPosition, { series: TintSeries | ''; vlt: string }>;
type ExtraState = Record<ExtraGlassKey, { included: boolean; series: TintSeries | ''; vlt: string }>;

const emptyMix: MixState = {
  front_windscreen: { series: '', vlt: '' },
  door_window: { series: '', vlt: '' },
  rear_panel_window: { series: '', vlt: '' },
  rear_windscreen: { series: '', vlt: '' },
};

const emptyExtras: ExtraState = {
  extra_rear_2pc: { included: false, series: '', vlt: '' },
  small_window: { included: false, series: '', vlt: '' },
};

// Extra Rear Window bills at the Rear Panel Window rate (no separate price
// to set); Small Window is complimentary — never adds to the total, even
// though the series/VLT actually used still gets recorded.
function extraPrice(key: ExtraGlassKey, series: TintSeries, positionPrices: Record<string, number>): number {
  if (key === 'small_window') return 0;
  return positionPrices[`rear_panel_window|${series}`] ?? 0;
}

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
  const [fullVlt, setFullVlt] = useState('');
  const [mix, setMix] = useState<MixState>(emptyMix);
  const [extras, setExtras] = useState<ExtraState>(emptyExtras);
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
  const availableExtras = EXTRA_GLASS_OPTIONS.filter((ex) => !ex.xlargeOnly || size === 'xlarge');

  const fullPrice = fullSeries ? (fullPrices[`${fullSeries}|${size}`] ?? 0) : 0;
  const mixTotal = GLASS_POSITIONS.reduce((sum, pos) => {
    const sel = mix[pos.key];
    if (!sel.series) return sum;
    return sum + (positionPrices[`${pos.key}|${sel.series}`] ?? 0);
  }, 0);
  const extrasTotal = availableExtras.reduce((sum, ex) => {
    const state = extras[ex.key];
    if (!state.included) return sum;
    const series = packageType === 'full' ? fullSeries : state.series;
    if (!series) return sum;
    return sum + extraPrice(ex.key, series, positionPrices);
  }, 0);
  const subtotal = (packageType === 'full' ? fullPrice : mixTotal) + extrasTotal;
  const finalTotal = Math.max(0, subtotal - discount);

  const handleSave = async () => {
    if (packageType === 'full' && (!fullSeries || !fullVlt)) {
      setError('Choose a series and VLT for the Full Package');
      return;
    }
    if (packageType === 'mix' && GLASS_POSITIONS.some((p) => !mix[p.key].series || !mix[p.key].vlt)) {
      setError('Choose a series and VLT for every glass position');
      return;
    }
    if (packageType === 'mix' && availableExtras.some((ex) => extras[ex.key].included && (!extras[ex.key].series || !extras[ex.key].vlt))) {
      setError('Choose a series and VLT for every selected extra');
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
            price: positionPrices[`${p.key}|${mix[p.key].series}`] ?? 0,
          }))
        : [];
      const extraSelections: TintPositionSelection[] = availableExtras
        .filter((ex) => extras[ex.key].included)
        .map((ex) => {
          const series = (packageType === 'full' ? fullSeries : extras[ex.key].series) as TintSeries;
          const vlt = packageType === 'full' ? fullVlt : extras[ex.key].vlt;
          return { position: ex.key, series, vlt, price: extraPrice(ex.key, series, positionPrices) };
        });
      await createTintOrder({
        invoiceId: invoice.id,
        packageType,
        fullSeries: packageType === 'full' ? (fullSeries as TintSeries) : undefined,
        fullVlt: packageType === 'full' ? fullVlt : undefined,
        selections,
        extras: extraSelections,
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
                <p className="text-white/40 text-sm mb-6">Choose one series and VLT for the whole car</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
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

                <label className="block text-white/50 text-xs font-medium mb-2">VLT (Darkness)</label>
                <div className="flex flex-wrap gap-2 mb-6">
                  {VLT_OPTIONS.map((v) => (
                    <button
                      key={v}
                      onClick={() => setFullVlt(v)}
                      className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        fullVlt === v
                          ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                          : 'bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>

                <div className="pt-5 border-t border-white/10 space-y-2.5">
                  <p className="text-white/50 text-xs font-medium">Extras</p>
                  {availableExtras.map((ex) => (
                    <label key={ex.key} className="flex items-center justify-between gap-3 cursor-pointer">
                      <span className="flex items-center gap-2 text-sm text-white/80">
                        <input
                          type="checkbox"
                          checked={extras[ex.key].included}
                          onChange={(e) => setExtras({ ...extras, [ex.key]: { ...extras[ex.key], included: e.target.checked } })}
                          className="accent-gold-500"
                        />
                        {ex.label}
                      </span>
                      <span className="text-white/40 text-xs">
                        {ex.key === 'small_window' ? 'Free' : fullSeries ? formatRM(extraPrice(ex.key, fullSeries, positionPrices)) : '—'}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h2 className="font-display text-lg text-white font-semibold tracking-wide mb-1">Mix &amp; Match</h2>
                <p className="text-white/40 text-sm mb-6">Select series and VLT for each glass position</p>
                <div className="space-y-3 mb-6">
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

                <div className="pt-5 border-t border-white/10 space-y-3">
                  <p className="text-white/50 text-xs font-medium">Extras</p>
                  {availableExtras.map((ex) => (
                    <div key={ex.key} className="grid grid-cols-1 sm:grid-cols-[140px_1fr_100px] gap-2 items-center">
                      <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={extras[ex.key].included}
                          onChange={(e) => setExtras({ ...extras, [ex.key]: { ...extras[ex.key], included: e.target.checked } })}
                          className="accent-gold-500"
                        />
                        {ex.label}
                        {ex.key === 'small_window' && <span className="text-white/30 text-xs">(Free)</span>}
                      </label>
                      <select
                        disabled={!extras[ex.key].included}
                        className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                          text-white text-sm outline-none transition-colors appearance-none disabled:opacity-40"
                        value={extras[ex.key].series}
                        onChange={(e) => setExtras({ ...extras, [ex.key]: { ...extras[ex.key], series: e.target.value as TintSeries } })}
                      >
                        <option value="" className="bg-obsidian-800">Select series</option>
                        {TINT_SERIES.map((s) => <option key={s.key} value={s.key} className="bg-obsidian-800">{s.label}</option>)}
                      </select>
                      <select
                        disabled={!extras[ex.key].included}
                        className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                          text-white text-sm outline-none transition-colors appearance-none disabled:opacity-40"
                        value={extras[ex.key].vlt}
                        onChange={(e) => setExtras({ ...extras, [ex.key]: { ...extras[ex.key], vlt: e.target.value } })}
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
              {extrasTotal > 0 && (
                <div className="flex justify-between text-white/50">
                  <span>Extras</span>
                  <span className="text-white">{formatRM(extrasTotal)}</span>
                </div>
              )}
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
