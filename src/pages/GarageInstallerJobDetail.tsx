import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Car, User, Layers, AlertTriangle, CheckCircle2, Droplets, CalendarClock, UserCheck, MessageSquare, Wrench,
  Play, Timer, Circle, Camera, Upload, X,
} from 'lucide-react';
import GarageShell, { isGarageManager } from '../components/GarageShell';
import GarageAcceptJobModal from '../components/GarageAcceptJobModal';
import GarageAssignJobModal from '../components/GarageAssignJobModal';
import GarageInstallationPhotos from '../components/GarageInstallationPhotos';
import Modal from '../components/Modal';
import { useStore } from '../store';
import { getInstallerJob, completeInstallerJob, startInstallerJob } from '../lib/garageInstallerJobs';
import { getGarageInvoice, uploadInstallationPhoto } from '../lib/garageInvoices';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import {
  getTintOrder, ensureTintWorkOrderItems, setTintWorkOrderItemStatus, setTintWorkOrderItemSqft,
  setTintWorkOrderItemInstaller, setTintWorkOrderItemRemark,
  listFilmStock,
} from '../lib/garageTint';
import { GLASS_LABEL, TINT_SERIES, VEHICLE_SIZES } from '../utils/tintPricing';
import { GARAGE_SERVICE_MAP } from '../utils/garageServices';
import type {
  GarageInstallerJob, GarageInvoice, GarageVehicle, GarageCustomer, GarageTintOrder,
  GarageTintWorkOrderItem, GarageFilmStock, TintPositionSelection,
} from '../types';

const TINT_SERIES_LABEL = Object.fromEntries(TINT_SERIES.map((s) => [s.key, s.label]));

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });

// Time on the job since Start Installation, ticking every 30s.
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

