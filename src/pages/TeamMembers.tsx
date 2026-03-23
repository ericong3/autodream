import React, { useState } from 'react';
import { Plus, Edit, Trash2, Users, AlertCircle, Shield, UserCheck } from 'lucide-react';
import { useStore } from '../store';
import { User } from '../types';
import Modal from '../components/Modal';
import { formatRM, generateId } from '../utils/format';

function inputCls(error?: string) {
  return `w-full bg-[#111d35] border ${error ? 'border-red-500/50' : 'border-[#1a2a4a]'} text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 transition-colors`;
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

const COMMISSION_PER_CAR = 500;

const emptyForm = {
  name: '',
  username: '',
  password: '',
  phone: '',
  role: 'salesperson' as 'director' | 'salesperson' | 'mechanic',
  monthlyTarget: 4,
};

const ROLE_CONFIG = {
  director: {
    label: 'Director',
    icon: Shield,
    badgeBg: 'bg-purple-500/20 border-purple-500/30 text-purple-400',
    avatarBg: 'bg-purple-500/20 border-purple-500/30 text-purple-400',
    dot: 'bg-purple-400',
  },
  salesperson: {
    label: 'Salesperson',
    icon: UserCheck,
    badgeBg: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400',
    avatarBg: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400',
    dot: 'bg-cyan-400',
  },
};

export default function TeamMembers() {
  const users = useStore((s) => s.users);
  const cars = useStore((s) => s.cars);
  const currentUser = useStore((s) => s.currentUser);
  const addUser = useStore((s) => s.addUser);
  const updateUser = useStore((s) => s.updateUser);
  const deleteUser = useStore((s) => s.deleteUser);

  const soldCars = cars.filter((c) => c.status === 'sold');

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filterRole, setFilterRole] = useState<'all' | 'director' | 'salesperson'>('all');

  const getCarsSoldByPerson = (userId: string) =>
    soldCars.filter((c) => c.assignedSalesperson === userId).length;

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
    if (editTarget) {
      updateUser(editTarget.id, {
        name: form.name,
        username: form.username,
        phone: form.phone,
        role: form.role,
        monthlyTarget: form.role === 'salesperson' ? form.monthlyTarget : editTarget.monthlyTarget,
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
      role: user.role,
      monthlyTarget: user.monthlyTarget || 4,
    });
    setErrors({});
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (id === currentUser?.id) {
      alert("You can't delete yourself!");
      return;
    }
    if (window.confirm('Delete this team member?')) deleteUser(id);
  };

  const filteredUsers =
    filterRole === 'all' ? users : users.filter((u) => u.role === filterRole);

  const directorCount = users.filter((u) => u.role === 'director').length;
  const salespersonCount = users.filter((u) => u.role === 'salesperson').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Summary pills */}
          <div className="flex items-center gap-2">
            {(['all', 'director', 'salesperson'] as const).map((role) => {
              const count =
                role === 'all'
                  ? users.length
                  : role === 'director'
                  ? directorCount
                  : salespersonCount;
              const active = filterRole === role;
              return (
                <button
                  key={role}
                  onClick={() => setFilterRole(role)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    active
                      ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400'
                      : 'border-[#1a2a4a] text-gray-500 hover:text-gray-300 hover:border-gray-600'
                  }`}
                >
                  {role === 'all' ? 'All' : role === 'director' ? 'Directors' : 'Salespeople'}{' '}
                  <span
                    className={`ml-1 px-1.5 py-0.5 rounded text-xs ${
                      active ? 'bg-cyan-500/30 text-cyan-300' : 'bg-[#1a2a4a] text-gray-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={() => {
            setEditTarget(null);
            setForm(emptyForm);
            setErrors({});
            setShowModal(true);
          }}
          className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-cyan-500/20"
        >
          <Plus size={16} />
          Add Member
        </button>
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
            const commission = soldCount * COMMISSION_PER_CAR;
            const isSelf = member.id === currentUser?.id;

            return (
              <div
                key={member.id}
                className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl p-5 hover:border-cyan-500/30 transition-colors"
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-11 h-11 border rounded-full flex items-center justify-center font-bold text-lg uppercase ${cfg.avatarBg}`}
                    >
                      {member.name.charAt(0)}
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
                      <p className="text-gray-500 text-xs">@{member.username}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEdit(member)}
                      className="p-1.5 text-gray-400 hover:text-cyan-400 hover:bg-[#1a2a4a] rounded-lg transition-colors"
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(member.id)}
                      disabled={isSelf}
                      className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
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
                      <div className="h-2 bg-[#111d35] rounded-full overflow-hidden">
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
                                  ? 'bg-cyan-500'
                                  : 'bg-yellow-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          );
                        })()}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-[#111d35] rounded-lg p-2.5 border border-[#1a2a4a]">
                        <p className="text-gray-500 text-xs">Cars Sold</p>
                        <p className="text-white font-bold text-lg">{soldCount}</p>
                      </div>
                      <div className="bg-[#111d35] rounded-lg p-2.5 border border-[#1a2a4a]">
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
              {(['salesperson', 'director'] as const).map((role) => {
                const cfg = ROLE_CONFIG[role];
                const selected = form.role === role;
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setForm({ ...form, role })}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      selected
                        ? role === 'director'
                          ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                          : 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                        : 'bg-[#111d35] border-[#1a2a4a] text-gray-400 hover:text-gray-200 hover:border-gray-600'
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
            className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {editTarget ? 'Save Changes' : 'Add Member'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
