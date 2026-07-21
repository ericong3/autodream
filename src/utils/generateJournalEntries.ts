import { Car, JournalEntry, Payment } from '../types';
import { generateId } from './format';

// Seeded Chart of Accounts ids (see supabase/migrations/20260720_ledger_accounts.sql).
// Referenced by id rather than looked up by name since these are the core
// structural accounts the whole ledger depends on.
export const LEDGER_ACCOUNTS = {
  bankOperating: 'acct-bank-operating',
  bankInvestor: 'acct-bank-investor',
  inventoryOwn: 'acct-inv-own',
  inventoryInvestor: 'acct-inv-investor',
  accountsPayable: 'acct-ap',
  expenseGeneral: 'acct-exp-general',
} as const;

const today = () => new Date().toISOString().slice(0, 10);

// Confirming a claim is when it becomes accrual-recognized — car-tied claims
// capitalize into that car's inventory (own or investor stock, depending on
// who funded the car), non-car-tied claims hit General & Admin Expense
// immediately. Either way the other side is Accounts Payable, since nothing
// has actually been paid out yet.
export function buildClaimConfirmedEntry(opts: { claim: Payment; car?: Car; createdBy: string }): JournalEntry {
  const { claim, car, createdBy } = opts;
  const isCarClaim = !!claim.carId;
  const isInvestorCar = isCarClaim && !!car?.investorId;
  const debitAccountId = isCarClaim
    ? (isInvestorCar ? LEDGER_ACCOUNTS.inventoryInvestor : LEDGER_ACCOUNTS.inventoryOwn)
    : LEDGER_ACCOUNTS.expenseGeneral;
  return {
    id: generateId(),
    date: today(),
    description: `Claim confirmed — ${claim.description || claim.recipientName}`,
    lines: [
      { accountId: debitAccountId, debit: claim.amount, credit: 0 },
      { accountId: LEDGER_ACCOUNTS.accountsPayable, debit: 0, credit: claim.amount },
    ],
    sourceType: 'expense_claim_confirmed',
    sourceId: claim.id,
    carId: claim.carId,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

// Paying a confirmed claim clears the payable — cash comes from the
// investor's bank account only when it's actually their car being paid for,
// otherwise it's the company's own operating account.
export function buildClaimPaidEntry(opts: { claim: Payment; car?: Car; createdBy: string }): JournalEntry {
  const { claim, car, createdBy } = opts;
  const isInvestorCar = !!claim.carId && !!car?.investorId;
  const creditAccountId = isInvestorCar ? LEDGER_ACCOUNTS.bankInvestor : LEDGER_ACCOUNTS.bankOperating;
  return {
    id: generateId(),
    date: today(),
    description: `Claim paid — ${claim.description || claim.recipientName}`,
    lines: [
      { accountId: LEDGER_ACCOUNTS.accountsPayable, debit: claim.amount, credit: 0 },
      { accountId: creditAccountId, debit: 0, credit: claim.amount },
    ],
    sourceType: 'expense_claim_paid',
    sourceId: claim.id,
    carId: claim.carId,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}
