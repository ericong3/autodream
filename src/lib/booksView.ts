// Accounting screens (This month, What we own and owe, Every entry): pure rules
// that turn the books into plain words. They only read entries and never change
// them. No I/O here, so the rules can be tested on their own. Money is in cents.
import type { JournalEntry, LedgerAccount, LedgerAccountType, Payment } from '../types';

export const cents = (rm: number) => Math.round((Number(rm) || 0) * 100);

type Acct = Pick<LedgerAccount, 'id' | 'name' | 'type'>;

// ── Plain names for the ledger accounts ─────────────────────────────────────

const PLAIN: Record<string, [string, string]> = {
  'acct-bank-operating': ['Old bank account', 'Money the books say was in the bank before the new bank accounts were set up.'],
  'acct-bank-investor': ['Investor bank money', 'Investor money the books say is in the bank.'],
  'acct-inv-own': ['Cars in stock', 'What our unsold cars cost us, with their repairs and other costs.'],
  'acct-inv-investor': ['Investor cars in stock', 'What unsold investor cars cost, with their repairs and other costs.'],
  'acct-ar': ['Owed to us', 'Money customers or banks still have to pay us, like loan money not in yet.'],
  'acct-consignor-ar': ['Owed by consignment owners', 'Money owners of consignment cars still have to pay us.'],
  'acct-supplier-credit': ['Refunds suppliers owe us', 'Money suppliers still have to give back to us.'],
  'acct-investor-supplier-credit': ['Supplier refunds on investor cars', 'Money suppliers still have to give back on investor cars.'],
  'acct-trade-in-clearing': ['Trade-ins being settled', 'Trade-in cars whose value is not yet fully settled in the deal.'],
  'acct-ap': ['Bills still to pay', 'Bills keyed in the app that we have not paid yet.'],
  'acct-customer-refunds': ['Refunds owed to customers', 'Money we still have to pay back to customers, like an overloan.'],
  'acct-uc-customer-refunds': ['Investor car refunds owed', 'Money from investor car sales that we still have to pay back to customers.'],
  'acct-investor-payable': ['Investor money we hold', 'Money investors put in that we still owe back to them.'],
  'acct-loan-subsidiary': ['Loan from our sister company', 'Money our sister company lent us.'],
  'acct-money-to-match': ['Money in, not matched yet', 'Money that came in but is not yet linked to a sale or a bill.'],
  'acct-outgoing-sale-review': ['Sales waiting for a cost check', 'Sold cars whose costs still need checking before the profit is counted.'],
  'acct-uc-sale-clearing': ['Investor car sales waiting', 'Investor car sale money waiting for the profit check.'],
  'acct-consign-clearing': ['Consignment deals being settled', 'Consignment car money not yet split with the owner.'],
  'acct-opening-review': ['Starting figures, to check', 'The starting figures from 1 Nov. They are temporary until all older statements are in.'],
  'acct-rev-car-sales': ['Car sales', 'What customers paid for cars.'],
  'acct-rev-commission': ['Commission and panel income', 'Income from loan panels and commissions.'],
  'acct-rev-consign': ['Our share of consignment profit', 'Our part of the profit on consignment cars.'],
  'acct-rev-investor-share': ['Our share of investor car profit', 'Our part of the profit on investor cars.'],
  'acct-cogs-own': ['Cost of cars sold', 'What the cars we sold cost us.'],
  'acct-exp-salesman-comm': ['Sales commission', 'Commission for the salesperson on each car sold.'],
  'acct-exp-source-comm': ['Source commission', 'Commission for whoever brought us the car.'],
  'acct-exp-intake-bonus': ['Intake bonus', 'Bonus for bringing a car into stock.'],
  'acct-exp-campaign-bonus': ['Staff bonus', 'Bonus paid to staff.'],
  'acct-exp-salary': ['Salaries', 'Basic pay for staff.'],
  'acct-exp-allowance': ['Allowances', 'Allowances paid to staff.'],
  'acct-exp-director-fee': ['Director fee', 'Fee paid to the director.'],
  'acct-exp-general': ['Running costs', 'Office and other day-to-day costs.'],
  'acct-exp-bank-processing-fee': ['Bank fees', 'Fees the bank or loan panel took.'],
  'acct-exp-panel': ['Dealer panel fees', 'Fees paid to dealer panels.'],
  'acct-exp-consign-loss': ['Consignment loss', 'What we lost on a fixed-price consignment car.'],
  'acct-exp-investor-profit-share': ["Investor's share of profit", 'The investor part of the profit on our cars.'],
};