export default function GarageInstallerJobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const allUsers = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const installers = useMemo(
    () => allUsers.filter((u) => u.role === 'garage_installer' && (u.businessAccess === 'garage' || u.businessAccess === 'both')),
    [allUsers],
  );

  const [job, setJob] = useState<GarageInstallerJob | null>(null);
  const [invoice, setInvoice] = useState<GarageInvoice | null>(null);
  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const [customer, setCustomer] = useState<GarageCustomer | null>(null);
  const [tintOrder, setTintOrder] = useState<GarageTintOrder | null>(null);
  const [items, setItems] = useState<GarageTintWorkOrderItem[]>([]);
  const [filmStock, setFilmStock] = useState<GarageFilmStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [remark, setRemark] = useState('');
  const [completing, setCompleting] = useState(false);
  // Completion screen
  const [completeOpen, setCompleteOpen] = useState(false);
  const [confirmInstalled, setConfirmInstalled] = useState(false);
  const [confirmInspection, setConfirmInspection] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [completeError, setCompleteError] = useState('');
  const [photoWarning, setPhotoWarning] = useState('');
  const [photoRefresh, setPhotoRefresh] = useState(0);
  const [error, setError] = useState('');
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  // Set when someone else accepted this job while it was open here.
  const [takenNotice, setTakenNotice] = useState('');

  const load = () => {
    if (!jobId) return;
    setLoading(true);
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
        // Normally already created at confirm time — this backfills orders
        // from before that (and pre-split orders' individual glass).
        const seeded = await ensureTintWorkOrderItems(inv.id, [...order.selections, ...order.extras]);
        setItems(seeded);
      }
      setLoading(false);
    })();
  };

  useEffect(load, [jobId]);

  const isPending = job?.status === 'pending';
  // Accepted splits in two: assigned (not started) and in progress. Jobs
  // accepted before Start Installation existed were already underway, so
  // their work order was backfilled to in_progress without a start time.
  const isInProgress = job?.status === 'accepted' && invoice?.workStatus === 'in_progress';
  const isAssigned = job?.status === 'accepted' && !isInProgress;
  const canStart = isAssigned && (job?.acceptedBy === currentUser?.id || isGarageManager(currentUser?.role));
  const [starting, setStarting] = useState(false);
  const salesman = invoice?.createdBy ? allUsers.find((u) => u.id === invoice.createdBy) : undefined;
  const acceptedByUser = job?.acceptedBy ? allUsers.find((u) => u.id === job.acceptedBy) : undefined;
  const serviceLabel = job ? GARAGE_SERVICE_MAP[job.service]?.label ?? 'Service' : 'Service';

  const handleAccepted = () => {
    setAcceptOpen(false);
    setAssignOpen(false);
    // Out of Incoming, into Assigned (the installer's own list, or the
    // manager's view of everyone's).
    navigate(`/garage/installer/${job?.service ?? ''}?stage=assigned`, { replace: true });
  };

  const handleAlreadyAccepted = async () => {
    setAcceptOpen(false);
    const latest = jobId ? await getInstallerJob(jobId) : null;
    const takenBy = latest?.acceptedBy ? allUsers.find((u) => u.id === latest.acceptedBy)?.name : undefined;
    setTakenNotice(
      `${takenBy ?? 'Another installer'} has already accepted this job${latest?.acceptedAt ? ` (${formatWhen(latest.acceptedAt)})` : ''}. It's no longer available.`,
    );
    load();
  };

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

  const itemFor = (sel: TintPositionSelection) => items.find((i) => i.glassPosition === sel.position);
  // Only items for the order's current glass count — rows left over from
  // grouped (pre-split) positions are ignored.
  const orderItems = allSelections.map(itemFor).filter((i): i is GarageTintWorkOrderItem => !!i);

  const totalUsage = orderItems.reduce((sum, i) => sum + (i.sqft ?? 0), 0);
  const isCompleted = job?.status === 'completed';
  // Completion needs every glass on the order confirmed (the database checks
  // this again on complete).
  const allGlassConfirmed = allSelections.length > 0
    && allSelections.every((sel) => itemFor(sel)?.status === 'installed');

  const handleStart = async () => {
    if (!job) return;
    setError('');
    setStarting(true);
    try {
      const started = await startInstallerJob(job.id, currentUser?.id ?? '');
      setJob(started);
      setInvoice((inv) => (inv ? { ...inv, workStatus: 'in_progress' } : inv));
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not start the job — please try again');
      load();
    } finally {
      setStarting(false);
    }
  };

  // The installer confirms each glass individually. For now what went on is
  // taken to be what was requested — installedSeries is recorded as the
  // requested series, so a later "installed a different film" option only
  // has to let them change it. If nobody's been put down for the glass yet,
  // the person confirming is recorded as its installer.
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  const saveItem = async (item: GarageTintWorkOrderItem, save: () => Promise<GarageTintWorkOrderItem>) => {
    setSavingItemId(item.id);
    try {
      const updated = await save();
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not save — please try again');
    } finally {
      setSavingItemId(null);
    }
  };

  // Confirm / reopen go through the database so each is recorded in the
  // work order's activity history (GLASS_ITEM_COMPLETED / _REOPENED).
  const handleConfirmGlass = (item: GarageTintWorkOrderItem) =>
    saveItem(item, () => setTintWorkOrderItemStatus(item.id, 'installed', currentUser?.id ?? ''));

  const handleUndoGlass = (item: GarageTintWorkOrderItem) =>
    saveItem(item, () => setTintWorkOrderItemStatus(item.id, 'pending', currentUser?.id ?? ''));

  const handleRemarkChange = (item: GarageTintWorkOrderItem, remark: string) =>
    saveItem(item, () => setTintWorkOrderItemRemark(item.id, remark, currentUser?.id ?? ''));

  const installedCount = orderItems.filter((i) => i.status === 'installed').length;

  const handleInstallerChange = (item: GarageTintWorkOrderItem, installerId: string) =>
    saveItem(item, () => setTintWorkOrderItemInstaller(item.id, installerId || null, currentUser?.id ?? ''));

  // One call: the glass's sqft and the film stock change together or not
  // at all (see setTintWorkOrderItemSqft). If it's refused — e.g. not
  // enough film left — the input snaps back to the saved value.
  const [sqftResetTick, setSqftResetTick] = useState(0);
  const handleSqftChange = async (item: GarageTintWorkOrderItem, sqft: number) => {
    setError('');
    try {
      const { item: updated, stock } = await setTintWorkOrderItemSqft(item.id, sqft, currentUser?.id ?? '');
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
      if (stock) setFilmStock((prev) => prev.map((f) => (f.series === stock.series ? stock : f)));
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not save the film usage — please try again');
      setSqftResetTick((t) => t + 1);
    }
  };

  const pipelinePath = job ? `/garage/installer/${job.service}` : '/garage/installer';

  // Only the installer on the job (or a manager) can work/complete it.
  const canWork = job?.acceptedBy === currentUser?.id || isGarageManager(currentUser?.role);
  // Glass controls are live only for them, and only while work is underway;
  // everyone else sees the same page read-only.
  const canEditGlass = canWork && !isCompleted;

  const openComplete = () => {
    setConfirmInstalled(false);
    setConfirmInspection(false);
    setPhotos([]);
    setCompleteError('');
    setCompleteOpen(true);
  };

  const handleComplete = async () => {
    if (!job || !invoice || !currentUser) return;
    if (!allGlassConfirmed) { setCompleteError('Every glass must be confirmed completed first'); return; }
    if (!confirmInstalled || !confirmInspection) { setCompleteError('Tick both confirmations to complete'); return; }
    setCompleteError('');
    setCompleting(true);
    try {
      const done = await completeInstallerJob(job.id, currentUser.id, remark, confirmInspection);
      setJob(done);
      // Photos are optional — a failed upload mustn't undo a completed job,
      // so they go up after, and a failure is only reported.
      if (photos.length > 0) {
        const results = await Promise.allSettled(photos.map((f) => uploadInstallationPhoto(invoice.id, f)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) setPhotoWarning(`Installation completed, but ${failed} of ${photos.length} photo(s) failed to upload.`);
      }
      setCompleteOpen(false);
      setPhotoRefresh((n) => n + 1);
      load();
    } catch (err) {
      setCompleteError((err as Error)?.message ?? 'Could not complete the job — please try again');
    } finally {
      setCompleting(false);
    }
  };

  const handlePhotoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    setPhotos((prev) => [...prev, ...picked]);
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
            {isCompleted ? (
              <span className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-emerald-500/15 border-emerald-500/30 text-emerald-400">
                <CheckCircle2 size={12} /> Installation Completed
              </span>
            ) : isPending ? (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-white/[0.03] border-white/10 text-white/60">
                Waiting for Installer
              </span>
            ) : isInProgress ? (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-blue-500/15 border-blue-500/30 text-blue-400">
                In Progress
              </span>
            ) : (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-violet-500/15 border-violet-500/30 text-violet-300">
                Installer Assigned
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm text-white/60">
            {vehicle && (
              <span className="flex items-center gap-1.5"><Car size={13} className="shrink-0" /> {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.registrationNo}</span>
            )}
            {customer && (
              <span className="flex items-center gap-1.5"><User size={13} className="shrink-0" /> {customer.name}</span>
            )}
            <span className="flex items-center gap-1.5">
              <CalendarClock size={13} className="shrink-0" />
              {invoice?.appointmentAt ? `Appointment ${formatWhen(invoice.appointmentAt)}` : 'No appointment set'}
            </span>
            <span className="flex items-center gap-1.5">
              <UserCheck size={13} className="shrink-0" /> Salesman: {salesman?.name ?? '—'}
            </span>
            {!isPending && job?.acceptedAt && (
              <span className="flex items-center gap-1.5 sm:col-span-2">
                <Wrench size={13} className="shrink-0" />
                {job.assignedBy
                  ? <>Assigned to {acceptedByUser?.name ?? '—'} by {allUsers.find((u) => u.id === job.assignedBy)?.name ?? 'a manager'} · {formatWhen(job.acceptedAt)}</>
                  : <>Accepted by {acceptedByUser?.name ?? '—'} · {formatWhen(job.acceptedAt)}</>}
              </span>
            )}
            {(isInProgress || isCompleted) && (
              <span className="flex items-center gap-1.5 sm:col-span-2">
                <Timer size={13} className="shrink-0" />
                {job?.startedAt ? (
                  <>
                    Started {formatWhen(job.startedAt)}
                    {isInProgress && <span className="text-blue-400 font-medium">· <ElapsedTime since={job.startedAt} /> elapsed</span>}
                  </>
                ) : 'Start time not recorded'}
              </span>
            )}
          </div>
          {invoice?.remark && (
            <div className="flex items-start gap-2 mt-4 pt-4 border-t border-white/10 text-sm">
              <MessageSquare size={13} className="text-white/40 shrink-0 mt-0.5" />
              <p className="text-white/70 whitespace-pre-line">{invoice.remark}</p>
            </div>
          )}
        </div>

        {takenNotice && (
          <div className="flex items-start gap-3 rounded-xl p-4 bg-orange-500/10 border border-orange-500/30">
            <AlertTriangle size={18} className="text-orange-400 shrink-0 mt-0.5" />
            <p className="text-orange-200 text-sm">{takenNotice}</p>
          </div>
        )}

        {/* Before work starts: read-only list of what was sold, plus the
            next action — Accept (incoming) or Start (assigned). */}
        {(isPending || isAssigned) && (
          <>
            <div className="relative overflow-hidden rounded-2xl p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card space-y-3">
              <h2 className="font-display text-base text-white font-semibold tracking-wide mb-1">Glass Pieces</h2>
              {allSelections.map((sel) => {
                const item = itemFor(sel);
                const series = item?.requestedSeries ?? sel.series;
                const vlt = item?.requestedVlt ?? sel.vlt;
                return (
                  <div key={sel.position} className="flex items-center justify-between gap-3 border-b border-white/[0.06] last:border-b-0 pb-3 last:pb-0">
                    <span className="flex items-center gap-2 text-white text-sm font-medium">
                      <Layers size={14} className="text-gold-400/70 shrink-0" /> {GLASS_LABEL[sel.position] ?? sel.position}
                    </span>
                    <span className="text-gold-400 text-sm">{TINT_SERIES_LABEL[series] ?? series} · {vlt}</span>
                  </div>
                );
              })}
            </div>

            {isPending && (isGarageManager(currentUser?.role) ? (
              <button
                onClick={() => setAssignOpen(true)}
                className="w-full flex items-center justify-center gap-2 btn-gold py-3.5 rounded-xl text-sm font-semibold"
              >
                <UserCheck size={16} /> Assign Installer
              </button>
            ) : (
              <button
                onClick={() => setAcceptOpen(true)}
                className="w-full flex items-center justify-center gap-2 btn-gold py-3.5 rounded-xl text-sm font-semibold"
              >
                <CheckCircle2 size={16} /> Accept Job
              </button>
            ))}

            {isAssigned && (
              canStart ? (
                <>
                  {error && <p className="text-red-400 text-xs text-center">{error}</p>}
                  <button
                    onClick={handleStart}
                    disabled={starting}
                    className="w-full flex items-center justify-center gap-2 btn-gold py-3.5 rounded-xl text-sm font-semibold disabled:opacity-60"
                  >
                    <Play size={16} /> {starting ? 'Starting…' : 'Start Installation'}
                  </button>
                </>
              ) : (
                <p className="text-white/40 text-sm text-center">
                  Waiting for {acceptedByUser?.name ?? 'the assigned installer'} to start installation
                </p>
              )
            )}
          </>
        )}

        {/* Execution — once installation has started (and read-only after
            completion). */}
        {(isInProgress || isCompleted) && (<>
        {lowStockSeries.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl p-4 bg-red-500/10 border border-red-500/30">
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">
              Film stock running low: {lowStockSeries.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}. Please reorder soon.
            </p>
          </div>
        )}

        <div className="relative overflow-hidden rounded-2xl p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card space-y-3">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h2 className="font-display text-base text-white font-semibold tracking-wide">Tinted Glass Checklist</h2>
            <span className="text-xs text-white/50">{installedCount} of {orderItems.length} done</span>
          </div>
          {!canWork && !isCompleted && (
            <p className="text-white/40 text-xs">
              Read-only — this job belongs to {acceptedByUser?.name ?? 'another installer'}.
            </p>
          )}
          {/* One card per individual glass — left and right always separate. */}
          {allSelections.map((sel) => {
            const item = itemFor(sel);
            if (!item) return null;
            const requested = item.requestedSeries ?? sel.series;
            const vlt = item.requestedVlt ?? sel.vlt;
            const done = item.status === 'installed';
            const saving = savingItemId === item.id;
            return (
              <div
                key={sel.position}
                className={`rounded-xl p-4 border transition-colors ${
                  done ? 'bg-emerald-500/[0.06] border-emerald-500/25' : 'bg-white/[0.02] border-white/10'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-start gap-2 min-w-0">
                    {done
                      ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                      : <Circle size={16} className="text-white/30 shrink-0 mt-0.5" />}
                    <p className="text-white text-sm font-medium">{GLASS_LABEL[sel.position] ?? sel.position}</p>
                  </div>
                  <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                    done
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                      : 'bg-white/[0.03] border-white/10 text-white/60'
                  }`}>
                    {done ? 'Completed' : 'Pending'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs mb-3">
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
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1.2fr_120px] gap-2.5 mb-2.5">
                  <select
                    disabled={!canEditGlass}
                    value={item.installerId ?? ''}
                    onChange={(e) => handleInstallerChange(item, e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg
                      px-3 py-2 text-white text-sm outline-none transition-colors disabled:opacity-50"
                  >
                    <option value="" className="bg-obsidian-900">Select Installer</option>
                    {installers.map((i) => (
                      <option key={i.id} value={i.id} className="bg-obsidian-900">{i.name}</option>
                    ))}
                  </select>
                  <SqftCell
                    key={`${item.id}-${sqftResetTick}`}
                    value={item.sqft}
                    disabled={!canEditGlass}
                    onCommit={(v) => handleSqftChange(item, v)}
                  />
                </div>

                <RemarkCell
                  value={item.remark}
                  disabled={!canEditGlass}
                  onCommit={(v) => handleRemarkChange(item, v)}
                />

                {canEditGlass && (
                  <div className="flex justify-end mt-3">
                    {done ? (
                      <button
                        type="button"
                        onClick={() => handleUndoGlass(item)}
                        disabled={saving}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-white/[0.03] border-white/10
                          text-white/60 hover:text-white/90 hover:border-white/20 transition-colors disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Undo'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleConfirmGlass(item)}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border
                          bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                      >
                        <CheckCircle2 size={13} /> {saving ? 'Saving…' : 'Confirm Completed'}
                      </button>
                    )}
                  </div>
                )}
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

        {error && <p className="text-red-400 text-xs text-center">{error}</p>}

        {/* Installer's side ends here — the work order moves on to the
            salesman (payment / delivery / warranty / close). */}
        {isCompleted && job && (
          <div className="relative overflow-hidden rounded-2xl p-6 bg-emerald-500/[0.06] border border-emerald-500/25 shadow-card space-y-3">
            <h2 className="flex items-center gap-2 font-display text-base text-emerald-400 font-semibold tracking-wide">
              <CheckCircle2 size={16} /> Installation Completed
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-white/70">
              {job.completedAt && <p>Completed {formatWhen(job.completedAt)}</p>}
              <p>By {allUsers.find((u) => u.id === (job.completedBy ?? job.acceptedBy))?.name ?? '—'}</p>
              {job.finalInspectionAt && <p className="sm:col-span-2">Final inspection confirmed</p>}
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

        {!isCompleted && canWork && (
          <>
            {!allGlassConfirmed && (
              <p className="text-white/40 text-xs text-center">
                Confirm every glass above to complete ({installedCount} of {allSelections.length} done)
              </p>
            )}
            <button
              onClick={openComplete}
              disabled={!allGlassConfirmed}
              className="w-full flex items-center justify-center gap-2 btn-gold py-3.5 rounded-xl text-sm font-semibold disabled:opacity-40"
            >
              <CheckCircle2 size={16} /> Complete Installation
            </button>
          </>
        )}
        </>)}
      </div>

      <Modal isOpen={completeOpen} onClose={() => !completing && setCompleteOpen(false)} title="Complete Installation">
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 size={14} /> All {allSelections.length} glass items confirmed
          </p>

          <label className="flex items-start gap-2.5 text-sm text-white/80 cursor-pointer">
            <input type="checkbox" checked={confirmInstalled} onChange={(e) => setConfirmInstalled(e.target.checked)} className="accent-gold-500 mt-0.5" />
            Installation completed as ordered
          </label>
          <label className="flex items-start gap-2.5 text-sm text-white/80 cursor-pointer">
            <input type="checkbox" checked={confirmInspection} onChange={(e) => setConfirmInspection(e.target.checked)} className="accent-gold-500 mt-0.5" />
            Final inspection done — no bubbles, peeling or damage
          </label>

          <div>
            <label className="block text-gray-300 text-xs font-medium mb-1.5">Installer Remarks (optional)</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={3}
              placeholder="Anything the salesman should know…"
              className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600
                rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors resize-none"
            />
          </div>

          <div>
            <p className="text-gray-300 text-xs font-medium mb-1.5">Installation Photos (optional)</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {photos.map((f, i) => (
                <span key={`${f.name}-${i}`} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/[0.03] text-white/70 max-w-[180px]">
                  <span className="truncate">{f.name}</span>
                  <button onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))} className="text-white/40 hover:text-red-400 shrink-0">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium cursor-pointer
                bg-white/[0.03] border-white/10 text-white/60 hover:text-white/90 hover:border-white/20 transition-colors">
                <Upload size={14} /> Upload
                <input type="file" accept="image/*" multiple onChange={handlePhotoPick} className="hidden" />
              </label>
              <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium cursor-pointer
                bg-white/[0.03] border-white/10 text-white/60 hover:text-white/90 hover:border-white/20 transition-colors">
                <Camera size={14} /> Take Photo
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoPick} className="hidden" />
              </label>
            </div>
          </div>

          <p className="text-white/40 text-xs">Completion time will be recorded as now ({formatWhen(new Date().toISOString())}).</p>

          {completeError && <p className="text-red-400 text-xs">{completeError}</p>}

          <div className="flex gap-3">
            <button onClick={() => setCompleteOpen(false)} disabled={completing} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
            <button
              onClick={handleComplete}
              disabled={completing || !confirmInstalled || !confirmInspection}
              className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-50"
            >
              {completing ? 'Completing…' : 'Complete Installation'}
            </button>
          </div>
        </div>
      </Modal>

      <GarageAcceptJobModal
        job={acceptOpen ? job : null}
        invoiceNumber={invoice?.invoiceNumber}
        serviceLabel={serviceLabel}
        onClose={() => setAcceptOpen(false)}
        onAccepted={handleAccepted}
        onAlreadyAccepted={handleAlreadyAccepted}
      />

      <GarageAssignJobModal
        job={assignOpen ? job : null}
        invoiceNumber={invoice?.invoiceNumber}
        onClose={() => setAssignOpen(false)}
        onAssigned={handleAccepted}
        onAlreadyAccepted={() => { setAssignOpen(false); handleAlreadyAccepted(); }}
      />
    </GarageShell>
  );
}
