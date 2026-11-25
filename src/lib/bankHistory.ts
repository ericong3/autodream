// Bank check for the months before the bank's start date in the app (for Public
// Bank, before 1 Nov 2026). These lines are answered as DRAFTS only: nothing here
// goes into the books. The books are connected later, in one step, only when
// every old month is ready and the Director says yes.
// Pure rules, no I/O, so they can be tested on their own. Money is in cents.
import type { BankCheckLine, BankMove } from './bankCheckMatch';

export const CHECKED_FORMAT = 'autodream-bank-lines-1';
export type CheckedLine = { date: string; cents: number; balanceCents: number; type: string; who: string; memo: string; ref: string };
export type CheckedMonth = { month: string; openingCents: number; closingCents: number; creditCents: number; credits: number; debitCents: number; debits: number };
// needs: nothing yet. part: started, but does not explain the whole amount.
// answered: said what it was. linked: books entries or bills explain it to the sen.
export type HistoryState = 'needs' | 'part' | 'answered' | 'linked';
// plate: the car's plate, capitals and digits only ('' when the bill has no car).
export type BillLite = { id: string; cents: number; date: string; label: string; payee: string; plate: string };
export type Suggestion = { kind: 'entry'; move: BankMove } | { kind: 'bills'; bills: BillLite[]; payee: string };
// What the Director said about a books entry no statement line stands for.
export type EntryNote = { how: 'wrong' | 'elsewhere'; note?: string; at: string; by: string };

