import { useState } from 'react';
import { InvestorFinanceError, formatCents, prepareProof } from '../lib/investorFinance';
import { tradeInRequest } from '../lib/tradeInFunding';
import ConfirmSheet from './ConfirmSheet';
import { useStore } from '../store';

type Intent = { choiceId: string; documentId: string; requestId: string };
export default function ApplyTradeInFunding({ choiceId, actorId, amountCents, lenderCents = 0, potName, onChanged }: { choiceId: string; actorId: string; amountCents: number; lenderCents?: number; potName: string; onChanged: () => Promise<unknown> }) {
  const key = `autodream-trade-in-apply:${actorId}:${choiceId}`;
  const read = (): Intent | null => { try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); return v?.choiceId === choiceId && typeof v.documentId === 'string' && typeof v.requestId === 'string' ? v : null; } catch { return null; } };
  const [pending, setPending] = useState<Intent | null>(read), [documentId, setDocumentId] = useState(''), [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(false);
  const save = async () => {
    setBusy(true); setError('');
    try {
      if (useStore.getState().currentUser?.id !== actorId) throw new Error('Your account changed. Reopen this car.');
      let intent = read();
      if (!intent) {
        let docId = documentId;
        if (!docId) { if (!file) throw new Error('Choose the trade-in invoice or signed purchase document.'); const d = await tradeInRequest<{ documentId: string }>('upload', { choiceId, ...await prepareProof(file) }, true); docId = d.documentId; setDocumentId(docId); }
        intent = { choiceId, documentId: docId, requestId: 'tradein_apply_' + crypto.randomUUID() };
        sessionStorage.setItem(key, JSON.stringify(intent)); setPending(intent);
      }
      if (useStore.getState().currentUser?.id !== actorId) throw new Error('Your account changed. Reopen this car.');
      const saved = await tradeInRequest<{car?: Record<string, unknown>; payments?: Record<string, unknown>[]; journals?: Record<string, unknown>[]}>('apply', intent, true);
      if(saved.car) useStore.getState().applyCompanyBankPayment(actorId,{car:saved.car,payments:saved.payments??[],journals:saved.journals??[]});
      sessionStorage.removeItem(key); setPending(null); setFile(null); if (useStore.getState().currentUser?.id === actorId) await onChanged();
    } catch (e) {
      if (e instanceof InvestorFinanceError && !e.retryable && e.code !== 'REQUEST_CHANGED') { sessionStorage.removeItem(key); setPending(null); }
      setError(e instanceof Error ? e.message : 'Could not confirm funding.');
    } finally { setBusy(false); }
  };
  return <div className="space-y-2 border-t border-white/10 pt-3">
    <p className="text-xs text-gray-400">Upload the trade-in invoice or signed purchase document, then confirm funding.</p>
    {!pending && <input aria-label="Trade-in purchase document" type="file" accept="image/png,image/jpeg,application/pdf" disabled={busy} className="block text-xs text-gray-300" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setDocumentId(''); }} />}
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    <button type="button" disabled={busy || !pending && !file && !documentId} className="btn-gold rounded-lg px-4 py-2 text-xs disabled:opacity-40" onClick={() => setConfirm(true)}>{busy ? 'Saving…' : pending ? 'Retry original funding' : 'Confirm trade-in funding'}</button>
    <ConfirmSheet isOpen={confirm} onClose={() => setConfirm(false)} variant="warning" title="Confirm trade-in funding?" message={`${potName} will fund this ${formatCents(amountCents)} car. ${formatCents(amountCents - lenderCents)} counts towards the outgoing car’s sale price.${lenderCents ? ` ${formatCents(lenderCents)} stays reserved for the lender.` : ''} No bank money moves at this step.`} confirmLabel="Confirm funding" onConfirm={() => { setConfirm(false); void save(); }} />
  </div>;
}

export function TradeInInvoiceLink({ documentId }: { documentId: string }) {
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <div className="text-xs space-y-1"><p className="text-gray-400">Trade-in purchase document.</p>{url ? <a className="text-gold-400 underline" href={url} target="_blank" rel="noopener noreferrer">Open trade-in invoice</a> : <button className="text-gold-400" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const r = await tradeInRequest<{ url: string }>('open', { documentId }, true); setUrl(r.url); } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the invoice.'); } finally { setBusy(false); } }}>{busy ? 'Opening…' : 'View trade-in invoice'}</button>}{error && <p role="alert" className="text-red-400">{error}</p>}</div>;
}
