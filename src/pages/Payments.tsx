import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Wallet, CheckCircle2, X, Search, CreditCard, Camera,
  Trash2, Plus, ChevronDown, ArrowUpRight, ArrowDownLeft, Receipt, CalendarDays,
  Users, Wrench, Building2, UserCircle, DollarSign, RefreshCw, TrendingDown, TrendingUp,
  Clock, AlertTriangle, Check,
} from 'lucide-react';
import { useStore } from '../store';
import { Payment, PaymentType, RecipientType } from '../types';
import { formatRM, generateId } from '../utils/format';
import { collectMissingPayments } from '../utils/generatePayments';
import { buildClaimConfirmedEntry, buildClaimPaidEntry } from '../utils/generateJournalEntries';
import { supabase } from '../lib/supabase';
import Modal from '../components/Modal';

async function uploadReceipt(file: File): Promise<string> {
  const path = `receipts/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage.from('car-photos').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from('car-photos').getPublicUrl(path);
  return data.publicUrl;
}

// ── Labels / colors ───────────────────────────────────────────────────────────

const TYPE_LABELS: Record<PaymentType, string> = {
  salesman_commission:    'Commission',
  intake_bonus:           'Intake Bonus',
  source_commission:      'Source Comm.',
  repair:                 'Workshop',
  misc_cost:              'Misc Cost',
  consignment_payout:     'Consign Payout',
  consignment_collection: 'Consign Collect',
  panel_charge:           'Panel Charge',
  investor_payout:        'Investor Payout',
  customer_refund:        'Customer Refund',
  customer_collection:    'Cash Collection',
  loan_disbursement:      'Loan Disbursement',
  expense_claim:          'Expense Claim',
};

const TYPE_COLORS: Record<PaymentType, string> = {
  salesman_commission:    'bg-gold-500/20 text-gold-300 border-gold-500/20',
  intake_bonus:           'bg-purple-500/20 text-purple-300 border-purple-500/20',
  source_commission:      'bg-blue-500/20 text-blue-300 border-blue-500/20',
  repair:                 'bg-orange-500/20 text-orange-300 border-orange-500/20',
  misc_cost:              'bg-pink-500/20 text-pink-300 border-pink-500/20',
  consignment_payout:     'bg-green-500/20 text-green-300 border-green-500/20',
  consignment_collection: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/20',
  panel_charge:           'bg-teal-500/20 text-teal-300 border-teal-500/20',
  investor_payout:        'bg-indigo-500/20 text-indigo-300 border-indigo-500/20',
  customer_refund:        'bg-red-500/20 text-red-300 border-red-500/20',
  customer_collection:    'bg-lime-500/20 text-lime-300 border-lime-500/20',
  loan_disbursement:      'bg-cyan-500/20 text-cyan-300 border-cyan-500/20',
  expense_claim:          'bg-amber-500/20 text-amber-300 border-amber-500/20',
};

// Payments we RECEIVE (not pay out)
const INBOUND_TYPES = new Set<PaymentType>(['customer_collection', 'loan_disbursement', 'consignment_collection']);

const RECIPIENT_ICON: Record<RecipientType, React.ElementType> = {
  user:             UserCircle,
  external_salesman: Users,
  workshop:         Wrench,
  dealer:           Building2,
  merchant:         Receipt,
  customer:         UserCircle,
};

const RECIPIENT_COLORS: Record<RecipientType, string> = {
  user:             'bg-gold-500/20 text-gold-300',
  external_salesman: 'bg-purple-500/20 text-purple-300',
  workshop:         'bg-orange-500/20 text-orange-300',
  dealer:           'bg-teal-500/20 text-teal-300',
  merchant:         'bg-pink-500/20 text-pink-300',
  customer:         'bg-emerald-500/20 text-emerald-300',
};

const RECIPIENT_TYPE_LABELS: Record<RecipientType, string> = {
  user:             'Staff',
  external_salesman: 'Ext. Salesman',
  workshop:         'Workshop',
  dealer:           'Dealer',
  merchant:         'Merchant',
  customer:         'Customer',
};

type StatusTab = 'to_pay' | 'to_collect' | 'transferred' | 'all' | 'refund_claims' | 'expense_claims';

const EMPTY_ADD = {
  type: '' as PaymentType | '',
  recipientType: '' as RecipientType | '',
  recipientId: '',
  amount: '',
  description: '',
  carId: '',
};

// ── Transfer / Collect modal ──────────────────────────────────────────────────
interface TransferModalProps {
  count: number;
  totalAmount: number;
  isCollect?: boolean;
  onConfirm: (date: string, notes: string, actualReceived?: number, receiptUrl?: string) => Promise<void>;
  onClose: () => void;
}

function TransferModal({ count, totalAmount, isCollect, onConfirm, onClose }: TransferModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [actualStr, setActualStr] = useState('');
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const actual = parseFloat(actualStr) || 0;
  const overpaid = isCollect && actual > 0 && actual > totalAmount ? actual - totalAmount : 0;
  const underpaid = isCollect && actual > 0 && actual < totalAmount ? totalAmount - actual : 0;

  const handlePickReceipt = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
  };

  const handleConfirm = async () => {
    setSaving(true);
    let receiptUrl: string | undefined;
    if (receiptFile) {
      try { receiptUrl = await uploadReceipt(receiptFile); } catch { /* ignore upload error */ }
    }
    await onConfirm(date, notes, isCollect && actual > 0 ? actual : undefined, receiptUrl);
    setSaving(false);
  };

  const title = isCollect ? 'Mark as Collected' : 'Mark as Transferred';
  const btnLabel = isCollect ? 'Confirm Collected' : 'Confirm Transfer';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm glass-panel shadow-card-lg rounded-xl overflow-hidden max-h-[90vh] overflow-y-auto overscroll-contain">
        <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl bg-gold-gradient opacity-80" />
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {count === 1 ? '1 payment' : `${count} payments`} · {formatRM(totalAmount)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-obsidian-500/60 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {isCollect && count === 1 && (
            <div>
              <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1.5">
                Actual Amount Received (RM)
              </label>
              <input
                type="number"
                value={actualStr}
                onChange={e => setActualStr(e.target.value)}
                placeholder={totalAmount.toFixed(2)}
                min="0"
                step="0.01"
                className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gold-500/50 transition-colors"
              />
              {overpaid > 0 && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                  <TrendingDown size={12} className="text-amber-400 shrink-0" />
                  <p className="text-xs text-amber-300">
                    Overpaid by <span className="font-bold">{formatRM(overpaid)}</span> — a refund entry will be created automatically.
                  </p>
                </div>
              )}
              {underpaid > 0 && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                  <TrendingDown size={12} className="text-red-400 shrink-0" />
                  <p className="text-xs text-red-300">
                    Short by <span className="font-bold">{formatRM(underpaid)}</span> — balance remains outstanding.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Receipt upload */}
          <div>
            <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1.5">
              <span className="flex items-center gap-1"><Receipt size={10} />Transaction Receipt</span>
            </label>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePickReceipt} className="hidden" />
            {receiptPreview ? (
              <div className="relative">
                <img src={receiptPreview} alt="Receipt" className="w-full rounded-lg object-cover max-h-48" />
                <button
                  onClick={() => { setReceiptPreview(null); setReceiptFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                  className="absolute top-2 right-2 p-1 rounded-full bg-black/60 text-white hover:bg-red-500/80 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-white/20 text-gray-400 hover:text-white hover:border-gold-500/40 transition-colors text-sm"
              >
                <Camera size={16} />
                Take photo / upload receipt
              </button>
            )}
          </div>

          <div>
            <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1.5">
              <span className="flex items-center gap-1"><CalendarDays size={10} />{isCollect ? 'Collection Date' : 'Transfer Date'}</span>
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-gold-500/50 transition-colors"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1.5">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={isCollect ? 'e.g. Cash received at counter' : 'e.g. Via Maybank transfer'}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gold-500/50 transition-colors resize-none"
            />
          </div>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-gold-gradient text-obsidian-950 text-sm font-bold shadow-gold-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : btnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
interface PaymentsProps { embedded?: boolean; }
export default function Payments({ embedded }: PaymentsProps) {
  const {
    payments, addPayment, batchAddPayments, updatePayment, deletePayment,
    currentUser, users, externalSalesmen, workshops, dealers, merchants, cars, customers, repairs, loaded,
    addRepair, addMiscCost, deleteRepair, deleteMiscCost, addJournalEntry, voidJournalEntry, journalEntries,
  } = useStore(s => ({
    payments:          s.payments,
    addPayment:        s.addPayment,
    batchAddPayments:  s.batchAddPayments,
    updatePayment:     s.updatePayment,
    deletePayment:     s.deletePayment,
    currentUser:       s.currentUser,
    users:             s.users,
    externalSalesmen:  s.externalSalesmen,
    workshops:         s.workshops,
    dealers:           s.dealers,
    merchants:         s.merchants,
    cars:              s.cars,
    customers:         s.customers,
    repairs:           s.repairs,
    loaded:            s.loaded,
    addRepair:         s.addRepair,
    addMiscCost:       s.addMiscCost,
    deleteRepair:      s.deleteRepair,
    deleteMiscCost:    s.deleteMiscCost,
    addJournalEntry:   s.addJournalEntry,
    voidJournalEntry:  s.voidJournalEntry,
    journalEntries:    s.journalEntries,
  }));

  const [tab, setTab] = useState<StatusTab>('to_pay');
  const [typeFilter, setTypeFilter] = useState<PaymentType | ''>('');
  const [monthFilter, setMonthFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transferTarget, setTransferTarget] = useState<'single' | 'batch' | null>(null);
  const [singleId, setSingleId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_ADD });
  const [addSaving, setAddSaving] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<number | null>(null);

  // Auto-backfill once after data is loaded
  const BACKFILL_KEY = 'autodream-payment-backfill-v2';
  useEffect(() => {
    if (!loaded) return;
    if (localStorage.getItem(BACKFILL_KEY)) return;
    localStorage.setItem(BACKFILL_KEY, 'done');
    const missing = collectMissingPayments({ cars, customers, repairs, users, externalSalesmen, dealers, workshops, merchants, payments });
    if (missing.length > 0) batchAddPayments(missing);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filters ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return payments.filter(p => {
      if (tab === 'to_pay'    && (p.status !== 'pending' || INBOUND_TYPES.has(p.type))) return false;
      if (tab === 'to_collect'&& (p.status !== 'pending' || !INBOUND_TYPES.has(p.type))) return false;
      if (tab === 'transferred' && p.status !== 'transferred') return false;
      if (tab === 'refund_claims' && p.type !== 'customer_refund') return false;
      if (tab === 'expense_claims' && p.type !== 'expense_claim') return false;
      if (typeFilter && p.type !== typeFilter) return false;
      if (monthFilter && !p.createdAt.startsWith(monthFilter)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!p.recipientName.toLowerCase().includes(q) && !p.description?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [payments, tab, typeFilter, monthFilter, search]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const pendingPayments = payments.filter(p => p.status === 'pending');
  const pendingOutbound = pendingPayments.filter(p => !INBOUND_TYPES.has(p.type));
  const pendingInbound = pendingPayments.filter(p => INBOUND_TYPES.has(p.type));
  const pendingRefundClaims = pendingPayments.filter(p => p.type === 'customer_refund');
  const pendingExpenseClaims = pendingPayments.filter(p => p.type === 'expense_claim');
  const pendingTotal = pendingOutbound.reduce((s, p) => s + p.amount, 0);
  const toCollectTotal = pendingInbound.reduce((s, p) => s + p.amount, 0);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthTransferred = payments
    .filter(p => p.status === 'transferred' && p.transferredAt?.startsWith(thisMonth))
    .reduce((s, p) => s + p.amount, 0);

  // ── Recipient options ────────────────────────────────────────────────────────
  function recipientOptions(type: RecipientType | '') {
    if (type === 'user') return users.map(u => ({ id: u.id, name: u.name, bankName: u.bankName, accountNumber: u.bankAccountNumber, accountHolder: u.bankAccountHolder }));
    if (type === 'external_salesman') return externalSalesmen.map(e => ({ id: e.id, name: e.name, bankName: e.bank, accountNumber: e.bankAccount, accountHolder: undefined }));
    if (type === 'workshop') return workshops.map(w => ({ id: w.id, name: w.name, bankName: w.bankName, accountNumber: w.bankAccountNumber, accountHolder: w.bankAccountHolder }));
    if (type === 'dealer') return dealers.map(d => ({ id: d.id, name: d.name, bankName: d.bankName, accountNumber: d.bankAccountNumber, accountHolder: d.bankAccountHolder }));
    if (type === 'merchant') return merchants.map(m => ({ id: m.id, name: m.name, bankName: m.bankName, accountNumber: m.bankAccountNumber, accountHolder: m.bankAccountHolder }));
    if (type === 'customer') return customers.map(c => ({ id: c.id, name: c.name, bankName: undefined, accountNumber: undefined, accountHolder: undefined }));
    return [];
  }

  // ── Selection helpers ────────────────────────────────────────────────────────
  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selectAll = () => {
    const pendingIds = filtered
      .filter(p => p.status === 'pending' && !(p.type === 'customer_refund' && !p.bankName) && !(p.type === 'expense_claim' && (!p.claimConfirmedBy || (p.recipientType !== 'user' && !p.recipientId))))
      .map(p => p.id);
    setSelected(prev => pendingIds.length === prev.size && pendingIds.every(id => prev.has(id)) ? new Set() : new Set(pendingIds));
  };

  const selectedPending = filtered.filter(p => p.status === 'pending' && selected.has(p.id));
  const selectedTotal = selectedPending.reduce((s, p) => s + p.amount, 0);

  // ── Transfer / Collect ────────────────────────────────────────────────────────
  const handleTransfer = async (date: string, notes: string, actualReceived?: number, receiptUrl?: string) => {
    const now = new Date().toISOString();
    const ids = transferTarget === 'batch' ? selectedPending.map(p => p.id) : singleId ? [singleId] : [];
    await Promise.all(ids.map(id =>
      updatePayment(id, {
        status: 'transferred',
        transferredAt: date ? new Date(date).toISOString() : now,
        transferredBy: currentUser?.id,
        // Only overwrite receiptUrl if a new one was actually uploaded — some payments
        // (expense claims, workshop invoices) already carry a receipt from submission,
        // and updatePayment's local merge would otherwise blank it out mid-transfer.
        ...(receiptUrl ? { receiptUrl } : {}),
        notes: notes || undefined,
      })
    ));
    // Paying a confirmed claim clears the payable it was posted against
    if (currentUser) {
      const claimsBeingPaid = ids
        .map(id => payments.find(p => p.id === id))
        .filter((p): p is Payment => !!p && p.type === 'expense_claim');
      await Promise.all(claimsBeingPaid.map(claim => {
        const claimCar = claim.carId ? cars.find(c => c.id === claim.carId) : undefined;
        return addJournalEntry(buildClaimPaidEntry({ claim, car: claimCar, createdBy: currentUser.id }));
      }));
    }
    // Auto-create refund if customer overpaid
    if (actualReceived !== undefined && transferTarget === 'single' && singleId) {
      const payment = payments.find(p => p.id === singleId);
      if (payment && INBOUND_TYPES.has(payment.type) && actualReceived > payment.amount) {
        const overpaid = actualReceived - payment.amount;
        await addPayment({
          id: generateId(),
          type: 'customer_refund',
          carId: payment.carId,
          recipientType: 'customer',
          recipientId: payment.recipientId,
          recipientName: payment.recipientName,
          amount: Math.round(overpaid * 100) / 100,
          description: `Refund — overpaid ${formatRM(overpaid)}`,
          status: 'pending',
          createdAt: now,
        });
      }
    }
    setTransferTarget(null);
    setSingleId(null);
    setSelected(new Set());
  };

  // ── Expense claim review ─────────────────────────────────────────────────────
  // Confirming is also the moment a claim starts counting toward the car's
  // profit numbers — it writes into the same repair/misc-cost records every
  // other page already reads, so nothing else needs to change to pick it up.
  const handleConfirmClaim = async (id: string) => {
    const claim = payments.find(p => p.id === id);
    if (!claim || claim.claimConfirmedBy) return;
    await updatePayment(id, { claimConfirmedBy: currentUser?.id, claimConfirmedAt: new Date().toISOString() });
    if (currentUser) {
      const claimCar = claim.carId ? cars.find(c => c.id === claim.carId) : undefined;
      await addJournalEntry(buildClaimConfirmedEntry({ claim, car: claimCar, createdBy: currentUser.id }));
    }
    if (!claim.carId) return;
    const vendorName = claim.recipientType !== 'user' ? claim.recipientName : undefined;
    // Store the new record's id back on the claim so deleting a wrongly-added
    // claim later can clean up the ledger entry it created, not just itself.
    if (claim.claimKind === 'repair') {
      const repairJobId = generateId();
      await addRepair({
        id: repairJobId,
        carId: claim.carId,
        typeOfRepair: claim.claimCategory || claim.description || 'Repair',
        parts: [],
        labourCost: 0,
        totalCost: claim.amount,
        status: 'done',
        location: vendorName,
        receiptPhoto: claim.receiptUrl,
        completedAt: new Date().toISOString(),
        notes: claim.description,
        createdAt: claim.createdAt,
      });
      await updatePayment(id, { repairJobId });
    } else if (claim.claimKind === 'misc') {
      const miscCostId = generateId();
      await addMiscCost(claim.carId, {
        id: miscCostId,
        description: claim.claimCategory || claim.description || 'Misc',
        amount: claim.amount,
        category: claim.claimCategory,
        merchant: vendorName,
        createdAt: claim.createdAt,
        createdBy: claim.recipientId || undefined,
      });
      await updatePayment(id, { miscCostId });
    }
  };

  // ── Link an unregistered claim to a real Workshop/Merchant ─────────────────────
  const [linkVendorTarget, setLinkVendorTarget] = useState<string | null>(null);
  const [vendorQuery, setVendorQuery] = useState('');

  const vendorOptions = useMemo(() => [
    ...workshops.map(w => ({ id: w.id, name: w.name, kind: 'workshop' as const, bankName: w.bankName, accountNumber: w.bankAccountNumber, accountHolder: w.bankAccountHolder })),
    ...merchants.map(m => ({ id: m.id, name: m.name, kind: 'merchant' as const, bankName: m.bankName, accountNumber: m.bankAccountNumber, accountHolder: m.bankAccountHolder })),
  ], [workshops, merchants]);

  const filteredVendors = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    return !q ? vendorOptions : vendorOptions.filter(v => v.name.toLowerCase().includes(q));
  }, [vendorOptions, vendorQuery]);

  const handleLinkVendor = async (vendor: typeof vendorOptions[number]) => {
    if (!linkVendorTarget) return;
    await updatePayment(linkVendorTarget, {
      recipientType: vendor.kind,
      recipientId: vendor.id,
      recipientName: vendor.name,
      bankName: vendor.bankName,
      accountNumber: vendor.accountNumber,
      accountHolder: vendor.accountHolder,
    });
    setLinkVendorTarget(null);
    setVendorQuery('');
  };

  // ── Add payment ───────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!addForm.type || !addForm.recipientType || !addForm.recipientId || !addForm.amount) return;
    const opts = recipientOptions(addForm.recipientType);
    const rec = opts.find(o => o.id === addForm.recipientId);
    if (!rec) return;
    setAddSaving(true);
    await addPayment({
      id: generateId(),
      type: addForm.type,
      recipientType: addForm.recipientType,
      recipientId: addForm.recipientId,
      recipientName: rec.name,
      bankName: rec.bankName,
      accountNumber: rec.accountNumber,
      accountHolder: rec.accountHolder,
      amount: parseFloat(addForm.amount),
      description: addForm.description || undefined,
      carId: addForm.carId || undefined,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    setAddSaving(false);
    setShowAdd(false);
    setAddForm({ ...EMPTY_ADD });
  };

  const isAdmin     = currentUser?.role === 'admin';
  const isDirectorView = currentUser?.role === 'director' || currentUser?.role === 'shareholder';

  // ── Delete ────────────────────────────────────────────────────────────────────
  // A confirmed claim may have already written a repair job / misc cost onto its
  // car — deleting a wrongly-added claim needs to clean that up too, not just
  // the payment itself, or the car's cost numbers would still show the mistake.
  const handleDelete = async (id: string) => {
    const claim = payments.find(p => p.id === id);
    if (!confirm('Delete this payment entry?')) return;
    if (claim?.repairJobId) await deleteRepair(claim.repairJobId);
    if (claim?.carId && claim?.miscCostId) await deleteMiscCost(claim.carId, claim.miscCostId);
    // Ledger entries are never hard-deleted — void them so the mistake and its
    // correction both stay on record, instead of quietly vanishing with the payment.
    const linkedEntries = journalEntries.filter(e => e.sourceId === id && !e.voided);
    if (linkedEntries.length > 0 && currentUser) {
      await Promise.all(linkedEntries.map(e => voidJournalEntry(e.id, currentUser.id, 'Source payment deleted')));
    }
    await deletePayment(id);
  };

  const handleRequestDelete = async (id: string) => {
    await updatePayment(id, {
      deleteRequestedBy: currentUser!.id,
      deleteRequestedAt: new Date().toISOString(),
    });
  };

  const handleApproveDelete = (id: string) => {
    if (confirm('Approve deletion of this payment?')) deletePayment(id);
  };

  const handleRejectDelete = async (id: string) => {
    await updatePayment(id, { deleteRequestedBy: undefined, deleteRequestedAt: undefined });
  };

  // ── Backfill ──────────────────────────────────────────────────────────────────
  const handleBackfill = async () => {
    setBackfilling(true);
    const missing = collectMissingPayments({ cars, customers, repairs, users, externalSalesmen, dealers, workshops, merchants, payments });
    if (missing.length > 0) await batchAddPayments(missing);
    setBackfillResult(missing.length);
    setBackfilling(false);
    setTimeout(() => setBackfillResult(null), 4000);
  };

  // ── Car lookup ────────────────────────────────────────────────────────────────
  const carMap = useMemo(() => {
    const m: Record<string, string> = {};
    cars.forEach(c => { m[c.id] = `${c.make} ${c.model}${c.carPlate ? ` · ${c.carPlate}` : ''}`; });
    return m;
  }, [cars]);

  // ── Render row ────────────────────────────────────────────────────────────────
  function PaymentRow({ p }: { p: Payment }) {
    const Icon = RECIPIENT_ICON[p.recipientType] ?? UserCircle;
    const isPending = p.status === 'pending';
    const isChecked = selected.has(p.id);
    const isInbound = INBOUND_TYPES.has(p.type);
    const hasDeleteRequest = !!p.deleteRequestedBy;
    const refundMissingBankDetails = p.type === 'customer_refund' && !p.bankName;
    const claimNeedsVendor = p.type === 'expense_claim' && p.recipientType !== 'user' && !p.recipientId;
    const unconfirmedClaim = p.type === 'expense_claim' && !p.claimConfirmedBy;

    return (
      <div className={`flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] last:border-0 transition-colors ${hasDeleteRequest && isDirectorView ? 'bg-red-500/5 border-l-2 border-l-red-500/40' : isChecked ? 'bg-gold-500/5' : 'hover:bg-white/[0.02]'}`}>
        {/* Checkbox — only for pending, not for claims that still need review */}
        {isPending && !refundMissingBankDetails && !unconfirmedClaim && !claimNeedsVendor ? (
          <button
            onClick={() => toggleSelect(p.id)}
            className={`shrink-0 w-4 h-4 rounded border transition-colors ${isChecked ? 'bg-gold-500 border-gold-500' : 'border-white/20 hover:border-gold-400/50'}`}
          >
            {isChecked && <svg viewBox="0 0 12 12" fill="none" className="w-4 h-4 -m-px"><path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-obsidian-950" /></svg>}
          </button>
        ) : (
          <div className="shrink-0 w-4" />
        )}

        {/* Recipient icon */}
        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${RECIPIENT_COLORS[p.recipientType]}`}>
          <Icon size={14} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-white font-medium truncate">{p.recipientName}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${TYPE_COLORS[p.type]}`}>
              {TYPE_LABELS[p.type]}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px] text-gray-500">{RECIPIENT_TYPE_LABELS[p.recipientType]}</span>
            {p.description && <span className="text-[11px] text-gray-500 truncate">· {p.description}</span>}
            {p.carId && carMap[p.carId] && (
              <span className="text-[11px] text-gray-600 truncate">· {carMap[p.carId]}</span>
            )}
            {p.bankName && (
              <span className="text-[11px] text-gray-600 hidden sm:inline">· {p.bankName} {p.accountNumber}</span>
            )}
          </div>
          {(p.status === 'transferred' || !!p.receiptUrl || (p.type === 'expense_claim' && !!p.claimConfirmedBy)) && (
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {p.status === 'transferred' && p.transferredAt && (
                <span className="text-[10px] text-gray-600">
                  {new Date(p.transferredAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                </span>
              )}
              {p.type === 'expense_claim' && p.claimConfirmedBy && (
                <span className="text-[10px] text-sky-400 flex items-center gap-1">
                  <Check size={9} /> Confirmed{p.claimConfirmedAt ? ` ${new Date(p.claimConfirmedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}` : ''}
                </span>
              )}
              {p.receiptUrl && (
                <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded border border-green-500/20 flex items-center gap-1 hover:bg-green-500/20 transition-colors">
                  <Receipt size={9} />Receipt
                </a>
              )}
            </div>
          )}
        </div>

        {/* Amount + actions */}
        <div className="shrink-0 flex items-center gap-2">
          <div className="flex items-center gap-1">
            {isInbound && <TrendingUp size={11} className="text-emerald-400" />}
            {!isInbound && isPending && <TrendingDown size={11} className="text-red-400/60" />}
            <span className={`text-sm font-bold tabular-nums ${isPending ? (isInbound ? 'text-emerald-300' : 'text-white') : 'text-gray-400'}`}>
              {formatRM(p.amount)}
            </span>
          </div>
          {isPending ? (
            refundMissingBankDetails ? (
              <span
                title="Salesperson hasn't submitted the customer's refund bank details yet"
                className="flex items-center gap-1 text-[10px] text-amber-400 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 whitespace-nowrap"
              >
                <Clock size={10} /> Awaiting details
              </span>
            ) : claimNeedsVendor ? (
              (isDirectorView || isAdmin) ? (
                <button
                  onClick={() => setLinkVendorTarget(p.id)}
                  title="This vendor isn't registered yet — add them in Data before this can be confirmed"
                  className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap bg-violet-500/20 text-violet-300 border-violet-500/20 hover:bg-violet-500/30"
                >
                  <Building2 size={11} /> Register Vendor
                </button>
              ) : (
                <span
                  title="Waiting for the vendor to be registered before this can be reviewed"
                  className="flex items-center gap-1 text-[10px] text-amber-400 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 whitespace-nowrap"
                >
                  <Clock size={10} /> Needs vendor
                </span>
              )
            ) : unconfirmedClaim ? (
              (isDirectorView || isAdmin) ? (
                <button
                  onClick={() => handleConfirmClaim(p.id)}
                  title="Check the receipt matches the amount, then confirm"
                  className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap bg-sky-500/20 text-sky-300 border-sky-500/20 hover:bg-sky-500/30"
                >
                  <Check size={11} /> Confirm
                </button>
              ) : (
                <span
                  title="Waiting for admin to check the receipt before this can be paid"
                  className="flex items-center gap-1 text-[10px] text-amber-400 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 whitespace-nowrap"
                >
                  <Clock size={10} /> Awaiting review
                </span>
              )
            ) : (
              <button
                onClick={() => { setSingleId(p.id); setTransferTarget('single'); }}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap ${
                  isInbound
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/30'
                    : 'bg-gold-500/20 text-gold-300 border-gold-500/20 hover:bg-gold-500/30'
                }`}
              >
                {isInbound ? 'Collect' : 'Transfer'}
              </button>
            )
          ) : (
            <CheckCircle2 size={14} className="text-green-400 opacity-60" />
          )}
          {/* Delete / Request Delete */}
          {isDirectorView && p.deleteRequestedBy ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleApproveDelete(p.id)}
                title="Approve deletion"
                className="p-1 rounded text-red-400 hover:bg-red-500/20 transition-colors"
              >
                <Check size={12} />
              </button>
              <button
                onClick={() => handleRejectDelete(p.id)}
                title="Reject deletion"
                className="p-1 rounded text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          ) : isAdmin ? (
            p.deleteRequestedBy ? (
              <span title="Pending director approval" className="flex items-center gap-1 text-[10px] text-amber-400 px-1.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <Clock size={10} /> Pending
              </span>
            ) : (
              <button
                onClick={() => handleRequestDelete(p.id)}
                title="Request deletion"
                className="p-1 rounded text-gray-600 hover:text-red-400 transition-colors"
              >
                <Trash2 size={12} />
              </button>
            )
          ) : isDirectorView ? (
            <button
              onClick={() => handleDelete(p.id)}
              className="p-1 rounded text-gray-600 hover:text-red-400 transition-colors"
            >
              <Trash2 size={12} />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const transferPayments = transferTarget === 'batch' ? selectedPending : singleId ? payments.filter(p => p.id === singleId) : [];
  const transferTotal = transferPayments.reduce((s, p) => s + p.amount, 0);

  return (
    <div className={embedded ? 'pb-10' : 'min-h-screen bg-obsidian-950 pb-32'}>
      {/* Header */}
      <div className={embedded ? 'mb-1' : 'sticky top-0 z-30 bg-obsidian-950/95 backdrop-blur-sm border-b border-white/[0.06]'}>
        <div className={embedded ? 'pb-3' : 'px-4 pt-4 pb-3'}>
          {!embedded && (
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Wallet size={18} className="text-gold-400" />
                <h1 className="font-display text-white font-semibold text-base tracking-wide">Payments</h1>
              </div>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold-gradient text-obsidian-950 text-xs font-bold shadow-gold-sm hover:opacity-90 active:scale-95 transition-all"
              >
                <Plus size={13} />
                Add
              </button>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-xl bg-obsidian-800/60 border border-white/[0.06] px-3 py-2.5">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">To Pay Out</p>
              <p className="text-sm font-bold text-white tabular-nums">{formatRM(pendingTotal)}</p>
              <p className="text-[10px] text-gray-600">{pendingOutbound.length} pending</p>
            </div>
            <div className="rounded-xl bg-obsidian-800/60 border border-emerald-500/20 px-3 py-2.5">
              <p className="text-[10px] text-emerald-600 uppercase tracking-wider mb-0.5">To Collect</p>
              <p className="text-sm font-bold text-emerald-300 tabular-nums">{formatRM(toCollectTotal)}</p>
              <p className="text-[10px] text-gray-600">{pendingInbound.length} pending</p>
            </div>
            <div className="rounded-xl bg-obsidian-800/60 border border-white/[0.06] px-3 py-2.5">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">This Month</p>
              <p className="text-sm font-bold text-green-400 tabular-nums">{formatRM(monthTransferred)}</p>
              <p className="text-[10px] text-gray-600">transferred / collected</p>
            </div>
            <div className="rounded-xl bg-obsidian-800/60 border border-white/[0.06] px-3 py-2.5 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Backfill</p>
                <p className="text-[10px] text-gray-600">Sync old data</p>
              </div>
              <button
                onClick={handleBackfill}
                disabled={backfilling}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-obsidian-700/60 border border-white/[0.08] text-xs text-gray-300 hover:text-white hover:border-gold-500/30 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={11} className={backfilling ? 'animate-spin' : ''} />
                {backfilling ? '...' : backfillResult !== null ? `+${backfillResult}` : 'Run'}
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 rounded-xl bg-obsidian-800/60 border border-white/[0.06] p-1 mb-3">
            {([
              { key: 'to_pay',     label: 'To Pay',    icon: TrendingDown, count: pendingOutbound.length },
              { key: 'to_collect', label: 'To Collect', icon: TrendingUp,  count: pendingInbound.length },
              { key: 'refund_claims', label: 'Refund Claims', icon: Receipt, count: pendingRefundClaims.length },
              { key: 'expense_claims', label: 'Expense Claims', icon: CreditCard, count: pendingExpenseClaims.length },
              { key: 'transferred',label: 'Done',       icon: CheckCircle2, count: 0 },
              { key: 'all',        label: 'All',        icon: null,         count: 0 },
            ] as { key: StatusTab; label: string; icon: any; count: number }[]).map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                onClick={() => { setTab(key); setSelected(new Set()); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                  tab === key ? 'bg-gold-gradient text-obsidian-950 font-bold shadow-gold-sm' : 'text-gray-400 hover:text-white'
                }`}
              >
                {Icon && <Icon size={10} />}
                {label}
                {count > 0 && (
                  <span className={`text-[10px] px-1.5 rounded-full font-bold ${tab === key ? 'bg-obsidian-900/60 text-gold-400' : 'bg-gold-500/20 text-gold-400'}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            {/* Search */}
            <div className="relative flex-1">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search recipient..."
                className="w-full pl-8 pr-3 py-2 rounded-lg bg-obsidian-800/60 border border-white/[0.06] text-white text-xs placeholder-gray-600 focus:outline-none focus:border-gold-500/30 transition-colors"
              />
            </div>
            {/* Type filter */}
            <div className="relative">
              <button
                onClick={() => setShowTypeDropdown(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-obsidian-800/60 border border-white/[0.06] text-xs text-gray-300 hover:text-white transition-colors whitespace-nowrap"
              >
                <DollarSign size={11} className="text-gray-500" />
                {typeFilter ? TYPE_LABELS[typeFilter] : 'All Types'}
                <ChevronDown size={11} className="text-gray-500" />
              </button>
              {showTypeDropdown && (
                <div className="absolute right-0 top-full mt-1 w-44 rounded-xl bg-obsidian-800 border border-white/[0.08] shadow-card-lg overflow-hidden z-50">
                  {[{ value: '' as const, label: 'All Types' },
                    ...Object.entries(TYPE_LABELS).map(([v, l]) => ({ value: v as PaymentType, label: l }))
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setTypeFilter(opt.value as PaymentType | ''); setShowTypeDropdown(false); }}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors ${typeFilter === opt.value ? 'text-gold-300 bg-gold-500/10' : 'text-gray-300 hover:bg-white/[0.05]'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Month filter */}
            <input
              type="month"
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              className="px-2 py-2 rounded-lg bg-obsidian-800/60 border border-white/[0.06] text-xs text-gray-300 focus:outline-none focus:border-gold-500/30 transition-colors w-[110px]"
            />
          </div>
        </div>
      </div>

      {/* Delete-request banner for directors */}
      {isDirectorView && payments.some(p => p.deleteRequestedBy) && (
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 mb-1">
            <AlertTriangle size={13} className="text-red-400 shrink-0" />
            <p className="text-xs text-red-300 font-medium">
              {payments.filter(p => p.deleteRequestedBy).length} payment{payments.filter(p => p.deleteRequestedBy).length !== 1 ? 's' : ''} pending deletion approval — review below (✓ approve · ✕ reject)
            </p>
          </div>
        </div>
      )}

      {/* List */}
      <div className="px-4 pt-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Wallet size={40} className="text-gray-700" />
            <p className="text-gray-500 text-sm">No payments found</p>
            {tab === 'to_pay' && (
              <p className="text-gray-600 text-xs text-center max-w-xs">
                Payment entries appear here automatically when deals are delivered, repairs completed, or misc costs logged.
              </p>
            )}
            {tab === 'refund_claims' && (
              <p className="text-gray-600 text-xs text-center max-w-xs">
                Claims appear once a salesperson submits the customer's refund bank details on a loan deal with money owed back.
              </p>
            )}
            {tab === 'expense_claims' && (
              <p className="text-gray-600 text-xs text-center max-w-xs">
                Claims appear here once staff submit a petrol/bill receipt from the Claims page.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-obsidian-900/40">
            {/* Select-all bar for pending tabs */}
            {(tab === 'to_pay' || tab === 'to_collect' || tab === 'refund_claims' || tab === 'expense_claims') && filtered.some(p => p.status === 'pending') && (
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06] bg-obsidian-800/40">
                <button
                  onClick={selectAll}
                  className="text-[11px] text-gray-400 hover:text-white transition-colors"
                >
                  {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
                </button>
                {selected.size > 0 && (
                  <>
                    <span className="text-gray-600 text-[11px]">·</span>
                    <span className="text-[11px] text-gold-400 font-medium">{formatRM(selectedTotal)}</span>
                    <button
                      onClick={() => setSelected(new Set())}
                      className="ml-auto text-[11px] text-gray-500 hover:text-white transition-colors"
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            )}
            {filtered.map(p => <PaymentRow key={p.id} p={p} />)}
          </div>
        )}
      </div>

      {/* Batch transfer bar */}
      {selectedPending.length > 0 && (
        <div className="fixed bottom-20 left-0 right-0 z-40 px-4">
          <div className="rounded-xl bg-obsidian-800 border border-gold-500/30 shadow-card-lg p-3 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-bold text-white">{selectedPending.length} selected</p>
              <p className="text-xs text-gray-400">{formatRM(selectedTotal)} total</p>
            </div>
            <button
              onClick={() => setTransferTarget('batch')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gold-gradient text-obsidian-950 text-sm font-bold shadow-gold-sm hover:opacity-90 active:scale-95 transition-all"
            >
              {tab === 'to_collect' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
              {tab === 'to_collect' ? 'Collect All' : 'Transfer All'}
            </button>
          </div>
        </div>
      )}

      {/* Transfer modal */}
      {transferTarget && (
        <TransferModal
          count={transferPayments.length}
          totalAmount={transferTotal}
          isCollect={transferTarget === 'single' && singleId ? INBOUND_TYPES.has(payments.find(p => p.id === singleId)?.type ?? 'repair') : false}
          onConfirm={handleTransfer}
          onClose={() => { setTransferTarget(null); setSingleId(null); }}
        />
      )}

      {/* Link claim to a registered vendor */}
      <Modal isOpen={!!linkVendorTarget} onClose={() => { setLinkVendorTarget(null); setVendorQuery(''); }} title="Register Vendor" maxWidth="max-w-sm">
        <div className="space-y-3">
          <p className="text-gray-400 text-xs">
            Pick the workshop or merchant this bill is going to. Not on the list yet? Add them in Data first, then come back here.
          </p>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              autoFocus
              value={vendorQuery}
              onChange={(e) => setVendorQuery(e.target.value)}
              placeholder="Search workshops & merchants..."
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-obsidian-800/60 border border-white/[0.08] text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gold-500/40 transition-colors"
            />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-white/[0.06] divide-y divide-white/[0.05]">
            {filteredVendors.length === 0 ? (
              <p className="px-3 py-3 text-xs text-gray-600 text-center">No matching workshop or merchant — add them in Data first.</p>
            ) : (
              filteredVendors.map((v) => (
                <button
                  key={`${v.kind}-${v.id}`}
                  onClick={() => handleLinkVendor(v)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/[0.05] transition-colors"
                >
                  {v.kind === 'workshop' ? <Wrench size={13} className="text-orange-400 shrink-0" /> : <Receipt size={13} className="text-pink-400 shrink-0" />}
                  <span className="flex-1 text-sm text-gray-200 truncate">{v.name}</span>
                  {!v.bankName && <span className="shrink-0 text-[10px] text-amber-400">no bank details</span>}
                </button>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* Add payment modal */}
      {showAdd && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative w-full max-w-sm glass-panel shadow-card-lg rounded-xl overflow-hidden max-h-[90vh] overflow-y-auto overscroll-contain">
            <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl bg-gold-gradient opacity-80" />
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <h3 className="text-sm font-semibold text-white">Add Payment Entry</h3>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-obsidian-500/60 transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Type */}
              <div>
                <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1.5">Payment Type <span className="text-red-400">*</span></label>
                <select
                  value={addForm.type}
                  onChange={e => setAddForm(f => ({ ...f, type: e.target.value as PaymentType }))}
                  className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-gold-500/50 transition-colors"
                >
                  <option value="">Select type…</option>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {/* Recipient type */}
              <div>
                <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1.5">Recipient Type <span className="text-red-400">*</span></label>
                <select
                  value={addForm.recipientType}
                  onChange={e => setAddForm(f => ({ ...f, recipientType: e.target.value as RecipientType, recipientId: '' }))}
                  className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-gold-500/50 transition-colors"
                >
                  <option value="">Select recipient type…</option>
                  {Object.entries(RECIPIENT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {/* Recipient */}
              {addForm.recipientType && (
                <div>
                  <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1.5">Recipient <span className="text-red-400">*</span></label>
                  <select
                    value={addForm.recipientId}
                    onChange={e => setAddForm(f => ({ ...f, recipientId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-gold-500/50 transition-colors"
                  >
                    <option value="">Select recipient…</option>
                    {recipientOptions(addForm.recipientType).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              )}
              {/* Bank preview */}
              {addForm.recipientId && (() => {
                const opts = recipientOptions(addForm.recipientType);
                const rec = opts.find(o => o.id === addForm.recipientId);
                if (!rec?.bankName) return null;
                return (
                  <div className="rounded-lg bg-obsidian-700/30 border border-white/[0.06] px-3 py-2.5 flex items-center gap-2">
                    <CreditCard size={12} className="text-gold-400 shrink-0" />
                    <div className="text-xs text-gray-300">
                      <span className="font-medium">{rec.bankName}</span>
                      {rec.accountNumber && <span className="text-gray-500"> · {rec.accountNumber}</span>}
                      {rec.accountHolder && <span className="text-gray-500 block text-[11px]">{rec.accountHolder}</span>}
                    </div>
                  </div>
                );
              })()}
              {/* Amount */}
              <div>
                <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1.5">Amount (RM) <span className="text-red-400">*</span></label>
                <input
                  type="number"
                  value={addForm.amount}
                  onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gold-500/50 transition-colors"
                />
              </div>
              {/* Description */}
              <div>
                <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1.5">Description</label>
                <input
                  value={addForm.description}
                  onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. June commission for Proton Saga"
                  className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gold-500/50 transition-colors"
                />
              </div>
              {/* Car (optional) */}
              <div>
                <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1.5">Link to Car (optional)</label>
                <select
                  value={addForm.carId}
                  onChange={e => setAddForm(f => ({ ...f, carId: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-gold-500/50 transition-colors"
                >
                  <option value="">None</option>
                  {cars.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.make} {c.model} {c.carPlate ? `(${c.carPlate})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleAdd}
                disabled={!addForm.type || !addForm.recipientType || !addForm.recipientId || !addForm.amount || addSaving}
                className="w-full py-2.5 rounded-lg bg-gold-gradient text-obsidian-950 text-sm font-bold shadow-gold-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {addSaving ? 'Adding...' : 'Add Payment Entry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