const BILL_KINDS = new Set(['bills', 'staff']);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const rm = (c: number) => (c < 0 ? '−' : '') + 'RM ' + (Math.abs(c) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const days = (from: string, to: string) => (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5;
const order = (a: BankCheckLine, b: BankCheckLine) => a.date.localeCompare(b.date) || (a.details.seq ?? 0) - (b.details.seq ?? 0);
const int = (v: unknown) => (Number.isSafeInteger(v) ? (v as number) : NaN);

// A checked-lines file proves itself. Every balance must follow from the one
// before; each month must agree with the totals and counts printed on its
// statement; and the last balance must be the one the app starts the bank with.
// Any break and nothing is loaded.
export function readCheckedLines(raw: unknown, bank: { openingDate: string; openingCents: number }): { lines: CheckedLine[]; months: CheckedMonth[]; openingCents: number } | { problem: string } {
  const f = raw as { format?: unknown; openingCents?: unknown; closingCents?: unknown; lines?: unknown; months?: unknown } | null;
  if (!f || typeof f !== 'object' || f.format !== CHECKED_FORMAT) return { problem: 'This is not a checked-lines file from Claude.' };
  if (!Array.isArray(f.lines) || !f.lines.length || f.lines.length > 20000) return { problem: 'The file has no lines.' };
  if (!Array.isArray(f.months) || !f.months.length || f.months.length > 120) return { problem: "The file has no statement totals for each month." };
  const opening = int(f.openingCents), closing = int(f.closingCents);
  if (Number.isNaN(opening) || Number.isNaN(closing)) return { problem: 'The file has no opening or closing balance.' };
  if (closing !== bank.openingCents) return { problem: `The file ends at ${rm(closing)}, but the app starts this bank at ${rm(bank.openingCents)} on ${bank.openingDate}. They must be the same.` };

  const out: CheckedLine[] = [];
  let bal = opening, last = '';
  for (let i = 0; i < f.lines.length; i++) {
    const l = (f.lines[i] ?? {}) as Record<string, unknown>;
    const date = text(l.date, 10), cents = int(l.cents), balanceCents = int(l.balanceCents);
    const where = `Line ${i + 1} (${date || 'no date'})`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) return { problem: `${where} has no proper date.` };
    if (date >= bank.openingDate) return { problem: `${where} is on or after ${bank.openingDate}. Only lines before the bank's start date go here.` };
    if (date < last) return { problem: `${where} is out of date order.` };
    if (Number.isNaN(cents) || Number.isNaN(balanceCents)) return { problem: `${where} has no proper amount or balance.` };
    bal += cents;
    if (bal !== balanceCents) return { problem: `${where} does not follow: the balance should be ${rm(bal)}, the file says ${rm(balanceCents)}.` };
    last = date;
    out.push({ date, cents, balanceCents, type: text(l.type, 120), who: text(l.who, 200), memo: text(l.memo, 300), ref: text(l.ref, 60) });
  }
  if (bal !== closing) return { problem: `The lines end at ${rm(bal)}, not ${rm(closing)}.` };

  // Each month against its statement. The bank counts RM 0.00 lines as debits.
  const months: CheckedMonth[] = [];
  let prev = opening;
  for (const m of f.months as Record<string, unknown>[]) {
    const month = text(m?.month, 7);
    const want = { openingCents: int(m?.openingCents), closingCents: int(m?.closingCents), creditCents: int(m?.creditCents), credits: int(m?.credits), debitCents: int(m?.debitCents), debits: int(m?.debits) };
    if (!/^\d{4}-\d{2}$/.test(month) || Object.values(want).some(Number.isNaN)) return { problem: 'A month in the file has no proper statement totals.' };
    const mine = out.filter((l) => l.date.startsWith(month));
    const cr = mine.filter((l) => l.cents > 0), dr = mine.filter((l) => l.cents <= 0);
    const got = { openingCents: prev, closingCents: mine.length ? mine[mine.length - 1].balanceCents : prev, creditCents: cr.reduce((s, l) => s + l.cents, 0), credits: cr.length, debitCents: -dr.reduce((s, l) => s + l.cents, 0), debits: dr.length };
    const name = new Date(month + '-01T00:00:00Z').toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    if (got.openingCents !== want.openingCents) return { problem: `${name} starts at ${rm(got.openingCents)}, but its statement says ${rm(want.openingCents)}.` };
    if (got.closingCents !== want.closingCents) return { problem: `${name}'s lines end at ${rm(got.closingCents)}, but its statement closes at ${rm(want.closingCents)}.` };
    if (got.creditCents !== want.creditCents || got.credits !== want.credits) return { problem: `${name}: money in is ${rm(got.creditCents)} in ${got.credits} lines, but the statement says ${rm(want.creditCents)} in ${want.credits}.` };
    if (got.debitCents !== want.debitCents || got.debits !== want.debits) return { problem: `${name}: money out is ${rm(got.debitCents)} in ${got.debits} lines, but the statement says ${rm(want.debitCents)} in ${want.debits}.` };
    months.push({ month, ...want });
    prev = got.closingCents;
  }
  const covered = new Set(months.map((m) => m.month));
  const stray = out.find((l) => !covered.has(l.date.slice(0, 7)));
  if (stray) return { problem: `Lines on ${stray.date} have no statement totals in the file.` };
  // RM 0.00 lines (SST on a cheque fee) move nothing, so they are not kept.
  return { lines: out.filter((l) => l.cents !== 0), months, openingCents: opening };
}

export const hasDraft = (l: BankCheckLine) => !!l.details.answer || !!l.details.linkIds?.length || !!l.details.billIds?.length || !!l.details.toAdd?.length;

// How much of the line its drafts explain: linked books entries, ticked bills and bills to add.
export function explainedCents(l: BankCheckLine, billCents: (id: string) => number, moveCents: (id: string) => number | undefined): number {
  let s = 0;
  for (const id of l.details.linkIds ?? []) s += Math.abs(moveCents(id) ?? 0);
  if (l.cents < 0) {
    for (const id of l.details.billIds ?? []) s += l.details.billCents?.[id] ?? billCents(id);
    for (const b of l.details.toAdd ?? []) s += b.cents;
  }
  return s;
}

// How much of each bill the lines' drafts already pay (a bill can be paid in parts
// by several lines). Leave out one line with `except`.
export function billCover(lines: BankCheckLine[], billCents: (id: string) => number, except?: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) if (l.id !== except) for (const id of l.details.billIds ?? []) m.set(id, (m.get(id) ?? 0) + (l.details.billCents?.[id] ?? billCents(id)));
  return m;
}

export function historyState(l: BankCheckLine, billCents: (id: string) => number, moveCents: (id: string) => number | undefined): HistoryState {
  if (l.cents !== 0 && explainedCents(l, billCents, moveCents) === Math.abs(l.cents)) return 'linked';
  const kind = l.details.answer?.kind;
  if (kind && !BILL_KINDS.has(kind)) return 'answered';
  return hasDraft(l) ? 'part' : 'needs';
}

