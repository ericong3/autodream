import { Car, Customer, JournalEntry, Payment, RepairJob } from '../types';
import { generateId } from './format';

// Seeded Chart of Accounts ids (see supabase/migrations/20260720_ledger_accounts.sql).
// Referenced by id rather than looked up by name since these are the core
// structural accounts the whole ledger depends on.
export const LEDGER_ACCOUNTS = {
  bankOperating: 'acct-bank-operating',
  bankInvestor: 'acct-bank-investor',
  inventoryOwn: 'acct-inv-own',
  inventoryInvestor: 'acct-inv-investor',
  accountsReceivable: 'acct-ar',
  accountsPayable: 'acct-ap',
  investorPayable: 'acct-investor-payable',
  revCarSales: 'acct-rev-car-sales',
  revInvestorShare: 'acct-rev-investor-share',
  cogsOwn: 'acct-cogs-own',
  expenseGeneral: 'acct-exp-general',
  expSalesmanComm: 'acct-exp-salesman-comm',
  expIntakeBonus: 'acct-exp-intake-bonus',
} as const;

const today = () => new Date().toISOString().slice(0, 10);

function carLabel(car: Car) {
  return `${car.year} ${car.make} ${car.model}${car.carPlate ? ` (${car.carPlate})` : ''}`;
}

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

