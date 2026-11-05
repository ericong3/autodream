import { useState } from 'react';
import { useStore } from '../store';
import { financeFrom } from '../lib/privateFinance';
import { parseRinggit } from '../lib/investorFinance';
import type { Car, Payment } from '../types';
import CompanyBankReceiptDialog from './CompanyBankReceiptDialog';
import Modal from './Modal';

export default function CompanyLoanReceiptStart({ car, actorId, expectedAmount, onClose }: { car: Car; actorId: string; expectedAmount?: number; onClose: () => void }) {
  const payments = useStore((s) => s.payments);
  const rows = payments.filter((p) => p.carId === car.id && p.type === 'loan_disbursement');
  const addPayment = useStore((s) => s.addPayment);
  const [amount, setAmount] = useState(expectedAmount ? expectedAmount.toFixed(2) : ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const cents = parseRinggit(amount);
  if (rows.length === 1) return <CompanyBankReceiptDialog key={actorId + ':' + rows[0].id} payment={rows[0]} actorId={actorId} onClose={onClose} />;
  const historical = car.moneyReceived || car.disbursementStatus === 'disbursed';
  return <Modal isOpen title="Bank loan receipt" onClose={onClose}>
    {rows.length > 1 ? <p className="text-sm text-amber-300">This car has more than one bank receivable. Review the duplicate records before recording more money.</p> : historical ? <p className="text-sm text-amber-300">This car already shows money received. Match its earlier bank record before adding another receipt.</p> : <div className="space-y-3">
      <p className="text-xs text-gray-400">Set the bank-approved loan amount first. This creates a receivable and does not record money received.</p>
      <label className="block text-xs text-gray-400">Bank-approved loan (RM)<input className="input w-full rounded-lg px-3 py-2 mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <button type="button" className="btn-gold px-4 py-2 rounded-lg text-sm disabled:opacity-40" disabled={busy || !cents} onClick={async () => {
        if (!cents || useStore.getState().currentUser?.id !== actorId) return;
        setBusy(true); setError('');
        const id = 'loan_disbursement_' + car.id;
        const draft: Payment = { id, type: 'loan_disbursement', carId: car.id, recipientType: 'customer', recipientId: car.id, recipientName: `Bank — ${car.make} ${car.model}`, amount: cents / 100, description: 'Bank loan receivable', status: 'pending', createdAt: new Date().toISOString() };
        try { await addPayment(draft); }
        catch (e) {
          // An interrupted create may already exist. Read the same stable ID
          // before offering another draft; never create a second receivable.
          const saved = await financeFrom('payments').select('*').eq('id', id);
          if (!saved.error && saved.data?.length) useStore.getState().applyCompanyBankPayment(actorId, { payments: saved.data, journals: [] });
          else setError(e instanceof Error ? e.message : 'Could not save the receivable.');
        } finally { setBusy(false); }
      }}>{busy ? 'Saving…' : 'Continue to bank receipt'}</button>
    </div>}
  </Modal>;
}
