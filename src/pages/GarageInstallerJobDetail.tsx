import GarageGlassUnclaim from '../components/GarageGlassUnclaim';
import GarageDamageReports from '../components/GarageDamageReports';
import GarageJobGlassMap from '../components/GarageJobGlassMap';
import GarageTintUsage from '../components/GarageTintUsage';
import {canInstallGarageTint} from '../utils/garageRoles';
import GarageInstallationReview from '../components/GarageInstallationReview';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Car, User, AlertTriangle, CheckCircle2, Droplets, CalendarClock, UserCheck, MessageSquare,
  Play, Timer, Circle, Hand, Undo2, RotateCcw, Flag, Users, Wrench,
} from 'lucide-react';
import GarageShell, { isGarageManager } from '../components/GarageShell';
import GarageInstallationPhotos from '../components/GarageInstallationPhotos';
import { useStore } from '../store';
import {
  getInstallerJob, startInstallerJob, setInstallationEta,
} from '../lib/garageInstallerJobs';
import { getGarageInvoice, uploadInstallationPhoto } from '../lib/garageInvoices';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import {
  getTintOrder, ensureTintWorkOrderItems, setTintWorkOrderItemStatus, setTintWorkOrderItemSqft,
  setTintWorkOrderItemRemark, claimTintWorkOrderItem, releaseTintWorkOrderItem,
  GlassAlreadyTakenError, listFilmStock,
} from '../lib/garageTint';
import { useWorkOrderActivityUpdates } from '../hooks/useWorkOrderActivityUpdates';
import { GLASS_LABEL, TINT_SERIES, VEHICLE_SIZES } from '../utils/tintPricing';
import type {
  GarageInstallerJob, GarageInvoice, GarageVehicle, GarageCustomer, GarageTintOrder,
  GarageTintWorkOrderItem, GarageFilmStock, TintPositionSelection,
} from '../types';

const TINT_SERIES_LABEL = Object.fromEntries(TINT_SERIES.map((s) => [s.key, s.label]));

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });

