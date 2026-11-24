// Bills and money due: pure rules for the Payments screen (group bills by
// payee, by month keyed, and by the payment that paid them). No I/O here, so
// the rules can be tested on their own. Money is in cents.
import type { JournalEntry, Payment, PaymentType } from '../types';

export type BillKind = 'repairs' | 'car_costs' | 'staff_pay' | 'consignment' | 'other';
export const BILL_KINDS: { key: BillKind; label: string }[] = [
  { key: 'repairs', label: 'Repairs' },
  { key: 'car_costs', label: 'Car costs' },
  { key: 'staff_pay', label: 'Staff pay' },
  { key: 'consignment', label: 'Consignment' },
  { key: 'other', label: 'Other' },
];
const KIND_OF: Partial<Record<PaymentType, BillKind>> = {
  repair: 'repairs', panel_charge: 'repairs',
  misc_cost: 'car_costs', purchase_settlement: 'car_costs',
  salesman_commission: 'staff_pay', intake_bonus: 'staff_pay', campaign_bonus: 'staff_pay',
  salary: 'staff_pay', allowance: 'staff_pay', source_commission: 'staff_pay',
  consignment_payout: 'consignment',
};
export const billKind = (t: PaymentType): BillKind => KIND_OF[t] ?? 'other';

const PAYROLL = new Set<PaymentType>(['salary', 'allowance', 'campaign_bonus']);
export const isPayroll = (p: Pick<Payment, 'type'>) => PAYROLL.has(p.type);

// Malaysia calendar day (UTC+8, no daylight saving) of a timestamp or date.
export function myDay(iso: string | undefined | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso).slice(0, 10);
  return new Date(t + 8 * 3600_000).toISOString().slice(0, 10);
}
export const myMonth = (iso: string | undefined | null) => myDay(iso).slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

// Why a bill can't be ticked for payment yet, or null when it can.
export function billBlock(p: Payment): string | null {
  if (p.status !== 'pending' || p.obligationReplaced) return 'Already settled';
  if (p.id.startsWith('uc_commission_')) return 'Paid from the car bill';
  if (p.type === 'customer_refund' && !p.bankName) return 'Waiting for the refund bank details';
  if (p.type === 'expense_claim' && p.recipientType !== 'user' && !p.recipientId) return 'Register the vendor first';
  if (p.type === 'expense_claim' && !p.claimConfirmedBy) return 'Check the claim first';
  return null;
}

// ── Payees ──────────────────────────────────────────────────────────────────

export const payeeKey = (p: Pick<Payment, 'recipientType' | 'recipientId' | 'recipientName'>) =>
  p.recipientId ? `${p.recipientType}:${p.recipientId}` : `name:${(p.recipientName ?? '').trim().toLowerCase()}`;

// Words that don't tell two shops apart ("Sam Hin" = "SAM HIN AUTO SERVICE").
const SHOP_WORDS = new Set(['sdn', 'bhd', 'berhad', 'enterprise', 'enterprises', 'trading', 'service', 'services', 'auto', 'motor', 'motors', 'workshop', 'garage', 'plt', 'co', 'company', 'centre', 'center', 'and', 'the', 'm', 's']);
export function payeeCore(name: string): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !SHOP_WORDS.has(w)).join(' ');
}

export type PayeeGroup = {
  key: string;
  name: string;
  bills: Payment[];   // the bills shown, newest keyed first
  cents: number;      // what is still owed on the bills shown
  newest: string;     // createdAt of the newest bill shown
  sameAs: string[];   // other payees that look like the same shop
  needsPanel: boolean;
};

// Groups bills by payee. Look-alike names are found across every bill given,
// then only the bills `keep` accepts are shown.
export function payeeGroups(bills: Payment[], centsOf: (p: Payment) => number, keep: (p: Payment) => boolean = () => true): PayeeGroup[] {
  const all = new Map<string, { name: string; at: string }>();
  for (const p of bills) {
    const k = payeeKey(p), seen = all.get(k);
    if (!seen || p.createdAt > seen.at) all.set(k, { name: p.recipientName || seen?.name || '', at: p.createdAt });
  }
  const byCore = new Map<string, string[]>();
  for (const [k, v] of all) {
    const c = payeeCore(v.name);
    if (c) byCore.set(c, [...(byCore.get(c) ?? []), k]);
  }
  const groups = new Map<string, PayeeGroup>();
  for (const p of bills) {
    if (!keep(p)) continue;
    const k = payeeKey(p);
    let g = groups.get(k);
    if (!g) {
      const name = all.get(k)?.name ?? p.recipientName;
      const twins = (byCore.get(payeeCore(name)) ?? []).filter((o) => o !== k).map((o) => all.get(o)?.name ?? '').filter(Boolean);
      g = { key: k, name, bills: [], cents: 0, newest: '', sameAs: twins, needsPanel: /to be chosen/i.test(name) || /to be chosen/i.test(p.recipientId ?? '') };
      groups.set(k, g);
    }
    g.bills.push(p);
    g.cents += centsOf(p);
    if (p.createdAt > g.newest) g.newest = p.createdAt;
  }
  const out = [...groups.values()];
  for (const g of out) g.bills.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return out.sort((a, b) => b.newest.localeCompare(a.newest) || b.cents - a.cents || a.name.localeCompare(b.name));
}

// ── Months ──────────────────────────────────────────────────────────────────

export type MonthBucket = { month: string; before: boolean; cents: number; count: number };

