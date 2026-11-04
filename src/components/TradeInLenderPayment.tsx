import { useState } from 'react';
import { useStore } from '../store';
import { tradeInRequest } from '../lib/tradeInFunding';
import { useInvestorQuery, prepareProof, formatCents, InvestorFinanceError, type Bank } from '../lib/investorFinance';
import { BankPaymentFields, bankPaymentReady, emptyBankPayment, CashConfirm, type PendingConfirm } from './InvestorFinanceCar';

type Snapshot = { amountCents: number; paid: boolean; paidOn?: string; recipientBank?: string; recipientAccount?: string; recipientName?: string; accountLast4?: string; recordedAt?: string; recordedBy?: string; documents: { id: string; kind: string; name: string }[] };
type Intent = Record<string, string> & { applicationId: string; requestId: string };
export default function TradeInLenderPayment({ applicationId, actorId, director, banks, onChanged }: { applicationId: string; actorId: string; director: boolean; banks: Bank[]; onChanged: () => Promise<unknown> }) {
  const key = `autodream-trade-in-lender:${actorId}:${applicationId}`;
  const read = (): Intent | null => { try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); return v?.applicationId === applicationId && v.requestId ? v : null; } catch { return null; } };
  const [pending, setPending] = useState<Intent | null>(read), [statement, setStatement] = useState<File | null>(null), [receipt, setReceipt] = useState<File | null>(null);
  const [payment, setPayment] = useState(emptyBankPayment), [recipientBank, setRecipientBank] = useState(''), [account, setAccount] = useState(''), [name, setName] = useState(''), [note, setNote] = useState('Lender settlement');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState<PendingConfirm | null>(null), [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const query = useInvestorQuery<Snapshot>(`trade-in-lender:${actorId}:${applicationId}`, () => tradeInRequest('snapshot', { applicationId }, 'lender'));
  const ready = !!statement && !!receipt && bankPaymentReady(payment) && [recipientBank, account, name, note].every((v) => v.trim());
  const assertActor = () => { if (useStore.getState().currentUser?.id !== actorId) throw new Error('Your account changed. Reopen this car.'); };
  const save = async () => {
    setBusy(true); setError('');
    try {
      assertActor(); let intent = read();
      if (!intent) {
        if (!ready || !statement || !receipt) throw new Error('Check the lender details and both documents.');
        const statementDoc = await tradeInRequest<{ documentId: string }>('upload', { applicationId, kind: 'statement', ...await prepareProof(statement) }, 'lender'); assertActor();
        const receiptDoc = await tradeInRequest<{ documentId: string }>('upload', { applicationId, kind: 'payment', ...await prepareProof(receipt) }, 'lender'); assertActor();
        intent = { applicationId, statementDocumentId: statementDoc.documentId, receiptDocumentId: receiptDoc.documentId, ...payment, recipientBank: recipientBank.trim(), recipientAccount: account.trim(), recipientName: name.trim(), note: note.trim(), requestId: 'lender_pay_' + crypto.randomUUID() };
        sessionStorage.setItem(key, JSON.stringify(intent)); setPending(intent);
      }
      assertActor(); await tradeInRequest('pay', intent, 'lender'); sessionStorage.removeItem(key); setPending(null);
      if (useStore.getState().currentUser?.id === actorId) { await query.reload(); await onChanged(); }
    } catch (e) { if (e instanceof InvestorFinanceError && !e.retryable && e.code !== 'REQUEST_CHANGED') { sessionStorage.removeItem(key); setPending(null); } setError(e instanceof Error ? e.message : 'Could not record lender payment.'); }
    finally { setBusy(false); }
  };
  const data = query.data;
  return <div className="rounded-lg border border-gold-400/20 p-3 space-y-3 text-xs">
    <p className="text-white font-medium">Lender balance · {formatCents(data?.amountCents)}</p>
    {(error || query.error) && <p role="alert" className="text-red-400">{error || query.error?.message}</p>}
    {query.loading && <p className="text-gray-500">Loading lender payment…</p>}
    {data && <p className={data.paid ? 'text-green-400' : 'text-amber-300'}>{data.paid ? `Paid on ${data.paidOn}` : 'Reserved for the lender. Purchase payment is not complete yet.'}</p>}
    {data?.paid && <><p className="text-gray-400">{data.recipientName}{data.recipientBank ? ` · ${data.recipientBank}` : ''}{data.recipientAccount ? ` · ${data.recipientAccount}` : data.accountLast4 ? ` · ending ${data.accountLast4}` : ''}</p><p className="text-gray-500">Recorded by {data.recordedBy}{data.recordedAt ? ` · ${new Date(data.recordedAt).toLocaleString('en-MY')}` : ''}</p></>}
    {data?.documents.map((doc) => link?.id === doc.id ? <a key={doc.id} className="block text-gold-400 underline" href={link.url} target="_blank" rel="noopener noreferrer">Open {doc.name}</a> : <button type="button" key={doc.id} className="block text-gold-400" onClick={async () => { try { const r = await tradeInRequest<{ url: string }>('open', { documentId: doc.id }, 'lender'); setLink({ id: doc.id, url: r.url }); } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the document.'); } }}>{doc.kind === 'statement' ? 'Lender statement' : 'Payment receipt'} · {doc.name}</button>)}
    {director && data && !data.paid && (pending ? <button type="button" className="text-gold-400" disabled={busy} onClick={() => void save()}>{busy ? 'Checking…' : 'Retry original lender payment'}</button> : <details><summary className="text-gold-400 cursor-pointer">Record lender payment</summary><div className="space-y-3 mt-3">
      <BankPaymentFields banks={banks} value={payment} onChange={setPayment} />
      <input aria-label="Lender bank" placeholder="Lender bank" className="input w-full rounded-lg px-3 py-2" maxLength={200} value={recipientBank} onChange={(e) => setRecipientBank(e.target.value)} />
      <input aria-label="Lender account number" placeholder="Lender account number" className="input w-full rounded-lg px-3 py-2" maxLength={200} value={account} onChange={(e) => setAccount(e.target.value)} />
      <input aria-label="Lender account holder" placeholder="Lender account holder" className="input w-full rounded-lg px-3 py-2" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Lender payment reason" className="input w-full rounded-lg px-3 py-2" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="block text-gray-400">Lender statement<input className="block mt-1" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setStatement(e.target.files?.[0] ?? null)} /></label>
      <label className="block text-gray-400">Bank payment receipt<input className="block mt-1" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} /></label>
      <p className="text-gray-500">Record the full lender balance after it has been paid. This does not send a bank transfer.</p>
      <button type="button" className="btn-gold rounded-lg px-4 py-2 disabled:opacity-40" disabled={!ready || busy} onClick={() => setConfirm({ title: 'Record lender payment?', label: 'Record payment', message: `${formatCents(data.amountCents)} paid to ${name}. This clears the reserved lender balance without adding another car expense.`, go: () => void save() })}>{busy ? 'Saving…' : 'Record lender payment'}</button>
    </div></details>)}
    <CashConfirm confirm={confirm} onClose={() => setConfirm(null)} />
  </div>;
}
