// Changing the price of a repair that already has a bill. The car's repair, its
// bill in To pay and its books entry must always say the same amount, so all
// three change together: the bill gets the new price, the old books entry is
// cancelled (kept as history, never deleted) and a new one is added at the new
// price, dated the same day as the old one. If any step fails, the steps
// already done are put back, so nothing is left half changed.
// Only unpaid bills: once money has gone out, the Director uses "Correct
// supplier bill" instead. No I/O of its own, so it can be tested on its own.
import type { Car, JournalEntry, Payment, RepairJob } from '../types';

export type RepairPriceDeps = {
  journalEntries: JournalEntry[];
  updatePayment: (id: string, patch: Partial<Payment>) => Promise<void>;
  voidJournalEntry: (id: string, by: string, reason: string) => Promise<void>;
  restoreJournalEntry: (id: string) => Promise<void>;
  addJournalEntry: (entry: JournalEntry) => Promise<void>;
  buildEntry: (o: { car: Car; amount: number; description: string; sourceType: string; sourceId: string; createdBy: string }) => JournalEntry;
};

const cents = (v: number) => Math.round((Number(v) || 0) * 100);
const rm = (v: number) => `RM ${(cents(v) / 100).toFixed(2)}`;
// The day a bill was keyed, in Malaysia time.
export const keyedDay = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 10);

export function repairBill(payments: Payment[], repairId: string): Payment | undefined {
  return payments.find((p) => p.type === 'repair' && p.repairJobId === repairId && !p.obligationReplaced);
}

// Why this price change can't go ahead, in plain words, or undefined when it can.
export function repairPriceBlock(o: { bill: Payment; car?: Car; isDirector: boolean; newPrice: number; carChanged: boolean }): string | undefined {
  const { bill, car, isDirector, newPrice, carChanged } = o;
  if (carChanged) return 'This repair already has a bill, so it can’t be moved to another car. Delete its bill in To pay, then key it again on the right car.';
  if (!isDirector) return 'This repair already has a bill. Only the Director can change its price, because the bill and the accounts book change with it.';
  if (bill.status === 'transferred' || (bill.bankPaidCents ?? 0) > 0) return 'This repair’s bill is already paid (fully or partly), so its price can’t be changed here. In To pay, open the bill’s Invoices & receipts and use Correct supplier bill.';
  if (!car) return 'This repair’s car was not found. Reload the page.';
  if (car.investorFunded || car.investorId) return 'This is an investor car. Change its bill in the investor car account.';
  if (!(cents(newPrice) > 0)) return 'The price must be more than RM 0. To remove the repair, delete its bill in To pay.';
  return undefined;
}

export async function changeRepairPrice(o: { repair: RepairJob; bill: Payment; car: Car; newPrice: number; actorId: string }, d: RepairPriceDeps): Promise<'unchanged' | 'changed'> {
  const { repair, bill, car, newPrice, actorId } = o;
  if (cents(bill.amount) === cents(newPrice)) return 'unchanged';
  const oldPrice = bill.amount;
  const old = d.journalEntries.filter((e) => !e.voided && e.sourceType === 'repair' && e.sourceId === bill.id);
  const date = old[0]?.date ?? keyedDay(bill.createdAt);

  await d.updatePayment(bill.id, { amount: newPrice });
  const cancelled: string[] = [];
  const undo = async () => {
    let ok = true;
    for (const id of cancelled) { try { await d.restoreJournalEntry(id); } catch { ok = false; } }
    try { await d.updatePayment(bill.id, { amount: oldPrice }); } catch { ok = false; }
    return ok;
  };
  try {
    for (const e of old) {
      await d.voidJournalEntry(e.id, actorId, `Repair price changed from ${rm(oldPrice)} to ${rm(newPrice)}; replaced by a new entry`);
      cancelled.push(e.id);
    }
    const entry = d.buildEntry({ car, amount: cents(newPrice) / 100, description: `Repair recognized — ${repair.typeOfRepair} (price corrected from ${rm(oldPrice)})`, sourceType: 'repair', sourceId: bill.id, createdBy: actorId });
    await d.addJournalEntry({ ...entry, date });
  } catch (err) {
    const ok = await undo();
    const why = err instanceof Error && err.message ? ` ${err.message}` : '';
    throw new Error(ok ? `Could not change the price, so nothing was changed.${why}` : `Could not change the price, and it could not all be put back. Tell Claude or check this bill in To pay.${why}`);
  }
  return 'changed';
}
