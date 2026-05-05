import { useState, useMemo } from 'react';
import { Car, Users, Calendar, Bell, ChevronDown, ChevronUp, AlertCircle, Plus, CheckCircle, Circle, Trash2, ChevronLeft, ChevronRight, Eye, EyeOff, Lock, RefreshCw, Skull, X } from 'lucide-react';
import { useStore } from '../store';
import Modal from '../components/Modal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { formatRM, generateId } from '../utils/format';

export default function SalesDashboard() {
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const currentUser = useStore((s) => s.currentUser);
  const customers = useStore((s) => s.customers);
  const testDrives = useStore((s) => s.testDrives);
  const personalReminders = useStore((s) => s.personalReminders);
  const addPersonalReminder = useStore((s) => s.addPersonalReminder);
  const updatePersonalReminder = useStore((s) => s.updatePersonalReminder);
  const deletePersonalReminder = useStore((s) => s.deletePersonalReminder);
  const updateTestDrive = useStore((s) => s.updateTestDrive);
  const updateCustomer = useStore((s) => s.updateCustomer);

  const [showCommission, setShowCommission] = useState(false);
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));

  // Salary visibility — Maybank style
  const [salaryVisible, setSalaryVisible] = useState(false);
  const [pinVerified, setPinVerified] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const handleEyeToggle = () => {
    if (salaryVisible) {
      setSalaryVisible(false);
      setPinVerified(false);
    } else if (pinVerified) {
      setSalaryVisible(true);
    } else {
      setPinInput('');
      setPinError('');
      setShowPinModal(true);
    }
  };

  const handlePinSubmit = () => {
    if (pinInput === currentUser?.password) {
      setPinVerified(true);
      setSalaryVisible(true);
      setShowPinModal(false);
      setPinError('');
    } else {
      setPinError('Incorrect password');
    }
  };

  const prevMonth = () => setMonthFilter(m => {
    const d = new Date(m + '-01');
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const nextMonth = () => setMonthFilter(m => {
    const d = new Date(m + '-01');
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 7);
  });
  const isCurrentMonth = monthFilter === new Date().toISOString().slice(0, 7);
  const monthLabel = new Date(monthFilter + '-01').toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderForm, setReminderForm] = useState({ title: '', dueAt: '' });
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<{ tdId: string; customerName: string } | null>(null);
  const [deadLeadTarget, setDeadLeadTarget] = useState<{ tdId: string; customerId: string; customerName: string } | null>(null);

  const myId = currentUser?.id ?? '';
  const today = new Date().toISOString().split('T')[0];

  const calcDealCommission = (car: typeof cars[0]): number => {
    if (car.outgoingConsignment) return 0;
    const wo = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    const workOrder = wo?.loanWorkOrder ?? wo?.cashWorkOrder;
    const dealPrice = (workOrder?.sellingPrice ?? car.finalDeal?.dealPrice ?? car.sellingPrice) - (workOrder?.discount ?? 0);
    const repairCost = repairs.filter(r => r.carId === car.id && r.status === 'done').reduce((s, r) => s + (r.actualCost ?? r.totalCost), 0);
    const miscCost = (car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0);
    const additionalTotal = workOrder?.additionalItems?.reduce((s, i) => s + i.amount, 0) ?? 0;
    const net = dealPrice - car.purchasePrice - repairCost - miscCost - additionalTotal;
    if (car.priceFloor != null) return dealPrice >= car.priceFloor ? (net >= 10000 ? 2000 : 1500) : 1000;
    return net >= 10000 ? 1500 : 1000;
  };

  const getSaleDate = (car: typeof cars[0]): string => {
    const wo = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    return wo?.deliveredAt ?? wo?.loanWorkOrder?.createdAt ?? wo?.cashWorkOrder?.createdAt ?? car.dateAdded;
  };

  const myCustomers = useMemo(() => customers.filter(c => c.assignedSalesId === myId), [customers, myId]);
  const activeLeads = useMemo(() => myCustomers.filter(c => !c.isDead && !c.isTrashed), [myCustomers]);
  const followUpToday = myCustomers.filter(c => !c.isDead && !c.isTrashed && c.followUpDate === today);
  const overdueFollowUps = myCustomers.filter(c => !c.isDead && !c.isTrashed && c.followUpDate && c.followUpDate < today);

  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  // All active scheduled test drives — overdue included so salesman sees them
  const upcomingTds = useMemo(() =>
    testDrives
      .filter(td => td.salesId === myId && td.status === 'scheduled')
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    [testDrives, myId]
  );
  const tdUrgentCount = upcomingTds.filter(td => td.scheduledAt.slice(0, 10) <= tomorrow).length;

  const getTdStatus = (scheduledAt: string): 'overdue' | 'today' | 'tomorrow' | 'upcoming' => {
    const d = scheduledAt.slice(0, 10);
    if (d < today) return 'overdue';
    if (d === today) return 'today';
    if (d === tomorrow) return 'tomorrow';
    return 'upcoming';
  };

  const mySoldCars = useMemo(() => cars.filter(c => c.status === 'delivered' && c.assignedSalesperson === myId), [cars, myId]);
  const mySoldCarsMonth = useMemo(() => mySoldCars.filter(c => getSaleDate(c).startsWith(monthFilter)), [mySoldCars, monthFilter, customers]);
  const totalCommission = useMemo(() => mySoldCars.reduce((s, c) => s + calcDealCommission(c), 0), [mySoldCars, customers, repairs]);
  const monthCommission = useMemo(() => mySoldCarsMonth.reduce((s, c) => s + calcDealCommission(c), 0), [mySoldCarsMonth, customers, repairs]);

  const mySourcingCars = useMemo(() =>
    cars.filter(c => c.sourceType === 'internal' && c.sourceSalesmanId === myId && c.status !== 'coming_soon' && c.carInDate),
    [cars, myId]
  );
  const mySourcingCarsMonth = useMemo(() => mySourcingCars.filter(c => c.carInDate!.startsWith(monthFilter)), [mySourcingCars, monthFilter]);
  const totalSourcingComm = mySourcingCars.reduce((s, c) => s + (c.sourceCommission ?? 0), 0);
  const monthSourcingComm = mySourcingCarsMonth.reduce((s, c) => s + (c.sourceCommission ?? 0), 0);

  const myIntakeCars = useMemo(() =>
    cars.filter(c => c.sourceType === 'external' && c.assignedSalesperson === myId && c.intakeCommission != null && c.status !== 'coming_soon' && c.carInDate),
    [cars, myId]
  );
  const myIntakeCarsMonth = useMemo(() => myIntakeCars.filter(c => c.carInDate!.startsWith(monthFilter)), [myIntakeCars, monthFilter]);
  const totalIntakeComm = myIntakeCars.reduce((s, c) => s + (c.intakeCommission ?? 0), 0);
  const monthIntakeComm = myIntakeCarsMonth.reduce((s, c) => s + (c.intakeCommission ?? 0), 0);

  const totalMonthSalary = monthCommission + monthSourcingComm + monthIntakeComm;
  const totalAllTime = totalCommission + totalSourcingComm + totalIntakeComm;

  const myReminders = useMemo(() => personalReminders.filter(r => r.userId === myId), [personalReminders, myId]);
  const activeReminders = myReminders.filter(r => !r.isCompleted);
  const completedReminders = myReminders.filter(r => r.isCompleted);

  const getDueStatus = (dueAt: string) => {
    if (dueAt < today) return 'overdue';
    if (dueAt === today) return 'today';
    return 'upcoming';
  };

  const getCarName = (carId?: string) => {
    const car = cars.find(c => c.id === carId);
    return car ? `${car.year} ${car.make} ${car.model}` : '—';
  };

  const handleAddReminder = () => {
    if (!reminderForm.title.trim() || !reminderForm.dueAt) return;
    addPersonalReminder({
      id: generateId(),
      userId: myId,
      title: reminderForm.title,
      dueAt: reminderForm.dueAt,
      isCompleted: false,
      createdAt: new Date().toISOString(),
    });
    setReminderForm({ title: '', dueAt: '' });
    setShowReminderModal(false);
  };

  const mask = (val: string) => salaryVisible ? val : '****';

  return (
    <div className="space-y-4">

      {/* ── SALARY HERO CARD ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-obsidian-700 via-obsidian-800 to-obsidian-900 border border-obsidian-500/40 shadow-xl">
        {/* Green glow accent */}
        <div className="absolute -top-10 -right-10 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-gold-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className="relative px-5 pt-5 pb-4">

          {/* Top row: greeting + month nav */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-gray-400 text-xs">{getGreeting()},</p>
              <p className="text-white font-bold text-base leading-tight">{currentUser?.name?.split(' ')[0]}</p>
            </div>
            <div className="flex items-center gap-1 bg-obsidian-600/60 border border-obsidian-400/40 rounded-xl px-1 py-1">
              <button onClick={prevMonth} className="p-1.5 text-gray-500 hover:text-white hover:bg-obsidian-500/60 rounded-lg transition-colors">
                <ChevronLeft size={13} />
              </button>
              <span className="text-white text-[11px] font-medium px-1 min-w-[88px] text-center">{monthLabel}</span>
              <button onClick={nextMonth} disabled={isCurrentMonth} className="p-1.5 text-gray-500 hover:text-white hover:bg-obsidian-500/60 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronRight size={13} />
              </button>
            </div>
          </div>

          {/* Salary amount */}
          <div className="mb-1">
            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">My Salary</p>
            <div className="flex items-center gap-3">
              <span className="text-white font-bold text-3xl tracking-tight">
                {salaryVisible ? formatRM(totalMonthSalary) : 'RM ****'}
              </span>
              <button
                onClick={handleEyeToggle}
                className="w-8 h-8 rounded-full bg-obsidian-600/60 border border-obsidian-400/40 flex items-center justify-center text-gray-400 hover:text-white hover:border-obsidian-300/60 transition-all"
              >
                {salaryVisible ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-gray-600 text-xs mt-1">All-time: {salaryVisible ? formatRM(totalAllTime) : '****'}</p>
          </div>

          {/* Divider */}
          <div className="border-t border-obsidian-500/40 my-4" />

          {/* Breakdown pills */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="text-center">
              <p className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">Car Sold</p>
              <p className="text-emerald-400 font-bold text-sm">{mask(formatRM(monthCommission))}</p>
              <p className="text-gray-600 text-[10px]">{mySoldCarsMonth.length} car{mySoldCarsMonth.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="text-center border-l border-obsidian-500/40">
              <p className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">Sourcing</p>
              <p className="text-blue-400 font-bold text-sm">{mask(formatRM(monthSourcingComm))}</p>
              <p className="text-gray-600 text-[10px]">{mySourcingCarsMonth.length} car{mySourcingCarsMonth.length !== 1 ? 's' : ''}</p>
            </div>
          </div>

          {/* Expand breakdown toggle */}
          <button
            onClick={() => setShowCommission(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-gray-500 hover:text-gray-300 text-xs transition-colors border-t border-obsidian-500/40"
          >
            {showCommission ? 'Hide breakdown' : 'View breakdown'}
            {showCommission ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>

        {/* Breakdown panel */}
        {showCommission && (
          <div className="border-t border-obsidian-500/40 bg-obsidian-950/40 divide-y divide-obsidian-500/30">

            {/* Car Sold table */}
            <div className="px-5 py-4 space-y-2">
              <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />Car Sold Commission
              </p>
              {mySoldCarsMonth.length === 0 ? (
                <p className="text-gray-600 text-xs py-2">No sold cars in {monthLabel}</p>
              ) : (
                <div className="border border-obsidian-500/40 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-[10px] border-b border-obsidian-500/40 bg-obsidian-800/60">
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide">Vehicle</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide">Date</th>
                        <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide">Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mySoldCarsMonth.map((c, i) => (
                        <tr key={c.id} className={`border-b border-obsidian-500/20 last:border-0 ${i % 2 !== 0 ? 'bg-obsidian-900/30' : ''}`}>
                          <td className="px-3 py-2.5">
                            <p className="text-white text-xs font-medium">{c.year} {c.make} {c.model}</p>
                            <p className="text-gray-600 text-[10px]">{c.colour}</p>
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">{new Date(getSaleDate(c)).toLocaleDateString('en-MY')}</td>
                          <td className="px-3 py-2.5 text-right text-emerald-400 font-semibold text-xs">{mask(formatRM(calcDealCommission(c)))}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-obsidian-500/40 bg-obsidian-800/60">
                        <td colSpan={2} className="px-3 py-2 text-gray-500 text-[10px]">Total ({mySoldCarsMonth.length})</td>
                        <td className="px-3 py-2 text-right text-emerald-400 font-bold text-xs">{mask(formatRM(monthCommission))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* Sourcing table */}
            <div className="px-5 py-4 space-y-2">
              <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />Sourcing Commission
              </p>
              {mySourcingCarsMonth.length === 0 ? (
                <p className="text-gray-600 text-xs py-2">No sourcing commission in {monthLabel}</p>
              ) : (
                <div className="border border-obsidian-500/40 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-[10px] border-b border-obsidian-500/40 bg-obsidian-800/60">
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide">Vehicle</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide">Status</th>
                        <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide">Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mySourcingCarsMonth.map((c, i) => (
                        <tr key={c.id} className={`border-b border-obsidian-500/20 last:border-0 ${i % 2 !== 0 ? 'bg-obsidian-900/30' : ''}`}>
                          <td className="px-3 py-2.5">
                            <p className="text-white text-xs font-medium">{c.year} {c.make} {c.model}</p>
                            <p className="text-gray-600 text-[10px]">{c.carInDate ? new Date(c.carInDate).toLocaleDateString('en-MY') : '—'}</p>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-[10px] capitalize px-2 py-0.5 rounded-full bg-obsidian-700/60 text-gray-400">{c.status.replace(/_/g, ' ')}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-blue-400 font-semibold text-xs">{mask(formatRM(c.sourceCommission ?? 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-obsidian-500/40 bg-obsidian-800/60">
                        <td colSpan={2} className="px-3 py-2 text-gray-500 text-[10px]">Total ({mySourcingCarsMonth.length})</td>
                        <td className="px-3 py-2 text-right text-blue-400 font-bold text-xs">{mask(formatRM(monthSourcingComm))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* ── QUICK STATS ── */}
      <div className="grid grid-cols-3 gap-3">
        <QuickStat
          icon={Users}
          label="Leads"
          value={activeLeads.length}
          sub="active"
          color="text-gold-400"
          iconBg="bg-gold-500/10"
        />
        <QuickStat
          icon={AlertCircle}
          label="Follow-ups"
          value={followUpToday.length + overdueFollowUps.length}
          sub={overdueFollowUps.length > 0 ? `${overdueFollowUps.length} overdue` : 'today'}
          color={overdueFollowUps.length > 0 ? 'text-red-400' : followUpToday.length > 0 ? 'text-yellow-400' : 'text-gray-500'}
          iconBg={overdueFollowUps.length > 0 ? 'bg-red-500/10' : 'bg-yellow-500/10'}
          alert={overdueFollowUps.length > 0}
        />
        <QuickStat
          icon={Car}
          label="Test Drives"
          value={upcomingTds.length}
          sub={tdUrgentCount > 0 ? `${tdUrgentCount} need action` : 'scheduled'}
          color={tdUrgentCount > 0 ? 'text-red-400' : 'text-purple-400'}
          iconBg={tdUrgentCount > 0 ? 'bg-red-500/10' : 'bg-purple-500/10'}
          alert={tdUrgentCount > 0}
        />
      </div>

      {/* ── ACTIVITY ROW ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Follow-ups Due */}
        <div className="card-surface rounded-xl p-4 space-y-3">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <div className="w-6 h-6 bg-yellow-500/10 rounded-lg flex items-center justify-center">
              <Calendar size={13} className="text-yellow-400" />
            </div>
            Follow-ups Due
          </h2>
          {[...overdueFollowUps, ...followUpToday].length === 0 ? (
            <p className="text-gray-600 text-xs py-4 text-center">No urgent follow-ups</p>
          ) : (
            <div className="space-y-2">
              {[...overdueFollowUps, ...followUpToday].map(c => (
                <div key={c.id} className="flex items-center justify-between py-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-xs font-medium truncate">{c.name}</p>
                    <p className="text-gray-500 text-[10px] truncate">{getCarName(c.interestedCarId)}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ml-2 shrink-0 font-medium ${
                    c.followUpDate! < today ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'
                  }`}>
                    {c.followUpDate! < today ? 'Overdue' : 'Today'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Test Drives */}
        <div className="card-surface rounded-xl p-4 space-y-3">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${tdUrgentCount > 0 ? 'bg-red-500/10' : 'bg-purple-500/10'}`}>
              <Car size={13} className={tdUrgentCount > 0 ? 'text-red-400' : 'text-purple-400'} />
            </div>
            Test Drives
            {tdUrgentCount > 0 && (
              <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full leading-none font-bold">{tdUrgentCount}</span>
            )}
          </h2>
          {upcomingTds.length === 0 ? (
            <p className="text-gray-600 text-xs py-4 text-center">No scheduled test drives</p>
          ) : (
            <div className="space-y-2">
              {upcomingTds.map(td => {
                const customer = customers.find(c => c.id === td.customerId);
                const tdStatus = getTdStatus(td.scheduledAt);
                const dateStr = new Date(td.scheduledAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
                return (
                  <div key={td.id} className={`rounded-xl p-3 space-y-2 border ${
                    tdStatus === 'overdue' ? 'bg-red-500/5 border-red-500/20' :
                    tdStatus === 'today'   ? 'bg-orange-500/5 border-orange-500/20' :
                    tdStatus === 'tomorrow' ? 'bg-yellow-500/5 border-yellow-500/20' :
                    'bg-obsidian-700/30 border-obsidian-500/20'
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-xs font-semibold truncate">{customer?.name ?? '—'}</p>
                        <p className="text-gray-500 text-[10px] truncate">{getCarName(td.carId)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          tdStatus === 'overdue'  ? 'bg-red-500/20 text-red-400' :
                          tdStatus === 'today'    ? 'bg-orange-500/20 text-orange-400' :
                          tdStatus === 'tomorrow' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-purple-500/15 text-purple-400'
                        }`}>
                          {tdStatus === 'overdue' ? 'Overdue' : tdStatus === 'today' ? 'Today' : tdStatus === 'tomorrow' ? 'Tomorrow' : dateStr}
                        </span>
                        {tdStatus !== 'overdue' && tdStatus !== 'today' && tdStatus !== 'tomorrow' && (
                          <span className="text-gray-600 text-[10px]">{dateStr}</span>
                        )}
                      </div>
                    </div>
                    {/* Action buttons for overdue / today / tomorrow */}
                    {(tdStatus === 'overdue' || tdStatus === 'today' || tdStatus === 'tomorrow') && (
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => { setRescheduleTarget({ tdId: td.id, customerName: customer?.name ?? '—' }); setRescheduleDay(''); setRescheduleTime(''); }}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-semibold bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 transition-colors"
                        >
                          <RefreshCw size={10} />Reschedule
                        </button>
                        {customer && (
                          <button
                            onClick={() => setDeadLeadTarget({ tdId: td.id, customerId: customer.id, customerName: customer.name })}
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-semibold bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 transition-colors"
                          >
                            <Skull size={10} />Dead Lead
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── REMINDERS ── */}
      <div className="card-surface rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <div className="w-6 h-6 bg-gold-500/10 rounded-lg flex items-center justify-center">
              <Bell size={13} className="text-gold-400" />
            </div>
            My Reminders
            {activeReminders.length > 0 && (
              <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full leading-none font-bold">{activeReminders.length}</span>
            )}
          </h2>
          <button
            onClick={() => setShowReminderModal(true)}
            className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300 transition-colors bg-gold-500/10 hover:bg-gold-500/15 px-2.5 py-1.5 rounded-lg"
          >
            <Plus size={12} />Add
          </button>
        </div>

        {myReminders.length === 0 ? (
          <p className="text-gray-600 text-xs py-3 text-center">No reminders yet</p>
        ) : (
          <div className="space-y-1">
            {[...activeReminders, ...completedReminders].slice(0, 5).map(r => {
              const dueStatus = getDueStatus(r.dueAt);
              return (
                <div key={r.id} className={`flex items-center gap-2.5 py-1.5 ${r.isCompleted ? 'opacity-40' : ''}`}>
                  <button onClick={() => updatePersonalReminder(r.id, { isCompleted: !r.isCompleted })}
                    className={r.isCompleted ? 'text-green-400 shrink-0' : 'text-gray-600 hover:text-green-400 transition-colors shrink-0'}>
                    {r.isCompleted ? <CheckCircle size={14} /> : <Circle size={14} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs truncate ${r.isCompleted ? 'line-through text-gray-500' : 'text-white'}`}>{r.title}</p>
                  </div>
                  <span className={`text-[10px] shrink-0 font-medium ${
                    r.isCompleted ? 'text-gray-600' :
                    dueStatus === 'overdue' ? 'text-red-400' :
                    dueStatus === 'today' ? 'text-yellow-400' : 'text-gray-600'
                  }`}>
                    {new Date(r.dueAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                  </span>
                  <button onClick={() => setDeleteTarget({ id: r.id, label: r.title })} className="text-gray-700 hover:text-red-400 transition-colors shrink-0">
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Password Modal */}
      <Modal isOpen={showPinModal} onClose={() => setShowPinModal(false)} title="" maxWidth="max-w-xs">
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center">
            <Lock size={20} className="text-emerald-400" />
          </div>
          <div className="text-center">
            <p className="text-white font-semibold text-sm">Enter Password</p>
            <p className="text-gray-500 text-xs mt-1">Confirm your identity to view salary</p>
          </div>
          <input
            type="password"
            className="input w-full text-center text-lg tracking-widest"
            placeholder="••••••••"
            value={pinInput}
            onChange={e => { setPinInput(e.target.value); setPinError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handlePinSubmit(); }}
            autoFocus
          />
          {pinError && <p className="text-red-400 text-xs">{pinError}</p>}
          <button
            onClick={handlePinSubmit}
            disabled={!pinInput}
            className="w-full btn-gold py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
          >
            Reveal
          </button>
        </div>
      </Modal>

      {/* Add Reminder Modal */}
      <Modal isOpen={showReminderModal} onClose={() => setShowReminderModal(false)} title="Add Reminder" maxWidth="max-w-sm">
        <div className="space-y-4">
          <div>
            <label className="block text-gray-300 text-xs font-medium mb-1.5">What to remember?</label>
            <input
              className="input"
              value={reminderForm.title}
              onChange={e => setReminderForm({ ...reminderForm, title: e.target.value })}
              placeholder="e.g. Follow up with Ahmad about loan"
              onKeyDown={e => { if (e.key === 'Enter') handleAddReminder(); }}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-gray-300 text-xs font-medium mb-1.5">Due Date</label>
            <input
              type="date"
              className="input"
              value={reminderForm.dueAt}
              onChange={e => setReminderForm({ ...reminderForm, dueAt: e.target.value })}
            />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowReminderModal(false)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button
            onClick={handleAddReminder}
            disabled={!reminderForm.title.trim() || !reminderForm.dueAt}
            className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm"
          >
            Save
          </button>
        </div>
      </Modal>

      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) deletePersonalReminder(deleteTarget.id); }}
        itemName={deleteTarget?.label ?? ''}
      />

      {/* Reschedule Modal */}
      {rescheduleTarget && (
        <RescheduleModal
          customerName={rescheduleTarget.customerName}
          onClose={() => setRescheduleTarget(null)}
          onConfirm={async (iso) => {
            await updateTestDrive(rescheduleTarget.tdId, { scheduledAt: iso });
            setRescheduleTarget(null);
          }}
        />
      )}

      {/* Dead Lead Confirm Modal */}
      <Modal isOpen={!!deadLeadTarget} onClose={() => setDeadLeadTarget(null)} title="" maxWidth="max-w-xs">
        {deadLeadTarget && (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="w-12 h-12 bg-red-500/10 border border-red-500/30 rounded-full flex items-center justify-center">
              <Skull size={20} className="text-red-400" />
            </div>
            <div className="text-center">
              <p className="text-white font-semibold text-sm">Mark as Dead Lead?</p>
              <p className="text-gray-500 text-xs mt-1">
                <span className="text-white">{deadLeadTarget.customerName}</span> will be moved to dead leads and the test drive cancelled.
              </p>
            </div>
            <div className="flex gap-3 w-full">
              <button onClick={() => setDeadLeadTarget(null)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
              <button
                onClick={async () => {
                  await Promise.all([
                    updateCustomer(deadLeadTarget.customerId, { isDead: true, deadAt: new Date().toISOString() }),
                    updateTestDrive(deadLeadTarget.tdId, { status: 'cancelled' }),
                  ]);
                  setDeadLeadTarget(null);
                }}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function RescheduleModal({ customerName, onClose, onConfirm }: {
  customerName: string;
  onClose: () => void;
  onConfirm: (iso: string) => Promise<void>;
}) {
  const todayStr = new Date().toISOString().split('T')[0];
  const [step, setStep] = useState<'date' | 'time'>('date');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const firstOfMonth = new Date(viewMonth.year, viewMonth.month, 1);
  const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
  const startDow = firstOfMonth.getDay();
  const monthLabel = firstOfMonth.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });

  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null);

  const toDateStr = (day: number) => {
    const d = new Date(viewMonth.year, viewMonth.month, day);
    return d.toISOString().split('T')[0];
  };

  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  const fmtHour = (h: number) => h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;

  const readableDate = selectedDate
    ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' })
    : '';
  const readableTime = selectedHour !== null && selectedMinute !== null
    ? `${fmtHour(selectedHour)} ${selectedMinute === 0 ? '00' : '30'}`
    : '';

  const prevMonth = () => setViewMonth(m => {
    const d = new Date(m.year, m.month - 1, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const nextMonth = () => setViewMonth(m => {
    const d = new Date(m.year, m.month + 1, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const isPrevDisabled = viewMonth.year === new Date().getFullYear() && viewMonth.month === new Date().getMonth();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-obsidian-800 border border-obsidian-500/40 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-obsidian-500/30 flex items-center justify-between">
          <div>
            <p className="text-white font-semibold text-sm">Reschedule Test Drive</p>
            <p className="text-gray-500 text-xs">{customerName}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-obsidian-700/60 transition-colors">
            <X size={15} />
          </button>
        </div>

        {step === 'date' ? (
          <div className="p-5">
            {/* Month navigator */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={prevMonth}
                disabled={isPrevDisabled}
                className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-obsidian-700/60 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-white font-semibold text-sm">{monthLabel}</span>
              <button onClick={nextMonth} className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-obsidian-700/60 transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                <div key={d} className="text-center text-gray-600 text-[10px] font-bold py-1">{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-y-1">
              {cells.map((day, i) => {
                if (!day) return <div key={`e${i}`} />;
                const dateStr = toDateStr(day);
                const isPast = dateStr < todayStr;
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === selectedDate;
                return (
                  <button
                    key={day}
                    disabled={isPast}
                    onClick={() => { setSelectedDate(dateStr); setStep('time'); }}
                    className={`mx-auto w-9 h-9 flex items-center justify-center rounded-full text-sm font-medium transition-all
                      ${isPast
                        ? 'text-gray-700 cursor-not-allowed'
                        : isSelected
                          ? 'bg-gold-500 text-obsidian-900 font-bold shadow-lg'
                          : isToday
                            ? 'border border-gold-500/50 text-gold-400 hover:bg-gold-500/10'
                            : 'text-white hover:bg-obsidian-600/60'
                      }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Back link showing chosen date */}
            <button
              onClick={() => setStep('date')}
              className="flex items-center gap-1 text-gold-400 hover:text-gold-300 text-xs font-semibold transition-colors"
            >
              <ChevronLeft size={13} />
              {readableDate}
            </button>

            {/* Hour grid */}
            <div>
              <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-3">What time?</p>
              <div className="grid grid-cols-5 gap-2">
                {hours.map(h => (
                  <button
                    key={h}
                    onClick={() => setSelectedHour(h)}
                    className={`py-3 rounded-xl border text-xs font-bold transition-all ${
                      selectedHour === h
                        ? 'bg-gold-500/20 border-gold-500/60 text-gold-400'
                        : 'bg-obsidian-700/40 border-obsidian-500/30 text-gray-300 hover:border-obsidian-400/60 hover:text-white'
                    }`}
                  >
                    {fmtHour(h)}
                  </button>
                ))}
              </div>
            </div>

            {/* Minute — only after hour chosen */}
            {selectedHour !== null && (
              <div>
                <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-3">Minutes</p>
                <div className="grid grid-cols-2 gap-2">
                  {[0, 30].map(m => (
                    <button
                      key={m}
                      onClick={() => setSelectedMinute(m)}
                      className={`py-3 rounded-xl border text-sm font-bold transition-all ${
                        selectedMinute === m
                          ? 'bg-gold-500/20 border-gold-500/60 text-gold-400'
                          : 'bg-obsidian-700/40 border-obsidian-500/30 text-gray-300 hover:border-obsidian-400/60 hover:text-white'
                      }`}
                    >
                      :{String(m).padStart(2, '0')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Summary + confirm */}
            {selectedHour !== null && selectedMinute !== null && (
              <>
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3 text-center">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wide">New appointment</p>
                  <p className="text-white font-semibold text-sm mt-0.5">{readableDate} · {readableTime}</p>
                </div>
                <button
                  onClick={async () => {
                    const hh = String(selectedHour).padStart(2, '0');
                    const mm = String(selectedMinute).padStart(2, '0');
                    await onConfirm(new Date(`${selectedDate}T${hh}:${mm}:00`).toISOString());
                  }}
                  className="w-full btn-gold py-3 rounded-xl text-sm font-bold"
                >
                  Confirm
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function QuickStat({ icon: Icon, label, value, sub, color, iconBg, alert }: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub?: string;
  color: string;
  iconBg: string;
  alert?: boolean;
}) {
  return (
    <div className="card-surface rounded-xl p-3 flex flex-col gap-2">
      <div className={`w-7 h-7 ${iconBg} rounded-lg flex items-center justify-center`}>
        <Icon size={14} className={color} />
      </div>
      <div>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        <p className="text-gray-500 text-[10px] font-medium">{label}</p>
        {sub && <p className={`text-[10px] mt-0.5 ${alert ? 'text-red-400' : 'text-gray-600'}`}>{sub}</p>}
      </div>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
