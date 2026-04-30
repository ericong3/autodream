import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Edit, Trash2, Users, AlertCircle, Shield, UserCheck, Wrench, Phone, Mail, AtSign, Car, TrendingUp, Target, Award, X } from 'lucide-react';
import { useStore } from '../store';
import { User } from '../types';
import Modal from '../components/Modal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { formatRM, generateId } from '../utils/format';

function inputCls(error?: string) {
  return `w-full bg-obsidian-700/60 border ${error ? 'border-red-500/50' : 'border-obsidian-400/60'} text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors`;
}

function FormField({
  label,
  children,
  error,
  className,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-gray-300 text-xs font-medium mb-1.5">{label}</label>
      {children}
      {error && (
        <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
          <AlertCircle size={12} />
          {error}
        </p>
      )}
    </div>
  );
}

const emptyForm = {
  name: '',
  username: '',
  password: '',
  phone: '',
  role: 'salesperson' as User['role'],
  monthlyTarget: 4,
};

const ROLE_CONFIG = {
  director: {
    label: 'Director',
    icon: Shield,
    badgeBg: 'bg-purple-500/20 border-purple-500/30 text-purple-400',
    avatarBg: 'bg-purple-500/20 border-purple-500/30 text-purple-400',
  },
  salesperson: {
    label: 'Salesperson',
    icon: UserCheck,
    badgeBg: 'bg-gold-500/20 border-gold-500/30 text-gold-400',
    avatarBg: 'bg-gold-500/20 border-gold-500/30 text-gold-400',
  },
  mechanic: {
    label: 'Mechanic',
    icon: Wrench,
    badgeBg: 'bg-orange-500/20 border-orange-500/30 text-orange-400',
    avatarBg: 'bg-orange-500/20 border-orange-500/30 text-orange-400',
  },
  shareholder: {
    label: 'Shareholder',
    icon: TrendingUp,
    badgeBg: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400',
    avatarBg: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400',
  },
};

