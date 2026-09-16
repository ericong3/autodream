import { useState, useMemo, useRef } from 'react';
import { Upload, FileText, CheckCircle2, XCircle, Landmark, Loader2 } from 'lucide-react';
import { useStore } from '../store';
import { formatRM, generateId } from '../utils/format';
import { toast } from '../utils/toast';
import { supabase } from '../lib/supabase';
import { extractTransactionsFromStatement, matchBankTransactions, candidatePayments } from '../utils/bankReconciliation';
import { BankTransaction } from '../types';

async function uploadStatementFile(file: File, uploadId: string): Promise<string> {
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const path = `${uploadId}${ext}`;
  const { error } = await supabase.storage.from('bank-statements').upload(path, file);
  if (error) throw new Error(error.message);
  return path;
}

export default function Reconciliation() {
  const currentUser = useStore((s) => s.currentUser);
  const payments = useStore((s) => s.payments);
  const updatePayment = useStore((s) => s.updatePayment);
  const uploads = useStore((s) => s.bankStatementUploads);
  const txns = useStore((s) => s.bankTransactions);
  const addBankStatementUpload = useStore((s) => s.addBankStatementUpload);
  const updateBankStatementUpload = useStore((s) => s.updateBankStatementUpload);
  const addBankTransactions = useStore((s) => s.addBankTransactions);
  const updateBankTransaction = useStore((s) => s.updateBankTransaction);

  const fileRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [selectedUploadId, setSelectedUploadId] = useState<'all' | string>('all');
  // Local override per row — starts at the suggestion, editable before confirming.
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const unresolved = useMemo(
    () => txns
      .filter((t) => t.status === 'unmatched')
      .filter((t) => selectedUploadId === 'all' || t.uploadId === selectedUploadId)
      .sort((a, b) => b.txnDate.localeCompare(a.txnDate)),
    [txns, selectedUploadId]
  );

  // Payments already claimed by a confirmed match, so the override dropdown
  // never offers one that's already reconciled elsewhere.
  const matchedPaymentIds = useMemo(
    () => new Set(txns.filter((t) => t.status === 'matched' && t.matchedPaymentId).map((t) => t.matchedPaymentId!)),
    [txns]
  );

  const uploadCounts = useMemo(() => {
    const m = new Map<string, { total: number; resolved: number }>();
    for (const t of txns) {
      const c = m.get(t.uploadId) ?? { total: 0, resolved: 0 };
      c.total++;
      if (t.status !== 'unmatched') c.resolved++;
      m.set(t.uploadId, c);
    }
    return m;
  }, [txns]);

  const handleUpload = async (file: File) => {
    if (!currentUser) return;
    const apiKey = localStorage.getItem('autodream_api_key') ?? '';
    if (!apiKey) {
      toast.error('Claude API key required — set it on the AI Assistant page first.');
      return;
    }
    setProcessing(true);
    const uploadId = generateId();
    try {
      const filePath = await uploadStatementFile(file, uploadId);
      await addBankStatementUpload({
        id: uploadId, filePath, fileName: file.name,
        uploadedBy: currentUser.id, uploadedAt: new Date().toISOString(), status: 'processing',
      });

      const extracted = await extractTransactionsFromStatement(file, apiKey);
      if (extracted.length === 0) {
        await updateBankStatementUpload(uploadId, { status: 'failed' });
        toast.error('No transactions could be read from that statement — try a clearer scan/photo.');
        return;
      }

      const newTxns: BankTransaction[] = extracted.map((t) => ({
        id: generateId(), uploadId, txnDate: t.date, description: t.description,
        amount: t.amount, direction: t.direction, status: 'unmatched', createdAt: new Date().toISOString(),
      }));
      const suggestions = matchBankTransactions(newTxns, payments);
      const withSuggestions = newTxns.map((t) => ({ ...t, suggestedPaymentId: suggestions.get(t.id) }));

      await addBankTransactions(withSuggestions);
      await updateBankStatementUpload(uploadId, { status: 'ready' });
      setSelectedUploadId(uploadId);
      toast.success(`Extracted ${withSuggestions.length} transaction${withSuggestions.length === 1 ? '' : 's'} — ${suggestions.size} auto-matched.`);
    } catch (err: any) {
      await updateBankStatementUpload(uploadId, { status: 'failed' });
      toast.error(err?.message ?? 'Failed to process statement');
    } finally {
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirmMatch = async (txn: BankTransaction, paymentId: string) => {
    if (!currentUser) return;
    await updateBankTransaction(txn.id, {
      status: 'matched', matchedPaymentId: paymentId,
      resolvedBy: currentUser.id, resolvedAt: new Date().toISOString(),
    });
    await updatePayment(paymentId, {
      status: 'transferred', transferredAt: txn.txnDate, transferredBy: currentUser.id,
    });
  };

  const markUnrelated = async (txn: BankTransaction) => {
    if (!currentUser) return;
    await updateBankTransaction(txn.id, {
      status: 'ignored', resolvedBy: currentUser.id, resolvedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-white font-semibold text-base flex items-center gap-2">
            <Landmark size={16} className="text-gold-400" /> Bank Reconciliation
          </h2>
          <p className="text-gray-500 text-xs mt-0.5">
            Upload a bank statement (PDF or a photo of one) — matches get suggested against pending payments, you confirm.
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={processing}
            className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {processing ? 'Reading statement…' : 'Upload Statement'}
          </button>
        </div>
      </div>

      {uploads.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedUploadId('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              selectedUploadId === 'all' ? 'bg-gold-500/15 border-gold-500/50 text-gold-400' : 'bg-[#0F0E0C] border-obsidian-400/50 text-gray-500 hover:text-gray-300'
            }`}
          >
            All Statements
          </button>
          {uploads.map((u) => {
            const c = uploadCounts.get(u.id) ?? { total: 0, resolved: 0 };
            return (
              <button
                key={u.id}
                onClick={() => setSelectedUploadId(u.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  selectedUploadId === u.id ? 'bg-gold-500/15 border-gold-500/50 text-gold-400' : 'bg-[#0F0E0C] border-obsidian-400/50 text-gray-500 hover:text-gray-300'
                }`}
                title={u.fileName}
              >
                <FileText size={11} />
                <span className="max-w-[160px] truncate">{u.fileName}</span>
                {u.status === 'failed'
                  ? <span className="text-red-400">failed</span>
                  : <span className="text-gray-600">{c.resolved}/{c.total}</span>}
              </button>
            );
          })}
        </div>
      )}

      {unresolved.length === 0 ? (
        <div className="text-center py-16 text-gray-600 text-sm">
          {uploads.length === 0 ? 'No statements uploaded yet.' : 'Nothing left to review here.'}
        </div>
      ) : (
        <div className="space-y-2">
          {unresolved.map((txn) => {
            const candidates = candidatePayments(txn.direction, payments, matchedPaymentIds);
            const selected = overrides[txn.id] ?? txn.suggestedPaymentId ?? '';
            const selectedPayment = candidates.find((p) => p.id === selected);
            return (
              <div key={txn.id} className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4 flex items-center gap-4 flex-wrap">
                <div className="min-w-[140px]">
                  <p className="text-gray-500 text-[10px]">{txn.txnDate}</p>
                  <p className="text-white text-sm font-medium truncate max-w-[220px]" title={txn.description}>{txn.description}</p>
                </div>
                <div className={`text-sm font-bold ${txn.direction === 'debit' ? 'text-red-400' : 'text-green-400'}`}>
                  {txn.direction === 'debit' ? '−' : '+'} {formatRM(txn.amount)}
                </div>
                <div className="flex-1 min-w-[220px]">
                  <select
                    value={selected}
                    onChange={(e) => setOverrides((o) => ({ ...o, [txn.id]: e.target.value }))}
                    className="w-full input text-xs py-2 px-3 rounded-lg"
                  >
                    <option value="">No match — pick one, or mark unrelated</option>
                    {candidates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.recipientName} · {formatRM(p.amount)} · {p.type.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  {txn.suggestedPaymentId && txn.suggestedPaymentId === selected && (
                    <p className="text-gold-400 text-[10px] mt-1">Suggested match</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => markUnrelated(txn)}
                    className="p-2 rounded-lg border border-obsidian-400/50 text-gray-500 hover:text-red-400 hover:border-red-500/40 transition-colors"
                    title="Not related to any payment in the app"
                  >
                    <XCircle size={16} />
                  </button>
                  <button
                    onClick={() => selectedPayment && confirmMatch(txn, selectedPayment.id)}
                    disabled={!selectedPayment}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/15 hover:bg-green-500/25 border border-green-500/40 text-green-400 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 size={14} /> Confirm
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
