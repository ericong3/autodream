import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Trash2, FileText, Loader2, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';
import { Customer, LoanCase, LoanCaseDocument, LoanCaseActivity, BANKS } from '../types';
import { toast } from '../utils/toast';
import { notifyUsers } from '../utils/notify';

interface Props {
  customer: Customer;
  initialCarId?: string;
  initialAmount?: number;
  onClose: () => void;
}

export default function LoanSubmitModal({ customer, initialCarId, initialAmount, onClose }: Props) {
  const currentUser = useStore(s => s.currentUser)!;
  const users = useStore(s => s.users);
  const cars = useStore(s => s.cars);
  const loanCases = useStore(s => s.loanCases);
  const loanCaseDocuments = useStore(s => s.loanCaseDocuments);
  const addLoanCase = useStore(s => s.addLoanCase);
  const addLoanCaseDocument = useStore(s => s.addLoanCaseDocument);
  const addLoanCaseActivity = useStore(s => s.addLoanCaseActivity);
  const updateCustomer = useStore(s => s.updateCustomer);

  // Find most recent previous case for this customer (by this salesman) that has docs
  const prevCase = [...loanCases]
    .filter(c => c.customerId === customer.id && c.salesmanId === currentUser.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .find(c => loanCaseDocuments.some(d => d.caseId === c.id));

  const prevDocs = prevCase ? loanCaseDocuments.filter(d => d.caseId === prevCase.id) : [];
  const prevApplicantDocs = prevDocs.filter(d => d.type === 'applicant');
  const prevGuarantorDocs = prevDocs.filter(d => d.type === 'guarantor');

  const [bankPicks, setBankPicks] = useState<Record<string, string>>({});
  const [carId, setCarId] = useState(initialCarId ?? '');
  const [loanAmount, setLoanAmount] = useState(initialAmount ? String(initialAmount) : '');
  const [applicantText, setApplicantText] = useState(prevCase?.applicantInterviewText ?? '');
  const [guarantorText, setGuarantorText] = useState(prevCase?.guarantorInterviewText ?? '');
  const [applicantFiles, setApplicantFiles] = useState<File[]>([]);
  const [guarantorFiles, setGuarantorFiles] = useState<File[]>([]);
  const [reuseDocs, setReuseDocs] = useState(prevApplicantDocs.length > 0);
  const [submitting, setSubmitting] = useState(false);
  const applicantRef = useRef<HTMLInputElement>(null);
  const guarantorRef = useRef<HTMLInputElement>(null);

  const availableCars = cars.filter(c =>
    ['available', 'ready', 'photo_complete', 'coming_soon'].includes(c.status) || c.id === initialCarId
  );

  const selectedBanks = Object.keys(bankPicks).filter(b => bankPicks[b] !== '');
  const hasApplicantDocs = reuseDocs ? prevApplicantDocs.length > 0 : applicantFiles.length > 0;

  async function handleSubmit() {
    if (selectedBanks.length === 0) { toast.error('Select at least one bank'); return; }
    if (!loanAmount) { toast.error('Please enter loan amount'); return; }
    if (!hasApplicantDocs) { toast.error('Please upload at least one applicant document'); return; }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();

      for (const bank of selectedBanks) {
        const caseId = crypto.randomUUID();
        const newCase: LoanCase = {
          id: caseId,
          customerId: customer.id,
          carId: carId || undefined,
          salesmanId: currentUser.id,
          bankerId: bankPicks[bank],
          bank,
          loanAmount: parseFloat(loanAmount),
          applicantInterviewText: applicantText || undefined,
          guarantorInterviewText: guarantorText || undefined,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        await addLoanCase(newCase);
        notifyUsers(
          [bankPicks[bank]],
          'New Case Submitted',
          `${customer.name} — ${bank} · RM ${parseFloat(loanAmount).toLocaleString()}`,
          '/banker-dashboard',
        );

        if (reuseDocs && prevApplicantDocs.length > 0) {
          // Copy document references from the previous case — no re-upload needed
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
            const doc: LoanCaseDocument = {
              id: crypto.randomUUID(),
              caseId,
              type,
              fileName: file.name,
              filePath: path,
              uploadedAt: new Date().toISOString(),
            };
            await addLoanCaseDocument(doc);
          };
          await Promise.all([
            ...applicantFiles.map(f => uploadFile(f, 'applicant')),
            ...guarantorFiles.map(f => uploadFile(f, 'guarantor')),
          ]);
        }

        const activity: LoanCaseActivity = {
          id: crypto.randomUUID(),
          caseId,
          userId: currentUser.id,
          userName: currentUser.name,
          userRole: currentUser.role,
          type: 'status_change',
          content: 'Case submitted',
          newStatus: 'pending',
          createdAt: now,
        };
        await addLoanCaseActivity(activity);
      }

      if (customer.leadStatus !== 'loan_submitted') {
        updateCustomer(customer.id, {
          leadStatus: 'loan_submitted',
          loanStatus: 'submitted',
          ...(carId && !customer.interestedCarId ? { interestedCarId: carId } : {}),
          lastActionAt: now,
        });
      }

      const bankList = selectedBanks.join(', ');
      toast.success(`Submitted to ${selectedBanks.length} bank${selectedBanks.length > 1 ? 's' : ''}: ${bankList}`);
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
        className="w-full sm:max-w-md bg-obsidian-800 sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
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
            <p className="text-white font-bold text-base">Submit to Banker</p>
            <p className="text-gray-400 text-xs mt-0.5">{customer.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white mt-0.5"><X size={18} /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">

          {/* Bank + Banker selection */}
          <div className="space-y-2">
            <p className="text-xs text-gray-400 font-medium">Bank(s) &amp; Banker</p>
            {BANKS.map(bank => {
              const bankersForBank = users.filter(u => u.role === 'banker' && u.banks?.includes(bank));
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
                    disabled={bankersForBank.length === 0}
                    className="bg-obsidian-700 border border-obsidian-500/40 rounded-xl px-2 py-1.5 text-white text-xs focus:outline-none focus:border-gold-500/50 disabled:opacity-30 min-w-[110px]"
                  >
                    <option value="">— none —</option>
                    {bankersForBank.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          {/* Car */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400 font-medium">Car (optional)</label>
            <select
              value={carId}
              onChange={e => setCarId(e.target.value)}
              className="w-full bg-obsidian-700 border border-obsidian-500/50 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-gold-500/50"
            >
              <option value="">Select car…</option>
              {availableCars.map(c => (
                <option key={c.id} value={c.id}>{c.year} {c.make} {c.model}{c.carPlate ? ` — ${c.carPlate}` : ''}</option>
              ))}
            </select>
          </div>

          {/* Loan Amount */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400 font-medium">Loan Amount (RM)</label>
            <input
              type="number"
              value={loanAmount}
              onChange={e => setLoanAmount(e.target.value)}
              placeholder="e.g. 80000"
              className="w-full bg-obsidian-700 border border-obsidian-500/50 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gold-500/50"
            />
          </div>

          {/* Documents */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400 font-medium">Documents</p>
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
                {/* Applicant Documents */}
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500">Applicant Documents (PDF) *</label>
                  <input ref={applicantRef} type="file" accept="application/pdf" multiple className="hidden" onChange={e => setApplicantFiles(Array.from(e.target.files ?? []))} />
                  <button
                    type="button"
                    onClick={() => applicantRef.current?.click()}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-obsidian-400/50 text-gray-400 hover:border-gold-500/40 hover:text-gray-300 transition-colors text-sm"
                  >
                    <Upload size={14} />
                    {applicantFiles.length > 0 ? `${applicantFiles.length} file(s) selected` : 'Upload PDF(s)'}
                  </button>
                  {applicantFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-300 px-2">
                      <FileText size={12} className="text-gold-400 shrink-0" />
                      <span className="truncate flex-1">{f.name}</span>
                      <button type="button" onClick={() => setApplicantFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Guarantor Documents */}
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500">Guarantor Documents (optional)</label>
                  <input ref={guarantorRef} type="file" accept="application/pdf" multiple className="hidden" onChange={e => setGuarantorFiles(Array.from(e.target.files ?? []))} />
                  <button
                    type="button"
                    onClick={() => guarantorRef.current?.click()}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-obsidian-400/50 text-gray-400 hover:border-gold-500/40 hover:text-gray-300 transition-colors text-sm"
                  >
                    <Upload size={14} />
                    {guarantorFiles.length > 0 ? `${guarantorFiles.length} file(s) selected` : 'Upload PDF(s)'}
                  </button>
                  {guarantorFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-300 px-2">
                      <FileText size={12} className="text-gold-400 shrink-0" />
                      <span className="truncate flex-1">{f.name}</span>
                      <button type="button" onClick={() => setGuarantorFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Applicant Interview */}
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

          {/* Guarantor Interview */}
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

        {/* Footer */}
        <div className="px-5 pt-3 shrink-0 border-t border-obsidian-400/20" style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}>
          <button
            onClick={handleSubmit}
            disabled={submitting || selectedBanks.length === 0 || !loanAmount || !hasApplicantDocs}
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
