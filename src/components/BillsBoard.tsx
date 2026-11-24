// Bills and money due: the parts of the Payments screen that show, at a glance,
// what is paid, what is not, and what paperwork is missing. Payment itself still
// goes through the existing pay dialogs; these parts only pick the bills.
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { Payment } from '../types';
import { formatRM } from '../utils/format';
import { BILL_KINDS, billBlock, billKind, myDay, namesLabel, type BillKind, type DocState, type MonthBucket, type PaidGroup, type PayeeGroup } from '../lib/billsBoard';

const rm = (cents: number) => formatRM(cents / 100);
const shortRm = (cents: number) => {
  const v = cents / 100;
  if (v >= 1_000_000) return `RM ${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 1000) return `RM ${Math.round(v / 1000)}k`;
  return `RM ${Math.round(v)}`;
};
const monthWord = (m: string, style: 'short' | 'long' = 'short') => new Date(m + '-01T00:00:00').toLocaleDateString('en-MY', style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' });
const dayWord = (iso: string) => { const d = myDay(iso); return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) : ''; };

// ── Status icons (the same four everywhere) ─────────────────────────────────

export type IconKind = 'done' | 'missing' | 'notyet' | 'half' | 'owed';
export function StatusIcon({ kind, size = 18 }: { kind: IconKind; size?: number }) {
  const box = { width: size, height: size, viewBox: '0 0 28 28', 'aria-hidden': true as const, className: 'shrink-0' };
  if (kind === 'done') return <svg {...box}><circle cx="14" cy="14" r="12" fill="#EAB820" /><path d="M8.5 14.5l3.6 3.6 7.4-8" stroke="#0A0906" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (kind === 'missing') return <svg {...box}><circle cx="14" cy="14" r="12" fill="#F08A5D" /><path d="M14 8v7.5M14 19.5v.5" stroke="#0A0906" strokeWidth="2.6" strokeLinecap="round" /></svg>;
  if (kind === 'half') return <svg {...box}><circle cx="14" cy="14" r="11" fill="none" stroke="#BFAE84" strokeWidth="2" /><path d="M14 3a11 11 0 0 1 0 22z" fill="#BFAE84" /></svg>;
  if (kind === 'owed') return <svg {...box}><circle cx="14" cy="14" r="12" fill="#7FB3E6" /><path d="M18.5 9.5l-9 9M9.5 12v6.5H16" stroke="#0A0906" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg {...box}><circle cx="14" cy="14" r="11" fill="none" stroke="#8C8679" strokeWidth="2" strokeDasharray="4 3.2" /></svg>;
}

// ── The four tiles: the main switch ─────────────────────────────────────────

export type TileKey = 'to_pay' | 'transferred' | 'documents' | 'to_collect';
export type Tile = { key: TileKey; title: string; value: string; note: string; icon: IconKind };

export function BillsTiles({ tiles, active, onPick }: { tiles: Tile[]; active: string; onPick: (k: TileKey) => void }) {
  return (
    <div className={`grid grid-cols-2 ${tiles.length > 3 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-2 sm:gap-3 mb-3`}>
      {tiles.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(t.key)}
            className={`text-left rounded-2xl border px-3.5 py-3 sm:px-4 sm:py-4 min-h-[100px] flex flex-col gap-1.5 transition-colors ${on ? 'border-gold-400/70 bg-gold-500/[0.08]' : 'border-white/[0.07] bg-obsidian-800/50 hover:border-white/20'}`}
          >
            <span className="flex items-center gap-2 text-[13px] text-[#C9C2B3]"><StatusIcon kind={t.icon} />{t.title}</span>
            <span className="text-lg sm:text-2xl font-semibold text-white tabular-nums leading-tight">{t.value}</span>
            <span className="text-[11px] sm:text-xs text-[#ABA597]">{t.note}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Not paid, by the month the bill was keyed ───────────────────────────────

export const bucketKey = (b: Pick<MonthBucket, 'month' | 'before'>) => (b.before ? 'before:' : '') + b.month;

export function UnpaidByMonth({ buckets, active, onPick, currentMonth, older }: {
  buckets: MonthBucket[];
  active: string | null;
  onPick: (key: string | null) => void;
  currentMonth: string;
  older: { count: number; cents: number };
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.map((b) => b.cents));
  const label = (b: MonthBucket) => (b.before ? `Before ${monthWord(b.month)}` : monthWord(b.month));
  const longLabel = (b: MonthBucket) => (b.before ? `Before ${monthWord(b.month, 'long')}` : monthWord(b.month, 'long'));
  const peak = buckets.reduce((best, b, i) => (b.cents > buckets[best].cents ? i : best), 0);
  const olderKey = 'before:' + currentMonth;
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-obsidian-900/50 p-4 sm:p-5 mb-3 flex flex-col lg:flex-row gap-5">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <h3 className="text-sm text-[#C9C2B3] font-medium">Not paid, by the month the bill was keyed</h3>
          {active && <button type="button" onClick={() => onPick(null)} className="text-xs text-gold-300 hover:text-white whitespace-nowrap">Show all months</button>}
        </div>
        <div className="relative">
          <div className="relative h-40 flex items-end gap-[2px] border-b border-white/10">
            {buckets.map((b, i) => {
              const key = bucketKey(b), on = active === key, isNow = !b.before && b.month === currentMonth;
              const h = b.cents ? Math.max(2, (b.cents / max) * 100) : 0;
              const showValue = on || (active === null && (i === peak || isNow));
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${longLabel(b)}: ${b.count} bills, ${rm(b.cents)}`}
                  onClick={() => onPick(on ? null : key)}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  disabled={!b.count}
                  className="relative flex-1 h-full flex flex-col items-center justify-end disabled:cursor-default"
                >
                  {showValue && b.cents > 0 && <span className="mb-1 text-[11px] text-[#C9C2B3] tabular-nums whitespace-nowrap">{shortRm(b.cents)}</span>}
                  <span
                    className="block w-full max-w-[48px] rounded-t-[4px] transition-opacity"
                    style={{ height: `calc(${h}% - ${showValue ? 18 : 0}px)`, minHeight: b.cents ? 3 : 0, background: on || isNow ? '#EAB820' : '#6E6248', opacity: active && !on ? 0.4 : 1 }}
                  />
                </button>
              );
            })}
            {hover !== null && buckets[hover] && (
              <div
                role="tooltip"
                className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-white/10 bg-obsidian-800 px-3 py-2 text-xs shadow-card-lg whitespace-nowrap"
                style={{ left: `${((hover + 0.5) / buckets.length) * 100}%`, bottom: `min(calc(${(buckets[hover].cents / max) * 100}% + 8px), calc(100% - 48px))` }}
              >
                <p className="text-white font-medium">{longLabel(buckets[hover])}</p>
                <p className="text-[#C9C2B3] tabular-nums">{buckets[hover].count} bills, {rm(buckets[hover].cents)}</p>
              </div>
            )}
          </div>
          <div className="flex gap-[2px] mt-1.5">
            {buckets.map((b) => <span key={bucketKey(b)} className={`flex-1 text-center text-[11px] ${active === bucketKey(b) ? 'text-gold-300 font-semibold' : 'text-[#ABA597]'}`}>{label(b)}</span>)}
          </div>
        </div>
      </div>
      {older.count > 0 && (
        <aside className={`lg:w-64 shrink-0 rounded-xl border p-4 flex flex-col gap-1.5 ${active === olderKey ? 'border-gold-400/60 bg-gold-500/[0.06]' : 'border-white/[0.07] bg-obsidian-800/50'}`}>
          <p className="text-xs text-[#ABA597]">Keyed before {monthWord(currentMonth, 'long')}</p>
          <p className="text-white text-lg font-semibold tabular-nums">{older.count.toLocaleString('en-MY')} bills</p>
          <p className="text-gold-300 tabular-nums">{rm(older.cents)}</p>
          <p className="text-xs text-[#ABA597] mt-1">Paid already? Tick them and add the bank slip.</p>
          <button
            type="button"
            aria-pressed={active === olderKey}
            onClick={() => onPick(active === olderKey ? null : olderKey)}
            className="mt-2 min-h-[40px] rounded-lg border border-gold-500/40 text-gold-200 text-sm font-medium hover:bg-gold-500/10"
          >
            {active === olderKey ? 'Show every month' : 'Show these bills'}
          </button>
        </aside>
      )}
    </section>
  );
}

