import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Car, User, Phone, ShieldCheck, RefreshCw, AlertCircle, Banknote, CreditCard, ArrowRightLeft, CalendarClock,
  Clock, CheckCircle2, FileText, Award,
} from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { isGarageManager } from '../utils/garageRoles';
import Modal from '../components/Modal';
import { useStore } from '../store';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import {
  getGarageInvoice, listInvoiceClaims, createInvoiceClaim, listInvoiceAddons, markInvoicePaid, getInvoiceReceiptUrl,
  markInvoiceDelivered, registerInvoiceWarranty, listWorkOrderActivity,
} from '../lib/garageInvoices';
import { getInstallerJobForInvoice } from '../lib/garageInstallerJobs';
import { getTintOrder } from '../lib/garageTint';
import { GARAGE_SERVICE_MAP } from '../utils/garageServices';
import { TINT_SERIES, GLASS_LABEL } from '../utils/tintPricing';
import { formatRM } from '../utils/format';
import { WORK_ORDER_STAGE_LABEL, WORK_ORDER_STAGE_BADGE, WORK_ORDER_NEXT_ACTION } from '../utils/garageWorkOrderStatus';
import { buildWorkOrderPipeline, formatTime } from '../utils/garageWorkOrderTimeline';
import type { PipelineStageKey } from '../utils/garageWorkOrderTimeline';
import { useWorkOrderActivityUpdates } from '../hooks/useWorkOrderActivityUpdates';
import GarageInstallationPhotos from '../components/GarageInstallationPhotos';
import {
  PipelineStageTiles, StagePanel, ActivityTimeline, NextAction,
} from '../components/GarageWorkOrderPipeline';
import type {
  GarageInvoice, GarageVehicle, GarageCustomer, GarageInvoiceClaim, GarageClaimType, GarageTintOrder,
  GarageInvoiceAddon, GaragePaymentMethod, GarageInstallerJob, GarageWorkOrderActivity,
} from '../types';

const TINT_SERIES_LABEL = Object.fromEntries(TINT_SERIES.map((s) => [s.key, s.label]));

const CLAIM_META: Record<GarageClaimType, { label: string; bearBy: string; badge: string; icon: typeof ShieldCheck }> = {
  warranty: { label: 'Warranty Claim', bearBy: 'Borne by supplier', badge: 'bg-blue-500/15 border-blue-500/30 text-blue-400', icon: ShieldCheck },
  replacement: { label: 'Replacement', bearBy: 'Borne by company', badge: 'bg-orange-500/15 border-orange-500/30 text-orange-400', icon: RefreshCw },
};

const PAYMENT_METHOD_META: Record<GaragePaymentMethod, { label: string; icon: typeof Banknote }> = {
  cash: { label: 'Cash', icon: Banknote },
  card: { label: 'Card', icon: CreditCard },
  transfer: { label: 'Transfer', icon: ArrowRightLeft },
  installment: { label: 'Installment', icon: CalendarClock },
};

