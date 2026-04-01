import React, { useState } from 'react';
import { Plus, FileText, Trash2, Edit, ArrowRight, AlertCircle, MessageCircle } from 'lucide-react';
import { useStore } from '../store';
import { Quotation, Car } from '../types';
import Modal from '../components/Modal';
import { formatRM, formatMileage, generateId } from '../utils/format';

function inputCls(error?: string) {
  return `w-full bg-[#111d35] border ${error ? 'border-red-500/50' : 'border-[#1a2a4a]'} text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 transition-colors`;
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

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  accepted: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
  expired: 'bg-gray-500/20 text-gray-400',
};

const emptyForm = {
  type: 'inbound' as Quotation['type'],
  contactName: '',
  phone: '',
  make: '',
  model: '',
  year: new Date().getFullYear(),
  mileage: 0,
  offeredPrice: 0,
  expiryDate: '',
  status: 'pending' as Quotation['status'],
  notes: '',
};

export default function Quotations() {
  const quotations = useStore((s) => s.quotations);
  const currentUser = useStore((s) => s.currentUser);
  const addQuotation = useStore((s) => s.addQuotation);
  const updateQuotation = useStore((s) => s.updateQuotation);
  const deleteQuotation = useStore((s) => s.deleteQuotation);
  const addCar = useStore((s) => s.addCar);

  const isDirector = currentUser?.role === 'director';
  const [tab, setTab] = useState<'inbound' | 'outbound'>('inbound');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Quotation | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const filtered = quotations.filter((q) => q.type === tab);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.contactName.trim()) e.contactName = 'Required';
    if (!form.phone.trim()) e.phone = 'Required';
    if (!form.make.trim()) e.make = 'Required';
    if (!form.model.trim()) e.model = 'Required';
    if (!form.expiryDate) e.expiryDate = 'Required';
    if (!form.offeredPrice || form.offeredPrice <= 0) e.offeredPrice = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    if (editTarget) {
      updateQuotation(editTarget.id, { ...form });
    } else {
      addQuotation({
        id: generateId(),
        ...form,
        createdAt: new Date().toISOString(),
      });
    }
    setShowModal(false);
    setEditTarget(null);
    setForm(emptyForm);
    setErrors({});
  };

  const openEdit = (q: Quotation) => {
    setEditTarget(q);
    setForm({
      type: q.type,
      contactName: q.contactName,
      phone: q.phone,
      make: q.make,
      model: q.model,
      year: q.year,
      mileage: q.mileage,
      offeredPrice: q.offeredPrice,
      expiryDate: q.expiryDate,
      status: q.status,
      notes: q.notes ?? '',
    });
    setErrors({});
    setShowModal(true);
  };

  const openAdd = () => {
    setEditTarget(null);
    setForm({ ...emptyForm, type: tab });
    setErrors({});
    setShowModal(true);
  };

  const handleConvertToInventory = (q: Quotation) => {
    const newCar: Car = {
      id: generateId(),
      make: q.make,
      model: q.model,
      year: q.year,
      colour: '',
      mileage: q.mileage,
      condition: 'good',
      purchasePrice: q.offeredPrice,
      sellingPrice: q.offeredPrice,
      transmission: 'auto',
      status: 'available',
      dateAdded: new Date().toISOString().split('T')[0],
      notes: `Converted from quotation. Contact: ${q.contactName} (${q.phone})`,
    };
    addCar(newCar);
    updateQuotation(q.id, { status: 'accepted' });
    alert(`${q.make} ${q.model} added to inventory!`);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Delete this quotation?')) deleteQuotation(id);
  };

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex bg-[#0d1526] border border-[#1a2a4a] rounded-lg p-1 gap-1">
          {(['inbound', 'outbound'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${tab === t ? 'bg-cyan-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {t}
              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${tab === t ? 'bg-white/20' : 'bg-[#1a2a4a]'}`}>
                {quotations.filter((q) => q.type === t).length}
              </span>
            </button>
          ))}
        </div>

        {(isDirector || currentUser?.role === 'salesperson') && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-cyan-500/20"
          >
            <Plus size={16} />
            New Quotation
          </button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <FileText size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400">No {tab} quotations yet</p>
        </div>
      ) : (
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-[#1a2a4a] bg-[#111d35]">
                  <th className="text-left px-5 py-3 font-medium">Contact</th>
                  <th className="text-left px-5 py-3 font-medium">Vehicle</th>
                  <th className="text-left px-5 py-3 font-medium">Mileage</th>
                  <th className="text-right px-5 py-3 font-medium">Offered Price</th>
                  <th className="text-left px-5 py-3 font-medium">Expiry</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  {isDirector && <th className="text-left px-5 py-3 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((q, i) => (
                  <tr key={q.id} className={`border-b border-[#1a2a4a]/50 ${i % 2 === 0 ? 'bg-[#0d1526]' : 'bg-[#0a0f1e]/50'} hover:bg-[#111d35] transition-colors`}>
                    <td className="px-5 py-3">
                      <p className="text-white font-medium">{q.contactName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-gray-500 text-xs">{q.phone}</p>
                        <button
                          onClick={() => {
                            const clean = q.phone.replace(/[\s\-+]/g, '');
                            const vehicle = `${q.year} ${q.make} ${q.model}`;
                            const msg = q.type === 'outbound'
                              ? encodeURIComponent(`Hi ${q.contactName}, here is your quotation from AutoDream:\n\nVehicle: ${vehicle}\nMileage: ${q.mileage.toLocaleString()} km\nQuoted Price: RM ${q.offeredPrice.toLocaleString()}\nValid until: ${new Date(q.expiryDate).toLocaleDateString('en-MY')}\n\nPlease contact us for more details.`)
                              : encodeURIComponent(`Hi ${q.contactName}, this is AutoDream. We are interested in your ${vehicle}. Please contact us at your convenience.`);
                            window.open(`https://wa.me/${clean}?text=${msg}`, '_blank');
                          }}
                          className="text-green-500 hover:text-green-400 transition-colors"
                          title="WhatsApp"
                        >
                          <MessageCircle size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-gray-300">{q.year} {q.make} {q.model}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-400">{formatMileage(q.mileage)}</td>
                    <td className="px-5 py-3 text-cyan-400 font-semibold text-right">{formatRM(q.offeredPrice)}</td>
                    <td className="px-5 py-3 text-gray-400">
                      {new Date(q.expiryDate).toLocaleDateString('en-MY')}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[q.status]}`}>
                        {q.status}
                      </span>
                    </td>
                    {isDirector && (
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEdit(q)} className="p-1.5 text-gray-400 hover:text-cyan-400 hover:bg-[#1a2a4a] rounded-lg transition-colors">
                            <Edit size={14} />
                          </button>
                          <button onClick={() => handleDelete(q.id)} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                            <Trash2 size={14} />
                          </button>
                          {q.type === 'inbound' && q.status === 'accepted' && (
                            <button
                              onClick={() => handleConvertToInventory(q)}
                              className="flex items-center gap-1 text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 px-2 py-1 rounded-lg transition-colors"
                            >
                              <ArrowRight size={12} /> To Inventory
                            </button>
                          )}
                          {q.type === 'inbound' && q.status === 'pending' && (
                            <button
                              onClick={() => handleConvertToInventory(q)}
                              className="flex items-center gap-1 text-xs bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 px-2 py-1 rounded-lg transition-colors"
                            >
                              <ArrowRight size={12} /> Convert
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditTarget(null); }} title={editTarget ? 'Edit Quotation' : 'New Quotation'} maxWidth="max-w-xl">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Type">
            <select className={inputCls()} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Quotation['type'] })}>
              <option value="inbound">Inbound (Buying)</option>
              <option value="outbound">Outbound (Selling)</option>
            </select>
          </FormField>
          <FormField label="Status">
            <select className={inputCls()} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Quotation['status'] })}>
              <option value="pending">Pending</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="expired">Expired</option>
            </select>
          </FormField>
          <FormField label="Contact Name" error={errors.contactName}>
            <input className={inputCls(errors.contactName)} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          </FormField>
          <FormField label="Phone" error={errors.phone}>
            <input className={inputCls(errors.phone)} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </FormField>
          <FormField label="Make" error={errors.make}>
            <input className={inputCls(errors.make)} value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
          </FormField>
          <FormField label="Model" error={errors.model}>
            <input className={inputCls(errors.model)} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </FormField>
          <FormField label="Year">
            <input type="number" className={inputCls()} value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} />
          </FormField>
          <FormField label="Mileage (km)">
            <input type="number" className={inputCls()} value={form.mileage} onChange={(e) => setForm({ ...form, mileage: Number(e.target.value) })} />
          </FormField>
          <FormField label="Offered Price (RM)" error={errors.offeredPrice}>
            <input type="number" className={inputCls(errors.offeredPrice)} value={form.offeredPrice} onChange={(e) => setForm({ ...form, offeredPrice: Number(e.target.value) })} />
          </FormField>
          <FormField label="Expiry Date" error={errors.expiryDate}>
            <input type="date" className={inputCls(errors.expiryDate)} value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
          </FormField>
          <FormField label="Notes" className="col-span-2">
            <textarea className={`${inputCls()} h-20 resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </FormField>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => { setShowModal(false); setEditTarget(null); }} className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleSubmit} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            {editTarget ? 'Save Changes' : 'Create Quotation'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
