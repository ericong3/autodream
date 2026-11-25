// Bank check words shared by the Bank check page and the Accounting Bank screen:
// the answer choices for a line, and the short note shown under each line.
import type { BankCheckLine, LineState } from './bankCheckMatch';

export const OUT_KINDS: [string, string][] = [['bills', 'Bills in To pay'], ['staff', 'Paid back to staff (they paid first)'], ['customer_refund', 'Paid back to a customer (overloan / refund)'], ['garage_back', 'Paid back to the garage'], ['office', 'Office cost'], ['car_purchase', 'Car purchase'], ['salary', 'Salary or director fee'], ['own_transfer', 'Moved to our other account'], ['other', 'Other']];
export const IN_KINDS: [string, string][] = [['car_sale', 'Customer paid for a car'], ['booking', 'Booking fee'], ['garage', 'Garage job'], ['garage_money', 'Garage money (used our card machine)'], ['director_in', 'A director put money in'], ['own_transfer', 'From our other account'], ['other', 'Other']];
export const kindLabel = (k?: string) => [...OUT_KINDS, ...IN_KINDS].find((x) => x[0] === k)?.[1] ?? k ?? '';

export function lineHint(l: BankCheckLine, s: LineState) {
  const memo = l.details.memo ? `"${l.details.memo}" · ` : '';
  if (s === 'done') return memo + 'In the app';
  if (s === 'ready') return memo + `${l.details.billIds?.length ?? 0} bills add up exactly. Check them and record.`;
  if (s === 'answered') return memo + 'You said: ' + kindLabel(l.details.answer?.kind) + (l.details.answer?.type ? ` · ${l.details.answer.type}` : '');
  return memo + (l.cents > 0 ? 'What was this money?' : 'Tick the bills, or say what it was');
}

// Extra choices for lines before the bank's start date in the app.
export const HISTORY_OUT_KINDS: [string, string][] = [...OUT_KINDS.filter(([k]) => k !== 'own_transfer' && k !== 'other'), ['loan_payoff', "Paid off a car's old loan"], ['investor_out', 'Paid an investor or consignment dealer'], ['own_transfer', 'Moved to the garage account'], ['other', 'Other']];
export const HISTORY_IN_KINDS: [string, string][] = [...IN_KINDS.filter(([k]) => k !== 'own_transfer' && k !== 'other'), ['loan_in', 'Car loan money from the bank'], ['investor_in', 'Investor money'], ['own_transfer', 'From the garage account'], ['other', 'Other']];
export const historyKindLabel = (k?: string) => [...HISTORY_OUT_KINDS, ...HISTORY_IN_KINDS].find((x) => x[0] === k)?.[1] ?? kindLabel(k);

export const CARD = 'bg-card-gradient border border-obsidian-400/70 rounded-xl';
export const dayLabel = (d: string) => new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
export const monthLabel = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
export const errorText = (e: unknown, fallback: string) => {
  if ((e as { code?: string } | null)?.code === 'RATE_LIMITED') return 'Too many requests from your account in the last few minutes. Wait about 10 minutes, then try again. Nothing you typed is lost.';
  return e instanceof Error && e.message ? e.message : fallback;
};
