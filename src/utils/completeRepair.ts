import { Car, JournalEntry, Payment, RepairJob, Workshop } from '../types';
import { generateRepairPayment } from './generatePayments';
import { readPending, sendMutation } from '../lib/investorFinance';
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
  billDetails?: {parts: {name:string;cost:number}[];labourCost:number};
  retryOriginal?: boolean;
  applySavedRepair?: (actorId:string,row:any)=>void;
}): Promise<void> {
  const { repair, car, actualCost, receiptPhoto, currentUserId, payments, workshops, addPayment, updateRepair, addJournalEntry } = opts;

  if(car.investorFunded){
    const slot='repair-complete:'+repair.id;
    const cents=(value:number)=>{const amount=Math.round(value*100);if(!Number.isFinite(value)||value<0||amount>1_000_000_000_000||Math.abs(amount-value*100)>0.000001)throw new Error('Enter a repair cost with no more than 2 decimal places.');return amount;};
    const pending=readPending(currentUserId).find(p=>p.slot===slot&&p.action==='complete_repair');
    if(opts.retryOriginal&&!pending)throw new Error('There is no unconfirmed repair save. Refresh this repair first.');
    const data=opts.retryOriginal&&pending?pending.data:{repairId:repair.id,amountCents:cents(actualCost),...(receiptPhoto?{receiptPhoto}:{}),...(opts.billDetails?{billDetails:{parts:opts.billDetails.parts,labourCostCents:cents(opts.billDetails.labourCost)}}:{})};
    const saved=await sendMutation<{repair:Record<string,unknown>;billId:string|null}>(currentUserId,slot,'complete_repair',data,pending?.label??'Repair completion');
    opts.applySavedRepair?.(currentUserId,saved.repair);
    return;
  }

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