// Unpaid bills by the month they were keyed: the last `n` months up to
// `lastMonth`, with anything older folded into one "before" bucket first.
export function monthBuckets(bills: Payment[], centsOf: (p: Payment) => number, lastMonth: string, n = 8): MonthBucket[] {
  const first = addMonths(lastMonth, -(n - 1));
  const months: MonthBucket[] = Array.from({ length: n }, (_, i) => ({ month: addMonths(first, i), before: false, cents: 0, count: 0 }));
  const before: MonthBucket = { month: first, before: true, cents: 0, count: 0 };
  for (const p of bills) {
    const m = myMonth(p.createdAt);
    const b = m < first ? before : months.find((x) => x.month === m);
    if (!b) continue; // keyed after lastMonth
    b.cents += centsOf(p);
    b.count += 1;
  }
  return before.count ? [before, ...months] : months;
}

export const inBucket = (p: Payment, b: Pick<MonthBucket, 'month' | 'before'>) => {
  const m = myMonth(p.createdAt);
  return b.before ? m < b.month : m === b.month;
};

// ── Paperwork ───────────────────────────────────────────────────────────────

export type MissingItem = { paymentId: string; date: string | null; needInvoice: boolean; needReceipt: boolean };
export type DocCoverage = { flags: Map<string, { needInvoice: boolean; needReceipt: boolean }>; complete: boolean; coveredAfter: number | null };
export type DocState = 'need_invoice' | 'need_receipt' | 'need_both' | 'ok' | 'unknown';

// The missing-documents list holds the newest 500 bills (by paid date, else
// keyed date). A bill newer than the oldest one listed was checked; an older
// one may still be missing something we can't see.
export function docCoverage(items: MissingItem[], total: number): DocCoverage {
  const flags = new Map(items.map((d) => [d.paymentId, { needInvoice: !!d.needInvoice, needReceipt: !!d.needReceipt }]));
  const complete = total <= items.length;
  let oldest: number | null = null;
  for (const d of items) {
    const t = d.date ? Date.parse(d.date) : NaN;
    if (!Number.isNaN(t) && (oldest === null || t < oldest)) oldest = t;
  }
  return { flags, complete, coveredAfter: complete ? null : oldest };
}

export function docState(cov: DocCoverage | null, p: Pick<Payment, 'id' | 'createdAt' | 'transferredAt'>): DocState {
  if (!cov) return 'unknown';
  const f = cov.flags.get(p.id);
  if (f) return f.needInvoice && f.needReceipt ? 'need_both' : f.needInvoice ? 'need_invoice' : f.needReceipt ? 'need_receipt' : 'ok';
  if (cov.complete) return 'ok';
  const t = Date.parse(p.transferredAt || p.createdAt);
  return cov.coveredAfter !== null && !Number.isNaN(t) && t > cov.coveredAfter ? 'ok' : 'unknown';
}

// ── Paid ────────────────────────────────────────────────────────────────────

export type PaidLine = { id: string; date: string; text: string; details: { billIds?: string[]; done?: unknown } };
export type PaidGroup = {
  key: string;
  day: string;          // the day it was paid (Malaysia)
  names: string[];      // payees, one per name
  bills: Payment[];
  cents: number;
  lineId?: string;      // the bank statement line it was checked against
  lineText?: string;
};

export const paidCents = (p: Pick<Payment, 'amount' | 'bankPaidCents'>) => p.bankPaidCents ?? Math.round(p.amount * 100);

// Bank check pairs each statement line with bank entries in the books (see
// matchLines). Each entry names the bill it paid, so the line covers that bill.
export function billLinesFromMatches(matches: Map<string, string[]>, entries: Pick<JournalEntry, 'id' | 'sourceId'>[]): Map<string, string> {
  const billOf = new Map(entries.map((e) => [e.id, e.sourceId]));
  const out = new Map<string, string>();
  for (const [lineId, ids] of matches) for (const id of ids) { const bill = billOf.get(id); if (bill && !out.has(bill)) out.set(bill, lineId); }
  return out;
}

// One group per payment. Bills on the same bank statement line (ticked in Bank
// check, or matched through their books entry) go together; the rest group by
// payee and paid day.
export function paidGroups(paid: Payment[], lines: PaidLine[], billLine: Map<string, string> = new Map()): PaidGroup[] {
  const lineOf = new Map<string, PaidLine>();
  for (const l of lines) if (l.details?.done) for (const id of l.details.billIds ?? []) if (!lineOf.has(id)) lineOf.set(id, l);
  const byId = new Map(lines.map((l) => [l.id, l]));
  for (const [bill, lineId] of billLine) { const l = byId.get(lineId); if (l && !lineOf.has(bill)) lineOf.set(bill, l); }
  const groups = new Map<string, PaidGroup>();
  for (const p of paid) {
    const line = lineOf.get(p.id);
    const day = line?.date ?? myDay(p.transferredAt || p.createdAt);
    const k = line ? `line:${line.id}` : `day:${day}|${payeeKey(p)}`;
    let g = groups.get(k);
    if (!g) { g = { key: k, day, names: [], bills: [], cents: 0, ...(line ? { lineId: line.id, lineText: line.text } : {}) }; groups.set(k, g); }
    g.bills.push(p);
    g.cents += paidCents(p);
    if (p.recipientName && !g.names.includes(p.recipientName)) g.names.push(p.recipientName);
  }
  return [...groups.values()].sort((a, b) => b.day.localeCompare(a.day) || b.cents - a.cents);
}

export function namesLabel(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

// ── Owed to us ──────────────────────────────────────────────────────────────

export function ageDays(fromIso: string, today: string): number {
  const a = Date.parse(myDay(fromIso) + 'T00:00:00Z'), b = Date.parse(today + 'T00:00:00Z');
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.max(0, Math.round((b - a) / 86_400_000));
}
