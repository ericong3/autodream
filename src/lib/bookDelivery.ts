import { useStore } from '../store';
import { companyBankPaymentsEnabled } from './companyBankPayments';
import { generateDeliveryPayments } from '../utils/generatePayments';
import { buildCarSaleEntry, buildPayableRecognizedEntry, buildTradeInAcquiredEntry, buildTradeInTopUpEntry, LEDGER_ACCOUNTS } from '../utils/generateJournalEntries';
import { deliveredDealPrice } from '../utils/deliveredDealPrice';
import { salesCommission } from '../utils/salesCommission';
import { tradeInFigures } from '../utils/tradeIn';
import type { Car, JournalEntry } from '../types';

/** Is this car's sale in the books? */
export function saleBooked(carId: string, journalEntries: JournalEntry[]): boolean {
  return journalEntries.some((e) => e.sourceType === 'car_sold' && e.sourceId === carId && !e.voided);
}

/** A delivered company car whose sale is missing from the books (it was delivered from a page that did not write them). */
export function saleMissing(car: Car, journalEntries: JournalEntry[]): boolean {
  return car.status === 'delivered' && !car.investorFunded && !car.investorId
    && !car.consignment && !car.outgoingConsignment && !saleBooked(car.id, journalEntries);
}

/**
 * Writes what delivering a car puts in the books: the trade-in car coming into
 * stock, the sale, the trade-in top-up, and the commissions. Used by every
 * Deliver button and by "Book this sale". Anything already in the books is
 * skipped, so running it again never doubles an entry. Director only (the
 * books are Director-only). `date` dates the sale and commissions (default today).
 */
export async function bookDelivery(opts: { carId: string; createdBy: string; date?: string; withPayments?: boolean }): Promise<void> {
  const s = useStore.getState();
  const car = s.cars.find((c) => c.id === opts.carId);
  if (!car || car.investorFunded) return;
  const { createdBy, date } = opts;
  const has = (type: string, id: string) => useStore.getState().journalEntries.some((e) => e.sourceType === type && e.sourceId === id && !e.voided);
  const dealCustomer = s.customers.find((c) => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
  const dealWo = dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
  const dealIsLoan = !!dealCustomer?.loanWorkOrder;
  const repairCost = s.repairs.filter((r) => r.carId === car.id && r.status === 'done').reduce((sum, r) => sum + (r.actualCost ?? r.totalCost), 0);
  const miscCost = (car.miscCosts ?? []).reduce((sum, m) => sum + m.amount, 0);
  const commission = salesCommission(car, s.customers);

  if (opts.withPayments) {
    await generateDeliveryPayments({ bankReceiptMode: companyBankPaymentsEnabled, car, payments: s.payments, users: s.users, externalSalesmen: s.externalSalesmen, dealers: s.dealers, customers: s.customers, repairs: s.repairs, addPayment: s.addPayment });
  }

  // The trade-in car comes into stock (and, with a settlement, is owed to its old lender).
  if (dealWo?.hasTradeIn) {
    const child = s.cars.find((c) => c.tradeInSourceCarId === car.id);
    if (child && !child.companyPurchaseRecorded && !has('trade_in_acquired', child.id) && !has('car_purchased', child.id)) {
      const price = dealWo.tradeInMode === 'swap' ? (car.purchasePrice ?? 0) + repairCost + miscCost + commission : (dealWo.tradeInPrice ?? 0);
      if (child.purchasePrice !== price) await s.updateCar(child.id, { purchasePrice: price });
      await s.addJournalEntry(buildTradeInAcquiredEntry({ car: { ...child, purchasePrice: price }, tradeInPrice: dealWo.tradeInPrice ?? 0, settlementFigure: dealWo.settlementFigure, createdBy }));
    }
  }

  // Dealer-consignment cars are booked by their own flow.
  if (car.consignment || car.outgoingConsignment) return;

  if (!has('car_sold', car.id)) {
    const addOns = companyBankPaymentsEnabled ? (dealWo?.insurance ?? 0) + (dealWo?.bankProduct ?? 0) + (dealWo?.additionalItems ?? []).reduce((sum, i) => sum + i.amount, 0) : 0;
    const legacyPrice = ((dealWo?.sellingPrice ?? car.sellingPrice) - (dealWo?.discount ?? 0)) || car.sellingPrice;
    const dealPrice = (companyBankPaymentsEnabled ? deliveredDealPrice(car, dealWo).netPrice : legacyPrice) + addOns;
    const loanAmount = dealIsLoan ? (car.disbursementExpectedAmount ?? car.disbursementAmount ?? dealCustomer?.loanWorkOrder?.loanAmount ?? 0) : 0;
    const tradeInValue = dealWo?.hasTradeIn ? Math.max(0, (dealWo.tradeInPrice ?? 0) - (dealWo.settlementFigure ?? 0)) : 0;
    const trade = tradeInFigures(dealWo);
    await s.addJournalEntry(buildCarSaleEntry({
      bankReceiptMode: companyBankPaymentsEnabled, car, dealPrice: dealPrice + trade.autoTopUp, cost: (car.purchasePrice ?? 0) + repairCost + miscCost,
      isLoan: dealIsLoan, loanAmount, bookingFee: dealWo?.bookingFee ?? 0, tradeInValue, createdBy, date,
    }));
  }
  // The customer's settlement top-up is owed to the trade-in's old lender, not sales.
  const trade = tradeInFigures(dealWo);
  if (trade.topUp > 0 && !has('trade_in_topup', car.id)) await s.addJournalEntry(buildTradeInTopUpEntry({ car, amount: trade.topUp, createdBy, date }));

  const label = `${car.year} ${car.make} ${car.model}`;
  if (car.assignedSalesperson && !car.isStaffSale && !car.waiveCommission && commission > 0 && !has('salesman_commission', car.id)) {
    await s.addJournalEntry(buildPayableRecognizedEntry({ expenseAccountId: LEDGER_ACCOUNTS.expSalesmanComm, amount: commission, description: `Commission recognized — ${label}`, car, sourceType: 'salesman_commission', sourceId: car.id, createdBy, date }));
  }
  if ((car.intakeCommission ?? 0) > 0 && car.assignedSalesperson && !has('intake_bonus', car.id)) {
    await s.addJournalEntry(buildPayableRecognizedEntry({ expenseAccountId: LEDGER_ACCOUNTS.expIntakeBonus, amount: car.intakeCommission!, description: `Intake bonus recognized — ${label}`, car, sourceType: 'intake_bonus', sourceId: car.id, createdBy, date }));
  }
  if ((car.sourceCommission ?? 0) > 0 && !has('source_commission', car.id)) {
    await s.addJournalEntry(buildPayableRecognizedEntry({ expenseAccountId: LEDGER_ACCOUNTS.expSourceComm, amount: car.sourceCommission!, description: `Source commission recognized — ${label}`, car, sourceType: 'source_commission', sourceId: car.id, createdBy, date }));
  }
}
