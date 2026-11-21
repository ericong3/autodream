import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Car as CarIcon, Check, ChevronRight, FileText } from 'lucide-react';
import type { Car, Payment } from '../types';
import { useStore } from '../store';
import { thumbUrl } from '../utils/photoUrl';
import { formatCents, useInvestorQuery } from '../lib/investorFinance';
import { paymentBalanceCents } from '../lib/companyBankPayments';
import { moneyRequest, type MoneyEntry } from '../lib/moneyReceived';
import { loadCarCases, type CarCase } from '../lib/docTodo';
import { RecordMoney } from './MoneyReceivedPanel';
import CompanyBankPaymentDialog from './CompanyBankPaymentDialog';
import CompanyPaymentDocuments from './CompanyPaymentDocuments';

export type ProfitRow = { label: string; amount: number };
type StageId = 'sold' | 'money' | 'bills' | 'dealer' | 'paper' | 'closed';
const INBOUND = new Set(['customer_collection', 'loan_disbursement', 'consignment_collection', 'supplier_credit_collection']);
const IN_LABEL: Record<string, string> = { customer_collection: 'Customer', loan_disbursement: 'Bank loan', consignment_collection: 'From dealer', supplier_credit_collection: 'Supplier credit' };
const NAMES: Record<StageId, string> = { sold: 'Sold', money: 'Money in', bills: 'Bills paid', dealer: 'Dealer approved', paper: 'Paperwork', closed: 'Closed' };
const words = (t: string) => t.split('_').join(' ');
const cents = (rm: number) => Math.round(rm * 100);

/**
 * Sold car page: car card, then a guide that walks the case stage by stage
 * (Sold → Money in → Bills paid → Dealer → Paperwork → Closed). Any stage can
 * be opened at any time; each one ends with a button to the next.
 */
