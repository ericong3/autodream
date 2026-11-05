import { useEffect, useRef } from 'react';
import { companyBankRequest } from '../lib/companyBankPayments';
import { useInvestorQuery, formatCents } from '../lib/investorFinance';
import type { Payment } from '../types';

export default function CompanyBankMonth({ actorId, payments }: { actorId: string; payments: Payment[] }) {
  const query = useInvestorQuery<{ month: { receivedCents: number; paidCents: number } }>(`company-bank-month:${actorId}`, () => companyBankRequest('month'));
  const prior = useRef(payments);
  useEffect(() => { if (prior.current !== payments) { prior.current = payments; void query.reload(); } }, [payments, query.reload]);
  return <div className="rounded-xl bg-obsidian-800/60 border border-white/[0.06] px-3 py-2.5">
    <p className="text-[10px] text-gray-500 mb-1">Company bank · this month</p>
    <p className="text-xs text-green-400">Received {formatCents(query.data?.month.receivedCents)}</p>
    <p className="text-xs text-gray-300">Paid {formatCents(query.data?.month.paidCents)}</p>
    {query.error && <button type="button" className="text-[10px] text-amber-300" onClick={() => void query.reload()}>Could not refresh · retry</button>}
  </div>;
}
