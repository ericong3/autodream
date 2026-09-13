import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { getFullPrices, setFullPrice, getPositionPrices, setPositionPrice } from '../lib/garageTint';
import { TINT_SERIES, VEHICLE_SIZES, GLASS_POSITIONS } from '../utils/tintPricing';
import type { TintSeries, GlassPosition, GarageVehicleSize } from '../types';

// Extra Rear Window bills at the Rear Panel Window rate and Small Window is
// always free — neither needs its own price, so this grid only covers the
// 4 standard glass positions.
const POSITION_TABS = GLASS_POSITIONS;

function PriceCell({
  value, saved, onCommit,
}: { value: number; saved: boolean; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState(String(value || ''));
  useEffect(() => setLocal(String(value || '')), [value]);

  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 text-xs">RM</span>
      <input
        type="number"
        min={0}
        className="w-full bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg
          pl-8 pr-6 py-2 text-white text-sm text-right outline-none transition-colors"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = Number(local) || 0;
          if (n !== value) onCommit(n);
        }}
      />
      {saved && <Check size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-green-400" />}
    </div>
  );
}

export default function GarageTintPricing() {
  const [fullPrices, setFullPrices] = useState<Record<string, number>>({});
  const [positionPrices, setPositionPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [activePosition, setActivePosition] = useState<GlassPosition>('front_windscreen');
  const [justSaved, setJustSaved] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getFullPrices(), getPositionPrices()])
      .then(([f, p]) => { setFullPrices(f); setPositionPrices(p); })
      .finally(() => setLoading(false));
  }, []);

  const flashSaved = (key: string) => {
    setJustSaved(key);
    setTimeout(() => setJustSaved((k) => (k === key ? null : k)), 1500);
  };

  const commitFull = async (series: TintSeries, size: GarageVehicleSize, price: number) => {
    const key = `${series}|${size}`;
    setFullPrices((p) => ({ ...p, [key]: price }));
    await setFullPrice(series, size, price);
    flashSaved(key);
  };

  const commitPosition = async (position: GlassPosition, series: TintSeries, price: number) => {
    const key = `${position}|${series}`;
    setPositionPrices((p) => ({ ...p, [key]: price }));
    await setPositionPrice(position, series, price);
    flashSaved(key);
  };

  if (loading) {
    return (
      <GarageShell title="Tint Pricing" showBack backTo="/garage">
        <p className="text-white/40 text-sm text-center py-20">Loading…</p>
      </GarageShell>
    );
  }

  return (
    <GarageShell title="Tint Pricing" showBack backTo="/garage">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Full Package grid */}
        <div className="relative overflow-hidden rounded-[28px] p-6 sm:p-8 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
          <h2 className="font-display text-lg text-white font-semibold tracking-wide mb-1">Full Package</h2>
          <p className="text-white/40 text-sm mb-6">Price per series, by vehicle size</p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr>
                  <th className="text-left text-white/40 text-xs font-medium pb-2">Series</th>
                  {VEHICLE_SIZES.map((sz) => (
                    <th key={sz.key} className="text-left text-white/40 text-xs font-medium pb-2 px-2">{sz.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TINT_SERIES.map((s) => (
                  <tr key={s.key}>
                    <td className="text-white text-sm font-medium py-1.5 pr-3 whitespace-nowrap">{s.label}</td>
                    {VEHICLE_SIZES.map((sz) => {
                      const key = `${s.key}|${sz.key}`;
                      return (
                        <td key={sz.key} className="py-1.5 px-2 w-32">
                          <PriceCell
                            value={fullPrices[key] ?? 0}
                            saved={justSaved === key}
                            onCommit={(v) => commitFull(s.key, sz.key, v)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mix & Match / extras — per piece, by series only */}
        <div className="relative overflow-hidden rounded-[28px] p-6 sm:p-8 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
          <h2 className="font-display text-lg text-white font-semibold tracking-wide mb-1">Mix &amp; Match / Extras</h2>
          <p className="text-white/40 text-sm mb-5">Price per piece, by series — set separately for each glass position</p>

          <div className="flex items-center gap-2 mb-5 overflow-x-auto">
            {POSITION_TABS.map((pos) => (
              <button
                key={pos.key}
                onClick={() => setActivePosition(pos.key)}
                className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors ${
                  activePosition === pos.key
                    ? 'bg-gold-500/15 border-gold-500/30 text-gold-400'
                    : 'border-white/10 text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                {pos.label}
              </button>
            ))}
          </div>

          <table className="w-full text-sm max-w-xs">
            <thead>
              <tr>
                <th className="text-left text-white/40 text-xs font-medium pb-2">Series</th>
                <th className="text-left text-white/40 text-xs font-medium pb-2 px-2">Price / piece</th>
              </tr>
            </thead>
            <tbody>
              {TINT_SERIES.map((s) => {
                const key = `${activePosition}|${s.key}`;
                return (
                  <tr key={s.key}>
                    <td className="text-white text-sm font-medium py-1.5 pr-3 whitespace-nowrap">{s.label}</td>
                    <td className="py-1.5 px-2 w-36">
                      <PriceCell
                        value={positionPrices[key] ?? 0}
                        saved={justSaved === key}
                        onCommit={(v) => commitPosition(activePosition, s.key, v)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </GarageShell>
  );
}
