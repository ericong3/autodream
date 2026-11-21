import { investorRequest } from './investorFinance';
import type { MissingAgreement, MissingDocument } from './companyEvidence';
import type { MoneyEntry } from './moneyReceived';

export type DocReturn = { id: string; paymentId: string | null; moneyId: string | null; carId: string | null; car: string | null; label: string; reason: string; raisedBy: string | null; raisedAt: string; state: 'open' | 'resolved'; resolution: 'deleted' | 'edited' | 'returned' | 'done' | null; note: string | null; resolvedBy: string | null; resolvedAt: string | null; bill: { type: string; status: string; amountCents: number | null; recipientName: string | null } | null };
export type DocTodoList = { items: MissingDocument[]; total: number; agreements: MissingAgreement[]; moneyWithoutSlip: (MoneyEntry & { car: string | null })[]; open: DocReturn[]; answered: DocReturn[] };

export function todoRequest<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  return investorRequest<T>(action, { ...data, scope: 'doc_todo' });
}

export type CarCase = { state: 'active' | 'closed'; missingDocs: number; toPay: number; toPayCents: number; toCollectCents: number; moneyNoSlip: number; agreementMissing: boolean; dealerNotApproved: boolean; sentBack: number; investorOpen: boolean };
export const loadCarCases = () => todoRequest<{ cars: Record<string, CarCase> }>('cases');

/** Plain reasons a car is still Active. */
export function caseReasons(c: CarCase, money: (cents: number) => string): string[] {
  const out: string[] = [];
  if (c.missingDocs) out.push(`${c.missingDocs} invoice/slip missing`);
  if (c.moneyNoSlip) out.push(`${c.moneyNoSlip} money received without slip`);
  if (c.toPay) out.push(`${money(c.toPayCents)} still to pay`);
  if (c.toCollectCents) out.push(`${money(c.toCollectCents)} still to collect`);
  if (c.agreementMissing) out.push('dealer agreement missing');
  if (c.dealerNotApproved) out.push('dealer amount not approved');
  if (c.sentBack) out.push(`${c.sentBack} with the Director`);
  if (c.investorOpen) out.push('investor result not confirmed');
  return out;
}
