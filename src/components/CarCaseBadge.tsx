import { CheckCircle2, CircleDot } from 'lucide-react';
import { formatCents, useInvestorQuery } from '../lib/investorFinance';
import { caseReasons, loadCarCases } from '../lib/docTodo';

/** Active while anything is open on this car; Closed by itself once everything is done. */
export default function CarCaseBadge({ carId, actorId }: { carId: string; actorId: string }) {
  const query = useInvestorQuery(`car-cases:${actorId}`, loadCarCases);
  const c = query.data?.cars[carId];
  if (!c) return null;
  if (c.state === 'closed') return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 size={15} />Closed case · everything done</div>
  );
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 space-y-1">
      <p className="flex items-center gap-2 text-sm text-amber-300 font-medium"><CircleDot size={15} />Active case</p>
      <p className="text-xs text-gray-300">{caseReasons(c, formatCents).join(' · ')}</p>
    </div>
  );
}
