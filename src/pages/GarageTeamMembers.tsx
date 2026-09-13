import { useState } from 'react';
import {
  Plus, Edit, Trash2, Users, AlertCircle, Shield, TrendingUp,
  UserCheck, Layers, Sparkles, SprayCan, KeyRound,
} from 'lucide-react';
import { useStore } from '../store';
import type { User, BusinessAccess } from '../types';
import GarageShell from '../components/GarageShell';
import Modal from '../components/Modal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { generateId } from '../utils/format';

function inputCls(error?: string) {
  return `w-full bg-obsidian-700/60 border ${error ? 'border-red-500/50' : 'border-obsidian-400/60'} text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors`;
}

function FormField({
  label, children, error, className,
}: { label: string; children: React.ReactNode; error?: string; className?: string }) {
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

type GarageRole = 'director' | 'shareholder' | 'garage_salesman' | 'garage_installer' | 'garage_detailer' | 'garage_spray';

const GARAGE_ROLE_CONFIG: Record<GarageRole, { label: string; icon: typeof Shield; badgeBg: string; avatarBg: string }> = {
  director: { label: 'Director', icon: Shield, badgeBg: 'bg-purple-500/20 border-purple-500/30 text-purple-400', avatarBg: 'bg-purple-500/20 border-purple-500/30 text-purple-400' },
  shareholder: { label: 'Shareholder', icon: TrendingUp, badgeBg: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400', avatarBg: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400' },
  garage_salesman: { label: 'Salesman', icon: UserCheck, badgeBg: 'bg-gold-500/20 border-gold-500/30 text-gold-400', avatarBg: 'bg-gold-500/20 border-gold-500/30 text-gold-400' },
  garage_installer: { label: 'Installer (Tint)', icon: Layers, badgeBg: 'bg-blue-500/20 border-blue-500/30 text-blue-400', avatarBg: 'bg-blue-500/20 border-blue-500/30 text-blue-400' },
  garage_detailer: { label: 'Detailer (Coating)', icon: Sparkles, badgeBg: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400', avatarBg: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' },
  garage_spray: { label: 'Spray Worker', icon: SprayCan, badgeBg: 'bg-orange-500/20 border-orange-500/30 text-orange-400', avatarBg: 'bg-orange-500/20 border-orange-500/30 text-orange-400' },
};

const GARAGE_ROLES = Object.keys(GARAGE_ROLE_CONFIG) as GarageRole[];
const BUSINESS_OPTIONS: { value: BusinessAccess; label: string }[] = [
  { value: 'used_car', label: 'Used Car' },
  { value: 'garage', label: 'Garage' },
  { value: 'both', label: 'Both' },
];

const emptyForm = {
  name: '',
  username: '',
  password: '',
  phone: '',
  role: 'garage_salesman' as GarageRole,
  businessAccess: 'garage' as BusinessAccess,
};

export default function GarageTeamMembers() {
  // Same users table as Used Car — this just filters to the people who
  // actually work in Garage (businessAccess 'garage' or 'both').
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const addUser = useStore((s) => s.addUser);
  const updateUser = useStore((s) => s.updateUser);
  const deleteUser = useStore((s) => s.deleteUser);

  const isShareholder = currentUser?.role === 'shareholder';

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [pwTarget, setPwTarget] = useState<User | null>(null);
  const [pwForm, setPwForm] = useState({ password: '', confirm: '' });
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [pwSaving, setPwSaving] = useState(false);

  const garageUsers = users.filter((u) => u.businessAccess === 'garage' || u.businessAccess === 'both');

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!form.username.trim()) e.username = 'Required';
    if (!editTarget && !form.password.trim()) e.password = 'Required';
    if (!form.phone.trim()) e.phone = 'Required';
    const existing = users.find((u) => u.username === form.username.trim() && u.id !== editTarget?.id);
    if (existing) e.username = 'Username already taken';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const isDirectorLike = form.role === 'director' || form.role === 'shareholder';
    const businessAccess: BusinessAccess = isDirectorLike ? 'both' : form.businessAccess;
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
        businessAccess,
        ...(form.password ? { password: form.password } : {}),
      });
    } else {
      addUser({
        id: generateId(),
        name: form.name,
        username: form.username,
        password: form.password,
        role: form.role,
        businessAccess,
        phone: form.phone,
        monthlyTarget: 0,
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
      role: (GARAGE_ROLES.includes(user.role as GarageRole) ? user.role : 'garage_salesman') as GarageRole,
      businessAccess: user.businessAccess ?? 'garage',
    });
    setErrors({});
    setShowModal(true);
  };

  const handleDelete = (member: User) => {
    if (member.id === currentUser?.id) return;
    setDeleteTarget({ id: member.id, label: member.name });
  };

  const openChangePassword = (member: User) => {
    setPwTarget(member);
    setPwForm({ password: '', confirm: '' });
    setPwErrors({});
  };

  const handleChangePassword = async () => {
    const e: Record<string, string> = {};
    if (!pwForm.password.trim()) e.password = 'Required';
    else if (pwForm.password.length < 6) e.password = 'Minimum 6 characters';
    if (pwForm.password !== pwForm.confirm) e.confirm = 'Passwords do not match';
    setPwErrors(e);
    if (Object.keys(e).length > 0) return;
    setPwSaving(true);
    await updateUser(pwTarget!.id, { password: pwForm.password });
    setPwSaving(false);
    setPwTarget(null);
  };

  return (
    <GarageShell title="Garage — Team Members" showBack>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-white/40 text-sm">{garageUsers.length} member{garageUsers.length === 1 ? '' : 's'}</p>
          {!isShareholder && (
            <button
              onClick={() => { setEditTarget(null); setForm(emptyForm); setErrors({}); setShowModal(true); }}
              className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm"
            >
              <Plus size={16} />
              Add Member
            </button>
          )}
        </div>

        {garageUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Users size={40} className="text-white/20 mb-3" />
            <p className="text-white/40">No Garage team members yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {garageUsers.map((member) => {
              const cfg = GARAGE_ROLE_CONFIG[member.role as GarageRole] ?? GARAGE_ROLE_CONFIG.garage_salesman;
              const isSelf = member.id === currentUser?.id;
              return (
                <div key={member.id} className="bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 rounded-xl shadow-card p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 border rounded-full overflow-hidden flex items-center justify-center font-bold text-lg uppercase ${cfg.avatarBg}`}>
                        {member.avatar ? <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" /> : member.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-white font-semibold">{member.name}</h3>
                          {isSelf && <span className="text-[10px] px-1.5 py-0.5 bg-white/10 text-white/50 rounded font-medium">You</span>}
                          {member.businessAccess === 'both' && <span className="text-[10px] px-1.5 py-0.5 bg-gold-500/15 text-gold-400 rounded font-medium">Both</span>}
                        </div>
                        <p className="text-white/40 text-xs">@{member.username}</p>
                      </div>
                    </div>
                    {!isShareholder && (
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(member)} className="p-1.5 text-white/40 hover:text-gold-400 hover:bg-white/5 rounded-lg transition-colors" title="Edit member">
                          <Edit size={14} />
                        </button>
                        <button onClick={() => openChangePassword(member)} className="p-1.5 text-white/40 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors" title="Change password">
                          <KeyRound size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(member)}
                          disabled={isSelf}
                          className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Delete member"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cfg.badgeBg}`}>
                    <cfg.icon size={11} />
                    {cfg.label}
                  </span>
                  <p className="text-white/40 text-xs mt-3">{member.phone}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit modal */}
      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditTarget(null); }}
        title={editTarget ? 'Edit Team Member' : 'Add Team Member'}
      >
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

          <FormField label="Role">
            <div className="grid grid-cols-2 gap-2">
              {GARAGE_ROLES.map((role) => {
                const cfg = GARAGE_ROLE_CONFIG[role];
                const selected = form.role === role;
                const isDirectorLike = role === 'director' || role === 'shareholder';
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setForm({ ...form, role, ...(isDirectorLike ? { businessAccess: 'both' as BusinessAccess } : {}) })}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      selected ? cfg.badgeBg.replace('/20', '/25') : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                    }`}
                  >
                    <cfg.icon size={15} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </FormField>

          <FormField label="Business Access">
            <div className="grid grid-cols-3 gap-2">
              {BUSINESS_OPTIONS.map((opt) => {
                const locked = form.role === 'director' || form.role === 'shareholder';
                const selected = form.businessAccess === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={locked}
                    onClick={() => setForm({ ...form, businessAccess: opt.value })}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      selected ? 'bg-gold-500/20 border-gold-500/50 text-gold-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                    } ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {(form.role === 'director' || form.role === 'shareholder') && (
              <p className="text-gray-500 text-[11px] mt-1.5">Directors &amp; shareholders always have access to both businesses.</p>
            )}
          </FormField>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={() => { setShowModal(false); setEditTarget(null); }} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleSubmit} className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm">{editTarget ? 'Save Changes' : 'Add Member'}</button>
        </div>
      </Modal>

      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) deleteUser(deleteTarget.id); }}
        itemName={deleteTarget?.label ?? ''}
      />

      <Modal
        isOpen={!!pwTarget}
        onClose={() => setPwTarget(null)}
        title={`Change Password — ${pwTarget?.name ?? ''}`}
        maxWidth="max-w-sm"
      >
        <div className="space-y-4">
          <FormField label="New Password" error={pwErrors.password}>
            <input type="password" className={inputCls(pwErrors.password)} value={pwForm.password} onChange={(e) => setPwForm({ ...pwForm, password: e.target.value })} placeholder="Min. 6 characters" autoComplete="new-password" autoCapitalize="none" spellCheck={false} />
          </FormField>
          <FormField label="Confirm Password" error={pwErrors.confirm}>
            <input type="password" className={inputCls(pwErrors.confirm)} value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })} placeholder="Re-enter new password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} />
          </FormField>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setPwTarget(null)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleChangePassword} disabled={pwSaving} className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-60">{pwSaving ? 'Saving…' : 'Change Password'}</button>
        </div>
      </Modal>
    </GarageShell>
  );
}
