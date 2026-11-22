import { useState } from 'react';
import { useStore } from '../store';
import type { Payment } from '../types';
import { companyBankRequest, paymentBalanceCents, type CompanyBankSave } from '../lib/companyBankPayments';
import { uploadCompanyEvidence } from '../lib/companyEvidence';
import { useInvestorQuery, parseRinggit, formatCents, InvestorFinanceError, type Bank } from '../lib/investorFinance';
import { BankPaymentFields, bankPaymentReady, emptyBankPayment, CashConfirm, type PendingConfirm } from './InvestorFinanceCar';
import Modal from './Modal';
import CompanyPanelApproval from './CompanyPanelApproval';

type Intent = { requestId: string; bankAccountId: string; bankReference: string; paidOn: string; notes: string; allocations: { paymentId: string; amountCents: number; documentId: string }[]; beforeOpening?: boolean };
export default function CompanyBankPaymentDialog({ payments, actorId, onClose }: { payments: Payment[]; actorId: string; onClose: () => void }) {
  const key = `autodream-company-bank-payment:${actorId}`;
  const read = (): Intent | null => { try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); return v?.requestId && Array.isArray(v.allocations) ? v : null; } catch { return null; } };
  const [pending, setPending] = useState<Intent | null>(read), [payment, setPayment] = useState(emptyBankPayment), [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null), [amount, setAmount] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const banks = useInvestorQuery<{ banks: Bank[] }>(`company-banks:${actorId}`, () => companyBankRequest('banks'));
  const [approvedPanels,setApprovedPanels]=useState<Record<string,boolean>>({});
  const panelReady=payments.filter(p=>p.type==='panel_charge').every(p=>approvedPanels[p.id]);
  const total = payments.reduce((sum, p) => sum + paymentBalanceCents(p), 0);
  const cents = amount ? parseRinggit(amount) : total;
  const mixedPayroll = payments.some((p) => ['salary', 'allowance', 'campaign_bonus'].includes(p.type)) && payments.some((p) => !['salary', 'allowance', 'campaign_bonus'].includes(p.type));
  const bank = banks.data?.banks.find((b) => b.id === payment.bankAccountId);
  const beforeOpening = !!bank && /^\d{4}-\d{2}-\d{2}$/.test(payment.paidOn) && payment.paidOn < bank.openingDate;
  const openingLabel = bank ? new Date(bank.openingDate + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const ready = (!beforeOpening || payments.length === 1) && panelReady && !busy && !mixedPayroll && !!file && !!cents && cents <= total && bankPaymentReady(payment) && !!banks.data?.banks.some((b) => b.id === payment.bankAccountId);
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
          allocations.push({ paymentId: p.id, amountCents: payments.length === 1 && !beforeOpening ? cents : paymentBalanceCents(p), documentId: d.document.documentId });
        }
        intent = { requestId: 'company_bank_' + crypto.randomUUID(), ...payment, notes, allocations, ...(beforeOpening ? { beforeOpening: true } : {}) };
        sessionStorage.setItem(key, JSON.stringify(intent)); setPending(intent);
      }
      if (useStore.getState().currentUser?.id !== actorId) throw new Error('Your account changed. Reopen this payment.');
      const { beforeOpening: early, ...body } = intent;
      const saved = early
        ? await companyBankRequest<CompanyBankSave>('record_before_opening', { paymentId: body.allocations[0].paymentId, documentId: body.allocations[0].documentId, bankAccountId: body.bankAccountId, paidOn: body.paidOn, bankReference: body.bankReference, notes: body.notes, requestId: body.requestId })
        : await companyBankRequest<CompanyBankSave>('record', body);
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
      {payments.filter(p=>p.type==='panel_charge').map(p=><CompanyPanelApproval key={actorId+':'+p.id} paymentId={p.id} actorId={actorId} onApproved={()=>setApprovedPanels(old=>old[p.id]?old:{...old,[p.id]:true})}/>)}
      {(error || banks.error) && <p role="alert" className="text-xs text-red-400">{error || banks.error?.message}</p>}
      {mixedPayroll && <p role="alert" className="text-xs text-amber-300">Record salary and bonuses separately from ordinary bills to keep payroll private.</p>}
      {pending ? <div className="space-y-3"><p className="text-xs text-amber-300">An earlier payment save is waiting. Retry it before recording another payment.</p><p className="text-xs text-gray-400">{formatCents(pending.allocations.reduce((s, a) => s + a.amountCents, 0))} · {pending.paidOn} · {pending.bankReference}</p><button type="button" className="btn-gold px-4 py-2 rounded-lg text-xs" disabled={busy} onClick={() => void save()}>{busy ? 'Checking…' : 'Retry original payment'}</button></div> : <>
        <BankPaymentFields banks={banks.data?.banks ?? []} value={payment} onChange={setPayment} />
        {bank && /^\d{4}-\d{2}-\d{2}$/.test(payment.paidOn) && !beforeOpening && <p className="text-xs text-emerald-300">On your {bank.name} statement · paid out of {bank.name} on {new Date(payment.paidOn + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</p>}
        {beforeOpening && <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200 space-y-1"><p className="font-semibold">Before {openingLabel} · not on your {bank?.name} statement</p><p>It is already in the starting balance, so nothing is taken from {bank?.name} again. The full bill is marked as paid with this slip and date.</p>{payments.length !== 1 && <p className="text-red-300">Record bills paid before {openingLabel} one at a time.</p>}</div>}
        {payments.length === 1 && !beforeOpening && !['salary', 'allowance', 'campaign_bonus'].includes(payments[0].type) && <label className="block text-xs text-gray-400">Amount paid (RM)<input className="input block w-full rounded-lg px-3 py-2 mt-1 text-sm" inputMode="decimal" placeholder={(total / 100).toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>}
        <label className="block text-xs text-gray-400">Bank receipt (required)<input type="file" accept="image/png,image/jpeg,application/pdf" className="block mt-2 text-xs" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <label className="block text-xs text-gray-400">Note (optional)<input className="input block w-full rounded-lg px-3 py-2 mt-1 text-sm" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <p className="text-xs text-gray-500">This records money already paid. Any unpaid balance stays open.</p>
        <button type="button" className="btn-gold px-4 py-2 rounded-lg text-sm disabled:opacity-40" disabled={!ready} onClick={() => setConfirm(beforeOpening ? { title: `Mark as paid before ${openingLabel}?`, label: 'Mark as paid', message: `${formatCents(total)} paid on ${payment.paidOn}, before the bank's starting balance. No bank money moves. This cannot be undone.`, go: () => void save() } : { title: 'Record this bank payment?', label: 'Record payment', message: `${formatCents(cents)} paid from the selected company bank. The receipt and accounting entry will be saved together.`, go: () => void save() })}>{busy ? 'Saving…' : beforeOpening ? 'Mark as paid before ' + openingLabel : 'Record payment'}</button>
      </>}
    </div>
    <CashConfirm confirm={confirm} onClose={() => setConfirm(null)} />
  </Modal>;
}