// A car being added to inventory is treated as acquired the moment it's
// entered — dealer-consignment cars (someone else's car we're just selling
// on their behalf) are excluded entirely by the caller, since we never
// actually own or pay for those.
export function buildCarPurchaseEntry(opts: { car: Car; createdBy: string }): JournalEntry {
  const { car, createdBy } = opts;
  const isInvestorCar = !!car.investorId;
  const amount = car.purchasePrice ?? 0;
  return {
    id: generateId(),
    date: (car.dateAdded || today()).slice(0, 10),
    description: `Car purchased — ${carLabel(car)}`,
    lines: [
      { accountId: isInvestorCar ? LEDGER_ACCOUNTS.inventoryInvestor : LEDGER_ACCOUNTS.inventoryOwn, debit: amount, credit: 0 },
      { accountId: isInvestorCar ? LEDGER_ACCOUNTS.bankInvestor : LEDGER_ACCOUNTS.bankOperating, debit: 0, credit: amount },
    ],
    sourceType: 'car_purchased',
    sourceId: car.id,
    carId: car.id,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

// The realization event. Own-stock cars book full revenue/COGS to the
// company. Investor-funded cars never were the company's asset (floor-plan
// / consignment treatment) — only the company's split of the profit becomes
// company revenue; the investor's split (plus their capital coming back)
// adds to what's owed to them. Loan deals go through Accounts Receivable
// until the bank disbursement actually lands (see buildDisbursementReceivedEntry).
export function buildCarSaleEntry(opts: {
  car: Car;
  dealPrice: number;
  cost: number;
  isLoan: boolean;
  createdBy: string;
}): JournalEntry {
  const { car, dealPrice, cost, isLoan, createdBy } = opts;
  const isInvestorCar = !!car.investorId;
  const cashSideAccount = isLoan
    ? LEDGER_ACCOUNTS.accountsReceivable
    : (isInvestorCar ? LEDGER_ACCOUNTS.bankInvestor : LEDGER_ACCOUNTS.bankOperating);

  const lines = isInvestorCar
    ? (() => {
        const profit = dealPrice - cost;
        const investorSplit = (car.investorSplit ?? 50) / 100;
        const investorShare = profit * investorSplit;
        const companyShare = profit - investorShare;
        return [
          { accountId: cashSideAccount, debit: dealPrice, credit: 0 },
          { accountId: LEDGER_ACCOUNTS.inventoryInvestor, debit: 0, credit: cost },
          { accountId: LEDGER_ACCOUNTS.investorPayable, debit: 0, credit: investorShare },
          { accountId: LEDGER_ACCOUNTS.revInvestorShare, debit: 0, credit: companyShare },
        ];
      })()
    : [
        { accountId: cashSideAccount, debit: dealPrice, credit: 0 },
        { accountId: LEDGER_ACCOUNTS.revCarSales, debit: 0, credit: dealPrice },
        { accountId: LEDGER_ACCOUNTS.cogsOwn, debit: cost, credit: 0 },
        { accountId: LEDGER_ACCOUNTS.inventoryOwn, debit: 0, credit: cost },
      ];

  return {
    id: generateId(),
    date: today(),
    description: `Car sold — ${carLabel(car)}`,
    lines,
    sourceType: 'car_sold',
    sourceId: car.id,
    carId: car.id,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

// The moment a loan disbursement (or confirmed cash collection) actually
// lands — converts the receivable booked at sale into real cash.
export function buildDisbursementReceivedEntry(opts: { car: Car; amount: number; createdBy: string }): JournalEntry {
  const { car, amount, createdBy } = opts;
  const isInvestorCar = !!car.investorId;
  return {
    id: generateId(),
    date: today(),
    description: `Disbursement received — ${carLabel(car)}`,
    lines: [
      { accountId: isInvestorCar ? LEDGER_ACCOUNTS.bankInvestor : LEDGER_ACCOUNTS.bankOperating, debit: amount, credit: 0 },
      { accountId: LEDGER_ACCOUNTS.accountsReceivable, debit: 0, credit: amount },
    ],
    sourceType: 'disbursement_received',
    sourceId: car.id,
    carId: car.id,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

// Commission/intake bonus are system-generated already-vetted payables (no
// separate confirm step like claims have) — recognized immediately.
export function buildPayableRecognizedEntry(opts: {
  expenseAccountId: string;
  amount: number;
  description: string;
  car?: Car;
  sourceType: string;
  sourceId: string;
  createdBy: string;
}): JournalEntry {
  const { expenseAccountId, amount, description, car, sourceType, sourceId, createdBy } = opts;
  return {
    id: generateId(),
    date: today(),
    description,
    lines: [
      { accountId: expenseAccountId, debit: amount, credit: 0 },
      { accountId: LEDGER_ACCOUNTS.accountsPayable, debit: 0, credit: amount },
    ],
    sourceType,
    sourceId,
    carId: car?.id,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

// Generic "a payable got paid" — same shape regardless of what it was
// originally for, so it covers commission/intake bonus payouts too, not
// just expense claims.
export function buildPayablePaidEntry(opts: {
  amount: number;
  description: string;
  car?: Car;
  sourceType: string;
  sourceId: string;
  createdBy: string;
}): JournalEntry {
  const { amount, description, car, sourceType, sourceId, createdBy } = opts;
  const isInvestorCar = !!car?.investorId;
  return {
    id: generateId(),
    date: today(),
    description,
    lines: [
      { accountId: LEDGER_ACCOUNTS.accountsPayable, debit: amount, credit: 0 },
      { accountId: isInvestorCar ? LEDGER_ACCOUNTS.bankInvestor : LEDGER_ACCOUNTS.bankOperating, debit: 0, credit: amount },
    ],
    sourceType,
    sourceId,
    carId: car?.id,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

// One-time (repeatable/idempotent) catch-up for cars and payments that
// existed before this posting logic did — nothing about the app changes
// prospectively; this just fills in the ledger for history that already
// happened. Safe to run more than once: every entry is checked against
// sourceType+sourceId (matching what the live trigger points use) before
// being generated again.
export function collectMissingJournalEntries(opts: {
  cars: Car[];
  customers: Customer[];
  repairs: RepairJob[];
  payments: Payment[];
  journalEntries: JournalEntry[];
  createdBy: string;
}): JournalEntry[] {
  const { cars, customers, repairs, payments, journalEntries, createdBy } = opts;
  const result: JournalEntry[] = [];
  const hasEntry = (sourceType: string, sourceId: string) =>
    journalEntries.some(e => e.sourceType === sourceType && e.sourceId === sourceId) ||
    result.some(e => e.sourceType === sourceType && e.sourceId === sourceId);

  for (const car of cars) {
    // Dealer-consignment cars (in or out) are a separate, unrelated flow —
    // we never owned or paid for those, so nothing to book here.
    if (car.consignment || car.outgoingConsignment) continue;

    if (!hasEntry('car_purchased', car.id) && (car.purchasePrice ?? 0) > 0) {
      result.push(buildCarPurchaseEntry({ car, createdBy }));
    }

    if (car.status === 'delivered' && !hasEntry('car_sold', car.id)) {
      const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
      const wo = dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
      if (wo) {
        const isLoan = !!dealCustomer!.loanWorkOrder;
        const dealPrice = ((wo.sellingPrice ?? car.sellingPrice) - (wo.discount ?? 0)) || car.sellingPrice;
        const repairCost = repairs.filter(r => r.carId === car.id && r.status === 'done').reduce((s, r) => s + (r.actualCost ?? r.totalCost), 0);
        const miscCost = (car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0);
        const cost = (car.purchasePrice ?? 0) + repairCost + miscCost;
        result.push(buildCarSaleEntry({ car, dealPrice, cost, isLoan, createdBy }));

        if (isLoan && car.moneyReceived && (car.disbursementAmount ?? 0) > 0 && !hasEntry('disbursement_received', car.id)) {
          result.push(buildDisbursementReceivedEntry({ car, amount: car.disbursementAmount!, createdBy }));
        }
      }
    }

    const commissionPayment = payments.find(p => p.type === 'salesman_commission' && p.carId === car.id);
    if (commissionPayment) {
      if (!hasEntry('salesman_commission', car.id)) {
        result.push(buildPayableRecognizedEntry({
          expenseAccountId: LEDGER_ACCOUNTS.expSalesmanComm,
          amount: commissionPayment.amount,
          description: `Commission recognized — ${commissionPayment.recipientName}`,
          car, sourceType: 'salesman_commission', sourceId: car.id, createdBy,
        }));
      }
      if (commissionPayment.status === 'transferred' && !hasEntry('salesman_commission_paid', commissionPayment.id)) {
        result.push(buildPayablePaidEntry({
          amount: commissionPayment.amount,
          description: `Commission paid — ${commissionPayment.recipientName}`,
          car, sourceType: 'salesman_commission_paid', sourceId: commissionPayment.id, createdBy,
        }));
      }
    }

    const intakeBonusPayment = payments.find(p => p.type === 'intake_bonus' && p.carId === car.id);
    if (intakeBonusPayment) {
      if (!hasEntry('intake_bonus', car.id)) {
        result.push(buildPayableRecognizedEntry({
          expenseAccountId: LEDGER_ACCOUNTS.expIntakeBonus,
          amount: intakeBonusPayment.amount,
          description: `Intake bonus recognized — ${intakeBonusPayment.recipientName}`,
          car, sourceType: 'intake_bonus', sourceId: car.id, createdBy,
        }));
      }
      if (intakeBonusPayment.status === 'transferred' && !hasEntry('intake_bonus_paid', intakeBonusPayment.id)) {
        result.push(buildPayablePaidEntry({
          amount: intakeBonusPayment.amount,
          description: `Intake bonus paid — ${intakeBonusPayment.recipientName}`,
          car, sourceType: 'intake_bonus_paid', sourceId: intakeBonusPayment.id, createdBy,
        }));
      }
    }
  }

  return result;
}
