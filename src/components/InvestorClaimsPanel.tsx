import { useState } from 'react';
import { useStore } from '../store';
import { investorClaimsRequest, saveClaimCommand, type InvestorClaim } from '../lib/investorClaims';
import { investorRequest, prepareProof, useInvestorQuery, formatCents } from '../lib/investorFinance';

export default function InvestorClaimsPanel({ mine = false, refresh = 0 }: { mine?: boolean; refresh?: number }) {
  const actor = useStore((s) => s.currentUser);
  const [page, setPage] = useState(0), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [documentLink, setDocumentLink] = useState<{ id: string; url: string } | null>(null);
  const query = useInvestorQuery<{ claims: InvestorClaim[]; hasMore: boolean }>(actor ? `investor-claims:${actor.id}:${mine}:${page}:${refresh}` : null, () => investorClaimsRequest('list', { page, mine }));
  if (!actor) return null;
  const review = async (claim: InvestorClaim, action: 'approve' | 'reject') => {
    const note = action === 'reject' ? window.prompt('Reason for rejecting this claim')?.trim() : undefined;
    if (action === 'reject' && !note) return;
    setBusy(claim.claimId); setError('');
    try { await saveClaimCommand(actor.id, action + ':' + claim.claimId, action, { claimId: claim.claimId, ...(note ? { note } : {}) }); await query.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the review.'); }
    finally { setBusy(''); }
  };
  return <section className="rounded-xl border border-white/10 p-4 space-y-3">
    <div className="flex justify-between gap-2"><h3 className="text-sm text-white font-semibold">Investor car claims</h3><button className="text-xs text-gold-400" onClick={() => void query.reload()}>Refresh</button></div>
    {(error || query.error) && <p role="alert" className="text-xs text-red-400">{error || query.error?.message}</p>}
    {query.loading && <p className="text-xs text-gray-500">Loading claims…</p>}
    {!query.loading && query.data?.claims.length === 0 && <p className="text-xs text-gray-500">No claims.</p>}
    {query.data?.claims.map((c) => <div key={c.claimId} className="border-t border-white/10 pt-3 space-y-2 text-xs">
      <div className="flex justify-between gap-3"><div><p className="text-white">{c.purpose}</p><p className="text-gray-500">{c.car?.plate || c.car?.model || c.carId} · Pay to {c.payee}</p><p className="text-gray-500">{c.claimantName} · {new Date(c.submittedAt).toLocaleString('en-MY')}</p></div><div className="text-right"><p className="text-white">{formatCents(c.amountCents)}</p><p className={c.state === 'rejected' ? 'text-red-400' : c.paidCents >= c.amountCents ? 'text-green-400' : 'text-amber-300'}>{c.state === 'rejected' ? 'Rejected' : c.paidCents >= c.amountCents ? 'Paid' : c.state === 'approved' ? 'Approved' : 'Waiting for Director'}</p></div></div>
      {c.reviewNote && <p className="text-gray-400">{c.reviewNote}</p>}
      {!c.supplierInvoiceConfirmed && <p className="text-amber-300">Invoice needed</p>}
      {c.state === 'pending' && (c.mine || actor.role === 'director' || actor.role === 'admin') && <label className={`inline-block text-gold-400 ${busy ? 'pointer-events-none opacity-40' : 'cursor-pointer'}`}>Upload invoice<input className="hidden" type="file" accept="image/png,image/jpeg,application/pdf" disabled={!!busy} onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setBusy(c.claimId); setError(''); try { await investorRequest('proof_upload', { billId: c.billId, kind: 'bill', ...await prepareProof(file) }); await query.reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not upload the invoice.'); } finally { setBusy(''); } }} /></label>}
      <div className="flex flex-wrap gap-3">{c.documents?.map((d) => documentLink?.id === d.id ? <a key={d.id} href={documentLink.url} target="_blank" rel="noopener noreferrer" className="text-gold-400 underline">Open {d.name}</a> : <button key={d.id} className="text-gold-400" onClick={async () => { try { const result = await investorRequest<{ url: string }>('proof_url', { documentId: d.id }); setDocumentLink({ id: d.id, url: result.url }); } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the invoice.'); } }}>{d.name}</button>)}</div>
      {!mine && c.state === 'pending' && <div className="flex gap-3">{actor.role === 'director' && <button disabled={!!busy || !c.supplierInvoiceConfirmed} className="text-green-400 disabled:opacity-40" onClick={() => void review(c, 'approve')}>Approve</button>}{['director', 'admin'].includes(actor.role) && <button disabled={!!busy} className="text-red-400 disabled:opacity-40" onClick={() => void review(c, 'reject')}>Reject</button>}</div>}
      {c.state === 'approved' && ['director','admin'].includes(actor.role) && <a className="text-gold-400" href={`#/investor-finance?carId=${encodeURIComponent(c.carId)}`}>Open car bill</a>}
    </div>)}
    <div className="flex gap-4 text-xs"><button disabled={page === 0 || query.loading} className="text-gray-400 disabled:opacity-30" onClick={() => setPage((p) => p - 1)}>Previous</button><button disabled={!query.data?.hasMore || query.loading} className="text-gold-400 disabled:opacity-30" onClick={() => setPage((p) => p + 1)}>Next</button></div>
  </section>;
}
