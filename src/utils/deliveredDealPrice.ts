import type { Car, CashWorkOrder, LoanWorkOrder } from '../types';

// Legacy work orders/final deals can contain a placeholder zero. A saved
// positive price takes precedence; a final-deal price is already net of discount.
export function deliveredDealPrice(car: Car, workOrder?: CashWorkOrder | LoanWorkOrder) {
  if (Number.isFinite(workOrder?.sellingPrice) && workOrder!.sellingPrice > 0) {
    const sellingPrice = workOrder!.sellingPrice;
    const discount = workOrder!.discount ?? 0;
    return { sellingPrice, discount, netPrice: sellingPrice - discount };
  }
  const finalPrice = car.finalDeal?.dealPrice;
  const sellingPrice = Number.isFinite(finalPrice) && finalPrice! > 0 ? finalPrice! : car.sellingPrice;
  return { sellingPrice, discount: 0, netPrice: sellingPrice };
}
