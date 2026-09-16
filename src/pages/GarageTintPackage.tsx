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
type FullVltState = Record<GlassPosition, string>;
type ExtraState = Record<ExtraGlassKey, { included: boolean; series: TintSeries | ''; vlt: string }>;
type VltGroupMode = 'individual' | 'whole' | 'front_rear';

// "Front" = the 3 pieces facing forward; "rear" = whatever's left (just the
// rear windscreen, with the current 4-position set).
const FRONT_GROUP: GlassPosition[] = ['front_windscreen', 'door_window', 'rear_panel_window'];
const REAR_GROUP: GlassPosition[] = ['rear_windscreen'];

const emptyMix: MixState = {
  front_windscreen: { series: '', vlt: '' },
  door_window: { series: '', vlt: '' },
  rear_panel_window: { series: '', vlt: '' },
  rear_windscreen: { series: '', vlt: '' },
};

const emptyFullVlt: FullVltState = {
  front_windscreen: '', door_window: '', rear_panel_window: '', rear_windscreen: '',
};

const emptyExtras: ExtraState = {
  extra_rear_2pc: { included: false, series: '', vlt: '' },
  small_window: { included: false, series: '', vlt: '' },
};

// Extra Rear Window bills at the Rear Panel Window rate (no separate price
// to set); Small Window is complimentary. Both are only ever charged in
// Mix & Match — Full Package's price is flat no matter what's toggled on.
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
  const [fullVlt, setFullVlt] = useState<FullVltState>(emptyFullVlt);
  const [vltGroupMode, setVltGroupMode] = useState<VltGroupMode>('individual');
  const [wholeVlt, setWholeVlt] = useState('');
  const [frontVlt, setFrontVlt] = useState('');
  const [rearVlt, setRearVlt] = useState('');
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

  // Full Package's VLT, resolved for whichever grouping mode is active.
  function effectiveFullVlt(pos: GlassPosition): string {
    if (vltGroupMode === 'whole') return wholeVlt;
    if (vltGroupMode === 'front_rear') return FRONT_GROUP.includes(pos) ? frontVlt : rearVlt;
    return fullVlt[pos];
  }

  const fullPrice = fullSeries ? (fullPrices[`${fullSeries}|${size}`] ?? 0) : 0;
  const mixTotal = GLASS_POSITIONS.reduce((sum, pos) => {
    const sel = mix[pos.key];
    if (!sel.series) return sum;
    return sum + (positionPrices[`${pos.key}|${sel.series}`] ?? 0);
  }, 0);
  // Extras only ever add cost in Mix & Match — Full Package's price never
  // changes regardless of what's toggled on.
  const extrasTotal = packageType === 'mix'
    ? availableExtras.reduce((sum, ex) => {
        const state = extras[ex.key];
        if (!state.included || !state.series) return sum;
        return sum + extraPrice(ex.key, state.series, positionPrices);
      }, 0)
    : 0;
  const subtotal = (packageType === 'full' ? fullPrice : mixTotal) + extrasTotal;
  const finalTotal = Math.max(0, subtotal - discount);

  const handleSave = async () => {
    if (packageType === 'full') {
      if (!fullSeries) { setError('Choose a series for the Full Package'); return; }
      if (vltGroupMode === 'whole' && !wholeVlt) { setError('Choose a VLT for the whole car'); return; }
      if (vltGroupMode === 'front_rear' && (!frontVlt || !rearVlt)) { setError('Choose a VLT for both the front and rear groups'); return; }
      if (vltGroupMode === 'individual' && GLASS_POSITIONS.some((p) => !fullVlt[p.key])) { setError('Choose a VLT for every window'); return; }
      if (availableExtras.some((ex) => extras[ex.key].included && !extras[ex.key].vlt)) { setError('Choose a VLT for every selected extra'); return; }
    } else {
      if (GLASS_POSITIONS.some((p) => !mix[p.key].series || !mix[p.key].vlt)) { setError('Choose a series and VLT for every glass position'); return; }
      if (availableExtras.some((ex) => extras[ex.key].included && (!extras[ex.key].series || !extras[ex.key].vlt))) {
        setError('Choose a series and VLT for every selected extra');
        return;
      }
    }
    setError('');
    setSaving(true);
    try {
      const invoice = await createGarageInvoice({
        customerId: id!, vehicleId: vehicleId!, service: 'tinted', createdBy: currentUser?.id,
      });
      const selections: TintPositionSelection[] = packageType === 'full'
        ? GLASS_POSITIONS.map((p) => ({ position: p.key, series: fullSeries as TintSeries, vlt: effectiveFullVlt(p.key), price: 0 }))
        : GLASS_POSITIONS.map((p) => ({
            position: p.key,
            series: mix[p.key].series as TintSeries,
            vlt: mix[p.key].vlt,
            price: positionPrices[`${p.key}|${mix[p.key].series}`] ?? 0,
          }));
      const extraSelections: TintPositionSelection[] = availableExtras
        .filter((ex) => extras[ex.key].included)
        .map((ex) => {
          const series = (packageType === 'full' ? fullSeries : extras[ex.key].series) as TintSeries;
          const vlt = extras[ex.key].vlt;
          const price = packageType === 'full' ? 0 : extraPrice(ex.key, series, positionPrices);
          return { position: ex.key, series, vlt, price };
        });
      await createTintOrder({
        invoiceId: invoice.id,
        packageType,
        fullSeries: packageType === 'full' ? (fullSeries as TintSeries) : undefined,
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
                <p className="text-white/40 text-sm mb-6">One series for the whole car — price doesn't change however VLT or extras are set</p>
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

                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <label className="block text-white/50 text-xs font-medium">VLT (Darkness)</label>
                  <div className="flex gap-1.5">
                    {([
                      ['individual', 'Per Window'],
                      ['whole', 'Whole Car'],
                      ['front_rear', 'Front & Rear'],
                    ] as [VltGroupMode, string][]).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setVltGroupMode(mode)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                          vltGroupMode === mode
                            ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                            : 'bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {vltGroupMode === 'individual' && (
                  <div className="space-y-2 mb-6">
                    {GLASS_POSITIONS.map((pos) => (
                      <div key={pos.key} className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2 items-center">
                        <span className="text-white/70 text-sm">{pos.label}</span>
                        <select
                          className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                            text-white text-sm outline-none transition-colors appearance-none"
                          value={fullVlt[pos.key]}
                          onChange={(e) => setFullVlt({ ...fullVlt, [pos.key]: e.target.value })}
                        >
                          <option value="" className="bg-obsidian-800">VLT</option>
                          {VLT_OPTIONS.map((v) => <option key={v} value={v} className="bg-obsidian-800">{v}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}

                {vltGroupMode === 'whole' && (
                  <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2 items-center mb-6">
                    <span className="text-white/70 text-sm">Whole Car</span>
                    <select
                      className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                        text-white text-sm outline-none transition-colors appearance-none"
                      value={wholeVlt}
                      onChange={(e) => setWholeVlt(e.target.value)}
                    >
                      <option value="" className="bg-obsidian-800">VLT</option>
                      {VLT_OPTIONS.map((v) => <option key={v} value={v} className="bg-obsidian-800">{v}</option>)}
                    </select>
                  </div>
                )}

                {vltGroupMode === 'front_rear' && (
                  <div className="space-y-2 mb-6">
                    <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2 items-center">
                      <span className="text-white/70 text-sm">
                        Front
                        <span className="block text-white/30 text-[11px]">
                          {FRONT_GROUP.map((k) => GLASS_POSITIONS.find((p) => p.key === k)?.label).join(', ')}
                        </span>
                      </span>
                      <select
                        className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                          text-white text-sm outline-none transition-colors appearance-none"
                        value={frontVlt}
                        onChange={(e) => setFrontVlt(e.target.value)}
                      >
                        <option value="" className="bg-obsidian-800">VLT</option>
                        {VLT_OPTIONS.map((v) => <option key={v} value={v} className="bg-obsidian-800">{v}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2 items-center">
                      <span className="text-white/70 text-sm">
                        Rear
                        <span className="block text-white/30 text-[11px]">
                          {REAR_GROUP.map((k) => GLASS_POSITIONS.find((p) => p.key === k)?.label).join(', ')}
                        </span>
                      </span>
                      <select
                        className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                          text-white text-sm outline-none transition-colors appearance-none"
                        value={rearVlt}
                        onChange={(e) => setRearVlt(e.target.value)}
                      >
                        <option value="" className="bg-obsidian-800">VLT</option>
                        {VLT_OPTIONS.map((v) => <option key={v} value={v} className="bg-obsidian-800">{v}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                <div className="pt-5 border-t border-white/10 space-y-2.5">
                  <p className="text-white/50 text-xs font-medium">Extras (no extra charge)</p>
                  {availableExtras.map((ex) => (
                    <div key={ex.key} className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2 items-center">
                      <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={extras[ex.key].included}
                          onChange={(e) => setExtras({ ...extras, [ex.key]: { ...extras[ex.key], included: e.target.checked } })}
                          className="accent-gold-500"
                        />
                        {ex.label}
                      </label>
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
              {packageType === 'full' ? (
                <div className="flex justify-between text-white/50">
                  <span>Full Package Price</span>
                  <span className="text-white">{formatRM(fullPrice)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-white/50">
                    <span>Mix &amp; Match Total</span>
                    <span className="text-white">{formatRM(mixTotal)}</span>
                  </div>
                  {extrasTotal > 0 && (
                    <div className="flex justify-between text-white/50">
                      <span>Extras</span>
                      <span className="text-white">{formatRM(extrasTotal)}</span>
                    </div>
                  )}
                </>
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
