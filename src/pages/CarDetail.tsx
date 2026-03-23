import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Car as CarIcon,
  Edit,
  Wrench,
  Plus,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { useStore } from '../store';
import { Car, RepairJob } from '../types';
import Modal from '../components/Modal';
import { formatRM, formatMileage, generateId } from '../utils/format';

const CONDITION_BADGE: Record<string, string> = {
  excellent: 'bg-green-500/20 text-green-400 border border-green-500/30',
  good: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  fair: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  poor: 'bg-red-500/20 text-red-400 border border-red-500/30',
};

const STATUS_BADGE: Record<string, string> = {
  available: 'bg-green-500/20 text-green-400',
  reserved: 'bg-yellow-500/20 text-yellow-400',
  sold: 'bg-gray-500/20 text-gray-400',
};

const REPAIR_STATUS_BADGE: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  done: 'bg-green-500/20 text-green-400',
};

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

export default function CarDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const cars = useStore((s) => s.cars);
  const users = useStore((s) => s.users);
  const repairs = useStore((s) => s.repairs);
  const currentUser = useStore((s) => s.currentUser);
  const updateCar = useStore((s) => s.updateCar);
  const addRepair = useStore((s) => s.addRepair);
  const deleteRepair = useStore((s) => s.deleteRepair);

  const car = cars.find((c) => c.id === id);
  const isDirector = currentUser?.role === 'director';
  const salespeople = users.filter((u) => u.role === 'salesperson');
  const carRepairs = repairs.filter((r) => r.carId === id);
  const totalRepairCost = carRepairs.reduce((sum, r) => sum + r.totalCost, 0);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showRepairModal, setShowRepairModal] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Car>>({});
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  const [repairForm, setRepairForm] = useState({
    typeOfRepair: '',
    parts: [{ name: '', cost: 0 }],
    labourCost: 0,
    status: 'pending' as RepairJob['status'],
    notes: '',
  });
  const [repairErrors, setRepairErrors] = useState<Record<string, string>>({});

  if (!car) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <CarIcon size={40} className="text-gray-600 mb-3" />
        <p className="text-gray-400">Car not found</p>
        <button onClick={() => navigate('/inventory')} className="text-cyan-400 text-sm mt-3 hover:underline">
          Back to Inventory
        </button>
      </div>
    );
  }

  const assignedSalesperson = car.assignedSalesperson
    ? users.find((u) => u.id === car.assignedSalesperson)
    : null;

  const netProfit = car.sellingPrice - car.purchasePrice - totalRepairCost;

  const openEdit = () => {
    setEditForm({ ...car });
    setEditErrors({});
    setShowEditModal(true);
  };

  const validateEdit = () => {
    const e: Record<string, string> = {};
    if (!editForm.make?.trim()) e.make = 'Required';
    if (!editForm.model?.trim()) e.model = 'Required';
    if (!editForm.colour?.trim()) e.colour = 'Required';
    if (!editForm.sellingPrice || editForm.sellingPrice <= 0) e.sellingPrice = 'Required';
    if (!editForm.purchasePrice || editForm.purchasePrice <= 0) e.purchasePrice = 'Required';
    setEditErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleEditSubmit = () => {
    if (!validateEdit()) return;
    updateCar(car.id, editForm);
    setShowEditModal(false);
  };

  const validateRepair = () => {
    const e: Record<string, string> = {};
    if (!repairForm.typeOfRepair.trim()) e.typeOfRepair = 'Required';
    if (repairForm.labourCost < 0) e.labourCost = 'Must be 0 or more';
    setRepairErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRepairSubmit = () => {
    if (!validateRepair()) return;
    const validParts = repairForm.parts.filter((p) => p.name.trim());
    const partsTotal = validParts.reduce((sum, p) => sum + p.cost, 0);
    const total = partsTotal + repairForm.labourCost;
    const newRepair: RepairJob = {
      id: generateId(),
      carId: car.id,
      typeOfRepair: repairForm.typeOfRepair,
      parts: validParts,
      labourCost: repairForm.labourCost,
      totalCost: total,
      status: repairForm.status,
      notes: repairForm.notes,
      createdAt: new Date().toISOString(),
    };
    addRepair(newRepair);
    setShowRepairModal(false);
    setRepairForm({ typeOfRepair: '', parts: [{ name: '', cost: 0 }], labourCost: 0, status: 'pending', notes: '' });
    setRepairErrors({});
  };

  const addPartRow = () => {
    setRepairForm({ ...repairForm, parts: [...repairForm.parts, { name: '', cost: 0 }] });
  };

  const updatePart = (idx: number, field: 'name' | 'cost', val: string | number) => {
    const parts = [...repairForm.parts];
    parts[idx] = { ...parts[idx], [field]: val };
    setRepairForm({ ...repairForm, parts });
  };

  const removePart = (idx: number) => {
    setRepairForm({ ...repairForm, parts: repairForm.parts.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/inventory')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft size={16} />
          Back to Inventory
        </button>
        {isDirector && (
          <div className="flex gap-3">
            <button
              onClick={() => { setShowRepairModal(true); setRepairErrors({}); }}
              className="flex items-center gap-2 bg-[#111d35] hover:bg-[#1a2a4a] border border-[#1a2a4a] text-gray-300 hover:text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              <Plus size={15} />
              Add Repair
            </button>
            <button
              onClick={openEdit}
              className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Edit size={15} />
              Edit Car
            </button>
          </div>
        )}
      </div>

      {/* Main info */}
      <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl overflow-hidden">
        <div className="flex flex-col md:flex-row">
          {/* Photo */}
          <div className="w-full md:w-72 h-52 md:h-auto bg-[#111d35] flex items-center justify-center flex-shrink-0">
            {car.photo ? (
              <img src={car.photo} alt={`${car.make} ${car.model}`} className="w-full h-full object-cover" />
            ) : (
              <CarIcon size={56} className="text-gray-700" />
            )}
          </div>

          <div className="flex-1 p-6">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <h1 className="text-2xl font-bold text-white">
                  {car.year} {car.make} {car.model}
                </h1>
                <p className="text-gray-400 mt-1">{car.colour} · {car.transmission === 'auto' ? 'Automatic' : 'Manual'}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_BADGE[car.status]}`}>
                  {car.status}
                </span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${CONDITION_BADGE[car.condition]}`}>
                  {car.condition}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
              <InfoItem label="Mileage" value={formatMileage(car.mileage)} />
              <InfoItem label="Year" value={String(car.year)} />
              <InfoItem label="Transmission" value={car.transmission === 'auto' ? 'Automatic' : 'Manual'} />
              <InfoItem label="Date Added" value={car.dateAdded} />
              <InfoItem label="Selling Price" value={formatRM(car.sellingPrice)} valueClass="text-cyan-400 font-bold" />
              {isDirector && (
                <>
                  <InfoItem label="Purchase Price" value={formatRM(car.purchasePrice)} />
                  <InfoItem label="Repair Costs" value={formatRM(totalRepairCost)} valueClass="text-orange-400" />
                  <InfoItem label="Net Profit" value={formatRM(netProfit)} valueClass={netProfit >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'} />
                </>
              )}
              <InfoItem
                label="Assigned Salesperson"
                value={assignedSalesperson?.name ?? 'Unassigned'}
              />
            </div>

            {car.notes && (
              <div className="mt-4 p-3 bg-[#111d35] rounded-lg border border-[#1a2a4a]">
                <p className="text-gray-500 text-xs font-medium mb-1">Notes</p>
                <p className="text-gray-300 text-sm">{car.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Repair History */}
      <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl">
        <div className="flex items-center justify-between p-5 border-b border-[#1a2a4a]">
          <div className="flex items-center gap-2">
            <Wrench size={18} className="text-orange-400" />
            <h3 className="text-white font-semibold">Repair History</h3>
            <span className="bg-[#111d35] text-gray-400 text-xs px-2 py-0.5 rounded-full">{carRepairs.length}</span>
          </div>
          {isDirector && carRepairs.length > 0 && (
            <p className="text-sm text-gray-400">
              Total: <span className="text-orange-400 font-semibold">{formatRM(totalRepairCost)}</span>
            </p>
          )}
        </div>

        {carRepairs.length === 0 ? (
          <div className="text-center py-10 text-gray-600 text-sm">
            No repair jobs recorded
          </div>
        ) : (
          <div className="divide-y divide-[#1a2a4a]/50">
            {carRepairs.map((r, i) => {
              const partsTotal = r.parts.reduce((sum, p) => sum + p.cost, 0);
              return (
                <div key={r.id} className={`p-5 ${i % 2 === 0 ? 'bg-[#0d1526]' : 'bg-[#0a0f1e]/30'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-white font-medium">{r.typeOfRepair}</h4>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${REPAIR_STATUS_BADGE[r.status]}`}>
                          {r.status.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-gray-500 text-xs mt-1">
                        {new Date(r.createdAt).toLocaleDateString('en-MY')}
                      </p>

                      {r.parts.length > 0 && (
                        <div className="mt-3 space-y-1">
                          <p className="text-gray-500 text-xs font-medium">Parts:</p>
                          {r.parts.map((part, pi) => (
                            <div key={pi} className="flex justify-between text-xs">
                              <span className="text-gray-400">{part.name}</span>
                              {isDirector && <span className="text-gray-400">{formatRM(part.cost)}</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {r.notes && (
                        <p className="text-gray-500 text-xs mt-2 italic">{r.notes}</p>
                      )}
                    </div>

                    {isDirector && (
                      <div className="text-right ml-4 flex flex-col items-end gap-1">
                        <div className="text-xs text-gray-500">Parts: {formatRM(partsTotal)}</div>
                        <div className="text-xs text-gray-500">Labour: {formatRM(r.labourCost)}</div>
                        <div className="text-orange-400 font-bold text-sm">{formatRM(r.totalCost)}</div>
                        <button
                          onClick={() => deleteRepair(r.id)}
                          className="text-red-400 hover:text-red-300 transition-colors mt-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Car Modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Car" maxWidth="max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Make" error={editErrors.make}>
            <input className={inputCls(editErrors.make)} value={editForm.make ?? ''} onChange={(e) => setEditForm({ ...editForm, make: e.target.value })} />
          </FormField>
          <FormField label="Model" error={editErrors.model}>
            <input className={inputCls(editErrors.model)} value={editForm.model ?? ''} onChange={(e) => setEditForm({ ...editForm, model: e.target.value })} />
          </FormField>
          <FormField label="Year">
            <input type="number" className={inputCls()} value={editForm.year ?? ''} onChange={(e) => setEditForm({ ...editForm, year: Number(e.target.value) })} />
          </FormField>
          <FormField label="Colour" error={editErrors.colour}>
            <input className={inputCls(editErrors.colour)} value={editForm.colour ?? ''} onChange={(e) => setEditForm({ ...editForm, colour: e.target.value })} />
          </FormField>
          <FormField label="Mileage (km)">
            <input type="number" className={inputCls()} value={editForm.mileage ?? ''} onChange={(e) => setEditForm({ ...editForm, mileage: Number(e.target.value) })} />
          </FormField>
          <FormField label="Condition">
            <select className={inputCls()} value={editForm.condition ?? 'good'} onChange={(e) => setEditForm({ ...editForm, condition: e.target.value as Car['condition'] })}>
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
            </select>
          </FormField>
          <FormField label="Purchase Price (RM)" error={editErrors.purchasePrice}>
            <input type="number" className={inputCls(editErrors.purchasePrice)} value={editForm.purchasePrice ?? ''} onChange={(e) => setEditForm({ ...editForm, purchasePrice: Number(e.target.value) })} />
          </FormField>
          <FormField label="Selling Price (RM)" error={editErrors.sellingPrice}>
            <input type="number" className={inputCls(editErrors.sellingPrice)} value={editForm.sellingPrice ?? ''} onChange={(e) => setEditForm({ ...editForm, sellingPrice: Number(e.target.value) })} />
          </FormField>
          <FormField label="Transmission">
            <select className={inputCls()} value={editForm.transmission ?? 'auto'} onChange={(e) => setEditForm({ ...editForm, transmission: e.target.value as Car['transmission'] })}>
              <option value="auto">Automatic</option>
              <option value="manual">Manual</option>
            </select>
          </FormField>
          <FormField label="Status">
            <select className={inputCls()} value={editForm.status ?? 'available'} onChange={(e) => setEditForm({ ...editForm, status: e.target.value as Car['status'] })}>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
              <option value="sold">Sold</option>
            </select>
          </FormField>
          <FormField label="Assigned Salesperson" className="col-span-2">
            <select className={inputCls()} value={editForm.assignedSalesperson ?? ''} onChange={(e) => setEditForm({ ...editForm, assignedSalesperson: e.target.value })}>
              <option value="">Unassigned</option>
              {salespeople.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          </FormField>
          <FormField label="Notes" className="col-span-2">
            <textarea className={`${inputCls()} h-20 resize-none`} value={editForm.notes ?? ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
          </FormField>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={() => setShowEditModal(false)} className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleEditSubmit} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">Save Changes</button>
        </div>
      </Modal>

      {/* Add Repair Modal */}
      <Modal isOpen={showRepairModal} onClose={() => setShowRepairModal(false)} title="Add Repair Job" maxWidth="max-w-xl">
        <div className="space-y-4">
          <FormField label="Type of Repair" error={repairErrors.typeOfRepair}>
            <input className={inputCls(repairErrors.typeOfRepair)} value={repairForm.typeOfRepair} onChange={(e) => setRepairForm({ ...repairForm, typeOfRepair: e.target.value })} placeholder="e.g. Brake pad replacement" />
          </FormField>

          <div>
            <label className="block text-gray-300 text-xs font-medium mb-2">Parts</label>
            <div className="space-y-2">
              {repairForm.parts.map((part, i) => (
                <div key={i} className="flex gap-2">
                  <input className={`flex-1 ${inputCls()}`} placeholder="Part name" value={part.name} onChange={(e) => updatePart(i, 'name', e.target.value)} />
                  <input type="number" className="w-28" style={{ background: '#111d35', border: '1px solid #1a2a4a', color: 'white', borderRadius: '0.5rem', padding: '0.5rem 0.75rem', fontSize: '0.875rem', outline: 'none' }} placeholder="Cost (RM)" value={part.cost} onChange={(e) => updatePart(i, 'cost', Number(e.target.value))} />
                  {repairForm.parts.length > 1 && (
                    <button onClick={() => removePart(i)} className="text-red-400 hover:text-red-300 transition-colors px-1">
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

          <FormField label="Labour Cost (RM)" error={repairErrors.labourCost}>
            <input type="number" className={inputCls(repairErrors.labourCost)} value={repairForm.labourCost} onChange={(e) => setRepairForm({ ...repairForm, labourCost: Number(e.target.value) })} />
          </FormField>

          <FormField label="Status">
            <select className={inputCls()} value={repairForm.status} onChange={(e) => setRepairForm({ ...repairForm, status: e.target.value as RepairJob['status'] })}>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
            </select>
          </FormField>

          <FormField label="Notes">
            <textarea className={`${inputCls()} h-20 resize-none`} value={repairForm.notes} onChange={(e) => setRepairForm({ ...repairForm, notes: e.target.value })} placeholder="Additional notes..." />
          </FormField>

          <div className="bg-[#111d35] rounded-lg p-3 border border-[#1a2a4a]">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Parts Total</span>
              <span className="text-white">{formatRM(repairForm.parts.reduce((s, p) => s + p.cost, 0))}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-400">Labour Cost</span>
              <span className="text-white">{formatRM(repairForm.labourCost)}</span>
            </div>
            <div className="flex justify-between font-bold mt-2 pt-2 border-t border-[#1a2a4a]">
              <span className="text-gray-300">Total Cost</span>
              <span className="text-orange-400">{formatRM(repairForm.parts.reduce((s, p) => s + p.cost, 0) + repairForm.labourCost)}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowRepairModal(false)} className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleRepairSubmit} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">Add Repair Job</button>
        </div>
      </Modal>
    </div>
  );
}

function InfoItem({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="text-gray-500 text-xs font-medium">{label}</p>
      <p className={`text-sm mt-0.5 ${valueClass ?? 'text-gray-200'}`}>{value}</p>
    </div>
  );
}
