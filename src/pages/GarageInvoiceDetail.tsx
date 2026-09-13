import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Car, User, ShieldCheck, RefreshCw, AlertCircle } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import Modal from '../components/Modal';
import { useStore } from '../store';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import { getGarageInvoice, listInvoiceClaims, createInvoiceClaim } from '../lib/garageInvoices';
import { getTintOrder } from '../lib/garageTint';
import { GARAGE_SERVICE_MAP } from '../utils/garageServices';
import { TINT_SERIES, GLASS_POSITIONS, EXTRA_GLASS_OPTIONS } from '../utils/tintPricing';
import { formatRM } from '../utils/format';
import type { GarageInvoice, GarageVehicle, GarageCustomer, GarageInvoiceClaim, GarageClaimType, GarageTintOrder } from '../types';

const TINT_SERIES_LABEL = Object.fromEntries(TINT_SERIES.map((s) => [s.key, s.label]));
const GLASS_POSITION_LABEL = Object.fromEntries([...GLASS_POSITIONS, ...EXTRA_GLASS_OPTIONS].map((p) => [p.key, p.label]));

const CLAIM_META: Record<GarageClaimType, { label: string; bearBy: string; badge: string; icon: typeof ShieldCheck }> = {
  warranty: { label: 'Warranty Claim', bearBy: 'Borne by supplier', badge: 'bg-blue-500/15 border-blue-500/30 text-blue-400', icon: ShieldCheck },
  replacement: { label: 'Replacement', bearBy: 'Borne by company', badge: 'bg-orange-500/15 border-orange-500/30 text-orange-400', icon: RefreshCw },
};

export default function GarageInvoiceDetail() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const currentUser = useStore((s) => s.currentUser);

  const [invoice, setInvoice] = useState<GarageInvoice | null>(null);
  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const [customer, setCustomer] = useState<GarageCustomer | null>(null);
  const [claims, setClaims] = useState<GarageInvoiceClaim[]>([]);
  const [tintOrder, setTintOrder] = useState<GarageTintOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [claimModal, setClaimModal] = useState<GarageClaimType | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!invoiceId) return;
    setLoading(true);
    getGarageInvoice(invoiceId).then(async (inv) => {
      if (!inv) { setNotFound(true); setLoading(false); return; }
      setInvoice(inv);
      const [v, c, cl, to] = await Promise.all([
        getGarageVehicle(inv.vehicleId),
        getGarageCustomer(inv.customerId),
        listInvoiceClaims(inv.id),
        inv.service === 'tinted' ? getTintOrder(inv.id) : Promise.resolve(null),
      ]);
      setVehicle(v);
      setCustomer(c);
      setClaims(cl);
      setTintOrder(to);
      setLoading(false);
    });
  };

  useEffect(load, [invoiceId]);

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

  const meta = GARAGE_SERVICE_MAP[invoice.service];

  return (
    <GarageShell title={invoice.invoiceNumber} showBack backTo={backTo}>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Invoice info */}
        <div className="relative overflow-hidden rounded-[28px] p-8
          bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-full bg-gold-400/10 border border-gold-400/20 flex items-center justify-center text-gold-400 shrink-0">
              <meta.icon size={24} strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="font-display text-lg text-white font-semibold tracking-wide">{invoice.invoiceNumber}</h2>
              <p className="text-white/40 text-xs">{meta.label} · {new Date(invoice.invoiceDate).toLocaleDateString('en-MY')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
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
          </div>

          <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-white/10">
            <button
              onClick={() => openClaim('warranty')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-blue-500/30 text-blue-400
                hover:bg-blue-500/10 transition-colors text-sm font-medium"
            >
              <ShieldCheck size={15} /> File Warranty Claim
            </button>
            <button
              onClick={() => openClaim('replacement')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-orange-500/30 text-orange-400
                hover:bg-orange-500/10 transition-colors text-sm font-medium"
            >
              <RefreshCw size={15} /> File Replacement
            </button>
          </div>
        </div>

        {/* Tint package detail */}
        {tintOrder && (
          <div className="relative overflow-hidden rounded-[28px] p-8
            bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
            <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-4">
              {tintOrder.packageType === 'full' ? 'Full Package' : 'Mix & Match'}
            </h3>

            {tintOrder.packageType === 'full' && tintOrder.fullSeries && (
              <p className="text-white text-sm mb-3">{TINT_SERIES_LABEL[tintOrder.fullSeries]} — same series for every window</p>
            )}
            <div className="space-y-1.5">
              {tintOrder.selections.map((sel) => (
                <div key={sel.position} className="flex items-center justify-between text-sm">
                  <span className="text-white/60">{GLASS_POSITION_LABEL[sel.position]}</span>
                  <span className="text-white">
                    {tintOrder.packageType === 'mix' ? `${TINT_SERIES_LABEL[sel.series]} · ` : ''}{sel.vlt}
                  </span>
                </div>
              ))}
            </div>

            {tintOrder.extras.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/10 space-y-1.5">
                <p className="text-white/40 text-xs mb-1">Extras</p>
                {tintOrder.extras.map((sel) => (
                  <div key={sel.position} className="flex items-center justify-between text-sm">
                    <span className="text-white/60">{GLASS_POSITION_LABEL[sel.position]}</span>
                    <span className="text-white">{TINT_SERIES_LABEL[sel.series]} · {sel.vlt}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 pt-4 border-t border-white/10 space-y-1.5">
              {tintOrder.discount > 0 && (
                <div className="flex justify-between text-sm text-white/50">
                  <span>Discount</span>
                  <span>-{formatRM(tintOrder.discount)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline">
                <span className="text-white font-semibold text-sm">Final Total</span>
                <span className="text-gold-400 font-display text-lg font-bold">{formatRM(tintOrder.finalTotal)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Claims history */}
        {claims.length > 0 && (
          <div>
            <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-3">Claims</h3>
            <div className="space-y-3">
              {claims.map((c) => {
                const cm = CLAIM_META[c.type];
                return (
                  <div key={c.id} className="rounded-xl p-4 bg-white/[0.03] border border-white/10">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-1.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cm.badge}`}>
                        <cm.icon size={11} /> {cm.label}
                      </span>
                      <span className="text-white/30 text-xs">{new Date(c.createdAt).toLocaleDateString('en-MY')}</span>
                    </div>
                    <p className="text-white/40 text-xs mb-1">{cm.bearBy}</p>
                    {c.reason && <p className="text-white/70 text-sm mt-2">{c.reason}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
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
    </GarageShell>
  );
}
