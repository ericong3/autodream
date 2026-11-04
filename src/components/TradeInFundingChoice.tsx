import { useState } from 'react';
import { useStore } from '../store';
import ApplyTradeInFunding from './ApplyTradeInFunding';
import { tradeInRequest as request } from '../lib/tradeInFunding';
import { investorRequest, InvestorFinanceError, formatCents, parsePercentToBasisPoints, useInvestorQuery, type ProfileList } from '../lib/investorFinance';
type Choice = { id: string; fundingKind: 'company' | 'investor'; potName: string; selectedBy: string; selectedAt: string; revision: number; financiallyApplied: boolean; valuationChanged: boolean; grossCents: number; lenderCents: number; lenderPaidCents?: number; appliedBy?: string; appliedAt?: string; reason?: string };
type Pending = { requestId: string; data: Record<string, unknown> };
export default function TradeInFundingChoice({ incomingCarId }: { incomingCarId: string }) {
  const actor = useStore((s) => s.currentUser);
  const [kind, setKind] = useState(''), [potId, setPotId] = useState(''), [share, setShare] = useState('40'), [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const key = `autodream-trade-in-choice:${actor?.id}:${incomingCarId}`;
  const readPending = (): Pending | null => { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } };
  const [pending, setPending] = useState<Pending | null>(readPending);
  const query = useInvestorQuery<{ choice: Choice | null; history?: Choice[] }>(actor?.role === 'director' ? `trade-in-choice:${actor.id}:${incomingCarId}` : null, () => request('snapshot', { incomingCarId }));
  const profiles = useInvestorQuery<ProfileList>(actor?.role === 'director' && kind === 'investor' ? `trade-in-pots:${actor.id}` : null, () => investorRequest('list_profiles'));
  const bp = parsePercentToBasisPoints(share), choice = query.data?.choice;
  const ready = (kind === 'company' || kind === 'investor' && !!potId && bp !== null) && (!choice || reason.trim().length >= 3);
  const save = async (retry = false) => {
    setError(''); setBusy(true);
    try {
      const data = { incomingCarId, fundingKind: kind, ...(kind === 'investor' ? { potId, investorBasisPoints: bp } : {}), ...(choice ? { expectedChoiceId: choice.id, reason: reason.trim() } : {}) };
      const old = readPending();
      if (old && !retry && JSON.stringify(old.data) !== JSON.stringify(data)) throw new Error('Retry the original funding choice before changing its details.');
      if (retry && !old) throw new Error('There is no waiting save. Refresh this car.');
      const intent = old ?? { requestId: 'tradein_' + crypto.randomUUID(), data };
      sessionStorage.setItem(key, JSON.stringify(intent)); setPending(intent);
      await request('choose', { ...intent.data, requestId: intent.requestId });
      sessionStorage.removeItem(key); setPending(null); setEditing(false); await query.reload();
    } catch (e) {
      if (e instanceof InvestorFinanceError && !e.retryable && e.code !== 'REQUEST_CHANGED') { sessionStorage.removeItem(key); setPending(null); }
      setError(e instanceof Error ? e.message : 'Could not save the choice.');
    } finally { setBusy(false); }
  };
  if (actor?.role !== 'director') return null;
  return <section className="rounded-xl border border-gold-400/20 p-4 space-y-3">
    <div className="flex justify-between"><h3 className="text-sm font-semibold text-white">Trade-in funding</h3><button type="button" className="text-xs text-gold-400" disabled={busy || query.loading} onClick={() => void query.reload()}>Refresh</button></div>
    {choice && <div className="text-xs"><p className="text-gold-300">{choice.potName} · {choice.financiallyApplied ? choice.lenderCents > (choice.lenderPaidCents ?? 0) ? 'Lender payment pending' : 'Funded' : 'Awaiting funding'}</p><p className="text-gray-400">Trade-in value {formatCents(choice.grossCents)} · Lender balance {formatCents(choice.lenderCents)}</p><p className="text-gray-500">Chosen by {choice.selectedBy} · {new Date(choice.selectedAt).toLocaleString('en-MY')}</p></div>}
    {choice?.valuationChanged && <p className="text-xs text-amber-300">The trade-in value changed. Review this funding choice again.</p>}
    {(error || query.error) && <p role="alert" className="text-xs text-red-400">{error || query.error?.message}</p>}
    {query.loading && <p className="text-xs text-gray-500">Loading funding choice…</p>}
    {!query.loading && (!choice || editing) && <div className="space-y-2">
      <p className="text-xs text-gray-400">Choose whose money will fund this car.</p>
      <select aria-label="Funding pot type" className="input rounded-lg w-full px-3 py-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy}><option value="">Choose funding</option><option value="company">Company pot</option><option value="investor">Investor pot</option></select>
      {kind === 'investor' && <><select aria-label="Investor pot" className="input rounded-lg w-full px-3 py-2 text-sm" value={potId} onChange={(e) => setPotId(e.target.value)} disabled={busy || profiles.loading}><option value="">Choose investor</option>{profiles.data?.profiles.map((p) => <option key={p.potId} value={p.potId}>{p.name}</option>)}</select><label className="block text-xs text-gray-400">Investor profit share (%)<input className="input rounded-lg w-full px-3 py-2 mt-1 text-sm" inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} disabled={busy} /></label>{profiles.error && <p className="text-xs text-red-400">{profiles.error.message}</p>}</>}
      {choice && <input aria-label="Reason for changing funding" className="input rounded-lg w-full px-3 py-2 text-sm" placeholder="Reason for changing funding" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />}
      <button type="button" disabled={!ready || busy} className="btn-gold rounded-lg px-4 py-2 text-xs disabled:opacity-40" onClick={() => void save()}>{busy ? 'Saving…' : 'Save funding choice'}</button>
    </div>}
    {choice && !choice.financiallyApplied && !editing && <button className="text-xs text-gray-400" onClick={() => setEditing(true)}>Change choice</button>}
    {choice?.financiallyApplied && <p className="text-xs text-green-400">Funded by {choice.appliedBy} · {choice.appliedAt && new Date(choice.appliedAt).toLocaleString('en-MY')}</p>}
    {choice && !choice.financiallyApplied && !choice.valuationChanged && !editing && choice.fundingKind === 'investor' && <ApplyTradeInFunding key={actor.id + ':' + choice.id} choiceId={choice.id} actorId={actor.id} amountCents={choice.grossCents} lenderCents={choice.lenderCents} potName={choice.potName} onChanged={query.reload} />}
    {choice && !choice.financiallyApplied && !editing && choice.fundingKind === 'company' && <p className="text-xs text-amber-300">Company-bank funding setup is still required. This car has not been funded.</p>}
    {pending && <button disabled={busy} className="block text-xs text-gold-400" onClick={() => void save(true)}>Retry original save</button>}
    {(query.data?.history?.length ?? 0) > 1 && <details className="text-xs text-gray-400"><summary className="cursor-pointer">Funding history</summary><div className="mt-2 space-y-2">{query.data?.history?.map((h) => <p key={h.id}>{h.potName} · {h.selectedBy} · {new Date(h.selectedAt).toLocaleString('en-MY')}{h.reason && <span className="block text-gray-500">{h.reason}</span>}</p>)}</div></details>}
  </section>;
}
