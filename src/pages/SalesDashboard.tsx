import { useState, useMemo } from 'react';
import { Car, Users, Calendar, Bell, ChevronDown, ChevronUp, Banknote, AlertCircle, Plus, CheckCircle, Circle, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../store';
import Modal from '../components/Modal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { formatRM, generateId } from '../utils/format';

const COMMISSION_PER_CAR = 500;

export default function SalesDashboard() {
  const cars = useStore((s) => s.cars);
  const currentUser = useStore((s) => s.currentUser);
  const customers = useStore((s) => s.customers);
  const testDrives = useStore((s) => s.testDrives);
  const personalReminders = useStore((s) => s.personalReminders);
  const addPersonalReminder = useStore((s) => s.addPersonalReminder);
  const updatePersonalReminder = useStore((s) => s.updatePersonalReminder);
  const deletePersonalReminder = useStore((s) => s.deletePersonalReminder);

  const [showCommission, setShowCommission] = useState(false);
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));

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

  const myId = currentUser?.id ?? '';
  const today = new Date().toISOString().split('T')[0];

  // My customers
  const myCustomers = useMemo(() =>
    customers.filter(c => c.assignedSalesId === myId),
    [customers, myId]
  );

  const monthCustomers = useMemo(() =>
    myCustomers.filter(c => (c.lastActionAt ?? c.createdAt).startsWith(monthFilter)),
    [myCustomers, monthFilter]
  );

  const activeLeads = monthCustomers;
  const followUpToday = myCustomers.filter(c => c.followUpDate === today);
  const overdueFollowUps = myCustomers.filter(c => c.followUpDate && c.followUpDate < today);

  // My test drives this week
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  const upcomingTds = testDrives.filter(td => td.salesId === myId && td.status === 'scheduled' && td.scheduledAt.slice(0, 10) >= today && td.scheduledAt.slice(0, 10) <= weekEnd);

  // Delivered customers (commission source of truth)
  const myDeliveredCustomers = useMemo(() =>
    customers.filter(c => c.assignedSalesId === myId && c.delivered && c.deliveredAt),
    [customers, myId]
  );

  const deliveredThisMonth = useMemo(() =>
    myDeliveredCustomers.filter(c => c.deliveredAt!.startsWith(monthFilter)),
    [myDeliveredCustomers, monthFilter]
  );

  const totalCommission = useMemo(() =>
    myDeliveredCustomers.reduce((s, c) => s + (c.commission ?? COMMISSION_PER_CAR), 0),
    [myDeliveredCustomers]
  );

  const monthCommission = useMemo(() =>
    deliveredThisMonth.reduce((s, c) => s + (c.commission ?? COMMISSION_PER_CAR), 0),
    [deliveredThisMonth]
  );

  // My reminders
  const myReminders = useMemo(() =>
    personalReminders.filter(r => r.userId === myId),
    [personalReminders, myId]
  );
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

  return (
    <div className="space-y-6">
      {/* Greeting + month navigator */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-white text-xl font-bold">Good {getGreeting()}, {currentUser?.name?.split(' ')[0]} 👋</h1>
          <p className="text-gray-500 text-sm mt-0.5">{new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="flex items-center gap-1.5 bg-obsidian-700/60 border border-obsidian-400/60 rounded-xl px-1 py-1 shrink-0">
          <button onClick={prevMonth} className="p-1.5 text-gray-500 hover:text-white hover:bg-obsidian-600/60 rounded-lg transition-colors">
            <ChevronLeft size={14} />
          </button>
          <span className="text-white text-xs font-medium px-1 min-w-[90px] text-center">{monthLabel}</span>
          <button onClick={nextMonth} disabled={isCurrentMonth} className="p-1.5 text-gray-500 hover:text-white hover:bg-obsidian-600/60 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users} label={`Leads (${monthLabel.split(' ')[0]})`} value={activeLeads.length} color="text-gold-400" iconBg="bg-gold-500/10" />
        <StatCard
          icon={AlertCircle}
          label="Follow-ups Today"
          value={followUpToday.length + overdueFollowUps.length}
          color={overdueFollowUps.length > 0 ? 'text-red-400' : followUpToday.length > 0 ? 'text-yellow-400' : 'text-gray-400'}
          iconBg={overdueFollowUps.length > 0 ? 'bg-red-500/10' : 'bg-yellow-500/10'}
          sub={overdueFollowUps.length > 0 ? `${overdueFollowUps.length} overdue` : undefined}
        />
        <StatCard icon={Car} label="Test Drives This Week" value={upcomingTds.length} color="text-purple-400" iconBg="bg-purple-500/10" />
        <StatCard icon={Banknote} label={`Commission (${monthLabel.split(' ')[0]})`} value={`RM ${monthCommission.toLocaleString()}`} color="text-green-400" iconBg="bg-green-500/10" />
      </div>

      {/* Follow-ups & Test drives row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Overdue / Today follow-ups */}
        <div className="card-surface rounded-xl p-4 space-y-3">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <Calendar size={15} className="text-yellow-400" />
            Follow-ups Due
          </h2>
          {[...overdueFollowUps, ...followUpToday].length === 0 ? (
            <p className="text-gray-600 text-xs py-3 text-center">No urgent follow-ups</p>
          ) : (
            <div className="space-y-2">
              {[...overdueFollowUps, ...followUpToday].map(c => (
                <div key={c.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm">{c.name}</p>
                    <p className="text-gray-500 text-xs">{getCarName(c.interestedCarId)}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    c.followUpDate! < today ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {c.followUpDate! < today ? 'Overdue' : 'Today'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming test drives */}
        <div className="card-surface rounded-xl p-4 space-y-3">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <Car size={15} className="text-purple-400" />
            Upcoming Test Drives
          </h2>
          {upcomingTds.length === 0 ? (
            <p className="text-gray-600 text-xs py-3 text-center">No test drives scheduled this week</p>
          ) : (
            <div className="space-y-2">
              {upcomingTds.map(td => {
                const customer = customers.find(c => c.id === td.customerId);
                return (
                  <div key={td.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm">{customer?.name ?? '—'}</p>
                      <p className="text-gray-500 text-xs">{getCarName(td.carId)}</p>
                    </div>
                    <span className="text-purple-400 text-xs">
                      {new Date(td.scheduledAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Reminders */}
      <div className="card-surface rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <Bell size={15} className="text-gold-400" />
            My Reminders
            {activeReminders.length > 0 && (
              <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded-full leading-none">{activeReminders.length}</span>
            )}
          </h2>
          <button
            onClick={() => setShowReminderModal(true)}
            className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300 transition-colors"
          >
            <Plus size={13} />Add
          </button>
        </div>

        {myReminders.length === 0 ? (
          <p className="text-gray-600 text-xs py-2 text-center">No reminders yet</p>
        ) : (
          <div className="space-y-1.5">
            {[...activeReminders, ...completedReminders].slice(0, 5).map(r => {
              const dueStatus = getDueStatus(r.dueAt);
              return (
                <div key={r.id} className={`flex items-center gap-2.5 ${r.isCompleted ? 'opacity-50' : ''}`}>
                  <button onClick={() => updatePersonalReminder(r.id, { isCompleted: !r.isCompleted })}
                    className={r.isCompleted ? 'text-green-400' : 'text-gray-600 hover:text-green-400 transition-colors'}>
                    {r.isCompleted ? <CheckCircle size={15} /> : <Circle size={15} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs truncate ${r.isCompleted ? 'line-through text-gray-500' : 'text-white'}`}>{r.title}</p>
                  </div>
                  <span className={`text-xs shrink-0 ${
                    r.isCompleted ? 'text-gray-600' :
                    dueStatus === 'overdue' ? 'text-red-400' :
                    dueStatus === 'today' ? 'text-yellow-400' : 'text-gray-600'
                  }`}>
                    {new Date(r.dueAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                  </span>
                  <button onClick={() => setDeleteTarget({ id: r.id, label: r.title })} className="text-gray-700 hover:text-red-400 transition-colors shrink-0">
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Commission toggle section */}
      <div className="card-surface rounded-xl overflow-hidden">
        <button
          onClick={() => setShowCommission(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-obsidian-700/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-500/10 rounded-lg flex items-center justify-center">
              <Banknote size={16} className="text-green-400" />
            </div>
            <div className="text-left">
              <p className="text-white font-semibold text-sm">My Commission</p>
              <p className="text-gray-500 text-xs">
                {myDeliveredCustomers.length} deliveries · {formatRM(totalCommission)} total earned
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green-400 font-bold text-sm">{formatRM(monthCommission)}<span className="text-gray-600 font-normal text-xs"> {monthLabel.split(' ')[0]}</span></span>
            {showCommission
              ? <ChevronUp size={16} className="text-gray-500" />
              : <ChevronDown size={16} className="text-gray-500" />
            }
          </div>
        </button>

        {showCommission && (
          <div className="border-t border-obsidian-400/60 p-5 space-y-4">
            {/* Mini stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Deliveries', value: myDeliveredCustomers.length, color: 'text-gold-400' },
                { label: 'Total Earned', value: formatRM(totalCommission), color: 'text-green-400' },
                { label: monthLabel, value: formatRM(monthCommission), color: 'text-yellow-400' },
              ].map(s => (
                <div key={s.label} className="bg-obsidian-700/60 rounded-xl p-3 text-center border border-obsidian-400/50">
                  <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Table */}
            {deliveredThisMonth.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-4">No deliveries in {monthLabel}</p>
            ) : (
              <div className="border border-obsidian-400/60 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs border-b border-obsidian-400/60 bg-obsidian-700/60">
                      <th className="text-left px-4 py-2.5 font-medium">Customer</th>
                      <th className="text-left px-4 py-2.5 font-medium">Delivered</th>
                      <th className="text-right px-4 py-2.5 font-medium">Deal</th>
                      <th className="text-right px-4 py-2.5 font-medium">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveredThisMonth.map((c, i) => {
                      const wo = c.loanWorkOrder ?? c.cashWorkOrder;
                      const dealPrice = wo ? (wo.sellingPrice - (wo.discount ?? 0)) : (c.dealPrice ?? 0);
                      const carObj = cars.find(x => x.id === c.interestedCarId);
                      return (
                        <tr key={c.id} className={`border-b border-obsidian-400/30 ${i % 2 !== 0 ? 'bg-obsidian-950/30' : ''}`}>
                          <td className="px-4 py-2.5">
                            <p className="text-white font-medium">{c.name}</p>
                            <p className="text-gray-500 text-xs">{carObj ? `${carObj.year} ${carObj.make} ${carObj.model}` : '—'}</p>
                          </td>
                          <td className="px-4 py-2.5 text-gray-400 text-xs">{new Date(c.deliveredAt!).toLocaleDateString('en-MY')}</td>
                          <td className="px-4 py-2.5 text-right text-gold-400 font-semibold">{formatRM(dealPrice)}</td>
                          <td className="px-4 py-2.5 text-right text-green-400 font-semibold">{formatRM(c.commission ?? COMMISSION_PER_CAR)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-obsidian-400/60 bg-obsidian-700/60">
                      <td colSpan={2} className="px-4 py-2.5 text-gray-500 text-xs">Total ({deliveredThisMonth.length})</td>
                      <td className="px-4 py-2.5 text-right text-gold-400 font-bold">
                        {formatRM(deliveredThisMonth.reduce((s, c) => {
                          const wo = c.loanWorkOrder ?? c.cashWorkOrder;
                          return s + (wo ? wo.sellingPrice - (wo.discount ?? 0) : (c.dealPrice ?? 0));
                        }, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right text-green-400 font-bold">{formatRM(monthCommission)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

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
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, iconBg, sub }: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: string;
  iconBg: string;
  sub?: string;
}) {
  return (
    <div className="card-surface rounded-xl p-4 flex items-start gap-3">
      <div className={`w-9 h-9 ${iconBg} rounded-lg flex items-center justify-center shrink-0`}>
        <Icon size={17} className={color} />
      </div>
      <div className="min-w-0">
        <p className={`text-xl font-bold ${color}`}>{value}</p>
        <p className="text-gray-400 text-xs leading-tight">{label}</p>
        {sub && <p className="text-red-400 text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
