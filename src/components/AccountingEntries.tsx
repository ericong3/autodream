// Accounting → Every entry: each books entry as a short sentence, with the proof
// it has (bill, invoice, slip, statement) and what it changed. Debit and credit
// are one switch away for the accountant. Only the existing "Void" action (with
// a reason) changes anything here.
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, Car, ChevronDown, ChevronRight, CircleDollarSign, Receipt, ScrollText, Search, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Car as CarT, JournalEntry, LedgerAccount, Payment } from '../types';
import { formatRM } from '../utils/format';
import { myDay, type DocState } from '../lib/billsBoard';
import {
  ENTRY_KINDS, bankCents, billFinder, cents, entryAmount, entryCheck, entryEffects, entryGap, entryKind, entryProofs, entryWords, isBankAccount, isOpening, plainAccount,
  type EntryKind, type Proof,
} from '../lib/booksView';
import { dayShort, rm, signedRm } from './AccountingParts';

export type EntryProblem = '' | 'gap' | 'papers' | 'statement' | 'cancelled';
const KIND_STYLE: Record<EntryKind, { bg: string; fg: string; icon: ReactNode }> = {
  sold: { bg: '#EAB820', fg: '#0A0906', icon: <CircleDollarSign size={20} /> },
  bought: { bg: '#4A4232', fg: '#F3EEE2', icon: <Car size={20} /> },
  cost: { bg: '#BFAE84', fg: '#0A0906', icon: <Receipt size={20} /> },
  staff: { bg: '#B9A6D9', fg: '#0A0906', icon: <UserRound size={20} /> },
  in: { bg: '#7FB3E6', fg: '#0A0906', icon: <ArrowDownLeft size={20} /> },
  out: { bg: '#D9A27A', fg: '#0A0906', icon: <ArrowUpRight size={20} /> },
  other: { bg: '#3D3420', fg: '#F3EEE2', icon: <ScrollText size={20} /> },
};
const FIRST = 80, MORE = 200;

type Row = {
  e: JournalEntry; kind: EntryKind; title: string; sub: string; amount: number; note: string;
  proofs: Proof[]; gap: number; off: number; unknown: string[]; carId?: string; lineId?: string; search: string;
};

