import React, { useState } from 'react';
import { Plus, X, Building2, Wrench, Package, ShoppingBag, UserCheck, Landmark, Phone, Mail, Pencil, Trash2, Eye, EyeOff, CreditCard } from 'lucide-react';
import { useStore } from '../store';
import { formatRM, generateId } from '../utils/format';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import Modal from '../components/Modal';
import { ExternalSalesman, Banker, BANKS, Dealer, Workshop, Merchant } from '../types';

type Tab = 'dealers' | 'workshops' | 'suppliers' | 'misc' | 'ext_salesmen' | 'bankers';

const TABS: { key: Tab; label: string; icon: React.ElementType; color: string }[] = [
  { key: 'dealers',      label: 'Car Dealers',   icon: Building2,  color: 'text-blue-400'   },
  { key: 'workshops',    label: 'Workshops',     icon: Wrench,     color: 'text-orange-400' },
  { key: 'suppliers',    label: 'Suppliers',     icon: Package,    color: 'text-green-400'  },
  { key: 'misc',         label: 'Misc',          icon: ShoppingBag,color: 'text-purple-400' },
  { key: 'ext_salesmen', label: 'Ext. Salesmen', icon: UserCheck,  color: 'text-teal-400'   },
  { key: 'bankers',      label: 'Bankers',        icon: Landmark,   color: 'text-sky-400'    },
];

function inputCls() {
  return 'w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors';
}

const emptyExtSalesman = { name: '', ic: '', phone: '', email: '', bank: '', bankAccount: '', notes: '' };

