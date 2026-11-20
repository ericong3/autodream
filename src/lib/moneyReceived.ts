import { investorRequest, prepareProof } from './investorFinance';

export type MoneyEntry = { id: string; carId: string; amountCents: number; receivedOn: string; bankName: string | null; bankReference: string; beforeOpening: boolean; note: string; state: 'to_match' | 'matched'; hasSlip: boolean; slipName?: string | null; recordedBy?: string | null; recordedAt: string; matchedAt?: string | null };
export type MoneySummary = Record<string, { amountCents: number; lastOn: string; toMatch: number; noSlip: number }>;

export function moneyRequest<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  return investorRequest<T>(action, { ...data, scope: 'money_received' });
}
export async function uploadMoneySlip(id: string, file: File) {
  const proof = await prepareProof(file);
  return moneyRequest<{ entry: MoneyEntry }>('slip', { id, ...proof });
}
