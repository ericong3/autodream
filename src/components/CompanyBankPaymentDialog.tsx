import { useState } from 'react';
import { useStore } from '../store';
import type { Payment } from '../types';
import { companyBankRequest, paymentBalanceCents, type CompanyBankSave } from '../lib/companyBankPayments';
import { uploadCompanyEvidence } from '../lib/companyEvidence';
import { useInvestorQuery, parseRinggit, formatCents, InvestorFinanceError, type Bank } from '../lib/investorFinance';
import { BankPaymentFields, bankPaymentReady, emptyBankPayment, CashConfirm, type PendingConfirm } from './InvestorFinanceCar';
import Modal from './Modal';

type Intent = { requestId: string; bankAccountId: string; bankReference: string; paidOn: string; notes: string; allocations: { paymentId: string; amountCents: number; documentId: string }[] };
export default function CompanyBankPaymentDialog({ payments, actorId, onClose }: { payments: Payment[]; actorId: string; onClose: () => void }) {
  const key = `autodream-company-bank-payment:${actorId}`;
  const read = (): Intent | null => { try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); return v?.requestId && Array.isArray(v.allocations) ? v : null; } catch { return null; } };
  const [pending, setPending] = useState<Intent | null>(read), [payment, setPayment] = useState(emptyBankPayment), [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null), [amount, setAmount] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const banks = useInvestorQuery<{ banks: Bank[] }>(`company-banks:${actorId}`, () => companyBankRequest('banks'));
  const total = payments.reduce((sum, p) => sum + paymentBalanceCents(p), 0);
  const cents = amount ? parseRinggit(amount) : total;
  const mixedPayroll = payments.some((p) => ['salary', 'allowance', 'campaign_bonus'].includes(p.type)) && payments.some((p) => !['salary', 'allowance', 'campaign_bonus'].includes(p.type));
  const ready = !busy && !mixedPayroll && !!file && !!cents && cents <= total && bankPaymentReady(payment) && !!banks.data?.banks.some((b) => b.id === payment.bankAccountId);
  const save = async () => {
    setBusy(true); setError('');
    try {
      if (useStore.getState().currentUser?.id !== actorId) throw new Error('Your account changed. Reopen this payment.');
      let intent = read();
      if (!intent) {
        if (!ready || !file || !cents) throw new Error('Check the bank and receipt first.');
        const allocations: Intent['allocations'] = [];
        for (const p of payments) {
          const d = await uploadCompanyEvidence(p.id, 'payment', file);
          if (useStore.getState().currentUser?.id !== actorId) throw new Error('Your account changed. Reopen this payment.');
          allocations.push({ paymentId: p.id, amountCents: payments.length === 1 ? cents : paymentBalanceCents(p), documentId: d.document.documentId });
        }
        intent = { requestId: 'company_bank_' + crypto.randomUUID(), ...payment, notes, allocations };
        sessionStorage.setItem(key, JSON.stringify(intent)); setPending(intent);
      }
      if (useStore.getState().currentUser?.id !== actorId) throw new Error('Your account changed. Reopen this payment.');
      const saved = await companyBankRequest<CompanyBankSave>('record', intent);
      useStore.getState().applyCompanyBankPayment(actorId, saved);
      sessionStorage.removeItem(key); setPending(null); if (useStore.getState().currentUser?.id === actorId) onClose();
    } catch (e) {
      if (e instanceof InvestorFinanceError && !e.retryable && e.code !== 'REQUEST_CHANGED') { sessionStorage.removeItem(key); setPending(null); }
      setError(e instanceof Error ? e.message : 'Could not record payment.');
    } finally { setBusy(false); }
  };
  return <Modal isOpen title="Record bank payment" onClose={onClose}>
    <div className="space-y-4">
      <p className="text-sm text-white">{formatCents(total)} unpaid · {payments.length} {payments.length === 1 ? 'bill' : 'bills'}</p>
      {(error || banks.error) && <p role="alert" className="text-xs text-red-400">{error || banks.error?.message}</p>}
      {mixedPayroll && <p role="alert" className="text-xs text-amber-300">Record salary and bonuses separately from ordinary bills to keep payroll private.</p>}
      {pending ? <div className="space-y-3"><p className="text-xs text-amber-300">An earlier payment save is waiting. Retry it before recording another payment.</p><p className="text-xs text-gray-400">{formatCents(pending.allocations.reduce((s, a) => s + a.amountCents, 0))} · {pending.paidOn} · {pending.bankReference}</p><button type="button" className="btn-gold px-4 py-2 rounded-lg text-xs" disabled={busy} onClick={() => void save()}>{busy ? 'Checking…' : 'Retry original payment'}</button></div> : <>
        <BankPaymentFields banks={banks.data?.banks ?? []} value={payment} onChange={setPayment} />
        {payments.length === 1 && !['salary', 'allowance', 'campaign_bonus'].includes(payments[0].type) && <label className="block text-xs text-gray-400">Amount paid (RM)<input className="input block w-full rounded-lg px-3 py-2 mt-1 text-sm" inputMode="decimal" placeholder={(total / 100).toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>}
        <label className="block text-xs text-gray-400">Bank receipt (required)<input type="file" accept="image/png,image/jpeg,application/pdf" className="block mt-2 text-xs" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <label className="block text-xs text-gray-400">Note (optional)<input className="input block w-full rounded-lg px-3 py-2 mt-1 text-sm" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <p className="text-xs text-gray-500">This records money already paid. Any unpaid balance stays open.</p>
        <button type="button" className="btn-gold px-4 py-2 rounded-lg text-sm disabled:opacity-40" disabled={!ready} onClick={() => setConfirm({ title: 'Record this bank payment?', label: 'Record payment', message: `${formatCents(cents)} paid from the selected company bank. The receipt and accounting entry will be saved together.`, go: () => void save() })}>{busy ? 'Saving…' : 'Record payment'}</button>
      </>}
    </div>
    <CashConfirm confirm={confirm} onClose={() => setConfirm(null)} />
  </Modal>;
}