export default function Data() {
  const [activeTab, setActiveTab] = useState<Tab>('dealers');
  const [error, setError] = useState('');

  const dealers   = useStore((s) => s.dealers);
  const workshops = useStore((s) => s.workshops);
  const suppliers = useStore((s) => s.suppliers);
  const addDealer    = useStore((s) => s.addDealer);
  const updateDealer = useStore((s) => s.updateDealer);
  const deleteDealer = useStore((s) => s.deleteDealer);
  const addWorkshop    = useStore((s) => s.addWorkshop);
  const updateWorkshop = useStore((s) => s.updateWorkshop);
  const deleteWorkshop = useStore((s) => s.deleteWorkshop);
  const addSupplier    = useStore((s) => s.addSupplier);
  const deleteSupplier = useStore((s) => s.deleteSupplier);
  const merchants      = useStore((s) => s.merchants);
  const addMerchant    = useStore((s) => s.addMerchant);
  const updateMerchant = useStore((s) => s.updateMerchant);
  const deleteMerchant = useStore((s) => s.deleteMerchant);
  const externalSalesmen     = useStore((s) => s.externalSalesmen);
  const addExternalSalesman    = useStore((s) => s.addExternalSalesman);
  const updateExternalSalesman = useStore((s) => s.updateExternalSalesman);
  const deleteExternalSalesman = useStore((s) => s.deleteExternalSalesman);
  const cars = useStore((s) => s.cars);
  const users         = useStore((s) => s.users);
  const addUser       = useStore((s) => s.addUser);
  const updateUser    = useStore((s) => s.updateUser);
  const deleteUser    = useStore((s) => s.deleteUser);
  const bankers       = useStore((s) => s.bankers);
  const addBanker     = useStore((s) => s.addBanker);
  const updateBanker  = useStore((s) => s.updateBanker);
  const deleteBanker  = useStore((s) => s.deleteBanker);

  const bankerUsers = users.filter(u => u.role === 'banker');

  // Banker profile form state
  const emptyBankerForm = { name: '', bank: '', phone: '', email: '', notes: '', hasAccount: false, username: '', password: '' };
  const [bankerForm, setBankerForm] = useState(emptyBankerForm);
  const [bankerEditTarget, setBankerEditTarget] = useState<Banker | null>(null);
  const [bankerEditForm, setBankerEditForm] = useState({ ...emptyBankerForm, changePassword: false });
  const [showBankerPw, setShowBankerPw] = useState(false);
  const [showBankerEditPw, setShowBankerEditPw] = useState(false);
  const [bankerDeleteTarget, setBankerDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const [accountDeleteTarget, setAccountDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const emptyDealerForm = { name: '', phone: '', bankName: '', bankAccountNumber: '', bankAccountHolder: '' };
  const [dealerForm, setDealerForm] = useState(emptyDealerForm);
  const [dealerEditTarget, setDealerEditTarget] = useState<Dealer | null>(null);
  const [dealerEditForm, setDealerEditForm] = useState(emptyDealerForm);
  const [workshopForm, setWorkshopForm] = useState({ name: '', phone: '', speciality: '' });
  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', category: '' });
  const [merchantForm, setMerchantForm] = useState({ name: '', phone: '', category: '' });
  const [extForm, setExtForm] = useState(emptyExtSalesman);
  const [extProfileTarget, setExtProfileTarget] = useState<ExternalSalesman | null>(null);
  const [extEditMode, setExtEditMode] = useState(false);
  const [extEditForm, setExtEditForm] = useState(emptyExtSalesman);

  const handleAdd = async (fn: () => Promise<void>) => {
    setError('');
    try { await fn(); } catch (e: any) { setError(e.message || 'Failed to save. Please try again.'); }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      {/* Tabs */}
      <div className="flex gap-2 border-b border-obsidian-400/60 pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.key
                ? `border-gold-400 ${tab.color}`
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <tab.icon size={15} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Dealers */}
      {activeTab === 'dealers' && (
        <DealersTab
          dealers={dealers}
          form={dealerForm}
          setForm={setDealerForm}
          emptyForm={emptyDealerForm}
          editTarget={dealerEditTarget}
          editForm={dealerEditForm}
          setEditTarget={setDealerEditTarget}
          setEditForm={setDealerEditForm}
          onAdd={() => handleAdd(async () => {
            if (!dealerForm.name.trim()) return;
            await addDealer({
              id: generateId(),
              name: dealerForm.name.trim(),
              phone: dealerForm.phone || undefined,
              bankName: dealerForm.bankName || undefined,
              bankAccountNumber: dealerForm.bankAccountNumber || undefined,
              bankAccountHolder: dealerForm.bankAccountHolder || undefined,
            });
            setDealerForm(emptyDealerForm);
          })}
          onUpdate={(id) => handleAdd(async () => {
            await updateDealer(id, {
              name: dealerEditForm.name.trim(),
              phone: dealerEditForm.phone || undefined,
              bankName: dealerEditForm.bankName || undefined,
              bankAccountNumber: dealerEditForm.bankAccountNumber || undefined,
              bankAccountHolder: dealerEditForm.bankAccountHolder || undefined,
            });
            setDealerEditTarget(null);
          })}
          onDelete={(id) => deleteDealer(id)}
        />
      )}

      {/* Workshops */}
      {activeTab === 'workshops' && (
        <WorkshopsTab
          workshops={workshops}
          workshopForm={workshopForm}
          setWorkshopForm={setWorkshopForm}
          addWorkshop={addWorkshop}
          updateWorkshop={updateWorkshop}
          deleteWorkshop={deleteWorkshop}
        />
      )}

      {/* Suppliers */}
      {activeTab === 'suppliers' && (
        <Section
          title="Suppliers"
          icon={Package}
          iconColor="text-green-400"
          count={suppliers.length}
          form={
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input className={inputCls()} placeholder="Supplier name *" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} />
              <input className={inputCls()} placeholder="Phone (optional)" value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} />
              <div className="flex gap-2">
                <input className={inputCls()} placeholder="Category e.g. Tyres" value={supplierForm.category} onChange={(e) => setSupplierForm({ ...supplierForm, category: e.target.value })} />
                <button
                  onClick={() => {
                    if (!supplierForm.name.trim()) return;
                    handleAdd(async () => {
                      await addSupplier({ id: generateId(), name: supplierForm.name.trim(), phone: supplierForm.phone || undefined, category: supplierForm.category || undefined });
                      setSupplierForm({ name: '', phone: '', category: '' });
                    });
                  }}
                  className="btn-gold px-4 py-2 rounded-lg text-sm shrink-0"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>
          }
          items={suppliers.map((s) => ({
            id: s.id,
            primary: s.name,
            secondary: [s.phone, s.category].filter(Boolean).join(' · '),
          }))}
          onDelete={(id) => deleteSupplier(id)}
          emptyText="No suppliers added yet"
        />
      )}

      {/* Misc (Merchants) */}
      {activeTab === 'misc' && (
        <MerchantsTab
          merchants={merchants}
          merchantForm={merchantForm}
          setMerchantForm={setMerchantForm}
          addMerchant={addMerchant}
          updateMerchant={updateMerchant}
          deleteMerchant={deleteMerchant}
        />
      )}

      {/* External Salesmen */}
      {activeTab === 'ext_salesmen' && (
        <ExternalSalesmenTab
          salesmen={externalSalesmen}
          cars={cars}
          form={extForm}
          setForm={setExtForm}
          onAdd={() => handleAdd(async () => {
            if (!extForm.name.trim()) return;
            await addExternalSalesman({
              id: generateId(),
              name: extForm.name.trim(),
              ic: extForm.ic || undefined,
              phone: extForm.phone || undefined,
              email: extForm.email || undefined,
              bank: extForm.bank || undefined,
              bankAccount: extForm.bankAccount || undefined,
              notes: extForm.notes || undefined,
              createdAt: new Date().toISOString(),
            });
            setExtForm(emptyExtSalesman);
          })}
          onViewProfile={(s) => { setExtProfileTarget(s); setExtEditMode(false); setExtEditForm({ name: s.name, ic: s.ic ?? '', phone: s.phone ?? '', email: s.email ?? '', bank: s.bank ?? '', bankAccount: s.bankAccount ?? '', notes: s.notes ?? '' }); }}
          onDelete={(id) => deleteExternalSalesman(id)}
        />
      )}

      {/* Bankers */}
      {activeTab === 'bankers' && (
        <div className="space-y-4">
          {/* ── Add Banker Profile ── */}
          <div className="card-surface rounded-xl p-4 space-y-3">
            <p className="text-white font-semibold text-sm flex items-center gap-2">
              <Landmark size={15} className="text-sky-400" />
              Add Banker Profile
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-400 text-xs mb-1">Full Name *</label>
                <input className={inputCls()} placeholder="e.g. Ahmad bin Ali" value={bankerForm.name} onChange={e => setBankerForm({ ...bankerForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Bank *</label>
                <select className={inputCls()} value={bankerForm.bank} onChange={e => setBankerForm({ ...bankerForm, bank: e.target.value })}>
                  <option value="">Select bank…</option>
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Phone</label>
                <input className={inputCls()} placeholder="e.g. 012-3456789" value={bankerForm.phone} onChange={e => setBankerForm({ ...bankerForm, phone: e.target.value })} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Email</label>
                <input className={inputCls()} type="email" placeholder="e.g. ahmad@bank.com" value={bankerForm.email} onChange={e => setBankerForm({ ...bankerForm, email: e.target.value })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              </div>
              <div className="col-span-2">
                <label className="block text-gray-400 text-xs mb-1">Notes</label>
                <input className={inputCls()} placeholder="e.g. Fast approval, HP loans" value={bankerForm.notes} onChange={e => setBankerForm({ ...bankerForm, notes: e.target.value })} />
              </div>
            </div>

            {/* Has App Account toggle */}
            <div className="border-t border-obsidian-400/30 pt-3 space-y-3">
              <button
                type="button"
                onClick={() => setBankerForm({ ...bankerForm, hasAccount: !bankerForm.hasAccount, username: '', password: '' })}
                className="flex items-center gap-3"
              >
                <div className={`w-9 h-5 rounded-full relative transition-colors ${bankerForm.hasAccount ? 'bg-sky-500' : 'bg-obsidian-500'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${bankerForm.hasAccount ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-sm text-gray-300">Has App Account</span>
              </button>

              {bankerForm.hasAccount && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-400 text-xs mb-1">Username *</label>
                    <input className={inputCls()} placeholder="e.g. ahmad.affin" value={bankerForm.username} onChange={e => setBankerForm({ ...bankerForm, username: e.target.value })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-xs mb-1">Password *</label>
                    <div className="relative">
                      <input className={inputCls()} type={showBankerPw ? 'text' : 'password'} placeholder="Set password" value={bankerForm.password} onChange={e => setBankerForm({ ...bankerForm, password: e.target.value })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                      <button type="button" onClick={() => setShowBankerPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                        {showBankerPw ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              disabled={!bankerForm.name.trim() || !bankerForm.bank || (bankerForm.hasAccount && (!bankerForm.username.trim() || !bankerForm.password.trim()))}
              onClick={() => handleAdd(async () => {
                const bankerId = generateId();
                let userId: string | undefined;
                if (bankerForm.hasAccount) {
                  userId = generateId();
                  await addUser({
                    id: userId,
                    name: bankerForm.name.trim(),
                    username: bankerForm.username.trim(),
                    password: bankerForm.password,
                    role: 'banker',
                    phone: bankerForm.phone || '',
                    banks: [bankerForm.bank],
                    email: bankerForm.email || undefined,
                    monthlyTarget: 0,
                    carsInMonth: 0,
                  });
                }
                await addBanker({
                  id: bankerId,
                  name: bankerForm.name.trim(),
                  bank: bankerForm.bank,
                  phone: bankerForm.phone || undefined,
                  email: bankerForm.email || undefined,
                  notes: bankerForm.notes || undefined,
                  userId,
                  createdAt: new Date().toISOString(),
                });
                setBankerForm(emptyBankerForm);
              })}
              className="btn-gold px-4 py-2 rounded-lg text-sm disabled:opacity-40"
            >
              Add Banker
            </button>
          </div>

          {/* ── Profiles list grouped by bank ── */}
          {BANKS.filter(bank => bankers.some(b => b.bank === bank)).map(bank => (
            <div key={bank} className="card-surface rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-obsidian-400/40 flex items-center gap-2">
                <Landmark size={13} className="text-sky-400" />
                <span className="text-white font-semibold text-sm">{bank}</span>
                <span className="text-gray-600 text-xs ml-1">
                  {bankers.filter(b => b.bank === bank).length} banker{bankers.filter(b => b.bank === bank).length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="divide-y divide-obsidian-400/30">
                {bankers.filter(b => b.bank === bank).map(banker => {
                  const linkedUser = banker.userId ? users.find(u => u.id === banker.userId) : null;
                  return (
                    <div key={banker.id} className="px-4 py-3">
                      {bankerEditTarget?.id === banker.id ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-400 text-xs mb-1">Name *</label>
                              <input className={inputCls()} value={bankerEditForm.name} onChange={e => setBankerEditForm({ ...bankerEditForm, name: e.target.value })} />
                            </div>
                            <div>
                              <label className="block text-gray-400 text-xs mb-1">Bank *</label>
                              <select className={inputCls()} value={bankerEditForm.bank} onChange={e => setBankerEditForm({ ...bankerEditForm, bank: e.target.value })}>
                                {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-gray-400 text-xs mb-1">Phone</label>
                              <input className={inputCls()} value={bankerEditForm.phone} onChange={e => setBankerEditForm({ ...bankerEditForm, phone: e.target.value })} />
                            </div>
                            <div>
                              <label className="block text-gray-400 text-xs mb-1">Email</label>
                              <input className={inputCls()} type="email" value={bankerEditForm.email} onChange={e => setBankerEditForm({ ...bankerEditForm, email: e.target.value })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-gray-400 text-xs mb-1">Notes</label>
                              <input className={inputCls()} value={bankerEditForm.notes} onChange={e => setBankerEditForm({ ...bankerEditForm, notes: e.target.value })} />
                            </div>
                          </div>

                          {/* Account section in edit mode */}
                          <div className="border-t border-obsidian-400/30 pt-3 space-y-2">
                            {linkedUser ? (
                              <>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">App Account</span>
                                  <span className="text-gray-400 text-xs">@{linkedUser.username}</span>
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                  <input type="checkbox" checked={bankerEditForm.changePassword} onChange={e => setBankerEditForm({ ...bankerEditForm, changePassword: e.target.checked, password: '' })} className="accent-sky-400" />
                                  <span className="text-xs text-gray-400">Change password</span>
                                </label>
                                {bankerEditForm.changePassword && (
                                  <div className="relative">
                                    <input className={inputCls()} type={showBankerEditPw ? 'text' : 'password'} placeholder="New password" value={bankerEditForm.password} onChange={e => setBankerEditForm({ ...bankerEditForm, password: e.target.value })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                                    <button type="button" onClick={() => setShowBankerEditPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                                      {showBankerEditPw ? <EyeOff size={13} /> : <Eye size={13} />}
                                    </button>
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setBankerEditForm({ ...bankerEditForm, hasAccount: !bankerEditForm.hasAccount, username: '', password: '' })}
                                  className="flex items-center gap-3"
                                >
                                  <div className={`w-9 h-5 rounded-full relative transition-colors ${bankerEditForm.hasAccount ? 'bg-sky-500' : 'bg-obsidian-500'}`}>
                                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${bankerEditForm.hasAccount ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                  </div>
                                  <span className="text-sm text-gray-300">Give App Access</span>
                                </button>
                                {bankerEditForm.hasAccount && (
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-gray-400 text-xs mb-1">Username *</label>
                                      <input className={inputCls()} value={bankerEditForm.username} onChange={e => setBankerEditForm({ ...bankerEditForm, username: e.target.value })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                                    </div>
                                    <div>
                                      <label className="block text-gray-400 text-xs mb-1">Password *</label>
                                      <div className="relative">
                                        <input className={inputCls()} type={showBankerEditPw ? 'text' : 'password'} placeholder="Set password" value={bankerEditForm.password} onChange={e => setBankerEditForm({ ...bankerEditForm, password: e.target.value })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                                        <button type="button" onClick={() => setShowBankerEditPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                                          {showBankerEditPw ? <EyeOff size={13} /> : <Eye size={13} />}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          <div className="flex gap-2">
                            <button onClick={() => setBankerEditTarget(null)} className="flex-1 btn-ghost py-1.5 rounded-lg text-xs">Cancel</button>
                            <button
                              onClick={async () => {
                                await updateBanker(banker.id, {
                                  name: bankerEditForm.name.trim(),
                                  bank: bankerEditForm.bank,
                                  phone: bankerEditForm.phone || undefined,
                                  email: bankerEditForm.email || undefined,
                                  notes: bankerEditForm.notes || undefined,
                                });
                                if (linkedUser) {
                                  await updateUser(linkedUser.id, {
                                    name: bankerEditForm.name.trim(),
                                    banks: [bankerEditForm.bank],
                                    ...(bankerEditForm.changePassword && bankerEditForm.password ? { password: bankerEditForm.password } : {}),
                                  });
                                } else if (bankerEditForm.hasAccount && bankerEditForm.username.trim() && bankerEditForm.password.trim()) {
                                  const newUserId = generateId();
                                  await addUser({
                                    id: newUserId,
                                    name: bankerEditForm.name.trim(),
                                    username: bankerEditForm.username.trim(),
                                    password: bankerEditForm.password,
                                    role: 'banker',
                                    phone: bankerEditForm.phone || '',
                                    banks: [bankerEditForm.bank],
                                    email: bankerEditForm.email || undefined,
                                    monthlyTarget: 0,
                                    carsInMonth: 0,
                                  });
                                  await updateBanker(banker.id, { userId: newUserId });
                                }
                                setBankerEditTarget(null);
                              }}
                              className="flex-1 btn-gold py-1.5 rounded-lg text-xs"
                            >Save</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-white font-medium text-sm">{banker.name}</p>
                              {linkedUser && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/20">App ✓</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                              {linkedUser && <span className="text-gray-500 text-xs">@{linkedUser.username}</span>}
                              {banker.phone && <span className="text-gray-500 text-xs flex items-center gap-1"><Phone size={10} />{banker.phone}</span>}
                              {banker.email && <span className="text-gray-500 text-xs flex items-center gap-1"><Mail size={10} />{banker.email}</span>}
                              {banker.notes && <span className="text-gray-600 text-xs italic">{banker.notes}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => {
                                setBankerEditTarget(banker);
                                setBankerEditForm({ name: banker.name, bank: banker.bank, phone: banker.phone ?? '', email: banker.email ?? '', notes: banker.notes ?? '', hasAccount: false, username: '', password: '', changePassword: false });
                                setShowBankerEditPw(false);
                              }}
                              className="p-1.5 text-gray-600 hover:text-sky-400 hover:bg-sky-500/10 rounded-lg transition-colors"
                            ><Pencil size={13} /></button>
                            <button
                              onClick={() => setBankerDeleteTarget({ id: banker.id, name: banker.name })}
                              className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            ><Trash2 size={13} /></button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {bankers.length === 0 && (
            <div className="text-center py-16 text-gray-600">
              <Landmark size={36} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No banker profiles yet. Add your first banker above.</p>
            </div>
          )}

          {/* Legacy accounts not linked to any profile */}
          {(() => {
            const legacyUsers = bankerUsers.filter(u => !bankers.some(b => b.userId === u.id));
            if (legacyUsers.length === 0) return null;
            return (
              <div className="card-surface rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-obsidian-400/40 flex items-center justify-between gap-3">
                  <span className="text-gray-400 font-semibold text-xs uppercase tracking-wide">Legacy App Accounts</span>
                  <button
                    onClick={() => handleAdd(async () => {
                      for (const u of legacyUsers) {
                        const banks = u.banks ?? [];
                        for (const bank of banks) {
                          await addBanker({
                            id: generateId(),
                            name: u.name,
                            bank,
                            phone: u.phone || undefined,
                            email: u.email || undefined,
                            notes: u.bio || undefined,
                            userId: u.id,
                            createdAt: new Date().toISOString(),
                          });
                        }
                      }
                    })}
                    className="text-xs px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 transition-colors font-medium"
                  >
                    Migrate All to Profiles
                  </button>
                </div>
                {legacyUsers.map(u => (
                  <div key={u.id} className="px-4 py-3 flex items-center justify-between gap-3 opacity-60">
                    <div>
                      <p className="text-gray-300 text-sm">{u.name}</p>
                      <p className="text-gray-500 text-xs">@{u.username} · {(u.banks ?? []).join(', ')}</p>
                    </div>
                    <button onClick={() => setAccountDeleteTarget({ id: u.id, name: u.name })} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      <DeleteConfirmModal
        isOpen={!!bankerDeleteTarget}
        onClose={() => setBankerDeleteTarget(null)}
        onConfirm={async () => { if (bankerDeleteTarget) await deleteBanker(bankerDeleteTarget.id); }}
        itemName={bankerDeleteTarget?.name ?? ''}
      />
      <DeleteConfirmModal
        isOpen={!!accountDeleteTarget}
        onClose={() => setAccountDeleteTarget(null)}
        onConfirm={async () => { if (accountDeleteTarget) await deleteUser(accountDeleteTarget.id); }}
        itemName={accountDeleteTarget?.name ?? ''}
      />

      {/* External Salesman Profile Modal */}
      <Modal
        isOpen={!!extProfileTarget}
        onClose={() => { setExtProfileTarget(null); setExtEditMode(false); }}
        title={extProfileTarget?.name ?? 'Profile'}
        maxWidth="max-w-2xl"
      >
        {extProfileTarget && (() => {
          const sourcedCars = cars.filter(c => c.externalSalesmanId === extProfileTarget.id);
          const totalComm = sourcedCars.reduce((s, c) => s + (c.sourceCommission ?? 0), 0);
          return (
            <div className="space-y-5">
              {extEditMode ? (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Full Name *', key: 'name', type: 'text' },
                    { label: 'IC Number', key: 'ic', type: 'text' },
                    { label: 'Phone', key: 'phone', type: 'tel' },
                    { label: 'Email', key: 'email', type: 'email' },
                    { label: 'Bank', key: 'bank', type: 'text' },
                    { label: 'Bank Account No.', key: 'bankAccount', type: 'text' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-gray-400 text-xs mb-1">{f.label}</label>
                      <input
                        type={f.type}
                        className={inputCls()}
                        value={(extEditForm as any)[f.key]}
                        onChange={e => setExtEditForm({ ...extEditForm, [f.key]: e.target.value })}
                      />
                    </div>
                  ))}
                  <div className="col-span-2">
                    <label className="block text-gray-400 text-xs mb-1">Notes</label>
                    <textarea className={`${inputCls()} h-16 resize-none`} value={extEditForm.notes} onChange={e => setExtEditForm({ ...extEditForm, notes: e.target.value })} />
                  </div>
                  <div className="col-span-2 flex gap-3">
                    <button onClick={() => setExtEditMode(false)} className="flex-1 px-4 py-2 btn-ghost rounded-lg text-sm">Cancel</button>
                    <button
                      onClick={async () => {
                        if (!extEditForm.name.trim()) return;
                        await updateExternalSalesman(extProfileTarget.id, { name: extEditForm.name.trim(), ic: extEditForm.ic || undefined, phone: extEditForm.phone || undefined, email: extEditForm.email || undefined, bank: extEditForm.bank || undefined, bankAccount: extEditForm.bankAccount || undefined, notes: extEditForm.notes || undefined });
                        setExtProfileTarget({ ...extProfileTarget, ...extEditForm });
                        setExtEditMode(false);
                      }}
                      className="flex-1 btn-gold px-4 py-2 rounded-lg text-sm"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Info cards */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'IC Number', value: extProfileTarget.ic },
                      { label: 'Phone', value: extProfileTarget.phone },
                      { label: 'Email', value: extProfileTarget.email },
                      { label: 'Bank', value: extProfileTarget.bank },
                      { label: 'Bank Account', value: extProfileTarget.bankAccount },
                    ].filter(f => f.value).map(f => (
                      <div key={f.label} className="bg-obsidian-700/40 border border-obsidian-400/40 rounded-lg px-3 py-2">
                        <p className="text-gray-500 text-xs">{f.label}</p>
                        <p className="text-white text-sm font-medium mt-0.5">{f.value}</p>
                      </div>
                    ))}
                  </div>
                  {extProfileTarget.notes && (
                    <div className="bg-obsidian-700/40 border border-obsidian-400/40 rounded-lg px-3 py-2">
                      <p className="text-gray-500 text-xs">Notes</p>
                      <p className="text-gray-300 text-sm mt-0.5">{extProfileTarget.notes}</p>
                    </div>
                  )}
                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl p-4">
                      <p className="text-2xl font-bold text-gold-400">{sourcedCars.length}</p>
                      <p className="text-gray-400 text-xs mt-1">Cars Sourced</p>
                    </div>
                    <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl p-4">
                      <p className="text-2xl font-bold text-teal-400">{formatRM(totalComm)}</p>
                      <p className="text-gray-400 text-xs mt-1">Total Commission Earned</p>
                    </div>
                  </div>
                  {/* Edit button */}
                  <button
                    onClick={() => setExtEditMode(true)}
                    className="w-full px-4 py-2 text-sm btn-ghost rounded-lg border border-obsidian-400/60"
                  >
                    Edit Profile
                  </button>
                </>
              )}

              {/* Cars they sourced */}
              {sourcedCars.length > 0 && !extEditMode && (
                <div>
                  <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Cars Sourced</p>
                  <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 text-xs border-b border-obsidian-400/60 bg-[#161410]">
                          <th className="text-left px-4 py-2.5 font-medium">Vehicle</th>
                          <th className="text-left px-4 py-2.5 font-medium">Date</th>
                          <th className="text-right px-4 py-2.5 font-medium">Commission</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sourcedCars.map((c, i) => (
                          <tr key={c.id} className={`border-b border-obsidian-400/30 ${i % 2 !== 0 ? 'bg-obsidian-950/30' : ''}`}>
                            <td className="px-4 py-2.5">
                              <p className="text-white font-medium">{c.year} {c.make} {c.model}</p>
                              <p className="text-gray-500 text-xs capitalize">{c.status}</p>
                            </td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">{new Date(c.dateAdded).toLocaleDateString('en-MY')}</td>
                            <td className="px-4 py-2.5 text-right text-teal-400 font-semibold">{formatRM(c.sourceCommission ?? 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-obsidian-400/60 bg-[#161410]">
                          <td colSpan={2} className="px-4 py-2.5 text-gray-400 text-xs">Total</td>
                          <td className="px-4 py-2.5 text-right text-teal-400 font-bold">{formatRM(totalComm)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

function ExternalSalesmenTab({
  salesmen, cars, form, setForm, onAdd, onViewProfile, onDelete,
}: {
  salesmen: ExternalSalesman[];
  cars: any[];
  form: typeof emptyExtSalesman;
  setForm: (f: typeof emptyExtSalesman) => void;
  onAdd: () => void;
  onViewProfile: (s: ExternalSalesman) => void;
  onDelete: (id: string) => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-gold-gradient" />
          <UserCheck size={15} className="text-teal-400" />
          <h3 className="text-white font-semibold text-sm">Register External Salesman</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <input className={inputCls()} placeholder="Full Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className={inputCls()} placeholder="IC Number" value={form.ic} onChange={e => setForm({ ...form, ic: e.target.value })} autoCapitalize="none" spellCheck={false} />
          <input className={inputCls()} placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          <input className={inputCls()} placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <input className={inputCls()} placeholder="Bank" value={form.bank} onChange={e => setForm({ ...form, bank: e.target.value })} />
          <div className="flex gap-2">
            <input className={inputCls()} placeholder="Bank Account No." value={form.bankAccount} onChange={e => setForm({ ...form, bankAccount: e.target.value })} />
            <button onClick={onAdd} className="btn-gold px-4 py-2 rounded-lg text-sm shrink-0"><Plus size={15} /></button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-obsidian-400/60">
          <UserCheck size={14} className="text-teal-400" />
          <span className="text-white font-medium text-sm">External Salesmen</span>
          <span className="ml-auto text-xs text-gray-500">{salesmen.length} registered</span>
        </div>
        {salesmen.length === 0 ? (
          <div className="text-center py-10 text-gray-600 text-sm">No external salesmen registered yet</div>
        ) : (
          <div className="divide-y divide-obsidian-400/40">
            {salesmen.map((s) => {
              const carCount = cars.filter(c => c.externalSalesmanId === s.id).length;
              const totalComm = cars.filter(c => c.externalSalesmanId === s.id).reduce((sum, c) => sum + (c.sourceCommission ?? 0), 0);
              return (
                <div key={s.id} className="flex items-center justify-between px-5 py-3 hover:bg-obsidian-700/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{s.name}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {s.ic && <p className="text-gray-500 text-xs">IC: {s.ic}</p>}
                      {s.phone && <p className="text-gray-500 text-xs">{s.phone}</p>}
                      <p className="text-teal-400 text-xs">{carCount} car{carCount !== 1 ? 's' : ''} · {formatRM(totalComm)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onViewProfile(s)}
                      className="px-3 py-1.5 text-xs text-teal-400 border border-teal-500/30 rounded-lg hover:bg-teal-500/10 transition-colors"
                    >
                      Profile
                    </button>
                    <button
                      onClick={() => setDeleteTarget({ id: s.id, label: s.name })}
                      className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) onDelete(deleteTarget.id); }}
        itemName={deleteTarget?.label ?? ''}
      />
    </div>
  );
}

const WORKSHOP_CATEGORIES = [
  'Spray Paint',
  'Panel Beating',
  'General Workshop',
  'Air Cond',
  'ECU / Electrical',
  'Accessories',
  'Tyre & Rim',
  'Windscreen',
  'Upholstery',
];

const PAYMENT_TERMS_LABELS: Record<string, string> = { per_job: 'Per Job', weekly: 'Weekly', monthly: 'Monthly' };

function BankFields({ value, onChange }: { value: { bankName: string; bankAccountNumber: string; bankAccountHolder: string; paymentTerms?: string }; onChange: (v: any) => void }) {
  return (
    <>
      <div className="col-span-full">
        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 mt-1">
          <CreditCard size={11} className="text-gold-400" /> Payment Details
        </p>
      </div>
      <div>
        <label className="block text-gray-400 text-xs mb-1">Bank Name</label>
        <input className={inputCls()} placeholder="e.g. Maybank" value={value.bankName} onChange={e => onChange({ ...value, bankName: e.target.value })} />
      </div>
      <div>
        <label className="block text-gray-400 text-xs mb-1">Account Number</label>
        <input className={inputCls()} placeholder="e.g. 1234567890" value={value.bankAccountNumber} onChange={e => onChange({ ...value, bankAccountNumber: e.target.value })} />
      </div>
      <div>
        <label className="block text-gray-400 text-xs mb-1">Account Holder Name</label>
        <input className={inputCls()} placeholder="Full name as per bank" value={value.bankAccountHolder} onChange={e => onChange({ ...value, bankAccountHolder: e.target.value })} />
      </div>
      {'paymentTerms' in value && (
        <div>
          <label className="block text-gray-400 text-xs mb-1">Payment Terms</label>
          <select className={inputCls()} value={value.paymentTerms ?? ''} onChange={e => onChange({ ...value, paymentTerms: e.target.value || undefined })}>
            <option value="">— Select terms —</option>
            <option value="per_job">Per Job</option>
            <option value="weekly">Weekly (grouped every Mon)</option>
            <option value="monthly">Monthly (grouped 1st of month)</option>
          </select>
        </div>
      )}
    </>
  );
}

function WorkshopsTab({
  workshops, workshopForm, setWorkshopForm, addWorkshop, updateWorkshop, deleteWorkshop,
}: {
  workshops: Workshop[];
  workshopForm: { name: string; phone: string; speciality: string };
  setWorkshopForm: (f: any) => void;
  addWorkshop: (w: any) => void;
  updateWorkshop: (id: string, updates: Partial<Workshop>) => void;
  deleteWorkshop: (id: string) => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customCat, setCustomCat] = useState('');
  type CardState = { name: string; phone: string; bankName: string; bankAccountNumber: string; bankAccountHolder: string; paymentTerms: string };
  const [cardEdits, setCardEdits] = useState<Record<string, CardState>>({});
  const [popupWorkshop, setPopupWorkshop] = useState<Workshop | null>(null);

  const getCard = (w: Workshop): CardState =>
    cardEdits[w.id] ?? { name: w.name, phone: w.phone ?? '', bankName: w.bankName ?? '', bankAccountNumber: w.bankAccountNumber ?? '', bankAccountHolder: w.bankAccountHolder ?? '', paymentTerms: w.paymentTerms ?? '' };

  const isDirty = (w: Workshop) => {
    const e = cardEdits[w.id];
    if (!e) return false;
    return e.name !== w.name || e.phone !== (w.phone ?? '') || e.bankName !== (w.bankName ?? '') || e.bankAccountNumber !== (w.bankAccountNumber ?? '') || e.bankAccountHolder !== (w.bankAccountHolder ?? '') || e.paymentTerms !== (w.paymentTerms ?? '');
  };

  const patchCard = (id: string, field: keyof CardState, value: string, w: Workshop) =>
    setCardEdits(prev => ({ ...prev, [id]: { ...getCard(w), ...prev[id], [field]: value } }));

  const handleSave = async (w: Workshop) => {
    const s = getCard(w);
    await updateWorkshop(w.id, { name: s.name.trim(), phone: s.phone || undefined, bankName: s.bankName || undefined, bankAccountNumber: s.bankAccountNumber || undefined, bankAccountHolder: s.bankAccountHolder || undefined, paymentTerms: (s.paymentTerms as any) || undefined });
    setCardEdits(prev => { const next = { ...prev }; delete next[w.id]; return next; });
  };

  const openPopup = (w: Workshop) => {
    setPopupWorkshop(w);
    if (!cardEdits[w.id]) {
      setCardEdits(prev => ({ ...prev, [w.id]: { name: w.name, phone: w.phone ?? '', bankName: w.bankName ?? '', bankAccountNumber: w.bankAccountNumber ?? '', bankAccountHolder: w.bankAccountHolder ?? '', paymentTerms: w.paymentTerms ?? '' } }));
    }
  };

  const closePopup = () => setPopupWorkshop(null);

  const allCategories = [
    ...WORKSHOP_CATEGORIES,
    ...workshops
      .map((w) => w.speciality)
      .filter((s): s is string => !!s && !WORKSHOP_CATEGORIES.includes(s))
      .filter((s, i, arr) => arr.indexOf(s) === i),
  ];

  const handleAdd = () => {
    const speciality = customMode ? customCat.trim() : workshopForm.speciality;
    if (!workshopForm.name.trim() || !speciality) return;
    addWorkshop({ id: generateId(), name: workshopForm.name.trim(), phone: workshopForm.phone || undefined, speciality });
    setWorkshopForm({ name: '', phone: '', speciality: '' });
    setCustomMode(false);
    setCustomCat('');
  };

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-gold-gradient" />
          <Wrench size={15} className="text-orange-400" />
          <h3 className="text-white font-semibold text-sm">Add Workshop</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input className={inputCls()} placeholder="Workshop name *" value={workshopForm.name} onChange={(e) => setWorkshopForm({ ...workshopForm, name: e.target.value })} />
          <input className={inputCls()} placeholder="Phone (optional)" value={workshopForm.phone} onChange={(e) => setWorkshopForm({ ...workshopForm, phone: e.target.value })} />
          <div className="flex gap-2">
            {customMode ? (
              <div className="flex gap-2 flex-1">
                <input className={inputCls()} placeholder="New category name *" value={customCat} autoFocus onChange={(e) => setCustomCat(e.target.value)} />
                <button onClick={() => { setCustomMode(false); setCustomCat(''); setWorkshopForm({ ...workshopForm, speciality: '' }); }} className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white bg-obsidian-700/60 border border-obsidian-400/60 shrink-0"><X size={14} /></button>
              </div>
            ) : (
              <select className={inputCls()} value={workshopForm.speciality} onChange={(e) => { if (e.target.value === '__custom__') { setCustomMode(true); setWorkshopForm({ ...workshopForm, speciality: '' }); } else { setWorkshopForm({ ...workshopForm, speciality: e.target.value }); } }}>
                <option value="">— Select category —</option>
                {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="__custom__">＋ Add category…</option>
              </select>
            )}
            <button onClick={handleAdd} className="btn-gold px-4 py-2 rounded-lg text-sm shrink-0"><Plus size={15} /></button>
          </div>
        </div>
      </div>

      {/* Grouped by category */}
      {workshops.length === 0 ? (
        <div className="text-center py-10 text-gray-600 text-sm">No workshops added yet</div>
      ) : (
        <>
          {allCategories.map((cat) => {
            const items = workshops.filter((w) => w.speciality === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-obsidian-400/40 bg-obsidian-800/40">
                  <Wrench size={12} className="text-orange-400" />
                  <span className="text-xs font-semibold text-gray-300">{cat}</span>
                  <span className="ml-auto text-[10px] text-gray-600">{items.length}</span>
                </div>
                <div className="divide-y divide-obsidian-400/30">
                  {items.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => openPopup(w)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-obsidian-700/30 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white font-semibold text-sm">{w.name}</span>
                          {w.paymentTerms && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-obsidian-600/60 text-gray-400 border border-obsidian-400/30">{PAYMENT_TERMS_LABELS[w.paymentTerms]}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {w.phone && <span className="text-gray-500 text-xs">{w.phone}</span>}
                          {w.bankName
                            ? <span className="text-gray-500 text-xs flex items-center gap-1"><CreditCard size={10} className="text-gold-400" />{w.bankName} · {w.bankAccountNumber}</span>
                            : <span className="text-gray-600 text-xs italic">No bank details</span>
                          }
                        </div>
                      </div>
                      <Pencil size={13} className="text-gray-600 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Workshop detail popup */}
      {popupWorkshop && (() => {
        const w = popupWorkshop;
        const s = getCard(w);
        const dirty = isDirty(w);
        return (
          <Modal isOpen onClose={closePopup} title={w.name}>
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                {w.speciality && <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/20">{w.speciality}</span>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Name</label>
                  <input className={inputCls()} value={s.name} onChange={e => patchCard(w.id, 'name', e.target.value, w)} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Phone</label>
                  <input className={inputCls()} placeholder="e.g. 012-3456789" value={s.phone} onChange={e => patchCard(w.id, 'phone', e.target.value, w)} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Bank Name</label>
                  <input className={inputCls()} placeholder="e.g. Maybank" value={s.bankName} onChange={e => patchCard(w.id, 'bankName', e.target.value, w)} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Account Number</label>
                  <input className={inputCls()} placeholder="e.g. 1234567890" value={s.bankAccountNumber} onChange={e => patchCard(w.id, 'bankAccountNumber', e.target.value, w)} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Account Holder</label>
                  <input className={inputCls()} placeholder="Full name as per bank" value={s.bankAccountHolder} onChange={e => patchCard(w.id, 'bankAccountHolder', e.target.value, w)} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Payment Terms</label>
                  <select className={inputCls()} value={s.paymentTerms} onChange={e => patchCard(w.id, 'paymentTerms', e.target.value, w)}>
                    <option value="">— Select —</option>
                    <option value="per_job">Per Job</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { closePopup(); setDeleteTarget({ id: w.id, label: w.name }); }}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={12} /> Delete
                </button>
                <button
                  onClick={async () => { await handleSave(w); closePopup(); }}
                  disabled={!dirty}
                  className="flex-1 btn-gold py-2 rounded-lg text-xs font-semibold disabled:opacity-40"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      <DeleteConfirmModal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={async () => { if (deleteTarget) deleteWorkshop(deleteTarget.id); }} itemName={deleteTarget?.label ?? ''} />
    </div>
  );
}

function MerchantsTab({
  merchants, merchantForm, setMerchantForm, addMerchant, updateMerchant, deleteMerchant,
}: {
  merchants: Merchant[];
  merchantForm: { name: string; phone: string; category: string };
  setMerchantForm: (f: any) => void;
  addMerchant: (m: any) => void;
  updateMerchant: (id: string, updates: Partial<Merchant>) => void;
  deleteMerchant: (id: string) => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customCat, setCustomCat] = useState('');
  type CardState = { bankName: string; bankAccountNumber: string; bankAccountHolder: string; paymentTerms: string };
  const [cardEdits, setCardEdits] = useState<Record<string, CardState>>({});

  const getCard = (m: Merchant): CardState =>
    cardEdits[m.id] ?? { bankName: m.bankName ?? '', bankAccountNumber: m.bankAccountNumber ?? '', bankAccountHolder: m.bankAccountHolder ?? '', paymentTerms: m.paymentTerms ?? '' };

  const isDirty = (m: Merchant) => {
    const e = cardEdits[m.id];
    if (!e) return false;
    return e.bankName !== (m.bankName ?? '') || e.bankAccountNumber !== (m.bankAccountNumber ?? '') || e.bankAccountHolder !== (m.bankAccountHolder ?? '') || e.paymentTerms !== (m.paymentTerms ?? '');
  };

  const patchCard = (id: string, field: keyof CardState, value: string, m: Merchant) =>
    setCardEdits(prev => ({ ...prev, [id]: { ...getCard(m), ...prev[id], [field]: value } }));

  const handleSave = async (m: Merchant) => {
    const s = getCard(m);
    await updateMerchant(m.id, { bankName: s.bankName || undefined, bankAccountNumber: s.bankAccountNumber || undefined, bankAccountHolder: s.bankAccountHolder || undefined, paymentTerms: (s.paymentTerms as any) || undefined });
    setCardEdits(prev => { const next = { ...prev }; delete next[m.id]; return next; });
  };

  const allCategories = merchants
    .map((m) => m.category)
    .filter((c): c is string => !!c)
    .filter((c, i, arr) => arr.indexOf(c) === i);

  const handleAdd = () => {
    const category = customMode ? customCat.trim() : merchantForm.category;
    if (!merchantForm.name.trim()) return;
    addMerchant({ id: generateId(), name: merchantForm.name.trim(), phone: merchantForm.phone || undefined, category: category || undefined });
    setMerchantForm({ name: '', phone: '', category: '' });
    setCustomMode(false);
    setCustomCat('');
  };

  const [popupMerchant, setPopupMerchant] = useState<Merchant | null>(null);

  const openPopup = (m: Merchant) => {
    setPopupMerchant(m);
    if (!cardEdits[m.id]) {
      setCardEdits(prev => ({ ...prev, [m.id]: { bankName: m.bankName ?? '', bankAccountNumber: m.bankAccountNumber ?? '', bankAccountHolder: m.bankAccountHolder ?? '', paymentTerms: m.paymentTerms ?? '' } }));
    }
  };

  const closePopup = () => setPopupMerchant(null);

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-gold-gradient" />
          <ShoppingBag size={15} className="text-purple-400" />
          <h3 className="text-white font-semibold text-sm">Add Merchant</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input className={inputCls()} placeholder="Merchant name *" value={merchantForm.name} onChange={(e) => setMerchantForm({ ...merchantForm, name: e.target.value })} />
          <input className={inputCls()} placeholder="Phone (optional)" value={merchantForm.phone} onChange={(e) => setMerchantForm({ ...merchantForm, phone: e.target.value })} />
          <div className="flex gap-2">
            {customMode ? (
              <div className="flex gap-2 flex-1">
                <input className={inputCls()} placeholder="New category name" value={customCat} autoFocus onChange={(e) => setCustomCat(e.target.value)} />
                <button onClick={() => { setCustomMode(false); setCustomCat(''); setMerchantForm({ ...merchantForm, category: '' }); }} className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white bg-obsidian-700/60 border border-obsidian-400/60 shrink-0"><X size={14} /></button>
              </div>
            ) : (
              <select className={inputCls()} value={merchantForm.category} onChange={(e) => { if (e.target.value === '__custom__') { setCustomMode(true); setMerchantForm({ ...merchantForm, category: '' }); } else { setMerchantForm({ ...merchantForm, category: e.target.value }); } }}>
                <option value="">— Category (optional) —</option>
                {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="__custom__">＋ Add category…</option>
              </select>
            )}
            <button onClick={handleAdd} className="btn-gold px-4 py-2 rounded-lg text-sm shrink-0"><Plus size={15} /></button>
          </div>
        </div>
      </div>

      {/* List grouped by category */}
      {merchants.length === 0 ? (
        <div className="text-center py-10 text-gray-600 text-sm">No merchants added yet</div>
      ) : (
        <>
          {[...allCategories, null].map((cat) => {
            const items = cat === null
              ? merchants.filter(m => !m.category)
              : merchants.filter(m => m.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat ?? '__none__'} className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-obsidian-400/40 bg-obsidian-800/40">
                  <ShoppingBag size={12} className={cat ? 'text-purple-400' : 'text-gray-500'} />
                  <span className={`text-xs font-semibold ${cat ? 'text-gray-300' : 'text-gray-500'}`}>{cat ?? 'Uncategorised'}</span>
                  <span className="ml-auto text-[10px] text-gray-600">{items.length}</span>
                </div>
                <div className="divide-y divide-obsidian-400/30">
                  {items.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => openPopup(m)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-obsidian-700/30 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white font-semibold text-sm">{m.name}</span>
                          {m.paymentTerms && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-obsidian-600/60 text-gray-400 border border-obsidian-400/30">{PAYMENT_TERMS_LABELS[m.paymentTerms]}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {m.phone && <span className="text-gray-500 text-xs">{m.phone}</span>}
                          {m.bankName
                            ? <span className="text-gray-500 text-xs flex items-center gap-1"><CreditCard size={10} className="text-gold-400" />{m.bankName} · {m.bankAccountNumber}</span>
                            : <span className="text-gray-600 text-xs italic">No bank details</span>
                          }
                        </div>
                      </div>
                      <Pencil size={13} className="text-gray-600 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Merchant detail popup */}
      {popupMerchant && (() => {
        const m = popupMerchant;
        const s = getCard(m);
        const dirty = isDirty(m);
        return (
          <Modal isOpen onClose={closePopup} title={m.name}>
            <div className="space-y-4">
              {/* Meta */}
              <div className="flex items-center gap-2 flex-wrap">
                {m.category && <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/20">{m.category}</span>}
                {m.phone && <span className="text-gray-400 text-xs">{m.phone}</span>}
              </div>

              {/* Payment fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Bank Name</label>
                  <input className={inputCls()} placeholder="e.g. Maybank" value={s.bankName} onChange={e => patchCard(m.id, 'bankName', e.target.value, m)} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Account Number</label>
                  <input className={inputCls()} placeholder="e.g. 1234567890" value={s.bankAccountNumber} onChange={e => patchCard(m.id, 'bankAccountNumber', e.target.value, m)} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Account Holder</label>
                  <input className={inputCls()} placeholder="Full name as per bank" value={s.bankAccountHolder} onChange={e => patchCard(m.id, 'bankAccountHolder', e.target.value, m)} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Payment Terms</label>
                  <select className={inputCls()} value={s.paymentTerms} onChange={e => patchCard(m.id, 'paymentTerms', e.target.value, m)}>
                    <option value="">— Select —</option>
                    <option value="per_job">Per Job</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { closePopup(); setDeleteTarget({ id: m.id, label: m.name }); }}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={12} /> Delete
                </button>
                <button
                  onClick={async () => { await handleSave(m); closePopup(); }}
                  disabled={!dirty}
                  className="flex-1 btn-gold py-2 rounded-lg text-xs font-semibold disabled:opacity-40"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      <DeleteConfirmModal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={async () => { if (deleteTarget) deleteMerchant(deleteTarget.id); }} itemName={deleteTarget?.label ?? ''} />
    </div>
  );
}

function DealersTab({
  dealers, form, setForm, editTarget, editForm, setEditTarget, setEditForm, onAdd, onUpdate, onDelete,
}: {
  dealers: Dealer[];
  form: { name: string; phone: string; bankName: string; bankAccountNumber: string; bankAccountHolder: string };
  setForm: (f: any) => void;
  emptyForm: any;
  editTarget: Dealer | null;
  editForm: { name: string; phone: string; bankName: string; bankAccountNumber: string; bankAccountHolder: string };
  setEditTarget: (d: Dealer | null) => void;
  setEditForm: (f: any) => void;
  onAdd: () => void;
  onUpdate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-gold-gradient" />
          <Building2 size={15} className="text-blue-400" />
          <h3 className="text-white font-semibold text-sm">Add Car Dealer</h3>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-gray-400 text-xs mb-1">Dealer Name *</label>
            <input className={inputCls()} placeholder="e.g. Pak Long Motors" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-gray-400 text-xs mb-1">Phone</label>
            <input className={inputCls()} placeholder="e.g. 012-3456789" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <BankFields value={form} onChange={setForm} />
        </div>
        <button onClick={onAdd} disabled={!form.name.trim()} className="mt-4 btn-gold px-4 py-2 rounded-lg text-sm disabled:opacity-40 flex items-center gap-2">
          <Plus size={15} /> Add Dealer
        </button>
      </div>

      {/* List */}
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-obsidian-400/60">
          <Building2 size={13} className="text-blue-400" />
          <span className="text-white font-medium text-sm">Car Dealers</span>
          <span className="ml-auto text-xs text-gray-500">{dealers.length} total</span>
        </div>
        {dealers.length === 0 ? (
          <div className="text-center py-10 text-gray-600 text-sm">No dealers added yet</div>
        ) : (
          <div className="divide-y divide-obsidian-400/40">
            {dealers.map(d => (
              <div key={d.id} className="px-5 py-3 hover:bg-obsidian-700/30 transition-colors">
                {editTarget?.id === d.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-gray-400 text-xs mb-1">Name *</label><input className={inputCls()} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></div>
                      <div><label className="block text-gray-400 text-xs mb-1">Phone</label><input className={inputCls()} value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} /></div>
                      <BankFields value={editForm} onChange={setEditForm} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditTarget(null)} className="flex-1 btn-ghost py-1.5 rounded-lg text-xs">Cancel</button>
                      <button onClick={() => onUpdate(d.id)} className="flex-1 btn-gold py-1.5 rounded-lg text-xs">Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm font-medium">{d.name}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        {d.phone && <p className="text-gray-500 text-xs">{d.phone}</p>}
                        {d.bankName && <p className="text-gray-500 text-xs flex items-center gap-1"><CreditCard size={10} />{d.bankName} · {d.bankAccountNumber}</p>}
                        {d.bankAccountHolder && <p className="text-gray-500 text-xs">{d.bankAccountHolder}</p>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => { setEditTarget(d); setEditForm({ name: d.name, phone: d.phone ?? '', bankName: d.bankName ?? '', bankAccountNumber: d.bankAccountNumber ?? '', bankAccountHolder: d.bankAccountHolder ?? '' }); }} className="p-1.5 text-gray-600 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"><Pencil size={13} /></button>
                      <button onClick={() => setDeleteTarget({ id: d.id, label: d.name })} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 size={13} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <DeleteConfirmModal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={async () => { if (deleteTarget) onDelete(deleteTarget.id); }} itemName={deleteTarget?.label ?? ''} />
    </div>
  );
}

function Section({
  title, icon: Icon, iconColor, count, form, items, onDelete, emptyText,
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  count: number;
  form: React.ReactNode;
  items: { id: string; primary: string; secondary?: string }[];
  onDelete: (id: string) => void;
  emptyText: string;
}) {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-gold-gradient" />
          <Icon size={15} className={iconColor} />
          <h3 className="text-white font-semibold text-sm">Add {title}</h3>
        </div>
        {form}
      </div>

      {/* List */}
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-obsidian-400/60">
          <Icon size={14} className={iconColor} />
          <span className="text-white font-medium text-sm">{title}</span>
          <span className="ml-auto text-xs text-gray-500">{count} total</span>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-10 text-gray-600 text-sm">{emptyText}</div>
        ) : (
          <div className="divide-y divide-obsidian-400/40">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-5 py-3 hover:bg-obsidian-700/30 transition-colors">
                <div>
                  <p className="text-white text-sm font-medium">{item.primary}</p>
                  {item.secondary && <p className="text-gray-500 text-xs mt-0.5">{item.secondary}</p>}
                </div>
                <button
                  onClick={() => setDeleteTarget({ id: item.id, label: item.primary })}
                  className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) onDelete(deleteTarget.id); }}
        itemName={deleteTarget?.label ?? ''}
      />
    </div>
  );
}
