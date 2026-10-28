import {tintQuoteTotal} from '../utils/tintQuoteTotal';
import GarageGlassSetup from '../components/GarageGlassSetup';
import {defaultGlassLayout,vehicleGlassPositions,FRONT_THREE_GLASS,isFrontThreeGlass,type VehicleGlassSelection,type VehicleGlassLayout} from '../utils/vehicleGlass';
import {glassName} from '../components/GarageRenderedGlassMap';
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Car, Layers, AlertCircle } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { getGarageVehicle } from '../lib/garageCustomers';
import { getFullPrices, getPositionPrices } from '../lib/garageTint';
import {
  TINT_SERIES, EXTRA_GLASS_OPTIONS, VLT_OPTIONS, glassZone, glassPrice,
} from '../utils/tintPricing';
import { formatRM } from '../utils/format';
import type {
  GarageVehicle, TintPackageType, TintSeries, GlassPosition, ExtraGlassKey, TintPositionSelection,
} from '../types';

type GlassChoice = { series: TintSeries | ''; vlt: string };
// Keyed by glass position; which positions exist comes from the car's
// layout, so a position missing here just means "not chosen yet".
type MixState = Partial<Record<GlassPosition, GlassChoice>>;
type FullVltState = Partial<Record<GlassPosition, string>>;
type ExtraState = Record<ExtraGlassKey, { included: boolean; series: TintSeries | ''; vlt: string }>;
type VltGroupMode = 'individual' | 'whole' | 'front_rear';

const EMPTY_CHOICE: GlassChoice = { series: '', vlt: '' };

const emptyExtras: ExtraState = {
  extra_rear_2pc: { included: false, series: '', vlt: '' },
  small_window: { included: false, series: '', vlt: '' },
};

const isGlass = (s: TintPositionSelection) => glassZone(s.position) !== undefined;

// The Summary page's Back button hands the previously built order back here
// via router state, so the form can be rehydrated instead of resetting —
// same shape this page originally sent to Summary.
interface IncomingOrder {
  confirmationId?: string;
  vehicleLayout?:VehicleGlassLayout;
  agreedBase?:number;
  packageType: TintPackageType;
  fullSeries?: TintSeries;
  selections: TintPositionSelection[];
  extras: TintPositionSelection[];
  discount: number;
}

function detectFullVlt(selections: TintPositionSelection[] | undefined): {
  mode: VltGroupMode; whole: string; front: string; rear: string; perWindow: FullVltState;
} {
  const perWindow: FullVltState = {};
  const glass = (selections ?? []).filter(isGlass);
  if (glass.length === 0) {
    return { mode: 'individual', whole: '', front: '', rear: '', perWindow };
  }
  glass.forEach((s) => { perWindow[s.position as GlassPosition] = s.vlt; });
  const values = glass.map((s) => s.vlt);
  if (values.every((v) => v && v === values[0])) {
    return { mode: 'whole', whole: values[0], front: '', rear: '', perWindow };
  }
  const frontValues = glass.filter((s) => glassZone(s.position) === 'front').map((s) => s.vlt);
  const rearValues = glass.filter((s) => glassZone(s.position) === 'rear').map((s) => s.vlt);
  const uniform = (vs: string[]) => vs.length > 0 && vs.every((v) => v && v === vs[0]);
  if (uniform(frontValues) && uniform(rearValues)) {
    return { mode: 'front_rear', whole: '', front: frontValues[0], rear: rearValues[0], perWindow };
  }
  return { mode: 'individual', whole: '', front: '', rear: '', perWindow };
}

function detectMix(selections: TintPositionSelection[] | undefined): MixState {
  const mix: MixState = {};
  (selections ?? []).filter(isGlass).forEach((s) => {
    mix[s.position as GlassPosition] = { series: s.series, vlt: s.vlt };
  });
  return mix;
}

function detectExtras(extrasIn: TintPositionSelection[] | undefined): ExtraState {
  const extras: ExtraState = { ...emptyExtras };
  if (!extrasIn) return extras;
  (Object.keys(extras) as ExtraGlassKey[]).forEach((key) => {
    const found = extrasIn.find((e) => e.position === key);
    if (found) extras[key] = { included: true, series: found.series, vlt: found.vlt };
  });
  return extras;
}

