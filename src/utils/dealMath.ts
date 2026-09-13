import type { Car, Customer, RepairJob } from '../types';

export const STANDARD_DEAL_COMMISSION = 1500;
export const REDUCED_DEAL_COMMISSION = 1000;

export function getDealCustomer(car: Car, customers: Customer[]): Customer | undefined {
  return customers.find(
    (customer) => customer.interestedCarId === car.id && (customer.cashWorkOrder || customer.loanWorkOrder),
  );
}

export function getDealWorkOrder(car: Car, customers: Customer[]) {
  const customer = getDealCustomer(car, customers);
  return customer?.loanWorkOrder ?? customer?.cashWorkOrder;
}

export function getDealSalespersonId(car: Car, customers: Customer[]): string | undefined {
  return car.assignedSalesperson || getDealCustomer(car, customers)?.assignedSalesId;
}

export function getDealPrice(car: Car, customers: Customer[]): number {
  const workOrder = getDealWorkOrder(car, customers);
  const basePrice = workOrder?.sellingPrice ?? car.finalDeal?.dealPrice ?? car.sellingPrice;
  const discount = workOrder?.discount ?? 0;
  const price = basePrice - discount;
  return price || car.sellingPrice;
}

/**
 * Canonical salesman deal commission.
 *
 * Priority matters:
 * 1. Deals that must never pay commission are always RM0.
 * 2. A director-entered customer commission is an explicit override.
 * 3. Consignment / below an explicit price floor gets the reduced amount.
 * 4. Everything else gets the normal amount.
 */
export function getDealCommission(car: Car, customers: Customer[]): number {
  if (car.outgoingConsignment || car.isStaffSale || car.waiveCommission) return 0;

  const customer = getDealCustomer(car, customers);
  if (customer?.commission != null) return Math.max(0, customer.commission);

  const dealPrice = getDealPrice(car, customers);
  if (car.consignment || (car.priceFloor != null && dealPrice < car.priceFloor)) {
    return REDUCED_DEAL_COMMISSION;
  }

  return STANDARD_DEAL_COMMISSION;
}

export function getRepairCost(carId: string, repairs: RepairJob[]): number {
  return repairs
    .filter((repair) => repair.carId === carId && repair.status === 'done')
    .reduce((sum, repair) => sum + (repair.actualCost ?? repair.totalCost), 0);
}

export interface DealFinancials {
  dealPrice: number;
  repairCost: number;
  miscCost: number;
  additionalTotal: number;
  dealCommission: number;
  intakeCommission: number;
  sourceCommission: number;
  netProfit: number;
}

/**
 * Canonical per-car management P&L used by Dashboard / Accounting.
 * Additional work-order items are treated as costs because the UI already
 * reports them under "Misc & Additional Items". Keeping the subtraction here
 * ensures the displayed cost rows always reconcile to Net Profit.
 */
export function getDealFinancials(
  car: Car,
  customers: Customer[],
  repairs: RepairJob[],
): DealFinancials {
  const workOrder = getDealWorkOrder(car, customers);
  const dealPrice = getDealPrice(car, customers);
  const repairCost = getRepairCost(car.id, repairs);
  const miscCost = (car.miscCosts ?? []).reduce((sum, item) => sum + item.amount, 0);
  const additionalTotal = workOrder?.additionalItems?.reduce((sum, item) => sum + item.amount, 0) ?? 0;
  const dealCommission = getDealCommission(car, customers);
  const intakeCommission = car.intakeCommission ?? 0;
  const sourceCommission = car.sourceCommission ?? 0;

  const netProfit = car.isStaffSale
    ? 0
    : dealPrice
      - car.purchasePrice
      - repairCost
      - miscCost
      - additionalTotal
      - dealCommission
      - intakeCommission
      - sourceCommission;

  return {
    dealPrice,
    repairCost,
    miscCost,
    additionalTotal,
    dealCommission,
    intakeCommission,
    sourceCommission,
    netProfit,
  };
}
