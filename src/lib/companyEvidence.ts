import { prepareProof } from './investorFinance';
import type { Car, Payment } from '../types';

export type CompanyDocument = { documentId: string; kind: 'invoice' | 'payment'; name?: string; fileName?: string; uploadedAt?: string; createdBy?: string; actorName?: string };
export const privateCompanyEvidence = import.meta.env.VITE_USED_CAR_PRIVATE_FINANCE === '1';

export async function companyEvidence<T>(action: string, data: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/garage/sales', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Garage-Building': '1' }, body: JSON.stringify({ scope: 'company_evidence', action, ...data }) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== 'object') throw new Error(result?.error?.message || 'Could not confirm the document. Please try again.');
  return result;
}

export async function uploadCompanyEvidence(paymentId: string, kind: 'invoice' | 'payment', file: File) {
  const proof = await prepareProof(file);
  const material = new TextEncoder().encode(JSON.stringify([paymentId, kind, proof.fileName, proof.mimeType, proof.base64]));
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', material)), (b) => b.toString(16).padStart(2, '0')).join('');
  return companyEvidence<{ document: CompanyDocument }>('upload', { paymentId, kind, ...proof, requestId: 'company_doc_' + digest });
}

// Keep the receivable pending until its proof is safely stored. Returning the
// confirmed row avoids creating another payment from a stale screen closure.
export async function prepareDisbursementEvidence(options: { car: Car; amount: number; payments: Payment[]; file: File; addPayment: (p: Payment) => Promise<void>; updatePayment: (id: string, patch: Partial<Payment>) => Promise<void> }): Promise<Payment[]> {
  const { car, amount, payments, file, addPayment, updatePayment } = options;
  if (car.investorFunded) throw new Error('Use the investor car account to record this receipt.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter the expected bank payment.');
  let payment = payments.find((p) => p.carId === car.id && p.type === 'loan_disbursement');
  if (!payment) {
    const label = `${car.make} ${car.model}${car.carPlate ? ` (${car.carPlate})` : ''}`;
    payment = { id: 'loan_disbursement_' + car.id, type: 'loan_disbursement', carId: car.id, recipientType: 'customer', recipientId: car.id, recipientName: `Bank — ${label}`, amount, description: `Loan disbursement — ${label}`, status: 'pending', createdAt: new Date().toISOString() };
    await addPayment(payment);
  } else if (payment.amount !== amount) {
    if (payment.status !== 'pending') throw new Error('This collection is already recorded. Ask the Director to review the amount.');
    await updatePayment(payment.id, { amount });
    payment = { ...payment, amount };
  }
  await uploadCompanyEvidence(payment.id, 'payment', file);
  return [...payments.filter((p) => p.id !== payment!.id), payment];
}
