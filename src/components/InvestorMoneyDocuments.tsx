import { useEffect, useState } from 'react';
import { prepareProof } from '../lib/investorFinance';

type Target = { target: 'purchase'; carId: string } | { target: 'withdrawal'; withdrawalId: string };
type Document = { documentId: string; kind: 'invoice' | 'payment'; fileName: string; used?: boolean; uploadedAt?: string; actorName?: string };
export type MoneyProofSelection = { invoiceDocumentId?: string; receiptDocumentId?: string };
async function request<T>(action: string, data: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/garage/sales', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Garage-Building': '1' }, body: JSON.stringify({ scope: 'investor_money_evidence', action, ...data }) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== 'object') throw new Error(result?.error?.message || 'Could not confirm the document. Please try again.');
  return result;
}

export default function InvestorMoneyDocuments({ source, amountCents, editable = false, onChoose }: { source: Target; amountCents: number; editable?: boolean; onChoose?: (selection: MoneyProofSelection) => void }) {
  const [open, setOpen] = useState(editable);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selected, setSelected] = useState<MoneyProofSelection>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState<{ id: string; url: string } | null>(null);
  const sourceKey = JSON.stringify(source);
  useEffect(() => { if (!open) return; let active = true; setBusy(true); request<{ documents: Document[] }>('list', JSON.parse(sourceKey)).then((r) => { if (active && Array.isArray(r.documents)) setDocuments(r.documents); }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [open, sourceKey]);
  const choose = (kind: 'invoice' | 'payment', id: string) => {
    const next = { ...selected, [kind === 'invoice' ? 'invoiceDocumentId' : 'receiptDocumentId']: id };
    setSelected(next); onChoose?.(next);
  };
  const upload = async (kind: 'invoice' | 'payment', file?: File) => {
    if (!file) return; setBusy(true); setError('');
    try {
      const proof = await prepareProof(file);
      const material = new TextEncoder().encode(JSON.stringify([source, amountCents, kind, proof]));
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', material)), (b) => b.toString(16).padStart(2, '0')).join('');
      const uploaded = await request<{ document: Document }>('upload', { ...source, amountCents, kind, ...proof, requestId: 'money_doc_' + hash });
      const result = await request<{ documents: Document[] }>('list', source);
      if (!Array.isArray(result.documents)) throw new Error('Refresh to check the uploaded file.');
      setDocuments(result.documents);
      const candidate = result.documents.find((d) => d.documentId === uploaded.document?.documentId && d.kind === kind && !d.used);
      if (candidate) choose(kind, candidate.documentId);
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed. Please try again.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2 text-xs">
    {!editable && <button type="button" className="text-gold-400" onClick={() => setOpen(!open)}>{open ? 'Hide documents' : 'View invoices & receipts'}</button>}
    {open && <>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {busy && <p className="text-gray-500">Please wait…</p>}
      {editable && (source.target === 'purchase' ? ['invoice', 'payment'] as const : ['payment'] as const).map((kind) => <div key={kind} className="space-y-1">
        <label className={`inline-block border border-white/10 rounded-lg px-3 py-2 text-gray-300 ${busy ? 'opacity-40' : 'cursor-pointer'}`}>{kind === 'invoice' ? 'Upload purchase invoice' : 'Upload payment receipt'}<input type="file" accept="image/png,image/jpeg,application/pdf" disabled={busy} className="hidden" onChange={(e) => { void upload(kind, e.target.files?.[0]); e.target.value = ''; }} /></label>
        <select className="input w-full px-3 py-2 rounded-lg" value={(kind === 'invoice' ? selected.invoiceDocumentId : selected.receiptDocumentId) || ''} onChange={(e) => choose(kind, e.target.value)}><option value="">{kind === 'invoice' ? 'Choose the purchase invoice' : 'Choose the payment receipt'}</option>{documents.filter((d) => d.kind === kind && !d.used).map((d) => <option key={d.documentId} value={d.documentId}>{d.fileName}</option>)}</select>
      </div>)}
      {documents.map((d) => <div key={d.documentId} className="text-gray-400 flex flex-wrap gap-2"><span>{d.kind === 'invoice' ? 'Invoice' : 'Payment receipt'} · {d.fileName}{d.actorName ? ` · ${d.actorName}` : ''}{d.uploadedAt ? ` · ${new Date(d.uploadedAt).toLocaleString('en-MY')}` : ''}</span>{url?.id === d.documentId ? <a href={url.url} target="_blank" rel="noopener noreferrer" className="text-gold-400 underline">Open</a> : <button type="button" disabled={busy} className="text-gold-400" onClick={async () => { setBusy(true); try { const r = await request<{ url: string }>('open', { documentId: d.documentId }); if (!r.url?.startsWith('https://')) throw new Error('Could not open the file.'); setUrl({ id: d.documentId, url: r.url }); } catch (e) { setError(e instanceof Error ? e.message : 'Could not open this file.'); } finally { setBusy(false); } }}>View</button>}</div>)}
      {!busy && documents.length === 0 && <p className="text-gray-500">No documents uploaded yet.</p>}
    </>}
  </div>;
}
