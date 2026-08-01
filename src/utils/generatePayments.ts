import { Car, Payment, RepairJob, MiscCost, User, ExternalSalesman, Workshop, Dealer, Merchant, Customer } from '../types';
import { generateId } from './format';

type AddPayment = (p: Payment) => Promise<void>;
type UpdatePayment = (id: string, u: Partial<Payment>) => Promise<void>;

// Single source of truth for "when did this car's sale actually complete" —
// used by the Delivered (History) page's own display/grouping/sort AND
// everywhere commission gets tallied (Commission page, sales dashboards,
// Payroll/Payslip, team member stats). deliveredAt (the real handover
// timestamp, set on the deal customer) wins — finalDeal.submittedAt is an
// earlier milestone (when the deal paperwork/price was finalized) that can
// predate actual delivery by weeks, which produced wrong months for cars
// with a gap between the two. dateAdded (inventory intake) is the last
// resort for cars with neither. commissionCreditedEarly +
// commissionCreditedMonth is the one carve-out — an explicit director choice
// for a not-yet-delivered car — and takes priority when set. History.tsx's
// drag-to-reassign feature updates deliveredAt directly (see updateCar/
// updateCustomer calls there) so a manual correction is honored everywhere
// this function is used, not just in the Delivered tab's own display.
export function getDeliveryDate(car: Car, customers: Customer[]): string {
  if (car.commissionCreditedEarly && car.commissionCreditedMonth) return `${car.commissionCreditedMonth}-01`;
  const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
  return dealCustomer?.deliveredAt ?? car.finalDeal?.submittedAt ?? car.dateAdded;
}
export function getCommissionMonth(car: Car, customers: Customer[]): string {
  return getDeliveryDate(car, customers).slice(0, 7);
}

// Sundays are the standing off-day for everyone — the divisor for proration
// is working days in the month, not raw calendar days.
function isWorkingDay(year: number, monthNum: number, day: number): boolean {
  return new Date(year, monthNum - 1, day).getDay() !== 0; // 0 = Sunday
}
function countWorkingDays(year: number, monthNum: number, fromDay: number, toDay: number): number {
  let count = 0;
  for (let day = fromDay; day <= toDay; day++) {
    if (isWorkingDay(year, monthNum, day)) count++;
  }
  return count;
}

// Prorates a monthly rate for whichever calendar month someone joined in —
// e.g. July has 31 days minus 4 Sundays = 27 working days; joining on the
// 6th (a working day before it counts too) means working days worked / 27
// of the full rate for that one month. Only applies to the joining month
// itself; every month after (or before joining) gets the full rate (factor
// 1). No leaving-date equivalent exists yet — this only covers the start of
// employment.
export function getProrationFactor(u: User, month: string): number {
  if (!u.joiningDate || !u.joiningDate.startsWith(month)) return 1;
  const joinDay = Number(u.joiningDate.slice(8, 10));
  const [year, monthNum] = month.split('-').map(Number);
  const totalDaysInMonth = new Date(year, monthNum, 0).getDate();
  const totalWorkingDays = countWorkingDays(year, monthNum, 1, totalDaysInMonth);
  if (totalWorkingDays === 0) return 1;
  const workingDaysWorked = countWorkingDays(year, monthNum, joinDay, totalDaysInMonth);
  return Math.max(0, Math.min(1, workingDaysWorked / totalWorkingDays));
}

// ── Duplicate guard ───────────────────────────────────────────────────────────
function exists(
  payments: Payment[],
  type: Payment['type'],
  opts: { carId?: string; repairJobId?: string; miscCostId?: string },
) {
  return payments.some(p =>
    p.type === type &&
    (!opts.carId       || p.carId       === opts.carId) &&
    (!opts.repairJobId || p.repairJobId === opts.repairJobId) &&
    (!opts.miscCostId  || p.miscCostId  === opts.miscCostId),
  );
}