// datetime-local value for an ISO time, in local time.
const toLocalInput = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Time on the car since installation started, ticking every 30s.
function ElapsedTime({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  return <>{h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`}</>;
}

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

// Per-glass note — saved when the field loses focus, like SqftCell.
function RemarkCell({
  value, disabled, onCommit,
}: { value: string | undefined; disabled: boolean; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => setLocal(value ?? ''), [value]);
  return (
    <input
      type="text"
      disabled={disabled}
      className="w-full bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg
        px-3 py-2 text-white text-sm outline-none transition-colors disabled:opacity-50"
      placeholder={disabled ? '—' : 'Remark (optional)'}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const v = local.trim();
        if (v !== (value ?? '')) onCommit(v);
      }}
    />
  );
}

// Tinted installation is team work: the car is shared, each glass belongs
// to whoever took it. This page is the car's checklist for installers and
// the Garage Head's review screen.
export default function GarageInstallerJobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const allUsers = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const nameOf = (id?: string) => (id ? allUsers.find((u) => u.id === id)?.name : undefined);

  const [job, setJob] = useState<GarageInstallerJob | null>(null);
  const [invoice, setInvoice] = useState<GarageInvoice | null>(null);
  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const [customer, setCustomer] = useState<GarageCustomer | null>(null);
  const [tintOrder, setTintOrder] = useState<GarageTintOrder | null>(null);
  const [items, setItems] = useState<GarageTintWorkOrderItem[]>([]);
  const [filmStock, setFilmStock] = useState<GarageFilmStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // glass id or action name in flight
  const [sqftResetTick, setSqftResetTick] = useState(0);

  // Submit / review dialogs
  const [photoWarning] = useState('');
  const [photoRefresh, setPhotoRefresh] = useState(0);
  const [etaEditing, setEtaEditing] = useState(false);
  const [etaValue, setEtaValue] = useState('');

  const load = (quiet = false) => {
    if (!jobId) return;
    if (!quiet) setLoading(true);
    (async () => {
      const j = await getInstallerJob(jobId);
      if (!j) { navigate('/garage/installer', { replace: true }); return; }
      setJob(j);
      const inv = await getGarageInvoice(j.invoiceId);
      setInvoice(inv);
      if (!inv) { setLoading(false); return; }
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
        // Normally created at confirm time — this backfills older orders.
        setItems(await ensureTintWorkOrderItems(inv.id, [...order.selections, ...order.extras]));
      }
      setLoading(false);
    })().catch((err) => { setError((err as Error)?.message ?? 'Could not load this car'); setLoading(false); });
  };

  useEffect(() => load(), [jobId]);
  // Several installers work this car at once — refresh as they take and
  // finish glass, or when it's submitted / approved / returned.
  useWorkOrderActivityUpdates(invoice?.id, () => load(true));

  // ── Who / where ────────────────────────────────────────────────────────
  const me = currentUser?.id;
  const isManager = isGarageManager(currentUser?.role);
  const isInstaller = canInstallGarageTint(currentUser?.role);
  const ws = invoice?.workStatus;
  const isCompleted = job?.status === 'completed';
  const isWaiting = !isCompleted && (ws === 'waiting_for_installer');
  const isInProgress = !isCompleted && (ws === 'in_progress' || ws === 'installer_assigned');
  const isPendingApproval = !isCompleted && ws === 'pending_approval';
  // Glass can be taken while the car waits (it starts the car) or is in progress.
  const glassOpen = isWaiting || isInProgress;

  const allSelections: TintPositionSelection[] = tintOrder ? [...tintOrder.selections, ...tintOrder.extras] : [];
  const itemFor = (sel: TintPositionSelection) => items.find((i) => i.glassPosition === sel.position);
  const orderItems = allSelections.map(itemFor).filter((i): i is GarageTintWorkOrderItem => !!i);
  const installedCount = orderItems.filter((i) => i.status === 'installed').length;

  const teamNames = [...new Set(orderItems.map((i) => i.installerId).filter((x): x is string => !!x))]
    .map((id) => nameOf(id) ?? 'Installer');
  const totalUsage = orderItems.reduce((sum, i) => sum + (i.sqft ?? 0), 0);
  const sizeLabel = vehicle ? VEHICLE_SIZES.find((s) => s.key === vehicle.size)?.label ?? vehicle.size : '';
  const salesman = nameOf(invoice?.salesOwnerId??invoice?.createdBy);
  const pipelinePath = job ? `/garage/installer/${job.service}` : '/garage/installer';

  const usedSeries = useMemo(() => Array.from(new Set(allSelections.map((s) => s.series))), [allSelections]);
  const lowStockSeries = usedSeries.filter((series) => {
    const stock = filmStock.find((f) => f.series === series);
    return stock && stock.remainingSqft <= stock.lowStockThreshold;
  });

  // ── Actions ────────────────────────────────────────────────────────────
  const run = async (key: string, fn: () => Promise<void>) => {
    setError('');
    setNotice('');
    setBusy(key);
    try {
      await fn();
      load(true);
    } catch (err) {
      if (err instanceof GlassAlreadyTakenError) {
        setNotice(`${nameOf(err.takenBy) ?? 'Another installer'} has just taken this glass.`);
        load(true);
      } else {
        setError((err as Error)?.message ?? 'Something went wrong — please try again');
      }
    } finally {
      setBusy(null);
    }
  };
  const replaceItem = (updated: GarageTintWorkOrderItem) =>
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  const refreshCar = async () => {
    if (!jobId) return;
    const j = await getInstallerJob(jobId);
    if (j) setJob(j);
    if (j) setInvoice(await getGarageInvoice(j.invoiceId));
  };

  const handleStartCar = () => run('start', async () => { await startInstallerJob(job!.id, me ?? ''); await refreshCar(); });
  const handleClaim = (item: GarageTintWorkOrderItem) =>
    run(item.id, async () => { replaceItem(await claimTintWorkOrderItem(item.id, me ?? '')); await refreshCar(); });
  const handleRelease = (item: GarageTintWorkOrderItem) =>
    run(item.id, async () => { replaceItem(await releaseTintWorkOrderItem(item.id, me ?? '')); });
  const handleConfirm = (item: GarageTintWorkOrderItem) =>
    run(item.id, async () => { replaceItem(await setTintWorkOrderItemStatus(item.id, 'installed', me ?? '')); });
  const handleReopen = (item: GarageTintWorkOrderItem) =>
    run(item.id, async () => { replaceItem(await setTintWorkOrderItemStatus(item.id, 'taken', me ?? '')); });
  const handleRemark = (item: GarageTintWorkOrderItem, remark: string) =>
    run(item.id, async () => { replaceItem(await setTintWorkOrderItemRemark(item.id, remark, me ?? '')); });
  // Glass sqft and film stock change together in one transaction; if it's
  // refused (e.g. not enough film), the input snaps back.
  const handleSqft = async (item: GarageTintWorkOrderItem, sqft: number) => {
    setError('');
    try {
      const { item: updated, stock } = await setTintWorkOrderItemSqft(item.id, sqft, me ?? '');
      replaceItem(updated);
      if (stock) setFilmStock((prev) => prev.map((f) => (f.series === stock.series ? stock : f)));
      return true;
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not save the film usage — please try again');
      setSqftResetTick((t) => t + 1);
      return false;
    }
  };

  const handleSaveEta = () => run('eta', async () => {
    const updated = await setInstallationEta(job!.id, etaValue ? new Date(etaValue).toISOString() : null, me ?? '');
    setJob(updated);
    setEtaEditing(false);
  });

  if (loading) {
    return (
      <GarageShell title="Car Detail" showBack backTo={pipelinePath}>
        <p className="text-white/40 text-sm text-center py-20">Loading…</p>
      </GarageShell>
    );
  }

  const badge = ws==='head_correction_review' ? {label:'Head: Correction Review',cls:'bg-orange-500/15 border-orange-400/40 text-orange-300'}
    : ws==='sales_inspection' ? {label:'Salesman Check',cls:'bg-gold-500/15 border-gold-400/40 text-gold-400'}
    : isCompleted
    ? { label: 'Workshop Approved', cls: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' }
    : isPendingApproval ? { label: 'Pending Approval', cls: 'bg-indigo-500/15 border-indigo-400/40 text-indigo-300' }
    : isInProgress ? { label: 'In Progress', cls: 'bg-blue-500/15 border-blue-500/30 text-blue-400' }
    : { label: 'Waiting for Installers', cls: 'bg-white/[0.03] border-white/10 text-white/60' };

  const smallBtn = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50';

  return (
    <GarageShell title="Car Detail" showBack backTo={pipelinePath}>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* ── Car header ── */}
        <div className="relative overflow-hidden rounded-2xl p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div>
              <p className="text-white font-display text-lg font-semibold">{invoice?.invoiceNumber}</p>
              <p className="text-white/40 text-xs mt-0.5">{sizeLabel} · Window Tint · team installation</p>
            </div>
            <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${badge.cls}`}>
              {isCompleted && <CheckCircle2 size={12} />} {badge.label}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm text-white/60">
            {vehicle && (
              <span className="flex items-center gap-1.5"><Car size={13} className="shrink-0" /> {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.registrationNo}</span>
            )}
            {customer && <span className="flex items-center gap-1.5"><User size={13} className="shrink-0" /> {customer.name}</span>}
            <span className="flex items-center gap-1.5">
              <CalendarClock size={13} className="shrink-0" />
              {invoice?.appointmentAt ? `Appointment ${formatWhen(invoice.appointmentAt)}` : 'No appointment set'}
            </span>
            <span className="flex items-center gap-1.5"><UserCheck size={13} className="shrink-0" /> Salesman: {salesman ?? '—'}</span>
            {job?.startedAt && (
              <span className="flex items-center gap-1.5 sm:col-span-2">
                <Timer size={13} className="shrink-0" />
                Started {formatWhen(job.startedAt)}
                {(isInProgress || isPendingApproval) && <span className="text-blue-400 font-medium">· <ElapsedTime since={job.startedAt} /> on the car</span>}
              </span>
            )}
            {teamNames.length > 0 && (
              <span className="flex items-center gap-1.5 sm:col-span-2"><Users size={13} className="shrink-0" /> {teamNames.join(', ')}</span>
            )}
            {/* Estimated completion — management sets it; everyone sees it */}
            <span className="flex items-center gap-1.5 sm:col-span-2">
              <Flag size={13} className="shrink-0" />
              {etaEditing ? (
                <span className="flex items-center gap-2 flex-wrap">
                  <input
                    type="datetime-local"
                    value={etaValue}
                    onChange={(e) => setEtaValue(e.target.value)}
                    className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1 text-white text-xs [color-scheme:dark]"
                  />
                  <button onClick={handleSaveEta} disabled={busy === 'eta'} className="text-gold-400 text-xs font-medium">Save</button>
                  <button onClick={() => setEtaEditing(false)} className="text-white/40 text-xs">Cancel</button>
                </span>
              ) : (
                <>
                  {job?.estimatedCompleteAt ? `Est. completion ${formatWhen(job.estimatedCompleteAt)}` : 'No estimated completion'}
                  {currentUser?.role==='garage_head' && !isCompleted && (
                    <button
                      onClick={() => { setEtaValue(toLocalInput(job?.estimatedCompleteAt)); setEtaEditing(true); }}
                      className="ml-1 text-gold-400 text-xs font-medium hover:text-gold-300"
                    >
                      {job?.estimatedCompleteAt ? 'Change' : 'Set'}
                    </button>
                  )}
                </>
              )}
            </span>
          </div>
          {invoice?.remark && (
            <div className="flex items-start gap-2 mt-4 pt-4 border-t border-white/10 text-sm">
              <MessageSquare size={13} className="text-white/40 shrink-0 mt-0.5" />
              <p className="text-white/70 whitespace-pre-line">{invoice.remark}</p>
            </div>
          )}
        </div>

        {/* Returned for correction */}
        {isInProgress && job?.returnedAt && job.returnReason && (
          <div className="flex items-start gap-3 rounded-xl p-4 bg-orange-500/10 border border-orange-500/30">
            <RotateCcw size={18} className="text-orange-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-orange-200 font-medium">Returned for correction by {nameOf(job.returnedBy) ?? 'the Garage Head'}</p>
              <p className="text-orange-200/80 mt-0.5">“{job.returnReason}” · {formatWhen(job.returnedAt)}</p>
            </div>
          </div>
        )}

        {notice && (
          <div className="flex items-start gap-3 rounded-xl p-4 bg-orange-500/10 border border-orange-500/30">
            <AlertTriangle size={18} className="text-orange-400 shrink-0 mt-0.5" />
            <p className="text-orange-200 text-sm">{notice}</p>
          </div>
        )}

        {lowStockSeries.length > 0 && !isCompleted && (
          <div className="flex items-start gap-3 rounded-xl p-4 bg-red-500/10 border border-red-500/30">
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">
              Film stock running low: {lowStockSeries.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}. Please reorder soon.
            </p>
          </div>
        )}

        {/* Start the car without taking a glass first */}
        {isWaiting && isInstaller && (
          <button
            onClick={handleStartCar}
            disabled={busy === 'start'}
            className="w-full flex items-center justify-center gap-2 btn-gold py-3.5 rounded-xl text-sm font-semibold disabled:opacity-60"
          >
            <Play size={16} /> {busy === 'start' ? 'Starting…' : 'Start Installation'}
          </button>
        )}

        {invoice&&<GarageDamageReports invoiceId={invoice.id} onChange={()=>void refreshCar()}/>}
        {/* ── Glass checklist ── */}
        <div className="relative overflow-hidden rounded-2xl p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card space-y-3">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h2 className="font-display text-base text-white font-semibold tracking-wide">Tinted Glass</h2>
            <span className="text-xs text-white/50">{installedCount} of {orderItems.length} installed</span>
          </div>
          {glassOpen && !isManager && (
            <p className="text-white/40 text-xs">Take any available glass. Only you can change a glass you've taken.</p>
          )}
          {isPendingApproval && (
            <p className="text-indigo-300/80 text-xs">Submitted for approval — the glass is locked unless the Garage Head returns it.</p>
          )}

          <GarageJobGlassMap items={orderItems} layout={tintOrder?.vehicleLayout} userId={me} workStatus={invoice?.workStatus} canWork={glassOpen&&isInstaller} busy={!!busy} onClaim={handleClaim} onUnclaim={handleRelease} onComplete={handleConfirm} onUsage={handleSqft}/>
          <details className="space-y-3"><summary className="cursor-pointer text-sm text-white/60 py-3">Film usage and glass details</summary>
          {allSelections.map((sel) => {
            const item = itemFor(sel);
            if (!item) return null;
            const requested = item.requestedSeries ?? sel.series;
            const vlt = item.requestedVlt ?? sel.vlt;
            const mine = !!me && item.installerId === me;
            const owner = nameOf(item.installerId);
            const canWorkThis = isInProgress && mine && item.status !== 'pending';
            const saving = busy === item.id;
            const chip = item.needsCorrection && item.status !== 'installed'
              ? { label: 'Needs correction', cls: 'bg-orange-500/15 border-orange-500/40 text-orange-400' }
              : item.status === 'installed' ? { label: `Installed${owner ? ` · ${owner}` : ''}`, cls: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' }
              : item.status === 'taken' ? { label: mine ? 'Taken by you' : `Taken by ${owner ?? 'installer'}`, cls: 'bg-blue-500/15 border-blue-500/30 text-blue-400' }
              : { label: 'Available', cls: 'bg-white/[0.03] border-white/10 text-white/60' };
            return (
              <div
                key={sel.position}
                className={`rounded-xl p-4 border transition-colors ${
                  item.status === 'installed' ? 'bg-emerald-500/[0.06] border-emerald-500/25'
                    : item.needsCorrection ? 'bg-orange-500/[0.05] border-orange-500/30'
                    : mine ? 'bg-gold-500/[0.04] border-gold-400/30'
                    : 'bg-white/[0.02] border-white/10'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-start gap-2 min-w-0">
                    {item.status === 'installed'
                      ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                      : <Circle size={16} className="text-white/30 shrink-0 mt-0.5" />}
                    <p className="text-white text-sm font-medium">{GLASS_LABEL[sel.position] ?? sel.position}</p>
                  </div>
                  <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${chip.cls}`}>{chip.label}</span>
                </div>

                {item.needsCorrection && item.correctionNote && (
                  <p className="text-orange-300 text-xs mb-3">Correction: {item.correctionNote}</p>
                )}

                <div className="grid grid-cols-3 gap-3 text-xs mb-3">
                  <div>
                    <p className="text-white/40 mb-0.5">Requested</p>
                    <p className="text-gold-400 text-sm">{TINT_SERIES_LABEL[requested] ?? requested} · {vlt}</p>
                  </div>
                  <div>
                    <p className="text-white/40 mb-0.5">Installed</p>
                    <p className={`text-sm ${item.installedSeries ? 'text-white' : 'text-white/30'}`}>
                      {item.installedSeries ? (TINT_SERIES_LABEL[item.installedSeries] ?? item.installedSeries) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-white/40 mb-0.5">Completed</p>
                    <p className={`text-sm ${item.completedAt ? 'text-white/80' : 'text-white/30'}`}>
                      {item.completedAt ? formatWhen(item.completedAt) : '—'}
                    </p>
                  </div>
                </div>

                {/* Film + remark — editable by the glass's installer (or management) */}
                {item.status !== 'pending' && (
                  <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2.5 mb-2.5">
                    <SqftCell
                      key={`${item.id}-${sqftResetTick}`}
                      value={item.sqft}
                      disabled={!canWorkThis}
                      onCommit={(v) => handleSqft(item, v)}
                    />
                    <RemarkCell value={item.remark} disabled={!canWorkThis} onCommit={(v) => handleRemark(item, v)} />
                  </div>
                )}

                {/* Actions */}
                {glassOpen && (
                  <div className="flex justify-end gap-2 flex-wrap">
                    {item.status === 'pending' && isInstaller && (
                      <button
                        type="button"
                        onClick={() => handleClaim(item)}
                        disabled={saving}
                        className={`${smallBtn} bg-gold-500/15 border-gold-400/50 text-gold-400 hover:bg-gold-500/25`}
                      >
                        <Hand size={13} /> {saving ? 'Taking…' : 'Take this glass'}
                      </button>
                    )}
                    {item.status === 'taken' && canWorkThis && (
                      <>
                        {(item.sqft??0)<=0&&!item.needsCorrection&&<GarageGlassUnclaim key={item.id} busy={saving} onConfirm={()=>handleRelease(item)}/>}
                        <button
                          type="button"
                          onClick={() => handleConfirm(item)}
                          disabled={saving}
                          className={`${smallBtn} bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25`}
                        >
                          <CheckCircle2 size={13} /> {saving ? 'Saving…' : 'Confirm Installed'}
                        </button>
                      </>
                    )}
                    {item.status === 'installed' && canWorkThis && (
                      <button
                        type="button"
                        onClick={() => handleReopen(item)}
                        disabled={saving}
                        className={`${smallBtn} bg-white/[0.03] border-white/10 text-white/60 hover:text-white/90 hover:border-white/20`}
                      >
                        <Undo2 size={13} /> {saving ? 'Saving…' : mine ? 'Undo' : 'Reopen'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          </details>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl p-5 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card">
            <p className="text-white/40 text-xs uppercase tracking-wider mb-1.5">Total Usage</p>
            <p className="text-white font-display text-2xl font-bold">{totalUsage.toFixed(1)} <span className="text-sm font-normal text-white/40">sqft</span></p>
            <p className="text-white/30 text-xs mt-1">All glass on this car</p>
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

        {error && <p className="text-red-400 text-xs text-center">{error}</p>}

        {invoice && <><GarageTintUsage invoiceId={invoice.id} version={items.map(i=>`${i.id}:${i.sqft}:${i.usageAttempt}`).join('|')}/><GarageInstallationReview invoiceId={invoice.id} ownerId={invoice.salesOwnerId??invoice.createdBy} items={items} onChange={()=>load(true)} /></>}
        {invoice && <GarageInstallationPhotos invoiceId={invoice.id} refreshKey={photoRefresh} />}
        {isInProgress && isInstaller && <label className="block text-sm text-white/60">Add work photos<input type="file" accept="image/*" multiple onChange={async e=>{const files=Array.from(e.target.files??[]);e.target.value='';try{for(const file of files)await uploadInstallationPhoto(invoice!.id,file);setPhotoRefresh(v=>v+1);}catch{setError('Could not upload photo. Your installation progress is kept.');}}} className="block mt-2 text-xs"/></label>}

        {/* ── Approved ── */}
        {isCompleted && job && (
          <div className="relative overflow-hidden rounded-2xl p-6 bg-emerald-500/[0.06] border border-emerald-500/25 shadow-card space-y-3">
            <h2 className="flex items-center gap-2 font-display text-base text-emerald-400 font-semibold tracking-wide">
              <CheckCircle2 size={16} /> Workshop {job.approvedAt ? 'Approved' : 'Completed'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-white/70">
              {job.approvedAt
                ? <p>Approved by {nameOf(job.approvedBy) ?? '—'} · {formatWhen(job.approvedAt)}</p>
                : job.completedAt && <p>Completed by {nameOf(job.completedBy ?? job.acceptedBy) ?? '—'} · {formatWhen(job.completedAt)}</p>}
              {job.submittedForApprovalAt && <p>Submitted by {nameOf(job.submittedBy) ?? '—'}</p>}
              {job.finalInspectionAt && <p className="sm:col-span-2">Garage Head inspection confirmed</p>}
              {!job.approvedAt && job.acceptedBy && (
                <p className="sm:col-span-2 flex items-center gap-1.5 text-white/50"><Wrench size={12} /> Whole car taken by {nameOf(job.acceptedBy)} (before team installation)</p>
              )}
            </div>
            {job.remark && (
              <div className="flex items-start gap-2 pt-3 border-t border-white/10 text-sm">
                <MessageSquare size={13} className="text-white/40 shrink-0 mt-0.5" />
                <p className="text-white/70 whitespace-pre-line">{job.remark}</p>
              </div>
            )}
            {photoWarning && <p className="text-orange-300 text-xs">{photoWarning}</p>}
            {invoice && <GarageInstallationPhotos invoiceId={invoice.id} refreshKey={photoRefresh} />}
          </div>
        )}
      </div>

      {/* Submit for approval */}
    </GarageShell>
  );
}
