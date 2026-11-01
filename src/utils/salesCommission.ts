import type { Car, Customer } from '../types';
import { deliveredDealPrice } from './deliveredDealPrice';

// One rule for estimates, delivered deals, profit reports and new payroll entries.
// Existing payment records are never recalculated here.
export function salesCommission(car: Car, customers: Customer[] = [], price?: number): number {
  if (car.outgoingConsignment || car.isStaffSale || car.waiveCommission) return 0;
  if (car.salesCommission != null) return car.salesCommission;
  const matching = customers.filter(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
  const customer = matching.find(c => c.delivered) ?? matching[0];
  if (customer?.commission != null) return customer.commission;
  if (car.isRecon) return 2000;
  const wo = customer?.loanWorkOrder ?? customer?.cashWorkOrder;
  const dealPrice = price ?? deliveredDealPrice(car, wo).netPrice;
  return car.consignment || (car.priceFloor != null && dealPrice < car.priceFloor) ? 1000 : 1500;
}