export default function GarageInvoiceDetail() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const currentUser = useStore((s) => s.currentUser);
  const allUsers = useStore((s) => s.users);

  const [invoice, setInvoice] = useState<GarageInvoice | null>(null);
  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const [customer, setCustomer] = useState<GarageCustomer | null>(null);
  const [claims, setClaims] = useState<GarageInvoiceClaim[]>([]);
  const [tintOrder, setTintOrder] = useState<GarageTintOrder | null>(null);
  const [addons, setAddons] = useState<GarageInvoiceAddon[]>([]);
  const [job, setJob] = useState<GarageInstallerJob | null>(null);
  const [activity, setActivity] = useState<GarageWorkOrderActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [claimModal, setClaimModal] = useState<GarageClaimType | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [openingReceipt, setOpeningReceipt] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [registeringWarranty, setRegisteringWarranty] = useState(false);
  // Pipeline: which stage's info is showing (null = the current stage).
  const [selectedStageKey, setSelectedStageKey] = useState<PipelineStageKey | null>(null);
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectMethod, setCollectMethod] = useState<GaragePaymentMethod | ''>('');
  const [confirmStep, setConfirmStep] = useState<'deliver' | 'warranty' | null>(null);
  const [actionError, setActionError] = useState('');

  const load = () => {
    if (!invoiceId) return;
    setLoading(true);
    getGarageInvoice(invoiceId).then(async (inv) => {
      if (!inv) { setNotFound(true); setLoading(false); return; }
      setInvoice(inv);
      const [v, c, cl, to, ad, j, act] = await Promise.all([
        getGarageVehicle(inv.vehicleId),
        getGarageCustomer(inv.customerId),
        listInvoiceClaims(inv.id),
        inv.service === 'tinted' ? getTintOrder(inv.id) : Promise.resolve(null),
        listInvoiceAddons(inv.id),
        inv.service === 'tinted' ? getInstallerJobForInvoice(inv.id) : Promise.resolve(null),
        listWorkOrderActivity(inv.id).catch(() => []),
      ]);
      setVehicle(v);
      setCustomer(c);
      setClaims(cl);
      setTintOrder(to);
      setAddons(ad);
      setJob(j);
      setActivity(act);
      setLoading(false);
    });
  };

  useEffect(load, [invoiceId]);

  // Every step on this work order (installer or salesman, any device) writes
  // an activity entry — when one lands, quietly refetch the work order, its
  // job and its history so the pipeline updates in place without a loading
  // flash.
  const refreshProgress = () => {
    if (!invoiceId) return;
    Promise.all([
      getGarageInvoice(invoiceId),
      getInstallerJobForInvoice(invoiceId),
      listWorkOrderActivity(invoiceId),
    ])
      .then(([inv, j, act]) => { if (inv) setInvoice(inv); setJob(j); setActivity(act); })
      .catch(() => {});
  };
  useWorkOrderActivityUpdates(invoiceId, refreshProgress);

  const openClaim = (type: GarageClaimType) => {
    setReason('');
    setClaimModal(type);
  };

  const handleFileClaim = async () => {
    if (!invoice || !claimModal) return;
    setSaving(true);
    try {
      await createInvoiceClaim({ invoiceId: invoice.id, type: claimModal, reason: reason.trim() || undefined, createdBy: currentUser?.id });
      setClaimModal(null);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleViewReceipt = async () => {
    if (!invoice?.receiptPath) return;
    setOpeningReceipt(true);
    try {
      const url = await getInvoiceReceiptUrl(invoice.receiptPath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setOpeningReceipt(false);
    }
  };

  const openCollectPayment = () => {
    setCollectMethod(invoice?.paymentMethod ?? '');
    setActionError('');
    setCollectOpen(true);
  };

  const handleCollectPayment = async () => {
    if (!invoice) return;
    if (!collectMethod) { setActionError('Choose how the customer paid'); return; }
    setMarkingPaid(true);
    try {
      await markInvoicePaid(invoice.id, currentUser?.id, collectMethod);
      setCollectOpen(false);
      setSelectedStageKey(null);
      load();
    } catch (err) {
      setActionError((err as Error)?.message ?? 'Could not record the payment — please try again');
    } finally {
      setMarkingPaid(false);
    }
  };

  const handleMarkDelivered = async () => {
    if (!invoice) return;
    setDelivering(true);
    try {
      await markInvoiceDelivered(invoice.id, currentUser?.id);
      setConfirmStep(null);
      setSelectedStageKey(null);
      load();
    } catch (err) {
      setActionError((err as Error)?.message ?? 'Could not complete delivery — please try again');
    } finally {
      setDelivering(false);
    }
  };

  const handleRegisterWarranty = async () => {
    if (!invoice) return;
    setRegisteringWarranty(true);
    try {
      await registerInvoiceWarranty(invoice.id, currentUser?.id);
      setConfirmStep(null);
      setSelectedStageKey(null);
      load();
    } catch (err) {
      setActionError((err as Error)?.message ?? 'Could not register the warranty — please try again');
    } finally {
      setRegisteringWarranty(false);
    }
  };

  const backTo = invoice ? `/garage/work-order/customer/${invoice.customerId}/vehicle/${invoice.vehicleId}` : '/garage';

  if (loading) {
    return (
      <GarageShell title="Invoice" showBack backTo={backTo}>
        <p className="text-white/40 text-sm text-center py-20">Loading…</p>
      </GarageShell>
    );
  }

  if (notFound || !invoice) {
    return (
      <GarageShell title="Invoice" showBack backTo="/garage">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle size={30} className="text-white/30 mb-3" />
          <p className="text-white/40 text-sm">Invoice not found</p>
        </div>
      </GarageShell>
    );
  }

  // Salesmen only see their own work orders (managers see every one). The
  // route guard can't know who owns an order, so it's checked here once
  // the order has loaded.
  if (!isGarageManager(currentUser?.role) && invoice.createdBy !== currentUser?.id) {
    return (
      <GarageShell title="Invoice" showBack backTo="/garage/my-work-orders">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle size={30} className="text-white/30 mb-3" />
          <p className="text-white/60 text-sm mb-1">This work order belongs to another salesman.</p>
          <p className="text-white/40 text-xs">You can only open work orders you created.</p>
        </div>
      </GarageShell>
    );
  }

  const meta = GARAGE_SERVICE_MAP[invoice.service];
  const nameOf = (id?: string) => (id ? allUsers.find((u) => u.id === id)?.name : undefined);
  const pipeline = buildWorkOrderPipeline(invoice, job, activity, nameOf);
  const { stage } = pipeline;
  const selectedStage = pipeline.stages.find((s) => s.key === (selectedStageKey ?? pipeline.currentKey)) ?? pipeline.stages[0];
  // Payment, delivery, warranty and closing are the salesman's (and
  // management's) steps — an installer finishes at Installation Completed and
  // must never close the work order.
  const isInstaller = currentUser?.role === 'garage_installer';

  // The one action that moves this work order forward from where it is —
  // the pipeline itself is read-only.
  const mainAction: { label: string; icon: typeof CheckCircle2; onClick: () => void } | null = isInstaller ? null
    : stage === 'payment_due' ? { label: 'Collect Payment', icon: Banknote, onClick: openCollectPayment }
    : stage === 'ready_for_delivery' ? { label: 'Complete Delivery', icon: Car, onClick: () => { setActionError(''); setConfirmStep('deliver'); } }
    : stage === 'ready_for_warranty' ? { label: 'Register Warranty', icon: Award, onClick: () => { setActionError(''); setConfirmStep('warranty'); } }
    : null;
  const waitingText: Record<typeof stage, string> = {
    waiting_for_installer: 'Waiting for an installer to accept',
    installer_assigned: 'Installer assigned — waiting to start',
    in_progress: 'Installation in progress',
    payment_due: 'Waiting for payment',
    ready_for_delivery: 'Ready for delivery',
    ready_for_warranty: 'Waiting for warranty registration',
    closed: 'Work order closed',
  };

  return (
    <GarageShell title={invoice.invoiceNumber} showBack backTo={backTo}>
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Header — which job this is, and the one action that moves it on */}
        <div className="relative overflow-hidden rounded-[24px] p-6 sm:p-7
          bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
          <div className="pointer-events-none absolute -top-24 -right-10 w-80 h-48 rounded-full bg-gold-400/[0.08] blur-3xl" />
          <div className="relative flex items-start justify-between gap-5 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap mb-2">
                <span className="text-white/50 text-xs font-semibold tracking-wider">{invoice.invoiceNumber}</span>
                <span className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border ${WORK_ORDER_STAGE_BADGE[stage]}`}>
                  {WORK_ORDER_STAGE_LABEL[stage]}
                </span>
              </div>
              <h2 className="font-display text-2xl text-white font-semibold tracking-wide">
                {vehicle ? `${vehicle.make} ${vehicle.model}` : meta.label}
                {vehicle && <span className="text-gold-400"> · {vehicle.registrationNo}</span>}
              </h2>
              <p className="text-white/50 text-sm mt-1">
                {meta.label}
                {tintOrder && ` · ${tintOrder.packageType === 'full'
                  ? `Full Package${tintOrder.fullSeries ? ` (${TINT_SERIES_LABEL[tintOrder.fullSeries]})` : ''}`
                  : 'Mix & Match'}`}
                {invoice.appointmentAt && ` · ${formatTime(invoice.appointmentAt)}`}
              </p>
              <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-3 text-xs text-white/50">
                {customer && <span className="flex items-center gap-1.5"><User size={12} /> {customer.name}</span>}
                {customer?.phone && <span className="flex items-center gap-1.5"><Phone size={12} /> {customer.phone}</span>}
                {invoice.paymentStatus === 'paid' ? (
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 size={12} /> Paid{invoice.paymentMethod && ` · ${PAYMENT_METHOD_META[invoice.paymentMethod].label}`}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-orange-400"><Clock size={12} /> Payment pending</span>
                )}
                {invoice.receiptPath && (
                  <button onClick={handleViewReceipt} disabled={openingReceipt}
                    className="flex items-center gap-1.5 hover:text-gold-400 transition-colors disabled:opacity-60">
                    <FileText size={12} /> {openingReceipt ? 'Opening…' : 'Receipt'}
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col items-stretch sm:items-end gap-2 w-full sm:w-auto">
              {mainAction ? (
                <button
                  onClick={mainAction.onClick}
                  className="flex items-center justify-center gap-2 btn-gold px-6 py-3 rounded-xl text-sm font-semibold
                    shadow-[0_0_24px_rgba(212,175,55,0.3)]"
                >
                  <mainAction.icon size={16} /> {mainAction.label}
                </button>
              ) : (
                <div className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium border ${
                  stage === 'closed'
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                    : 'bg-white/[0.03] border-white/10 text-white/50'
                }`}>
                  {stage === 'closed' ? <CheckCircle2 size={15} /> : <Clock size={15} />} {waitingText[stage]}
                </div>
              )}
              {/* Pay Later can be settled any time before delivery; once the
                  job's done it becomes the main action instead. */}
              {invoice.paymentStatus === 'pending' && !isInstaller && stage !== 'payment_due' && (
                <button
                  onClick={openCollectPayment}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border
                    border-gold-400/30 text-gold-400 hover:bg-gold-500/10 transition-colors"
                >
                  <Banknote size={13} /> Collect Payment Early
                </button>
              )}
              {actionError && !collectOpen && !confirmStep && (
                <p className="text-red-400 text-xs">{actionError}</p>
              )}
            </div>
          </div>
        </div>

        {/* Live job pipeline — read-only; tap a stage to inspect it */}
        <div className="rounded-[24px] p-5 sm:p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-white text-sm font-semibold">Live Job Pipeline</h3>
              <p className="text-white/40 text-xs mt-0.5">Tap a stage to see its details</p>
            </div>
            {selectedStageKey && (
              <button
                onClick={() => setSelectedStageKey(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-white/60
                  hover:text-white hover:border-white/25 transition-colors"
              >
                Back to current
              </button>
            )}
          </div>
          <PipelineStageTiles
            stages={pipeline.stages}
            selectedKey={selectedStage.key}
            onSelect={(key) => setSelectedStageKey(key === pipeline.currentKey ? null : key)}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">
          {/* Selected stage */}
          <div className="rounded-[24px] p-6 sm:p-7 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
            <StagePanel
              stage={selectedStage}
              salesmanSees={selectedStage.state === 'current' ? WORK_ORDER_STAGE_LABEL[stage] : selectedStage.headline}
            >
              {selectedStage.key === 'installation' && job?.status === 'completed' && (
                <div className="mb-5"><GarageInstallationPhotos invoiceId={invoice.id} /></div>
              )}
              {tintOrder && (
                <div className="rounded-xl border border-white/10 divide-y divide-white/[0.06] overflow-hidden">
                  {[...tintOrder.selections, ...tintOrder.extras].map((sel) => (
                    <div key={sel.position} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <span className="text-white/75">{GLASS_LABEL[sel.position] ?? sel.position}</span>
                      <span className="text-white font-semibold">{TINT_SERIES_LABEL[sel.series]} {sel.vlt.replace('%', '')}</span>
                    </div>
                  ))}
                </div>
              )}
            </StagePanel>
          </div>

          {/* Activity */}
          <div className="rounded-[24px] p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg lg:sticky lg:top-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white text-sm font-semibold">Activity</h3>
              <span className="flex items-center gap-1.5 text-[11px] text-white/40">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live timeline
              </span>
            </div>
            <ActivityTimeline events={pipeline.events} />
            <NextAction text={WORK_ORDER_NEXT_ACTION[stage]} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {/* Order summary — what was sold and for how much (the glass
              breakdown lives in the stage panel above) */}
          <div className="rounded-[24px] p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
            <h3 className="text-white text-sm font-semibold mb-4">Order Summary</h3>
            <div className="space-y-2 text-sm">
              {tintOrder && (
                <div className="flex justify-between gap-3">
                  <span className="text-white/60">
                    Window Tint · {tintOrder.packageType === 'full' ? 'Full Package' : 'Mix & Match'}
                    {tintOrder.extras.length > 0 && ` + ${tintOrder.extras.length} extra${tintOrder.extras.length > 1 ? 's' : ''}`}
                  </span>
                  <span className="text-white">{formatRM(tintOrder.finalTotal + tintOrder.discount)}</span>
                </div>
              )}
              {tintOrder && tintOrder.discount > 0 && (
                <div className="flex justify-between gap-3 text-white/50">
                  <span>Discount</span>
                  <span>-{formatRM(tintOrder.discount)}</span>
                </div>
              )}
              {addons.map((a) => (
                <div key={a.id} className="flex justify-between gap-3">
                  <span className="text-white/60">{a.name} {a.qty > 1 && <span className="text-white/30">× {a.qty}</span>}</span>
                  <span className="text-white">{formatRM(a.price * a.qty)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-white/10 flex justify-between items-baseline">
              <span className="text-white font-semibold text-sm">Order Total</span>
              <span className="text-gold-400 font-display text-xl font-bold">
                {formatRM((tintOrder?.finalTotal ?? 0) + addons.reduce((sum, a) => sum + a.price * a.qty, 0))}
              </span>
            </div>
          </div>

          {/* After-sales — warranty claims / replacements */}
          <div className="rounded-[24px] p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
            <h3 className="text-white text-sm font-semibold mb-4">After-sales</h3>
            <div className="flex flex-wrap gap-2.5 mb-4">
              <button
                onClick={() => openClaim('warranty')}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-blue-500/30 text-blue-400
                  hover:bg-blue-500/10 transition-colors text-xs font-medium"
              >
                <ShieldCheck size={14} /> File Warranty Claim
              </button>
              <button
                onClick={() => openClaim('replacement')}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-orange-500/30 text-orange-400
                  hover:bg-orange-500/10 transition-colors text-xs font-medium"
              >
                <RefreshCw size={14} /> File Replacement
              </button>
            </div>
            {claims.length === 0 ? (
              <p className="text-white/30 text-xs">No claims filed</p>
            ) : (
              <div className="space-y-2.5">
                {claims.map((c) => {
                  const cm = CLAIM_META[c.type];
                  return (
                    <div key={c.id} className="rounded-xl p-3.5 bg-white/[0.03] border border-white/10">
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cm.badge}`}>
                          <cm.icon size={11} /> {cm.label}
                        </span>
                        <span className="text-white/30 text-xs">{new Date(c.createdAt).toLocaleDateString('en-MY')}</span>
                      </div>
                      <p className="text-white/40 text-xs">{cm.bearBy}</p>
                      {c.reason && <p className="text-white/70 text-sm mt-1.5">{c.reason}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={!!claimModal}
        onClose={() => setClaimModal(null)}
        title={claimModal === 'warranty' ? 'File Warranty Claim' : 'File Replacement'}
      >
        <p className="text-gray-400 text-sm mb-4">
          {claimModal === 'warranty' ? 'Borne by the supplier.' : 'Borne by the company.'}
        </p>
        <label className="block text-gray-300 text-xs font-medium mb-1.5">Reason</label>
        <textarea
          className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600
            rounded-lg px-3 py-2 text-sm h-24 resize-none focus:outline-none focus:border-gold-500 transition-colors"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What's the issue?"
        />
        <div className="flex gap-3 mt-5">
          <button onClick={() => setClaimModal(null)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleFileClaim} disabled={saving} className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-60">
            {saving ? 'Saving…' : 'Submit'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={collectOpen} onClose={() => !markingPaid && setCollectOpen(false)} title="Collect Payment">
        <p className="text-gray-400 text-sm mb-4">
          How did the customer pay for {invoice.invoiceNumber}? This is recorded with your name and the time.
        </p>
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          {(Object.keys(PAYMENT_METHOD_META) as GaragePaymentMethod[]).map((m) => {
            const M = PAYMENT_METHOD_META[m].icon;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setCollectMethod(m)}
                className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-medium transition-colors ${
                  collectMethod === m
                    ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                    : 'bg-white/[0.03] border-white/10 text-white/60 hover:text-white/90 hover:border-white/20'
                }`}
              >
                <M size={16} /> {PAYMENT_METHOD_META[m].label}
              </button>
            );
          })}
        </div>
        {actionError && <p className="text-red-400 text-xs mb-3">{actionError}</p>}
        <div className="flex gap-3">
          <button onClick={() => setCollectOpen(false)} disabled={markingPaid} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleCollectPayment} disabled={markingPaid} className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-60">
            {markingPaid ? 'Saving…' : 'Confirm Payment'}
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={!!confirmStep}
        onClose={() => !(delivering || registeringWarranty) && setConfirmStep(null)}
        title={confirmStep === 'deliver' ? 'Complete Delivery' : 'Register Warranty'}
      >
        <p className="text-gray-400 text-sm mb-5">
          {confirmStep === 'deliver'
            ? `Confirm ${vehicle ? `${vehicle.make} ${vehicle.model} (${vehicle.registrationNo})` : 'the car'} has been handed back to the customer.`
            : "Confirm the tint has been registered with the manufacturer's e-warranty. This closes the work order."}
        </p>
        {actionError && <p className="text-red-400 text-xs mb-3">{actionError}</p>}
        <div className="flex gap-3">
          <button
            onClick={() => setConfirmStep(null)}
            disabled={delivering || registeringWarranty}
            className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            onClick={confirmStep === 'deliver' ? handleMarkDelivered : handleRegisterWarranty}
            disabled={delivering || registeringWarranty}
            className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-60"
          >
            {delivering || registeringWarranty ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </Modal>
    </GarageShell>
  );
}
