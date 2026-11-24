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
