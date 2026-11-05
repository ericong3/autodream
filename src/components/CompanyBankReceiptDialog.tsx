import { useState } from 'react';
import { useStore } from '../store';
import type { Payment } from '../types';
import { companyBankRequest, paymentBalanceCents } from '../lib/companyBankPayments';
import { companyReceiptRequest } from '../lib/companyBankReceipts';
import { uploadCompanyEvidence } from '../lib/companyEvidence';
import { useInvestorQuery, parseRinggit, formatCents, InvestorFinanceError, type Bank } from '../lib/investorFinance';
import { BankPaymentFields, bankPaymentReady, emptyBankPayment, CashConfirm, type PendingConfirm } from './InvestorFinanceCar';
import Modal from './Modal';
import CompanyPaymentDocuments from './CompanyPaymentDocuments';

type Intent = { requestId: string; paymentId: string; amountCents: number; excessCents: number; customerId?: string; bankAccountId: string; bankReference: string; paidOn: string; receiptDocumentId: string; withheldBills: { paymentId: string; amountCents: number; documentId: string }[] };
export default function CompanyBankReceiptDialog({ payment: bill, actorId, onClose }: { payment: Payment; actorId: string; onClose: () => void }) {
  const key = `autodream-company-bank-receipt:${actorId}`;
  const read = (): Intent | null => { try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); return v?.requestId && v.paymentId ? v : null; } catch { return null; } };
  const [pending, setPending] = useState<Intent | null>(read), [payment, setPayment] = useState(emptyBankPayment), [amount, setAmount] = useState(''), [excess, setExcess] = useState('0'), [customerId, setCustomerId] = useState('');
  const [deductions, setDeductions] = useState<Record<string, string>>({}), [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [documents, setDocuments] = useState(false), [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const allPayments = useStore((s) => s.payments), customers = useStore((s) => s.customers);
  const recovery=bill.type==='consignment_collection';
  const banks = useInvestorQuery<{ banks: Bank[] }>(`company-banks:${actorId}`, () => companyBankRequest('banks'));
  const remaining = paymentBalanceCents(bill), actual = parseRinggit(amount), extra = parseRinggit(excess);
  const options = allPayments.filter((p) => p.id !== bill.id && p.carId === bill.carId && p.status === 'pending' && ['repair', 'misc_cost'].includes(p.type));
  const selected = Object.entries(deductions).map(([paymentId, value]) => ({ paymentId, amountCents: parseRinggit(value) }));
  const fee = selected.reduce((s, p) => s + (p.amountCents ?? 0), 0), covered = actual === null || extra === null ? null : actual + fee - extra;
  const ready = !!file && bankPaymentReady(payment) && covered !== null && covered > 0 && covered <= remaining && extra !== null && (extra === 0 || !!customerId) && selected.every((p) => p.amountCents !== null && p.amountCents > 0 && p.amountCents <= paymentBalanceCents(options.find((x) => x.id === p.paymentId) ?? { ...bill, amount: 0 }));
  const assertActor = () => { if (useStore.getState().currentUser?.id !== actorId) throw new Error('Your account changed. Reopen this receipt.'); };
  const save = async () => {
    setBusy(true); setError('');
    try {
      assertActor(); let intent = read();
      if (!intent) {
        if (!ready || !file || actual === null || extra === null) throw new Error('Check the actual amount, bank and receipt.');
        const mainDoc = await uploadCompanyEvidence(bill.id, 'payment', file); assertActor(); const withheldBills: Intent['withheldBills'] = [];
        for (const p of selected) { const d = await uploadCompanyEvidence(p.paymentId, 'payment', file); assertActor(); withheldBills.push({ paymentId: p.paymentId, amountCents: p.amountCents!, documentId: d.document.documentId }); }
        intent = { requestId: 'company_receipt_' + crypto.randomUUID(), paymentId: bill.id, amountCents: actual, excessCents: extra, ...(extra > 0 ? { customerId } : {}), ...payment, receiptDocumentId: mainDoc.document.documentId, withheldBills };
        sessionStorage.setItem(key, JSON.stringify(intent)); setPending(intent);
      }
      assertActor(); const saved = await companyReceiptRequest(intent); useStore.getState().applyCompanyBankPayment(actorId, saved); sessionStorage.removeItem(key); setPending(null); if (useStore.getState().currentUser?.id === actorId) onClose();
    } catch (e) { if (e instanceof InvestorFinanceError && !e.retryable && e.code !== 'REQUEST_CHANGED') { sessionStorage.removeItem(key); setPending(null); } setError(e instanceof Error ? e.message : 'Could not record receipt.'); }
    finally { setBusy(false); }
  };
  return <Modal isOpen title="Record money received" onClose={onClose}>
    <div className="space-y-3">
      <p className="text-sm text-white">{bill.recipientName} · {formatCents(remaining)} still to cover</p>
      {(error || banks.error) && <p role="alert" className="text-xs text-red-400">{error || banks.error?.message}</p>}
      <button type="button" className="text-xs text-gold-400" onClick={() => setDocuments(true)}>Invoices & receipts</button>
      {pending ? <><p className="text-xs text-amber-300">An earlier receipt save is waiting. Retry it before adding another receipt.</p><p className="text-xs text-gray-400">{formatCents(pending.amountCents)} · {pending.paidOn} · {pending.bankReference}</p><button type="button" className="btn-gold px-4 py-2 rounded-lg text-xs" disabled={busy} onClick={() => void save()}>{busy ? 'Checking…' : 'Retry original receipt'}</button></> : remaining > 0 && <>
        <label className="block text-xs text-gray-400">Actual money received (RM)<input className="input w-full rounded-lg px-3 py-2 mt-1 text-sm" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <BankPaymentFields banks={banks.data?.banks ?? []} value={payment} onChange={setPayment} dateLabel="Date received" />
        {!recovery&&<details className="text-xs text-gray-400"><summary className="cursor-pointer">Bank deductions</summary><p className="mt-2">Record the car bill and upload its invoice first. Select it here if the bank deducted it.</p>{options.map((p) => <div key={p.id} className="flex gap-2 items-center mt-2"><label className="flex-1"><input type="checkbox" checked={deductions[p.id] !== undefined} onChange={(e) => setDeductions((d) => { const next = { ...d }; if (e.target.checked) next[p.id] = (paymentBalanceCents(p) / 100).toFixed(2); else delete next[p.id]; return next; })} /> {p.description || p.recipientName}</label>{deductions[p.id] !== undefined && <input aria-label={`Deduction for ${p.recipientName}`} className="input w-24 rounded-lg px-2 py-1" inputMode="decimal" value={deductions[p.id]} onChange={(e) => setDeductions((d) => ({ ...d, [p.id]: e.target.value }))} />}</div>)}</details>}
        {!recovery&&<details className="text-xs text-gray-400"><summary className="cursor-pointer">Extra customer money</summary><label className="block mt-2">Amount to refund later (RM)<input className="input w-full rounded-lg px-3 py-2 mt-1" inputMode="decimal" value={excess} onChange={(e) => setExcess(e.target.value)} /></label><select aria-label="Customer for extra money" className="input w-full rounded-lg px-3 py-2 mt-2" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Choose customer</option>{customers.filter((c) => c.interestedCarId === bill.carId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></details>}
        <label className="block text-xs text-gray-400">Bank receipt (required)<input type="file" accept="image/png,image/jpeg,application/pdf" className="block mt-2" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <p className="text-xs text-gray-400">Amount covered: {formatCents(covered)} · balance: {formatCents(covered === null ? remaining : remaining - covered)}</p>
        <button type="button" disabled={!ready || busy} className="btn-gold rounded-lg px-4 py-2 text-sm disabled:opacity-40" onClick={() => setConfirm({ title: 'Record money received?', label: 'Record receipt', message: `${formatCents(actual)} actually received. ${formatCents(fee)} deducted for recorded bills. ${formatCents(extra)} kept for customer refund.`, go: () => void save() })}>{busy ? 'Saving…' : 'Record receipt'}</button>
      </>}
    </div>
    <CashConfirm confirm={confirm} onClose={() => setConfirm(null)} />
    {documents && <CompanyPaymentDocuments paymentId={bill.id} onClose={() => setDocuments(false)} />}
  </Modal>;
}
