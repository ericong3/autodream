import { Car, Payment, JournalEntry, LedgerAccount } from '../types';
import { generateLoanDisbursement } from './generatePayments';
import { buildDisbursementReceivedEntry } from './generateJournalEntries';

// The one place a bank disbursement actually gets recorded — originally lived
// only in History.tsx's "Record Bank Disbursement" modal; extracted so the
// Receivable tab's Collect flow can trigger the exact same car/payment/ledger
// update instead of drifting into its own, inevitably-diverging copy.
export interface RecordDisbursementInput {
  car: Car;
  grossAmount: number;   // "Total Price" — what the deal calls for the bank to pay
  netAmount: number;     // "Amount Disbursed" — what actually landed, after charges
  charges: { label: string; amount: number }[];
  date?: string;          // yyyy-mm-dd
  currentUserId: string;
}

export interface RecordDisbursementDeps {
  updateCar: (id: string, patch: Partial<Car>) => Promise<void>;
  payments: Payment[];
  addPayment: (p: Payment) => Promise<void>;
  updatePayment: (id: string, u: Partial<Payment>) => Promise<void>;
  ledgerAccounts: LedgerAccount[];
  addLedgerAccount: (a: LedgerAccount) => Promise<void>;
  journalEntries: JournalEntry[];
  addJournalEntry: (e: JournalEntry) => Promise<void>;
  voidJournalEntry: (id: string, userId: string, reason: string) => Promise<void>;
}

// Each distinct deduction label (Processing Fee, Service Charge, Insurance
// Cover Note, ...) gets its own expense account, created on first use.
async function getOrCreateChargeAccount(label: string, ledgerAccounts: LedgerAccount[], addLedgerAccount: RecordDisbursementDeps['addLedgerAccount']): Promise<string> {
  const trimmed = label.trim();
  const existing = ledgerAccounts.find(a => a.type === 'expense' && a.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing.id;
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || crypto.randomUUID().slice(0, 8);
  const id = `acct-exp-disb-${slug}`;
  await addLedgerAccount({ id, name: trimmed, type: 'expense' });
  return id;
}

export async function recordDisbursement(input: RecordDisbursementInput, deps: RecordDisbursementDeps): Promise<void> {
  const { car, grossAmount, netAmount, charges, date, currentUserId } = input;
  const { updateCar, payments, addPayment, updatePayment, ledgerAccounts, addLedgerAccount, journalEntries, addJournalEntry, voidJournalEntry } = deps;

  await updateCar(car.id, {
    moneyReceived: true,
    disbursementStatus: 'disbursed',
    disbursementAmount: netAmount,
    disbursementExpectedAmount: grossAmount || undefined,
    disbursementCharges: charges.length ? charges : undefined,
    disbursementDate: date || undefined,
  });
  // Merged locally rather than re-read from the store's car list — the
  // caller's `car` may be from a closure that won't see the optimistic
  // update above until its own next render, and disbursementDate here must
  // be what was just submitted, not whatever the car had before this call.
  const disbCar: Car = {
    ...car,
    moneyReceived: true,
    disbursementStatus: 'disbursed',
    disbursementAmount: netAmount,
    disbursementExpectedAmount: grossAmount || undefined,
    disbursementCharges: charges.length ? charges : undefined,
    disbursementDate: date || undefined,
  };

  if (grossAmount <= 0) return;
  await generateLoanDisbursement({ car: disbCar, disbursementAmount: grossAmount, payments, addPayment, updatePayment, transferredBy: currentUserId });

  // Clears the receivable booked at sale — skip dealer-consignment cars,
  // which never went through that sale entry in the first place.
  if (disbCar.consignment || disbCar.outgoingConsignment) return;

  const resolvedCharges: { accountId: string; amount: number }[] = [];
  for (const c of charges) {
    resolvedCharges.push({ accountId: await getOrCreateChargeAccount(c.label, ledgerAccounts, addLedgerAccount), amount: c.amount });
  }
  // Editing an already-disbursed car re-runs this — void the old ledger
  // entry first so the correction doesn't double-count the disbursement.
  const existingEntry = journalEntries.find(e => e.sourceType === 'disbursement_received' && e.sourceId === disbCar.id && !e.voided);
  if (existingEntry) {
    await voidJournalEntry(existingEntry.id, currentUserId, 'Disbursement details corrected');
  }
  await addJournalEntry(buildDisbursementReceivedEntry({
    car: disbCar, amount: grossAmount, netAmount, charges: resolvedCharges, createdBy: currentUserId,
  }));
}
