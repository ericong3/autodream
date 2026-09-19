import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Banknote, CreditCard, ArrowRightLeft, CalendarClock, CheckCircle2, AlertCircle, Send, Clock,
  Upload, Camera, FileText, X,
} from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { useStore } from '../store';
import { createGarageInvoice, createInvoiceAddon, uploadInvoiceReceipt } from '../lib/garageInvoices';
import { createTintOrder } from '../lib/garageTint';
import { createInstallerJob } from '../lib/garageInstallerJobs';
import { formatRM } from '../utils/format';
import type { GaragePaymentMethod, GaragePaymentStatus } from '../types';
import type { PendingTintOrder, PendingAddon } from './GarageWorkOrderSummary';

interface PendingPayment {
  pending: PendingTintOrder;
  addons: PendingAddon[];
  addonsTotal: number;
  grandTotal: number;
}

const PAYMENT_METHODS: { key: GaragePaymentMethod; label: string; icon: typeof Banknote }[] = [
  { key: 'cash', label: 'Cash', icon: Banknote },
  { key: 'card', label: 'Card', icon: CreditCard },
  { key: 'transfer', label: 'Transfer', icon: ArrowRightLeft },
  { key: 'installment', label: 'Installment', icon: CalendarClock },
];

// Some customers pay before the job starts, some after — but always before
// the car is handed back. "Now" needs a method right away; "Later" just
// records that payment is still owed, to be settled before delivery.
const PAYMENT_TIMINGS: { key: GaragePaymentStatus; label: string; desc: string }[] = [
  { key: 'paid', label: 'Pay Now', desc: 'Customer pays before the job starts' },
  { key: 'pending', label: 'Pay Later', desc: 'Customer pays after the job — before delivery' },
];

