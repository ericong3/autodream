import { Car, Payment, RepairJob, MiscCost, User, ExternalSalesman, Workshop, Dealer, Merchant, Customer } from '../types';
import { generateId } from './format';

type AddPayment = (p: Payment) => Promise<void>;
type UpdatePayment = (id: string, u: Partial<Payment>) => Promise<void>;

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
