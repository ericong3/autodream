import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Trash2, FileText, Loader2, RefreshCw, Plus } from 'lucide-react';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';
import { Customer, LoanCase, LoanCaseDocument, LoanOrder, WorkOrderItem, BANKS } from '../types';
import { PDFDocument } from 'pdf-lib';
import { toast } from '../utils/toast';

async function compressPdf(file: File): Promise<File> {
  try {
    const buf = await file.arrayBuffer();
    const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
    const out = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
    return new File([out.buffer as ArrayBuffer], file.name, { type: 'application/pdf' });
  } catch {
    return file;
  }
}

interface Props {
  customer: Customer;
  initialCarId?: string;
  initialAmount?: number; // kept for backwards compat but no longer used (derived from loan order)
  initialBanks?: string[];
  onClose: () => void;
}

export default function LoanSubmitModal({ customer, initialCarId, initialBanks, onClose }: Props) {
  const currentUser = useStore(s => s.currentUser)!;
  const cars = useStore(s => s.cars);
  const bankers = useStore(s => s.bankers);
  const loanCases = useStore(s => s.loanCases);
  const loanCaseDocuments = useStore(s => s.loanCaseDocuments);
  const addLoanCase = useStore(s => s.addLoanCase);
  const addLoanCaseDocument = useStore(s => s.addLoanCaseDocument);
  const addLoanCaseActivity = useStore(s => s.addLoanCaseActivity);
  const updateCustomer = useStore(s => s.updateCustomer);

  // Prefill from existing loan order on customer
  const existingOrder = customer.loanOrder;

  // Find most recent previous case with docs for reuse
  const prevCase = [...loanCases]
    .filter(c => c.customerId === customer.id && c.salesmanId === currentUser.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .find(c => loanCaseDocuments.some(d => d.caseId === c.id));
  const prevDocs = prevCase ? loanCaseDocuments.filter(d => d.caseId === prevCase.id) : [];
  const prevApplicantDocs = prevDocs.filter(d => d.type === 'applicant');
  const prevGuarantorDocs = prevDocs.filter(d => d.type === 'guarantor');

  // ── Loan Order fields ──────────────────────────────────────────
  const [carId, setCarId] = useState(initialCarId ?? existingOrder?.carId ?? customer.interestedCarId ?? '');
  const selectedCar = cars.find(c => c.id === carId);
  const sellingPrice = selectedCar?.sellingPrice ?? 0;
  const [insurance, setInsurance] = useState(existingOrder?.insurance ?? 0);
  const [bankProduct, setBankProduct] = useState(existingOrder?.bankProduct ?? 0);
  const [additionalItems, setAdditionalItems] = useState<WorkOrderItem[]>(existingOrder?.additionalItems ?? []);
  const [discount, setDiscount] = useState(existingOrder?.discount ?? 0);
  const [hasTradeIn, setHasTradeIn] = useState(existingOrder?.hasTradeIn ?? false);
  const [tradeInPlate, setTradeInPlate] = useState(existingOrder?.tradeInPlate ?? '');
  const [tradeInMake, setTradeInMake] = useState(existingOrder?.tradeInMake ?? '');
  const [tradeInModel, setTradeInModel] = useState(existingOrder?.tradeInModel ?? '');
  const [tradeInVariant, setTradeInVariant] = useState(existingOrder?.tradeInVariant ?? '');
  const [tradeInPrice, setTradeInPrice] = useState(existingOrder?.tradeInPrice ?? 0);
  const [settlementFigure, setSettlementFigure] = useState(existingOrder?.settlementFigure ?? 0);

  const additionalTotal = additionalItems.reduce((s, i) => s + (i.amount || 0), 0);
  const totalLoan = sellingPrice + insurance + bankProduct + additionalTotal - discount;

  // ── Bank & banker selection ────────────────────────────────────
  // bankPicks: bank → bankerId (Banker.id or '' for none)
  const [bankPicks, setBankPicks] = useState<Record<string, string>>(() => {
    const picks: Record<string, string> = {};
    if (initialBanks && initialBanks.length > 0) {
      initialBanks.forEach(bank => {
        const first = bankers.filter(b => b.bank === bank)[0];
        if (first) picks[bank] = first.id;
      });
    }
    return picks;
  });

  // ── Documents ─────────────────────────────────────────────────
  const [applicantText, setApplicantText] = useState(prevCase?.applicantInterviewText ?? '');
  const [guarantorText, setGuarantorText] = useState(prevCase?.guarantorInterviewText ?? '');
  const [applicantFiles, setApplicantFiles] = useState<File[]>([]);
  const [guarantorFiles, setGuarantorFiles] = useState<File[]>([]);
  const [reuseDocs, setReuseDocs] = useState(prevApplicantDocs.length > 0);
  const [submitting, setSubmitting] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const applicantRef = useRef<HTMLInputElement>(null);
  const guarantorRef = useRef<HTMLInputElement>(null);

  const availableCars = cars.filter(c =>
    ['available', 'ready', 'photo_complete', 'coming_soon'].includes(c.status) || c.id === initialCarId
  );
  const selectedBanks = Object.keys(bankPicks).filter(b => bankPicks[b] !== '');
  const hasApplicantDocs = reuseDocs ? prevApplicantDocs.length > 0 : applicantFiles.length > 0;

  function addAdditionalItem() {
    setAdditionalItems(prev => [...prev, { label: '', amount: 0 }]);
  }
  function updateAdditionalItem(i: number, field: 'label' | 'amount', val: string | number) {
    setAdditionalItems(prev => prev.map((x, idx) => idx === i ? { ...x, [field]: val } : x));
  }
  function removeAdditionalItem(i: number) {
    setAdditionalItems(prev => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    if (selectedBanks.length === 0) { toast.error('Select at least one bank'); return; }
    if (!hasApplicantDocs) { toast.error('Please upload at least one applicant document'); return; }
    if (totalLoan <= 0) { toast.error('Loan amount must be greater than zero'); return; }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();

      // Save loan order to customer
      const loanOrder: LoanOrder = {
        carId: carId || undefined as any,
        sellingPrice,
        insurance,
        bankProduct,
        additionalItems,
        discount,
        requestedLoanAmount: totalLoan,
        hasTradeIn,
        ...(hasTradeIn ? { tradeInPlate, tradeInMake, tradeInModel, tradeInVariant, tradeInPrice, settlementFigure } : {}),
        submittedBy: currentUser.name,
        createdAt: now,
      };
      updateCustomer(customer.id, {
        loanOrder,
        leadStatus: 'loan_submitted',
        loanStatus: 'submitted',
        ...(carId && !customer.interestedCarId ? { interestedCarId: carId } : {}),
        lastActionAt: now,
      });
      await supabase.from('customers').update({
        loan_order: loanOrder,
        lead_status: 'loan_submitted',
        loan_status: 'submitted',
        ...(carId && !customer.interestedCarId ? { interested_car_id: carId } : {}),
        last_action_at: now,
      }).eq('id', customer.id);

      for (const bank of selectedBanks) {
        const bankerId = bankPicks[bank];
        const bankerProfile = bankers.find(b => b.id === bankerId);
        const caseId = crypto.randomUUID();
        const newCase: LoanCase = {
          id: caseId,
          customerId: customer.id,
          carId: carId || undefined,
          salesmanId: currentUser.id,
          bankerId,
          bankerName: bankerProfile?.name,
          bank,
          loanAmount: totalLoan,
          applicantInterviewText: applicantText || undefined,
          guarantorInterviewText: guarantorText || undefined,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        await addLoanCase(newCase);

        if (reuseDocs && prevApplicantDocs.length > 0) {
          for (const doc of prevDocs) {
            const newDoc: LoanCaseDocument = {
              id: crypto.randomUUID(),
              caseId,
              type: doc.type,
              fileName: doc.fileName,
              filePath: doc.filePath,
              uploadedAt: now,
            };
            await addLoanCaseDocument(newDoc);
          }
        } else {
          const uploadFile = async (file: File, type: 'applicant' | 'guarantor') => {
            const path = `${caseId}/${type}/${Date.now()}_${file.name}`;
            const { error } = await supabase.storage.from('loan-documents').upload(path, file);
            if (error) throw error;
            await addLoanCaseDocument({
              id: crypto.randomUUID(),
              caseId,
              type,
              fileName: file.name,
              filePath: path,
              uploadedAt: new Date().toISOString(),
            });
          };
          await Promise.all([
            ...applicantFiles.map(f => uploadFile(f, 'applicant')),
            ...guarantorFiles.map(f => uploadFile(f, 'guarantor')),
          ]);
        }

        await addLoanCaseActivity({
          id: crypto.randomUUID(),
          caseId,
          userId: currentUser.id,
          userName: currentUser.name,
          userRole: currentUser.role,
          type: 'status_change',
          content: 'Case submitted',
          newStatus: 'pending',
          createdAt: now,
        });
      }

      toast.success(`Loan order saved · submitted to ${selectedBanks.length} bank${selectedBanks.length > 1 ? 's' : ''}: ${selectedBanks.join(', ')}`);
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center sm:p-4 bg-black/70 backdrop-blur-sm"
      style={{ paddingTop: 'env(safe-area-inset-top, 44px)' }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-obsidian-800 sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(95vh - env(safe-area-inset-top, 44px))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-obsidian-500/60 rounded-full" />
        </div>

        {/* Header */}
        <div className="px-5 pt-4 pb-3 flex items-start justify-between shrink-0 border-b border-obsidian-400/20">
          <div>
            <p className="text-white font-bold text-base">Loan Order & Submission</p>
            <p className="text-gray-400 text-xs mt-0.5">{customer.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white mt-0.5"><X size={18} /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6 min-h-0">

          {/* ── Section 1: Loan Order ─────────────────────────── */}
          <div className="space-y-4">
            <p className="text-xs text-gold-400 font-semibold uppercase tracking-wide">Loan Order</p>

            {/* Car */}
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-medium">Car</label>
              <select
                value={carId}
                onChange={e => {
                  setCarId(e.target.value);
                }}
                className="w-full bg-obsidian-700 border border-obsidian-500/50 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold-500/50"
              >
                <option value="">Select car…</option>
                {availableCars.map(c => (
                  <option key={c.id} value={c.id}>{c.year} {c.make} {c.model}{c.carPlate ? ` — ${c.carPlate}` : ''}</option>
                ))}
              </select>
            </div>

            {/* Price breakdown */}
            <div className="rounded-xl border border-obsidian-400/30 overflow-hidden">
              <div className="bg-obsidian-700/40 px-4 py-2.5 text-xs text-gray-400 font-medium border-b border-obsidian-400/20">Deal Breakdown</div>
              <div className="px-4 py-3 space-y-3">
                {/* Selling price — locked to car price */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-36 shrink-0">Selling Price (RM)</span>
                  <div className="flex-1 bg-obsidian-800/60 border border-obsidian-500/20 rounded-lg px-3 py-1.5 text-right flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-500">locked</span>
                    <span className="text-white text-sm font-medium">{sellingPrice > 0 ? sellingPrice.toLocaleString() : '—'}</span>
                  </div>
                </div>

                {[
                  { label: 'Insurance (RM)', value: insurance, setter: setInsurance },
                  { label: 'Bank Product (RM)', value: bankProduct, setter: setBankProduct },
                  { label: 'Discount (RM)', value: discount, setter: setDiscount },
                ].map(f => (
                  <div key={f.label} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-36 shrink-0">{f.label}</span>
                    <input
                      type="number"
                      value={f.value || ''}
                      onChange={e => f.setter(parseFloat(e.target.value) || 0)}
                      className="flex-1 bg-obsidian-700 border border-obsidian-500/40 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-gold-500/50 text-right"
                    />
                  </div>
                ))}

                {/* Additional items */}
                {additionalItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={item.label}
                      onChange={e => updateAdditionalItem(i, 'label', e.target.value)}
                      placeholder="Item description"
                      className="flex-1 bg-obsidian-700 border border-obsidian-500/40 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-gold-500/50"
                    />
                    <input
                      type="number"
                      value={item.amount || ''}
                      onChange={e => updateAdditionalItem(i, 'amount', parseFloat(e.target.value) || 0)}
                      placeholder="RM"
                      className="w-24 bg-obsidian-700 border border-obsidian-500/40 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-gold-500/50 text-right"
                    />
                    <button onClick={() => removeAdditionalItem(i)} className="text-red-400 hover:text-red-300 shrink-0">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addAdditionalItem}
                  className="flex items-center gap-1.5 text-xs text-gold-400 hover:text-gold-300 transition-colors"
                >
                  <Plus size={12} /> Add item
                </button>
              </div>

              {/* Total */}
              <div className="flex items-center justify-between px-4 py-3 bg-gold-500/8 border-t border-gold-500/20">
                <span className="text-sm font-semibold text-gold-300">Total Loan Amount</span>
                <span className="text-lg font-bold text-gold-400">RM {totalLoan.toLocaleString()}</span>
              </div>
            </div>

            {/* Trade-in */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={hasTradeIn} onChange={e => setHasTradeIn(e.target.checked)} className="accent-gold-500" />
                <span className="text-xs text-gray-400 font-medium">Has Trade-In</span>
              </label>
              {hasTradeIn && (
                <div className="rounded-xl border border-obsidian-400/30 p-3 space-y-2.5">
                  {[
                    { label: 'Plate', value: tradeInPlate, setter: setTradeInPlate, type: 'text' },
                    { label: 'Make', value: tradeInMake, setter: setTradeInMake, type: 'text' },
                    { label: 'Model', value: tradeInModel, setter: setTradeInModel, type: 'text' },
                    { label: 'Variant', value: tradeInVariant, setter: setTradeInVariant, type: 'text' },
                  ].map(f => (
                    <div key={f.label} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-16 shrink-0">{f.label}</span>
                      <input
                        type={f.type}
                        value={f.value}
                        onChange={e => (f.setter as any)(e.target.value)}
                        className="flex-1 bg-obsidian-700 border border-obsidian-500/40 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-gold-500/50"
                      />
                    </div>
                  ))}
                  {[
                    { label: 'Trade-in Price (RM)', value: tradeInPrice, setter: setTradeInPrice },
                    { label: 'Settlement (RM)', value: settlementFigure, setter: setSettlementFigure },
                  ].map(f => (
                    <div key={f.label} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-32 shrink-0">{f.label}</span>
                      <input
                        type="number"
                        value={f.value || ''}
                        onChange={e => f.setter(parseFloat(e.target.value) || 0)}
                        className="flex-1 bg-obsidian-700 border border-obsidian-500/40 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-gold-500/50 text-right"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Section 2: Banks & Bankers ───────────────────── */}
          <div className="space-y-3">
            <p className="text-xs text-gold-400 font-semibold uppercase tracking-wide">Banks &amp; Bankers</p>
            <p className="text-[11px] text-gray-500">Select at least one bank. Choose the banker you're dealing with (or leave blank).</p>
            {BANKS.map(bank => {
              const bankersForBank = bankers.filter(b => b.bank === bank);
              const selectedBankerId = bankPicks[bank] ?? '';
              const isSelected = selectedBankerId !== '';
              return (
                <div
                  key={bank}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl border transition-all ${
                    isSelected
                      ? 'border-gold-500/50 bg-gold-500/5'
                      : 'border-obsidian-500/30 bg-obsidian-700/30'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 transition-all ${
                    isSelected ? 'bg-gold-500 text-obsidian-900' : 'bg-obsidian-600/60 text-gray-400'
                  }`}>
                    {bank[0]}
                  </div>
                  <span className={`font-semibold text-sm flex-1 transition-colors ${isSelected ? 'text-white' : 'text-gray-400'}`}>
                    {bank}
                  </span>
                  <select
                    value={selectedBankerId}
                    onChange={e => setBankPicks({ ...bankPicks, [bank]: e.target.value })}
                    className="bg-obsidian-700 border border-obsidian-500/40 rounded-xl px-2 py-1.5 text-white text-xs focus:outline-none focus:border-gold-500/50 min-w-[130px]"
                  >
                    <option value="">— none —</option>
                    {bankersForBank.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name}{b.userId ? ' ✓' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
            {bankers.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-2">No banker profiles yet. Add bankers in the Data page.</p>
            )}
          </div>

          {/* ── Section 3: Documents ─────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gold-400 font-semibold uppercase tracking-wide">Documents</p>
              {prevApplicantDocs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setReuseDocs(v => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                    reuseDocs
                      ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                      : 'bg-obsidian-700/50 border-obsidian-500/30 text-gray-400'
                  }`}
                >
                  <RefreshCw size={10} />
                  {reuseDocs ? 'Reusing previous docs' : 'Reuse previous docs'}
                </button>
              )}
            </div>

            {reuseDocs && prevApplicantDocs.length > 0 ? (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 space-y-1.5">
                <p className="text-[11px] text-blue-300 font-semibold">Documents from previous submission</p>
                {prevDocs.map(doc => (
                  <div key={doc.id} className="flex items-center gap-2 text-xs text-gray-300">
                    <FileText size={12} className="text-gold-400 shrink-0" />
                    <span className="truncate flex-1">{doc.fileName}</span>
                    <span className="text-[10px] text-gray-500 shrink-0">{doc.type}</span>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setReuseDocs(false)}
                  className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors mt-1"
                >
                  Upload different documents instead
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500">Applicant Documents (PDF) *</label>
                  <input ref={applicantRef} type="file" accept="application/pdf" multiple className="hidden" onChange={async e => {
                    const files = Array.from(e.target.files ?? []);
                    setCompressing(true);
                    const compressed = await Promise.all(files.map(compressPdf));
                    setApplicantFiles(compressed);
                    setCompressing(false);
                  }} />
                  <button
                    type="button"
                    onClick={() => applicantRef.current?.click()}
                    disabled={compressing}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-obsidian-400/50 text-gray-400 hover:border-gold-500/40 hover:text-gray-300 transition-colors text-sm disabled:opacity-50"
                  >
                    {compressing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {compressing ? 'Compressing…' : applicantFiles.length > 0 ? `${applicantFiles.length} file(s) selected` : 'Upload PDF(s)'}
                  </button>
                  {applicantFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-300 px-2">
                      <FileText size={12} className="text-gold-400 shrink-0" />
                      <span className="truncate flex-1">{f.name}</span>
                      <button type="button" onClick={() => setApplicantFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400"><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500">Guarantor Documents (optional)</label>
                  <input ref={guarantorRef} type="file" accept="application/pdf" multiple className="hidden" onChange={async e => {
                    const files = Array.from(e.target.files ?? []);
                    setCompressing(true);
                    const compressed = await Promise.all(files.map(compressPdf));
                    setGuarantorFiles(compressed);
                    setCompressing(false);
                  }} />
                  <button
                    type="button"
                    onClick={() => guarantorRef.current?.click()}
                    disabled={compressing}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-obsidian-400/50 text-gray-400 hover:border-gold-500/40 hover:text-gray-300 transition-colors text-sm disabled:opacity-50"
                  >
                    {compressing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {compressing ? 'Compressing…' : guarantorFiles.length > 0 ? `${guarantorFiles.length} file(s) selected` : 'Upload PDF(s)'}
                  </button>
                  {guarantorFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-300 px-2">
                      <FileText size={12} className="text-gold-400 shrink-0" />
                      <span className="truncate flex-1">{f.name}</span>
                      <button type="button" onClick={() => setGuarantorFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400"><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── Section 4: Interview text ─────────────────────── */}
          <div className="space-y-3">
            <p className="text-xs text-gold-400 font-semibold uppercase tracking-wide">Interview Forms</p>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-medium">Applicant Interview Form</label>
              <textarea
                value={applicantText}
                onChange={e => setApplicantText(e.target.value)}
                placeholder="Paste interview form here…"
                rows={4}
                className="w-full bg-obsidian-700 border border-obsidian-500/50 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gold-500/50 resize-none"
              />
            </div>
            {(!reuseDocs ? guarantorFiles.length > 0 : prevGuarantorDocs.length > 0) && (
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400 font-medium">Guarantor Interview Form</label>
                <textarea
                  value={guarantorText}
                  onChange={e => setGuarantorText(e.target.value)}
                  placeholder="Paste guarantor interview form here…"
                  rows={3}
                  className="w-full bg-obsidian-700 border border-obsidian-500/50 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gold-500/50 resize-none"
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pt-3 shrink-0 border-t border-obsidian-400/20" style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}>
          {totalLoan > 0 && (
            <p className="text-center text-xs text-gray-500 mb-2">
              Total loan: <span className="text-gold-400 font-semibold">RM {totalLoan.toLocaleString()}</span>
              {selectedBanks.length > 0 && <> · {selectedBanks.length} bank{selectedBanks.length > 1 ? 's' : ''}</>}
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting || compressing || selectedBanks.length === 0 || !hasApplicantDocs || totalLoan <= 0}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gold-gradient text-obsidian-950 font-bold text-sm disabled:opacity-40 active:opacity-80 transition-opacity shadow-gold-sm"
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {submitting
              ? 'Submitting…'
              : selectedBanks.length === 0
                ? 'Select at least one bank'
                : `Submit to ${selectedBanks.length} bank${selectedBanks.length > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