export default function GarageTintPackage() {
  const { id, vehicleId } = useParams<{ id: string; vehicleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Present only when reached via the Summary page's Back button — restores
  // the form instead of resetting it.
  const incoming = location.state as IncomingOrder | undefined;
  const [initialFullVlt] = useState(() => detectFullVlt(incoming?.packageType === 'full' ? incoming.selections : undefined));

  const [glassConfig,setGlassConfig]=useState<VehicleGlassSelection>(()=>{const base=incoming?.vehicleLayout??defaultGlassLayout;return {...base,included:incoming?.vehicleLayout?incoming.selections.map(s=>s.position):vehicleGlassPositions(base)};});
  const [agreedBase,setAgreedBase]=useState(incoming?.agreedBase!==undefined?String(incoming.agreedBase):'');
  const [roofPrices,setRoofPrices]=useState<Record<string,string>>(()=>Object.fromEntries((incoming?.selections??[]).filter(s=>s.position.includes('roof')).map(s=>[s.position,String(s.price)])));
  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const [fullPrices, setFullPrices] = useState<Record<string, number>>({});
  const [positionPrices, setPositionPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [packageType, setPackageType] = useState<TintPackageType>(incoming?.packageType ?? 'full');
  const [fullSeries, setFullSeries] = useState<TintSeries | ''>(incoming?.fullSeries ?? '');
  const [fullVlt, setFullVlt] = useState<FullVltState>(initialFullVlt.perWindow);
  const [vltGroupMode, setVltGroupMode] = useState<VltGroupMode>(initialFullVlt.mode);
  const [wholeVlt, setWholeVlt] = useState(initialFullVlt.whole);
  const [frontVlt, setFrontVlt] = useState(initialFullVlt.front);
  const [rearVlt, setRearVlt] = useState(initialFullVlt.rear);
  const [mix, setMix] = useState<MixState>(() => detectMix(incoming?.packageType === 'mix' ? incoming.selections : undefined));
  const [extras, setExtras] = useState<ExtraState>(() => detectExtras(incoming?.extras));
  // Mix & Match shortcut — fills every window with one series/VLT, which the
  // salesman can then override glass by glass.
  const [fillAll, setFillAll] = useState<GlassChoice>(EMPTY_CHOICE);
  const [discount, setDiscount] = useState(incoming?.discount ?? 0);
  // No visible trigger at all — a customer watching the screen shouldn't be
  // able to spot anything to ask about. 5 quick taps on the "Price Summary"
  // title (a plain-looking heading, not a button) toggles it — same gesture
  // shows it and hides it again, so an accidental reveal is easy to undo.
  // The discount amount itself isn't cleared when hidden, only the input.
  const [showDiscount, setShowDiscount] = useState(!!incoming?.discount);
  const discountTapCount = useRef(0);
  const discountTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTitleTap = () => {
    discountTapCount.current += 1;
    if (discountTapTimer.current) clearTimeout(discountTapTimer.current);
    if (discountTapCount.current >= 5) {
      setShowDiscount((v) => !v);
      discountTapCount.current = 0;
      return;
    }
    discountTapTimer.current = setTimeout(() => { discountTapCount.current = 0; }, 1200);
  };
  const [error, setError] = useState('');

  useEffect(() => {
    if (!vehicleId) return;
    Promise.all([getGarageVehicle(vehicleId), getFullPrices(), getPositionPrices()])
      .then(([v, f, p]) => { setVehicle(v); setFullPrices(f); setPositionPrices(p); })
      .finally(() => setLoading(false));
  }, [vehicleId]);

  const size = vehicle?.size ?? 'standard';
  const layout=vehicleGlassPositions(glassConfig).filter(p=>glassConfig.included.includes(p)).map(p=>({key:p as GlassPosition,label:glassName(glassConfig.body,p),zone:(p.startsWith('front_')&&!p.includes('roof')?'front':'rear') as 'front'|'rear'}));
  const agreedVehicle=glassConfig.body==='van'||glassConfig.body==='bus';
  const roofGlass=layout.filter(p=>p.key.includes('roof'));
  const roofTotal=roofGlass.reduce((sum,p)=>sum+(Number(roofPrices[p.key])||0),0);
  const selectedPrice=(position:GlassPosition,series:TintSeries)=>position.includes('roof')?Number(roofPrices[position])||0:agreedVehicle?0:glassPrice(position,series,positionPrices);
  const frontGlass = layout.filter((g) => g.zone === 'front');
  const rearGlass = layout.filter((g) => g.zone === 'rear');
  const availableExtras = EXTRA_GLASS_OPTIONS.filter((ex) => !ex.xlargeOnly || size === 'xlarge');
  const mixChoice = (pos: GlassPosition) => mix[pos] ?? EMPTY_CHOICE;
  const frontThreeOnly = isFrontThreeGlass(layout.map(g => g.key));

  const selectFrontThree = (config: VehicleGlassSelection = glassConfig) => {
    // Use the existing per-window pricing and order format. Rear/roof pieces
    // and optional extras must not create installer tasks for this shortcut.
    setGlassConfig({...config, included: [...FRONT_THREE_GLASS]});
    setMix(previous => ({...previous, ...Object.fromEntries(FRONT_THREE_GLASS.map(position => [position,
      packageType === 'full'
        ? {series: fullSeries, vlt: effectiveFullVlt(position)}
        : previous[position] ?? EMPTY_CHOICE,
    ]))}));
    setPackageType('mix');
    setExtras(detectExtras(undefined));
    setError('');
  };

  // Full Package's VLT, resolved for whichever grouping mode is active.
  function effectiveFullVlt(pos: GlassPosition): string {
    if (vltGroupMode === 'whole') return wholeVlt;
    if (vltGroupMode === 'front_rear') return glassZone(pos) === 'front' ? frontVlt : rearVlt;
    return fullVlt[pos] ?? '';
  }

  const applyFillAll = () => {
    const next: MixState = { ...mix };
    layout.forEach((g) => {
      next[g.key] = {
        series: fillAll.series || mixChoice(g.key).series,
        vlt: fillAll.vlt || mixChoice(g.key).vlt,
      };
    });
    setMix(next);
  };

  const fullPrice = fullSeries ? (fullPrices[`${fullSeries}|${size}`] ?? 0) : 0;
  // Mix & Match prices are per individual window.
  const mixTotal = layout.reduce((sum, g) => {
    const sel = mixChoice(g.key);
    if (!sel.series) return sum;
    return sum + selectedPrice(g.key,sel.series);
  }, 0);
  // Extras only ever add cost in Mix & Match — Full Package's price never
  // changes regardless of what's toggled on.
  const extrasTotal = packageType === 'mix'
    ? availableExtras.reduce((sum, ex) => {
        const state = extras[ex.key];
        if (!state.included || !state.series) return sum;
        return sum + glassPrice(ex.key, state.series, positionPrices);
      }, 0)
    : 0;
  const finalTotal=tintQuoteTotal({agreedBase:agreedVehicle?Number(agreedBase)||0:undefined,packageType,fullPrice,mixTotal,roofTotal,extrasTotal,discount});

  // Nothing is persisted here — this just validates and hands the built
  // order off to the Summary page (via router state), which is where the
  // invoice/tint order/installer job actually get created on Confirm.
  const handleContinue = () => {
    if(!Number.isFinite(discount)||discount<0){setError('Enter a valid discount');return;}
    if(!layout.length){setError('Choose at least one glass piece');return;}
    if(agreedVehicle&&(agreedBase.trim()===''||!Number.isFinite(Number(agreedBase))||Number(agreedBase)<0)){setError('Enter the agreed job price');return;}
    if(roofGlass.some(p=>roofPrices[p.key]===undefined||roofPrices[p.key].trim()===''||!Number.isFinite(Number(roofPrices[p.key]))||Number(roofPrices[p.key])<0)){setError('Enter the agreed add-on price for each roof section');return;}
    if (packageType === 'full') {
      if (!fullSeries) { setError('Choose a series for the Full Package'); return; }
      if (vltGroupMode === 'whole' && !wholeVlt) { setError('Choose a VLT for the whole car'); return; }
      if (vltGroupMode === 'front_rear' && ((frontGlass.length>0&&!frontVlt)||(rearGlass.length>0&&!rearVlt))) { setError('Choose a VLT for both the front and rear groups'); return; }
      if (vltGroupMode === 'individual' && layout.some((g) => !fullVlt[g.key])) { setError('Choose a VLT for every window'); return; }
      if (availableExtras.some((ex) => extras[ex.key].included && !extras[ex.key].vlt)) { setError('Choose a VLT for every selected extra'); return; }
    } else {
      if (layout.some((g) => !mixChoice(g.key).series || !mixChoice(g.key).vlt)) { setError('Choose a series and VLT for every glass position'); return; }
      if (availableExtras.some((ex) => extras[ex.key].included && (!extras[ex.key].series || !extras[ex.key].vlt))) {
        setError('Choose a series and VLT for every selected extra');
        return;
      }
    }
    setError('');
    // One entry per individual glass on the car, in both modes.
    const selections: TintPositionSelection[] = packageType === 'full'
      ? layout.map((g) => ({ position: g.key, series: fullSeries as TintSeries, vlt: effectiveFullVlt(g.key), price:g.key.includes('roof')?Number(roofPrices[g.key]):0 }))
      : layout.map((g) => {
          const series = mixChoice(g.key).series as TintSeries;
          return { position: g.key, series, vlt: mixChoice(g.key).vlt, price:selectedPrice(g.key,series) };
        });
    const extraSelections: TintPositionSelection[] = availableExtras
      .filter((ex) => extras[ex.key].included)
      .map((ex) => {
        const series = (packageType === 'full' ? fullSeries : extras[ex.key].series) as TintSeries;
        const vlt = extras[ex.key].vlt;
        const price = packageType === 'full' ? 0 : glassPrice(ex.key, series, positionPrices);
        return { position: ex.key, series, vlt, price };
      });
    navigate(`/garage/work-order/customer/${id}/vehicle/${vehicleId}/service/tinted/summary`, {
      state: {
        confirmationId: incoming?.confirmationId,
        vehicleLayout:{body:glassConfig.body,roof:glassConfig.roof,sideRows:glassConfig.sideRows},
        agreedBase:agreedVehicle?Number(agreedBase):undefined,
        packageType,
        fullSeries: packageType === 'full' ? (fullSeries as TintSeries) : undefined,
        selections,
        extras: extraSelections,
        discount,
        finalTotal,
      },
    });
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
        </div>

        <section className="mb-6 rounded-2xl border border-white/15 bg-black/30 p-5" aria-label="Tint coverage">
          <h2 className="text-white font-semibold mb-3">Which glass is being tinted?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button type="button" aria-pressed={glassConfig.included.length === vehicleGlassPositions(glassConfig).length}
              onClick={() => {setGlassConfig({...glassConfig, included: vehicleGlassPositions(glassConfig)}); setPackageType('full'); setError('');}}
              className="min-h-[44px] px-4 py-3 rounded-xl border border-white/20 text-white text-sm hover:border-gold-400/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400">
              Full car
            </button>
            <button type="button" aria-pressed={frontThreeOnly} onClick={() => selectFrontThree()}
              className={`min-h-[44px] px-4 py-3 rounded-xl border text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400 ${frontThreeOnly ? 'bg-gold-500/15 border-gold-400/50 text-gold-400' : 'border-white/20 text-white hover:border-gold-400/50'}`}>
              Front 3 pieces / Half car
            </button>
          </div>
          <p className="mt-3 text-sm text-white/70" aria-live="polite">{frontThreeOnly
            ? 'Front windscreen + front left and right windows only. Rear and roof glass stay unchanged. Priced per selected piece.'
            : 'Choose full car, front 3 pieces, or use Set up glass below for a custom selection.'}</p>
        </section>
        <GarageGlassSetup value={glassConfig} onApply={value=>{if(isFrontThreeGlass(value.included)){selectFrontThree(value);}else{setGlassConfig(value);setError('');}}}/>
        {(agreedVehicle||roofGlass.length>0)&&<section className="mb-6 rounded-2xl border border-gold-400/25 bg-black/30 p-5 space-y-4" aria-label="Agreed pricing">{agreedVehicle&&<label className="block text-white/80 text-sm">Agreed job price (excluding roof add-ons)<input type="number" min="0" step="0.01" inputMode="decimal" value={agreedBase} onChange={e=>setAgreedBase(e.target.value)} placeholder="RM" className="block w-full mt-2 bg-black border border-white/20 rounded-xl p-3 text-white"/><span className="block mt-2 text-xs text-white/50">Enter the agreed amount after measuring and discussing the job.</span></label>}{roofGlass.map(p=><label key={p.key} className="block text-white/80 text-sm">{p.label} add-on price<input type="number" min="0" step="0.01" inputMode="decimal" value={roofPrices[p.key]??''} onChange={e=>setRoofPrices({...roofPrices,[p.key]:e.target.value})} placeholder="RM" className="block w-full mt-2 bg-black border border-white/20 rounded-xl p-3 text-white"/></label>)}</section>}
        {/* Package type toggle */}
        <div className="grid grid-cols-2 gap-3 mb-6 max-w-sm">
          {(['full', 'mix'] as TintPackageType[]).map((t) => (
            <button
              key={t}
              type="button"
              disabled={t === 'full' && frontThreeOnly}
              onClick={() => setPackageType(t)}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
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
                    {layout.map((pos) => (
                      <div key={pos.key} className="grid grid-cols-1 sm:grid-cols-[190px_1fr] gap-2 items-center">
                        <span className="text-white/70 text-sm">{pos.label}</span>
                        <select
                          className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                            text-white text-sm outline-none transition-colors appearance-none"
                          value={fullVlt[pos.key] ?? ''}
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
                  <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] gap-2 items-center mb-6">
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
                    <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] gap-2 items-center">
                      <span className="text-white/70 text-sm">
                        Front
                        <span className="block text-white/30 text-[11px]">
                          {frontGlass.map((g) => g.label).join(', ')}
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
                    <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] gap-2 items-center">
                      <span className="text-white/70 text-sm">
                        Rear
                        <span className="block text-white/30 text-[11px]">
                          {rearGlass.map((g) => g.label).join(', ')}
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
                    <div key={ex.key} className="grid grid-cols-1 sm:grid-cols-[190px_1fr] gap-2 items-center">
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
                <h2 className="font-display text-lg text-white font-semibold tracking-wide mb-1">{frontThreeOnly ? 'Front 3 pieces / Half car' : 'Mix & Match'}</h2>
                <p className="text-white/40 text-sm mb-6">Select series and VLT for each individual glass — priced per window</p>

                <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr_100px_auto] gap-2 items-center mb-5 pb-5 border-b border-white/10">
                  <span className="text-white/50 text-xs font-medium">Fill every window</span>
                  <select
                    className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                      text-white text-sm outline-none transition-colors appearance-none"
                    value={fillAll.series}
                    onChange={(e) => setFillAll({ ...fillAll, series: e.target.value as TintSeries })}
                  >
                    <option value="" className="bg-obsidian-800">Series</option>
                    {TINT_SERIES.map((s) => <option key={s.key} value={s.key} className="bg-obsidian-800">{s.label}</option>)}
                  </select>
                  <select
                    className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                      text-white text-sm outline-none transition-colors appearance-none"
                    value={fillAll.vlt}
                    onChange={(e) => setFillAll({ ...fillAll, vlt: e.target.value })}
                  >
                    <option value="" className="bg-obsidian-800">VLT</option>
                    {VLT_OPTIONS.map((v) => <option key={v} value={v} className="bg-obsidian-800">{v}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={!fillAll.series && !fillAll.vlt}
                    onClick={applyFillAll}
                    className="px-3 py-2 rounded-lg text-xs font-medium border transition-colors
                      bg-gold-500/15 border-gold-400/50 text-gold-400 hover:bg-gold-500/25 disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>

                <div className="space-y-3 mb-6">
                  {layout.map((pos) => (
                    <div key={pos.key} className="grid grid-cols-1 sm:grid-cols-[190px_1fr_100px] gap-2 items-center">
                      <span className="text-white/70 text-sm">{pos.label}</span>
                      <select
                        className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                          text-white text-sm outline-none transition-colors appearance-none"
                        value={mixChoice(pos.key).series}
                        onChange={(e) => setMix({ ...mix, [pos.key]: { ...mixChoice(pos.key), series: e.target.value as TintSeries } })}
                      >
                        <option value="" className="bg-obsidian-800">Select series</option>
                        {TINT_SERIES.map((s) => <option key={s.key} value={s.key} className="bg-obsidian-800">{s.label}</option>)}
                      </select>
                      <select
                        className="bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg px-3 py-2
                          text-white text-sm outline-none transition-colors appearance-none"
                        value={mixChoice(pos.key).vlt}
                        onChange={(e) => setMix({ ...mix, [pos.key]: { ...mixChoice(pos.key), vlt: e.target.value } })}
                      >
                        <option value="" className="bg-obsidian-800">VLT</option>
                        {VLT_OPTIONS.map((v) => <option key={v} value={v} className="bg-obsidian-800">{v}</option>)}
                      </select>
                    </div>
                  ))}
                </div>

                {!frontThreeOnly && <div className="pt-5 border-t border-white/10 space-y-3">
                  <p className="text-white/50 text-xs font-medium">Extras</p>
                  {availableExtras.map((ex) => (
                    <div key={ex.key} className="grid grid-cols-1 sm:grid-cols-[190px_1fr_100px] gap-2 items-center">
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
                </div>}
              </>
            )}
          </div>

          {/* Price summary */}
          <div className="relative overflow-hidden rounded-[28px] p-6 sm:p-8 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg h-fit">
            <h2 onClick={handleTitleTap} className="font-display text-lg text-white font-semibold tracking-wide mb-5 select-none">Price Summary</h2>

            <div className="space-y-2.5 text-sm mb-4">
              {packageType === 'full' ? (
                <div className="flex justify-between text-white/50">
                  <span>{agreedVehicle?'Agreed job price':'Full Package Price'}</span>
                  <span className="text-white">{formatRM(agreedVehicle?Number(agreedBase)||0:fullPrice)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-white/50">
                    <span>{agreedVehicle?'Agreed job price':frontThreeOnly?'Front 3 pieces total':'Mix & Match Total'}</span>
                    <span className="text-white">{formatRM(agreedVehicle?Number(agreedBase)||0:mixTotal)}</span>
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

            {roofTotal>0&&(packageType==='full'||agreedVehicle)&&<p className="flex justify-between text-sm text-white/70 mb-4"><span>Roof add-ons</span><span>{formatRM(roofTotal)}</span></p>}
            {showDiscount ? (
              <div className="flex items-center justify-between gap-3 py-3 border-t border-white/10">
                <label className="text-white/50 text-sm">Discount</label>
                <div className="relative w-32">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 text-xs">RM</span>
                  <input
                    type="number"
                    min={0}
                    autoFocus
                    className="w-full bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg
                      pl-8 pr-2 py-1.5 text-white text-sm text-right outline-none transition-colors"
                    value={discount || ''}
                    onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
            ) : (
              <div className="border-t border-white/10 py-3" />
            )}

            <div className="flex justify-between items-baseline pt-3 border-t border-white/10 mb-6">
              <span className="text-white font-semibold">Final Total</span>
              <span className="text-gold-400 font-display text-xl font-bold">{formatRM(finalTotal)}</span>
            </div>

            {error && (
              <p className="text-red-400 text-xs mb-3 flex items-center gap-1.5"><AlertCircle size={12} /> {error}</p>
            )}

            <button onClick={handleContinue} className="w-full btn-gold py-3 rounded-xl text-sm">
              Review Order
            </button>
          </div>
        </div>
      </div>
    </GarageShell>
  );
}