// ── Search and kind chips ───────────────────────────────────────────────────

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-[36px] px-3.5 rounded-full border text-xs font-medium whitespace-nowrap transition-colors ${on ? 'bg-gold-gradient text-obsidian-950 border-transparent font-bold' : 'border-white/10 text-[#C9C2B3] hover:text-white hover:border-white/25'}`}
    >
      {children}
    </button>
  );
}

export function KindFilters({ search, onSearch, bills, kind, onKind }: {
  search: string; onSearch: (v: string) => void; bills: Payment[]; kind: BillKind | null; onKind: (k: BillKind | null) => void;
}) {
  const counts = new Map<BillKind, number>();
  for (const p of bills) counts.set(billKind(p.type), (counts.get(billKind(p.type)) ?? 0) + 1);
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
      <div className="relative sm:w-64">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search payee, car or what for"
          aria-label="Search bills"
          className="w-full min-h-[38px] pl-8 pr-3 rounded-lg bg-obsidian-800/60 border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gold-500/40"
        />
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
        <Chip on={kind === null} onClick={() => onKind(null)}>All {bills.length}</Chip>
        {BILL_KINDS.filter((k) => counts.get(k.key)).map((k) => (
          <Chip key={k.key} on={kind === k.key} onClick={() => onKind(kind === k.key ? null : k.key)}>{k.label} {counts.get(k.key)}</Chip>
        ))}
      </div>
    </div>
  );
}

// ── Paperwork button on a bill ──────────────────────────────────────────────

function DocsButton({ state, onOpen, paid }: { state: DocState; onOpen: () => void; paid: boolean }) {
  const needInvoice = state === 'need_invoice' || state === 'need_both';
  const needSlip = paid && (state === 'need_receipt' || state === 'need_both');
  if (needInvoice || needSlip) {
    return (
      <button type="button" onClick={onOpen} className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 rounded-lg border border-dashed border-[#F08A5D]/70 text-[#F5A37E] text-xs font-medium hover:bg-[#F08A5D]/10 whitespace-nowrap">
        <StatusIcon kind="missing" size={14} />{needInvoice && needSlip ? 'Add invoice and slip' : needInvoice ? 'Add invoice' : 'Add slip'}
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen} title={state === 'ok' ? 'Nothing missing' : 'Open invoices and slips'} className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 rounded-lg border border-white/10 text-[#C9C2B3] text-xs hover:text-white hover:border-white/25 whitespace-nowrap">
      {state === 'ok' && <StatusIcon kind="done" size={14} />}Papers
    </button>
  );
}

// ── Not paid, by payee ──────────────────────────────────────────────────────

type BillHelpers = {
  docOf?: (p: Payment) => DocState;
  onDocs?: (p: Payment) => void;
  carOf: (p: Payment) => string;
  centsOf: (p: Payment) => number;
};

export function PayeeList({ groups, selected, onSetMany, actions, h }: {
  groups: PayeeGroup[];
  selected: Set<string>;
  onSetMany: (ids: string[], on: boolean) => void;
  actions: (p: Payment) => ReactNode;
  h: BillHelpers;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(25);
  const toggleOpen = (k: string) => setOpen((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });
  if (groups.length === 0) return <p className="text-center text-sm text-[#ABA597] py-16">No unpaid bills match.</p>;
  return (
    <section aria-label="Not paid, by payee" className="rounded-2xl border border-white/[0.07] bg-obsidian-900/40 overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
        <h3 className="text-sm text-[#C9C2B3] font-medium">Not paid, by payee</h3>
        <span className="text-[11px] text-[#8C8679]">Newest bill first</span>
      </div>
      {groups.slice(0, limit).map((g) => {
        const tickable = g.bills.filter((p) => !billBlock(p));
        const ticked = tickable.filter((p) => selected.has(p.id)).length;
        const isOpen = open.has(g.key);
        const missing = h.docOf ? g.bills.filter((p) => { const s = h.docOf!(p); return s === 'need_invoice' || s === 'need_both'; }).length : 0;
        return (
          <div key={g.key} className={`border-b border-white/[0.05] last:border-0 ${ticked ? 'bg-gold-500/[0.04]' : ''}`}>
            <div className="flex items-center gap-1 pr-4">
              <label className="shrink-0 w-11 h-14 flex items-center justify-center cursor-pointer" title={tickable.length ? `Tick all ${tickable.length} bills for ${g.name}` : 'None of these can be paid here yet'}>
                <input
                  type="checkbox"
                  className="w-[18px] h-[18px] accent-[#EAB820] cursor-pointer disabled:cursor-not-allowed"
                  aria-label={`Tick all bills for ${g.name}`}
                  disabled={!tickable.length}
                  checked={tickable.length > 0 && ticked === tickable.length}
                  ref={(el) => { if (el) el.indeterminate = ticked > 0 && ticked < tickable.length; }}
                  onChange={() => onSetMany(tickable.map((p) => p.id), ticked < tickable.length)}
                />
              </label>
              <button type="button" aria-expanded={isOpen} onClick={() => toggleOpen(g.key)} className="flex-1 min-w-0 flex items-center gap-3 py-3 text-left">
                {isOpen ? <ChevronDown size={16} className="text-[#ABA597] shrink-0" /> : <ChevronRight size={16} className="text-[#ABA597] shrink-0" />}
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] text-white font-medium truncate">{g.name}</span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {g.needsPanel && <span className="inline-flex items-center gap-1 text-[11px] text-[#F5A37E]"><StatusIcon kind="missing" size={12} />Choose the insurance panel first</span>}
                    {g.sameAs.length > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-[#D9CCA6]"><StatusIcon kind="half" size={12} />Looks like the same shop as {g.sameAs.join(', ')}</span>}
                    {missing > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-[#F5A37E]"><StatusIcon kind="missing" size={12} />{missing === g.bills.length ? 'No invoice yet' : `${missing} without an invoice`}</span>}
                  </span>
                </span>
                <span className="hidden sm:block text-xs text-[#ABA597] whitespace-nowrap">{g.bills.length} {g.bills.length === 1 ? 'bill' : 'bills'}, newest {dayWord(g.newest)}</span>
                <span className="text-[15px] text-white font-semibold tabular-nums whitespace-nowrap">{rm(g.cents)}</span>
              </button>
            </div>
            {isOpen && (
              <ul className="pb-2">
                {g.bills.map((p) => <BillRow key={p.id} p={p} checked={selected.has(p.id)} onToggle={() => onSetMany([p.id], !selected.has(p.id))} actions={actions(p)} h={h} />)}
              </ul>
            )}
          </div>
        );
      })}
      {groups.length > limit && (
        <button type="button" onClick={() => setLimit(groups.length)} className="w-full min-h-[48px] text-sm text-gold-300 hover:text-white border-t border-white/[0.06]">
          Show all {groups.length} payees
        </button>
      )}
    </section>
  );
}

function BillRow({ p, checked, onToggle, actions, h }: { p: Payment; checked: boolean; onToggle: () => void; actions: ReactNode; h: BillHelpers }) {
  const block = billBlock(p);
  const car = h.carOf(p);
  return (
    <li className={`flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 pl-1 pr-4 py-1.5 ${checked ? 'bg-gold-500/[0.06]' : ''}`}>
      <label className="shrink-0 w-11 h-10 flex items-center justify-center cursor-pointer" title={block ?? 'Tick to pay'}>
        <input type="checkbox" className="w-[17px] h-[17px] accent-[#EAB820] cursor-pointer disabled:cursor-not-allowed" aria-label={`Tick ${p.description || p.recipientName} ${car}`} disabled={!!block} checked={checked && !block} onChange={onToggle} />
      </label>
      <span className="w-14 shrink-0 text-xs text-[#ABA597] tabular-nums">{dayWord(p.createdAt)}</span>
      <span className="flex-1 min-w-[140px]">
        <span className="block text-sm text-white truncate">{car || p.description || p.recipientName}</span>
        <span className="block text-[11px] text-[#ABA597] truncate">{car ? p.description : ''}{block && block !== 'Paid from the car bill' ? `${car && p.description ? '. ' : ''}${block}` : ''}</span>
      </span>
      {h.onDocs && h.docOf && !p.id.startsWith('uc_commission_') && <DocsButton state={h.docOf(p)} paid={false} onOpen={() => h.onDocs!(p)} />}
      <span className="w-28 text-right text-sm text-white tabular-nums">{rm(h.centsOf(p))}</span>
      <span className="flex items-center gap-1.5 relative">{actions}</span>
    </li>
  );
}

// ── The bar that appears once bills are ticked ──────────────────────────────

export function SelectionBar({ bills, cents, onClear, onPay, onAttach, problem, warning, payLabel }: {
  bills: Payment[]; cents: number; onClear: () => void; onPay: () => void; onAttach?: () => void;
  problem?: string | null; warning?: string | null; payLabel: string;
}) {
  const names = [...new Set(bills.map((p) => p.recipientName))];
  return (
    <div className="fixed bottom-20 lg:bottom-6 left-0 right-0 z-40 px-4 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-4xl rounded-2xl bg-obsidian-800 border border-gold-500/40 shadow-card-lg p-3 sm:p-4">
        {(problem || warning) && (
          <p role={problem ? 'alert' : undefined} className={`flex items-start gap-2 text-xs mb-2.5 ${problem ? 'text-[#F5A37E]' : 'text-[#D9CCA6]'}`}>
            <StatusIcon kind={problem ? 'missing' : 'half'} size={14} />{problem || warning}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <span className="shrink-0 min-w-[32px] h-8 px-2 rounded-full bg-gold-gradient text-obsidian-950 text-sm font-bold flex items-center justify-center tabular-nums">{bills.length}</span>
          <div className="flex-1 min-w-[150px]">
            <p className="text-sm text-white font-medium truncate">{bills.length} {bills.length === 1 ? 'bill' : 'bills'} for {namesLabel(names)}</p>
            <p className="text-sm text-gold-300 font-semibold tabular-nums">{rm(cents)}</p>
          </div>
          <button type="button" onClick={onClear} className="min-h-[40px] px-3 text-sm text-[#ABA597] hover:text-white">Clear</button>
          {onAttach && <button type="button" onClick={onAttach} className="min-h-[40px] px-3 rounded-lg border border-white/10 text-sm text-[#C9C2B3] hover:text-white hover:border-white/25">Add invoices</button>}
          <button type="button" onClick={onPay} disabled={!!problem} className="min-h-[40px] px-4 rounded-lg bg-gold-gradient text-obsidian-950 text-sm font-bold shadow-gold-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">{payLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ── Paid: one row per payment, one square per bill ──────────────────────────

export function PaidView({ groups, months, month, onMonth, h, top }: {
  groups: PaidGroup[];
  months: string[];
  month: string;          // 'YYYY-MM' or 'all'
  onMonth: (m: string) => void;
  h: BillHelpers;
  top?: ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(30);
  const bills = groups.flatMap((g) => g.bills);
  const slipOf = (p: Payment): 'done' | 'missing' | 'notyet' => { const s = h.docOf?.(p) ?? 'unknown'; return s === 'need_receipt' || s === 'need_both' ? 'missing' : s === 'unknown' ? 'notyet' : 'done'; };
  const withSlip = bills.filter((p) => slipOf(p) === 'done').length;
  const unknown = bills.filter((p) => slipOf(p) === 'notyet').length;
  const onStatement = groups.filter((g) => g.lineId).length;
  const label = month === 'all' ? 'so far' : `in ${monthWord(month, 'long')}`;
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {months.map((m) => <Chip key={m} on={month === m} onClick={() => onMonth(m)}>{monthWord(m, 'long')}</Chip>)}
        <Chip on={month === 'all'} onClick={() => onMonth('all')}>Every month</Chip>
      </div>
      {top}
      <div className="grid sm:grid-cols-2 gap-2 sm:gap-3">
        <div className="rounded-2xl border border-white/[0.07] bg-obsidian-900/50 p-4 flex items-center gap-3">
          <StatusIcon kind={bills.length && withSlip === bills.length ? 'done' : bills.length - withSlip - unknown > 0 ? 'missing' : 'notyet'} size={26} />
          <div>
            <p className="text-white font-medium tabular-nums">{withSlip} of {bills.length} bills paid {label} have a slip</p>
            {unknown > 0 && <p className="text-xs text-[#ABA597]">{unknown} older ones not checked here. See Missing a document.</p>}
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-obsidian-900/50 p-4 flex items-center gap-3">
          <StatusIcon kind={groups.length && onStatement === groups.length ? 'done' : onStatement ? 'half' : 'notyet'} size={26} />
          <div>
            <p className="text-white font-medium tabular-nums">{groups.length} payments, {onStatement} checked on the bank statement</p>
            <p className="text-xs text-[#ABA597]">Bills ticked in Bank check show as one payment.</p>
          </div>
        </div>
      </div>
      {groups.length === 0 ? <p className="text-center text-sm text-[#ABA597] py-16">Nothing paid {label}.</p> : (
        <section aria-label="Payments" className="rounded-2xl border border-white/[0.07] bg-obsidian-900/40 overflow-hidden">
          {groups.slice(0, limit).map((g) => {
            const isOpen = open === g.key;
            const missingSlip = g.bills.filter((p) => slipOf(p) === 'missing').length;
            return (
              <div key={g.key} className="border-b border-white/[0.05] last:border-0">
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.key)} className="w-full flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left hover:bg-white/[0.02]">
                  <span className="w-14 shrink-0 text-xs text-[#ABA597] tabular-nums">{dayWord(g.day)}</span>
                  <span className="flex-1 min-w-[160px]">
                    <span className="block text-[15px] text-white font-medium truncate">{namesLabel(g.names)}</span>
                    <span className="block text-[11px] text-[#ABA597]">{g.bills.length} {g.bills.length === 1 ? 'bill' : 'bills'}{g.lineId ? ' in one payment' : ' paid that day'}</span>
                  </span>
                  <span className="flex flex-wrap gap-[3px] max-w-[140px]" aria-label={`${g.bills.length} bills`}>
                    {g.bills.slice(0, 40).map((p) => { const s = slipOf(p); return <span key={p.id} className="w-2.5 h-2.5 rounded-[2px]" style={s === 'done' ? { background: '#EAB820' } : s === 'missing' ? { background: '#F08A5D' } : { border: '1px dashed #8C8679' }} />; })}
                  </span>
                  <span className="flex items-center gap-2 text-[11px] whitespace-nowrap">
                    {missingSlip ? <span className="inline-flex items-center gap-1 text-[#F5A37E]"><StatusIcon kind="missing" size={13} />{missingSlip} no slip</span> : g.bills.every((p) => slipOf(p) === 'done') ? <span className="inline-flex items-center gap-1 text-[#E9D9A6]"><StatusIcon kind="done" size={13} />Slip</span> : null}
                    {g.lineId ? <span className="inline-flex items-center gap-1 text-[#E9D9A6]"><StatusIcon kind="done" size={13} />On statement</span> : <span className="inline-flex items-center gap-1 text-[#ABA597]"><StatusIcon kind="notyet" size={13} />Not on a statement yet</span>}
                  </span>
                  <span className="w-28 text-right text-[15px] text-white font-semibold tabular-nums">{rm(g.cents)}</span>
                </button>
                {isOpen && (
                  <ul className="pb-2">
                    {g.lineText && <li className="px-4 pb-1 text-[11px] text-[#8C8679] truncate">Statement: {g.lineText}</li>}
                    {g.bills.map((p) => (
                      <li key={p.id} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 px-4 py-1.5">
                        <span className="flex-1 min-w-[140px]">
                          <span className="block text-sm text-white truncate">{h.carOf(p) || p.description || p.recipientName}</span>
                          <span className="block text-[11px] text-[#ABA597] truncate">{p.recipientName}{h.carOf(p) && p.description ? `. ${p.description}` : ''}</span>
                        </span>
                        {h.onDocs && h.docOf && <DocsButton state={h.docOf(p)} paid onOpen={() => h.onDocs!(p)} />}
                        <span className="w-28 text-right text-sm text-white tabular-nums">{rm(h.centsOf(p))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {groups.length > limit && <button type="button" onClick={() => setLimit(groups.length)} className="w-full min-h-[48px] text-sm text-gold-300 hover:text-white border-t border-white/[0.06]">Show all {groups.length} payments</button>}
        </section>
      )}
      <p className="text-[11px] text-[#8C8679]">Money that came in is under All bills.</p>
    </div>
  );
}

// ── Owed to us: how long each amount has waited ─────────────────────────────

export function OwedList({ items, ageOf, kindOf, actions, selected, onToggle, h }: {
  items: Payment[];
  ageOf: (p: Payment) => number;
  kindOf: (p: Payment) => string;
  actions: (p: Payment) => ReactNode;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  h: BillHelpers;
}) {
  const [limit, setLimit] = useState(30);
  const sorted = [...items].sort((a, b) => ageOf(b) - ageOf(a));
  if (sorted.length === 0) return <p className="text-center text-sm text-[#ABA597] py-16">Nothing owed to us.</p>;
  return (
    <section aria-label="Owed to us" className="rounded-2xl border border-white/[0.07] bg-obsidian-900/40 overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
        <h3 className="text-sm text-[#C9C2B3] font-medium">Owed to us, waiting longest first</h3>
        <span className="text-[11px] text-[#8C8679]">Over 90 days shows in orange</span>
      </div>
      {sorted.slice(0, limit).map((p) => {
        const days = ageOf(p), late = days > 90;
        return (
          <div key={p.id} className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-white/[0.05] last:border-0">
            {onToggle && selected && (
              <input type="checkbox" className="w-[17px] h-[17px] accent-[#7FB3E6]" aria-label={`Tick ${p.recipientName}`} checked={selected.has(p.id)} onChange={() => onToggle(p.id)} />
            )}
            <span className="flex-1 min-w-[160px]">
              <span className="block text-[15px] text-white font-medium truncate">{h.carOf(p) || p.recipientName}</span>
              <span className="block text-[11px] text-[#ABA597] truncate">{kindOf(p)}, from {p.recipientName}</span>
            </span>
            <span className="w-full sm:w-44 flex items-center gap-2" aria-label={`${days} days waiting`}>
              <span className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                <span className="block h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, (days / 180) * 100))}%`, background: late ? '#F08A5D' : '#7FB3E6' }} />
              </span>
              <span className={`w-16 text-right text-xs tabular-nums ${late ? 'text-[#F5A37E]' : 'text-[#ABA597]'}`}>{days} days</span>
            </span>
            {h.onDocs && <button type="button" onClick={() => h.onDocs!(p)} className="min-h-[32px] px-2.5 rounded-lg border border-white/10 text-[#C9C2B3] text-xs hover:text-white">Papers</button>}
            <span className="w-28 text-right text-[15px] text-white font-semibold tabular-nums">{rm(h.centsOf(p))}</span>
            <span className="flex items-center gap-1.5 relative">{actions(p)}</span>
          </div>
        );
      })}
      {sorted.length > limit && <button type="button" onClick={() => setLimit(sorted.length)} className="w-full min-h-[48px] text-sm text-gold-300 hover:text-white border-t border-white/[0.06]">Show all {sorted.length}</button>}
    </section>
  );
}
