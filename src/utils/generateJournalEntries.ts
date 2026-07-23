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
  customerRefundsPayable: 'acct-customer-refunds',
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
// adds to what's owed to them.
//
// Cash deals are always collected in full before delivery, so the whole
// dealPrice hits Bank directly. Loan deals only send the bank-financed
// portion (loanAmount) to Accounts Receivable pending disbursement — the
// booking fee, plus any extra balance the customer still owed, is already
// collected before delivery too (per business rule) so that lands in Bank
// immediately. If the loan overshoots what's actually owed (net of booking
// fee), the excess was never really "collected" — it's booked as Customer
// Refunds Payable and gets transferred back to the customer after delivery.
export function buildCarSaleEntry(opts: {
  car: Car;
  dealPrice: number;
  cost: number;
  isLoan: boolean;
  loanAmount?: number;
  bookingFee?: number;
  createdBy: string;
}): JournalEntry {
  const { car, dealPrice, cost, isLoan, createdBy } = opts;
  const loanAmount = opts.loanAmount ?? 0;
  const bookingFee = opts.bookingFee ?? 0;
  const isInvestorCar = !!car.investorId;
  const bankAccount = isInvestorCar ? LEDGER_ACCOUNTS.bankInvestor : LEDGER_ACCOUNTS.bankOperating;

  // Amount still owed to the customer once the loan lands, beyond what the
  // deal actually calls for (net of the booking fee already collected).
  const refundOwed = isLoan ? Math.max(loanAmount - (dealPrice - bookingFee), 0) : 0;
  // Whatever was collected in cash before delivery — the whole price for a
  // cash deal, or booking fee + any customer-owed balance for a loan deal.
  const bankAmount = isLoan ? bookingFee + Math.max((dealPrice - bookingFee) - loanAmount, 0) : dealPrice;

  const cashLines = [
    ...(isLoan ? [{ accountId: LEDGER_ACCOUNTS.accountsReceivable, debit: loanAmount, credit: 0 }] : []),
    ...(bankAmount > 0 ? [{ accountId: bankAccount, debit: bankAmount, credit: 0 }] : []),
  ];
  const refundLine = refundOwed > 0
    ? [{ accountId: LEDGER_ACCOUNTS.customerRefundsPayable, debit: 0, credit: refundOwed }]
    : [];

  const lines = isInvestorCar
    ? (() => {
        const profit = dealPrice - cost;
        const investorSplit = (car.investorSplit ?? 50) / 100;
        const investorShare = profit * investorSplit;
        const companyShare = profit - investorShare;
        return [
          ...cashLines,
          { accountId: LEDGER_ACCOUNTS.inventoryInvestor, debit: 0, credit: cost },
          { accountId: LEDGER_ACCOUNTS.investorPayable, debit: 0, credit: investorShare },
          { accountId: LEDGER_ACCOUNTS.revInvestorShare, debit: 0, credit: companyShare },
          ...refundLine,
        ];
      })()
    : [
        ...cashLines,
        { accountId: LEDGER_ACCOUNTS.revCarSales, debit: 0, credit: dealPrice },
        ...refundLine,
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
  payableAccountId?: string;
}): JournalEntry {
  const { amount, description, car, sourceType, sourceId, createdBy } = opts;
  const payableAccountId = opts.payableAccountId ?? LEDGER_ACCOUNTS.accountsPayable;
  const isInvestorCar = !!car?.investorId;
  return {
    id: generateId(),
    date: today(),
    description,
    lines: [
      { accountId: payableAccountId, debit: amount, credit: 0 },
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
        const loanAmount = isLoan ? (car.disbursementAmount ?? dealCustomer!.loanWorkOrder!.loanAmount ?? 0) : 0;
        const bookingFee = wo.bookingFee ?? 0;
        const repairCost = repairs.filter(r => r.carId === car.id && r.status === 'done').reduce((s, r) => s + (r.actualCost ?? r.totalCost), 0);
        const miscCost = (car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0);
        const cost = (car.purchasePrice ?? 0) + repairCost + miscCost;
        result.push(buildCarSaleEntry({ car, dealPrice, cost, isLoan, loanAmount, bookingFee, createdBy }));

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

    // Refund owed is recognized inside buildCarSaleEntry itself (same
    // sourceType/sourceId as the sale) — only the "paid" side needs its own
    // catch-up here, once it's actually been transferred to the customer.
    const refundPayment = payments.find(p => p.type === 'customer_refund' && p.carId === car.id);
    if (refundPayment && refundPayment.status === 'transferred' && !hasEntry('customer_refund_paid', refundPayment.id)) {
      result.push(buildPayablePaidEntry({
        amount: refundPayment.amount,
        description: `Refund paid — ${refundPayment.recipientName}`,
        car, sourceType: 'customer_refund_paid', sourceId: refundPayment.id, createdBy,
        payableAccountId: LEDGER_ACCOUNTS.customerRefundsPayable,
      }));
    }
  }

  return result;
}

// A loan-deal sale posted before the AR/refund split fix booked the entire
// deal price as Accounts Receivable (no Bank line at all). Flags those for
// manual review/correction rather than guessing — some cars have more than
// one customer record with a loan work order pointing at them (re-submitted
// deals, bank changes), so which one was the real, completed deal isn't
// always mechanically resolvable. A car only qualifies if it has exactly one
// car_sold entry (voided-and-replaced cars already have two, and drop out
// naturally once corrected).
export interface StaleLoanSaleCandidate {
  customerId: string;
  customerName: string;
  loanAmount: number;
  bookingFee: number;
}
export interface StaleLoanSale {
  entry: JournalEntry;
  car: Car;
  dealPrice: number;
  cost: number;
  candidates: StaleLoanSaleCandidate[];
}
export function findStaleLoanSaleEntries(opts: {
  journalEntries: JournalEntry[];
  cars: Car[];
  customers: Customer[];
}): StaleLoanSale[] {
  const { journalEntries, cars, customers } = opts;
  const results: StaleLoanSale[] = [];
  for (const car of cars) {
    const carSoldEntries = journalEntries.filter((j) => j.sourceType === 'car_sold' && j.sourceId === car.id);
    if (carSoldEntries.length !== 1) continue;
    const entry = carSoldEntries[0];
    if (entry.voided) continue;
    const arLine = entry.lines.find((l) => l.accountId === LEDGER_ACCOUNTS.accountsReceivable);
    if (!arLine) continue;
    const hasBankLine = entry.lines.some((l) => l.accountId === LEDGER_ACCOUNTS.bankOperating || l.accountId === LEDGER_ACCOUNTS.bankInvestor);
    if (hasBankLine) continue;
    const cogsLine = entry.lines.find((l) => l.accountId === LEDGER_ACCOUNTS.cogsOwn || l.accountId === LEDGER_ACCOUNTS.inventoryInvestor);
    const dealPrice = arLine.debit;
    const cost = cogsLine ? (cogsLine.debit || cogsLine.credit) : 0;
    const seen = new Set<string>();
    const candidates = customers
      .filter((c) => c.loanWorkOrder && (c.loanWorkOrder.carId === car.id || c.interestedCarId === car.id))
      .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
      .map((c) => ({
        customerId: c.id,
        customerName: c.name,
        loanAmount: car.disbursementAmount ?? c.loanWorkOrder!.loanAmount ?? 0,
        bookingFee: c.loanWorkOrder!.bookingFee ?? 0,
      }));
    results.push({ entry, car, dealPrice, cost, candidates });
  }
  return results;
}