// ── Delivery payments ─────────────────────────────────────────────────────────
export async function generateDeliveryPayments(opts: {
  car: Car;
  payments: Payment[];
  users: User[];
  externalSalesmen: ExternalSalesman[];
  dealers: Dealer[];
  customers: Customer[];
  addPayment: AddPayment;
}) {
  const { car, payments, users, externalSalesmen, dealers, customers, addPayment } = opts;
  const now = new Date().toISOString();
  const label = `${car.make} ${car.model}${car.carPlate ? ` (${car.carPlate})` : ''}`;

  const dealCustomer = customers.find(c =>
    c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder),
  );
  const wo = dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
  const dealPrice = ((wo?.sellingPrice ?? car.sellingPrice) - (wo?.discount ?? 0)) || car.sellingPrice;

  // Salesman commission
  if (car.assignedSalesperson && !car.outgoingConsignment && !car.isStaffSale && !car.waiveCommission) {
    const sp = users.find(u => u.id === car.assignedSalesperson);
    if (sp && !exists(payments, 'salesman_commission', { carId: car.id })) {
      const effectiveFloor = car.priceFloor ?? car.sellingPrice;
        const amount = (car.consignment || dealPrice < effectiveFloor) ? 1000 : 1500;
      await addPayment({
        id: generateId(), type: 'salesman_commission', carId: car.id,
        recipientType: 'user', recipientId: sp.id, recipientName: sp.name,
        bankName: sp.bankName, accountNumber: sp.bankAccountNumber, accountHolder: sp.bankAccountHolder,
        amount, description: `Commission — ${label}`, status: 'pending', createdAt: now,
      });
    }
  }

  // Intake bonus
  if ((car.intakeCommission ?? 0) > 0 && car.assignedSalesperson) {
    const sp = users.find(u => u.id === car.assignedSalesperson);
    if (sp && !exists(payments, 'intake_bonus', { carId: car.id })) {
      await addPayment({
        id: generateId(), type: 'intake_bonus', carId: car.id,
        recipientType: 'user', recipientId: sp.id, recipientName: sp.name,
        bankName: sp.bankName, accountNumber: sp.bankAccountNumber, accountHolder: sp.bankAccountHolder,
        amount: car.intakeCommission!, description: `Intake bonus — ${label}`, status: 'pending', createdAt: now,
      });
    }
  }

  // Source commission
  if ((car.sourceCommission ?? 0) > 0) {
    if (car.sourceType === 'external' && car.externalSalesmanId) {
      const ext = externalSalesmen.find(e => e.id === car.externalSalesmanId);
      if (ext && !exists(payments, 'source_commission', { carId: car.id })) {
        await addPayment({
          id: generateId(), type: 'source_commission', carId: car.id,
          recipientType: 'external_salesman', recipientId: ext.id, recipientName: ext.name,
          bankName: ext.bank, accountNumber: ext.bankAccount,
          amount: car.sourceCommission!, description: `Source comm. — ${label}`, status: 'pending', createdAt: now,
        });
      }
    } else if (car.sourceType === 'internal' && car.sourceSalesmanId) {
      const sp = users.find(u => u.id === car.sourceSalesmanId);
      if (sp && !exists(payments, 'source_commission', { carId: car.id })) {
        await addPayment({
          id: generateId(), type: 'source_commission', carId: car.id,
          recipientType: 'user', recipientId: sp.id, recipientName: sp.name,
          bankName: sp.bankName, accountNumber: sp.bankAccountNumber, accountHolder: sp.bankAccountHolder,
          amount: car.sourceCommission!, description: `Source comm. — ${label}`, status: 'pending', createdAt: now,
        });
      }
    }
  }

  // Consignment payout (incoming consignment — we owe consignor)
  if (car.consignment && !exists(payments, 'consignment_payout', { carId: car.id })) {
    const c = car.consignment;
    let amount = 0;
    if (c.terms === 'fixed_amount' && c.fixedAmount) {
      amount = c.fixedAmount;
    } else if (c.terms === 'profit_split' && c.splitPercent) {
      amount = Math.max(0, (dealPrice - car.purchasePrice) * (c.splitPercent / 100));
    }
    if (amount > 0) {
      const dealer = dealers.find(d => d.name.toLowerCase() === c.dealer.toLowerCase());
      await addPayment({
        id: generateId(), type: 'consignment_payout', carId: car.id,
        recipientType: 'dealer', recipientId: dealer?.id ?? c.dealer, recipientName: c.dealer,
        bankName: dealer?.bankName, accountNumber: dealer?.bankAccountNumber, accountHolder: dealer?.bankAccountHolder,
        amount, description: `Consignment payout — ${label}`, status: 'pending', createdAt: now,
      });
    }
  }

  // Consignment collection (outgoing consignment — dealer owes us)
  if (car.outgoingConsignment && !exists(payments, 'consignment_collection', { carId: car.id })) {
    const oc = car.outgoingConsignment;
    let amount = 0;
    if (oc.terms === 'fixed_amount' && oc.fixedAmount) {
      amount = oc.fixedAmount;
    } else if (oc.terms === 'profit_split' && oc.splitPercent) {
      amount = Math.max(0, dealPrice * (oc.splitPercent / 100));
    }
    if (amount > 0 && oc.dealer) {
      const dealer = dealers.find(d => d.name.toLowerCase() === oc.dealer.toLowerCase());
      await addPayment({
        id: generateId(), type: 'consignment_collection', carId: car.id,
        recipientType: 'dealer', recipientId: dealer?.id ?? oc.dealer, recipientName: oc.dealer,
        bankName: dealer?.bankName, accountNumber: dealer?.bankAccountNumber, accountHolder: dealer?.bankAccountHolder,
        amount, description: `Consignment collection — ${label}`, status: 'pending', createdAt: now,
      });
    }
  }

  // Investor payout (profit share)
  if (car.investorId && (car.investorSplit ?? 50) > 0) {
    const investor = users.find(u => u.id === car.investorId);
    if (investor && !exists(payments, 'investor_payout', { carId: car.id })) {
      const profit = dealPrice - car.purchasePrice;
      const amount = Math.max(0, profit * ((car.investorSplit ?? 50) / 100));
      if (amount > 0) {
        await addPayment({
          id: generateId(), type: 'investor_payout', carId: car.id,
          recipientType: 'user', recipientId: investor.id, recipientName: investor.name,
          bankName: investor.bankName, accountNumber: investor.bankAccountNumber, accountHolder: investor.bankAccountHolder,
          amount, description: `Investor payout ${car.investorSplit ?? 50}% — ${label}`, status: 'pending', createdAt: now,
        });
      }
    }
  }

  // Customer collection — cash deal (we need to collect from customer)
  if (dealCustomer?.cashWorkOrder && !exists(payments, 'customer_collection', { carId: car.id })) {
    const cwo = dealCustomer.cashWorkOrder;
    const additionalTotal = cwo.additionalItems?.reduce((s, i) => s + i.amount, 0) ?? 0;
    const tradeInCredit = cwo.hasTradeIn ? Math.max(0, (cwo.tradeInPrice ?? 0) - (cwo.settlementFigure ?? 0)) : 0;
    const total = (cwo.sellingPrice - (cwo.discount ?? 0))
      + (cwo.insurance ?? 0)
      + (cwo.bankProduct ?? 0)
      + additionalTotal
      - (cwo.bookingFee ?? 0)
      - (cwo.downpayment ?? 0)
      - tradeInCredit;
    if (total > 0) {
      await addPayment({
        id: generateId(), type: 'customer_collection', carId: car.id,
        recipientType: 'customer', recipientId: dealCustomer.id, recipientName: dealCustomer.name,
        amount: total, description: `Cash collection — ${label}`, status: 'pending', createdAt: now,
      });
    }
  }
}