export default function AccountingEntries({ entries, accounts, payments, cars, docOf, entryLine, problem, onProblem, onVoid, tools }: {
  entries: JournalEntry[];
  accounts: LedgerAccount[];
  payments: Payment[];
  cars: CarT[];
  docOf: ((p: Payment) => DocState) | null;
  entryLine: Map<string, string>;
  problem: EntryProblem;
  onProblem: (p: EntryProblem) => void;
  onVoid: (e: JournalEntry) => void;
  tools: ReactNode;
}) {
  const [kind, setKind] = useState<EntryKind | null>(null);
  const [q, setQ] = useState('');
  const [formal, setFormal] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(FIRST);
  const [showTools, setShowTools] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const known = new Set(accounts.map((a) => a.id));
    const payById = new Map(payments.map((p) => [p.id, p]));
    const findBill = billFinder(payments);
    const carById = new Map(cars.map((c) => [c.id, c]));
    const moneyInCars = new Set(entries.filter((e) => !e.voided && e.carId && bankCents(e) > 0).map((e) => e.carId!));
    const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return sorted.map((e) => {
      const kind = entryKind(e);
      const words = entryWords(e.description);
      const car = e.carId ? carById.get(e.carId) : undefined;
      const carLabel = car ? `${car.carPlate ? car.carPlate + ' ' : ''}${car.make} ${car.model}` : '';
      const sub = [words.detail, car && !(car.carPlate && words.detail.includes(car.carPlate)) ? carLabel : ''].filter(Boolean).join(', ');
      const billId = findBill(e);
      const bill = billId ? payById.get(billId) : undefined;
      const touchesBank = !isOpening(e) && (e.lines ?? []).some((l) => isBankAccount(l.accountId));
      const lineId = entryLine.get(e.id);
      const gap = entryGap(e, known);
      const check = entryCheck(e, known);
      const moneyIn = kind === 'sold' ? bankCents(e) > 0 || (!!e.carId && moneyInCars.has(e.carId)) : null;
      const proofs = entryProofs({
        kind, voided: !!e.voided, gapCents: gap, moneyIn, missingAccount: gap !== 0 && check.offCents === 0,
        bill: bill ? { paid: bill.status === 'transferred', doc: docOf ? docOf(bill) : 'unknown' } : null,
        bank: touchesBank ? (lineId ? 'matched' : 'unmatched') : 'none',
      });
      const amount = entryAmount(e);
      const bankLine = (e.lines ?? []).find((l) => isBankAccount(l.accountId));
      const bankName = bankLine ? (byId.get(bankLine.accountId) ? plainAccount(byId.get(bankLine.accountId)!).name : bankLine.accountId) : '';
      const note = e.voided ? 'Cancelled'
        : kind === 'in' || kind === 'out' ? bankName
        : kind === 'sold' ? (moneyIn ? 'Money in' : 'Money not in yet')
        : bill ? (bill.status === 'transferred' ? 'Paid' : 'Not paid yet') : '';
      const search = `${words.title} ${sub} ${e.description} ${(Math.abs(amount) / 100).toFixed(2)} ${formatRM(Math.abs(amount) / 100)} ${bill?.recipientName ?? ''}`.toLowerCase();
      return { e, kind, title: words.title, sub, amount, note, proofs, gap, off: e.voided ? 0 : check.offCents, unknown: check.unknown, carId: car?.id, lineId, search };
    });
  }, [entries, accounts, payments, cars, docOf, entryLine]);

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const needle = q.trim().toLowerCase().replace(/^rm\s*/, '');
  const hasProblem = (r: Row, p: EntryProblem) =>
    p === '' ? true
    : p === 'gap' ? r.gap !== 0
    : p === 'cancelled' ? !!r.e.voided
    : p === 'statement' ? r.proofs.some((x) => x.label === 'Statement' && x.state === 'wait')
    : r.proofs.some((x) => (x.label === 'Invoice' || x.label === 'Receipt') && x.state === 'no');
  const base = rows.filter((r) => (!needle || r.search.includes(needle)) && hasProblem(r, problem));
  const shown = base.filter((r) => !kind || r.kind === kind);
  const count = (p: EntryProblem) => rows.filter((r) => hasProblem(r, p)).length;
  const gapRows = count('gap');
  const gapTotal = rows.reduce((s, r) => s + r.gap, 0);
  // Two different reasons, which can partly cancel out: entries whose two sides
  // are not equal, and entries on accounts missing from the list (they balance,
  // but their amounts are left out of every total).
  const unequal = rows.filter((r) => r.gap !== 0 && r.off !== 0);
  const missing = rows.filter((r) => r.gap !== 0 && r.off === 0);
  const missingIds = [...new Set(missing.flatMap((r) => r.unknown))];
  const sumAbs = (xs: Row[]) => xs.reduce((s, r) => s + Math.abs(r.gap), 0);
  const many = (n: number, one: string, more: string) => (n === 1 ? one : more);
  const today = myDay(new Date().toISOString());

  // Group the shown page by day.
  const days: { day: string; rows: Row[] }[] = [];
  for (const r of shown.slice(0, limit)) {
    const d = String(r.e.date).slice(0, 10);
    if (days[days.length - 1]?.day !== d) days.push({ day: d, rows: [] });
    days[days.length - 1].rows.push(r);
  }
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickProblem = (p: EntryProblem) => { onProblem(problem === p ? '' : p); setLimit(FIRST); };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="text-[15px] text-[#C9C2B3]"><span className="text-[22px] font-medium text-[#F3EEE2] tabular-nums">{shown.length.toLocaleString('en-MY')}</span> {shown.length === rows.length ? 'entries' : `of ${rows.length.toLocaleString('en-MY')} entries`}</span>
        <span className="flex flex-wrap gap-4 text-[13px] text-[#ABA597]">
          <span className="inline-flex items-center gap-1.5"><ProofBadge p={{ label: 'Has it', state: 'yes' }} /></span>
          <span className="inline-flex items-center gap-1.5"><ProofBadge p={{ label: 'Missing', state: 'no' }} /></span>
          <span className="inline-flex items-center gap-1.5"><ProofBadge p={{ label: 'Not yet', state: 'wait' }} /></span>
        </span>
      </div>

      {problem === 'gap' && (
        <div className="rounded-xl border border-[#6B3A2C] bg-[#1D1210] px-4 py-3 text-sm text-[#F3EEE2] space-y-1.5">
          {!gapRows && <p>Every entry adds up.</p>}
          {missing.length > 0 && <p>{missing.length} {many(missing.length, 'entry uses', 'entries use')} an account that is not in the account list ({missingIds.join(', ')}). Each entry balances, but {rm(sumAbs(missing))} is left out of the totals. Putting the account back in the list fixes {many(missing.length, 'it', 'them')}.</p>}
          {unequal.length > 0 && <p>{unequal.length} {many(unequal.length, 'entry has', 'entries have')} two sides that are not equal, by {rm(sumAbs(unequal))}{unequal.length > 1 ? ' in total' : ''}. {many(unequal.length, 'It needs', 'They need')} a correcting entry.</p>}
          {missing.length > 0 && unequal.length > 0 && <p className="text-[#C9C2B3]">The two partly cancel out, so the books show off by {rm(Math.abs(gapTotal))}.</p>}
          {gapRows > 0 && <p className="text-[13px] text-[#ABA597]">Open one and switch on “Debit and credit” to see its lines.</p>}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 flex-[1_1_260px] max-w-[360px]">
            <span className="text-[13px] text-[#ABA597]">Search</span>
            <span className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C8679]" />
              <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(FIRST); }} placeholder="Car plate, shop or amount"
                className="w-full min-h-[44px] pl-10 pr-3.5 rounded-[10px] bg-[#141210] border border-[#3D3420] text-[#F3EEE2] text-sm placeholder-[#8C8679] focus:outline-none focus:border-gold-500" />
            </span>
          </label>
          <div role="group" aria-label="Problems" className="flex flex-wrap gap-2">
            {gapRows > 0 && <ProblemChip on={problem === 'gap'} onClick={() => pickProblem('gap')} tone="no" label={`Doesn't add up ${gapRows}`} />}
            <ProblemChip on={problem === 'papers'} onClick={() => pickProblem('papers')} tone="no" label={`Missing invoice or slip ${count('papers')}`} />
            <ProblemChip on={problem === 'statement'} onClick={() => pickProblem('statement')} tone="wait" label={`Not on a statement yet ${count('statement')}`} />
            <ProblemChip on={problem === 'cancelled'} onClick={() => pickProblem('cancelled')} tone="wait" label={`Cancelled ${count('cancelled')}`} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Kind" className="flex flex-wrap gap-2">
            <KindChip on={kind === null} onClick={() => setKind(null)} label="All" count={base.length} />
            {ENTRY_KINDS.map((k) => {
              const n = base.filter((r) => r.kind === k.key).length;
              return n ? <KindChip key={k.key} on={kind === k.key} onClick={() => { setKind(kind === k.key ? null : k.key); setLimit(FIRST); }} label={k.label} count={n} /> : null;
            })}
          </div>
          <label className="inline-flex items-center gap-2.5 text-sm text-[#C9C2B3] cursor-pointer select-none">
            <input type="checkbox" className="accent-gold-500 w-4 h-4" checked={formal} onChange={(e) => setFormal(e.target.checked)} />
            Debit and credit
          </label>
        </div>
      </div>

      <div className="space-y-5">
        {days.map((d) => (
          <section key={d.day}>
            <h2 className="pb-2 text-[13px] font-medium text-[#ABA597] border-b border-[#3D3420]">{d.day === today ? `Today, ${dayShort(d.day)}` : dayShort(d.day) + (d.day.slice(0, 4) !== today.slice(0, 4) ? ` ${d.day.slice(0, 4)}` : '')}</h2>
            {d.rows.map((r) => {
              const isOpen = open.has(r.e.id), off = !!r.e.voided, k = KIND_STYLE[r.kind];
              return (
                <article key={r.e.id} className={`border-b border-[#2A2316] ${off ? 'opacity-70' : ''}`}>
                  <button type="button" aria-expanded={isOpen} onClick={() => toggle(r.e.id)} className="w-full flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-left">
                    <span aria-hidden className="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: k.bg, color: k.fg, opacity: off ? 0.4 : 1 }}>{k.icon}</span>
                    <span className="flex-[1_1_240px] min-w-0 flex flex-col gap-0.5">
                      <span className={`text-[15px] font-semibold truncate ${off ? 'line-through text-[#ABA597]' : 'text-[#F3EEE2]'}`}>{r.title}</span>
                      {r.sub && <span className="text-[13px] text-[#ABA597] truncate">{r.sub}</span>}
                    </span>
                    <span className="flex-[0_1_360px] flex flex-wrap gap-1.5">{r.proofs.map((p) => <ProofBadge key={p.label} p={p} />)}</span>
                    <span className="flex-[0_0_150px] ml-auto text-right flex flex-col gap-0.5">
                      <span className={`text-base font-semibold whitespace-nowrap tabular-nums ${off ? 'line-through text-[#8C8679]' : r.kind === 'in' ? 'text-[#9FC7E8]' : 'text-[#F3EEE2]'}`}>{r.kind === 'in' || r.kind === 'out' || (r.kind === 'bought' && r.amount < 0) ? signedRm(r.amount) : rm(Math.abs(r.amount))}</span>
                      {r.note && <span className="text-xs text-[#8C8679]">{r.note}</span>}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="pb-4 sm:pl-14 space-y-3">
                      {!formal ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] text-[#8C8679] mr-1">What changed</span>
                          {entryEffects(r.e, byId).map((f) => (
                            <span key={f.accountId} className={`inline-flex items-baseline gap-2 px-3 py-1.5 rounded-lg text-[13px] ${f.cents > 0 ? 'bg-[#1F2A33]' : 'bg-[#1C1A14]'}`}>
                              <span className="text-[#C9C2B3]">{f.name}</span><span className="font-semibold text-[#F3EEE2] tabular-nums">{signedRm(f.cents)}</span>
                            </span>
                          ))}
                          {off && <span className="text-[13px] text-[#ABA597]">Cancelled{r.e.voidReason ? `: ${r.e.voidReason}` : ''}, so none of this counts.</span>}
                        </div>
                      ) : (
                        <div className="overflow-x-auto border border-[#2A2316] rounded-[10px]">
                          <table className="w-full min-w-[480px] text-sm">
                            <thead><tr className="text-[13px] text-[#ABA597]"><th scope="col" className="text-left font-medium px-3.5 py-2">Account</th><th scope="col" className="text-right font-medium px-3.5 py-2">Debit</th><th scope="col" className="text-right font-medium px-3.5 py-2">Credit</th></tr></thead>
                            <tbody>
                              {(r.e.lines ?? []).map((l, i) => (
                                <tr key={i} className="border-t border-[#2A2316] text-[#F3EEE2]">
                                  <td className="px-3.5 py-2">{byId.get(l.accountId)?.name ?? <span className="text-[#F5A37E]">{l.accountId} (not in the account list)</span>}</td>
                                  <td className="px-3.5 py-2 text-right tabular-nums">{l.debit ? rm(cents(l.debit)) : ''}</td>
                                  <td className="px-3.5 py-2 text-right tabular-nums">{l.credit ? rm(cents(l.credit)) : ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {r.gap !== 0 && (
                            <p className="px-3.5 py-2 border-t border-[#2A2316] text-[13px] text-[#F5A37E]">
                              {r.off !== 0 && `Off by ${rm(Math.abs(r.off))}: debits and credits are not equal. `}
                              {r.unknown.length > 0 && `${r.unknown.join(', ')} is not in the account list, so ${r.off === 0 ? 'this entry balances but ' : ''}its amount is left out of the totals.`}
                            </p>
                          )}
                          {off && <p className="px-3.5 py-2 border-t border-[#2A2316] text-[13px] text-[#ABA597]">Voided{r.e.voidReason ? `: ${r.e.voidReason}` : ''}</p>}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                        {r.carId && <Link to={`/inventory/${r.carId}`} className="text-gold-300 hover:text-white">Open the car</Link>}
                        {r.lineId && <Link to={`/bank-check?line=${encodeURIComponent(r.lineId)}`} className="text-gold-300 hover:text-white">See the statement line</Link>}
                        <span className="text-[#8C8679] text-xs">Entry date {r.e.date.slice(0, 10)}</span>
                        {formal && !off && <button type="button" onClick={() => onVoid(r.e)} className="ml-auto text-xs text-[#ABA597] hover:text-[#F5A37E]">Void this entry…</button>}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        ))}
        {shown.length === 0 && <p className="py-6 text-[15px] text-[#ABA597]">No entries match. Clear the search or the filters.</p>}
        {shown.length > limit && (
          <button type="button" onClick={() => setLimit(limit + MORE)} className="min-h-[44px] px-4 rounded-[10px] border border-[#3D3420] bg-[#141210] text-[15px] text-[#F3EEE2]">
            Load older entries ({(shown.length - limit).toLocaleString('en-MY')} more)
          </button>
        )}
      </div>

      <section className="border-t border-[#2A2316] pt-5 space-y-3">
        <button type="button" aria-expanded={showTools} onClick={() => setShowTools(!showTools)} className="min-h-[44px] inline-flex items-center gap-2.5 text-[15px] text-[#ABA597] hover:text-white">
          {showTools ? <ChevronDown size={16} /> : <ChevronRight size={16} />}Repair tools and account names, for your accountant
        </button>
        {showTools && tools}
      </section>
    </div>
  );
}

function ProofBadge({ p }: { p: Proof }) {
  const cls = p.state === 'yes' ? 'bg-[#252118] text-[#F3EEE2] border-transparent' : p.state === 'no' ? 'bg-[#2A1912] text-[#F5A37E] border-transparent' : 'bg-transparent text-[#ABA597] border-dashed border-[#3D3420]';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[13px] ${cls}`}>
      {p.state === 'yes' ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2.5 6.3l2.2 2.2 4.8-5" stroke="#EAB820" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        : p.state === 'no' ? <span aria-hidden className="font-bold leading-none">!</span>
        : <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><circle cx="6" cy="6" r="4.5" stroke="#8C8679" strokeWidth="1.4" strokeDasharray="2.2 1.8" fill="none" /></svg>}
      <span className="sr-only">{p.state === 'yes' ? 'Has:' : p.state === 'no' ? 'Missing:' : 'Not yet:'}</span>{p.label}
    </span>
  );
}

function ProblemChip({ on, onClick, label, tone }: { on: boolean; onClick: () => void; label: string; tone: 'no' | 'wait' }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`min-h-[44px] inline-flex items-center gap-2 px-4 rounded-full text-sm border transition-colors ${on ? 'bg-gold-gradient text-obsidian-950 border-transparent font-semibold' : 'border-white/10 text-[#C9C2B3] hover:text-white hover:border-white/25'}`}>
      <span aria-hidden className={`w-2.5 h-2.5 rounded-full ${tone === 'no' ? 'bg-[#F08A5D]' : 'border border-dashed border-[#8C8679]'}`} />{label}
    </button>
  );
}

function KindChip({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`min-h-[40px] inline-flex items-center gap-2 px-3.5 rounded-full text-sm border transition-colors ${on ? 'bg-gold-gradient text-obsidian-950 border-transparent font-semibold' : 'border-white/10 text-[#C9C2B3] hover:text-white hover:border-white/25'}`}>
      {label}<span className={on ? 'text-[#3D3420]' : 'text-[#8C8679]'}>{count.toLocaleString('en-MY')}</span>
    </button>
  );
}
