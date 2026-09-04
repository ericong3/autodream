import { Car, JournalEntry, Payment, RepairJob, Workshop } from '../types';
import { generateRepairPayment } from './generatePayments';
import { buildCarCostRecognizedEntry } from './generateJournalEntries';

type AddPayment = (p: Payment) => Promise<void>;
type UpdateRepair = (id: string, repair: Partial<RepairJob>) => Promise<void>;
type AddJournalEntry = (entry: JournalEntry) => Promise<void>;

// Finishes a repair job: marks it done, creates the payment owed to the
// workshop, and recognizes the cost in the ledger (Dr Inventory, Cr
// Accounts Payable) — the same three steps regardless of whether this is
// triggered from a car's own page (mechanic/admin/director) or from the
// Admin Dashboard's "Fill in Bill" queue, so both paths stay in sync.
export async function completeRepairJob(opts: {
  repair: RepairJob;
  car: Car;
  actualCost: number;
  receiptPhoto?: string;
  currentUserId: string;
  payments: Payment[];
  workshops: Workshop[];
  addPayment: AddPayment;
  updateRepair: UpdateRepair;
  addJournalEntry: AddJournalEntry;
}): Promise<void> {
  const { repair, car, actualCost, receiptPhoto, currentUserId, payments, workshops, addPayment, updateRepair, addJournalEntry } = opts;

  await updateRepair(repair.id, {
    status: 'done',
    actualCost,
    receiptPhoto: receiptPhoto || undefined,
    completedAt: new Date().toISOString(),
  });

  const repairPaymentId = await generateRepairPayment({
    repair: { ...repair, actualCost },
    payments, workshops, addPayment,
  });

  if (repairPaymentId) {
    await addJournalEntry(buildCarCostRecognizedEntry({
      car, amount: actualCost,
      description: `Repair recognized — ${repair.typeOfRepair}`,
      sourceType: 'repair', sourceId: repairPaymentId, createdBy: currentUserId,
    }));
  }
}
