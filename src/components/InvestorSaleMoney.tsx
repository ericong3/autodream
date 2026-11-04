import { useState } from 'react';
import { useStore } from '../store';
import { investorRequest, prepareProof, parseRinggit, formatCents, useInvestorAction, useInvestorQuery, type Bank, type CarDetail } from '../lib/investorFinance';
import { BankPaymentFields, emptyBankPayment, bankPaymentReady, CashConfirm, PendingSaves, type PendingConfirm } from './InvestorFinanceCar';
type Order = { id: string; kind: 'receipt' | 'refund'; state: 'prepared' | 'posted' | 'cancelled'; amountCents: number; recoveryCents: number; withheldCents: number; excessCents: number; customerName?: string; recipientName?: string; recipientBank?: string; recipientAccount?: string; accountLast4?: string; bankName?: string; paidOn?: string; createdAt: string; createdBy?: string; postedBy?: string; postedAt?: string; cancelledBy?: string; cancelledAt?: string; cancelReason?: string };
type Proof = { id: string; orderId: string; name: string };
type CustomerRefund = { id: string; name: string; owingCents: number; pendingCents: number };
type Snapshot = { carId: string; refundOwingCents: number; orders: Order[]; documents: Proof[]; refundCustomers: CustomerRefund[] };
const cents = (s: string) => /^0(?:\.0{1,2})?$/.test(s.trim()) ? 0 : parseRinggit(s);
const input = 'input w-full rounded-lg px-3 py-2 text-sm';

