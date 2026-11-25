// Bank check: pure rules for lining up a bank statement with the app.
// No I/O here, so the rules can be tested on their own. Money is in cents;
// a statement line is negative when money left the bank.
import type { JournalEntry } from '../types';

export type BankCheckAnswer = { kind: string; type?: string; userId?: string; car?: string; month?: string; note?: string; at: string; by: string };
export type BankCheckDone = { how: 'recorded' | 'marked'; bankPaymentId?: string; journalIds?: string[]; at: string; by: string };
export type BankCheckDetails = {
  bankId?: string;
  seq?: number;          // order on the statement
  who?: string;          // who paid or was paid, as printed
  memo?: string;         // what the sender typed
  ref?: string;          // bank reference
  balanceCents?: number; // balance after this line, when the statement shows it
  payee?: string;        // the payee whose bills are being ticked
  alsoPayee?: string;    // a second payee whose bills this transfer also paid (e.g. Petrol keyed apart)
  billIds?: string[];    // bills this transfer paid (ticked, not yet recorded)
  billCents?: Record<string, number>; // part of a bill this transfer paid, when less than the whole bill (one bill paid in two transfers)
  addedBillIds?: string[]; // bills made from the Bank check page
  note?: string;         // a note from whoever prepared the ticks
  answer?: BankCheckAnswer;
  done?: BankCheckDone;
  // Lines from before the bank's start date in the app: answered as drafts only.
  history?: boolean;
  linkIds?: string[];    // books entries a history line is the same money as
  toAdd?: DraftBill[];   // bills a history line paid that were never keyed in
};
export type DraftBill = { plate: string; what: string; cents: number };
export type BankCheckLine = { id: string; date: string; cents: number; text: string; status: string; details: BankCheckDetails };
export type BankMove = { id: string; date: string; label: string; cents: number };
export type LineState = 'done' | 'ready' | 'answered' | 'needs';

export const toCents = (value: number) => Math.round(value * 100);

// Every non-voided books entry that moved money in or out of this bank account.
export function bankMoves(entries: Pick<JournalEntry, 'id' | 'date' | 'description' | 'lines' | 'voided'>[], accountId: string): BankMove[] {
  const out: BankMove[] = [];
  for (const e of entries) {
    if (e.voided) continue;
    let cents = 0;
    for (const l of e.lines ?? []) if (l.accountId === accountId) cents += toCents(Number(l.debit) || 0) - toCents(Number(l.credit) || 0);
    if (cents) out.push({ id: e.id, date: String(e.date).slice(0, 10), label: e.description ?? '', cents });
  }
  return out;
}

// Which books entries each statement line stands for. A line matches one entry
// with the same day and amount, or else all entries of that day with the same
// description that add up to it (one transfer that paid many bills). Each entry
// is used once. Lines recorded from the Bank check page name their own entries.
export function matchLines(lines: BankCheckLine[], moves: BankMove[]): Map<string, string[]> {
  const used = new Set<string>(), out = new Map<string, string[]>();
  const known = new Set(moves.map((m) => m.id));
  for (const l of lines) {
    const ids = (l.details.done?.journalIds ?? []).filter((id) => known.has(id) && !used.has(id));
    if (ids.length) { ids.forEach((id) => used.add(id)); out.set(l.id, ids); }
  }
  const order = lines.filter((l) => !out.has(l.id)).sort((a, b) => a.date.localeCompare(b.date) || (a.details.seq ?? 0) - (b.details.seq ?? 0));
  for (const l of order) {
    const one = moves.find((m) => m.date === l.date && m.cents === l.cents && !used.has(m.id));
    if (one) { used.add(one.id); out.set(l.id, [one.id]); }
  }
  for (const l of order) {
    if (out.has(l.id)) continue;
    const groups = new Map<string, BankMove[]>();
    for (const m of moves) if (m.date === l.date && !used.has(m.id) && Math.sign(m.cents) === Math.sign(l.cents)) groups.set(m.label, [...(groups.get(m.label) ?? []), m]);
    for (const g of groups.values()) {
      if (g.length > 1 && g.reduce((s, m) => s + m.cents, 0) === l.cents) { g.forEach((m) => used.add(m.id)); out.set(l.id, g.map((m) => m.id)); break; }
    }
  }
  return out;
}

export function lineState(line: BankCheckLine, matched: boolean, balanceOf: (billId: string) => number): LineState {
  if (matched || line.status === 'matched') return 'done';
  const ids = line.details.billIds ?? [];
  if (line.cents < 0 && ids.length && ids.reduce((s, id) => s + balanceOf(id), 0) === -line.cents) return 'ready';
  if (line.details.answer) return 'answered';
  return 'needs';
}

// One fixed id per statement line, so uploading the same statement twice adds nothing.
export function lineIds(bankId: string, rows: { date: string; cents: number }[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = `bc-${bankId.slice(0, 8)}-${r.date}-${r.cents < 0 ? 'o' : 'i'}${Math.abs(r.cents)}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return `${key}-${n}`;
  });
}

// Balance the bank shows at the end of `endDate`: the printed balance of the last
// line, or the opening balance plus every line when the statement has no balances.
export function bankSaysAt(lines: BankCheckLine[], openingCents: number, endDate: string): number {
  const upTo = lines.filter((l) => l.date <= endDate).sort((a, b) => a.date.localeCompare(b.date) || (a.details.seq ?? 0) - (b.details.seq ?? 0));
  const last = upTo[upTo.length - 1];
  if (last && Number.isSafeInteger(last.details.balanceCents)) return last.details.balanceCents!;
  return openingCents + upTo.reduce((s, l) => s + l.cents, 0);
}

// What the app's books say the bank held at the end of `date`.
export function appSaysAt(currentCents: number, moves: BankMove[], date: string): number {
  return currentCents - moves.filter((m) => m.date > date).reduce((s, m) => s + m.cents, 0);
}

const STOP = new Set(['sdn', 'bhd', 'enterprise', 'trading', 'the', 'and', 'auto', 'motor', 'motors', 'service', 'services', 'plt', 'company', 'centre', 'center', 'bin', 'binti', 'bte', 'anak']);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 3 && !STOP.has(w));

// The payee name that shares the most words with the statement text.
export function guessPayee(text: string, names: string[]): string | undefined {
  const have = new Set(words(text));
  let best: string | undefined, score = 0;
  for (const n of names) {
    const s = words(n).filter((w) => have.has(w)).length;
    if (s > score || (s === score && s > 0 && best && n.length > best.length)) { best = n; score = s; }
  }
  return score > 0 ? best : undefined;
}

export const samePlate = (a?: string, b?: string) => !!a && !!b && a.replace(/\s+/g, '').toUpperCase() === b.replace(/\s+/g, '').toUpperCase();