export default function GarageWorkOrderPayment() {
  const { id, vehicleId } = useParams<{ id: string; vehicleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = useStore((s) => s.currentUser);

  const state = location.state as PendingPayment | undefined;

  const [timing, setTiming] = useState<GaragePaymentStatus>('paid');
  const [method, setMethod] = useState<GaragePaymentMethod | ''>('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleReceiptPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type) && file.type !== 'application/pdf') {
      setError('Receipt must be an image or a PDF');
      return;
    }
    setError('');
    setReceiptFile(file);
  };

  useEffect(() => {
    if (!state) {
      navigate(`/garage/work-order/customer/${id}/vehicle/${vehicleId}/service/tinted`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) return null;
  const { pending, addons, grandTotal } = state;

  const handleConfirm = async () => {
    if (timing === 'paid' && !method) { setError('Choose a payment method'); return; }
    setError('');
    setConfirming(true);
    try {
      const invoice = await createGarageInvoice({
        customerId: id!, vehicleId: vehicleId!, service: 'tinted',
        paymentMethod: method || undefined, paymentStatus: timing, createdBy: currentUser?.id,
      });
      await createTintOrder({
        invoiceId: invoice.id,
        packageType: pending.packageType,
        fullSeries: pending.fullSeries,
        selections: pending.selections,
        extras: pending.extras,
        discount: pending.discount,
        finalTotal: pending.finalTotal,
      });
      await Promise.all(addons.map((a) => createInvoiceAddon({
        invoiceId: invoice.id, name: a.name, price: a.price, qty: a.qty,
      })));
      if (receiptFile) {
        await uploadInvoiceReceipt(invoice.id, receiptFile);
      }
      // Only Tint has an installer queue so far — Coating/PPF/Spray will get
      // their own worker queues later.
      if (invoice.service === 'tinted') {
        await createInstallerJob({ invoiceId: invoice.id, service: invoice.service });
      }
      setDone(true);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong — please try again');
    } finally {
      setConfirming(false);
    }
  };

  if (done) {
    return (
      <GarageShell title="Payment" showBack={false}>
        <div className="max-w-5xl mx-auto flex flex-col items-center text-center py-16">
          <div className="relative mb-5 flex items-center justify-center">
            <div className="absolute w-20 h-20 rounded-full bg-emerald-400/10 blur-xl" />
            <CheckCircle2 size={40} strokeWidth={1.5} className="relative text-emerald-400" />
          </div>
          <h2 className="font-display text-xl text-white font-semibold tracking-wide mb-2">Work Order Confirmed</h2>
          <p className="text-white/50 text-sm mb-8">
            {timing === 'pending'
              ? 'Sent to the installer — they can now accept the job. Payment is still owed, to be collected before delivery.'
              : 'Sent to the installer — they can now accept the job.'}
          </p>
          <button
            onClick={() => navigate('/garage/dashboard')}
            className="btn-gold px-6 py-2.5 rounded-xl text-sm"
          >
            Back to Dashboard
          </button>
        </div>
      </GarageShell>
    );
  }

  return (
    <GarageShell title="Payment">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="relative overflow-hidden rounded-[28px] p-8 sm:p-10
          bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
          <div className="flex justify-between items-baseline mb-8 pb-6 border-b border-white/10">
            <span className="text-white/50 text-sm">Amount Due</span>
            <span className="text-gold-400 font-display text-3xl font-bold">{formatRM(grandTotal)}</span>
          </div>

          <p className="text-white/50 text-xs font-medium uppercase tracking-wider mb-4">When</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
            {PAYMENT_TIMINGS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTiming(t.key);
                  // Pay Later means payment isn't happening now — no method
                  // to record until it's actually collected at delivery.
                  if (t.key === 'pending') { setMethod(''); setReceiptFile(null); }
                }}
                className={`flex flex-col items-start gap-1 px-5 py-4 rounded-xl border text-left transition-colors ${
                  timing === t.key
                    ? 'bg-gold-500/15 border-gold-400/50'
                    : 'bg-white/[0.03] border-white/10 hover:border-white/20'
                }`}
              >
                <span className={`flex items-center gap-2 text-sm font-semibold ${timing === t.key ? 'text-gold-400' : 'text-white/80'}`}>
                  <Clock size={15} /> {t.label}
                </span>
                <span className="text-white/40 text-xs">{t.desc}</span>
              </button>
            ))}
          </div>

          {timing === 'paid' && (
            <>
              <p className="text-white/50 text-xs font-medium uppercase tracking-wider mb-4">Payment Method</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMethod(m.key)}
                    className={`flex flex-col items-center justify-center gap-2.5 px-4 py-7 rounded-xl border text-sm font-medium transition-colors ${
                      method === m.key
                        ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                        : 'bg-white/[0.03] border-white/10 text-white/60 hover:text-white/90 hover:border-white/20'
                    }`}
                  >
                    <m.icon size={24} strokeWidth={1.5} />
                    {m.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {timing === 'pending' && (
            <p className="text-white/40 text-sm">Payment will be collected later, before the car is delivered.</p>
          )}

          {timing === 'paid' && method && (
            <div className="mt-8 pt-6 border-t border-white/10">
              <p className="text-white/50 text-xs font-medium uppercase tracking-wider mb-4">Proof of Payment (optional)</p>
              {receiptFile ? (
                <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-gold-400/30 bg-gold-500/10">
                  <span className="flex items-center gap-2 text-sm text-white/80 truncate">
                    <FileText size={15} className="text-gold-400 shrink-0" /> {receiptFile.name}
                  </span>
                  <button onClick={() => setReceiptFile(null)} className="text-white/40 hover:text-red-400 transition-colors shrink-0">
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium
                      bg-white/[0.03] border-white/10 text-white/60 hover:text-white/90 hover:border-white/20 transition-colors"
                  >
                    <Upload size={16} /> Upload File
                  </button>
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium
                      bg-white/[0.03] border-white/10 text-white/60 hover:text-white/90 hover:border-white/20 transition-colors"
                  >
                    <Camera size={16} /> Take Photo
                  </button>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleReceiptPick} className="hidden" />
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleReceiptPick} className="hidden" />
            </div>
          )}
        </div>

        {error && (
          <p className="text-red-400 text-xs text-center flex items-center justify-center gap-1.5"><AlertCircle size={12} /> {error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex-1 px-4 py-3 btn-ghost rounded-xl text-sm !text-white/90 font-medium"
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="flex-[2] flex items-center justify-center gap-2 btn-gold px-4 py-3 rounded-xl text-sm disabled:opacity-60"
          >
            <Send size={15} /> {confirming ? 'Sending…' : 'Confirm & Send to Installer'}
          </button>
        </div>
      </div>
    </GarageShell>
  );
}
