import React, { useState } from 'react';
import { Plus, Wrench, Trash2, Edit, AlertCircle, MapPin } from 'lucide-react';
import { useStore } from '../store';
import { RepairJob } from '../types';
import Modal from '../components/Modal';
import StatCard from '../components/StatCard';
import { formatRM, generateId } from '../utils/format';

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

const REPAIR_STATUS_BADGE: Record<string, string> = {
  queued: 'bg-gray-500/20 text-gray-400',
  pending: 'bg-yellow-500/20 text-yellow-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  done: 'bg-green-500/20 text-green-400',
};

const REPAIR_STATUS_LABEL: Record<string, string> = {
  queued: 'Pending',
  pending: 'Sent Out',
  in_progress: 'In Progress',
  done: 'Collected',
};

const emptyRepairForm = {
  carId: '',
  typeOfRepair: '',
  location: '',
  parts: [{ name: '', cost: 0 }],
  labourCost: 0,
  status: 'pending' as RepairJob['status'],
  notes: '',
};

export default function Workshop() {
  const repairs = useStore((s) => s.repairs);
  const cars = useStore((s) => s.cars);
  const currentUser = useStore((s) => s.currentUser);
  const addRepair = useStore((s) => s.addRepair);
  const updateRepair = useStore((s) => s.updateRepair);
  const deleteRepair = useStore((s) => s.deleteRepair);

  const isDirector = currentUser?.role === 'director';
  const isMechanic = currentUser?.role === 'mechanic';
  const canManageRepairs = isDirector || isMechanic;

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<RepairJob | null>(null);
  const [form, setForm] = useState(emptyRepairForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const totalSpend = repairs.reduce((s, r) => s + r.totalCost, 0);
  const activeJobs = repairs.filter((r) => r.status !== 'done').length;
  const completedJobs = repairs.filter((r) => r.status === 'done').length;

  const getCar = (carId: string) => cars.find((c) => c.id === carId);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.carId) e.carId = 'Select a car';
    if (!form.typeOfRepair.trim()) e.typeOfRepair = 'Required';
    if (form.labourCost < 0) e.labourCost = 'Must be 0 or more';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const validParts = form.parts.filter((p) => p.name.trim());
    const partsTotal = validParts.reduce((sum, p) => sum + p.cost, 0);
    const total = partsTotal + form.labourCost;

    setShowModal(false);
    setEditTarget(null);
    setForm(emptyRepairForm);
    setErrors({});

    if (editTarget) {
      updateRepair(editTarget.id, {
        carId: form.carId,
        typeOfRepair: form.typeOfRepair,
        location: form.location || undefined,
        parts: validParts,
        labourCost: form.labourCost,
        totalCost: total,
        status: form.status,
        notes: form.notes,
      });
    } else {
      addRepair({
        id: generateId(),
        carId: form.carId,
        typeOfRepair: form.typeOfRepair,
        location: form.location || undefined,
        parts: validParts,
        labourCost: form.labourCost,
        totalCost: total,
        status: form.status,
        notes: form.notes,
        createdAt: new Date().toISOString(),
      });
    }
  };

  const openEdit = (r: RepairJob) => {
    setEditTarget(r);
    setForm({
      carId: r.carId,
      typeOfRepair: r.typeOfRepair,
      location: r.location ?? '',
      parts: r.parts.length > 0 ? [...r.parts] : [{ name: '', cost: 0 }],
      labourCost: r.labourCost,
      status: r.status,
      notes: r.notes ?? '',
    });
    setErrors({});
    setShowModal(true);
  };

  const openAdd = () => {
    setEditTarget(null);
    setForm(emptyRepairForm);
    setErrors({});
    setShowModal(true);
  };

  const addPartRow = () => setForm({ ...form, parts: [...form.parts, { name: '', cost: 0 }] });
  const updatePart = (idx: number, field: 'name' | 'cost', val: string | number) => {
    const parts = [...form.parts];
    parts[idx] = { ...parts[idx], [field]: val };
    setForm({ ...form, parts });
  };
  const removePart = (idx: number) => setForm({ ...form, parts: form.parts.filter((_, i) => i !== idx) });

  const partsTotal = form.parts.reduce((s, p) => s + p.cost, 0);
  const computedTotal = partsTotal + form.labourCost;

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Repair Spend"
          value={formatRM(totalSpend)}
          icon={Wrench}
          borderColor="border-l-orange-400"
          iconColor="text-orange-400"
        />
        <StatCard
          title="Active Jobs"
          value={activeJobs}
          subtitle="Pending + In Progress"
          icon={Wrench}
          borderColor="border-l-yellow-400"
          iconColor="text-yellow-400"
        />
        <StatCard
          title="Completed Jobs"
          value={completedJobs}
          icon={Wrench}
          borderColor="border-l-green-400"
          iconColor="text-green-400"
        />
      </div>

      {/* Table header */}
      <div className="flex items-center justify-between">
        <p className="text-gray-400 text-sm">
          <span className="text-white font-medium">{repairs.length}</span> repair job{repairs.length !== 1 ? 's' : ''}
        </p>
        {canManageRepairs && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-cyan-500/20"
          >
            <Plus size={16} />
            Add Repair Job
          </button>
        )}
      </div>

      {/* Table */}
      {repairs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Wrench size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400">No repair jobs yet</p>
        </div>
      ) : (
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-[#1a2a4a] bg-[#111d35]">
                  <th className="text-left px-5 py-3 font-medium">Car</th>
                  <th className="text-left px-5 py-3 font-medium">Type of Repair</th>
                  <th className="text-left px-5 py-3 font-medium">Location</th>
                  <th className="text-right px-5 py-3 font-medium">Parts Cost</th>
                  <th className="text-right px-5 py-3 font-medium">Labour</th>
                  <th className="text-right px-5 py-3 font-medium">Total</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-left px-5 py-3 font-medium">Date</th>
                  {canManageRepairs && <th className="text-left px-5 py-3 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {repairs.map((r, i) => {
                  const car = getCar(r.carId);
                  const partsSum = r.parts.reduce((s, p) => s + p.cost, 0);
                  return (
                    <tr key={r.id} className={`border-b border-[#1a2a4a]/50 hover:bg-[#111d35] transition-colors ${i % 2 === 0 ? 'bg-[#0d1526]' : 'bg-[#0a0f1e]/50'}`}>
                      <td className="px-5 py-3">
                        {car ? (
                          <div>
                            <p className="text-white font-medium">{car.make} {car.model}</p>
                            <p className="text-gray-500 text-xs">{car.year}</p>
                          </div>
                        ) : (
                          <span className="text-gray-500">Unknown</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-300">{r.typeOfRepair}</td>
                      <td className="px-5 py-3">
                        {r.location ? (
                          <div className="flex items-center gap-1 text-gray-400">
                            <MapPin size={12} className="text-gray-500 flex-shrink-0" />
                            <span className="text-xs">{r.location}</span>
                          </div>
                        ) : (
                          <span className="text-gray-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-right">{formatRM(partsSum)}</td>
                      <td className="px-5 py-3 text-gray-400 text-right">{formatRM(r.labourCost)}</td>
                      <td className="px-5 py-3 text-orange-400 font-semibold text-right">{formatRM(r.totalCost)}</td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${REPAIR_STATUS_BADGE[r.status]}`}>
                          {REPAIR_STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {new Date(r.createdAt).toLocaleDateString('en-MY')}
                      </td>
                      {canManageRepairs && (
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEdit(r)} className="p-1.5 text-gray-400 hover:text-cyan-400 hover:bg-[#1a2a4a] rounded-lg transition-colors">
                              <Edit size={14} />
                            </button>
                            {isDirector && (
                              <button onClick={() => { if (window.confirm('Delete this repair job?')) deleteRepair(r.id); }} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditTarget(null); }} title={editTarget ? 'Edit Repair Job' : 'Add Repair Job'} maxWidth="max-w-xl">
        <div className="space-y-4">
          <FormField label="Car" error={errors.carId}>
            <select className={inputCls(errors.carId)} value={form.carId} onChange={(e) => setForm({ ...form, carId: e.target.value })}>
              <option value="">Select a car...</option>
              {cars.map((c) => <option key={c.id} value={c.id}>{c.year} {c.make} {c.model}</option>)}
            </select>
          </FormField>

          <FormField label="Type of Repair" error={errors.typeOfRepair}>
            <input className={inputCls(errors.typeOfRepair)} value={form.typeOfRepair} onChange={(e) => setForm({ ...form, typeOfRepair: e.target.value })} placeholder="e.g. Brake pad replacement" />
          </FormField>

          <FormField label="Location (garage / workshop)">
            <input className={inputCls()} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Kai Fa Auto Spray Garage" />
          </FormField>

          <div>
            <label className="block text-gray-300 text-xs font-medium mb-2">Parts</label>
            <div className="space-y-2">
              {form.parts.map((part, i) => (
                <div key={i} className="flex gap-2">
                  <input className={`flex-1 ${inputCls()}`} placeholder="Part name" value={part.name} onChange={(e) => updatePart(i, 'name', e.target.value)} />
                  <input type="number" className="w-28 bg-[#111d35] border border-[#1a2a4a] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500" placeholder="RM" value={part.cost} onChange={(e) => updatePart(i, 'cost', Number(e.target.value))} />
                  {form.parts.length > 1 && (
                    <button onClick={() => removePart(i)} className="text-red-400 hover:text-red-300 px-1 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addPartRow} className="text-cyan-400 text-xs mt-2 flex items-center gap-1 hover:text-cyan-300 transition-colors">
              <Plus size={13} /> Add part
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Labour Cost (RM)" error={errors.labourCost}>
              <input type="number" className={inputCls(errors.labourCost)} value={form.labourCost} onChange={(e) => setForm({ ...form, labourCost: Number(e.target.value) })} />
            </FormField>
            <FormField label="Status">
              <select className={inputCls()} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RepairJob['status'] })}>
                <option value="queued">Pending (Queued)</option>
                <option value="pending">Sent Out</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Collected</option>
              </select>
            </FormField>
          </div>

          <FormField label="Notes">
            <textarea className={`${inputCls()} h-20 resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </FormField>

          <div className="bg-[#111d35] rounded-lg p-3 border border-[#1a2a4a] space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>Parts Total</span><span>{formatRM(partsTotal)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>Labour</span><span>{formatRM(form.labourCost)}</span>
            </div>
            <div className="flex justify-between font-bold text-sm pt-1 border-t border-[#1a2a4a]">
              <span className="text-gray-300">Total</span>
              <span className="text-orange-400">{formatRM(computedTotal)}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={() => { setShowModal(false); setEditTarget(null); }} className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleSubmit} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            {editTarget ? 'Save Changes' : 'Add Repair Job'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