// ── Repair payment ─────────────────────────────────────────────────────────────
export async function generateRepairPayment(opts: {
  repair: RepairJob;
  payments: Payment[];
  workshops: Workshop[];
  addPayment: AddPayment;
}) {
  const { repair, payments, workshops, addPayment } = opts;
  if (!repair.location) return;
  if (exists(payments, 'repair', { repairJobId: repair.id })) return;
  const amount = repair.actualCost ?? repair.totalCost;
  if (amount <= 0) return;
  const ws = workshops.find(w => w.name.toLowerCase() === repair.location!.toLowerCase());
  await addPayment({
    id: generateId(), type: 'repair', carId: repair.carId, repairJobId: repair.id,
    recipientType: 'workshop', recipientId: ws?.id ?? repair.location, recipientName: repair.location,
    bankName: ws?.bankName, accountNumber: ws?.bankAccountNumber, accountHolder: ws?.bankAccountHolder,
    amount, description: `${repair.typeOfRepair} repair`, status: 'pending', createdAt: new Date().toISOString(),
    receiptUrl: repair.receiptPhoto,
  });
}

// ── Misc cost payment ─────────────────────────────────────────────────────────
export async function generateMiscCostPayment(opts: {
  carId: string;
  misc: MiscCost;
  payments: Payment[];
  merchants: Merchant[];
  addPayment: AddPayment;
}) {
  const { carId, misc, payments, merchants, addPayment } = opts;
  if (!misc.merchant) return;
  if (exists(payments, 'misc_cost', { miscCostId: misc.id })) return;
  const merchant = merchants.find(m => m.name.toLowerCase() === misc.merchant!.toLowerCase());
  await addPayment({
    id: generateId(), type: 'misc_cost', carId, miscCostId: misc.id,
    recipientType: 'merchant', recipientId: merchant?.id ?? misc.merchant, recipientName: misc.merchant,
    bankName: merchant?.bankName, accountNumber: merchant?.bankAccountNumber, accountHolder: merchant?.bankAccountHolder,
    amount: misc.amount, description: misc.description || 'Misc cost', status: 'pending', createdAt: new Date().toISOString(),
  });
}

