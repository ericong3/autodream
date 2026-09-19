import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Car, User, Layers, AlertTriangle, CheckCircle2, Droplets } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { useStore } from '../store';
import { getInstallerJob, completeInstallerJob } from '../lib/garageInstallerJobs';
import { getGarageInvoice } from '../lib/garageInvoices';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import {
  getTintOrder, ensureInstallationPieces, updateInstallationPiece, listFilmStock, adjustFilmStock,
} from '../lib/garageTint';
import { GLASS_POSITIONS, EXTRA_GLASS_OPTIONS, VEHICLE_SIZES } from '../utils/tintPricing';
import type {
  GarageInstallerJob, GarageInvoice, GarageVehicle, GarageCustomer, GarageTintOrder,
  GarageTintInstallationPiece, GarageFilmStock, TintPositionSelection, TintSeries,
} from '../types';

const POSITION_LABEL = Object.fromEntries(
  [...GLASS_POSITIONS, ...EXTRA_GLASS_OPTIONS].map((p) => [p.key, p.label]),
);

function SqftCell({
  value, disabled, onCommit,
}: { value: number | undefined; disabled: boolean; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState(value !== undefined ? String(value) : '');
  useEffect(() => setLocal(value !== undefined ? String(value) : ''), [value]);

  return (
    <div className="relative">
      <input
        type="number"
        min={0}
        step="0.1"
        disabled={disabled}
        className="w-full bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg
          pl-3 pr-12 py-2 text-white text-sm outline-none transition-colors disabled:opacity-50"
        placeholder="0.0"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = Number(local) || 0;
          if (n !== (value ?? 0)) onCommit(n);
        }}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 text-xs">sqft</span>
    </div>
  );
}

