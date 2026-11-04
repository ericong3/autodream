import { InvestorFinanceError } from './investorFinance';
import type { Payment } from '../types';
export const companyBankPaymentsEnabled = import.meta.env.VITE_USED_CAR_BANK_PAYMENTS === '1';
export const paymentBalanceCents = (p: Payment) => Math.max(0, Math.round(p.amount * 100) - (p.bankPaidCents ?? (p.status === 'transferred' ? Math.round(p.amount * 100) : 0)));
export type CompanyBankSave = { bankPaymentId: string; payments: Record<string, unknown>[]; journals: Record<string, unknown>[] };
export async function companyBankRequest<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  let r: Response;
  try { r = await fetch('/api/garage/sales', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Garage-Building': '1' }, body: JSON.stringify({ scope: 'company_bank_payments', action, ...data }) }); }
  catch { throw new InvestorFinanceError('Connection lost. Retry the original payment.', 'NETWORK', 0, true); }
  const result = await r.json().catch(() => null);
  if (!r.ok || !result || typeof result !== 'object') throw new InvestorFinanceError(result?.error?.message || 'Could not confirm the payment. Retry the original save.', result?.error?.code || 'UNAVAILABLE', r.status, r.ok || r.status >= 500 || r.status === 429);
  return result;
}