// ── Panel charge payment ──────────────────────────────────────────────────────
export async function generatePanelChargePayment(opts: {
  carId: string;
  dealerId: string;
  chargeAmount: number;
  payments: Payment[];
  dealers: Dealer[];
  addPayment: AddPayment;
  updatePayment: UpdatePayment;
}) {
  const { carId, dealerId, chargeAmount, payments, dealers, addPayment, updatePayment } = opts;
  if (chargeAmount <= 0) return;
  const dealer = dealers.find(d => d.id === dealerId);
  if (!dealer) return;
  const existing = payments.find(p => p.type === 'panel_charge' && p.carId === carId && p.status === 'pending');
  if (existing) {
    await updatePayment(existing.id, {
      recipientId: dealer.id, recipientName: dealer.name,
      bankName: dealer.bankName, accountNumber: dealer.bankAccountNumber, accountHolder: dealer.bankAccountHolder,
      amount: chargeAmount,
    });
  } else {
    await addPayment({
      id: generateId(), type: 'panel_charge', carId,
      recipientType: 'dealer', recipientId: dealer.id, recipientName: dealer.name,
      bankName: dealer.bankName, accountNumber: dealer.bankAccountNumber, accountHolder: dealer.bankAccountHolder,
      amount: chargeAmount, description: `Panel charge — ${dealer.name}`, status: 'pending', createdAt: new Date().toISOString(),
    });
  }
}

// ── Loan disbursement (bank pays us) ─────────────────────────────────────────
export async function generateLoanDisbursement(opts: {
  car: Car;
  disbursementAmount: number;
  payments: Payment[];
  addPayment: AddPayment;
  updatePayment: UpdatePayment;
}) {
  const { car, disbursementAmount, payments, addPayment, updatePayment } = opts;
  if (disbursementAmount <= 0) return;
  const label = `${car.make} ${car.model}${car.carPlate ? ` (${car.carPlate})` : ''}`;
  const existing = payments.find(p => p.type === 'loan_disbursement' && p.carId === car.id);
  if (existing) {
    await updatePayment(existing.id, { amount: disbursementAmount });
  } else {
    await addPayment({
      id: generateId(), type: 'loan_disbursement', carId: car.id,
      recipientType: 'customer', recipientId: car.id, recipientName: `Bank — ${label}`,
      amount: disbursementAmount, description: `Loan disbursement — ${label}`, status: 'pending', createdAt: new Date().toISOString(),
    });
  }
}

