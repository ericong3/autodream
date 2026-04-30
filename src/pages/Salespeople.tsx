import React, { useState } from 'react';
import { Plus, Edit, Trash2, Users, AlertCircle } from 'lucide-react';
import { useStore } from '../store';
import { User } from '../types';
import Modal from '../components/Modal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { formatRM, generateId } from '../utils/format';

function inputCls(error?: string) {
  return `w-full bg-obsidian-700/60 border ${error ? 'border-red-500/50' : 'border-obsidian-400/60'} text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors`;
}

function FormField({ label, children, error, className }: { label: string; children: React.ReactNode; error?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-gray-300 text-xs font-medium mb-1.5">{label}</label>
      {children}
      {error && <p className="text-red-400 text-xs mt-1 flex items-center gap-1"><AlertCircle size={12} />{error}</p>}
    </div>
  );
}

const emptyForm = {
  name: '',
  username: '',
  password: '',
  phone: '',
  monthlyTarget: 4,
};

export default function Salespeople() {
  const users = useStore((s) => s.users);
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const customers = useStore((s) => s.customers);
  const currentUser = useStore((s) => s.currentUser);
  const addUser = useStore((s) => s.addUser);
  const updateUser = useStore((s) => s.updateUser);
  const deleteUser = useStore((s) => s.deleteUser);

  const salespeople = users.filter((u) => u.role === 'salesperson');
  const soldCars = cars.filter((c) => c.status === 'delivered');

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const getRepairCosts = (carId: string) =>
    repairs.filter(r => r.carId === carId && r.status === 'done').reduce((s, r) => s + (r.actualCost ?? r.totalCost), 0);

  const calcCommission = (car: typeof cars[0]): number => {
    if (car.outgoingConsignment) return 0;
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

  const getDealSalespersonId = (car: typeof cars[0]): string | undefined => {
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    return car.assignedSalesperson || dealCustomer?.assignedSalesId;
  };

  const getCarsSoldByPerson = (userId: string) =>
    soldCars.filter((c) => getDealSalespersonId(c) === userId).length;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!form.username.trim()) e.username = 'Required';
    if (!editTarget && !form.password.trim()) e.password = 'Required';
    if (!form.phone.trim()) e.phone = 'Required';
    if (!form.monthlyTarget || form.monthlyTarget <= 0) e.monthlyTarget = 'Must be > 0';
    // Check username uniqueness
    const existing = users.find(
      (u) => u.username === form.username.trim() && u.id !== editTarget?.id
    );
    if (existing) e.username = 'Username already taken';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    if (editTarget) {
      updateUser(editTarget.id, {
        name: form.name,
        username: form.username,
        phone: form.phone,
        monthlyTarget: form.monthlyTarget,
        ...(form.password ? { password: form.password } : {}),
      });
    } else {
      addUser({
        id: generateId(),
        name: form.name,
        username: form.username,
        password: form.password,
        role: 'salesperson',
        phone: form.phone,
        monthlyTarget: form.monthlyTarget,
        carsInMonth: 0,
      });
    }
    setShowModal(false);
    setEditTarget(null);
    setForm(emptyForm);
    setErrors({});
  };

  const openEdit = (user: User) => {
    setEditTarget(user);
    setForm({
      name: user.name,
      username: user.username,
      password: '',
      phone: user.phone,
      monthlyTarget: user.monthlyTarget,
    });
    setErrors({});
    setShowModal(true);
  };

  const handleDelete = (sp: User) => {
    if (sp.id === currentUser?.id) {
      alert("You can't delete yourself!");
      return;
    }
    setDeleteTarget({ id: sp.id, label: sp.name });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-gray-400 text-sm">
          <span className="text-white font-medium">{salespeople.length}</span> salesperson{salespeople.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => { setEditTarget(null); setForm(emptyForm); setErrors({}); setShowModal(true); }}
          className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm"
        >
          <Plus size={16} />
          Add Salesperson
        </button>
      </div>

      {salespeople.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Users size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400">No salespeople yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {salespeople.map((sp) => {
            const soldCount = getCarsSoldByPerson(sp.id);
            const commission = soldCars.filter(c => getDealSalespersonId(c) === sp.id).reduce((s, c) => s + calcCommission(c), 0);
            const progress = Math.min(100, (sp.carsInMonth / sp.monthlyTarget) * 100);

            return (
              <div key={sp.id} className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-5 hover:border-gold-500/30 transition-colors">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-gold-500/20 border border-gold-500/30 rounded-full flex items-center justify-center text-gold-400 font-bold text-lg uppercase">
                      {sp.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">{sp.name}</h3>
                      <p className="text-gray-500 text-xs">@{sp.username}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(sp)} className="p-1.5 text-gray-400 hover:text-gold-400 hover:bg-obsidian-600/60 rounded-lg transition-colors">
                      <Edit size={14} />
                    </button>
                    <button onClick={() => handleDelete(sp)} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500 text-xs">Phone:</span>
                    <span className="text-gray-300 text-xs">{sp.phone}</span>
                  </div>

                  {/* Target progress */}
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-gray-400">Monthly Target</span>
                      <span className="text-white font-medium">
                        {sp.carsInMonth} / {sp.monthlyTarget} cars
                      </span>
                    </div>
                    <div className="h-2 bg-obsidian-700/60 rounded-full overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all ${progress >= 100 ? 'bg-green-500' : progress >= 50 ? 'bg-gold-500' : 'bg-yellow-500'}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="text-gray-600 text-xs mt-1 text-right">{progress.toFixed(0)}%</p>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="bg-obsidian-700/60 rounded-lg p-2.5 border border-obsidian-400/60">
                      <p className="text-gray-500 text-xs">Total Cars Sold</p>
                      <p className="text-white font-bold text-lg">{soldCount}</p>
                    </div>
                    <div className="bg-obsidian-700/60 rounded-lg p-2.5 border border-obsidian-400/60">
                      <p className="text-gray-500 text-xs">Commission Earned</p>
                      <p className="text-purple-400 font-bold">{formatRM(commission)}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditTarget(null); }} title={editTarget ? 'Edit Salesperson' : 'Add Salesperson'}>
        <div className="space-y-4">
          <FormField label="Full Name" error={errors.name}>
            <input className={inputCls(errors.name)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ahmad bin Zakaria" />
          </FormField>
          <FormField label="Username" error={errors.username}>
            <input className={inputCls(errors.username)} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. ahmad123" autoCapitalize="none" spellCheck={false} />
          </FormField>
          <FormField label={editTarget ? 'Password (leave blank to keep)' : 'Password'} error={errors.password}>
            <input type="password" className={inputCls(errors.password)} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editTarget ? 'Leave blank to keep current' : 'Set a password'} autoCapitalize="none" spellCheck={false} />
          </FormField>
          <FormField label="Phone Number" error={errors.phone}>
            <input className={inputCls(errors.phone)} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+601X-XXXXXXX" />
          </FormField>
          <FormField label="Monthly Target (cars)" error={errors.monthlyTarget}>
            <input type="number" className={inputCls(errors.monthlyTarget)} value={form.monthlyTarget} onChange={(e) => setForm({ ...form, monthlyTarget: Number(e.target.value) })} min={1} />
          </FormField>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => { setShowModal(false); setEditTarget(null); }} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleSubmit} className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm">
            {editTarget ? 'Save Changes' : 'Add Salesperson'}
          </button>
        </div>
      </Modal>
      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) deleteUser(deleteTarget.id); }}
        itemName={deleteTarget?.label ?? ''}
      />
    </div>
  );
}