function EmployeeDetailModal({ member, onClose, currentUserId }: { member: User; onClose: () => void; currentUserId?: string }) {
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const customers = useStore((s) => s.customers);

  const cfg = ROLE_CONFIG[member.role as keyof typeof ROLE_CONFIG];
  const isSelf = member.id === currentUserId;

  const getDealSalespersonId = (car: typeof cars[0]): string | undefined => {
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    return car.assignedSalesperson || dealCustomer?.assignedSalesId;
  };
  const soldCars = cars.filter((c) => c.status === 'delivered' && getDealSalespersonId(c) === member.id);
  const activeCars = cars.filter((c) => c.status !== 'delivered' && c.assignedSalesperson === member.id);

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

  const commission = soldCars.reduce((s, c) => s + calcCommission(c), 0);
  const activeCustomers = customers.filter((c) => c.assignedSalesId === member.id);

  const targetPct = member.role === 'salesperson' && member.monthlyTarget > 0
    ? Math.min(100, (member.carsInMonth / member.monthlyTarget) * 100)
    : 0;

  const CAR_STATUS_LABEL: Record<string, string> = {
    coming_soon: 'Coming Soon',
    in_workshop: 'In Workshop',
    ready: 'Ready',
    photo_complete: 'Photo Done',
    submitted: 'Submitted',
    deal_pending: 'Deal Pending',
    available: 'Available',
    reserved: 'Reserved',
    sold: 'Sold',
    delivered: 'Delivered',
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg flex flex-col
        bg-gradient-to-b from-obsidian-700 to-obsidian-800
        border border-obsidian-400/80
        shadow-[0_20px_80px_rgba(0,0,0,0.8),0_0_0_1px_rgba(42,35,22,0.8)]
        rounded-xl
        max-h-[90vh] overflow-hidden">

        {/* Gold accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl md:rounded-t-xl bg-gold-gradient opacity-80" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-obsidian-400/60 shrink-0 bg-gradient-to-r from-obsidian-600/50 to-transparent">
          <h2 className="font-display text-white font-semibold text-sm tracking-wide">Employee Profile</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-obsidian-500/60 transition-colors">
            <X size={17} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 pb-safe">
          {/* Profile hero */}
          <div className="px-5 py-5 border-b border-obsidian-400/40">
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 border-2 rounded-full shrink-0 overflow-hidden flex items-center justify-center font-bold text-2xl uppercase ${cfg.avatarBg}`}>
                {member.avatar
                  ? <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" />
                  : member.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-white font-bold text-lg leading-none">{member.name}</h3>
                  {isSelf && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded font-medium">You</span>
                  )}
                </div>
                {member.position && (
                  <p className="text-gold-300 text-xs mt-0.5">{member.position}</p>
                )}
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 mt-2 rounded-full border ${cfg.badgeBg}`}>
                  <cfg.icon size={11} />
                  {cfg.label}
                </span>
              </div>
            </div>

            {/* Bio */}
            {member.bio && (
              <p className="mt-3 text-gray-400 text-sm italic leading-snug">{member.bio}</p>
            )}

            {/* Contact info */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <AtSign size={13} className="text-gray-500 shrink-0" />
                <span className="text-gray-400 text-sm truncate">@{member.username}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone size={13} className="text-gray-500 shrink-0" />
                <span className="text-gray-400 text-sm truncate">{member.phone || '—'}</span>
              </div>
              {member.email && (
                <div className="flex items-center gap-2 col-span-2">
                  <Mail size={13} className="text-gray-500 shrink-0" />
                  <span className="text-gray-400 text-sm truncate">{member.email}</span>
                </div>
              )}
            </div>
          </div>

          {/* Salesperson stats */}
          {member.role === 'salesperson' && (
            <div className="px-5 py-4 border-b border-obsidian-400/40">
              <p className="text-gray-500 text-xs font-medium uppercase tracking-wider mb-3">Performance</p>

              {/* Monthly target progress */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-gray-400 flex items-center gap-1.5"><Target size={12} /> Monthly Target</span>
                  <span className="text-white font-semibold">{member.carsInMonth} / {member.monthlyTarget} cars</span>
                </div>
                <div className="h-2.5 bg-obsidian-700/60 rounded-full overflow-hidden">
                  <div
                    className={`h-2.5 rounded-full transition-all ${targetPct >= 100 ? 'bg-green-500' : targetPct >= 50 ? 'bg-gold-500' : 'bg-yellow-500'}`}
                    style={{ width: `${targetPct}%` }}
                  />
                </div>
                <p className="text-right text-xs text-gray-500 mt-1">{Math.round(targetPct)}% achieved</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="bg-obsidian-700/60 rounded-lg p-3 border border-obsidian-400/60">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Car size={12} className="text-gray-500" />
                    <p className="text-gray-500 text-[11px]">Cars Sold</p>
                  </div>
                  <p className="text-white font-bold text-xl">{soldCars.length}</p>
                </div>
                <div className="bg-obsidian-700/60 rounded-lg p-3 border border-obsidian-400/60">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp size={12} className="text-gray-500" />
                    <p className="text-gray-500 text-[11px]">Active Cars</p>
                  </div>
                  <p className="text-white font-bold text-xl">{activeCars.length}</p>
                </div>
                <div className="bg-obsidian-700/60 rounded-lg p-3 border border-obsidian-400/60">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Award size={12} className="text-gray-500" />
                    <p className="text-gray-500 text-[11px]">Commission</p>
                  </div>
                  <p className="text-purple-400 font-bold text-sm">{formatRM(commission)}</p>
                </div>
              </div>

              {/* Active customers */}
              {activeCustomers.length > 0 && (
                <div className="mt-3 bg-obsidian-700/40 rounded-lg p-3 border border-obsidian-400/40">
                  <p className="text-gray-500 text-[11px] mb-1">Active Leads</p>
                  <p className="text-white font-bold text-xl">{activeCustomers.length}</p>
                </div>
              )}
            </div>
          )}

          {/* Assigned cars */}
          {(member.role === 'salesperson' || member.role === 'mechanic') && activeCars.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-gray-500 text-xs font-medium uppercase tracking-wider mb-3">
                Assigned Cars ({activeCars.length})
              </p>
              <div className="space-y-2">
                {activeCars.map((car) => (
                  <div key={car.id} className="flex items-center justify-between bg-obsidian-700/40 rounded-lg px-3 py-2.5 border border-obsidian-400/40">
                    <div>
                      <p className="text-white text-sm font-medium">{car.year} {car.make} {car.model}</p>
                      {car.carPlate && <p className="text-gray-500 text-xs">{car.carPlate}</p>}
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-obsidian-600/60 border border-obsidian-400/60 text-gray-400">
                      {CAR_STATUS_LABEL[car.status] ?? car.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {member.role === 'director' && (
            <div className="px-5 py-5">
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Shield size={32} className="text-purple-400/50 mb-2" />
                <p className="text-gray-500 text-sm">Director — full system access</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function TeamMembers() {
  const users = useStore((s) => s.users);
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const customers = useStore((s) => s.customers);
  const currentUser = useStore((s) => s.currentUser);
  const addUser = useStore((s) => s.addUser);
  const updateUser = useStore((s) => s.updateUser);
  const deleteUser = useStore((s) => s.deleteUser);

  const soldCars = cars.filter((c) => c.status === 'delivered');

  const getDealSalespersonId = (car: typeof cars[0]): string | undefined => {
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    return car.assignedSalesperson || dealCustomer?.assignedSalesId;
  };

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

  const isShareHolder = currentUser?.role === 'shareholder';

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filterRole, setFilterRole] = useState<'all' | 'director' | 'salesperson' | 'mechanic'>('all');
  const [selectedEmployee, setSelectedEmployee] = useState<User | null>(null);

  const getCarsSoldByPerson = (userId: string) =>
    soldCars.filter((c) => getDealSalespersonId(c) === userId).length;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!form.username.trim()) e.username = 'Required';
    if (!editTarget && !form.password.trim()) e.password = 'Required';
    if (!form.phone.trim()) e.phone = 'Required';
    if (form.role === 'salesperson' && (!form.monthlyTarget || form.monthlyTarget <= 0))
      e.monthlyTarget = 'Must be > 0';
    const existing = users.find(
      (u) => u.username === form.username.trim() && u.id !== editTarget?.id
    );
    if (existing) e.username = 'Username already taken';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const target = editTarget;
    setShowModal(false);
    setEditTarget(null);
    setForm(emptyForm);
    setErrors({});
    if (target) {
      updateUser(target.id, {
        name: form.name,
        username: form.username,
        phone: form.phone,
        role: form.role,
        monthlyTarget: form.role === 'salesperson' ? form.monthlyTarget : target.monthlyTarget,
        ...(form.password ? { password: form.password } : {}),
      });
    } else {
      addUser({
        id: generateId(),
        name: form.name,
        username: form.username,
        password: form.password,
        role: form.role,
        phone: form.phone,
        monthlyTarget: form.role === 'salesperson' ? form.monthlyTarget : 0,
        carsInMonth: 0,
      });
    }
  };

  const openEdit = (user: User) => {
    setEditTarget(user);
    setForm({
      name: user.name,
      username: user.username,
      password: '',
      phone: user.phone,
      role: user.role,
      monthlyTarget: user.monthlyTarget || 4,
    });
    setErrors({});
    setShowModal(true);
  };

  const handleDelete = (member: User) => {
    if (member.id === currentUser?.id) {
      alert("You can't delete yourself!");
      return;
    }
    setDeleteTarget({ id: member.id, label: member.name });
  };

  const teamUsers = users.filter((u) => u.role !== 'investor');
  const filteredUsers =
    filterRole === 'all' ? teamUsers : teamUsers.filter((u) => u.role === filterRole);

  const directorCount = teamUsers.filter((u) => u.role === 'director').length;
  const salespersonCount = teamUsers.filter((u) => u.role === 'salesperson').length;
  const mechanicCount = teamUsers.filter((u) => u.role === 'mechanic').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Summary pills */}
          <div className="flex items-center gap-2">
            {(['all', 'director', 'salesperson', 'mechanic'] as const).map((role) => {
              const count =
                role === 'all'
                  ? users.length
                  : role === 'director'
                  ? directorCount
                  : role === 'salesperson'
                  ? salespersonCount
                  : mechanicCount;
              const active = filterRole === role;
              return (
                <button
                  key={role}
                  onClick={() => setFilterRole(role)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    active
                      ? 'bg-gold-500/20 border-gold-500/40 text-gold-400'
                      : 'border-obsidian-400/60 text-gray-500 hover:text-gray-300 hover:border-gray-600'
                  }`}
                >
                  {role === 'all' ? 'All' : role === 'director' ? 'Directors' : role === 'salesperson' ? 'Salespeople' : 'Mechanics'}{' '}
                  <span
                    className={`ml-1 px-1.5 py-0.5 rounded text-xs ${
                      active ? 'bg-gold-500/30 text-gold-300' : 'bg-[#2C2415] text-gray-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {!isShareHolder && (
          <button
            onClick={() => {
              setEditTarget(null);
              setForm(emptyForm);
              setErrors({});
              setShowModal(true);
            }}
            className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm"
          >
            <Plus size={16} />
            Add Member
          </button>
        )}
      </div>

      {/* Members grid */}
      {filteredUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Users size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400">No team members found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredUsers.map((member) => {
            const cfg = ROLE_CONFIG[member.role as keyof typeof ROLE_CONFIG];
            const soldCount = getCarsSoldByPerson(member.id);
            const commission = soldCars.filter(c => getDealSalespersonId(c) === member.id).reduce((s, c) => s + calcCommission(c), 0);
            const isSelf = member.id === currentUser?.id;

            return (
              <div
                key={member.id}
                onClick={() => setSelectedEmployee(member)}
                className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-5 hover:border-gold-500/30 transition-colors cursor-pointer"
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-11 h-11 border rounded-full overflow-hidden flex items-center justify-center font-bold text-lg uppercase ${cfg.avatarBg}`}
                    >
                      {member.avatar
                        ? <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" />
                        : member.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-white font-semibold">{member.name}</h3>
                        {isSelf && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded font-medium">
                            You
                          </span>
                        )}
                      </div>
                      <p className="text-gray-500 text-xs">{member.position || `@${member.username}`}</p>
                    </div>
                  </div>
                  {!isShareHolder && (
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => openEdit(member)}
                        className="p-1.5 text-gray-400 hover:text-gold-400 hover:bg-obsidian-600/60 rounded-lg transition-colors"
                      >
                        <Edit size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(member)}
                        disabled={isSelf}
                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Role badge */}
                <div className="mb-3">
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cfg.badgeBg}`}
                  >
                    <cfg.icon size={11} />
                    {cfg.label}
                  </span>
                </div>

                {/* Phone */}
                <p className="text-gray-500 text-xs mb-3">{member.phone}</p>

                {/* Salesperson-specific stats */}
                {member.role === 'salesperson' && (
                  <>
                    <div className="mb-3">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-gray-400">Monthly Target</span>
                        <span className="text-white font-medium">
                          {member.carsInMonth} / {member.monthlyTarget} cars
                        </span>
                      </div>
                      <div className="h-2 bg-obsidian-700/60 rounded-full overflow-hidden">
                        {(() => {
                          const pct = Math.min(
                            100,
                            (member.carsInMonth / member.monthlyTarget) * 100
                          );
                          return (
                            <div
                              className={`h-2 rounded-full transition-all ${
                                pct >= 100
                                  ? 'bg-green-500'
                                  : pct >= 50
                                  ? 'bg-gold-500'
                                  : 'bg-yellow-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          );
                        })()}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-obsidian-700/60 rounded-lg p-2.5 border border-obsidian-400/60">
                        <p className="text-gray-500 text-xs">Cars Sold</p>
                        <p className="text-white font-bold text-lg">{soldCount}</p>
                      </div>
                      <div className="bg-obsidian-700/60 rounded-lg p-2.5 border border-obsidian-400/60">
                        <p className="text-gray-500 text-xs">Commission</p>
                        <p className="text-purple-400 font-bold">{formatRM(commission)}</p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Employee Detail Modal */}
      {selectedEmployee && (
        <EmployeeDetailModal
          member={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
          currentUserId={currentUser?.id}
        />
      )}

      {/* Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setEditTarget(null);
        }}
        title={editTarget ? 'Edit Team Member' : 'Add Team Member'}
      >
        <div className="space-y-4">
          <FormField label="Full Name" error={errors.name}>
            <input
              className={inputCls(errors.name)}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Ahmad bin Zakaria"
            />
          </FormField>

          <FormField label="Username" error={errors.username}>
            <input
              className={inputCls(errors.username)}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="e.g. ahmad123"
              autoCapitalize="none"
              spellCheck={false}
            />
          </FormField>

          <FormField
            label={editTarget ? 'Password (leave blank to keep)' : 'Password'}
            error={errors.password}
          >
            <input
              type="password"
              className={inputCls(errors.password)}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={editTarget ? 'Leave blank to keep current' : 'Set a password'}
              autoCapitalize="none"
              spellCheck={false}
            />
          </FormField>

          <FormField label="Phone Number" error={errors.phone}>
            <input
              className={inputCls(errors.phone)}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+601X-XXXXXXX"
            />
          </FormField>

          {/* Role selector */}
          <FormField label="Role">
            <div className="grid grid-cols-2 gap-2">
              {(['salesperson', 'mechanic', 'director', 'shareholder'] as const).map((role) => {
                const cfg = ROLE_CONFIG[role];
                const selected = form.role === role;
                const selectedStyle = role === 'director'
                  ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                  : role === 'mechanic'
                  ? 'bg-orange-500/20 border-orange-500/50 text-orange-300'
                  : role === 'shareholder'
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                  : 'bg-gold-500/20 border-gold-500/50 text-gold-300';
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setForm({ ...form, role })}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      selected
                        ? selectedStyle
                        : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                    }`}
                  >
                    <cfg.icon size={15} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </FormField>

          {/* Monthly target — only for salesperson */}
          {form.role === 'salesperson' && (
            <FormField label="Monthly Target (cars)" error={errors.monthlyTarget}>
              <input
                type="number"
                className={inputCls(errors.monthlyTarget)}
                value={form.monthlyTarget}
                onChange={(e) => setForm({ ...form, monthlyTarget: Number(e.target.value) })}
                min={1}
              />
            </FormField>
          )}
        </div>

        <div className="flex gap-3 mt-5">
          <button
            onClick={() => {
              setShowModal(false);
              setEditTarget(null);
            }}
            className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm"
          >
            {editTarget ? 'Save Changes' : 'Add Member'}
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