// ── Backfill: collect all missing payment entries ─────────────────────────────
export function collectMissingPayments(data: {
  cars: Car[];
  customers: Customer[];
  repairs: RepairJob[];
  users: User[];
  externalSalesmen: ExternalSalesman[];
  dealers: Dealer[];
  workshops: Workshop[];
  merchants: Merchant[];
  payments: Payment[];
}): Payment[] {
  const { cars, customers, repairs, users, externalSalesmen, dealers, workshops, merchants, payments } = data;
  const result: Payment[] = [];

  const alreadyExists = (type: Payment['type'], opts: { carId?: string; repairJobId?: string; miscCostId?: string }) =>
    exists([...payments, ...result], type, opts);

  for (const car of cars) {
    if (car.status !== 'delivered') continue;
    const label = `${car.make} ${car.model}${car.carPlate ? ` (${car.carPlate})` : ''}`;
    const dealCustomer = customers.find(c =>
      c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder),
    );
    const wo = dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
    const dealPrice = ((wo?.sellingPrice ?? car.sellingPrice) - (wo?.discount ?? 0)) || car.sellingPrice;

    // Salesman commission
    if (car.assignedSalesperson && !car.outgoingConsignment && !car.isStaffSale && !car.waiveCommission && !alreadyExists('salesman_commission', { carId: car.id })) {
      const sp = users.find(u => u.id === car.assignedSalesperson);
      if (sp) {
        const effectiveFloor = car.priceFloor ?? car.sellingPrice;
        const amount = (car.consignment || dealPrice < effectiveFloor) ? 1000 : 1500;
        result.push({
          id: generateId(), type: 'salesman_commission', carId: car.id,
          recipientType: 'user', recipientId: sp.id, recipientName: sp.name,
          bankName: sp.bankName, accountNumber: sp.bankAccountNumber, accountHolder: sp.bankAccountHolder,
          amount, description: `Commission — ${label}`, status: 'pending', createdAt: car.dateAdded,
        });
      }
    }

    // Intake bonus
    if ((car.intakeCommission ?? 0) > 0 && car.assignedSalesperson && !alreadyExists('intake_bonus', { carId: car.id })) {
      const sp = users.find(u => u.id === car.assignedSalesperson);
      if (sp) result.push({
        id: generateId(), type: 'intake_bonus', carId: car.id,
        recipientType: 'user', recipientId: sp.id, recipientName: sp.name,
        bankName: sp.bankName, accountNumber: sp.bankAccountNumber, accountHolder: sp.bankAccountHolder,
        amount: car.intakeCommission!, description: `Intake bonus — ${label}`, status: 'pending', createdAt: car.dateAdded,
      });
    }

    // Source commission
    if ((car.sourceCommission ?? 0) > 0 && !alreadyExists('source_commission', { carId: car.id })) {
      if (car.sourceType === 'external' && car.externalSalesmanId) {
        const ext = externalSalesmen.find(e => e.id === car.externalSalesmanId);
        if (ext) result.push({
          id: generateId(), type: 'source_commission', carId: car.id,
          recipientType: 'external_salesman', recipientId: ext.id, recipientName: ext.name,
          bankName: ext.bank, accountNumber: ext.bankAccount,
          amount: car.sourceCommission!, description: `Source comm. — ${label}`, status: 'pending', createdAt: car.dateAdded,
        });
      } else if (car.sourceType === 'internal' && car.sourceSalesmanId) {
        const sp = users.find(u => u.id === car.sourceSalesmanId);
        if (sp) result.push({
          id: generateId(), type: 'source_commission', carId: car.id,
          recipientType: 'user', recipientId: sp.id, recipientName: sp.name,
          bankName: sp.bankName, accountNumber: sp.bankAccountNumber, accountHolder: sp.bankAccountHolder,
          amount: car.sourceCommission!, description: `Source comm. — ${label}`, status: 'pending', createdAt: car.dateAdded,
        });
      }
    }

    // Consignment payout (incoming — we owe dealer)
    if (car.consignment && !alreadyExists('consignment_payout', { carId: car.id })) {
      const c = car.consignment;
      let amount = 0;
      if (c.terms === 'fixed_amount' && c.fixedAmount) amount = c.fixedAmount;
      else if (c.terms === 'profit_split' && c.splitPercent) amount = Math.max(0, (dealPrice - car.purchasePrice) * (c.splitPercent / 100));
      if (amount > 0) {
        const dealer = dealers.find(d => d.name.toLowerCase() === c.dealer.toLowerCase());
        result.push({
          id: generateId(), type: 'consignment_payout', carId: car.id,
          recipientType: 'dealer', recipientId: dealer?.id ?? c.dealer, recipientName: c.dealer,
          bankName: dealer?.bankName, accountNumber: dealer?.bankAccountNumber, accountHolder: dealer?.bankAccountHolder,
          amount, description: `Consignment payout — ${label}`, status: 'pending', createdAt: car.dateAdded,
        });
      }
    }

    // Consignment collection (outgoing — dealer owes us)
    if (car.outgoingConsignment && !alreadyExists('consignment_collection', { carId: car.id })) {
      const oc = car.outgoingConsignment;
      let amount = 0;
      if (oc.terms === 'fixed_amount' && oc.fixedAmount) amount = oc.fixedAmount;
      else if (oc.terms === 'profit_split' && oc.splitPercent) amount = Math.max(0, dealPrice * (oc.splitPercent / 100));
      if (amount > 0 && oc.dealer) {
        const dealer = dealers.find(d => d.name.toLowerCase() === oc.dealer.toLowerCase());
        result.push({
          id: generateId(), type: 'consignment_collection', carId: car.id,
          recipientType: 'dealer', recipientId: dealer?.id ?? oc.dealer, recipientName: oc.dealer,
          bankName: dealer?.bankName, accountNumber: dealer?.bankAccountNumber, accountHolder: dealer?.bankAccountHolder,
          amount, description: `Consignment collection — ${label}`, status: 'pending', createdAt: car.dateAdded,
        });
      }
    }

    // Investor payout
    if (car.investorId && (car.investorSplit ?? 50) > 0 && !alreadyExists('investor_payout', { carId: car.id })) {
      const investor = users.find(u => u.id === car.investorId);
      if (investor) {
        const amount = Math.max(0, (dealPrice - car.purchasePrice) * ((car.investorSplit ?? 50) / 100));
        if (amount > 0) result.push({
          id: generateId(), type: 'investor_payout', carId: car.id,
          recipientType: 'user', recipientId: investor.id, recipientName: investor.name,
          bankName: investor.bankName, accountNumber: investor.bankAccountNumber, accountHolder: investor.bankAccountHolder,
          amount, description: `Investor payout ${car.investorSplit ?? 50}% — ${label}`, status: 'pending', createdAt: car.dateAdded,
        });
      }
    }

    // Customer collection (cash deal)
    if (dealCustomer?.cashWorkOrder && !alreadyExists('customer_collection', { carId: car.id })) {
      const cwo = dealCustomer.cashWorkOrder;
      const additionalTotal = cwo.additionalItems?.reduce((s, i) => s + i.amount, 0) ?? 0;
      const tradeInCredit = cwo.hasTradeIn ? Math.max(0, (cwo.tradeInPrice ?? 0) - (cwo.settlementFigure ?? 0)) : 0;
      const total = (cwo.sellingPrice - (cwo.discount ?? 0)) + (cwo.insurance ?? 0) + (cwo.bankProduct ?? 0) + additionalTotal - (cwo.bookingFee ?? 0) - (cwo.downpayment ?? 0) - tradeInCredit;
      if (total > 0) result.push({
        id: generateId(), type: 'customer_collection', carId: car.id,
        recipientType: 'customer', recipientId: dealCustomer.id, recipientName: dealCustomer.name,
        amount: total, description: `Cash collection — ${label}`, status: 'pending', createdAt: car.dateAdded,
      });
    }

    // Loan disbursement — recorded amount, or pending from work order / final deal
    if (!alreadyExists('loan_disbursement', { carId: car.id })) {
      const lwo = dealCustomer?.loanWorkOrder;
      const finalBank = lwo?.bank ?? car.finalDeal?.bank;
      if (car.disbursementAmount && car.disbursementAmount > 0) {
        // Already recorded
        result.push({
          id: generateId(), type: 'loan_disbursement', carId: car.id,
          recipientType: 'customer', recipientId: car.id, recipientName: `${finalBank ?? 'Bank'} — ${label}`,
          amount: car.disbursementAmount, description: `Loan disbursement — ${label}`,
          status: car.disbursementDate ? 'transferred' : 'pending',
          transferredAt: car.disbursementDate,
          createdAt: car.disbursementDate ?? car.dateAdded,
        });
      } else if (lwo && (lwo.loanAmount ?? 0) > 0) {
        // Loan deal with work order but disbursement not yet recorded
        result.push({
          id: generateId(), type: 'loan_disbursement', carId: car.id,
          recipientType: 'customer', recipientId: car.id, recipientName: `${lwo.bank} — ${label}`,
          amount: lwo.loanAmount, description: `Loan disbursement (pending) — ${label}`,
          status: 'pending', createdAt: car.dateAdded,
        });
      } else if (finalBank && (dealCustomer?.dealType === 'loan' || car.finalDeal?.bank)) {
        // Loan deal detected via finalDeal but no work order — amount unknown, create placeholder
        const estAmount = car.finalDeal?.dealPrice ?? 0;
        if (estAmount > 0) result.push({
          id: generateId(), type: 'loan_disbursement', carId: car.id,
          recipientType: 'customer', recipientId: car.id, recipientName: `${finalBank} — ${label}`,
          amount: estAmount, description: `Loan disbursement (pending) — ${label}`,
          status: 'pending', createdAt: car.dateAdded,
        });
      }
    }

    // Misc costs — skip ones a claim already paid for (linked via miscCostId, any payment type)
    for (const misc of car.miscCosts ?? []) {
      if (misc.merchant && !alreadyExists('misc_cost', { miscCostId: misc.id }) && !payments.some(p => p.miscCostId === misc.id)) {
        const merchant = merchants.find(m => m.name.toLowerCase() === misc.merchant!.toLowerCase());
        result.push({
          id: generateId(), type: 'misc_cost', carId: car.id, miscCostId: misc.id,
          recipientType: 'merchant', recipientId: merchant?.id ?? misc.merchant, recipientName: misc.merchant,
          bankName: merchant?.bankName, accountNumber: merchant?.bankAccountNumber, accountHolder: merchant?.bankAccountHolder,
          amount: misc.amount, description: misc.description || 'Misc cost', status: 'pending', createdAt: misc.createdAt,
        });
      }
    }
  }

  // Done repairs — skip ones a claim already paid for (linked via repairJobId, any payment type)
  for (const repair of repairs) {
    if (repair.status !== 'done' || !repair.location) continue;
    if (alreadyExists('repair', { repairJobId: repair.id })) continue;
    if (payments.some(p => p.repairJobId === repair.id)) continue;
    const amount = repair.actualCost ?? repair.totalCost;
    if (amount <= 0) continue;
    const ws = workshops.find(w => w.name.toLowerCase() === repair.location!.toLowerCase());
    result.push({
      id: generateId(), type: 'repair', carId: repair.carId, repairJobId: repair.id,
      recipientType: 'workshop', recipientId: ws?.id ?? repair.location, recipientName: repair.location,
      bankName: ws?.bankName, accountNumber: ws?.bankAccountNumber, accountHolder: ws?.bankAccountHolder,
      amount, description: `${repair.typeOfRepair} repair`, status: 'pending', createdAt: repair.createdAt,
    });
  }

  return result;
}