const TYPE_EXPLAIN: Record<LedgerAccountType, string> = {
  asset: 'Something we own, or money owed to us.',
  liability: 'Money we owe to someone.',
  equity: "The owner's part of the business.",
  revenue: 'Money we earned.',
  cogs: 'What the cars we sold cost us.',
  expense: 'A cost of running the business.',
};

export const isBankAccount = (id: string) => id.startsWith('acct-bank-');

export function plainAccount(a: Acct): { name: string; explain: string } {
  const p = PLAIN[a.id];
  if (p) return { name: p[0], explain: p[1] };
  if (a.id.startsWith('acct-bank-uc-')) return { name: a.name, explain: 'Money in this bank account, by the books.' };
  return { name: a.name, explain: TYPE_EXPLAIN[a.type] ?? '' };
}

// ── Account totals ──────────────────────────────────────────────────────────

export type Totals = Map<string, { debit: number; credit: number }>;

export function accountTotals(entries: Pick<JournalEntry, 'lines' | 'voided'>[]): Totals {
  const out: Totals = new Map();
  for (const e of entries) {
    if (e.voided) continue;
    for (const l of e.lines ?? []) {
      const t = out.get(l.accountId) ?? { debit: 0, credit: 0 };
      t.debit += cents(l.debit);
      t.credit += cents(l.credit);
      out.set(l.accountId, t);
    }
  }
  return out;
}

const DEBIT_NORMAL: Record<LedgerAccountType, boolean> = { asset: true, expense: true, cogs: true, liability: false, equity: false, revenue: false };
export const netCents = (type: LedgerAccountType, t: { debit: number; credit: number }) => (DEBIT_NORMAL[type] ? t.debit - t.credit : t.credit - t.debit);

// ── What we own and owe ─────────────────────────────────────────────────────

export type OwnOweItem = { id: string; name: string; formal: string; explain: string; cents: number };
export type OwnOwe = {
  own: OwnOweItem[]; owe: OwnOweItem[]; ours: OwnOweItem[];
  ownCents: number; oweCents: number; oursCents: number; profitCents: number;
  gapCents: number; // what we own minus (what we owe + what is ours); 0 when the books add up
};

export const PROFIT_ITEM = { id: 'profit', name: 'Profit not closed yet', formal: 'Current period net income', explain: 'Sales minus costs so far. At the year end it moves into the owner’s part.' };

export function ownOwe(accounts: Acct[], totals: Totals): OwnOwe {
  const own: OwnOweItem[] = [], owe: OwnOweItem[] = [], ours: OwnOweItem[] = [];
  let profit = 0;
  for (const a of accounts) {
    const t = totals.get(a.id);
    if (!t) continue;
    const net = netCents(a.type, t);
    if (a.type === 'revenue') { profit += net; continue; }
    if (a.type === 'cogs' || a.type === 'expense') { profit -= net; continue; }
    if (!net) continue;
    const p = plainAccount(a);
    const item = { id: a.id, name: p.name, formal: a.name, explain: p.explain, cents: net };
    (a.type === 'asset' ? own : a.type === 'liability' ? owe : ours).push(item);
  }
  if (profit) ours.push({ ...PROFIT_ITEM, cents: profit });
  const sum = (xs: OwnOweItem[]) => xs.reduce((s, x) => s + x.cents, 0);
  const bySize = (a: OwnOweItem, b: OwnOweItem) => Math.abs(b.cents) - Math.abs(a.cents) || a.name.localeCompare(b.name);
  own.sort(bySize); owe.sort(bySize); ours.sort(bySize);
  const ownCents = sum(own), oweCents = sum(owe), oursCents = sum(ours);
  return { own, owe, ours, ownCents, oweCents, oursCents, profitCents: profit, gapCents: ownCents - oweCents - oursCents };
}

// How much one entry puts the books off. Balanced entries on known accounts
// add 0; the gaps of all entries sum to OwnOwe.gapCents.
export function entryGap(e: Pick<JournalEntry, 'lines' | 'voided'>, known: Set<string>): number {
  if (e.voided) return 0;
  let g = 0;
  for (const l of e.lines ?? []) if (known.has(l.accountId)) g += cents(l.debit) - cents(l.credit);
  return g;
}

// ── Every entry ─────────────────────────────────────────────────────────────

export type EntryKind = 'sold' | 'bought' | 'cost' | 'staff' | 'in' | 'out' | 'other';
export const ENTRY_KINDS: { key: EntryKind; label: string }[] = [
  { key: 'sold', label: 'Car sold' },
  { key: 'bought', label: 'Car bought' },
  { key: 'cost', label: 'Bill keyed' },
  { key: 'staff', label: 'Staff pay' },
  { key: 'in', label: 'Money in' },
  { key: 'out', label: 'Money out' },
  { key: 'other', label: 'Other' },
];

