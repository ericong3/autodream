import React, { useState } from 'react';
import { Plus, X, Building2, Wrench, Package } from 'lucide-react';
import { useStore } from '../store';
import { generateId } from '../utils/format';
import DeleteConfirmModal from '../components/DeleteConfirmModal';

type Tab = 'dealers' | 'workshops' | 'suppliers';

const TABS: { key: Tab; label: string; icon: React.ElementType; color: string }[] = [
  { key: 'dealers',   label: 'Car Dealers', icon: Building2, color: 'text-blue-400'   },
  { key: 'workshops', label: 'Workshops',      icon: Wrench,    color: 'text-orange-400' },
  { key: 'suppliers', label: 'Suppliers',      icon: Package,   color: 'text-green-400'  },
];

function inputCls() {
  return 'w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors';
}

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

  const [dealerForm,   setDealerForm]   = useState({ name: '', phone: '' });
  const [workshopForm, setWorkshopForm] = useState({ name: '', phone: '', speciality: '' });
  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', category: '' });

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
  'Others',
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
            <select
              className={inputCls()}
              value={workshopForm.speciality}
              onChange={(e) => setWorkshopForm({ ...workshopForm, speciality: e.target.value })}
            >
              <option value="">— Select category —</option>
              {WORKSHOP_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button
              onClick={() => {
                if (!workshopForm.name.trim() || !workshopForm.speciality) return;
                addWorkshop({ id: generateId(), name: workshopForm.name.trim(), phone: workshopForm.phone || undefined, speciality: workshopForm.speciality });
                setWorkshopForm({ name: '', phone: '', speciality: '' });
              }}
              className="btn-gold px-4 py-2 rounded-lg text-sm shrink-0"
            >
              <Plus size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Grouped by category */}
      {WORKSHOP_CATEGORIES.map((cat) => {
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
