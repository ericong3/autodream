import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, Landmark, Lock, Link2, X } from 'lucide-react';
import { useStore } from '../store';
import Modal from '../components/Modal';
import DealerAccountView from '../components/DealerAccountView';
import { ActionErrorBox, CashConfirm, Field, LoadState, PendingSaves, type PendingConfirm } from '../components/InvestorFinanceCar';
import { formatCents, formatDay, malaysiaToday, parseRinggit, useInvestorAction, useInvestorQuery } from '../lib/investorFinance';
import { carLabel, DEALER_SCOPE, dealerRequest, planLock, type DealerConversion, type DealerList, type DealerView } from '../lib/dealerAccounts';

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
  const [undo, setUndo] = useState<DealerConversion | null>(null);
  const [reason, setReason] = useState('');
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
            {view.investor && <InvestmentDraft key={view.draft?.updatedAt ?? 'none'} view={view} busy={act.busy} setConfirm={setConfirm} run={run}
              errorFor={(slot) => <ActionErrorBox error={act.error} slot={slot} onRetry={() => void retry(slot)} onDismiss={act.clearError} />} />}
            {view.totals.needsPreparingCount > 0 && <PreparePayouts view={view} busy={act.busy} setConfirm={setConfirm}
              onPrepare={() => run('dealer-prepare:' + dealerId, 'prepare_payouts', {}, `Prepare ${view.dealer!.name} payouts for bank payment`)} error={<ActionErrorBox error={act.error} slot={'dealer-prepare:' + dealerId} onRetry={() => void retry('dealer-prepare:' + dealerId)} onDismiss={act.clearError} />} />}
            <DealerAccountView view={view} audience="director" onUndo={(lock) => { setUndo(lock); setReason(''); }} />
          </>
        )}
      </LoadState>
      <CashConfirm confirm={confirm} onClose={() => setConfirm(null)} />
      <Modal isOpen={!!undo} onClose={() => setUndo(null)} title="Undo this lock?"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setUndo(null)} className="btn-ghost px-4 py-2 rounded-lg text-sm">Cancel</button>
            <button type="button" disabled={!undo || reason.trim().length < 5 || act.busy !== null} className="btn-gold px-4 py-2 rounded-lg text-sm disabled:opacity-40"
              onClick={async () => { if (!undo) return; const slot = 'dealer-undo:' + undo.id; if (await run(slot, 'undo_lock', { conversionId: undo.id, reason: reason.trim() }, `Undo ${formatCents(undo.amountCents)} lock · ${view?.dealer?.name ?? ''}`)) setUndo(null); }}>
              {act.busy?.startsWith('dealer-undo:') ? 'Undoing…' : 'Undo lock'}
            </button>
          </div>
        }>
        {undo && (
          <div className="space-y-3">
            <p className="text-gray-300 text-sm">{formatCents(undo.amountCents)} from {formatDay(undo.convertedOn)} stops being {view?.investor?.name ?? 'the investor'}'s investment. Those payouts are owed to {view?.dealer?.name} again and their costs can be changed. A reversing entry is posted in the accounts and the undo is kept in the history.</p>
            <p className="text-amber-300 text-xs">If an agreement for this lock was already signed, it no longer applies.</p>
            <Field label="Reason"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: locked before the costs were final" /></Field>
            <ActionErrorBox error={act.error} slot={'dealer-undo:' + undo.id} onRetry={() => void retry('dealer-undo:' + undo.id)} onDismiss={act.clearError} />
          </div>
        )}
      </Modal>
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

