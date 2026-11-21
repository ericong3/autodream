import { investorRequest } from './investorFinance';
import type { MissingAgreement, MissingDocument } from './companyEvidence';
import type { MoneyEntry } from './moneyReceived';

export type DocReturn = { id: string; paymentId: string | null; moneyId: string | null; carId: string | null; car: string | null; label: string; reason: string; raisedBy: string | null; raisedAt: string; state: 'open' | 'resolved'; resolution: 'deleted' | 'edited' | 'returned' | 'done' | null; note: string | null; resolvedBy: string | null; resolvedAt: string | null; bill: { type: string; status: string; amountCents: number | null; recipientName: string | null } | null };
export type DocTodoList = { items: MissingDocument[]; total: number; agreements: MissingAgreement[]; moneyWithoutSlip: (MoneyEntry & { car: string | null })[]; open: DocReturn[]; answered: DocReturn[] };

export function todoRequest<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  return investorRequest<T>(action, { ...data, scope: 'doc_todo' });
}