// Basic salary for a given month = the fixed base, plus a permanent increment
// (a raise — stays as its own line rather than being folded into basicSalary,
// so there's a record of "base vs raise"), plus a temporary boost that only
// counts for months up to and including temporaryBoostUntil — once that month
// passes, it stops applying on its own without anyone having to remember to
// remove it. This is what makes a past month safe to backfill even after a
// raise: as long as temporaryBoostUntil/salaryIncrement reflect what was
// actually true for that month, this returns the right number for it.
export function effectiveMonthlyBasic(u: User, month: string): number {
  const boostActive = !!u.temporaryBoost && !!u.temporaryBoostUntil && month <= u.temporaryBoostUntil;
  const full = (u.basicSalary ?? 0) + (u.salaryIncrement ?? 0) + (boostActive ? u.temporaryBoost! : 0);
  return Math.round(full * getProrationFactor(u, month) * 100) / 100;
}

// Payroll applies to actual staff, not external parties who happen to have a
// User row (investors, shareholders, bankers) — those aren't paid by this
// dealership. Directors get the same mechanism as everyone else, just under
// "Director Fee" wording/ledger account instead of "Basic Salary", since
// director's fees are a distinct statutory category from employee salary.
export const PAYROLL_ELIGIBLE_ROLES: User['role'][] = ['director', 'salesperson', 'mechanic', 'admin'];

