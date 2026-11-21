import { investorRequest, prepareProof } from './investorFinance';

export type DeductionGroup = 'panel_fee' | 'bank_fee' | 'insurance' | 'jpj_road_tax' | 'runner' | 'other';
export const DEDUCTION_GROUPS: { id: DeductionGroup; label: string }[] = [
  { id: 'panel_fee', label: 'Panel fee' }, { id: 'bank_fee', label: 'Bank fee' }, { id: 'insurance', label: 'Insurance' },
  { id: 'jpj_road_tax', label: 'JPJ & road tax' }, { id: 'runner', label: 'Runner' }, { id: 'other', label: 'Other' },
];
export type MoneyDeduction = { label: string; group: DeductionGroup; amountCents: number; paymentId: string; newBill: boolean };
export type MoneyEntry = { deductionsCents?: number; deductions?: MoneyDeduction[]; loanPaymentId?: string | null; id: string; carId: string; amountCents: number; receivedOn: string; bankName: string | null; bankReference: string; beforeOpening: boolean; note: string; state: 'to_match' | 'matched'; hasSlip: boolean; slipName?: string | null; recordedBy?: string | null; recordedAt: string; matchedAt?: string | null };
export type MoneySummary = Record<string, { amountCents: number; lastOn: string; toMatch: number; noSlip: number }>;

export function moneyRequest<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  return investorRequest<T>(action, { ...data, scope: 'money_received' });
}
export async function uploadMoneySlip(id: string, file: File) {
  const proof = await prepareProof(file);
  return moneyRequest<{ entry: MoneyEntry }>('slip', { id, ...proof });
}
