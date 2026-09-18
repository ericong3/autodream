import { useState } from 'react';
import { X, Landmark, Car as CarIcon } from 'lucide-react';
import { Car, Payment, JournalEntry, LedgerAccount } from '../types';
import { formatRM } from '../utils/format';
import { recordDisbursement } from '../utils/recordDisbursement';

interface DealInfo {
  bank: string;
  sellingPrice: number;
  discount: number;
  insurance: number;
  bankProduct: number;
  additionalTotal: number;
  bookingFee: number;
  loanAmount: number;
}

interface Props {
  payment: Payment;
  car: Car;
  dealInfo: DealInfo | null;
  currentUserId: string;
  onClose: () => void;
  updateCar: (id: string, patch: Partial<Car>) => Promise<void>;
  payments: Payment[];
  addPayment: (p: Payment) => Promise<void>;
  updatePayment: (id: string, u: Partial<Payment>) => Promise<void>;
  ledgerAccounts: LedgerAccount[];
  addLedgerAccount: (a: LedgerAccount) => Promise<void>;
  journalEntries: JournalEntry[];
  addJournalEntry: (e: JournalEntry) => Promise<void>;
  voidJournalEntry: (id: string, userId: string, reason: string) => Promise<void>;
}

// The Receivable tab's "Collect" action for a loan disbursement — shows the
// deal it's actually attached to (not just a bare amount field), then runs
// through the exact same recordDisbursement path History.tsx's own
// disbursement modal uses, so however a director gets here the car, payment,
// and ledger all end up agreeing.
export default function DisbursementCollectModal({
  payment, car, dealInfo, currentUserId, onClose,
  updateCar, payments, addPayment, updatePayment, ledgerAccounts, addLedgerAccount, journalEntries, addJournalEntry, voidJournalEntry,
}: Props) {
  const initialExpected = car.disbursementExpectedAmount ?? dealInfo?.loanAmount ?? payment.amount;
  const [expected, setExpected] = useState(String(initialExpected || ''));
  const [actual, setActual] = useState(String(car.disbursementAmount || payment.amount || ''));
  const [date, setDate] = useState(car.disbursementDate ?? new Date().toISOString().slice(0, 10));
  const [charges, setCharges] = useState<{ label: string; amount: string }[]>(
    (car.disbursementCharges ?? []).map(c => ({ label: c.label, amount: String(c.amount) }))
  );
  const [saving, setSaving] = useState(false);

  const expectedNum = Number(expected || 0);
  const actualNum = Number(actual || 0);
  const remaining = expectedNum > 0 ? expectedNum - actualNum : 0;
  const chargesTotal = charges.reduce((s, c) => s + Number(c.amount || 0), 0);
  const allocationDiff = remaining - chargesTotal;
  const isBalanced = expectedNum > 0 ? Math.abs(allocationDiff) < 0.5 : true;
  const canConfirm = !!actual && isBalanced && !saving;

  const photo = car.photos?.[0] || car.photo;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSaving(true);
    try {
      const chargeItems = charges
        .map(c => ({ label: c.label.trim(), amount: Number(c.amount || 0) }))
        .filter(c => c.label && c.amount > 0);
      await recordDisbursement(
        { car, grossAmount: expectedNum || actualNum, netAmount: actualNum, charges: chargeItems, date, currentUserId },
        { updateCar, payments, addPayment, updatePayment, ledgerAccounts, addLedgerAccount, journalEntries, addJournalEntry, voidJournalEntry },
      );
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

      <div
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain rounded-[32px] border border-white/[0.08]"
        style={{
          background: 'linear-gradient(160deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 2px 0 rgba(255,255,255,0.06) inset, 0 -1px 0 rgba(0,0,0,0.4) inset',
        }}
      >
        {/* Specular highlight — a soft band of light along the top edge, like glass catching light from above */}
        <div
          className="absolute inset-x-0 top-0 h-32 pointer-events-none rounded-t-[32px]"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 100%)' }}
        />
        {/* Ambient gold glow, low and to one side — quiet, not a spotlight */}
        <div
          className="absolute -top-24 -left-24 w-64 h-64 rounded-full pointer-events-none opacity-[0.15]"
          style={{ background: 'radial-gradient(circle, #EAB820 0%, transparent 70%)', filter: 'blur(40px)' }}
        />

        <button
          onClick={onClose}
          className="absolute top-5 right-5 z-10 p-2 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>

        <div className="relative p-8 space-y-6">
          {/* Header: car + bank */}
          <div className="flex items-center gap-3 pr-8">
            <div className="shrink-0 w-12 h-12 rounded-2xl overflow-hidden bg-white/[0.04] border border-white/10 flex items-center justify-center">
              {photo ? <img src={photo} alt="" className="w-full h-full object-cover" /> : <CarIcon size={18} className="text-white/30" />}
            </div>
            <div className="min-w-0">
              <p className="text-white font-medium text-sm truncate">{car.make} {car.model}{car.carPlate ? ` · ${car.carPlate}` : ''}</p>
              <p className="text-white/40 text-xs flex items-center gap-1 mt-0.5"><Landmark size={11} />{dealInfo?.bank ?? payment.recipientName}</p>
            </div>
          </div>

          {/* Hero: amount to collect */}
          <div>
            <p className="label-caps mb-1">Amount to Collect</p>
            <p className="font-display headline-gold text-5xl tabular-nums animate-price-in leading-tight">
              {formatRM(payment.amount)}
            </p>
          </div>

          {dealInfo && (
            <>
              <div className="divider-gold" />
              <div className="rounded-2xl bg-black/25 border border-white/[0.06] p-5">
                <p className="label-caps mb-3">Deal Breakdown</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-white/60"><span>Selling Price</span><span className="tabular-nums">{formatRM(dealInfo.sellingPrice)}</span></div>
                  {dealInfo.discount > 0 && (
                    <div className="flex justify-between text-white/60"><span>Discount</span><span className="tabular-nums">− {formatRM(dealInfo.discount)}</span></div>
                  )}
                  {dealInfo.insurance > 0 && (
                    <div className="flex justify-between text-white/60"><span>Insurance</span><span className="tabular-nums">+ {formatRM(dealInfo.insurance)}</span></div>
                  )}
                  {dealInfo.bankProduct > 0 && (
                    <div className="flex justify-between text-white/60"><span>Bank Product</span><span className="tabular-nums">+ {formatRM(dealInfo.bankProduct)}</span></div>
                  )}
                  {dealInfo.additionalTotal > 0 && (
                    <div className="flex justify-between text-white/60"><span>Additional Items</span><span className="tabular-nums">+ {formatRM(dealInfo.additionalTotal)}</span></div>
                  )}
                  {dealInfo.bookingFee > 0 && (
                    <div className="flex justify-between text-white/60"><span>Booking Fee (already collected)</span><span className="tabular-nums">− {formatRM(dealInfo.bookingFee)}</span></div>
                  )}
                </div>
                <div className="flex justify-between items-center mt-3 pt-3 border-t border-white/10">
                  <span className="text-white font-medium text-sm">{dealInfo.bank} Approved Loan</span>
                  <span className="text-white font-bold tabular-nums">{formatRM(dealInfo.loanAmount)}</span>
                </div>
              </div>
            </>
          )}

          <div className="divider-gold" />

          {/* Collection form */}
          <div className="space-y-4">
            <p className="label-caps">Record Collection</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-white/50 text-xs font-medium mb-1.5">Total Price (RM)</label>
                <input
                  type="number" value={expected} onChange={e => setExpected(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm placeholder-white/20 focus:outline-none focus:border-gold-400/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-white/50 text-xs font-medium mb-1.5">Amount Disbursed (RM)</label>
                <input
                  type="number" value={actual} onChange={e => setActual(e.target.value)} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm placeholder-white/20 focus:outline-none focus:border-gold-400/50 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-white/50 text-xs font-medium mb-1.5">Collection Date</label>
              <input
                type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm focus:outline-none focus:border-gold-400/50 transition-colors"
              />
            </div>

            {expectedNum > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-black/25 border border-white/[0.06]">
                  <span className="text-xs text-white/50">Remaining to itemize</span>
                  <span className={`text-sm font-bold tabular-nums ${isBalanced ? 'text-emerald-400' : 'text-amber-400'}`}>{formatRM(allocationDiff)}</span>
                </div>
                {charges.map((charge, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="text" placeholder="e.g. Processing Fee" value={charge.label}
                      onChange={e => setCharges(cs => cs.map((c, idx) => idx === i ? { ...c, label: e.target.value } : c))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                      className="flex-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm placeholder-white/20 focus:outline-none focus:border-gold-400/50 transition-colors"
                    />
                    <input
                      type="number" placeholder="RM" value={charge.amount}
                      onChange={e => setCharges(cs => cs.map((c, idx) => idx === i ? { ...c, amount: e.target.value } : c))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                      className="w-24 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm placeholder-white/20 focus:outline-none focus:border-gold-400/50 transition-colors"
                    />
                    <button onClick={() => setCharges(cs => cs.filter((_, idx) => idx !== i))} className="p-2 rounded-lg text-white/30 hover:text-red-400 transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setCharges(cs => [...cs, { label: '', amount: '' }])}
                  className="text-xs text-gold-400 hover:text-gold-300 font-medium"
                >
                  + Add Charge
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="w-full py-3.5 rounded-2xl bg-gold-gradient text-obsidian-950 text-sm font-bold shadow-gold-deep hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Confirming…' : `Confirm Collection · ${formatRM(actualNum || payment.amount)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
