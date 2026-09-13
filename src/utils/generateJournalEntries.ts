import { Car, Customer, JournalEntry, Payment, RepairJob, User } from '../types';
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
  tradeInClearing: 'acct-trade-in-clearing',
  investorPayable: 'acct-investor-payable',
  customerRefundsPayable: 'acct-customer-refunds',
  revCarSales: 'acct-rev-car-sales',
  revInvestorShare: 'acct-rev-investor-share',
  cogsOwn: 'acct-cogs-own',
  expenseGeneral: 'acct-exp-general',
  expSalesmanComm: 'acct-exp-salesman-comm',
  expIntakeBonus: 'acct-exp-intake-bonus',
  expSalary: 'acct-exp-salary',
  expAllowance: 'acct-exp-allowance',
  expDirectorFee: 'acct-exp-director-fee',
  expSourceComm: 'acct-exp-source-comm',
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

// Same idea as buildClaimConfirmedEntry's car-tied branch, but for repair/
// misc costs that never went through the Expense Claim flow (the older
// direct "Add Repair"/"Add Misc Cost" forms on a car). Without this, that
// cost only ever shows up when the car is sold (folded into COGS), with
// nothing ever crediting Bank when it's actually paid — so paying it for
// real would silently vanish from the books instead of clearing a payable.
export function buildCarCostRecognizedEntry(opts: {
  car: Car;
  amount: number;
  description: string;
  sourceType: string;
  sourceId: string;
  createdBy: string;
}): JournalEntry {
  const { car, amount, description, sourceType, sourceId, createdBy } = opts;
  const isInvestorCar = !!car.investorId;
  return {
    id: generateId(),
    date: today(),
    description,
    lines: [
      { accountId: isInvestorCar ? LEDGER_ACCOUNTS.inventoryInvestor : LEDGER_ACCOUNTS.inventoryOwn, debit: amount, credit: 0 },
      { accountId: LEDGER_ACCOUNTS.accountsPayable, debit: 0, credit: amount },
    ],
    sourceType,
    sourceId,
    carId: car.id,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

// A car being added to inventory is treated as acquired the moment it's
// entered — dealer-consignment cars (someone else's car we're just selling
// on their behalf) are excluded entirely by the caller, since we never
// actually own or pay for those.
//
// If part of purchasePrice is a settlement paid to a lender instead of the
// seller (settlementAmount), that portion hasn't left the bank yet — it's
// recognized as a payable instead of being credited straight to Bank.
export function buildCarPurchaseEntry(opts: { car: Car; createdBy: string }): JournalEntry {
  const { car, createdBy } = opts;
  const isInvestorCar = !!car.investorId;
  const amount = car.purchasePrice ?? 0;
  const settlement = Math.min(car.settlementAmount ?? 0, amount);
  const bankAccountId = isInvestorCar ? LEDGER_ACCOUNTS.bankInvestor : LEDGER_ACCOUNTS.bankOperating;
  return {
    id: generateId(),
    date: (car.dateAdded || today()).slice(0, 10),
    description: `Car purchased — ${carLabel(car)}`,
    lines: settlement > 0
      ? [
          { accountId: isInvestorCar ? LEDGER_ACCOUNTS.inventoryInvestor : LEDGER_ACCOUNTS.inventoryOwn, debit: amount, credit: 0 },
          { accountId: bankAccountId, debit: 0, credit: amount - settlement },
          { accountId: LEDGER_ACCOUNTS.accountsPayable, debit: 0, credit: settlement },
        ]
      : [
          { accountId: isInvestorCar ? LEDGER_ACCOUNTS.inventoryInvestor : LEDGER_ACCOUNTS.inventoryOwn, debit: amount, credit: 0 },
          { accountId: bankAccountId, debit: 0, credit: amount },
        ],
    sourceType: 'car_purchased',
    sourceId: car.id,
    carId: car.id,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

// A car acquired as a trade-in (comingSoonType 'trade_in') was never bought
// with cash — the customer handed it over instead of paying, as part of
// another deal. Booking it through buildCarPurchaseEntry would credit Bank
// for cash that never left, on top of the trade-in's original deal already
// crediting Revenue for the full price — a double-counted phantom cash swing
// in both directions. This credits Trade-In Clearing instead, which nets to
// zero once the other deal's buildCarSaleEntry (with tradeInValue set) posts
// its matching debit to the same account.
//
// Always books the trade-in's real agreed value here (tradeInPrice), not
// car.purchasePrice — for a "swap" deal those two differ (purchasePrice is
// set to the total cost of the deal it settled, for the app's own profit
// tracking on this car's eventual resale), but repair cost and commission
// on the *other* deal are already booked through their own normal entries.
// Using the inflated figure here would double-count them. The formal ledger
// stays anchored to what actually changed hands; car.purchasePrice is free
// to carry the higher management figure without the two needing to agree.
export function buildTradeInAcquiredEntry(opts: {
  car: Car;
  tradeInPrice: number;
  settlementFigure?: number;
  createdBy: string;
}): JournalEntry {
  const { car, tradeInPrice, createdBy } = opts;
  const settlement = Math.min(opts.settlementFigure ?? 0, tradeInPrice);
  const netTradeIn = tradeInPrice - settlement;
  return {
    id: generateId(),
    date: (car.dateAdded || today()).slice(0, 10),
    description: `Trade-in acquired — ${carLabel(car)}`,
    lines: [
      { accountId: LEDGER_ACCOUNTS.inventoryOwn, debit: tradeInPrice, credit: 0 },
      ...(netTradeIn > 0 ? [{ accountId: LEDGER_ACCOUNTS.tradeInClearing, debit: 0, credit: netTradeIn }] : []),
      ...(settlement > 0 ? [{ accountId: LEDGER_ACCOUNTS.accountsPayable, debit: 0, credit: settlement }] : []),
    ],
    sourceType: 'trade_in_acquired',
    sourceId: car.id,
    carId: car.id,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

// Reclassifies part of an already-posted car purchase from "paid in cash" to
// "still owed" — used when a settlement is discovered/added after the car
// was already booked in full (buildCarPurchaseEntry credited Bank for the
// whole purchasePrice at the time).
export function buildSettlementRecognizedEntry(opts: { car: Car; amount: number; createdBy: string }): JournalEntry {
  const { car, amount, createdBy } = opts;
  const isInvestorCar = !!car.investorId;
  const bankAccountId = isInvestorCar ? LEDGER_ACCOUNTS.bankInvestor : LEDGER_ACCOUNTS.bankOperating;
  return {
    id: generateId(),
    date: today(),
    description: `Settlement recognized — ${carLabel(car)}`,
    lines: [
      { accountId: bankAccountId, debit: amount, credit: 0 },
      { accountId: LEDGER_ACCOUNTS.accountsPayable, debit: 0, credit: amount },
    ],
    sourceType: 'purchase_settlement_recognized',
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
  // Net trade-in credited against this deal (tradeInPrice − settlementFigure
  // from the work order). Reduces what actually lands in Bank — this portion
  // of the price was paid with a car, not money — and instead debits
  // Trade-In Clearing, which nets to zero against the trade-in car's own
  // buildTradeInAcquiredEntry.
  tradeInValue?: number;
  createdBy: string;
}): JournalEntry {
  const { car, dealPrice, cost, isLoan, createdBy } = opts;
  const loanAmount = opts.loanAmount ?? 0;
  const bookingFee = opts.bookingFee ?? 0;
  const tradeInValue = opts.tradeInValue ?? 0;
  const isInvestorCar = !!car.investorId;
  const bankAccount = isInvestorCar ? LEDGER_ACCOUNTS.bankInvestor : LEDGER_ACCOUNTS.bankOperating;

  // Amount still owed to the customer once the loan lands, beyond what the
  // deal actually calls for (net of the booking fee already collected).
  const refundOwed = isLoan ? Math.max(loanAmount - (dealPrice - bookingFee), 0) : 0;
  // Whatever was collected in cash before delivery — the whole price for a
  // cash deal, or booking fee + any customer-owed balance for a loan deal —
  // less whatever was instead paid for with a trade-in.
  const bankAmount = Math.max(0,
    (isLoan ? bookingFee + Math.max((dealPrice - bookingFee) - loanAmount, 0) : dealPrice) - tradeInValue
  );

  const cashLines = [
    ...(isLoan ? [{ accountId: LEDGER_ACCOUNTS.accountsReceivable, debit: loanAmount, credit: 0 }] : []),
    ...(tradeInValue > 0 ? [{ accountId: LEDGER_ACCOUNTS.tradeInClearing, debit: tradeInValue, credit: 0 }] : []),
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
// lands — converts the receivable booked at sale into real cash. The
// receivable clears at the full (gross/expected) amount regardless — that's
// what the deal called for — but only the net amount actually lands in
// Bank; whatever the bank/panel deducted along the way (processing fee,
// service charge, insurance cover note, etc.) books as its own itemized
// expense line instead of quietly vanishing or being folded into an
// unrelated misc cost. netAmount + sum(charges) must equal amount for this
// to balance — callers are expected to enforce that before building it.
export function buildDisbursementReceivedEntry(opts: {
  car: Car;
  amount: number;
  netAmount: number;
  charges?: { accountId: string; amount: number }[];
  createdBy: string;
}): JournalEntry {
  const { car, amount, netAmount, createdBy } = opts;
  const charges = opts.charges ?? [];
  const isInvestorCar = !!car.investorId;
  return {
    id: generateId(),
    date: today(),
    description: `Disbursement received — ${carLabel(car)}`,
    lines: [
      { accountId: isInvestorCar ? LEDGER_ACCOUNTS.bankInvestor : LEDGER_ACCOUNTS.bankOperating, debit: netAmount, credit: 0 },
      ...charges.filter(c => c.amount > 0).map(c => ({ accountId: c.accountId, debit: c.amount, credit: 0 })),
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
  users: User[];
  createdBy: string;
}): JournalEntry[] {
  const { cars, customers, repairs, payments, journalEntries, users, createdBy } = opts;
  const result: JournalEntry[] = [];
  const hasEntry = (sourceType: string, sourceId: string) =>
    journalEntries.some(e => e.sourceType === sourceType && e.sourceId === sourceId) ||
    result.some(e => e.sourceType === sourceType && e.sourceId === sourceId);

  for (const car of cars) {
    // Dealer-consignment cars (in or out) are a separate, unrelated flow —
    // we never owned or paid for those, so nothing to book here.
    if (car.consignment || car.outgoingConsignment) continue;

    if (!hasEntry('car_purchased', car.id) && !hasEntry('trade_in_acquired', car.id) && (car.purchasePrice ?? 0) > 0) {
      if (car.comingSoonType === 'trade_in' && car.tradeInSourceCarId) {
        const sourceDealCustomer = customers.find(c => c.interestedCarId === car.tradeInSourceCarId && (c.cashWorkOrder || c.loanWorkOrder));
        const sourceWo = sourceDealCustomer?.loanWorkOrder ?? sourceDealCustomer?.cashWorkOrder;
        if (sourceWo && sourceWo.hasTradeIn) {
          result.push(buildTradeInAcquiredEntry({ car, tradeInPrice: sourceWo.tradeInPrice, settlementFigure: sourceWo.settlementFigure, createdBy }));
        }
      } else {
        result.push(buildCarPurchaseEntry({ car, createdBy }));
      }
    }

    if (car.status === 'delivered' && !hasEntry('car_sold', car.id)) {
      const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
      const wo = dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
      if (wo) {
        const isLoan = !!dealCustomer!.loanWorkOrder;
        const dealPrice = ((wo.sellingPrice ?? car.sellingPrice) - (wo.discount ?? 0)) || car.sellingPrice;
        const loanAmount = isLoan ? (car.disbursementExpectedAmount ?? car.disbursementAmount ?? dealCustomer!.loanWorkOrder!.loanAmount ?? 0) : 0;
        const bookingFee = wo.bookingFee ?? 0;
        const tradeInValue = wo.hasTradeIn ? Math.max(0, (wo.tradeInPrice ?? 0) - (wo.settlementFigure ?? 0)) : 0;
        const repairCost = repairs.filter(r => r.carId === car.id && r.status === 'done').reduce((s, r) => s + (r.actualCost ?? r.totalCost), 0);
        const miscCost = (car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0);
        const cost = (car.purchasePrice ?? 0) + repairCost + miscCost;
        result.push(buildCarSaleEntry({ car, dealPrice, cost, isLoan, loanAmount, bookingFee, tradeInValue, createdBy }));

        if (isLoan && car.moneyReceived && (car.disbursementAmount ?? 0) > 0 && !hasEntry('disbursement_received', car.id)) {
          // No dynamic per-label ledger accounts available in this backfill
          // context — lump any itemized charges into general expense instead.
          const chargesTotal = (car.disbursementCharges ?? []).reduce((s, c) => s + c.amount, 0);
          const grossAmount = car.disbursementExpectedAmount ?? (car.disbursementAmount! + chargesTotal);
          result.push(buildDisbursementReceivedEntry({
            car,
            amount: grossAmount,
            netAmount: car.disbursementAmount!,
            charges: chargesTotal > 0 ? [{ accountId: LEDGER_ACCOUNTS.expenseGeneral, amount: chargesTotal }] : [],
            createdBy,
          }));
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

    const sourceCommissionPayment = payments.find(p => p.type === 'source_commission' && p.carId === car.id);
    if (sourceCommissionPayment) {
      if (!hasEntry('source_commission', car.id)) {
        result.push(buildPayableRecognizedEntry({
          expenseAccountId: LEDGER_ACCOUNTS.expSourceComm,
          amount: sourceCommissionPayment.amount,
          description: `Source commission recognized — ${sourceCommissionPayment.recipientName}`,
          car, sourceType: 'source_commission', sourceId: car.id, createdBy,
        }));
      }
      if (sourceCommissionPayment.status === 'transferred' && !hasEntry('source_commission_paid', sourceCommissionPayment.id)) {
        result.push(buildPayablePaidEntry({
          amount: sourceCommissionPayment.amount,
          description: `Source commission paid — ${sourceCommissionPayment.recipientName}`,
          car, sourceType: 'source_commission_paid', sourceId: sourceCommissionPayment.id, createdBy,
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

    // Investor payout is recognized already, inside buildCarSaleEntry itself
    // (credited straight to Investor Capital Payable) — only the "paid" side
    // needs catching up here, same shape as the refund above.
    const investorPayoutPayment = payments.find(p => p.type === 'investor_payout' && p.carId === car.id);
    if (investorPayoutPayment && investorPayoutPayment.status === 'transferred' && !hasEntry('investor_payout_paid', investorPayoutPayment.id)) {
      result.push(buildPayablePaidEntry({
        amount: investorPayoutPayment.amount,
        description: `Investor payout paid — ${investorPayoutPayment.recipientName}`,
        car, sourceType: 'investor_payout_paid', sourceId: investorPayoutPayment.id, createdBy,
        payableAccountId: LEDGER_ACCOUNTS.investorPayable,
      }));
    }
  }

  // Payroll (salary/allowance) — not tied to a car, so walked separately from
  // the per-car loop above. Keyed by payment.id rather than a car id, since
  // that's the only stable identifier a monthly payroll run produces.
  for (const payment of payments) {
    if (payment.type !== 'salary' && payment.type !== 'allowance') continue;
    // Director's fees are a distinct statutory/tax category from staff salary
    // in Malaysia, so they're booked to their own expense account — same
    // mechanism, different line in the books.
    const isDirector = payment.type === 'salary' && users.find(u => u.id === payment.recipientId)?.role === 'director';
    const expenseAccountId = payment.type === 'allowance' ? LEDGER_ACCOUNTS.expAllowance
      : isDirector ? LEDGER_ACCOUNTS.expDirectorFee
      : LEDGER_ACCOUNTS.expSalary;
    const label = payment.type === 'salary' ? (isDirector ? 'Director Fee' : 'Salary') : 'Allowance';
    if (!hasEntry(payment.type, payment.id)) {
      result.push(buildPayableRecognizedEntry({
        expenseAccountId,
        amount: payment.amount,
        description: payment.description || `${label} — ${payment.recipientName}`,
        sourceType: payment.type, sourceId: payment.id, createdBy,
      }));
    }
    if (payment.status === 'transferred' && !hasEntry(`${payment.type}_paid`, payment.id)) {
      result.push(buildPayablePaidEntry({
        amount: payment.amount,
        description: `${label} paid — ${payment.recipientName}`,
        sourceType: `${payment.type}_paid`, sourceId: payment.id, createdBy,
      }));
    }
  }

  // Repairs/misc costs added the direct way (not through an Expense Claim)
  // never got their own recognized/paid pair — the cost only ever showed up
  // folded into COGS at car-sale time, with no matching Bank credit when it
  // was actually paid. Claim-originated repairs/misc are payment type
  // 'expense_claim' (already handled by their own confirm/paid entries), so
  // this loop naturally only catches the direct-added ones.
  for (const payment of payments) {
    if (payment.type !== 'repair' && payment.type !== 'misc_cost') continue;
    const car = cars.find(c => c.id === payment.carId);
    if (!car) continue;
    const label = payment.type === 'repair' ? 'Repair' : 'Misc cost';
    if (!hasEntry(payment.type, payment.id)) {
      result.push(buildCarCostRecognizedEntry({
        car, amount: payment.amount,
        description: `${label} recognized — ${payment.recipientName}`,
        sourceType: payment.type, sourceId: payment.id, createdBy,
      }));
    }
    if (payment.status === 'transferred' && !hasEntry(`${payment.type}_paid`, payment.id)) {
      result.push(buildPayablePaidEntry({
        amount: payment.amount,
        description: `${label} paid — ${payment.recipientName}`,
        car, sourceType: `${payment.type}_paid`, sourceId: payment.id, createdBy,
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
        loanAmount: car.disbursementExpectedAmount ?? car.disbursementAmount ?? c.loanWorkOrder!.loanAmount ?? 0,
        bookingFee: c.loanWorkOrder!.bookingFee ?? 0,
      }));
    results.push({ entry, car, dealPrice, cost, candidates });
  }
  return results;
}
