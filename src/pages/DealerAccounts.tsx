import { useState } from 'react';
import { ChevronLeft, Landmark, Lock, Link2 } from 'lucide-react';
import { useStore } from '../store';
import DealerAccountView from '../components/DealerAccountView';
import { ActionErrorBox, CashConfirm, Field, LoadState, PendingSaves, type PendingConfirm } from '../components/InvestorFinanceCar';
import { formatCents, formatDay, malaysiaToday, parseRinggit, useInvestorAction, useInvestorQuery } from '../lib/investorFinance';
import { DEALER_SCOPE, dealerRequest, type DealerList, type DealerView } from '../lib/dealerAccounts';

// Director only (route guarded). Dealers, their linked investor and investment locks.
export default function DealerAccounts() {
  const user = useStore((s) => s.currentUser);
  const actorId = user?.id ?? '';
  const list = useInvestorQuery<DealerList>(actorId ? actorId + ':dealers' : null, () => dealerRequest<DealerList>('list'));
  const [dealerId, setDealerId] = useState<string | null>(null);
  if (!user) return null;
  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {dealerId ? <Dealer key={dealerId} actorId={actorId} dealerId={dealerId} investors={list.data?.investors ?? []} onBack={() => { setDealerId(null); void list.reload(); }} /> : (
        <>
          <div>
            <h1 className="font-display text-white font-bold text-xl">Dealer accounts</h1>
            <p className="text-gray-500 text-sm mt-0.5">Consignment dealers, what you owe them, and payouts kept as investment.</p>
          </div>
          <LoadState loading={list.loading} error={list.error} onRetry={() => void list.reload()}>
            {list.data && (list.data.dealers.length === 0 ? <p className="text-gray-500 text-sm text-center py-8">No dealers yet.</p> : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.data.dealers.map((d) => (
                  <button key={d.id} type="button" onClick={() => setDealerId(d.id)} className="text-left bg-card-gradient border border-obsidian-400/70 rounded-xl p-4 hover:border-gold-500/40 transition-colors">
                    <p className="text-white font-semibold text-sm">{d.name}</p>
                    <p className="text-gray-500 text-xs mt-1">{d.cars} consignment car{d.cars === 1 ? '' : 's'}</p>
                    <p className={`text-[11px] mt-2 ${d.investorName ? 'text-gold-300' : 'text-gray-600'}`}>{d.investorName ? `Investor: ${d.investorName}` : 'No investor linked'}</p>
                  </button>
                ))}
              </div>
            ))}
          </LoadState>
        </>
      )}
    </div>
  );
}

function Dealer({ actorId, dealerId, investors, onBack }: { actorId: string; dealerId: string; investors: DealerList['investors']; onBack: () => void }) {
  const query = useInvestorQuery<DealerView>(`${actorId}:dealer:${dealerId}`, () => dealerRequest<DealerView>('view', { dealerId }));
  const act = useInvestorAction(actorId);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const run = async (slot: string, action: string, data: Record<string, unknown>, label: string) => {
    const r = await act.run<DealerView>(slot, action, { ...DEALER_SCOPE, dealerId, ...data }, label);
    if (r) await query.reload();
    return r;
  };
  const retry = async (slot: string) => { if (await act.retry(slot)) await query.reload(); };
  const view = query.data;
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-gray-400 text-xs flex items-center gap-1"><ChevronLeft size={14} /> All dealers</button>
      <PendingSaves pending={act.pending} busy={act.busy} onRetry={(s) => void retry(s)} onDiscard={act.discard} />
      <LoadState loading={query.loading && !view} error={query.error} onRetry={() => void query.reload()}>
        {view?.dealer && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h1 className="font-display text-white font-bold text-xl">{view.dealer.name}</h1>
                <p className="text-gray-500 text-xs">{view.dealer.bankName ? `${view.dealer.bankName} · ${view.dealer.accountHolder ?? ''} · account ending ${view.dealer.accountEnding}` : 'No bank details saved'}</p>
              </div>
              <p className={`text-xs ${view.investor ? 'text-gold-300' : 'text-gray-500'}`}>{view.investor ? `Investor account: ${view.investor.name}` : 'No investor account linked'}</p>
            </div>
            {!view.investor && <LinkInvestor investors={investors.filter((i) => !i.linkedDealerId)} dealerName={view.dealer.name} busy={act.busy} setConfirm={setConfirm}
              onLink={(potId, name) => run('dealer-link:' + dealerId, 'link', { potId }, `Link ${view.dealer!.name} to ${name}`)} error={<ActionErrorBox error={act.error} slot={'dealer-link:' + dealerId} onRetry={() => void retry('dealer-link:' + dealerId)} onDismiss={act.clearError} />} />}
            {view.investor && <LockInvestment view={view} busy={act.busy} setConfirm={setConfirm}
              onLock={(data) => run('dealer-lock:' + dealerId, 'convert', data, `Lock ${formatCents(data.amountCents)} as investment · ${view.dealer!.name}`)} error={<ActionErrorBox error={act.error} slot={'dealer-lock:' + dealerId} onRetry={() => void retry('dealer-lock:' + dealerId)} onDismiss={act.clearError} />} />}
            {view.totals.needsPreparingCount > 0 && <PreparePayouts view={view} busy={act.busy} setConfirm={setConfirm}
              onPrepare={() => run('dealer-prepare:' + dealerId, 'prepare_payouts', {}, `Prepare ${view.dealer!.name} payouts for bank payment`)} error={<ActionErrorBox error={act.error} slot={'dealer-prepare:' + dealerId} onRetry={() => void retry('dealer-prepare:' + dealerId)} onDismiss={act.clearError} />} />}
            <DealerAccountView view={view} audience="director" />
          </>
        )}
      </LoadState>
      <CashConfirm confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function LinkInvestor({ investors, dealerName, busy, setConfirm, onLink, error }: { investors: DealerList['investors']; dealerName: string; busy: string | null; setConfirm: (c: PendingConfirm) => void; onLink: (potId: string, name: string) => Promise<unknown>; error: JSX.Element }) {
  const [potId, setPotId] = useState('');
  const chosen = investors.find((i) => i.potId === potId);
  return (
    <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl p-4 space-y-2">
      <p className="text-white text-sm font-semibold flex items-center gap-1.5"><Link2 size={14} /> Link to an investor account</p>
      <p className="text-gray-500 text-xs">The investor can then see this dealer's cars and payouts, and you can keep payouts as investment.</p>
      {investors.length === 0 ? <p className="text-amber-300 text-xs">Create the investor account in Investor accounts first.</p> : (
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]"><Field label="Investor account"><select className="input w-full px-3 py-2 rounded-lg text-sm" value={potId} onChange={(e) => setPotId(e.target.value)}><option value="">Choose…</option>{investors.map((i) => <option key={i.potId} value={i.potId}>{i.name}</option>)}</select></Field></div>
          <button type="button" disabled={!chosen || busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40"
            onClick={() => chosen && setConfirm({ title: 'Link investor account?', label: 'Link account', message: `${dealerName} will be linked to ${chosen.name}. This link is permanent.`, go: () => void onLink(chosen.potId, chosen.name) })}>Link</button>
        </div>
      )}
      {error}
    </div>
  );
}

