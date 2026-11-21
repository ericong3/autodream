import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Car as CarIcon, ChevronRight, FileText } from 'lucide-react';
import type { Car } from '../types';
import { useStore } from '../store';
import { thumbUrl } from '../utils/photoUrl';
import { formatCents, useInvestorQuery } from '../lib/investorFinance';
import { paymentBalanceCents } from '../lib/companyBankPayments';
import { moneyRequest, type MoneyEntry } from '../lib/moneyReceived';
import { loadCarCases, type CarCase } from '../lib/docTodo';
import { RecordMoney } from './MoneyReceivedPanel';

export type ProfitRow = { label: string; amount: number };
const INBOUND = new Set(['customer_collection', 'loan_disbursement', 'consignment_collection', 'supplier_credit_collection']);
const IN_LABEL: Record<string, string> = { customer_collection: 'Customer', loan_disbursement: 'Bank loan', consignment_collection: 'From dealer', supplier_credit_collection: 'Supplier credit' };
const words = (t: string) => t.split('_').join(' ');

/** Plain summary of a sold car: where it is, the one next step, money in, bills out and profit. */
export default function CarSummary({ car, actorId, role, profit, costs, detailsOpen, onOpenDetails }: {
  car: Car; actorId: string; role: string; profit: number | null; costs: ProfitRow[]; detailsOpen: boolean; onOpenDetails: (section?: string) => void;
}) {
  const director = role === 'director';
  const cases = useInvestorQuery(`car-cases:${actorId}`, loadCarCases);
  const money = useInvestorQuery<{ entries: MoneyEntry[] }>(`money-received:${actorId}:${car.id}`, () => moneyRequest('list', { carId: car.id }));
  const payments = useStore((s) => s.payments);
  const [allBills, setAllBills] = useState(false);
  const [recording, setRecording] = useState(false);
  const c: CarCase | undefined = cases.data?.cars[car.id];
  const mine = payments.filter((p) => p.carId === car.id && !p.obligationReplaced && (p.status === 'pending' || p.status === 'transferred'));
  const moneyIn = mine.filter((p) => INBOUND.has(p.type));
  const bills = mine.filter((p) => !INBOUND.has(p.type) && p.status === 'pending' && paymentBalanceCents(p) > 0).sort((a, b) => b.amount - a.amount);
  const billsLeft = bills.reduce((s, p) => s + paymentBalanceCents(p), 0);
  const entries = money.data?.entries ?? [];
  const paperwork = c ? c.missingDocs + c.moneyNoSlip + c.sentBack + (c.agreementMissing ? 1 : 0) : 0;
  const todoLink = director ? '/dashboard' : role === 'admin' ? '/admin-dashboard?tab=paperwork' : null;
  const soldFor = profit === null ? null : profit + costs.reduce((s, r) => s + r.amount, 0);

  // Progress, in the order a sold car normally goes.
  const steps: { name: string; done: boolean }[] = c ? [
    { name: 'Sold', done: true },
    { name: 'Money in', done: c.toCollectCents === 0 },
    { name: 'Bills paid', done: c.toPay === 0 },
    ...(car.consignment && !car.outgoingConsignment ? [{ name: 'Dealer approved', done: !c.dealerNotApproved }] : []),
    { name: 'Paperwork', done: paperwork === 0 },
    { name: 'Closed', done: c.state === 'closed' },
  ] : [];
  const current = steps.findIndex((s) => !s.done);

  // The one thing to do next.
  let next: { title: string; hint: string; action?: JSX.Element } | null = null;
  if (c && c.state !== 'closed') {
    if (c.toCollectCents > 0) next = { title: `Record the ${formatCents(c.toCollectCents)} still to come in`, hint: 'Only the amount, date and bank are needed. The slip can come later.', action: director ? <button type="button" className="btn-gold rounded-xl px-5 min-h-[44px] text-sm font-bold" onClick={() => setRecording(true)}>+ Money received</button> : undefined };
    else if (car.consignment && c.dealerNotApproved) next = { title: 'Approve the dealer amount', hint: 'Money is in. Check the car bills and approve what the dealer receives.', action: director ? <button type="button" className="btn-gold rounded-xl px-5 min-h-[44px] text-sm font-bold" onClick={() => onOpenDetails('consignment')}>Open dealer approval</button> : undefined };
    else if (c.toPay > 0) next = { title: `Pay ${c.toPay} bill${c.toPay > 1 ? 's' : ''} · ${formatCents(c.toPayCents)}`, hint: 'Pay them from Payments.', action: <Link to="/payments" className="btn-gold rounded-xl px-5 min-h-[44px] text-sm font-bold inline-flex items-center">Go to Payments</Link> };
    else next = { title: 'Finish the paperwork', hint: 'Only invoices, slips or the agreement are left. They are in the to-do list.', action: todoLink ? <Link to={todoLink} className="btn-gold rounded-xl px-5 min-h-[44px] text-sm font-bold inline-flex items-center">Open to-do</Link> : undefined };
  }

  const card = 'rounded-2xl border border-white/[0.08] bg-[#15151A]';
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="space-y-4 min-w-0">
          <section className={`${card} overflow-hidden`}>
            <div className="relative h-44 bg-gradient-to-br from-[#2A2A33] to-[#17171C] flex items-center justify-center">
              {car.photo ? <img src={thumbUrl(car.photo, 900, 75)!} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <CarIcon size={56} className="text-gray-600" />}
              {c && <span className={`absolute top-3 left-3 text-xs font-semibold px-2.5 py-1 rounded-full ${c.state === 'closed' ? 'bg-emerald-900/90 text-emerald-200' : 'bg-[#3A2C0E]/95 text-[#F3C969]'}`}>{c.state === 'closed' ? 'Closed case' : 'Active case'}</span>}
              {car.carPlate && <span className="absolute top-3 right-3 text-xs font-mono font-semibold px-2 py-1 rounded-md bg-black/70 text-gold-300">{car.carPlate}</span>}
            </div>
            <div className="p-5 space-y-3">
              <div>
                <h1 className="font-display text-white text-2xl font-semibold">{car.year} {car.make} {car.model}</h1>
                <p className="text-sm text-gray-400 mt-0.5">{car.consignment && !car.outgoingConsignment ? `Consignment · ${car.consignment.dealer || 'dealer'}` : car.outgoingConsignment ? 'Sent to another dealer' : car.investorFunded ? 'Investor car' : 'Own stock'}</p>
              </div>
              {profit !== null && soldFor !== null && <div className="flex items-end justify-between gap-3 pt-3 border-t border-white/[0.08]">
                <div><p className="text-xs text-gray-400">Profit</p><p className={`font-display text-3xl font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCents(Math.round(profit * 100))}</p></div>
                <div className="text-right"><p className="text-xs text-gray-400">Sold for</p><p className="text-white font-semibold">{formatCents(Math.round(soldFor * 100))}</p></div>
              </div>}
            </div>
          </section>

          {steps.length > 0 && <section className={`${card} p-5`}>
            <p className="text-xs text-gray-400 mb-3">Where this car is</p>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
              {steps.map((s, i) => <div key={s.name} className="space-y-2">
                <div className={`h-1.5 rounded-full ${s.done ? 'bg-emerald-400' : i === current ? 'bg-gold-400' : 'bg-white/10'}`} />
                <p className={`text-[11px] leading-tight ${i === current ? 'text-gold-300 font-semibold' : s.done ? 'text-emerald-300' : 'text-gray-500'}`}>{s.name}</p>
              </div>)}
            </div>
          </section>}

          {next && <section className="rounded-2xl border border-[#5A4614] bg-[#1C1708] p-5 space-y-2">
            <p className="text-[11px] font-semibold tracking-wider text-[#F3C969]">NEXT STEP</p>
            <p className="text-white text-lg font-semibold leading-snug">{next.title}</p>
            <p className="text-sm text-[#C9C3B3]">{next.hint}</p>
            {next.action && <div className="pt-1">{next.action}</div>}
          </section>}
          {c?.state === 'closed' && <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-emerald-200 text-sm">Everything is done. This case is closed.</section>}

          {paperwork > 0 && (todoLink
            ? <Link to={todoLink} className={`${card} flex items-center justify-between gap-3 px-5 py-4 hover:border-gold-500/30`}><span className="flex items-center gap-3 text-sm text-white"><FileText size={18} className="text-gray-400" />{paperwork} paperwork item{paperwork > 1 ? 's' : ''} open · in the to-do list</span><span className="text-sm text-gold-400 flex items-center">Open<ChevronRight size={16} /></span></Link>
            : <p className={`${card} px-5 py-4 text-sm text-gray-300`}>{paperwork} paperwork item{paperwork > 1 ? 's' : ''} open</p>)}
        </div>

        <div className="space-y-4 min-w-0">
          <section className={`${card} p-5 space-y-3`}>
            <div className="flex items-center justify-between gap-3"><h2 className="text-white font-semibold">Money coming in</h2>{director && <button type="button" className="text-sm text-gold-400 min-h-[44px] px-1" onClick={() => setRecording(true)}>+ Money received</button>}</div>
            {moneyIn.length === 0 && entries.length === 0 && <p className="text-sm text-gray-400">Nothing expected for this car.</p>}
            {moneyIn.map((p) => {
              const left = paymentBalanceCents(p);
              return <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3">
                <div className="min-w-0"><p className="text-sm text-white truncate">{IN_LABEL[p.type] ?? words(p.type)}{p.recipientName ? ` · ${p.recipientName}` : ''}</p>
                  <span className={`inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full ${left > 0 ? 'bg-[#3A2C0E] text-[#F3C969]' : 'bg-emerald-900/60 text-emerald-200'}`}>{left > 0 ? 'Waiting' : 'Received'}</span></div>
                <p className="text-sm font-semibold text-white whitespace-nowrap">{formatCents(Math.round(p.amount * 100))}</p>
              </div>;
            })}
            {entries.map((e) => <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3">
              <div className="min-w-0"><p className="text-sm text-white">Money received · {new Date(e.receivedOn).toLocaleDateString('en-MY')}</p><p className="text-[11px] text-gray-400 truncate">{e.bankName}{e.hasSlip ? ' · slip ✓' : ' · slip to upload'}</p></div>
              <p className="text-sm font-semibold text-emerald-300 whitespace-nowrap">{formatCents(e.amountCents)}</p>
            </div>)}
          </section>

          <section className={`${card} p-5 space-y-3`}>
            <div className="flex items-center justify-between gap-3"><h2 className="text-white font-semibold">Bills to pay</h2><span className="text-sm text-gray-400">{bills.length ? `${formatCents(billsLeft)} left` : ''}</span></div>
            {bills.length === 0 && <p className="text-sm text-gray-400">No unpaid bills.</p>}
            {(allBills ? bills : bills.slice(0, 3)).map((p) => <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3">
              <div className="min-w-0"><p className="text-sm text-white truncate">{p.recipientName || words(p.type)}</p><p className="text-[11px] text-gray-400 capitalize">{words(p.type)}</p></div>
              <p className="text-sm font-semibold text-white whitespace-nowrap">{formatCents(paymentBalanceCents(p))}</p>
            </div>)}
            {bills.length > 3 && <button type="button" className="w-full min-h-[44px] rounded-xl border border-white/10 text-sm text-gold-400" onClick={() => setAllBills(!allBills)}>{allBills ? 'Show less' : `Show all ${bills.length} bills`}</button>}
          </section>

          {profit !== null && soldFor !== null && <section className={`${card} p-5 space-y-2.5`}>
            <h2 className="text-white font-semibold mb-1">How the profit adds up</h2>
            <div className="flex justify-between text-sm"><span className="text-gray-300">Sold for</span><span className="text-white">{formatCents(Math.round(soldFor * 100))}</span></div>
            {costs.filter((r) => r.amount !== 0).map((r) => <div key={r.label} className="flex justify-between text-sm"><span className="text-gray-300">{r.label}</span><span className="text-white">− {formatCents(Math.round(r.amount * 100))}</span></div>)}
            <div className="flex justify-between pt-2.5 border-t border-white/[0.08]"><span className="font-semibold text-white">Profit</span><span className={`font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCents(Math.round(profit * 100))}</span></div>
          </section>}
        </div>
      </div>

      <button type="button" className="w-full min-h-[48px] rounded-xl border border-white/10 bg-white/[0.02] text-sm text-gray-300 hover:text-white" onClick={() => onOpenDetails()}>{detailsOpen ? 'Hide full details' : 'Show full details · edit car, repairs, deal, dealer'}</button>
      {recording && <RecordMoney car={car} actorId={actorId} onClose={() => setRecording(false)} onSaved={() => { void money.reload(); void cases.reload(); }} />}
    </div>
  );
}
