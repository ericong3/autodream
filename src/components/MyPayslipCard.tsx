import { useState } from 'react';
import { FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../store';
import PayslipPreviewOverlay from './PayslipPreviewOverlay';
import { generateId } from '../utils/format';
import { PAYROLL_ELIGIBLE_ROLES, getCommissionMonth } from '../utils/generatePayments';
import { generatePayslipNo, findExistingPayslip, computePayslipDraft, computeYtdForPayslip } from '../utils/payslip';
import { Payslip } from '../types';

// Self-service payslip generation — everyone can pull their own instead of
// waiting on a director. Deliberately not editable here (unlike the
// director's Payroll-page flow): every figure is auto-calculated from the
// person's own rate profile, so nobody can influence their own net pay by
// hand. "Generate" is idempotent (see findExistingPayslip) — clicking it
// again for a month that already has one just reopens that same payslip.
export default function MyPayslipCard() {
  const currentUser = useStore((s) => s.currentUser);
  const cars = useStore((s) => s.cars);
  const customers = useStore((s) => s.customers);
  const payslips = useStore((s) => s.payslips);
  const addPayslip = useStore((s) => s.addPayslip);

  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Payslip | null>(null);

  if (!currentUser || !PAYROLL_ELIGIBLE_ROLES.includes(currentUser.role)) return null;

  const monthLabel = new Date(monthFilter + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const prevMonth = () => setMonthFilter((m) => {
    const d = new Date(m + '-01'); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7);
  });
  const nextMonth = () => setMonthFilter((m) => {
    const d = new Date(m + '-01'); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 7);
  });
  const isCurrentMonth = monthFilter === new Date().toISOString().slice(0, 7);

  const calcCommission = (car: typeof cars[0]): number => {
    if (car.outgoingConsignment) return 0;
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    const wo = dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
    const dealPrice = (wo?.sellingPrice ?? car.finalDeal?.dealPrice ?? car.sellingPrice) - (wo?.discount ?? 0);
    if (car.consignment || (car.priceFloor != null && dealPrice < car.priceFloor)) return 1000;
    return 1500;
  };
  const getDealSalespersonId = (car: typeof cars[0]): string | undefined => {
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    return car.assignedSalesperson || dealCustomer?.assignedSalesId;
  };
  const monthCommission = currentUser.role === 'salesperson'
    ? cars
        .filter(c => (c.status === 'delivered' || c.commissionCreditedEarly) && getCommissionMonth(c) === monthFilter && getDealSalespersonId(c) === currentUser.id)
        .reduce((s, c) => s + calcCommission(c), 0)
    : 0;

  const handleGenerate = async () => {
    setError('');
    const existing = findExistingPayslip(payslips, currentUser.id, monthFilter);
    if (existing) { setPreview(existing); return; }
    if (!currentUser.employeeId) { setError('Your Employee ID isn\'t set yet — ask your director to set it first.'); return; }
    setGenerating(true);
    try {
      const [year, month] = monthFilter.split('-');
      const draft = computePayslipDraft({ user: currentUser, month: monthFilter, salesCommission: monthCommission });
      const payslip: Payslip = {
        ...draft,
        id: generateId(),
        payslipNo: generatePayslipNo(currentUser.employeeId, year, month),
        payDate: new Date().toISOString().slice(0, 10),
        paymentMethod: 'Bank Transfer',
        onProbation: false,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.id,
      };
      await addPayslip(payslip);
      setPreview(payslip);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-gold-400" />
          <p className="text-white font-semibold text-sm">My Payslip</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-obsidian-600/60 border border-obsidian-400/40 rounded-lg px-1 py-1">
            <button onClick={prevMonth} className="p-1 text-gray-500 hover:text-white hover:bg-obsidian-500/60 rounded-md transition-colors"><ChevronLeft size={13} /></button>
            <span className="text-white text-xs font-medium px-1.5 min-w-[110px] text-center">{monthLabel}</span>
            <button onClick={nextMonth} disabled={isCurrentMonth} className="p-1 text-gray-500 hover:text-white hover:bg-obsidian-500/60 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight size={13} /></button>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-xs px-3 py-2 rounded-lg bg-sky-500/15 border border-sky-500/40 text-sky-300 hover:bg-sky-500/25 transition-colors disabled:opacity-50 font-medium"
          >
            {generating ? 'Generating...' : 'View / Generate'}
          </button>
        </div>
      </div>
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}

      {preview && (
        <PayslipPreviewOverlay
          payslip={preview}
          employee={currentUser}
          ytd={computeYtdForPayslip(payslips, currentUser.id, preview.payPeriodStart)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
