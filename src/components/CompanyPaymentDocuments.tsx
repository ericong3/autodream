import { useEffect, useState } from 'react';
import Modal from './Modal';
import { companyEvidence, uploadCompanyEvidence, type CompanyDocument } from '../lib/companyEvidence';
import { useStore } from '../store';

type DocumentList = { documents: CompanyDocument[]; invoiceRequired?: boolean; invoiceConfirmed?: boolean; receiptConfirmed?: boolean };

export default function CompanyPaymentDocuments({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [requirements, setRequirements] = useState<DocumentList>({ documents: [] });
  const role = useStore((s) => s.currentUser?.role);
  const load = async () => {
    const result = await companyEvidence<DocumentList>('list', { paymentId });
    if (!Array.isArray(result.documents)) throw new Error('Could not load the documents.');
    setDocuments(result.documents);
    setRequirements(result);
  };
  useEffect(() => { let active = true; companyEvidence<DocumentList>('list', { paymentId }).then((r) => { if (active && Array.isArray(r.documents)) { setDocuments(r.documents); setRequirements(r); } }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [paymentId]);
  const upload = async (kind: 'invoice' | 'payment', file?: File) => {
    if (!file) return;
    setBusy(true); setError('');
    try { await uploadCompanyEvidence(paymentId, kind, file); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Upload failed. Please try again.'); }
    finally { setBusy(false); }
  };
  return <Modal isOpen onClose={onClose} title="Invoices & receipts" maxWidth="max-w-lg">
    <p className="text-xs text-gray-400 mb-4">Keep the bill and proof of payment together. Files are private.</p>
    {error && <p role="alert" className="text-sm text-red-400 mb-3">{error}</p>}
    {requirements.invoiceRequired && !requirements.invoiceConfirmed && <p className="text-xs text-amber-300 mb-2">Invoice needed</p>}
    {requirements.receiptConfirmed === false && <p className="text-xs text-amber-300 mb-2">Payment receipt needed</p>}
    <div className="flex flex-wrap gap-2 mb-4">{(['invoice', 'payment'] as const).filter((kind) => kind === 'invoice' ? requirements.invoiceRequired !== false : role === 'director' || role === 'admin').map((kind) => <label key={kind} className={`btn-ghost rounded-lg px-3 py-2 text-xs ${busy ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
      {kind === 'invoice' ? 'Upload invoice / bill' : 'Upload payment receipt'}
      <input className="hidden" type="file" accept="image/png,image/jpeg,application/pdf" disabled={busy} onChange={(e) => { void upload(kind, e.target.files?.[0]); e.target.value = ''; }} />
    </label>)}</div>
    {busy && <p className="text-xs text-gray-400">Please wait…</p>}
    {!busy && documents.length === 0 && <p className="text-xs text-amber-300">No documents uploaded yet.</p>}
    <div className="space-y-3">{documents.map((d) => <div key={d.documentId} className="rounded-lg border border-white/10 p-3">
      <p className="text-xs text-gray-400">{d.kind === 'invoice' ? 'Invoice / bill' : 'Payment receipt'}</p>
      <p className="text-sm text-white break-words">{d.name || d.fileName || 'Document'}</p>
      <p className="text-[11px] text-gray-500">{d.actorName || d.createdBy || ''}{d.uploadedAt ? ` · ${new Date(d.uploadedAt).toLocaleString('en-MY')}` : ''}</p>
      {link?.id === d.documentId ? <a className="text-xs text-gold-400 underline" href={link.url} target="_blank" rel="noopener noreferrer">Open document</a> : <button className="text-xs text-gold-400 mt-1" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const r = await companyEvidence<{ url: string }>('open', { documentId: d.documentId }); if (!r.url?.startsWith('https://')) throw new Error('Could not open the document.'); setLink({ id: d.documentId, url: r.url }); } catch (e) { setError(e instanceof Error ? e.message : 'Could not open this file.'); } finally { setBusy(false); } }}>View document</button>}
    </div>)}</div>
  </Modal>;
}
