import { useMemo, useState } from 'react';
import { ArrowUpCircle, Clock, Car as CarIcon } from 'lucide-react';
import { useStore } from '../store';
import Modal from '../components/Modal';
import InvestorMoneyDocuments from '../components/InvestorMoneyDocuments';
import InvestorFinanceCar, { ActionErrorBox, CarCard, Field, LoadState, PendingSaves, Section } from '../components/InvestorFinanceCar';
import {
  earnedProfit, entryLabel, formatCents, formatDay, investorRequest, isInStock, parseRinggit, useInvestorAction, useInvestorQuery,
  WITHDRAWAL_LABEL, type InvestorSnapshot,
} from '../lib/investorFinance';

export default function InvestorAccountPortal() {
  const actorId = useStore((s) => s.currentUser?.id);
  const query = useInvestorQuery<InvestorSnapshot>(actorId ?? null, () => investorRequest<InvestorSnapshot>('snapshot', {}));
  const act = useInvestorAction(actorId);
  const [tab, setTab] = useState<'stock' | 'sold'>('stock');
  const [openCar, setOpenCar] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const snap = query.data;

  const { stock, sold, earned } = useMemo(() => {
    const cars = snap?.cars ?? [];
    return {
      stock: cars.filter(isInStock),
      sold: cars.filter((c) => !isInStock(c)),
      earned: cars.reduce((sum, c) => sum + (earnedProfit(c) ?? 0), 0),
    };
  }, [snap]);

  if (!actorId) return null;
  const potId = snap?.position.potId;
  const available = snap?.position.availableCents ?? 0;
  const openWithdrawal = snap?.withdrawals.find((w) => w.state === 'requested' || w.state === 'approved');
  const cents = parseRinggit(amount);
  const tooMuch = cents !== null && cents > available;
  const slot = `withdraw:${potId ?? 'own'}`;

  const submitWithdrawal = async () => {
    if (!cents || tooMuch || !potId) return;
    const done = await act.run(slot, 'request_withdrawal', { potId, amountCents: cents }, `Withdrawal request ${formatCents(cents)}`);
    if (done) { setWithdrawOpen(false); setAmount(''); await query.reload(); }
  };
  const retryWithdrawal = async (s: string) => { if (await act.retry(s)) { setWithdrawOpen(false); setAmount(''); await query.reload(); } };

  if (openCar) return (
    <div className="max-w-2xl mx-auto">
      <InvestorFinanceCar carId={openCar} actorId={actorId} mode="investor" onClose={() => setOpenCar(null)} />
    </div>
  );

  const list = tab === 'stock' ? stock : sold;
  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="font-display text-white font-bold text-xl">My Investment</h1>
        <p className="text-gray-500 text-sm mt-0.5">AutoDream{snap ? ` · ${snap.profile.name}` : ''}</p>
      </div>

      <LoadState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
        {snap && (
          <>
            <div className="bg-gradient-to-br from-obsidian-800/80 to-obsidian-900/60 border border-gold-500/25 rounded-2xl p-5 sm:p-6 space-y-5">
              <div>
                <p className="text-gold-300 text-xs font-semibold uppercase tracking-wider">Available balance</p>
                <p className="text-white font-display font-bold text-4xl sm:text-5xl mt-2 tracking-tight">{formatCents(available)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-obsidian-800/60 rounded-xl p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">Cars in stock</p>
                  <p className="text-white font-bold text-xl mt-1">{stock.length}</p>
                </div>
                <div className="bg-obsidian-800/60 rounded-xl p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">Profit earned</p>
                  <p className={`font-bold text-xl mt-1 ${earned >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCents(earned)}</p>
                </div>
              </div>
              {openWithdrawal ? (
                <div className="flex items-center justify-between gap-3 bg-obsidian-800/60 border border-amber-500/20 rounded-xl px-4 py-3">
                  <span className="flex items-center gap-2 text-amber-300 text-xs"><Clock size={14} /> {WITHDRAWAL_LABEL[openWithdrawal.state]}</span>
                  <span className="text-white font-semibold text-sm">{formatCents(openWithdrawal.amountCents)}</span>
                </div>
              ) : (
                <button type="button" disabled={available <= 0} onClick={() => setWithdrawOpen(true)} className="btn-gold w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40">
                  <ArrowUpCircle size={16} /> Withdraw
                </button>
              )}
              <PendingSaves pending={act.pending} busy={act.busy} onRetry={(s) => void retryWithdrawal(s)} onDiscard={act.discard} />
            </div>

            <div className="flex gap-2">
              {([['stock', `In stock (${stock.length})`], ['sold', `Sold (${sold.length})`]] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setTab(key)} className={`px-4 py-2 rounded-full text-xs font-semibold border transition-colors ${tab === key ? 'bg-gold-500/15 text-gold-300 border-gold-500/40' : 'text-gray-400 border-obsidian-400/60'}`}>{label}</button>
              ))}
            </div>
            {list.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 bg-card-gradient border border-obsidian-400/70 rounded-xl">
                <CarIcon size={32} className="text-gray-600 mb-2" />
                <p className="text-gray-500 text-sm">{tab === 'stock' ? 'No cars in stock right now' : 'No sold cars yet'}</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">{list.map((car) => <CarCard key={car.carId} car={car} onOpen={() => setOpenCar(car.carId)} />)}</div>
            )}

            <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl overflow-hidden">
              <Section title="Withdrawals" hint={`${snap.withdrawals.length}`}>
                {snap.withdrawals.length === 0 ? <p className="text-gray-500 text-xs">No withdrawals yet.</p> : snap.withdrawals.map((w) => (
                  <div key={w.id} className="flex justify-between gap-3 text-xs">
                    <div className="text-gray-300">{WITHDRAWAL_LABEL[w.state]} <span className="text-gray-600">· {formatDay(w.requestedAt)}</span>{w.note && <span className="block text-gray-500">{w.note}</span>}{snap.withdrawalDestinations?.filter(d=>d.withdrawalId===w.id).map(d=><span key={d.destinationId} className="block text-gray-400">{d.bankName} · account ending {d.accountNumber.slice(-4)} · {d.accountHolder}</span>)}{w.state === 'paid' && <InvestorMoneyDocuments source={{ target: 'withdrawal', withdrawalId: w.id }} amountCents={w.amountCents} />}</div>
                    <span className="text-white font-medium shrink-0">{formatCents(w.amountCents)}</span>
                  </div>
                ))}
              </Section>
              <Section title="Money history" hint={`${snap.entries.length}`}>
                {snap.entries.length === 0 ? <p className="text-gray-500 text-xs">No money recorded yet.</p> : snap.entries.map((e) => (
                  <div key={e.id} className="flex justify-between gap-3 text-xs">
                    <span className="text-gray-300">{entryLabel(e.kind)} <span className="text-gray-600">· {formatDay(e.paidOn ?? e.recordedAt)}</span></span>
                    <span className={`font-medium shrink-0 ${e.amountCents >= 0 ? 'text-emerald-400' : 'text-gray-300'}`}>{e.amountCents >= 0 ? '+' : ''}{formatCents(e.amountCents)}</span>
                  </div>
                ))}
                <p className="text-gray-600 text-[10px] pt-1">Recorded by AutoDream staff from bank slips. Not automatically matched to a bank statement.</p>
              </Section>
            </div>
          </>
        )}
      </LoadState>

      <Modal isOpen={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="Request a withdrawal"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setWithdrawOpen(false)} className="btn-ghost px-4 py-2 rounded-lg text-sm">Cancel</button>
            <button type="button" onClick={() => void submitWithdrawal()} disabled={!cents || tooMuch || act.busy !== null || act.pending.some((p) => p.slot === slot)} className="btn-gold px-4 py-2 rounded-lg text-sm disabled:opacity-40">{act.busy === slot ? 'Sending…' : 'Send request'}</button>
          </div>
        }>
        <div className="space-y-3">
          <p className="text-gray-400 text-xs">Available: <span className="text-white font-semibold">{formatCents(available)}</span></p>
          <Field label="Amount (RM)">
            <input inputMode="decimal" autoFocus className="input w-full px-3 py-2.5 rounded-lg text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          {tooMuch && <p className="text-red-400 text-[11px]">More than your available balance.</p>}
          <p className="text-gray-500 text-[11px]">The Director reviews every request. Nothing is transferred from this screen — you will see it here once the company records the payment.</p>
          <ActionErrorBox error={act.error} slot={slot} onRetry={() => void retryWithdrawal(slot)} onDismiss={act.clearError} />
        </div>
      </Modal>
    </div>
  );
}
