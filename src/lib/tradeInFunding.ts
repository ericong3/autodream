import { InvestorFinanceError } from './investorFinance';

export async function tradeInRequest<T>(action: string, data: Record<string, unknown>, application: boolean | 'lender' = false): Promise<T> {
  let response: Response;
  try { response = await fetch('/api/garage/sales', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Garage-Building': '1' }, body: JSON.stringify({ scope: application === 'lender' ? 'trade_in_lender' : application ? 'trade_in_application' : 'trade_in_funding', action, ...data }) }); }
  catch { throw new InvestorFinanceError('Connection lost. Retry the original funding save.', 'NETWORK', 0, true); }
  const r = await response.json().catch(() => null);
  if (!response.ok || !r || typeof r !== 'object') throw new InvestorFinanceError(r?.error?.message || 'Could not confirm the funding save.', r?.error?.code || 'UNAVAILABLE', response.status, response.status >= 500 || response.ok || response.status === 429);
  return r;
}