export default function GarageInstallerJobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const allUsers = useStore((s) => s.users);
  const installers = useMemo(
    () => allUsers.filter((u) => u.role === 'garage_installer' && (u.businessAccess === 'garage' || u.businessAccess === 'both')),
    [allUsers],
  );

  const [job, setJob] = useState<GarageInstallerJob | null>(null);
  const [invoice, setInvoice] = useState<GarageInvoice | null>(null);
  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const [customer, setCustomer] = useState<GarageCustomer | null>(null);
  const [tintOrder, setTintOrder] = useState<GarageTintOrder | null>(null);
  const [pieces, setPieces] = useState<GarageTintInstallationPiece[]>([]);
  const [filmStock, setFilmStock] = useState<GarageFilmStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [remark, setRemark] = useState('');
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    (async () => {
      const j = await getInstallerJob(jobId);
      if (!j) { navigate('/garage/installer', { replace: true }); return; }
      setJob(j);
      const inv = await getGarageInvoice(j.invoiceId);
      setInvoice(inv);
      if (!inv) return;
      const [v, c, order, stock] = await Promise.all([
        getGarageVehicle(inv.vehicleId),
        getGarageCustomer(inv.customerId),
        getTintOrder(inv.id),
        listFilmStock(),
      ]);
      setVehicle(v);
      setCustomer(c);
      setTintOrder(order);
      setFilmStock(stock);
      if (order) {
        const positions = [...order.selections, ...order.extras].map((s) => s.position);
        const seeded = await ensureInstallationPieces(inv.id, positions);
        setPieces(seeded);
      }
      setLoading(false);
    })();
  }, [jobId]);

  const allSelections: TintPositionSelection[] = tintOrder ? [...tintOrder.selections, ...tintOrder.extras] : [];
  const sizeLabel = vehicle ? VEHICLE_SIZES.find((s) => s.key === vehicle.size)?.label ?? vehicle.size : '';

  const usedSeries = useMemo(
    () => Array.from(new Set(allSelections.map((s) => s.series))),
    [allSelections],
  );
  const lowStockSeries = usedSeries.filter((series) => {
    const stock = filmStock.find((f) => f.series === series);
    return stock && stock.remainingSqft <= stock.lowStockThreshold;
  });

  const totalUsage = pieces.reduce((sum, p) => sum + (p.sqft ?? 0), 0);
  const isCompleted = job?.status === 'completed';
  const allFilled = allSelections.length > 0 && allSelections.every((sel) => {
    const piece = pieces.find((p) => p.position === sel.position);
    return piece && piece.installerId && piece.sqft && piece.sqft > 0;
  });

  const seriesForPosition = (position: string): TintSeries | undefined =>
    allSelections.find((s) => s.position === position)?.series;

  const handleInstallerChange = async (piece: GarageTintInstallationPiece, installerId: string) => {
    const updated = await updateInstallationPiece(piece.id, { installerId: installerId || null });
    setPieces((prev) => prev.map((p) => (p.id === piece.id ? updated : p)));
  };

  const handleSqftChange = async (piece: GarageTintInstallationPiece, sqft: number) => {
    const series = seriesForPosition(piece.position);
    const delta = sqft - (piece.sqft ?? 0);
    const updated = await updateInstallationPiece(piece.id, { sqft });
    setPieces((prev) => prev.map((p) => (p.id === piece.id ? updated : p)));
    if (series && delta !== 0) {
      const nextStock = await adjustFilmStock(series, delta);
      setFilmStock((prev) => prev.map((f) => (f.series === series ? nextStock : f)));
    }
  };

  const pipelinePath = job ? `/garage/installer/${job.service}` : '/garage/installer';

  const handleComplete = async () => {
    if (!job) return;
    if (!allFilled) { setError('Assign an installer and film usage for every piece first'); return; }
    setError('');
    setCompleting(true);
    try {
      await completeInstallerJob(job.id, remark);
      navigate(pipelinePath);
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <GarageShell title="Job Detail" showBack backTo={pipelinePath}>
        <p className="text-white/40 text-sm text-center py-20">Loading…</p>
      </GarageShell>
    );
  }

  return (
    <GarageShell title="Job Detail" showBack backTo={pipelinePath}>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="relative overflow-hidden rounded-2xl p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div>
              <p className="text-white font-display text-lg font-semibold">{invoice?.invoiceNumber}</p>
              <p className="text-white/40 text-xs mt-0.5">{sizeLabel} · Window Tint</p>
            </div>
            {isCompleted && (
              <span className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-emerald-500/15 border-emerald-500/30 text-emerald-400">
                <CheckCircle2 size={12} /> Completed
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-white/60">
            {vehicle && (
              <span className="flex items-center gap-1.5"><Car size={13} /> {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.registrationNo}</span>
            )}
            {customer && (
              <span className="flex items-center gap-1.5"><User size={13} /> {customer.name}</span>
            )}
          </div>
        </div>

        {lowStockSeries.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl p-4 bg-red-500/10 border border-red-500/30">
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">
              Film stock running low: {lowStockSeries.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}. Please reorder soon.
            </p>
          </div>
        )}

        <div className="relative overflow-hidden rounded-2xl p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card space-y-3">
          <h2 className="font-display text-base text-white font-semibold tracking-wide mb-1">Glass Pieces</h2>
          {allSelections.map((sel) => {
            const piece = pieces.find((p) => p.position === sel.position);
            if (!piece) return null;
            return (
              <div key={sel.position} className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr_140px] gap-2.5 items-center border-b border-white/[0.06] last:border-b-0 pb-3 last:pb-0">
                <div className="flex items-center gap-2 text-white text-sm font-medium">
                  <Layers size={14} className="text-gold-400/70 shrink-0" /> {POSITION_LABEL[sel.position] ?? sel.position}
                </div>
                <select
                  disabled={isCompleted}
                  value={piece.installerId ?? ''}
                  onChange={(e) => handleInstallerChange(piece, e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg
                    px-3 py-2 text-white text-sm outline-none transition-colors disabled:opacity-50"
                >
                  <option value="" className="bg-obsidian-900">Select Installer</option>
                  {installers.map((i) => (
                    <option key={i.id} value={i.id} className="bg-obsidian-900">{i.name}</option>
                  ))}
                </select>
                <SqftCell
                  value={piece.sqft}
                  disabled={isCompleted}
                  onCommit={(v) => handleSqftChange(piece, v)}
                />
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl p-5 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card">
            <p className="text-white/40 text-xs uppercase tracking-wider mb-1.5">Total Usage</p>
            <p className="text-white font-display text-2xl font-bold">{totalUsage.toFixed(1)} <span className="text-sm font-normal text-white/40">sqft</span></p>
            <p className="text-white/30 text-xs mt-1">Auto-calculated</p>
          </div>
          <div className="rounded-2xl p-5 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card">
            <p className="text-white/40 text-xs uppercase tracking-wider mb-2 flex items-center gap-1.5"><Droplets size={12} /> Remaining Film</p>
            <div className="space-y-1">
              {usedSeries.length === 0 && <p className="text-white/40 text-sm">—</p>}
              {usedSeries.map((series) => {
                const stock = filmStock.find((f) => f.series === series);
                return (
                  <p key={series} className="text-white text-sm">
                    <span className="text-white/50 capitalize">{series}:</span> {stock ? `${stock.remainingSqft.toFixed(0)} sqft` : '—'}
                  </p>
                );
              })}
            </div>
          </div>
        </div>

        {!isCompleted && (
          <div className="relative overflow-hidden rounded-2xl p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card">
            <label className="block text-white/50 text-xs font-medium uppercase tracking-wider mb-2">Remark (Optional)</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              placeholder="Type here…"
              className="w-full bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg
                px-3 py-2.5 text-white text-sm outline-none transition-colors resize-none"
            />
          </div>
        )}

        {error && <p className="text-red-400 text-xs text-center">{error}</p>}

        {!isCompleted && (
          <button
            onClick={handleComplete}
            disabled={completing}
            className="w-full flex items-center justify-center gap-2 btn-gold py-3.5 rounded-xl text-sm font-semibold disabled:opacity-60"
          >
            <CheckCircle2 size={16} /> {completing ? 'Completing…' : 'Complete'}
          </button>
        )}
      </div>
    </GarageShell>
  );
}