const STAFF = /commission|bonus|salary|allowance|director_fee/;
const STAFF_ACCOUNTS = new Set(['acct-exp-salesman-comm', 'acct-exp-source-comm', 'acct-exp-intake-bonus', 'acct-exp-campaign-bonus', 'acct-exp-salary', 'acct-exp-allowance', 'acct-exp-director-fee']);

// Money in or out of any bank account in the books, in cents (in is +).
export function bankCents(e: Pick<JournalEntry, 'lines'>): number {
  let c = 0;
  for (const l of e.lines ?? []) if (isBankAccount(l.accountId)) c += cents(l.debit) - cents(l.credit);
  return c;
}

// Starting figures: the bank opening entries and the legacy carry-overs that
// wait for review. They are not money moving, so they get no statement badge.
type OpeningProbe = Pick<JournalEntry, 'lines'> & Partial<Pick<JournalEntry, 'sourceId' | 'description'>>;
export const isOpening = (e: OpeningProbe) =>
  (e.sourceId ?? '').startsWith('opening:') || /^(registered )?bank opening/i.test(e.description ?? '') || (e.lines ?? []).some((l) => l.accountId === 'acct-opening-review');

export function entryKind(e: OpeningProbe & Pick<JournalEntry, 'sourceType'>): EntryKind {
  const st = e.sourceType ?? '';
  if (isOpening(e)) return 'other';
  if (st === 'car_sold') return 'sold';
  if (st === 'car_purchased' || st.startsWith('trade_in')) return 'bought';
  const bank = bankCents(e);
  if (bank > 0) return 'in';
  if (bank < 0) return 'out';
  if (STAFF.test(st) || (e.lines ?? []).some((l) => STAFF_ACCOUNTS.has(l.accountId) && l.debit > 0)) return 'staff';
  if ((e.lines ?? []).some((l) => l.accountId === 'acct-ap' && l.credit > 0)) return 'cost';
  return 'other';
}

// The amount to show for an entry. A sale shows the sale price (not the cost
// of the car taken out of stock); money in or out shows the bank move; any
// other entry shows its size.
export function entryAmount(e: OpeningProbe & Pick<JournalEntry, 'sourceType'>): number {
  if (isOpening(e)) return (e.lines ?? []).reduce((s, l) => s + cents(l.debit), 0);
  if (e.sourceType === 'car_sold') return (e.lines ?? []).filter((l) => !l.accountId.startsWith('acct-inv-')).reduce((s, l) => s + cents(l.credit), 0);
  const bank = bankCents(e);
  return bank || (e.lines ?? []).reduce((s, l) => s + cents(l.debit), 0);
}

export type Effect = { accountId: string; name: string; formal: string; cents: number };

// What each account did because of this entry, in plain words: + means it went up.
export function entryEffects(e: Pick<JournalEntry, 'lines'>, byId: Map<string, Acct>): Effect[] {
  const net = new Map<string, number>();
  for (const l of e.lines ?? []) net.set(l.accountId, (net.get(l.accountId) ?? 0) + cents(l.debit) - cents(l.credit));
  const out: Effect[] = [];
  for (const [id, dc] of net) {
    const a = byId.get(id);
    const c = a ? (DEBIT_NORMAL[a.type] ? dc : -dc) : dc;
    if (!c) continue;
    const p = a ? plainAccount(a) : { name: id };
    out.push({ accountId: id, name: p.name, formal: a?.name ?? id, cents: c });
  }
  return out;
}

const TITLE_SWAPS: [RegExp, string][] = [
  [/^registered bank opening.*/i, 'Bank starting figures'],
  [/^bank opening balance$/i, 'Bank starting figures'],
  [/^disbursement received$/i, 'Loan money came in'],
  [/^loan disbursement \(pending\)$/i, 'Loan money expected'],
  [/^loan disbursement$/i, 'Loan money'],
  [/^cash collection$/i, 'Customer paid'],
  [/^car purchased$/i, 'Car bought'],
  [/^trade-in acquired$/i, 'Trade-in car taken in'],
  [/^trade-in old loan top-up$/i, 'Trade-in old loan paid off'],
  [/^claim confirmed$/i, 'Expense claim'],
  [/^claim paid$/i, 'Expense claim paid'],
  [/^source comm\.$/i, 'Source commission'],
  [/^(.+) recognized$/i, '$1 bill'],
];