// Old bills were often keyed into the app months after they were paid (a repair
// paid on 6 Jan keyed on 2 May), so the day a bill was keyed says little here.
// Matching leans on the car plate written on the line and on the payee instead.

// The line's words, capitals and digits only: "QAA 8563K alza" -> "QAA8563KALZA".
export const lineKey = (l: BankCheckLine) => `${l.details.who ?? ''} ${l.details.memo ?? ''} ${l.text}`.toUpperCase().replace(/[^A-Z0-9]/g, '');
// Bills for a car whose plate is written on the line (memo, name or type).
export const carBills = (l: BankCheckLine, bills: BillLite[]) => { const k = lineKey(l); return bills.filter((b) => b.plate.length >= 5 && k.includes(b.plate)); };

// Bills that add up exactly to a transfer: a run of bills keyed one after another
// (in keyed order). Of all such runs, the one keyed nearest the transfer's day.
export function billSplit(line: BankCheckLine, bills: BillLite[], used: Set<string> = new Set()): BillLite[] | null {
  const amount = -line.cents;
  if (amount <= 0) return null;
  const list = bills.filter((b) => !used.has(b.id) && b.cents > 0).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let best: BillLite[] | null = null, gap = Infinity;
  for (let i = 0; i < list.length; i++) {
    let s = 0;
    for (let j = i; j < list.length; j++) {
      s += list[j].cents;
      if (s > amount) break;
      if (s === amount) { const g = Math.min(Math.abs(days(list[i].date, line.date)), Math.abs(days(list[j].date, line.date))); if (g < gap) { best = list.slice(i, j + 1); gap = g; } break; }
    }
  }
  return best;
}

// A likely partner for each line with no draft yet. First a books entry with the
// same amount, nearest day first (same day, then 3, 10 and 45 days). Then, for
// money out: bills for the car plate written on the line that add up exactly;
// then bills of the payee named on the line that add up exactly; last any single
// bill with the same amount keyed within 120 days. Each entry and bill is
// suggested once, never one a draft already uses. A bill another line paid part
// of is offered for what is left of it. Only a suggestion: the Director accepts
// it or not.
export function suggestions(lines: BankCheckLine[], moves: BankMove[], allBills: BillLite[], payeeOf: (l: BankCheckLine) => string | undefined): Map<string, Suggestion> {
  const usedE = new Set(lines.flatMap((l) => l.details.linkIds ?? []));
  const full = new Map(allBills.map((b) => [b.id, b.cents]));
  const cover = billCover(lines, (id) => full.get(id) ?? 0);
  const bills = allBills.map((b) => ({ ...b, cents: b.cents - (cover.get(b.id) ?? 0) })).filter((b) => b.cents > 0);
  const usedB = new Set<string>();
  const out = new Map<string, Suggestion>();
  const open = lines.filter((l) => l.cents !== 0 && !hasDraft(l)).sort(order);
  for (const win of [0, 3, 10, 45]) for (const l of open) {
    if (out.has(l.id)) continue;
    let best: BankMove | undefined, gap = Infinity;
    for (const m of moves) { if (m.cents !== l.cents || usedE.has(m.id)) continue; const g = Math.abs(days(m.date, l.date)); if (g <= win && g < gap) { best = m; gap = g; } }
    if (best) { usedE.add(best.id); out.set(l.id, { kind: 'entry', move: best }); }
  }
  const take = (l: BankCheckLine, found: BillLite[] | null, payee?: string) => {
    if (!found?.length) return false;
    for (const b of found) usedB.add(b.id);
    out.set(l.id, { kind: 'bills', bills: found, payee: payee || found[0].payee });
    return true;
  };
  for (const l of open) {
    if (out.has(l.id) || l.cents >= 0) continue;
    const mine = carBills(l, bills);
    if (!mine.length) continue;
    const payee = payeeOf(l);
    const samePayee = payee ? mine.filter((b) => b.payee.toLowerCase() === payee.toLowerCase()) : [];
    if (!take(l, billSplit(l, samePayee, usedB), payee)) take(l, billSplit(l, mine, usedB));
  }
  const byPayee = new Map<string, BillLite[]>();
  for (const b of bills) { const k = b.payee.toLowerCase(); byPayee.set(k, [...(byPayee.get(k) ?? []), b]); }
  for (const l of open) {
    if (out.has(l.id) || l.cents >= 0) continue;
    const payee = payeeOf(l);
    if (payee) take(l, billSplit(l, byPayee.get(payee.toLowerCase()) ?? [], usedB), payee);
  }
  for (const win of [10, 45, 120]) for (const l of open) {
    if (out.has(l.id) || l.cents >= 0) continue;
    let best: BillLite | undefined, gap = Infinity;
    for (const b of bills) { if (b.cents !== -l.cents || usedB.has(b.id)) continue; const g = Math.abs(days(b.date, l.date)); if (g <= win && g < gap) { best = b; gap = g; } }
    if (best) take(l, [best]);
  }
  return out;
}

