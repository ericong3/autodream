import React, { useState } from 'react';
import { Plus, X, Building2, Wrench, Package, ShoppingBag, UserCheck, Landmark, Phone, Mail, Pencil, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { formatRM, generateId } from '../utils/format';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import Modal from '../components/Modal';
import { ExternalSalesman, BANKS } from '../types';

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
  const deleteDealer = useStore((s) => s.deleteDealer);
  const addWorkshop    = useStore((s) => s.addWorkshop);
  const deleteWorkshop = useStore((s) => s.deleteWorkshop);
  const addSupplier    = useStore((s) => s.addSupplier);
  const deleteSupplier = useStore((s) => s.deleteSupplier);
  const merchants      = useStore((s) => s.merchants);
  const addMerchant    = useStore((s) => s.addMerchant);
  const deleteMerchant = useStore((s) => s.deleteMerchant);
  const externalSalesmen     = useStore((s) => s.externalSalesmen);
  const addExternalSalesman    = useStore((s) => s.addExternalSalesman);
  const updateExternalSalesman = useStore((s) => s.updateExternalSalesman);
  const deleteExternalSalesman = useStore((s) => s.deleteExternalSalesman);
  const bankers       = useStore((s) => s.bankers);
  const addBanker     = useStore((s) => s.addBanker);
  const updateBanker  = useStore((s) => s.updateBanker);
  const deleteBanker  = useStore((s) => s.deleteBanker);
  const cars = useStore((s) => s.cars);

  const [dealerForm,   setDealerForm]   = useState({ name: '', phone: '' });
  const [workshopForm, setWorkshopForm] = useState({ name: '', phone: '', speciality: '' });
  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', category: '' });
  const [merchantForm, setMerchantForm] = useState({ name: '', phone: '', category: '' });
  const [extForm, setExtForm] = useState(emptyExtSalesman);
  const [extProfileTarget, setExtProfileTarget] = useState<ExternalSalesman | null>(null);
  const emptyBankerForm = { name: '', bank: '', phone: '', email: '', notes: '' };
  const [bankerForm, setBankerForm] = useState(emptyBankerForm);
  const [bankerEditTarget, setBankerEditTarget] = useState<string | null>(null);
  const [bankerEditForm, setBankerEditForm] = useState(emptyBankerForm);
  const [bankerDeleteTarget, setBankerDeleteTarget] = useState<{ id: string; name: string } | null>(null);
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
        <Section
          title="Car Dealers"
          icon={Building2}
          iconColor="text-blue-400"
          count={dealers.length}
          form={
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className={inputCls()} placeholder="Dealer name *" value={dealerForm.name} onChange={(e) => setDealerForm({ ...dealerForm, name: e.target.value })} />
              <div className="flex gap-2">
                <input className={inputCls()} placeholder="Phone (optional)" value={dealerForm.phone} onChange={(e) => setDealerForm({ ...dealerForm, phone: e.target.value })} />
                <button
                  onClick={() => {
                    if (!dealerForm.name.trim()) return;
                    handleAdd(async () => {
                      await addDealer({ id: generateId(), name: dealerForm.name.trim(), ...( dealerForm.phone ? { phone: dealerForm.phone } : {}) } as any);
                      setDealerForm({ name: '', phone: '' });
                    });
                  }}
                  className="btn-gold px-4 py-2 rounded-lg text-sm shrink-0"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>
          }
          items={dealers.map((d) => ({
            id: d.id,
            primary: d.name,
            secondary: (d as any).phone,
          }))}
          onDelete={(id) => deleteDealer(id)}
          emptyText="No dealers added yet"
        />
      )}

      {/* Workshops */}
      {activeTab === 'workshops' && (
        <WorkshopsTab
          workshops={workshops}
          workshopForm={workshopForm}
          setWorkshopForm={setWorkshopForm}
          addWorkshop={addWorkshop}
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
          {/* Add form */}
          <div className="card-surface rounded-xl p-4 space-y-3">
            <p className="text-white font-semibold text-sm flex items-center gap-2">
              <Landmark size={15} className="text-sky-400" />
              Add Banker
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-400 text-xs mb-1">Full Name *</label>
                <input className={inputCls()} placeholder="e.g. Ahmad bin Ali" value={bankerForm.name} onChange={e => setBankerForm({ ...bankerForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Bank *</label>
                <select className={inputCls()} value={bankerForm.bank} onChange={e => setBankerForm({ ...bankerForm, bank: e.target.value })}>
                  <option value="">Select bank...</option>
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Phone</label>
                <input className={inputCls()} placeholder="e.g. 012-3456789" value={bankerForm.phone} onChange={e => setBankerForm({ ...bankerForm, phone: e.target.value })} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Email</label>
                <input className={inputCls()} type="email" placeholder="e.g. ahmad@bank.com" value={bankerForm.email} onChange={e => setBankerForm({ ...bankerForm, email: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="block text-gray-400 text-xs mb-1">Notes</label>
                <input className={inputCls()} placeholder="e.g. Specialises in MyHome, fast approval" value={bankerForm.notes} onChange={e => setBankerForm({ ...bankerForm, notes: e.target.value })} />
              </div>
            </div>
            <button
              disabled={!bankerForm.name.trim() || !bankerForm.bank}
              onClick={() => handleAdd(async () => {
                await addBanker({
                  id: generateId(),
                  name: bankerForm.name.trim(),
                  bank: bankerForm.bank,
                  phone: bankerForm.phone || undefined,
                  email: bankerForm.email || undefined,
                  notes: bankerForm.notes || undefined,
                  createdAt: new Date().toISOString(),
                });
                setBankerForm(emptyBankerForm);
              })}
              className="btn-gold px-4 py-2 rounded-lg text-sm disabled:opacity-40"
            >
              Add Banker
            </button>
          </div>

          {/* Banker list grouped by bank */}
          {BANKS.filter(bank => bankers.some(b => b.bank === bank)).map(bank => (
            <div key={bank} className="card-surface rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-obsidian-400/40 flex items-center gap-2">
                <Landmark size={13} className="text-sky-400" />
                <span className="text-white font-semibold text-sm">{bank}</span>
                <span className="text-gray-600 text-xs ml-1">{bankers.filter(b => b.bank === bank).length} banker{bankers.filter(b => b.bank === bank).length !== 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-obsidian-400/30">
                {bankers.filter(b => b.bank === bank).map(banker => (
                  <div key={banker.id} className="px-4 py-3">
                    {bankerEditTarget === banker.id ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <input className={inputCls()} placeholder="Name *" value={bankerEditForm.name} onChange={e => setBankerEditForm({ ...bankerEditForm, name: e.target.value })} />
                          <select className={inputCls()} value={bankerEditForm.bank} onChange={e => setBankerEditForm({ ...bankerEditForm, bank: e.target.value })}>
                            {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                          <input className={inputCls()} placeholder="Phone" value={bankerEditForm.phone} onChange={e => setBankerEditForm({ ...bankerEditForm, phone: e.target.value })} />
                          <input className={inputCls()} placeholder="Email" value={bankerEditForm.email} onChange={e => setBankerEditForm({ ...bankerEditForm, email: e.target.value })} />
                          <input className={`${inputCls()} col-span-2`} placeholder="Notes" value={bankerEditForm.notes} onChange={e => setBankerEditForm({ ...bankerEditForm, notes: e.target.value })} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setBankerEditTarget(null)} className="flex-1 btn-ghost py-1.5 rounded-lg text-xs">Cancel</button>
                          <button
                            onClick={async () => {
                              await updateBanker(banker.id, { name: bankerEditForm.name.trim(), bank: bankerEditForm.bank, phone: bankerEditForm.phone || undefined, email: bankerEditForm.email || undefined, notes: bankerEditForm.notes || undefined });
                              setBankerEditTarget(null);
                            }}
                            className="flex-1 btn-gold py-1.5 rounded-lg text-xs"
                          >Save</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-medium text-sm">{banker.name}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                            {banker.phone && <span className="text-gray-500 text-xs flex items-center gap-1"><Phone size={10} />{banker.phone}</span>}
                            {banker.email && <span className="text-gray-500 text-xs flex items-center gap-1"><Mail size={10} />{banker.email}</span>}
                            {banker.notes && <span className="text-gray-600 text-xs italic">{banker.notes}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => { setBankerEditTarget(banker.id); setBankerEditForm({ name: banker.name, bank: banker.bank, phone: banker.phone ?? '', email: banker.email ?? '', notes: banker.notes ?? '' }); }}
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
                ))}
              </div>
            </div>
          ))}

          {bankers.length === 0 && (
            <div className="text-center py-16 text-gray-600">
              <Landmark size={36} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No bankers added yet</p>
            </div>
          )}
        </div>
      )}

      <DeleteConfirmModal
        isOpen={!!bankerDeleteTarget}
        onClose={() => setBankerDeleteTarget(null)}
        onConfirm={async () => { if (bankerDeleteTarget) await deleteBanker(bankerDeleteTarget.id); }}
        itemName={bankerDeleteTarget?.name ?? ''}
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
          <input className={inputCls()} placeholder="IC Number" value={form.ic} onChange={e => setForm({ ...form, ic: e.target.value })} />
          <input className={inputCls()} placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          <input className={inputCls()} placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
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

function WorkshopsTab({
  workshops, workshopForm, setWorkshopForm, addWorkshop, deleteWorkshop,
}: {
  workshops: any[];
  workshopForm: { name: string; phone: string; speciality: string };
  setWorkshopForm: (f: any) => void;
  addWorkshop: (w: any) => void;
  deleteWorkshop: (id: string) => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customCat, setCustomCat] = useState('');

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
          <input
            className={inputCls()}
            placeholder="Workshop name *"
            value={workshopForm.name}
            onChange={(e) => setWorkshopForm({ ...workshopForm, name: e.target.value })}
          />
          <input
            className={inputCls()}
            placeholder="Phone (optional)"
            value={workshopForm.phone}
            onChange={(e) => setWorkshopForm({ ...workshopForm, phone: e.target.value })}
          />
          <div className="flex gap-2">
            {customMode ? (
              <div className="flex gap-2 flex-1">
                <input
                  className={inputCls()}
                  placeholder="New category name *"
                  value={customCat}
                  autoFocus
                  onChange={(e) => setCustomCat(e.target.value)}
                />
                <button
                  onClick={() => { setCustomMode(false); setCustomCat(''); setWorkshopForm({ ...workshopForm, speciality: '' }); }}
                  className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white bg-obsidian-700/60 border border-obsidian-400/60 shrink-0"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <select
                className={inputCls()}
                value={workshopForm.speciality}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setCustomMode(true);
                    setWorkshopForm({ ...workshopForm, speciality: '' });
                  } else {
                    setWorkshopForm({ ...workshopForm, speciality: e.target.value });
                  }
                }}
              >
                <option value="">— Select category —</option>
                {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="__custom__">＋ Add category…</option>
              </select>
            )}
            <button
              onClick={handleAdd}
              className="btn-gold px-4 py-2 rounded-lg text-sm shrink-0"
            >
              <Plus size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Grouped by category */}
      {allCategories.map((cat) => {
        const items = workshops.filter((w) => w.speciality === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-obsidian-400/60">
              <Wrench size={13} className="text-orange-400" />
              <span className="text-white font-medium text-sm">{cat}</span>
              <span className="ml-auto text-xs text-gray-500">{items.length}</span>
            </div>
            <div className="divide-y divide-obsidian-400/40">
              {items.map((w) => (
                <div key={w.id} className="flex items-center justify-between px-5 py-3 hover:bg-obsidian-700/30 transition-colors">
                  <div>
                    <p className="text-white text-sm font-medium">{w.name}</p>
                    {w.phone && <p className="text-gray-500 text-xs mt-0.5">{w.phone}</p>}
                  </div>
                  <button
                    onClick={() => setDeleteTarget({ id: w.id, label: w.name })}
                    className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {workshops.length === 0 && (
        <div className="text-center py-10 text-gray-600 text-sm">No workshops added yet</div>
      )}

      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) deleteWorkshop(deleteTarget.id); }}
        itemName={deleteTarget?.label ?? ''}
      />
    </div>
  );
}

function MerchantsTab({
  merchants, merchantForm, setMerchantForm, addMerchant, deleteMerchant,
}: {
  merchants: any[];
  merchantForm: { name: string; phone: string; category: string };
  setMerchantForm: (f: any) => void;
  addMerchant: (m: any) => void;
  deleteMerchant: (id: string) => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customCat, setCustomCat] = useState('');

  const allCategories = [
    ...merchants
      .map((m) => m.category)
      .filter((c): c is string => !!c)
      .filter((c, i, arr) => arr.indexOf(c) === i),
  ];

  const handleAdd = () => {
    const category = customMode ? customCat.trim() : merchantForm.category;
    if (!merchantForm.name.trim()) return;
    addMerchant({ id: generateId(), name: merchantForm.name.trim(), phone: merchantForm.phone || undefined, category: category || undefined });
    setMerchantForm({ name: '', phone: '', category: '' });
    setCustomMode(false);
    setCustomCat('');
  };

  const uncategorised = merchants.filter((m) => !m.category);

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
          <input
            className={inputCls()}
            placeholder="Merchant name *"
            value={merchantForm.name}
            onChange={(e) => setMerchantForm({ ...merchantForm, name: e.target.value })}
          />
          <input
            className={inputCls()}
            placeholder="Phone (optional)"
            value={merchantForm.phone}
            onChange={(e) => setMerchantForm({ ...merchantForm, phone: e.target.value })}
          />
          <div className="flex gap-2">
            {customMode ? (
              <div className="flex gap-2 flex-1">
                <input
                  className={inputCls()}
                  placeholder="New category name"
                  value={customCat}
                  autoFocus
                  onChange={(e) => setCustomCat(e.target.value)}
                />
                <button
                  onClick={() => { setCustomMode(false); setCustomCat(''); setMerchantForm({ ...merchantForm, category: '' }); }}
                  className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white bg-obsidian-700/60 border border-obsidian-400/60 shrink-0"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <select
                className={inputCls()}
                value={merchantForm.category}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setCustomMode(true);
                    setMerchantForm({ ...merchantForm, category: '' });
                  } else {
                    setMerchantForm({ ...merchantForm, category: e.target.value });
                  }
                }}
              >
                <option value="">— Category (optional) —</option>
                {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="__custom__">＋ Add category…</option>
              </select>
            )}
            <button onClick={handleAdd} className="btn-gold px-4 py-2 rounded-lg text-sm shrink-0">
              <Plus size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Grouped by category */}
      {allCategories.map((cat) => {
        const items = merchants.filter((m) => m.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-obsidian-400/60">
              <ShoppingBag size={13} className="text-purple-400" />
              <span className="text-white font-medium text-sm">{cat}</span>
              <span className="ml-auto text-xs text-gray-500">{items.length}</span>
            </div>
            <div className="divide-y divide-obsidian-400/40">
              {items.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-5 py-3 hover:bg-obsidian-700/30 transition-colors">
                  <div>
                    <p className="text-white text-sm font-medium">{m.name}</p>
                    {m.phone && <p className="text-gray-500 text-xs mt-0.5">{m.phone}</p>}
                  </div>
                  <button
                    onClick={() => setDeleteTarget({ id: m.id, label: m.name })}
                    className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Uncategorised */}
      {uncategorised.length > 0 && (
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-obsidian-400/60">
            <ShoppingBag size={13} className="text-gray-500" />
            <span className="text-gray-400 font-medium text-sm">Uncategorised</span>
            <span className="ml-auto text-xs text-gray-500">{uncategorised.length}</span>
          </div>
          <div className="divide-y divide-obsidian-400/40">
            {uncategorised.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-5 py-3 hover:bg-obsidian-700/30 transition-colors">
                <div>
                  <p className="text-white text-sm font-medium">{m.name}</p>
                  {m.phone && <p className="text-gray-500 text-xs mt-0.5">{m.phone}</p>}
                </div>
                <button
                  onClick={() => setDeleteTarget({ id: m.id, label: m.name })}
                  className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {merchants.length === 0 && (
        <div className="text-center py-10 text-gray-600 text-sm">No merchants added yet</div>
      )}

      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) deleteMerchant(deleteTarget.id); }}
        itemName={deleteTarget?.label ?? ''}
      />
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
