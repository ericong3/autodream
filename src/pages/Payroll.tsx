import { useState } from 'react';
import { Wallet, Edit2, ChevronLeft, ChevronRight, ChevronDown, Shield, UserCheck, Wrench, Settings, CheckCircle2, Clock, FileText } from 'lucide-react';
import { useStore } from '../store';
import Modal from '../components/Modal';
import PayslipPreviewOverlay from '../components/PayslipPreviewOverlay';
import { formatRM, generateId } from '../utils/format';
import { collectMonthlyPayroll, effectiveMonthlyBasic, basicPayLabel, PAYROLL_ELIGIBLE_ROLES, getCommissionMonth } from '../utils/generatePayments';
import { collectMissingJournalEntries } from '../utils/generateJournalEntries';
import { generatePayslipNo, findExistingPayslip, computePayslipDraft, computeYtdForPayslip } from '../utils/payslip';
import { User, Payslip } from '../types';

function inputCls(error?: string) {
  return `w-full bg-obsidian-700/60 border ${error ? 'border-red-500/50' : 'border-obsidian-400/60'} text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors`;
}

function FormField({ label, children, error, className }: { label: string; children: React.ReactNode; error?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-gray-300 text-xs font-medium mb-1.5">{label}</label>
      {children}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}

const ROLE_ICON: Record<string, React.ElementType> = {
  director: Shield, salesperson: UserCheck, mechanic: Wrench, admin: Settings,
};
const ROLE_LABEL: Record<string, string> = {
  director: 'Director', salesperson: 'Salesperson', mechanic: 'Mechanic', admin: 'Admin',
};

const emptyRateForm = {
  employeeId: '',
  position: '',
  department: '',
  joiningDate: '',
  employmentType: 'commission_only' as NonNullable<User['employmentType']>,
  basicSalary: 0,
  allowance: 0,
  salaryIncrement: 0,
  temporaryBoost: 0,
  temporaryBoostUntil: '',
};

const emptyPayslipForm = {
  payDate: new Date().toISOString().slice(0, 10),
  paymentMethod: 'Bank Transfer',
  basicSalary: 0,
  salesCommission: 0,
  performanceBonus: 0,
  allowance: 0,
  epfEmployee: 0,
  socsoEmployee: 0,
  eisEmployee: 0,
  pcbTax: 0,
  otherDeduction: 0,
  epfEmployer: 0,
  socsoEmployer: 0,
  eisEmployer: 0,
  onProbation: false,
};

export default function Payroll() {
  const currentUser = useStore((s) => s.currentUser);
  const users = useStore((s) => s.users);
  const updateUser = useStore((s) => s.updateUser);
  const cars = useStore((s) => s.cars);
  const customers = useStore((s) => s.customers);
  const repairs = useStore((s) => s.repairs);
  const payments = useStore((s) => s.payments);
  const batchAddPayments = useStore((s) => s.batchAddPayments);
  const journalEntries = useStore((s) => s.journalEntries);
  const batchAddJournalEntries = useStore((s) => s.batchAddJournalEntries);
  const payslips = useStore((s) => s.payslips);
  const addPayslip = useStore((s) => s.addPayslip);

  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));
  const [runningPayroll, setRunningPayroll] = useState(false);
  const [payrollResult, setPayrollResult] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [form, setForm] = useState(emptyRateForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [payslipTarget, setPayslipTarget] = useState<User | null>(null);
  const [payslipForm, setPayslipForm] = useState(emptyPayslipForm);
  const [payslipError, setPayslipError] = useState('');
  const [previewPayslip, setPreviewPayslip] = useState<Payslip | null>(null);
  const [collapsedRoles, setCollapsedRoles] = useState<Set<string>>(new Set());
  const toggleRole = (role: string) => setCollapsedRoles((prev) => {
    const next = new Set(prev);
    next.has(role) ? next.delete(role) : next.add(role);
    return next;
  });

  const staff = users
    .filter((u) => PAYROLL_ELIGIBLE_ROLES.includes(u.role))
    .sort((a, b) => a.name.localeCompare(b.name));
  const fullTimeStaff = staff.filter((u) => u.employmentType === 'full_time');
  const monthTotalPayroll = fullTimeStaff.reduce(
    (s, u) => s + effectiveMonthlyBasic(u, monthFilter) + (u.allowance ?? 0), 0
  );

  // Deal commission — same calc as the Commission page, just scoped per
  // person here so it can sit alongside their payroll rate as one combined
  // pay picture instead of a separate page.
  const getDealSalespersonId = (car: typeof cars[0]): string | undefined => {
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    return car.assignedSalesperson || dealCustomer?.assignedSalesId;
  };
  const calcCommission = (car: typeof cars[0]): number => {
    if (car.outgoingConsignment) return 0;
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    const wo = dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
    const dealPrice = (wo?.sellingPrice ?? car.finalDeal?.dealPrice ?? car.sellingPrice) - (wo?.discount ?? 0);
    if (car.consignment || (car.priceFloor != null && dealPrice < car.priceFloor)) return 1000;
    return 1500;
  };
  const monthSoldCars = cars.filter(c => (c.status === 'delivered' || c.commissionCreditedEarly) && getCommissionMonth(c) === monthFilter);
  const monthCommission = (userId: string) =>
    monthSoldCars.filter(c => getDealSalespersonId(c) === userId).reduce((s, c) => s + calcCommission(c), 0);
  const monthTotalCommission = staff
    .filter(u => u.role === 'salesperson')
    .reduce((s, u) => s + monthCommission(u.id), 0);

  const monthLabel = new Date(monthFilter + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const monthPayrollPayments = payments.filter(
    (p) => (p.type === 'salary' || p.type === 'allowance') && p.description?.endsWith(monthLabel)
  );

  const prevMonth = () => setMonthFilter((m) => {
    const d = new Date(m + '-01'); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7);
  });
  const nextMonth = () => setMonthFilter((m) => {
    const d = new Date(m + '-01'); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 7);
  });

  const openEdit = (u: User) => {
    setEditTarget(u);
    setForm({
      employeeId: u.employeeId ?? '',
      position: u.position ?? '',
      department: u.department ?? '',
      joiningDate: u.joiningDate ?? '',
      employmentType: u.employmentType ?? 'commission_only',
      basicSalary: u.basicSalary ?? 0,
      allowance: u.allowance ?? 0,
      salaryIncrement: u.salaryIncrement ?? 0,
      temporaryBoost: u.temporaryBoost ?? 0,
      temporaryBoostUntil: u.temporaryBoostUntil ?? '',
    });
    setErrors({});
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.temporaryBoost > 0 && !form.temporaryBoostUntil) e.temporaryBoostUntil = 'Set an end month or the boost won\'t apply';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const saveRates = () => {
    if (!editTarget || !validate()) return;
    updateUser(editTarget.id, {
      employeeId: form.employeeId || undefined,
      position: form.position || undefined,
      department: form.department || undefined,
      joiningDate: form.joiningDate || undefined,
      employmentType: form.employmentType,
      basicSalary: form.employmentType === 'full_time' ? form.basicSalary : 0,
      allowance: form.employmentType === 'full_time' ? form.allowance : 0,
      salaryIncrement: form.employmentType === 'full_time' ? form.salaryIncrement : 0,
      temporaryBoost: form.employmentType === 'full_time' ? form.temporaryBoost : 0,
      temporaryBoostUntil: form.employmentType === 'full_time' ? (form.temporaryBoostUntil || undefined) : undefined,
    });
    setEditTarget(null);
  };

  const handleRunPayroll = async () => {
    if (!currentUser) return;
    setRunningPayroll(true);
    try {
      const missing = collectMonthlyPayroll({ month: monthFilter, users, payments });
      if (missing.length > 0) await batchAddPayments(missing);
      const newEntries = collectMissingJournalEntries({
        cars, customers, repairs, payments: [...payments, ...missing], journalEntries, users, createdBy: currentUser.id,
      });
      if (newEntries.length > 0) await batchAddJournalEntries(newEntries);
      setPayrollResult(missing.length);
    } finally {
      setRunningPayroll(false);
      setTimeout(() => setPayrollResult(null), 4000);
    }
  };

  const openPayslip = (u: User) => {
    setPayslipTarget(u);
    setPayslipError('');
    const salesCommission = u.role === 'salesperson' ? monthCommission(u.id) : 0;
    const draft = computePayslipDraft({ user: u, month: monthFilter, salesCommission });
    setPayslipForm({ ...emptyPayslipForm, ...draft });
  };

  const toggleProbation = (onProbation: boolean) => {
    setPayslipForm((f) => ({
      ...f,
      onProbation,
      epfEmployee: onProbation ? 0 : f.epfEmployee,
      socsoEmployee: onProbation ? 0 : f.socsoEmployee,
      eisEmployee: onProbation ? 0 : f.eisEmployee,
      epfEmployer: onProbation ? 0 : f.epfEmployer,
      socsoEmployer: onProbation ? 0 : f.socsoEmployer,
      eisEmployer: onProbation ? 0 : f.eisEmployer,
      // PCB follows EPF's declared/not-declared state too, per how this
      // business actually runs probation payroll — not withheld independently.
      pcbTax: onProbation ? 0 : f.pcbTax,
    }));
  };

  const handleGeneratePayslip = async () => {
    if (!payslipTarget || !currentUser) return;
    if (!payslipTarget.employeeId) { setPayslipError('Set an Employee ID for this person first (Edit Rate).'); return; }
    // Idempotent — one payslip per person per month. If one already exists
    // (whether generated here or self-service from their own dashboard),
    // show that instead of creating another.
    const existing = findExistingPayslip(payslips, payslipTarget.id, monthFilter);
    if (existing) {
      setPayslipTarget(null);
      setPreviewPayslip(existing);
      return;
    }
    const [year, month] = monthFilter.split('-');
    const payPeriodStart = `${monthFilter}-01`;
    const payPeriodEnd = new Date(Number(year), Number(month), 0).toISOString().slice(0, 10);
    const payslip: Payslip = {
      id: generateId(),
      userId: payslipTarget.id,
      payslipNo: generatePayslipNo(payslipTarget.employeeId, year, month),
      payPeriodStart, payPeriodEnd,
      payDate: payslipForm.payDate,
      paymentMethod: payslipForm.paymentMethod,
      basicSalary: payslipForm.basicSalary,
      salesCommission: payslipForm.salesCommission,
      performanceBonus: payslipForm.performanceBonus,
      allowance: payslipForm.allowance,
      epfEmployee: payslipForm.epfEmployee,
      socsoEmployee: payslipForm.socsoEmployee,
      eisEmployee: payslipForm.eisEmployee,
      pcbTax: payslipForm.pcbTax,
      otherDeduction: payslipForm.otherDeduction,
      epfEmployer: payslipForm.epfEmployer,
      socsoEmployer: payslipForm.socsoEmployer,
      eisEmployer: payslipForm.eisEmployer,
      onProbation: payslipForm.onProbation,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id,
    };
    await addPayslip(payslip);
    setPayslipTarget(null);
    setPreviewPayslip(payslip);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-white text-xl font-bold flex items-center gap-2"><Wallet size={20} className="text-gold-400" />Payroll</h1>
        <p className="text-gray-500 text-sm mt-0.5">Full-time staff rates and monthly payroll runs</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4">
          <p className="text-2xl font-bold text-gold-400">{fullTimeStaff.length}</p>
          <p className="text-gray-400 text-xs mt-1">Full-Time Staff</p>
        </div>
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4">
          <p className="text-2xl font-bold text-sky-400">{formatRM(monthTotalPayroll)}</p>
          <p className="text-gray-400 text-xs mt-1">Payroll Cost — {monthLabel}</p>
        </div>
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4">
          <p className="text-2xl font-bold text-purple-400">{formatRM(monthTotalCommission)}</p>
          <p className="text-gray-400 text-xs mt-1">Commission — {monthLabel}</p>
        </div>
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4">
          <p className="text-2xl font-bold text-emerald-400">{monthPayrollPayments.filter(p => p.status === 'transferred').length} / {monthPayrollPayments.length}</p>
          <p className="text-gray-400 text-xs mt-1">Payroll Paid Out — {monthLabel}</p>
        </div>
      </div>

      {/* Month nav + run payroll */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-obsidian-600/60 border border-obsidian-400/40 rounded-xl px-1 py-1">
          <button onClick={prevMonth} className="p-1.5 text-gray-500 hover:text-white hover:bg-obsidian-500/60 rounded-lg transition-colors"><ChevronLeft size={14} /></button>
          <span className="text-white text-sm font-medium px-2 min-w-[130px] text-center">{monthLabel}</span>
          <button onClick={nextMonth} className="p-1.5 text-gray-500 hover:text-white hover:bg-obsidian-500/60 rounded-lg transition-colors"><ChevronRight size={14} /></button>
        </div>
        <button
          onClick={handleRunPayroll}
          disabled={runningPayroll}
          title="Creates this month's payments for every full-time staff member and posts them straight to the ledger — no separate Run Backfill needed"
          className="text-sm px-4 py-2 rounded-lg bg-sky-500/15 border border-sky-500/40 text-sky-300 hover:bg-sky-500/25 transition-colors disabled:opacity-50 font-medium"
        >
          {runningPayroll ? 'Running...' : payrollResult !== null ? (payrollResult > 0 ? `Created ${payrollResult} payment${payrollResult !== 1 ? 's' : ''}` : 'Already up to date') : `Run Payroll — ${monthLabel}`}
        </button>
      </div>

      {/* Staff rates — grouped into its own section per role, rather than one
          flat list, so all salespeople sit together, all admins together, etc. */}
      <div className="space-y-6">
        {PAYROLL_ELIGIBLE_ROLES.map((role) => {
          const roleStaff = staff.filter((u) => u.role === role);
          if (roleStaff.length === 0) return null;
          const RoleIcon = ROLE_ICON[role] ?? Settings;
          const isCollapsed = collapsedRoles.has(role);
          const roleTotal = roleStaff.reduce((s, u) => {
            const basic = u.employmentType === 'full_time' ? effectiveMonthlyBasic(u, monthFilter) + (u.allowance ?? 0) : 0;
            const comm = u.role === 'salesperson' ? monthCommission(u.id) : 0;
            return s + basic + comm;
          }, 0);
          return (
            <div key={role} className="space-y-2.5">
              <button
                onClick={() => toggleRole(role)}
                className="w-full flex items-center gap-1.5 text-gray-400 text-xs font-semibold uppercase tracking-wide hover:text-gray-200 transition-colors"
              >
                <ChevronDown size={13} className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                <RoleIcon size={13} />{ROLE_LABEL[role]}s <span className="text-gray-600">({roleStaff.length})</span>
                {isCollapsed && roleTotal > 0 && <span className="text-gray-500 normal-case font-normal ml-1">— {formatRM(roleTotal)} this month</span>}
              </button>
              {!isCollapsed && roleStaff.map((u) => {
                const isFullTime = u.employmentType === 'full_time';
                const effectiveBasic = isFullTime ? effectiveMonthlyBasic(u, monthFilter) : 0;
                const boostActive = isFullTime && !!u.temporaryBoost && !!u.temporaryBoostUntil && monthFilter <= u.temporaryBoostUntil;
                const commission = u.role === 'salesperson' ? monthCommission(u.id) : 0;
                const totalPay = effectiveBasic + (isFullTime ? (u.allowance ?? 0) : 0) + commission;
                return (
                  <div key={u.id} className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4 flex items-center gap-4 flex-wrap">
                    <div className="w-10 h-10 rounded-full bg-obsidian-600/60 border border-obsidian-400/40 flex items-center justify-center shrink-0">
                      <RoleIcon size={16} className="text-gray-400" />
                    </div>
                    <div className="min-w-[140px]">
                      <p className="text-white font-semibold text-sm">{u.name}</p>
                      <p className="text-gray-500 text-xs">{ROLE_LABEL[u.role]}</p>
                    </div>
                    <div className="flex-1 min-w-[200px] space-y-1">
                      <div className="flex items-center gap-4 flex-wrap text-xs">
                        {isFullTime ? (
                          <>
                            <span className="text-gray-400">{basicPayLabel(u.role)}: <span className="text-white font-medium">{formatRM(effectiveBasic)}</span></span>
                            {(u.allowance ?? 0) > 0 && <span className="text-gray-400">Allowance: <span className="text-white font-medium">{formatRM(u.allowance!)}</span></span>}
                            {(u.salaryIncrement ?? 0) > 0 && <span className="text-purple-400">+{formatRM(u.salaryIncrement!)} increment</span>}
                            {boostActive && <span className="text-amber-400">+{formatRM(u.temporaryBoost!)} boost (until {u.temporaryBoostUntil})</span>}
                          </>
                        ) : (
                          <span className="text-gray-600">No fixed pay configured</span>
                        )}
                        {u.role === 'salesperson' && (
                          <span className="text-teal-400">Commission: <span className="font-medium">{formatRM(commission)}</span></span>
                        )}
                      </div>
                      {(isFullTime || commission > 0) && (
                        <p className="text-gray-500 text-[11px]">Total this month: <span className="text-white font-semibold">{formatRM(totalPay)}</span></p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        onClick={() => openPayslip(u)}
                        className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1"
                      >
                        <FileText size={12} />Payslip
                      </button>
                      <button
                        onClick={() => openEdit(u)}
                        className="text-xs text-gold-400 hover:text-gold-300 font-medium flex items-center gap-1"
                      >
                        <Edit2 size={12} />Edit Rate
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* This month's payroll payments */}
      {monthPayrollPayments.length > 0 && (
        <div className="space-y-2">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Payments — {monthLabel}</p>
          <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card divide-y divide-obsidian-400/30">
            {monthPayrollPayments.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="text-white font-medium">{p.recipientName}</p>
                  <p className="text-gray-500 text-xs">{p.description}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-white font-semibold">{formatRM(p.amount)}</span>
                  {p.status === 'transferred' ? (
                    <span className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 size={13} />Paid</span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-400 text-xs"><Clock size={13} />Pending</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}


      {/* Edit rate modal */}
      <Modal
        isOpen={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget ? `${editTarget.name} — Payroll Rate` : ''}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setEditTarget(null)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
            <button onClick={saveRates} className="flex-1 px-4 py-2.5 btn-gold rounded-lg text-sm font-medium">Save</button>
          </div>
        }
      >
        {editTarget && (
          <div className="space-y-4">
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Payslip Info</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Employee ID">
                <input type="text" className={inputCls()} value={form.employeeId} placeholder="ADU-0007"
                  onChange={(e) => setForm({ ...form, employeeId: e.target.value })} />
              </FormField>
              <FormField label="Designation">
                <input type="text" className={inputCls()} value={form.position} placeholder="Sales Advisor"
                  onChange={(e) => setForm({ ...form, position: e.target.value })} />
              </FormField>
              <FormField label="Department">
                <input type="text" className={inputCls()} value={form.department} placeholder="Sales"
                  onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </FormField>
              <FormField label="Joining Date">
                <input type="date" className={inputCls()} value={form.joiningDate}
                  onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} />
              </FormField>
            </div>
            <FormField label="Employment Type">
              <div className="flex gap-2">
                {(['commission_only', 'full_time'] as const).map((et) => (
                  <button
                    key={et}
                    type="button"
                    onClick={() => setForm({ ...form, employmentType: et })}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      form.employmentType === et
                        ? 'bg-gold-500/20 border-gold-500/50 text-gold-300'
                        : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {et === 'full_time' ? 'Full-Time' : editTarget.role === 'salesperson' ? 'Commission Only' : 'No Fixed Pay'}
                  </button>
                ))}
              </div>
            </FormField>
            {form.employmentType === 'full_time' && (
              <div className="grid grid-cols-2 gap-3">
                <FormField label={`${basicPayLabel(editTarget.role)} (RM/mo)`}>
                  <input type="number" className={inputCls()} value={form.basicSalary} min={0}
                    onChange={(e) => setForm({ ...form, basicSalary: Number(e.target.value) })} />
                </FormField>
                <FormField label="Allowance (RM/mo)">
                  <input type="number" className={inputCls()} value={form.allowance} min={0}
                    onChange={(e) => setForm({ ...form, allowance: Number(e.target.value) })} />
                </FormField>
                <FormField label="Increment (RM/mo, permanent)">
                  <input type="number" className={inputCls()} value={form.salaryIncrement} min={0}
                    onChange={(e) => setForm({ ...form, salaryIncrement: Number(e.target.value) })} />
                </FormField>
                <FormField label="Temporary Boost (RM/mo)">
                  <input type="number" className={inputCls()} value={form.temporaryBoost} min={0}
                    onChange={(e) => setForm({ ...form, temporaryBoost: Number(e.target.value) })} />
                </FormField>
                {form.temporaryBoost > 0 && (
                  <FormField label="Boost Active Until" error={errors.temporaryBoostUntil} className="col-span-2">
                    <input type="month" className={inputCls(errors.temporaryBoostUntil)} value={form.temporaryBoostUntil}
                      onChange={(e) => setForm({ ...form, temporaryBoostUntil: e.target.value })} />
                    <p className="text-gray-500 text-[11px] mt-1">Boost applies to payroll through this month, then stops on its own.</p>
                  </FormField>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Generate payslip */}
      <Modal
        isOpen={!!payslipTarget}
        onClose={() => setPayslipTarget(null)}
        title={payslipTarget ? `Generate Payslip — ${payslipTarget.name}` : ''}
        maxWidth="max-w-xl"
        footer={
          <div className="space-y-2">
            {payslipError && <p className="text-red-400 text-xs">{payslipError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setPayslipTarget(null)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
              <button onClick={handleGeneratePayslip} className="flex-1 px-4 py-2.5 btn-gold rounded-lg text-sm font-medium">Generate & Preview</button>
            </div>
          </div>
        }
      >
        {payslipTarget && (
          <div className="space-y-4">
            <p className="text-gray-500 text-xs">Pay period: {monthFilter} — EPF/SOCSO/EIS/PCB are pre-filled estimates (percentage/bracket-based, single/no-dependents assumed for PCB), review before generating.</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Pay Date">
                <input type="date" className={inputCls()} value={payslipForm.payDate}
                  onChange={(e) => setPayslipForm({ ...payslipForm, payDate: e.target.value })} />
              </FormField>
              <FormField label="Payment Method">
                <input type="text" className={inputCls()} value={payslipForm.paymentMethod}
                  onChange={(e) => setPayslipForm({ ...payslipForm, paymentMethod: e.target.value })} />
              </FormField>
            </div>

            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Earnings (RM)</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={basicPayLabel(payslipTarget.role)}>
                <input type="number" className={inputCls()} value={payslipForm.basicSalary} min={0}
                  onChange={(e) => setPayslipForm({ ...payslipForm, basicSalary: Number(e.target.value) })} />
              </FormField>
              <FormField label="Sales Commission">
                <input type="number" className={inputCls()} value={payslipForm.salesCommission} min={0}
                  onChange={(e) => setPayslipForm({ ...payslipForm, salesCommission: Number(e.target.value) })} />
              </FormField>
              <FormField label="Performance Bonus">
                <input type="number" className={inputCls()} value={payslipForm.performanceBonus} min={0}
                  onChange={(e) => setPayslipForm({ ...payslipForm, performanceBonus: Number(e.target.value) })} />
              </FormField>
              <FormField label="Allowance">
                <input type="number" className={inputCls()} value={payslipForm.allowance} min={0}
                  onChange={(e) => setPayslipForm({ ...payslipForm, allowance: Number(e.target.value) })} />
              </FormField>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Deductions (RM)</p>
              <label className="flex items-center gap-1.5 text-xs text-amber-400 cursor-pointer">
                <input type="checkbox" checked={payslipForm.onProbation} onChange={(e) => toggleProbation(e.target.checked)} />
                On probation — don't declare EPF/SOCSO/EIS yet
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="EPF (Employee)">
                <input type="number" className={inputCls()} value={payslipForm.epfEmployee} min={0} disabled={payslipForm.onProbation}
                  onChange={(e) => setPayslipForm({ ...payslipForm, epfEmployee: Number(e.target.value) })} />
              </FormField>
              <FormField label="SOCSO">
                <input type="number" className={inputCls()} value={payslipForm.socsoEmployee} min={0} disabled={payslipForm.onProbation}
                  onChange={(e) => setPayslipForm({ ...payslipForm, socsoEmployee: Number(e.target.value) })} />
              </FormField>
              <FormField label="EIS">
                <input type="number" className={inputCls()} value={payslipForm.eisEmployee} min={0} disabled={payslipForm.onProbation}
                  onChange={(e) => setPayslipForm({ ...payslipForm, eisEmployee: Number(e.target.value) })} />
              </FormField>
              <FormField label="PCB / Tax">
                <input type="number" className={inputCls()} value={payslipForm.pcbTax} min={0}
                  onChange={(e) => setPayslipForm({ ...payslipForm, pcbTax: Number(e.target.value) })} />
              </FormField>
              <FormField label="Other Deduction" className="col-span-2">
                <input type="number" className={inputCls()} value={payslipForm.otherDeduction} min={0}
                  onChange={(e) => setPayslipForm({ ...payslipForm, otherDeduction: Number(e.target.value) })} />
              </FormField>
            </div>

            {!payslipForm.onProbation && (
              <>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Employer Contribution (RM)</p>
                <div className="grid grid-cols-3 gap-3">
                  <FormField label="EPF">
                    <input type="number" className={inputCls()} value={payslipForm.epfEmployer} min={0}
                      onChange={(e) => setPayslipForm({ ...payslipForm, epfEmployer: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="SOCSO">
                    <input type="number" className={inputCls()} value={payslipForm.socsoEmployer} min={0}
                      onChange={(e) => setPayslipForm({ ...payslipForm, socsoEmployer: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="EIS">
                    <input type="number" className={inputCls()} value={payslipForm.eisEmployer} min={0}
                      onChange={(e) => setPayslipForm({ ...payslipForm, eisEmployer: Number(e.target.value) })} />
                  </FormField>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Payslip print preview */}
      {previewPayslip && (() => {
        const employee = users.find((u) => u.id === previewPayslip.userId);
        if (!employee) return null;
        const ytd = computeYtdForPayslip(payslips, employee.id, previewPayslip.payPeriodStart);
        return (
          <PayslipPreviewOverlay
            payslip={previewPayslip}
            employee={employee}
            ytd={ytd}
            onClose={() => setPreviewPayslip(null)}
          />
        );
      })()}
    </div>
  );
}
