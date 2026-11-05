import { InvestorFinanceError } from './investorFinance';
export type CompanyReceiptSave = { receiptId: string; payments: Record<string, unknown>[]; journals: Record<string, unknown>[]; car: Record<string, unknown> };
export type CompanyCollectionBalance = {carId: string; customerCoveredCents: number; loanCoveredCents: number};
export async function companyCollectionBalance(carId: string): Promise<CompanyCollectionBalance> {return receiptRequest('balance',{carId});}
export async function companyReceiptRequest(data: Record<string, unknown>): Promise<CompanyReceiptSave> {return receiptRequest('record',data);}
async function receiptRequest(action: string, data: Record<string, unknown>) {
  let r: Response;
  try { r = await fetch('/api/garage/sales', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Garage-Building': '1' }, body: JSON.stringify({ scope: 'company_bank_receipts', action, ...data }) }); }
  catch { throw new InvestorFinanceError('Connection lost. Retry the original receipt.', 'NETWORK', 0, true); }
  const result = await r.json().catch(() => null);
  if (!r.ok || !result || typeof result !== 'object') throw new InvestorFinanceError(result?.error?.message || 'Could not confirm this receipt. Retry the original save.', result?.error?.code || 'UNAVAILABLE', r.status, r.ok || r.status >= 500 || r.status === 429);
  return result;
}