// Bank lines (money out) that could have paid one bill: the car's plate or the
// payee's name is on the line, and the line still has room. `need` is what is
// left of the bill to pay (all of it, unless another line paid part). Plate on
// the line first, then the same amount, then oldest first.
export type BillLine = { line: BankCheckLine; exact: boolean; plate: boolean; payee: boolean };
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export function linesForBill(b: BillLite, lines: BankCheckLine[], roomOf: (l: BankCheckLine) => number, payeeOf: (l: BankCheckLine) => string | undefined, need = b.cents): BillLine[] {
  const name = squash(b.payee);
  return lines.filter((l) => l.cents < 0).map((l) => {
    const key = lineKey(l);
    return { line: l, exact: -l.cents === need, plate: b.plate.length >= 5 && key.includes(b.plate), payee: (name.length >= 4 && key.includes(name)) || (payeeOf(l) ?? '').toLowerCase() === b.payee.toLowerCase() };
  }).filter((x) => (x.plate || x.payee) && roomOf(x.line) > 0)
    .sort((x, y) => Number(y.plate) - Number(x.plate) || Number(y.exact) - Number(x.exact) || order(x.line, y.line));
}

export type MonthTally = {
  month: string; lines: number;
  needs: number; part: number; answered: number; linked: number;
  openingCents: number | null; closingCents: number | null;
  inCents: number; outCents: number;               // the statement
  answeredInCents: number; answeredOutCents: number; // lines answered or linked
  unlinked: BankMove[];   // books entries of the month that no line stands for
  undecided: BankMove[];  // ... and that you have not said anything about
  done: boolean;          // every line answered and every books entry accounted for
};

// One row per month, oldest first, for the months with statement lines or books entries.
export function monthTallies(lines: BankCheckLine[], states: Map<string, HistoryState>, moves: BankMove[], noteOf: (entryId: string) => EntryNote | undefined): MonthTally[] {
  const linked = new Set(lines.flatMap((l) => l.details.linkIds ?? []));
  const months = [...new Set([...lines.map((l) => l.date.slice(0, 7)), ...moves.map((m) => m.date.slice(0, 7))])].sort();
  return months.map((month) => {
    const mine = lines.filter((l) => l.date.startsWith(month)).sort(order);
    const first = mine[0], last = mine[mine.length - 1];
    const count = (s: HistoryState) => mine.filter((l) => states.get(l.id) === s).length;
    const settled = mine.filter((l) => { const s = states.get(l.id); return s === 'answered' || s === 'linked'; });
    const unlinked = moves.filter((m) => m.date.startsWith(month) && !linked.has(m.id));
    const undecided = unlinked.filter((m) => !noteOf(m.id));
    const needs = count('needs'), part = count('part');
    return {
      month, lines: mine.length, needs, part, answered: count('answered'), linked: count('linked'),
      openingCents: first && Number.isSafeInteger(first.details.balanceCents) ? first.details.balanceCents! - first.cents : null,
      closingCents: last && Number.isSafeInteger(last.details.balanceCents) ? last.details.balanceCents! : null,
      inCents: mine.filter((l) => l.cents > 0).reduce((s, l) => s + l.cents, 0),
      outCents: -mine.filter((l) => l.cents < 0).reduce((s, l) => s + l.cents, 0),
      answeredInCents: settled.filter((l) => l.cents > 0).reduce((s, l) => s + l.cents, 0),
      answeredOutCents: -settled.filter((l) => l.cents < 0).reduce((s, l) => s + l.cents, 0),
      unlinked, undecided, done: mine.length > 0 && needs === 0 && part === 0 && undecided.length === 0,
    };
  });
}