export function basicPayLabel(role: User['role']): string {
  return role === 'director' ? 'Director Fee' : 'Basic Salary';
}

function describeBasicBreakdown(u: User, month: string): string | undefined {
  const parts: string[] = [];
  if ((u.basicSalary ?? 0) > 0) parts.push(`Base RM${u.basicSalary}`);
  if ((u.salaryIncrement ?? 0) > 0) parts.push(`Increment RM${u.salaryIncrement}`);
  const boostActive = !!u.temporaryBoost && !!u.temporaryBoostUntil && month <= u.temporaryBoostUntil;
  if (boostActive) parts.push(`Temp Boost RM${u.temporaryBoost} (until ${u.temporaryBoostUntil})`);
  return parts.length > 1 ? parts.join(' + ') : undefined;
}

// Payroll is a deliberate, month-scoped action (a director picks a month and
// runs it), not a passive backfill like collectMissingPayments above — so it's
// kept separate and only ever looks at the one month it's asked for. Dedup is
// by description (which encodes the month) rather than createdAt, since a
// backfilled run for a past month would otherwise collide with itself.
export function collectMonthlyPayroll(opts: {
  month: string; // 'YYYY-MM'
  users: User[];
  payments: Payment[];
  cars: Car[];
  customers: Customer[];
}): Payment[] {
  const { month, users, payments, cars, customers } = opts;
  const now = new Date().toISOString();
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const result: Payment[] = [];

  const already = (type: 'salary' | 'allowance', recipientId: string, description: string) =>
    payments.some(p => p.type === type && p.recipientId === recipientId && p.description === description) ||
    result.some(p => p.type === type && p.recipientId === recipientId && p.description === description);

  for (const u of users) {
    if (!PAYROLL_ELIGIBLE_ROLES.includes(u.role) || u.employmentType !== 'full_time') continue;

    const basicAmount = effectiveMonthlyBasic(u, month);
    if (basicAmount > 0) {
      const description = `${basicPayLabel(u.role)} — ${monthLabel}`;
      if (!already('salary', u.id, description)) {
        result.push({
          id: generateId(), type: 'salary',
          recipientType: 'user', recipientId: u.id, recipientName: u.name,
          bankName: u.bankName, accountNumber: u.bankAccountNumber, accountHolder: u.bankAccountHolder,
          amount: basicAmount, description, notes: describeBasicBreakdown(u, month), status: 'pending', createdAt: now,
        });
      }
    }

    if ((u.allowance ?? 0) > 0) {
      const description = `Allowance — ${monthLabel}`;
      if (!already('allowance', u.id, description)) {
        result.push({
          id: generateId(), type: 'allowance',
          recipientType: 'user', recipientId: u.id, recipientName: u.name,
          bankName: u.bankName, accountNumber: u.bankAccountNumber, accountHolder: u.bankAccountHolder,
          amount: u.allowance!, description, status: 'pending', createdAt: now,
        });
      }
    }
  }

  // Commission — merged into the same run, covering both cars actually
  // delivered this month and cars a director explicitly credited early.
  // Previously commission relied entirely on a separate automatic-at-
  // delivery trigger (plus a manual Backfill on Payments as a catch-up),
  // completely disconnected from Run Payroll — so basic/allowance and
  // commission could drift out of sync with each other for the same month.
  // Now one click covers everything owed for the month, from either source.
  const hasCommissionPayment = (carId: string) =>
    payments.some(p => p.type === 'salesman_commission' && p.carId === carId) ||
    result.some(p => p.type === 'salesman_commission' && p.carId === carId);
  const monthCars = cars.filter(c =>
    (c.status === 'delivered' || c.commissionCreditedEarly) && getCommissionMonth(c, customers) === month
  );
  for (const car of monthCars) {
    if (car.outgoingConsignment || car.isStaffSale || car.waiveCommission || hasCommissionPayment(car.id)) continue;
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    const spId = car.assignedSalesperson || dealCustomer?.assignedSalesId;
    const sp = spId ? users.find(u => u.id === spId) : undefined;
    if (!sp) continue;
    const wo = dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
    const dealPrice = (wo?.sellingPrice ?? car.finalDeal?.dealPrice ?? car.sellingPrice) - (wo?.discount ?? 0);
    const effectiveFloor = car.priceFloor ?? car.sellingPrice;
    const amount = (car.consignment || dealPrice < effectiveFloor) ? 1000 : 1500;
    const carLabel = `${car.year} ${car.make} ${car.model}${car.carPlate ? ` (${car.carPlate})` : ''}`;
    result.push({
      id: generateId(), type: 'salesman_commission', carId: car.id,
      recipientType: 'user', recipientId: sp.id, recipientName: sp.name,
      bankName: sp.bankName, accountNumber: sp.bankAccountNumber, accountHolder: sp.bankAccountHolder,
      amount, description: `Commission — ${carLabel}`, status: 'pending', createdAt: now,
    });
  }

  return result;
}