export default function InvestorSaleMoney({ car, actorId, banks, director, onChanged }: { car: CarDetail; actorId: string; banks: Bank[]; director: boolean; onChanged: () => void | Promise<void> }) {
  const customers = useStore((s) => s.customers).filter((c) => c.interestedCarId === car.carId);
  const query = useInvestorQuery<Snapshot>(`sale-money:${actorId}:${car.carId}`, () => investorRequest('sale_money_snapshot', { carId: car.carId }));
  const act = useInvestorAction(actorId);
  const [error, setError] = useState(''), [uploading, setUploading] = useState(''), [form, setForm] = useState<'receipt' | 'refund' | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [amount, setAmount] = useState(''), [excess, setExcess] = useState('0'), [customerId, setCustomerId] = useState('');
  const [payment, setPayment] = useState(emptyBankPayment), [file, setFile] = useState<File | null>(null), [deductions, setDeductions] = useState<Record<string, string>>({});
  const [refundAmount, setRefundAmount] = useState(''), [refundCustomer, setRefundCustomer] = useState(''), [bankName, setBankName] = useState(''), [account, setAccount] = useState(''), [holder, setHolder] = useState(''), [note, setNote] = useState('Return customer excess money');
  const refresh = async () => { await query.reload(); await onChanged(); };
  const run = async <T,>(slot: string, action: string, data: Record<string, unknown>, label: string): Promise<T | null> => {
    const result = await act.run<T>(slot, action, data, label); if (result) await refresh(); return result;
  };
  const proofUpload = async (orderId: string, selected: File): Promise<string> => {
    setUploading(orderId);
    try { const d = await investorRequest<{ documentId: string }>('sale_proof_upload', { orderId, ...await prepareProof(selected) }); await query.reload(); return d.documentId; }
    finally { setUploading(''); }
  };
  const remaining = (car.saleCents ?? 0) - (car.receivedCents ?? 0), actual = cents(amount), extra = cents(excess);
  const selectedBills = Object.entries(deductions).map(([billId, value]) => ({ billId, amountCents: parseRinggit(value) }));
  const fee = selectedBills.reduce((sum, b) => sum + (b.amountCents ?? 0), 0);
  const covered = actual === null || extra === null ? null : actual + fee - extra;
  const deductionOptions = car.bills.filter((b) => b.state === 'approved' && b.category === 'invoicing' && b.paidCents < b.amountCents);
  const receiptReady = actual !== null && extra !== null && covered !== null && covered > 0 && covered <= remaining && bankPaymentReady(payment) && !!file && (extra === 0 || !!customerId) && selectedBills.every((b) => b.amountCents !== null && b.amountCents > 0 && b.amountCents <= (car.bills.find((x) => x.id === b.billId)?.amountCents ?? 0) - (car.bills.find((x) => x.id === b.billId)?.paidCents ?? 0));
  const refundCents = parseRinggit(refundAmount), refundCustomerRow = query.data?.refundCustomers.find((c) => c.id === refundCustomer);
  const refundReady = !!refundCents && !!refundCustomerRow && refundCents <= refundCustomerRow.owingCents - refundCustomerRow.pendingCents && !!bankName.trim() && !!account.trim() && !!holder.trim() && !!note.trim();
  const prepareReceipt = async () => {
    if (!receiptReady || actual === null || extra === null || !file) return;
    setError(''); const chosenFile = file;
    const result = await run<{ orderId: string }>(`sale-prepare:${car.carId}`, 'prepare_sale_receipt', { carId: car.carId, amountCents: actual, withheldBills: selectedBills, excessCents: extra, ...(customerId ? { customerId } : {}), ...payment }, 'Prepare bank receipt');
    if (!result) return;
    setForm(null); setFile(null); setAmount(''); setExcess('0'); setDeductions({}); setCustomerId(''); setPayment(emptyBankPayment);
    try { const documentId = await proofUpload(result.orderId, chosenFile); await run(`sale-post:${result.orderId}`, 'confirm_sale_money', { orderId: result.orderId, documentId }, 'Record bank receipt'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Receipt saved. Upload its bank proof below to finish.'); }
  };
  return <div className="space-y-3">
    <div className="flex justify-between gap-3"><h4 className="text-sm text-white font-medium">Receipts & customer refunds</h4><button className="text-xs text-gold-400" onClick={() => void refresh()}>Refresh</button></div>
    {(query.error || error || act.error) && <p role="alert" className="text-xs text-red-400">{error || act.error?.message || query.error?.message}</p>}
    {(query.data?.refundOwingCents ?? 0) > 0 && <p className="text-xs text-amber-300">{formatCents(query.data?.refundOwingCents)} reserved for customers.</p>}
    {director && <div className="flex flex-wrap gap-3 text-xs">{remaining > 0 && car.state === 'sold' && <button className="text-gold-400" onClick={() => setForm(form === 'receipt' ? null : 'receipt')}>Record bank receipt</button>}{(query.data?.refundCustomers ?? []).some((c) => c.owingCents > c.pendingCents) && <button className="text-gold-400" onClick={() => setForm(form === 'refund' ? null : 'refund')}>Approve customer refund</button>}</div>}
    {director && form === 'receipt' && <form className="space-y-2 rounded-lg border border-white/10 p-3" onSubmit={(e) => { e.preventDefault(); if (receiptReady) setConfirm({ title: 'Record this bank receipt?', label: 'Record receipt', message: `Actual bank money ${formatCents(actual)}, car price covered ${formatCents(covered)}. Customer excess ${formatCents(extra)} stays reserved for refunds.`, go: () => void prepareReceipt() }); }}>
      <label className="block text-xs text-gray-400">Money that reached the bank (RM)<input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <BankPaymentFields banks={banks} value={payment} onChange={setPayment} dateLabel="Date received" />
      <details className="text-xs text-gray-400"><summary className="cursor-pointer">Bank deductions</summary><p className="mt-2">Add and approve the bank’s invoice under Bills first.</p>{deductionOptions.map((b) => <div key={b.id} className="mt-2 flex gap-2 items-center"><label className="flex-1"><input type="checkbox" checked={deductions[b.id] !== undefined} onChange={(e) => setDeductions((s) => { const next = { ...s }; if (e.target.checked) next[b.id] = ((b.amountCents - b.paidCents) / 100).toFixed(2); else delete next[b.id]; return next; })} /> {b.purpose}</label>{deductions[b.id] !== undefined && <input aria-label={`Deduction for ${b.purpose}`} className="input w-28 rounded-lg px-2 py-1 text-xs" inputMode="decimal" value={deductions[b.id]} onChange={(e) => setDeductions((s) => ({ ...s, [b.id]: e.target.value }))} />}</div>)}</details>
      <details className="text-xs text-gray-400"><summary className="cursor-pointer">Customer excess / overloan</summary><label className="block mt-2">Customer money to reserve (RM)<input className={input} inputMode="decimal" value={excess} onChange={(e) => setExcess(e.target.value)} /></label><select aria-label="Customer for excess money" className={input} value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Choose the customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></details>
      <label className="block text-xs text-gray-400">Bank proof (required)<input type="file" className="block mt-1 text-xs" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <p className="text-xs text-gray-400">Car price covered: {formatCents(covered)} · still to cover: {formatCents(covered === null ? remaining : remaining - covered)}</p>
      <button type="submit" disabled={!receiptReady || !!act.busy || !!uploading} className="btn-gold rounded-lg px-4 py-2 text-xs disabled:opacity-40">Record bank receipt</button>
    </form>}
    {director && form === 'refund' && <form className="space-y-2 rounded-lg border border-white/10 p-3" onSubmit={async (e) => { e.preventDefault(); if (!refundReady) return; if (await run(`refund-prepare:${car.carId}`, 'prepare_customer_refund', { carId: car.carId, customerId: refundCustomer, amountCents: refundCents, bankName: bankName.trim(), accountNumber: account.trim(), accountHolder: holder.trim(), note: note.trim() }, 'Approve customer refund')) setForm(null); }}>
      <select aria-label="Customer to refund" className={input} value={refundCustomer} onChange={(e) => { setRefundCustomer(e.target.value); setBankName(''); setAccount(''); setHolder(''); setRefundAmount(''); }}><option value="">Choose customer</option>{query.data?.refundCustomers.filter((c) => c.owingCents > c.pendingCents).map((c) => <option key={c.id} value={c.id}>{c.name} · {formatCents(c.owingCents - c.pendingCents)} available</option>)}</select>
      <label className="block text-xs text-gray-400">Refund amount (RM)<input className={input} inputMode="decimal" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} /></label>
      <input aria-label="Customer bank name" placeholder="Customer bank name" className={input} value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={200} />
      <input aria-label="Customer bank account" placeholder="Account number" className={input} value={account} onChange={(e) => setAccount(e.target.value)} maxLength={200} />
      <input aria-label="Customer account holder" placeholder="Account holder" className={input} value={holder} onChange={(e) => setHolder(e.target.value)} maxLength={200} />
      <input aria-label="Refund reason" placeholder="Reason" className={input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      <p className="text-xs text-gray-500">After paying the customer, upload the bank receipt on the saved entry to finish it.</p>
      <button type="submit" disabled={!refundReady || !!act.busy} className="btn-gold rounded-lg px-4 py-2 text-xs disabled:opacity-40">Approve refund</button>
    </form>}
    {query.loading && <p className="text-xs text-gray-500">Loading money entries…</p>}
    {query.data?.orders.map((o) => <OrderRow key={o.id} order={o} proofs={query.data?.documents.filter((d) => d.orderId === o.id) ?? []} banks={banks} director={director} busy={!!act.busy || !!uploading} onUpload={proofUpload} onPost={(data) => { setConfirm({ title: o.kind === 'refund' ? 'Record this customer refund?' : 'Record this bank receipt?', label: 'Record money', message: `${formatCents(o.amountCents)} ${o.kind === 'refund' ? `refunded to ${o.recipientName || o.customerName}` : 'actually received in the bank'}. This records money already moved; it does not send a transfer.`, go: () => void run(`sale-post:${o.id}`, 'confirm_sale_money', data, o.kind === 'refund' ? 'Record customer refund' : 'Record bank receipt') }); }} onCancel={async () => { const reason = window.prompt('Reason for cancelling this waiting entry')?.trim(); if (reason && reason.length >= 3) await run(`sale-cancel:${o.id}`, 'cancel_sale_money', { orderId: o.id, note: reason }, 'Cancel waiting money entry'); }} onError={setError} />)}
    {!query.loading && query.data?.orders.length === 0 && <p className="text-xs text-gray-500">No recorded receipts or refunds yet.</p>}
    <PendingSaves pending={act.pending.filter((p) => p.slot.startsWith('sale-') || p.slot.startsWith('refund-'))} busy={act.busy} onRetry={(slot) => void act.retry(slot).then((r) => r && refresh())} onDiscard={act.discard} />
    <CashConfirm confirm={confirm} onClose={() => setConfirm(null)} />
  </div>;
}

function OrderRow({ order: o, proofs, banks, director, busy, onUpload, onPost, onCancel, onError }: { order: Order; proofs: Proof[]; banks: Bank[]; director: boolean; busy: boolean; onUpload: (id: string, file: File) => Promise<string>; onPost: (data: Record<string, unknown>) => void; onCancel: () => Promise<void>; onError: (message: string) => void }) {
  const [documentId, setDocumentId] = useState(''), [payment, setPayment] = useState(emptyBankPayment), [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const ready = !!documentId && proofs.some((d) => d.id === documentId) && (o.kind === 'receipt' || bankPaymentReady(payment));
  return <div className="border-t border-white/10 pt-3 space-y-2 text-xs">
    <div className="flex justify-between gap-2"><p className="text-white">{o.kind === 'receipt' ? 'Bank receipt' : 'Customer refund'} · {formatCents(o.amountCents)}</p><p className={o.state === 'posted' ? 'text-green-400' : 'text-amber-300'}>{o.state === 'posted' ? 'Recorded' : o.state === 'cancelled' ? 'Cancelled' : 'Waiting for proof / recording'}</p></div>
    {o.kind === 'receipt' && <p className="text-gray-400">Car price covered {formatCents(o.recoveryCents)} · bank deductions {formatCents(o.withheldCents)} · customer excess {formatCents(o.excessCents)}</p>}
    {o.kind === 'refund' && <p className="text-gray-400">{o.customerName} · {o.recipientName}{o.recipientBank ? ` · ${o.recipientBank}` : ''}{director && o.recipientAccount ? ` · ${o.recipientAccount}` : o.accountLast4 ? ` · ending ${o.accountLast4}` : ''}</p>}
    <p className="text-gray-500">{o.createdBy} · {new Date(o.createdAt).toLocaleString('en-MY')}{o.paidOn ? ` · transaction ${o.paidOn}` : ''}</p>
    {o.postedBy && <p className="text-gray-500">Recorded by {o.postedBy} · {new Date(o.postedAt || o.createdAt).toLocaleString('en-MY')}</p>}
    {o.cancelReason && <p className="text-gray-500">{o.cancelReason} · {o.cancelledBy}</p>}
    <div className="flex flex-wrap gap-3">{proofs.map((d) => link?.id === d.id ? <a key={d.id} className="text-gold-400 underline" href={link.url} target="_blank" rel="noopener noreferrer">Open {d.name}</a> : <button key={d.id} className="text-gold-400" onClick={async () => { try { const r = await investorRequest<{ url: string }>('sale_proof_url', { documentId: d.id }); setLink({ id: d.id, url: r.url }); } catch (e) { onError(e instanceof Error ? e.message : 'Could not open the proof.'); } }}>{d.name}</button>)}</div>
    {director && o.state === 'prepared' && <div className="space-y-2">
      <label className={`inline-block text-gold-400 ${busy ? 'pointer-events-none opacity-40' : 'cursor-pointer'}`}>Upload bank proof<input className="hidden" type="file" accept="image/png,image/jpeg,application/pdf" disabled={busy} onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { setDocumentId(await onUpload(o.id, file)); } catch (e) { onError(e instanceof Error ? e.message : 'Could not upload the proof.'); } }} /></label>
      <select aria-label="Bank proof for this entry" className={input} value={documentId} onChange={(e) => setDocumentId(e.target.value)}><option value="">Choose bank proof</option>{proofs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      {o.kind === 'refund' && <BankPaymentFields banks={banks} value={payment} onChange={setPayment} />}
      <div className="flex gap-3"><button type="button" className="btn-gold rounded-lg px-3 py-2 text-xs disabled:opacity-40" disabled={!ready || busy} onClick={() => onPost({ orderId: o.id, documentId, ...(o.kind === 'refund' ? payment : {}) })}>{o.kind === 'refund' ? 'Record actual refund' : 'Record bank receipt'}</button><button className="text-gray-400" type="button" disabled={busy} onClick={() => void onCancel()}>Cancel entry</button></div>
    </div>}
  </div>;
}