// Investment from payouts in three steps. 1. Confirm each car's costs (only
// confirmed payouts can be locked; you can untick until locked). 2. Build a
// draft: a target and confirmed cars in order; nothing is posted. 3. Lock:
// cars are used in order, the last one may be split, the rest stays a payout.
type Run = (slot: string, action: string, data: Record<string, unknown>, label: string) => Promise<unknown>;
function InvestmentDraft({ view, busy, setConfirm, run, errorFor }: { view: DealerView; busy: string | null; setConfirm: (c: PendingConfirm) => void; run: Run; errorFor: (slot: string) => JSX.Element }) {
  const dealerName = view.dealer!.name, investorName = view.investor!.name;
  const saved = view.draft ?? null;
  const [target, setTarget] = useState(saved ? (saved.targetCents / 100).toFixed(2) : '500000.00');
  const [ids, setIds] = useState<string[]>(saved?.paymentIds ?? []);
  const [day, setDay] = useState(malaysiaToday());
  const [note, setNote] = useState('');
  const cars = useMemo(() => new Map(view.cars.map((c) => [c.carId, c])), [view.cars]);
  const open = view.payouts.filter((p) => !p.replaced && p.status === 'pending' && p.balanceCents > 0);
  const byId = new Map(open.map((p) => [p.paymentId, p]));
  const chosen = ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  const targetCents = parseRinggit(target);
  const plan = planLock(targetCents ?? 0, chosen);
  const dirty = !saved || saved.targetCents !== targetCents || saved.paymentIds.join() !== ids.join();
  const label = (carId: string | null) => carLabel(carId ? cars.get(carId) : undefined);
  const slotDraft = 'dealer-draft:' + view.dealer!.id, slotLock = 'dealer-lock:' + view.dealer!.id;
  const canLock = !!saved && !dirty && !!targetCents && plan.shortCents === 0 && /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= malaysiaToday() && note.trim().length >= 5;
  const move = (i: number, d: -1 | 1) => setIds((list) => { const next = [...list]; [next[i], next[i + d]] = [next[i + d], next[i]]; return next; });

  return (
    <div className="bg-card-gradient border border-gold-500/25 rounded-xl p-4 space-y-4">
      <div>
        <p className="text-white text-sm font-semibold flex items-center gap-1.5"><Lock size={14} /> Keep payouts as {investorName}'s investment</p>
        <p className="text-gray-500 text-xs mt-1">1. Confirm each car's costs when final. 2. Add confirmed cars to the draft until it reaches the target. 3. Lock and print the agreement. Until you lock, nothing is recorded and you can change everything.</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-gray-400 text-[11px] uppercase tracking-wider">Unpaid payouts ({open.length})</p>
        {open.length === 0 ? <p className="text-gray-500 text-xs">No unpaid payouts.</p> : open.map((p) => {
          const inDraft = ids.includes(p.paymentId), slot = 'dealer-costs:' + p.paymentId;
          return (
            <div key={p.paymentId} className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-white/5 pb-1.5">
              <div className="min-w-0">
                <p className="text-gray-200 truncate">{label(p.carId)}</p>
                <p className="text-gray-500">Payout {formatCents(p.amountCents)}{p.balanceCents !== p.amountCents ? ` · ${formatCents(p.balanceCents)} unpaid` : ''}
                  {p.costsConfirmed ? <span className="text-emerald-400"> · {p.confirmedVia === 'case' ? 'Approved in consignment review' : 'Costs confirmed'}</span> : <span className="text-amber-300"> · Costs not confirmed</span>}</p>
                {errorFor(slot)}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!p.costsConfirmed && <button type="button" disabled={busy !== null} className="btn-ghost px-2.5 py-1 rounded-lg text-[11px] flex items-center gap-1 disabled:opacity-40"
                  onClick={() => setConfirm({ title: 'Costs confirmed?', label: 'Costs confirmed', message: `${label(p.carId)}: all costs are recorded and the payout of ${formatCents(p.amountCents)} is final. You can untick this until the car is locked. If the payout changes, it needs confirming again.`, go: () => void run(slot, 'confirm_costs', { paymentId: p.paymentId }, `Costs confirmed · ${label(p.carId)}`) })}>
                  <CheckCircle2 size={12} /> Costs confirmed</button>}
                {p.costsConfirmed && p.confirmedVia === 'director' && p.convertedCents === 0 && <button type="button" disabled={busy !== null} className="text-gray-500 text-[11px] underline disabled:opacity-40"
                  onClick={() => void run(slot, 'unconfirm_costs', { paymentId: p.paymentId }, `Untick costs · ${label(p.carId)}`)}>Untick</button>}
                {p.costsConfirmed && (inDraft
                  ? <span className="text-gold-300 text-[11px]">In draft</span>
                  : <button type="button" className="btn-gold px-2.5 py-1 rounded-lg text-[11px]" onClick={() => setIds((list) => [...list, p.paymentId])}>Add to draft</button>)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-black/20 rounded-lg p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48"><Field label="Investment target (RM)"><input inputMode="decimal" className="input w-full px-3 py-2 rounded-lg text-sm" value={target} onChange={(e) => setTarget(e.target.value)} /></Field></div>
          <p className="text-xs pb-2">{plan.shortCents > 0 ? <span className="text-amber-300">{formatCents(plan.shortCents)} short of the target: add more cars.</span> : targetCents ? <span className="text-emerald-400">Target reached.</span> : null}</p>
        </div>
        {chosen.length === 0 ? <p className="text-gray-500 text-xs">Draft is empty. Add confirmed cars above.</p> : (
          <div className="space-y-1">
            {plan.rows.map((r, i) => (
              <div key={r.payout.paymentId} className={`flex items-center justify-between gap-2 text-xs ${r.investCents === 0 ? 'opacity-50' : ''}`}>
                <span className="text-gray-300 min-w-0 truncate">{i + 1}. {label(r.payout.carId)}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-gold-300">{formatCents(r.investCents)}</span>
                  {r.cashCents > 0 && <span className="text-gray-500">{r.investCents === 0 ? 'not needed' : `+ ${formatCents(r.cashCents)} paid to ${dealerName}`}</span>}
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="text-gray-500 disabled:opacity-20"><ArrowUp size={12} /></button>
                  <button type="button" aria-label="Move down" disabled={i === chosen.length - 1} onClick={() => move(i, 1)} className="text-gray-500 disabled:opacity-20"><ArrowDown size={12} /></button>
                  <button type="button" aria-label="Remove" onClick={() => setIds((list) => list.filter((x) => x !== r.payout.paymentId))} className="text-gray-500"><X size={12} /></button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!dirty || !targetCents || busy !== null} className="btn-ghost text-xs px-4 py-2 rounded-lg disabled:opacity-40"
            onClick={() => targetCents && void run(slotDraft, 'save_draft', { targetCents, paymentIds: chosen.map((p) => p.paymentId) }, `Save investment draft · ${dealerName}`)}>
            {busy === slotDraft ? 'Saving…' : 'Save draft'}</button>
          {dirty ? <span className="text-amber-300 text-[11px]">Unsaved changes</span> : saved && <span className="text-gray-500 text-[11px]">Draft saved {formatDay(saved.updatedAt)}</span>}
        </div>
        {errorFor(slotDraft)}
      </div>

      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault(); if (!canLock || !targetCents) return;
        const used = plan.rows.filter((r) => r.investCents > 0), split = used.find((r) => r.cashCents > 0);
        setConfirm({ title: 'Lock as investment?', label: 'Lock as investment',
          message: `${formatCents(targetCents)} from ${used.length} car payout${used.length === 1 ? '' : 's'} becomes ${investorName}'s investment, dated ${formatDay(day)}.${split ? ` ${label(split.payout.carId)} is split: ${formatCents(split.investCents)} invested, ${formatCents(split.cashCents)} still paid to ${dealerName}.` : ''} No bank transfer is recorded. These payouts are then fixed. Print the agreement afterwards for signing.`,
          go: async () => { if (await run(slotLock, 'lock_draft', { convertedOn: day, note: note.trim() }, `Lock ${formatCents(targetCents)} as investment · ${dealerName}`)) setNote(''); } });
      }}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Agreement date"><input type="date" max={malaysiaToday()} className="input w-full px-3 py-2 rounded-lg text-sm" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label="Agreement note" hint="For example: first investment RM500k agreed with Ting"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <button type="submit" disabled={!canLock || busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40">{busy === slotLock ? 'Locking…' : 'Review lock'}</button>
        {dirty && chosen.length > 0 && <p className="text-gray-500 text-[11px]">Save the draft before locking.</p>}
        {errorFor(slotLock)}
      </form>
    </div>
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
