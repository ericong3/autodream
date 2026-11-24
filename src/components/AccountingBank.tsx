// Accounting → Bank: each month's statement next to the books, at a glance.
// Answering and recording still happen in Bank check; this screen only shows
// where things stand and opens the right line there.
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { appSaysAt, bankSaysAt, type LineState } from '../lib/bankCheckMatch';
import { lineHint } from '../lib/bankCheckWords';
import { monthRange } from '../lib/booksView';
import { myMonth } from '../lib/billsBoard';
import type { BankBook } from '../lib/useBankBook';
import AccountingBankAccounts from './AccountingBankAccounts';
import { StatusIcon, type IconKind } from './BillsBoard';
import { Ring, dayShort, monthLong, monthShort, rm } from './AccountingParts';

type Status = 'all' | 'done' | 'answered' | 'needs';
type Dir = 'all' | 'in' | 'out';
const groupOf = (s: LineState): Exclude<Status, 'all'> => (s === 'done' ? 'done' : s === 'answered' ? 'answered' : 'needs');
const ICON: Record<Exclude<Status, 'all'>, IconKind> = { done: 'done', answered: 'half', needs: 'missing' };
const PAGE = 60;

export default function AccountingBank({ book, actorId }: { book: BankBook; actorId: string }) {
  const navigate = useNavigate();
  const [bankId, setBankId] = useState('');
  const [month, setMonth] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [dir, setDir] = useState<Dir>('all');
  const [limit, setLimit] = useState(PAGE);
  const [allMonths, setAllMonths] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);

  const one = book.banks.find((b) => b.bank.id === bankId) ?? book.banks[0];
  const nowMonth = myMonth(new Date().toISOString());

  // One card per month, from the earliest statement or opening date to now.
  const months = useMemo(() => {
    if (!one) return [];
    const firsts = [one.bank.openingDate?.slice(0, 7), ...one.lines.map((l) => l.date.slice(0, 7))].filter((m): m is string => !!m && /^\d{4}-\d{2}$/.test(m)).sort();
    const range = monthRange(firsts[0] ?? nowMonth, nowMonth).reverse();
    return range.map((m) => {
      const ls = one.lines.filter((l) => l.date.startsWith(m));
      const done = ls.filter((l) => one.states.get(l.id) === 'done').length;
      return { month: m, total: ls.length, done };
    });
  }, [one, nowMonth]);
  const active = month && months.some((m) => m.month === month) ? month : months.find((m) => m.total)?.month ?? months[0]?.month ?? nowMonth;

  const monthLines = useMemo(() => (one ? one.lines.filter((l) => l.date.startsWith(active)).sort((a, b) => a.date.localeCompare(b.date) || (a.details.seq ?? 0) - (b.details.seq ?? 0)) : []), [one, active]);
  const count = (s: Status) => monthLines.filter((l) => s === 'all' || groupOf(one!.states.get(l.id)!) === s).length;
  const shown = monthLines.filter((l) => (status === 'all' || groupOf(one!.states.get(l.id)!) === status) && (dir === 'all' || (dir === 'in' ? l.cents > 0 : l.cents < 0)));

  const lastDate = monthLines[monthLines.length - 1]?.date;
  const bankSays = one && lastDate ? bankSaysAt(one.lines, one.bank.openingCents, lastDate) : null;
  const booksSay = one && lastDate ? (Number.isSafeInteger(one.bank.balanceCents) ? appSaysAt(one.bank.balanceCents!, one.moves, lastDate) : one.moves.filter((m) => m.date <= lastDate).reduce((s, m) => s + m.cents, 0)) : null;
  const gap = bankSays !== null && booksSay !== null ? booksSay - bankSays : null;
  const checkLink = (extra: string) => `/bank-check?bank=${encodeURIComponent(one?.bank.id ?? '')}&${extra}`;

  if (book.loading && !book.banks.length) return <p className="text-[#ABA597] text-sm py-10 text-center"><Loader2 size={16} className="inline animate-spin mr-2" />Loading the bank lines…</p>;
  if (book.error && !book.banks.length) return (
    <div className="rounded-2xl border border-[#6B3A2C] bg-[#1D1210] p-5 space-y-3">
      <p className="text-[#F5A37E] text-sm">Could not load the bank lines: {book.error}</p>
      <button type="button" onClick={() => void book.reload()} className="btn-ghost px-4 py-2 rounded-lg text-sm">Try again</button>
    </div>
  );

  const max = Math.max(Math.abs(bankSays ?? 0), Math.abs(booksSay ?? 0), 1);
  const width = (c: number) => `${(Math.max(0, c) / max) * 100}%`;
  const n = { all: count('all'), done: count('done'), answered: count('answered'), needs: count('needs') };

  return (
    <div className="space-y-7">
      {book.banks.length > 1 && (
        <div role="group" aria-label="Bank account" className="flex flex-wrap gap-2">
          {book.banks.map((b) => <Pill key={b.bank.id} on={b.bank.id === one?.bank.id} onClick={() => { setBankId(b.bank.id); setMonth(''); setLimit(PAGE); }}>{b.bank.name}</Pill>)}
        </div>
      )}

      {!one ? (
        <p className="text-[#ABA597] text-sm">No company bank account yet. Add one under “Bank accounts and opening balances” below.</p>
      ) : <>
        {/* Statement months */}
        <section aria-label="Statement months" className="space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {(allMonths ? months : months.slice(0, 6)).map((m) => {
              const on = m.month === active;
              return (
                <button key={m.month} type="button" aria-pressed={on} onClick={() => { setMonth(m.month); setLimit(PAGE); }}
                  className={`text-left rounded-xl px-3 py-2.5 border transition-colors ${on ? 'border-gold-400/70 bg-gold-500/[0.08]' : m.total ? 'border-[#2A2316] bg-[#141210] hover:border-[#3D3420]' : 'border-dashed border-[#6B3A2C] bg-transparent hover:border-[#F08A5D]'}`}>
                  <span className="block text-sm text-[#F3EEE2] font-medium">{monthShort(m.month)}</span>
                  {m.total ? <>
                    <span className="block text-xs text-[#ABA597] tabular-nums">{m.done} of {m.total} done</span>
                    <span className="mt-1.5 block h-1 rounded-full bg-[#2A2316] overflow-hidden"><span className="block h-full bg-[#EAB820]" style={{ width: `${(m.done / m.total) * 100}%` }} /></span>
                  </> : <span className="block text-xs text-[#F5A37E]">No statement yet</span>}
                </button>
              );
            })}
          </div>
          {months.length > 6 && <button type="button" onClick={() => setAllMonths(!allMonths)} className="text-xs text-gold-300 hover:text-white">{allMonths ? 'Show fewer months' : `Show all ${months.length} months`}</button>}
        </section>

        {!monthLines.length ? (
          <div className="rounded-2xl border border-dashed border-[#6B3A2C] p-6 space-y-3">
            <p className="text-[#F3EEE2] font-medium">No {monthLong(active)} statement yet</p>
            <p className="text-sm text-[#C9C2B3]">Upload it in Bank check. Each line then shows here, with what is already in the books and what still needs you.</p>
            <Link to={checkLink(`month=${active}`)} className="inline-flex min-h-[44px] items-center px-4 rounded-[10px] bg-gold-gradient text-obsidian-950 font-semibold text-sm">Open Bank check</Link>
          </div>
        ) : <>
          {/* The month at a glance */}
          <section aria-labelledby="month-head" className="flex flex-wrap items-center gap-x-10 gap-y-6">
            <Ring size={168} stroke={16} total={n.all} label={`${n.done} of ${n.all} ${monthLong(active)} lines are done`} big={String(n.done)} small={`of ${n.all} done`}
              parts={[{ value: n.done, color: '#EAB820' }, { value: n.answered, color: '#6E6248' }]} />
            <div className="flex-[1_1_420px] min-w-0 flex flex-col gap-4">
              <h2 id="month-head" className="text-xl font-medium text-[#F3EEE2]">{one.bank.name}, {monthLong(active)} statement</h2>
              <div className="flex flex-col gap-2.5">
                <BalanceBar label="Statement" value={bankSays} fill={<span className="block h-full bg-[#C9C2B3]" style={{ width: width(bankSays ?? 0) }} />} />
                <BalanceBar label="Books" value={booksSay} fill={<>
                  <span className="block h-full bg-[#EAB820]" style={{ width: width(Math.min(bankSays ?? 0, booksSay ?? 0)) }} />
                  {gap !== null && gap > 0 && <span className="block h-full bg-[#F08A5D]" style={{ width: width(gap) }} />}
                  {gap !== null && gap < 0 && <span className="block h-full border-2 border-dashed border-[#F08A5D] rounded-r-[5px]" style={{ width: width(-gap) }} />}
                </>} />
              </div>
              {gap !== null && lastDate && (
                <p className="flex items-center gap-2.5 text-[15px] text-[#F3EEE2]">
                  <StatusIcon kind={gap ? 'missing' : 'done'} size={20} />
                  {gap ? `On ${dayShort(lastDate)} the books say ${rm(Math.abs(gap))} ${gap > 0 ? 'more' : 'less'} than the bank.` : `On ${dayShort(lastDate)} the books and the bank agree.`}
                </p>
              )}
            </div>
          </section>

          {/* Status tiles are the filter */}
          <div role="group" aria-label="Show lines" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatusTile on={status === 'all'} onClick={() => { setStatus('all'); setLimit(PAGE); }} count={n.all} label="All lines" icon={<svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden><rect x="4" y="5" width="20" height="18" rx="3" stroke="#C9C2B3" strokeWidth="2" /><path d="M8 11h12M8 15h12M8 19h7" stroke="#C9C2B3" strokeWidth="2" strokeLinecap="round" /></svg>} />
            <StatusTile on={status === 'done'} onClick={() => { setStatus('done'); setLimit(PAGE); }} count={n.done} label="Done" icon={<StatusIcon kind="done" size={28} />} />
            <StatusTile on={status === 'answered'} onClick={() => { setStatus('answered'); setLimit(PAGE); }} count={n.answered} label="Answered, waiting to record" icon={<StatusIcon kind="half" size={28} />} />
            <StatusTile on={status === 'needs'} onClick={() => { setStatus('needs'); setLimit(PAGE); }} count={n.needs} label="Need your answer" icon={<StatusIcon kind="missing" size={28} />} />
          </div>

          {/* The lines */}
          <section aria-label="Statement lines">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-[#3D3420]">
              <div role="group" aria-label="Direction" className="flex flex-wrap gap-2">
                <Pill on={dir === 'all'} onClick={() => setDir('all')}>All</Pill>
                <Pill on={dir === 'in'} onClick={() => setDir('in')}>Money in</Pill>
                <Pill on={dir === 'out'} onClick={() => setDir('out')}>Money out</Pill>
              </div>
              <Link to={checkLink(`month=${active}`)} className="inline-flex min-h-[44px] items-center px-4 rounded-[10px] bg-gold-gradient text-obsidian-950 font-semibold text-sm">Open Bank check</Link>
            </div>
            {shown.slice(0, limit).map((l) => {
              const st = one.states.get(l.id)!, g = groupOf(st);
              return (
                <button key={l.id} type="button" onClick={() => navigate(checkLink(`line=${encodeURIComponent(l.id)}`))}
                  className="w-full text-left flex flex-wrap items-center gap-x-4 gap-y-1 py-3 border-b border-[#2A2316] hover:bg-white/[0.02]">
                  <span className="w-7 flex justify-center" aria-label={g === 'done' ? 'Done' : g === 'answered' ? 'Answered' : 'Needs your answer'}><StatusIcon kind={ICON[g]} size={22} /></span>
                  <span className="w-14 text-[13px] text-[#ABA597]">{dayShort(l.date)}</span>
                  <span className="flex-[1_1_240px] min-w-0 flex flex-col gap-0.5">
                    <span className="text-[15px] font-medium text-[#F3EEE2] truncate">{l.details.who || l.text}</span>
                    <span className={`text-[13px] truncate ${g === 'needs' ? 'text-[#F5A37E]' : g === 'answered' ? 'text-[#C9C2B3]' : 'text-[#ABA597]'}`}>{lineHint(l, st)}</span>
                  </span>
                  <span className={`w-16 inline-flex items-center gap-1 text-[13px] ${l.cents > 0 ? 'text-[#9FC7E8]' : 'text-[#ABA597]'}`}>{l.cents > 0 ? <ArrowDown size={13} /> : <ArrowUp size={13} />}{l.cents > 0 ? 'In' : 'Out'}</span>
                  <span className="w-32 text-right text-[15px] font-semibold text-[#F3EEE2] tabular-nums ml-auto">{rm(Math.abs(l.cents))}</span>
                </button>
              );
            })}
            {shown.length === 0 && <p className="py-6 text-sm text-[#ABA597]">No lines here. Pick All lines.</p>}
            {shown.length > limit && <button type="button" onClick={() => setLimit(limit + PAGE * 4)} className="mt-3 min-h-[44px] px-4 rounded-[10px] border border-[#3D3420] bg-[#141210] text-sm text-[#F3EEE2]">Show {Math.min(shown.length - limit, PAGE * 4)} more</button>}
          </section>
        </>}
      </>}

      {/* Bank accounts register (opening balances) */}
      <section className="border-t border-[#2A2316] pt-4">
        <button type="button" aria-expanded={showAccounts} onClick={() => setShowAccounts(!showAccounts)} className="min-h-[44px] flex items-center gap-2 text-[15px] text-[#C9C2B3] hover:text-white">
          {showAccounts ? <ChevronDown size={16} /> : <ChevronRight size={16} />}Bank accounts and opening balances
        </button>
        {showAccounts && <div className="pt-2"><AccountingBankAccounts key={actorId} actorId={actorId} /></div>}
      </section>
    </div>
  );
}

