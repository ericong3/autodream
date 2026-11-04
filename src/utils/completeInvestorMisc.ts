import { MiscCost } from '../types';
import { readPending, sendMutation } from '../lib/investorFinance';

export type SavedInvestorMisc = { carId: string; misc: MiscCost; billId: string; alreadyRecorded: boolean };

const ID = /^[A-Za-z0-9_-]{1,100}$/;
export const investorMiscSlot = (carId: string) => 'misc-record:' + carId;

// Records a misc cost on an investor-funded car through the private
// investor_finance 'record_misc' save. The server adds the cost to the car and
// raises one pending misc bill in a single transaction, so this never writes
// the public car row, a payment or a journal entry. One unconfirmed save is
// kept per car: a retry resends the original payload (same miscId and
// requestId) instead of the edited form, so it cannot be recorded twice.
export async function recordInvestorMiscCost(opts: {
  car: { id: string; investorFunded?: boolean };
  miscId: string;
  amount: number;
  purpose: string;
  payee: string;
  category?: string;
  currentUserId: string;
  retryOriginal?: boolean;
  applySaved?: (actorId: string, saved: SavedInvestorMisc) => void;
}): Promise<SavedInvestorMisc> {
  const { car, currentUserId } = opts;
  if (!car.investorFunded) throw new Error('This car is not investor-funded. Add the cost from the normal car screen.');
  const slot = investorMiscSlot(car.id);
  const pending = readPending(currentUserId).find(p => p.slot === slot && p.action === 'record_misc');
  if (opts.retryOriginal && !pending) throw new Error('There is no unconfirmed cost save. Refresh this car first.');
  let data: Record<string, unknown>;
  if (opts.retryOriginal && pending) data = pending.data;
  else {
    const amountCents = Math.round(opts.amount * 100);
    if (!Number.isFinite(opts.amount) || amountCents < 1 || amountCents > 1_000_000_000_000 || Math.abs(amountCents - opts.amount * 100) > 0.000001) throw new Error('Enter a cost above zero with no more than 2 decimal places.');
    if (!ID.test(opts.miscId)) throw new Error('Open the cost again.');
    const purpose = opts.purpose.trim(), payee = opts.payee.trim(), category = opts.category?.trim();
    if (!purpose || purpose.length > 300) throw new Error('Enter what the cost was for.');
    if (!payee || payee.length > 150) throw new Error('Enter who was paid.');
    if (category && category.length > 80) throw new Error('Check the category.');
    data = { carId: car.id, miscId: opts.miscId, amountCents, purpose, payee, ...(category ? { category } : {}) };
  }
  // sendMutation refuses (code PENDING) a different payload while an earlier save for this car is unconfirmed.
  const saved = await sendMutation<SavedInvestorMisc>(currentUserId, slot, 'record_misc', data, pending?.label ?? 'Misc cost');
  if (!saved || saved.carId !== data.carId || saved.misc?.id !== data.miscId) throw new Error('The server could not confirm this cost. Refresh this car before trying again.');
  opts.applySaved?.(currentUserId, saved);
  return saved;
}