function LockInvestment({ view, busy, setConfirm, onLock, error }: { view: DealerView; busy: string | null; setConfirm: (c: PendingConfirm) => void; onLock: (d: { amountCents: number; convertedOn: string; note: string }) => Promise<unknown>; error: JSX.Element }) {
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(malaysiaToday());
  const [note, setNote] = useState('');
  const cents = parseRinggit(amount);
  const owed = view.totals.owedCents;
  const tooMuch = !!cents && cents > owed;
  const ok = !!cents && !tooMuch && /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= malaysiaToday() && note.trim().length >= 5;
  return (
    <form className="bg-card-gradient border border-gold-500/25 rounded-xl p-4 space-y-3" onSubmit={(e) => {
      e.preventDefault(); if (!ok || !cents) return;
      setConfirm({ title: 'Lock as investment?', label: 'Lock as investment',
        message: `${formatCents(cents)} of the unpaid payouts to ${view.dealer!.name} becomes ${view.investor!.name}'s investment, dated ${formatDay(day)}. No bank transfer is recorded. Oldest payouts are settled first. This cannot be edited afterwards.`,
        go: async () => { if (await onLock({ amountCents: cents, convertedOn: day, note: note.trim() })) { setAmount(''); setNote(''); } } });
    }}>
      <p className="text-white text-sm font-semibold flex items-center gap-1.5"><Lock size={14} /> Lock as investment</p>
      <p className="text-gray-500 text-xs">Unpaid payouts available to lock: <span className="text-white">{formatCents(owed)}</span>. You can lock more later.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Amount (RM)"><input inputMode="decimal" className="input w-full px-3 py-2 rounded-lg text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
        <Field label="Agreement date"><input type="date" max={malaysiaToday()} className="input w-full px-3 py-2 rounded-lg text-sm" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
      </div>
      <Field label="Agreement note" hint="For example: signed agreement with the investor, date and reference"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {tooMuch && <p className="text-red-400 text-[11px]">That is more than the {formatCents(owed)} still unpaid. Update the disbursements and payouts first.</p>}
      <button type="submit" disabled={!ok || busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40">{busy?.startsWith('dealer-lock:') ? 'Saving…' : 'Review lock'}</button>
      {error}
    </form>
  );
}

// Older payouts were never recorded in the books, so the bank payment screen
// refuses them until they are recorded as bills here (once per payout).
function PreparePayouts({ view, busy, setConfirm, onPrepare, error }: { view: DealerView; busy: string | null; setConfirm: (c: PendingConfirm) => void; onPrepare: () => Promise<unknown>; error: JSX.Element }) {
  const { needsPreparingCount: count, needsPreparingCents: cents } = view.totals;
  return (
    <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl p-4 space-y-2">
      <p className="text-white text-sm font-semibold flex items-center gap-1.5"><Landmark size={14} /> Prepare older payouts for bank payment</p>
      <p className="text-gray-500 text-xs">{count} unpaid payout{count === 1 ? '' : 's'} ({formatCents(cents)}) were made before the reviewed consignment workflow, so the bank payment screen cannot pay {count === 1 ? 'it' : 'them'} yet. Preparing records each unpaid balance as a bill. No money moves, and you can still lock {count === 1 ? 'it' : 'them'} as investment.</p>
      <button type="button" disabled={busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40"
        onClick={() => setConfirm({ title: 'Prepare payouts for bank payment?', label: 'Prepare payouts', message: `${count} unpaid payout${count === 1 ? '' : 's'} to ${view.dealer!.name} (${formatCents(cents)}) will be recorded as bills you can pay from Payments. Their amounts are then fixed. No bank transfer is recorded.`, go: () => void onPrepare() })}>
        {busy?.startsWith('dealer-prepare:') ? 'Preparing…' : 'Prepare for bank payment'}
      </button>
      {error}
    </div>
  );
}
