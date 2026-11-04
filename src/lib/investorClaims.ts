import { InvestorFinanceError } from './investorFinance';
export type InvestorClaim = { claimId: string; billId: string; carId: string; purpose: string; payee: string; amountCents: number; paidCents: number; state: 'pending' | 'approved' | 'rejected'; supplierInvoiceConfirmed: boolean; submittedAt: string; claimantName: string; mine: boolean; reviewNote?: string; documents?: { id: string; name: string }[]; car?: { make: string; model: string; plate?: string } };
export async function investorClaimsRequest<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  let response: Response;
  try { response = await fetch('/api/garage/sales', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Garage-Building': '1' }, body: JSON.stringify({ scope: 'investor_claims', action, ...data }) }); }
  catch { throw new InvestorFinanceError('Connection lost. Retry the original claim save.', 'NETWORK', 0, true); }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== 'object') throw new InvestorFinanceError(result?.error?.message || 'Could not confirm the claim. Try again.', result?.error?.code || 'UNAVAILABLE', response.status, response.status >= 500 || response.status === 429 || response.ok);
  return result;
}
type Intent = { action: string; data: Record<string, unknown>; requestId: string; result?: unknown };
const key = (actor: string, slot: string) => `autodream-investor-claim:${actor}:${slot}`;
export function readClaimIntent(actor: string, slot: string): Intent | null { try { return JSON.parse(sessionStorage.getItem(key(actor, slot)) || 'null'); } catch { return null; } }
export function finishClaimIntent(actor: string, slot: string) { sessionStorage.removeItem(key(actor, slot)); }
export async function saveClaimCommand<T>(actor: string, slot: string, action: string, data: Record<string, unknown>, retainSuccess = false): Promise<T> {
  let intent = readClaimIntent(actor, slot);
  if (intent && (intent.action !== action || JSON.stringify(intent.data) !== JSON.stringify(data))) throw new Error('A claim save is waiting. Retry its original details first.');
  if (intent?.result) return intent.result as T;
  intent ??= { action, data, requestId: 'claim_req_' + crypto.randomUUID() };
  sessionStorage.setItem(key(actor, slot), JSON.stringify(intent));
  try {
    const result = await investorClaimsRequest<T>(action, { ...intent.data, requestId: intent.requestId });
    if (retainSuccess) sessionStorage.setItem(key(actor, slot), JSON.stringify({ ...intent, result }));
    else finishClaimIntent(actor, slot);
    return result;
  } catch (e) {
    if (e instanceof InvestorFinanceError && !e.retryable && e.code !== 'REQUEST_CHANGED') finishClaimIntent(actor, slot);
    throw e;
  }
}
