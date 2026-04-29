import { useState, useMemo } from 'react';
import { Car, Plus, CheckCircle, Circle, Trash2, Bell } from 'lucide-react';
import { useStore } from '../store';
import Modal from '../components/Modal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { formatRM, generateId } from '../utils/format';

export default function Commission() {
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const currentUser = useStore((s) => s.currentUser);
  const users = useStore((s) => s.users);
  const customers = useStore((s) => s.customers);
  const personalReminders = useStore((s) => s.personalReminders);
  const addPersonalReminder = useStore((s) => s.addPersonalReminder);
  const updatePersonalReminder = useStore((s) => s.updatePersonalReminder);
  const deletePersonalReminder = useStore((s) => s.deletePersonalReminder);

  const isDirector = currentUser?.role === 'director';
  const [tab, setTab] = useState<'commission' | 'reminders'>('commission');
  const [salesFilter, setSalesFilter] = useState<string>(isDirector ? '' : (currentUser?.id ?? ''));
  const [monthFilter, setMonthFilter] = useState<string>(new Date().toISOString().slice(0, 7));
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderForm, setReminderForm] = useState({ title: '', dueAt: '' });
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  const salespeople = users.filter(u => u.role === 'salesperson');

  const allSoldCars = cars.filter(c => c.status === 'delivered');

  const getDealSalespersonId = (car: typeof cars[0]): string | undefined => {
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    return car.assignedSalesperson || dealCustomer?.assignedSalesId;
  };

  const getRepairCosts = (carId: string) =>
    repairs.filter(r => r.carId === carId && r.status === 'done').reduce((s, r) => s + (r.actualCost ?? r.totalCost), 0);

  const getSaleDate = (car: typeof cars[0]): string => {
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    return dealCustomer?.deliveredAt
      ?? dealCustomer?.loanWorkOrder?.createdAt
      ?? dealCustomer?.cashWorkOrder?.createdAt
      ?? car.dateAdded;
  };

  const calcCommission = (car: typeof cars[0]): number => {
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    const wo = dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
    const dealPrice = (wo?.sellingPrice ?? car.sellingPrice) - (wo?.discount ?? 0);
    const repairCosts = getRepairCosts(car.id);
    const miscCosts = (car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0);
    const additionalTotal = wo?.additionalItems?.reduce((s, i) => s + i.amount, 0) ?? 0;
    const netBeforeComm = dealPrice - car.purchasePrice - repairCosts - miscCosts - additionalTotal;
    if (car.priceFloor != null) {
      return dealPrice >= car.priceFloor ? (netBeforeComm >= 10000 ? 2000 : 1500) : 1000;
    }
    return netBeforeComm >= 10000 ? 1500 : 1000;
  };

  const filteredSoldCars = useMemo(() => allSoldCars.filter(c => {
    const matchSales = !salesFilter || getDealSalespersonId(c) === salesFilter;
    const matchMonth = !monthFilter || getSaleDate(c).startsWith(monthFilter);
    return matchSales && matchMonth;
  }), [allSoldCars, salesFilter, monthFilter, customers]);

  const allFilteredForSp = allSoldCars.filter(c => !salesFilter || getDealSalespersonId(c) === salesFilter);
  const totalSoldAll = allFilteredForSp.length;
  const totalCommissionAll = allFilteredForSp.reduce((s, c) => s + calcCommission(c), 0);
  const monthSold = filteredSoldCars.length;
  const monthCommission = filteredSoldCars.reduce((s, c) => s + calcCommission(c), 0);

  const getSalesName = (id?: string) => {
    if (!id) return 'Unassigned';
    return users.find(u => u.id === id)?.name ?? id;
  };

  const myReminders = useMemo(() =>
    personalReminders.filter(r => r.userId === currentUser?.id),
    [personalReminders, currentUser]
  );

  const activeReminders = myReminders.filter(r => !r.isCompleted);
  const completedReminders = myReminders.filter(r => r.isCompleted);

  const handleAddReminder = () => {
    if (!reminderForm.title.trim() || !reminderForm.dueAt) return;
    addPersonalReminder({
      id: generateId(),
      userId: currentUser?.id ?? '',
      title: reminderForm.title,
      dueAt: reminderForm.dueAt,
      isCompleted: false,
      createdAt: new Date().toISOString(),
    });
    setReminderForm({ title: '', dueAt: '' });
    setShowReminderModal(false);
  };

  const getDueStatus = (dueAt: string) => {
    const today = new Date().toISOString().split('T')[0];
    if (dueAt < today) return 'overdue';
    if (dueAt === today) return 'today';
    return 'upcoming';
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-white text-xl font-bold">Commission & Reminders</h1>
        <p className="text-gray-500 text-sm mt-0.5">Tiered commission based on deal price and profit</p>
      </div>

      {/* Tabs */}
      <div className="flex bg-[#0F0E0C] border border-obsidian-400/60 rounded-lg p-1 gap-1 w-fit">
        {(['commission', 'reminders'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize flex items-center gap-2 ${tab === t ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            {t === 'reminders' ? 'My Reminders' : 'Commission'}
            {t === 'reminders' && activeReminders.length > 0 && (
              <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded-full leading-none">{activeReminders.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'commission' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total Cars Sold', value: totalSoldAll, sub: 'all time', color: 'text-gold-400' },
              { label: 'Total Earned', value: formatRM(totalCommissionAll), sub: 'all time', color: 'text-green-400' },
              { label: 'This Month Sold', value: monthSold, sub: monthFilter, color: 'text-yellow-400' },
              { label: 'This Month Earned', value: formatRM(monthCommission), sub: monthFilter, color: 'text-purple-400' },
            ].map(s => (
              <div key={s.label} className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-gray-400 text-xs mt-1">{s.label}</p>
                <p className="text-gray-600 text-xs">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            {isDirector && (
              <select
                value={salesFilter}
                onChange={e => setSalesFilter(e.target.value)}
                className="input rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
              >
                <option value="">All Salespeople</option>
                {salespeople.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            <input
              type="month"
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              className="input rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
            />
            {monthFilter && (
              <button
                onClick={() => setMonthFilter('')}
                className="text-gray-500 hover:text-white text-sm px-3 py-2 border border-obsidian-400/60 rounded-lg transition-colors"
              >
                Show All
              </button>
            )}
          </div>

          {/* Table */}
          {filteredSoldCars.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
              <Car size={36} className="text-gray-600 mb-3" />
              <p className="text-gray-400">No sold cars in this period</p>
            </div>
          ) : (
            <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-obsidian-400/60 bg-[#161410]">
                    <th className="text-left px-5 py-3 font-medium">Vehicle</th>
                    <th className="text-left px-5 py-3 font-medium">Sale Date</th>
                    {isDirector && <th className="text-left px-5 py-3 font-medium">Salesperson</th>}
                    <th className="text-right px-5 py-3 font-medium">Deal Price</th>
                    <th className="text-right px-5 py-3 font-medium">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSoldCars.map((c, i) => (
                    <tr key={c.id} className={`border-b border-obsidian-400/60/50 ${i % 2 !== 0 ? 'bg-obsidian-950/30' : ''} hover:bg-obsidian-700/50 transition-colors`}>
                      <td className="px-5 py-3">
                        <p className="text-white font-medium">{c.year} {c.make} {c.model}</p>
                        <p className="text-gray-500 text-xs capitalize">{c.colour} · {c.transmission}</p>
                      </td>
                      <td className="px-5 py-3 text-gray-400">{new Date(getSaleDate(c)).toLocaleDateString('en-MY')}</td>
                      {isDirector && <td className="px-5 py-3 text-gray-400">{getSalesName(getDealSalespersonId(c))}</td>}
                      <td className="px-5 py-3 text-right text-gold-400 font-semibold">
                        {formatRM(c.finalDeal?.dealPrice ?? c.sellingPrice)}
                      </td>
                      <td className="px-5 py-3 text-right text-green-400 font-semibold">{formatRM(calcCommission(c))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-obsidian-400/60 bg-[#161410]">
                    <td colSpan={isDirector ? 3 : 2} className="px-5 py-3 text-gray-400 text-xs font-medium">
                      Total ({filteredSoldCars.length} cars)
                    </td>
                    <td className="px-5 py-3 text-right text-gold-400 font-bold">
                      {formatRM(filteredSoldCars.reduce((sum, c) => sum + (c.finalDeal?.dealPrice ?? c.sellingPrice), 0))}
                    </td>
                    <td className="px-5 py-3 text-right text-green-400 font-bold">
                      {formatRM(filteredSoldCars.reduce((s, c) => s + calcCommission(c), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'reminders' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowReminderModal(true)}
              className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm"
            >
              <Plus size={16} />Add Reminder
            </button>
          </div>

          {myReminders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
              <Bell size={36} className="text-gray-600 mb-3" />
              <p className="text-gray-400">No reminders yet. Add one to stay on track.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...activeReminders, ...completedReminders].map(r => {
                const dueStatus = getDueStatus(r.dueAt);
                return (
                  <div
                    key={r.id}
                    className={`bg-[#0F0E0C] border rounded-xl px-4 py-3 flex items-center gap-3 transition-colors ${
                      r.isCompleted ? 'border-obsidian-400/60 opacity-50' :
                      dueStatus === 'overdue' ? 'border-red-500/30' :
                      dueStatus === 'today' ? 'border-yellow-500/30' : 'border-obsidian-400/60'
                    }`}
                  >
                    <button
                      onClick={() => updatePersonalReminder(r.id, { isCompleted: !r.isCompleted })}
                      className={r.isCompleted ? 'text-green-400' : 'text-gray-600 hover:text-green-400 transition-colors'}
                    >
                      {r.isCompleted ? <CheckCircle size={18} /> : <Circle size={18} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${r.isCompleted ? 'line-through text-gray-500' : 'text-white'}`}>{r.title}</p>
                      <p className={`text-xs mt-0.5 ${
                        r.isCompleted ? 'text-gray-600' :
                        dueStatus === 'overdue' ? 'text-red-400' :
                        dueStatus === 'today' ? 'text-yellow-400' : 'text-gray-500'
                      }`}>
                        {!r.isCompleted && dueStatus === 'overdue' ? 'Overdue · ' : ''}
                        {!r.isCompleted && dueStatus === 'today' ? 'Due today · ' : ''}
                        {new Date(r.dueAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <button
                      onClick={() => setDeleteTarget({ id: r.id, label: r.title })}
                      className="text-gray-600 hover:text-red-400 transition-colors p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <Modal isOpen={showReminderModal} onClose={() => setShowReminderModal(false)} title="Add Reminder" maxWidth="max-w-sm">
            <div className="space-y-4">
              <div>
                <label className="block text-gray-300 text-xs font-medium mb-1.5">What to remember?</label>
                <input
                  className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors"
                  value={reminderForm.title}
                  onChange={e => setReminderForm({ ...reminderForm, title: e.target.value })}
                  placeholder="e.g. Follow up with Ahmad about loan"
                  onKeyDown={e => { if (e.key === 'Enter') handleAddReminder(); }}
                />
              </div>
              <div>
                <label className="block text-gray-300 text-xs font-medium mb-1.5">Due Date</label>
                <input
                  type="date"
                  className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors"
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
                className="flex-1 btn-gold disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm"
              >
                Save
              </button>
            </div>
          </Modal>
        </div>
      )}
      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) deletePersonalReminder(deleteTarget.id); }}
        itemName={deleteTarget?.label ?? ''}
      />
    </div>
  );
}
