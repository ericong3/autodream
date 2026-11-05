// Contract amounts only. Booking/downpayment fields do not prove cash reached
// a bank; the receipt workflow records those amounts as partial collections.
export function companyReceiptParts(input: { dealPrice: number; isLoan: boolean; loanAmount?: number; bookingFee?: number; tradeInValue?: number }) {
  const cents = (n: number) => { if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000) throw new Error('Check the contract amounts.'); return Math.round(n * 100); };
  const price = cents(input.dealPrice), loan = input.isLoan ? cents(input.loanAmount ?? 0) : 0, booking = input.isLoan ? cents(input.bookingFee ?? 0) : 0, trade = cents(input.tradeInValue ?? 0);
  const customer = input.isLoan ? booking + Math.max(0, price - booking - loan - trade) : Math.max(0, price - trade);
  return { customerAmount: customer / 100, refundAmount: Math.max(0, loan + trade + customer - price) / 100 };
}