function BalanceBar({ label, value, fill }: { label: string; value: number | null; fill: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="w-20 text-sm text-[#C9C2B3]">{label}</span>
      <span className="flex-1 h-[18px] rounded-[5px] bg-[#252118] overflow-hidden flex">{fill}</span>
      <span className="w-36 text-right text-base font-medium text-[#F3EEE2] tabular-nums">{value === null ? '—' : rm(value)}</span>
    </div>
  );
}

function StatusTile({ on, onClick, count, label, icon }: { on: boolean; onClick: () => void; count: number; label: string; icon: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-left min-h-[76px] border transition-colors ${on ? 'border-gold-400/70 bg-gold-500/[0.08]' : 'border-[#2A2316] bg-[#141210] hover:border-[#3D3420]'}`}>
      {icon}
      <span className="flex flex-col gap-0.5"><span className="text-2xl font-medium leading-tight text-[#F3EEE2] tabular-nums">{count}</span><span className="text-[13px] text-[#C9C2B3]">{label}</span></span>
    </button>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`min-h-[40px] inline-flex items-center px-4 rounded-full text-sm border transition-colors ${on ? 'bg-gold-gradient text-obsidian-950 border-transparent font-semibold' : 'border-white/10 text-[#C9C2B3] hover:text-white hover:border-white/25'}`}>
      {children}
    </button>
  );
}