export default function CarSummary({ car, actorId, role, profit, costs, buyerName, salespersonName, detailsOpen, onOpenDetails, onOpenMedia, onEditDeal, onAddRepair, onAddMisc }: {
  car: Car; actorId: string; role: string; profit: number | null; costs: ProfitRow[];
  buyerName?: string; salespersonName?: string; detailsOpen: boolean;
  onOpenDetails: (section?: string) => void; onOpenMedia: (tab: 'photos' | 'card') => void;
  onEditDeal?: () => void; onAddRepair?: () => void; onAddMisc?: () => void;
}) {
  const director = role === 'director';
  const cases = useInvestorQuery(`car-cases:${actorId}`, loadCarCases);
  const money = useInvestorQuery<{ entries: MoneyEntry[] }>(`money-received:${actorId}:${car.id}`, () => moneyRequest('list', { carId: car.id }));
  const payments = useStore((s) => s.payments);
  const [view, setView] = useState<StageId | null>(null);
  const [recording, setRecording] = useState<{ amountCents?: number; note?: string } | null>(null);
  const [paying, setPaying] = useState<Payment | null>(null);
  const [docs, setDocs] = useState<string | null>(null);
  const reload = () => { void money.reload(); void cases.reload(); };

  const c: CarCase | undefined = cases.data?.cars[car.id];
  const mine = payments.filter((p) => p.carId === car.id && !p.obligationReplaced && (p.status === 'pending' || p.status === 'transferred'));
  const entries = money.data?.entries ?? [];
  const consignmentIn = !!car.consignment && !car.outgoingConsignment;
  const paperwork = c ? c.missingDocs + c.moneyNoSlip + c.sentBack + (c.agreementMissing ? 1 : 0) : 0;
  const todoLink = director ? '/dashboard' : role === 'admin' ? '/admin-dashboard?tab=paperwork' : null;
  const photoCount = car.photos?.length || (car.photo ? 1 : 0);
  const soldFor = profit === null ? null : profit + costs.reduce((s, r) => s + r.amount, 0);

  // Money in: money recorded under "Money received" covers the expected payments in order.
  let unallocated = entries.filter((e) => e.state === 'to_match').reduce((s, e) => s + e.amountCents, 0);
  const moneyItems = mine.filter((p) => INBOUND.has(p.type)).map((p) => {
    const left = paymentBalanceCents(p);
    const covered = left === 0 || unallocated >= left;
    if (left > 0 && covered) unallocated -= left;
    return { p, left, covered };
  });
  const expectedCents = moneyItems.reduce((s, m) => s + cents(m.p.amount), 0);
  const bills = mine.filter((p) => !INBOUND.has(p.type));
  const unpaid = bills.filter((p) => p.status === 'pending' && paymentBalanceCents(p) > 0).sort((a, b) => b.amount - a.amount);
  const paidCount = bills.length - unpaid.length;

  const stages: { id: StageId; done: boolean }[] = c ? [
    { id: 'sold', done: true },
    { id: 'money', done: c.toCollectCents === 0 },
    { id: 'bills', done: c.toPay === 0 },
    ...(consignmentIn ? [{ id: 'dealer' as const, done: !c.dealerNotApproved }] : []),
    { id: 'paper', done: paperwork === 0 },
    { id: 'closed', done: c.state === 'closed' },
  ] : [];
  const firstOpen = stages.findIndex((s) => !s.done);
  const currentIndex = firstOpen === -1 ? stages.length - 1 : firstOpen;
  const current = stages[currentIndex]?.id ?? 'sold';
  const shown: StageId = view && stages.some((s) => s.id === view) ? view : current;
  const shownIndex = stages.findIndex((s) => s.id === shown);
  const shownDone = stages[shownIndex]?.done ?? false;
  const nextStage = stages[shownIndex + 1];
  const when = shownIndex < currentIndex ? 'Done' : shownIndex === currentIndex ? 'Now' : 'Later';

  const copy: Record<StageId, [string, string]> = {
    sold: ['The car is sold', 'Buyer, price and salesperson.'],
    money: [c && c.toCollectCents > 0 ? `Collect ${formatCents(c.toCollectCents)}` : 'All money is in', 'Mark each payment when it reaches the bank. Add the bank slip if you have it.'],
    bills: [unpaid.length ? `Pay the car’s bills · ${formatCents(unpaid.reduce((s, p) => s + paymentBalanceCents(p), 0))} left` : 'All bills are paid', 'Add, pay or fix any bill for this car, at any time.'],
    dealer: [c?.dealerNotApproved ? 'Approve what the dealer receives' : 'Dealer amount approved', 'Check the bills are right, then approve the dealer amount.'],
    paper: [paperwork ? `Finish the paperwork · ${paperwork} open` : 'Paperwork complete', 'Missing invoices, slips and the agreement are handled in the to-do list.'],
    closed: [c?.state === 'closed' ? 'Case closed' : 'Not closed yet', 'The case closes by itself once every stage before it is done.'],
  };

  const card = 'rounded-2xl border border-white/[0.08] bg-[#15151A]';
  const row = 'rounded-xl border border-white/[0.07] bg-[#15151A] px-4 py-3';
  const goldBtn = 'btn-gold rounded-xl px-4 min-h-[44px] text-sm font-bold inline-flex items-center justify-center';
  const ghostBtn = 'rounded-xl px-3 min-h-[40px] text-sm border border-white/10 text-gray-200 hover:text-white inline-flex items-center justify-center';
  const tick = (on: boolean) => <span aria-hidden="true" className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${on ? 'bg-emerald-400 text-emerald-950' : 'border-2 border-white/20'}`}>{on && <Check size={15} strokeWidth={3} />}</span>;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4 min-w-0 lg:order-1 order-2">
          {stages.length > 0 && <nav aria-label="Case stages" className={`${card} p-4`}>
            <p className="text-xs text-gray-400 mb-2.5">Where this car is · tap a stage to see or edit it</p>
            <div className="flex gap-1.5 overflow-x-auto sm:grid sm:overflow-visible" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
              {stages.map((s, i) => {
                const now = i === currentIndex && !s.done, sel = s.id === shown;
                return <button key={s.id} type="button" onClick={() => setView(s.id)} aria-current={now ? 'step' : undefined}
                  className={`flex-shrink-0 min-w-[92px] sm:min-w-0 text-left rounded-xl p-2 space-y-1.5 border transition-colors ${sel ? 'bg-white/[0.06] border-white/15' : 'border-transparent hover:bg-white/[0.03]'}`}>
                  <span className={`block h-1.5 rounded-full ${s.done ? 'bg-emerald-400' : now ? 'bg-gold-400' : 'bg-white/10'}`} />
                  <span className={`block text-xs leading-tight ${now ? 'text-gold-300 font-semibold' : s.done ? 'text-emerald-300' : 'text-gray-300'}`}>{NAMES[s.id]}</span>
                  <span className="block text-[10px] text-gray-500">{s.done ? 'Done' : now ? 'Now' : 'Later'}</span>
                </button>;
              })}
            </div>
          </nav>}

          {c && <section aria-live="polite" className="rounded-2xl border border-[#5A4614] bg-[#1C1708] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-wider text-[#F3C969]">STAGE {shownIndex + 1} OF {stages.length} · {NAMES[shown].toUpperCase()} · {(shownDone ? 'Done' : when).toUpperCase()}</p>
                <h2 className="text-white text-xl font-semibold leading-snug mt-1">{copy[shown][0]}</h2>
                <p className="text-sm text-[#C9C3B3] mt-1">{copy[shown][1]}</p>
              </div>
              {shown === 'money' && moneyItems.length > 0 && <span className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full bg-[#2A2210] text-[#F3C969]">{moneyItems.filter((m) => m.covered).length} of {moneyItems.length} received</span>}
            </div>

            {shown === 'sold' && <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className={row}><p className="text-xs text-gray-400">Buyer</p><p className="text-sm text-white mt-0.5">{buyerName || '—'}</p></div>
                <div className={row}><p className="text-xs text-gray-400">Sold for</p><p className="text-sm text-white mt-0.5">{formatCents(cents(soldFor ?? car.sellingPrice))}</p></div>
                <div className={row}><p className="text-xs text-gray-400">Salesperson</p><p className="text-sm text-white mt-0.5">{salespersonName || '—'}</p></div>
              </div>
              {director && onEditDeal && <button type="button" className={ghostBtn} onClick={onEditDeal}>Edit deal</button>}
            </div>}

            {shown === 'money' && <div className="space-y-2">
              {moneyItems.length === 0 && entries.length === 0 && <p className="text-sm text-gray-300">No money is expected for this car.</p>}
              {moneyItems.map(({ p, left, covered }) => <div key={p.id} className={`${row} flex flex-wrap items-center gap-3`}>
                {tick(covered)}
                <div className="flex-1 min-w-[140px]"><p className="text-sm text-white truncate">{IN_LABEL[p.type] ?? words(p.type)}{p.recipientName ? ` · ${p.recipientName}` : ''}</p>
                  <p className="text-xs text-gray-400">{covered ? 'Received' : left < cents(p.amount) ? `${formatCents(left)} still to come` : 'Waiting'}</p></div>
                <p className="text-sm font-semibold text-white whitespace-nowrap">{formatCents(cents(p.amount))}</p>
                {director && !covered && <button type="button" className={goldBtn} onClick={() => setRecording({ amountCents: left, note: `${IN_LABEL[p.type] ?? words(p.type)}${p.recipientName ? ' · ' + p.recipientName : ''}` })}>Mark received</button>}
              </div>)}
              {entries.length > 0 && <div className="pt-1 space-y-1.5">
                <p className="text-xs text-gray-400">Recorded</p>
                {entries.map((e) => <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20 px-4 py-2.5">
                  <p className="text-sm text-white min-w-0 truncate">{new Date(e.receivedOn).toLocaleDateString('en-MY')} · {e.bankName}{e.note ? ` · ${e.note}` : ''}</p>
                  <span className="flex items-center gap-2 flex-shrink-0"><span className={`text-[11px] px-2 py-0.5 rounded-full ${e.hasSlip ? 'bg-emerald-900/70 text-emerald-200' : 'bg-[#3A2C0E] text-[#F3C969]'}`}>{e.hasSlip ? 'Slip ✓' : 'No slip'}</span><span className="text-sm font-semibold text-emerald-300">{formatCents(e.amountCents)}</span></span>
                </div>)}
              </div>}
              {director && <button type="button" className="text-sm text-gold-400 min-h-[40px]" onClick={() => setRecording({})}>+ Other money received</button>}
              {expectedCents > 0 && <p className="text-xs text-gray-500">Expected in total: {formatCents(expectedCents)}</p>}
            </div>}

            {shown === 'bills' && <div className="space-y-2">
              {unpaid.length === 0 && <p className="text-sm text-gray-300">No unpaid bills{paidCount ? ` · ${paidCount} paid` : ''}.</p>}
              {unpaid.map((p) => <div key={p.id} className={`${row} flex flex-wrap items-center gap-x-3 gap-y-2`}>
                <div className="flex-1 min-w-[140px]"><p className="text-sm text-white truncate">{p.recipientName || words(p.type)}</p><p className="text-xs text-gray-400 capitalize">{words(p.type)}</p></div>
                <p className="text-sm font-semibold text-white whitespace-nowrap">{formatCents(paymentBalanceCents(p))}</p>
                <span className="flex gap-2">
                  {(director || role === 'admin') && <button type="button" className={ghostBtn} onClick={() => setDocs(p.id)}>Invoice</button>}
                  {director && <button type="button" className={ghostBtn} onClick={() => onOpenDetails(consignmentIn ? 'consignment' : 'jobs')}>Edit</button>}
                  {director && <button type="button" className="btn-gold rounded-xl px-4 min-h-[40px] text-sm font-bold" onClick={() => setPaying(p)}>Pay</button>}
                </span>
              </div>)}
              {unpaid.length > 0 && paidCount > 0 && <p className="text-xs text-gray-500">{paidCount} bill{paidCount > 1 ? 's' : ''} already paid.</p>}
              {(director || role === 'admin') && (onAddMisc || onAddRepair) && <div className="flex flex-wrap gap-2 pt-1">
                {onAddMisc && <button type="button" className="rounded-xl px-4 min-h-[44px] text-sm border border-dashed border-[#5A4614] text-[#F3C969]" onClick={onAddMisc}>+ Add a bill</button>}
                {onAddRepair && <button type="button" className="rounded-xl px-4 min-h-[44px] text-sm border border-dashed border-[#5A4614] text-[#F3C969]" onClick={onAddRepair}>+ Add a repair</button>}
              </div>}
            </div>}

            {shown === 'dealer' && <div className={`${row} flex flex-wrap items-center justify-between gap-3`}>
              <div className="min-w-0"><p className="text-sm text-white">{car.consignment?.dealer || 'Dealer'} · {car.consignment?.terms === 'profit_split' ? `${car.consignment.splitPercent ?? 0}% of profit` : 'fixed amount'}</p>
                <p className="text-xs text-gray-400">{c.dealerNotApproved ? (c.agreementMissing ? 'Agreement can follow later.' : 'Agreement uploaded.') : 'Approved.'}</p></div>
              <button type="button" className={c.dealerNotApproved && director ? goldBtn : ghostBtn} onClick={() => onOpenDetails('consignment')}>{c.dealerNotApproved && director ? 'Open dealer approval' : 'View dealer deal'}</button>
            </div>}

            {shown === 'paper' && (todoLink
              ? <Link to={todoLink} className={`${row} flex items-center justify-between gap-3 hover:border-gold-500/30`}><span className="flex items-center gap-3 text-sm text-white"><FileText size={17} className="text-gray-400" />{paperwork ? `${paperwork} item${paperwork > 1 ? 's' : ''} open · in the to-do list` : 'Nothing open'}</span><span className="text-sm text-gold-400 flex items-center">Open to-do<ChevronRight size={16} /></span></Link>
              : <p className={`${row} text-sm text-gray-300`}>{paperwork ? `${paperwork} paperwork item${paperwork > 1 ? 's' : ''} open` : 'Nothing open'}</p>)}

            {shown === 'closed' && <p className={`${row} text-sm text-gray-300`}>{c.state === 'closed' ? 'Everything is done. Nothing more to do on this car.' : 'Nothing to press here. Finish the stages before it and the case closes by itself.'}</p>}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {nextStage && <button type="button" onClick={() => setView(nextStage.id)}
                className={`rounded-xl px-4 min-h-[44px] text-sm font-bold inline-flex items-center gap-1 ${shownDone ? 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300' : 'border border-[#5A4614] text-[#F3C969] hover:bg-[#2A2210]'}`}>
                {shownDone ? `${NAMES[shown]} done · ` : ''}Next stage: {NAMES[nextStage.id]}<ChevronRight size={16} /></button>}
              {shown !== current && <button type="button" onClick={() => setView(null)} className="rounded-xl px-3 min-h-[44px] text-sm text-[#F3C969]">Back to current stage</button>}
            </div>
          </section>}
          {!c && cases.loading && <p className="text-sm text-gray-400">Loading the case…</p>}
          {cases.error && <p role="alert" className="text-sm text-red-400">{cases.error.message}</p>}
        </div>

        <div className="space-y-4 min-w-0 lg:order-2 order-1">
          <section className={`${card} overflow-hidden relative`}>
            <button type="button" aria-label="Open photos and green card" onClick={() => onOpenMedia('photos')} className="relative block w-full h-44 bg-gradient-to-br from-[#2A2A33] to-[#17171C] group">
              {car.photo ? <img src={thumbUrl(car.photo, 900, 75)!} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <CarIcon size={56} className="absolute inset-0 m-auto text-gray-600" />}
              {c && <span className={`absolute top-3 left-3 text-xs font-semibold px-2.5 py-1 rounded-full ${c.state === 'closed' ? 'bg-emerald-900/90 text-emerald-200' : 'bg-[#3A2C0E]/95 text-[#F3C969]'}`}>{c.state === 'closed' ? 'Closed case' : 'Active case'}</span>}
              {car.carPlate && <span className="absolute top-3 right-3 text-xs font-mono font-semibold px-2 py-1 rounded-md bg-black/70 text-gold-300">{car.carPlate}</span>}
              <span className="absolute bottom-3 left-3 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-black/70 text-white group-hover:bg-black/85"><Camera size={13} />{photoCount ? `${photoCount} photo${photoCount > 1 ? 's' : ''}` : 'Add photos'}</span>
            </button>
            <button type="button" onClick={() => onOpenMedia('card')} className={`absolute top-[8.75rem] right-3 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${car.greenCard ? 'bg-emerald-900/90 text-emerald-200' : 'bg-[#3A2C0E]/95 text-[#F3C969]'}`}><FileText size={13} />{car.greenCard ? 'Green card ✓' : 'Green card missing'}</button>
            <div className="p-5 space-y-3">
              <div>
                <h1 className="font-display text-white text-2xl font-semibold">{car.year} {car.make} {car.model}</h1>
                <p className="text-sm text-gray-400 mt-0.5">{consignmentIn ? `Consignment · ${car.consignment?.dealer || 'dealer'}` : car.outgoingConsignment ? 'Sent to another dealer' : car.investorFunded ? 'Investor car' : 'Own stock'}</p>
              </div>
              {profit !== null && soldFor !== null && <div className="flex items-end justify-between gap-3 pt-3 border-t border-white/[0.08]">
                <div><p className="text-xs text-gray-400">Profit</p><p className={`font-display text-3xl font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCents(cents(profit))}</p></div>
                <div className="text-right"><p className="text-xs text-gray-400">Sold for</p><p className="text-white font-semibold">{formatCents(cents(soldFor))}</p></div>
              </div>}
            </div>
          </section>

          {profit !== null && soldFor !== null && <section className={`${card} p-5 space-y-2.5`}>
            <h2 className="text-white font-semibold mb-1">How the profit adds up</h2>
            <div className="flex justify-between text-sm"><span className="text-gray-300">Sold for</span><span className="text-white">{formatCents(cents(soldFor))}</span></div>
            {costs.filter((r) => r.amount !== 0).map((r) => <div key={r.label} className="flex justify-between text-sm"><span className="text-gray-300">{r.label}</span><span className="text-white">− {formatCents(cents(r.amount))}</span></div>)}
            <div className="flex justify-between pt-2.5 border-t border-white/[0.08]"><span className="font-semibold text-white">Profit</span><span className={`font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCents(cents(profit))}</span></div>
          </section>}
        </div>
      </div>

      <button type="button" className="w-full min-h-[48px] rounded-xl border border-white/10 bg-white/[0.02] text-sm text-gray-300 hover:text-white" onClick={() => onOpenDetails()}>{detailsOpen ? 'Hide full details' : 'Show full details · edit car, repairs, deal, dealer'}</button>
      {recording && <RecordMoney car={car} actorId={actorId} defaultAmountCents={recording.amountCents} defaultNote={recording.note} onClose={() => setRecording(null)} onSaved={reload} />}
      {paying && <CompanyBankPaymentDialog key={actorId + ':' + paying.id} payments={[paying]} actorId={actorId} onClose={() => { setPaying(null); reload(); }} />}
      {docs && <CompanyPaymentDocuments paymentId={docs} onClose={() => { setDocs(null); reload(); }} />}
    </div>
  );
}