// "Repair recognized — Spray paint" → { title: 'Repair bill', detail: 'Spray paint' }.
export function entryWords(description: string): { title: string; detail: string } {
  const [head, ...rest] = String(description ?? '').split(' — ');
  let title = head.trim();
  for (const [re, to] of TITLE_SWAPS) if (re.test(title)) { title = title.replace(re, to); break; }
  return { title: title || 'Entry', detail: rest.join(' — ').trim() };
}

// Which bill an entry belongs to: most entries name the bill itself; the
// commission and bonus entries name the car instead.
export function billFinder(payments: Pick<Payment, 'id' | 'type' | 'carId'>[]) {
  const byId = new Map(payments.map((p) => [p.id, p.id]));
  const byCar = new Map<string, string>();
  for (const p of payments) if (p.carId && !byCar.has(`${p.type}:${p.carId}`)) byCar.set(`${p.type}:${p.carId}`, p.id);
  return (e: Pick<JournalEntry, 'sourceId' | 'sourceType' | 'carId'>): string | undefined => {
    if (e.sourceId && byId.has(e.sourceId)) return e.sourceId;
    const type = (e.sourceType ?? '').replace(/_paid$/, '');
    return byCar.get(`${type}:${e.carId ?? e.sourceId ?? ''}`);
  };
}

export type Proof = { label: string; state: 'yes' | 'no' | 'wait' };
export type ProofInput = {
  kind: EntryKind;
  voided: boolean;
  gapCents: number;
  bill: { paid: boolean; doc: 'need_invoice' | 'need_receipt' | 'need_both' | 'ok' | 'unknown' } | null;
  bank: 'none' | 'matched' | 'unmatched';
  moneyIn: boolean | null; // sold cars: has money come in for this car
};

// The small badges on each entry: what proof it has, what is missing, and
// what is not due yet.
export function entryProofs(x: ProofInput): Proof[] {
  if (x.voided) return [{ label: 'Cancelled, no longer counts', state: 'wait' }];
  const out: Proof[] = [];
  if (x.gapCents) out.push({ label: "Doesn't add up", state: 'no' });
  const invoice = (d: string) => (d === 'need_invoice' || d === 'need_both' ? 'no' : d === 'ok' || d === 'need_receipt' ? 'yes' : 'wait');
  const receipt = (d: string) => (d === 'need_receipt' || d === 'need_both' ? 'no' : d === 'ok' || d === 'need_invoice' ? 'yes' : 'wait');
  if (x.kind === 'sold') {
    out.push({ label: 'Sale', state: 'yes' });
    if (x.moneyIn !== null) out.push({ label: 'Money in', state: x.moneyIn ? 'yes' : 'wait' });
  } else if (x.kind === 'cost' || x.kind === 'staff') {
    out.push({ label: 'Bill', state: x.bill ? 'yes' : 'wait' });
    if (x.bill && x.kind === 'cost') out.push({ label: 'Invoice', state: invoice(x.bill.doc) });
    if (x.bill) out.push({ label: 'Paid', state: x.bill.paid ? 'yes' : 'wait' });
  } else if (x.kind === 'out' && x.bill) {
    out.push({ label: 'Bill', state: 'yes' });
    out.push({ label: 'Receipt', state: receipt(x.bill.doc) });
  }
  if (x.bank !== 'none') out.push({ label: 'Statement', state: x.bank === 'matched' ? 'yes' : 'wait' });
  return out;
}

// ── This month ──────────────────────────────────────────────────────────────

// Each part as RM per RM 100 of `total`, in cents (7207 = RM 72.07). When the
// parts add up to the total, the rounded parts add up to exactly RM 100.00.
export function perHundred(parts: { key: string; cents: number }[], total: number): { key: string; per100: number }[] {
  if (total <= 0) return parts.map((p) => ({ key: p.key, per100: 0 }));
  const raw = parts.map((p) => (p.cents * 10000) / total);
  const sum = parts.reduce((s, p) => s + p.cents, 0);
  const out = raw.map((r) => Math.floor(r));
  if (sum === total) {
    let left = 10000 - out.reduce((s, v) => s + v, 0);
    const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) { if (left <= 0) break; out[i] += 1; left -= 1; }
  } else {
    for (let i = 0; i < raw.length; i++) out[i] = Math.round(raw[i]);
  }
  return parts.map((p, i) => ({ key: p.key, per100: out[i] }));
}

// Months from `first` to `last`, both 'YYYY-MM', oldest first.
export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}$/.test(first) || !/^\d{4}-\d{2}$/.test(last)) return out;
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while ((y < ly || (y === ly && m <= lm)) && out.length < 240) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
