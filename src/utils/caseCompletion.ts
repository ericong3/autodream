import { Car, Customer, Payment } from '../types';

// Rolls up the two independent "is this deal actually finished" signals —
// bank disbursement landing, and the customer-side cash balance (owed to us
// or owed back to them) — into one status, since neither alone tells you
// whether a delivered car still has loose ends.
export function getCaseCompletion(opts: { car: Car; customers: Customer[]; payments: Payment[] }): {
  complete: boolean;
  openItems: string[];
} {
  const { car, customers, payments } = opts;
  const openItems: string[] = [];

  const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
  const wo = dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
  const isLoan = !!dealCustomer?.loanWorkOrder;

  // Money expected to come IN from a bank or dealer (loan disbursement, or
  // a consignment payout) — cash deals are always collected in full before
  // delivery so there's nothing pending here.
  const needsDisbursement = car.outgoingConsignment || isLoan || (!!car.finalDeal?.bank && car.finalDeal.bank.toLowerCase() !== 'cash');
  if (needsDisbursement && !car.moneyReceived) {
    openItems.push(car.disbursementStatus === 'processing' ? 'Bank Processing' : 'Awaiting Disbursement');
  }

  // Money still owed on the customer side, either direction.
  if (wo) {
    const addItems = (wo.additionalItems ?? []).reduce((s, i) => s + (i.amount || 0), 0);
    const total = (wo.sellingPrice - (wo.discount ?? 0)) + (wo.insurance ?? 0) + (wo.bankProduct ?? 0) + addItems - (wo.bookingFee ?? 0);
    const financed = isLoan
      ? (car.disbursementExpectedAmount ?? car.disbursementAmount ?? dealCustomer!.loanWorkOrder!.loanAmount ?? 0)
      : ((dealCustomer?.cashWorkOrder as any)?.downpayment ?? 0);
    const balance = total - financed;

    if (balance > 0.01 && !car.collectionReceiptUrl) {
      openItems.push(`RM ${balance.toLocaleString()} to collect`);
    } else if (balance < -0.01) {
      const refundClaim = payments.find(p => p.type === 'customer_refund' && p.carId === car.id);
      if (!refundClaim || refundClaim.status !== 'transferred') {
        openItems.push('Refund pending');
      }
    }
  }

  return { complete: openItems.length === 0, openItems };
}
