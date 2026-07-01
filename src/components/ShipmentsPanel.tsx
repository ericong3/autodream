import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Ship, Plus, Pencil, Trash2, ChevronRight, X, Search, Check, Car as CarIcon } from 'lucide-react';
import { Car, Customer, Shipment, User } from '../types';
import { formatRM, generateId } from '../utils/format';
import { useStore } from '../store';

interface Props {
  cars: Car[];
  customers: Customer[];
  shipments: Shipment[];
  users: User[];
  isDirector: boolean;
  isDirectorView: boolean;
  inventoryTab: string;
  onNavigate: (carId: string) => void;
}

const EMPTY_FORM = {
  vesselName: '', shippingLine: '', originPort: 'Port Klang',
  destinationPort: 'Port Kuching', etd: '', eta: '',
  freightCost: '', paymentStatus: 'unpaid' as 'unpaid' | 'paid', notes: '',
};

export default function ShipmentsPanel({ cars, customers, shipments, isDirector, isDirectorView, onNavigate }: Props) {
  const addShipment    = useStore(s => s.addShipment);
  const updateShipment = useStore(s => s.updateShipment);
  const deleteShipment = useStore(s => s.deleteShipment);
  const updateCar      = useStore(s => s.updateCar);

  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [shipModal, setShipModal]     = useState<{ mode: 'add' | 'edit'; shipment?: Shipment } | null>(null);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [assignModal, setAssignModal] = useState<Shipment | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignSelected, setAssignSelected] = useState<Set<string>>(new Set());
  const [deleteId, setDeleteId]       = useState<string | null>(null);

  const openModal = (mode: 'add' | 'edit', s?: Shipment) => {
    setForm(mode === 'add' ? EMPTY_FORM : {
      vesselName: s!.vesselName, shippingLine: s!.shippingLine ?? '',
      originPort: s!.originPort, destinationPort: s!.destinationPort,
      etd: s!.etd, eta: s!.eta, freightCost: s!.freightCost?.toString() ?? '',
      paymentStatus: s!.paymentStatus, notes: s!.notes ?? '',
    });
    setShipModal({ mode, shipment: s });
  };

  const saveShipment = async () => {
    if (!form.vesselName.trim() || !form.etd || !form.eta) return;
    const base = {
      vesselName: form.vesselName.trim(),
      shippingLine: form.shippingLine.trim() || undefined,
      originPort: form.originPort.trim(),
      destinationPort: form.destinationPort.trim(),
      etd: form.etd, eta: form.eta,
      freightCost: form.freightCost ? parseFloat(form.freightCost) : undefined,
      paymentStatus: form.paymentStatus,
      notes: form.notes.trim() || undefined,
    };
    if (shipModal?.mode === 'add') {
      await addShipment({ ...base, id: generateId(), createdAt: new Date().toISOString() });
    } else if (shipModal?.shipment) {
      await updateShipment(shipModal.shipment.id, base);
    }
    setShipModal(null);
  };

  const openAssign = (ship: Shipment) => {
    setAssignModal(ship);
    setAssignSearch('');
    setAssignSelected(new Set(cars.filter(c => c.shipmentId === ship.id).map(c => c.id)));
  };

  const saveAssign = async () => {
    if (!assignModal) return;
    const eligible = cars.filter(c => c.status === 'coming_soon' || c.shipmentId === assignModal.id);
    const originalIds = new Set(eligible.filter(c => c.shipmentId === assignModal.id).map(c => c.id));
    const toAdd    = [...assignSelected].filter(id => !originalIds.has(id));
    const toRemove = [...originalIds].filter(id => !assignSelected.has(id));
    await Promise.all([
      ...toAdd.map(id => updateCar(id, { shipmentId: assignModal.id })),
      ...toRemove.map(id => updateCar(id, { shipmentId: undefined })),
    ]);
    setAssignModal(null);
    setAssignSearch('');
  };

  return (
    <div className="space-y-3">
      {isDirector && (
        <div className="flex justify-end">
          <button onClick={() => openModal('add')} className="flex items-center gap-1.5 btn-gold px-4 py-2 rounded-lg text-sm">
            <Plus size={15} />New Shipment
          </button>
        </div>
      )}

      {shipments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Ship size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400 font-medium">No shipments yet</p>
          <p className="text-gray-500 text-sm mt-1">Create a shipment to track vessels and assign cars</p>
        </div>
      ) : shipments.map(ship => {
        const shipCars   = cars.filter(c => c.shipmentId === ship.id);
        const isExpanded = expandedId === ship.id;
        const etdDate    = new Date(ship.etd);
        const etaDate    = new Date(ship.eta);
        const now        = new Date();
        const isArrived  = etaDate < now;
        const daysToEta  = Math.ceil((etaDate.getTime() - now.getTime()) / 86400000);

        return (
          <div key={ship.id} className="rounded-xl border border-obsidian-400/50 overflow-hidden">
            <div
              className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : ship.id)}
            >
              <div className="shrink-0 w-9 h-9 rounded-full bg-sky-500/15 flex items-center justify-center mt-0.5">
                <Ship size={16} className="text-sky-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-white font-semibold text-sm">{ship.vesselName}</p>
                  {ship.shippingLine && <span className="text-gray-500 text-xs">{ship.shippingLine}</span>}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ship.paymentStatus === 'paid' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30'}`}>
                    {ship.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
                  </span>
                  {isArrived
                    ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">Arrived</span>
                    : daysToEta <= 3
                    ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">{daysToEta}d to arrival</span>
                    : null}
                </div>
                <p className="text-gray-500 text-xs mt-0.5">{ship.originPort} → {ship.destinationPort}</p>
                <div className="flex items-center gap-4 mt-1 text-xs text-gray-600">
                  <span>ETD {etdDate.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}</span>
                  <span>ETA {etaDate.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}</span>
                  <span className="text-sky-500">{shipCars.length} car{shipCars.length !== 1 ? 's' : ''}</span>
                  {isDirectorView && ship.freightCost && <span className="text-amber-500/80">{formatRM(ship.freightCost)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                {isDirector && (
                  <>
                    <button onClick={() => openModal('edit', ship)} className="p-1.5 text-gray-600 hover:text-sky-400 hover:bg-sky-500/10 rounded-lg transition-colors"><Pencil size={13} /></button>
                    <button onClick={() => setDeleteId(ship.id)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 size={13} /></button>
                  </>
                )}
                <ChevronRight size={15} className={`text-gray-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-obsidian-400/30">
                {isDirector && (
                  <div className="px-4 py-2 flex justify-end border-b border-obsidian-400/20">
                    <button onClick={() => openAssign(ship)} className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 transition-colors">
                      <Plus size={12} />Manage Cars
                    </button>
                  </div>
                )}
                {shipCars.length === 0 ? (
                  <div className="px-4 py-4 text-center text-gray-600 text-sm">No cars assigned</div>
                ) : shipCars.map(car => {
                  const buyer    = customers.find(c => c.interestedCarId === car.id && (c.loanWorkOrder || c.cashWorkOrder));
                  const isBooked = !!buyer;
                  return (
                    <div
                      key={car.id}
                      className="flex items-center gap-3 px-4 py-2.5 border-b border-obsidian-400/20 last:border-b-0 hover:bg-white/[0.02] cursor-pointer transition-colors"
                      onClick={() => onNavigate(car.id)}
                    >
                      <div className="w-10 h-7 bg-obsidian-700/60 rounded flex-shrink-0 flex items-center justify-center overflow-hidden">
                        {car.photo ? <img src={car.photo} alt="" className="w-full h-full object-cover" /> : <CarIcon size={12} className="text-gray-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-medium">{car.year} {car.make} {car.model}</p>
                        <p className="text-gray-500 text-[11px]">{car.colour} · {car.carPlate ?? '—'}</p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${isBooked ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-obsidian-600/60 text-gray-500 border-obsidian-400/40'}`}>
                        {isBooked ? 'Booked' : 'Available'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Create / Edit modal ── */}
      {shipModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShipModal(null)}>
          <div className="bg-obsidian-800 border border-obsidian-400/60 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold">{shipModal.mode === 'add' ? 'New Shipment' : 'Edit Shipment'}</h3>
              <button onClick={() => setShipModal(null)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Vessel Name *</label>
                <input className="input w-full" placeholder="e.g. MV Kinabalu Express" value={form.vesselName} onChange={e => setForm(f => ({ ...f, vesselName: e.target.value }))} />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Shipping Line</label>
                <input className="input w-full" placeholder="e.g. MISC, Haulage" value={form.shippingLine} onChange={e => setForm(f => ({ ...f, shippingLine: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Origin Port *</label>
                  <input className="input w-full" value={form.originPort} onChange={e => setForm(f => ({ ...f, originPort: e.target.value }))} />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Destination Port *</label>
                  <input className="input w-full" value={form.destinationPort} onChange={e => setForm(f => ({ ...f, destinationPort: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">ETD *</label>
                  <input type="date" className="input w-full" value={form.etd} onChange={e => setForm(f => ({ ...f, etd: e.target.value }))} />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">ETA *</label>
                  <input type="date" className="input w-full" value={form.eta} onChange={e => setForm(f => ({ ...f, eta: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Freight Cost (RM)</label>
                <input type="number" className="input w-full" placeholder="0" value={form.freightCost} onChange={e => setForm(f => ({ ...f, freightCost: e.target.value }))} />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Payment Status</label>
                <div className="flex gap-2">
                  {(['unpaid', 'paid'] as const).map(s => (
                    <button key={s} onClick={() => setForm(f => ({ ...f, paymentStatus: s }))} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${form.paymentStatus === s ? s === 'paid' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-obsidian-700/60 text-gray-500 border border-obsidian-400/40'}`}>
                      {s === 'paid' ? 'Paid' : 'Unpaid'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Notes</label>
                <textarea className="input w-full resize-none" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShipModal(null)} className="flex-1 py-2.5 rounded-xl border border-obsidian-400/60 text-gray-400 text-sm">Cancel</button>
              <button onClick={saveShipment} disabled={!form.vesselName.trim() || !form.etd || !form.eta} className="flex-1 py-2.5 rounded-xl btn-gold text-sm font-semibold disabled:opacity-40">
                {shipModal.mode === 'add' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Manage Cars modal ── */}
      {assignModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={() => setAssignModal(null)}>
          <div className="bg-obsidian-800 border border-obsidian-400/60 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Manage Cars — {assignModal.vesselName}</h3>
              <button onClick={() => setAssignModal(null)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              <input type="text" placeholder="Search by make, model, plate..." value={assignSearch} onChange={e => setAssignSearch(e.target.value)} className="input w-full pl-9 pr-4 py-3 text-sm" autoFocus />
            </div>
            {(() => {
              const eligible = cars.filter(c => c.status === 'coming_soon' || c.shipmentId === assignModal.id);
              const filtered = eligible.filter(c => {
                const q = assignSearch.toLowerCase();
                return !q || `${c.year} ${c.make} ${c.model} ${c.variant ?? ''} ${c.carPlate ?? ''} ${c.colour}`.toLowerCase().includes(q);
              });
              const allVisible = filtered.length > 0 && filtered.every(c => assignSelected.has(c.id));
              return (
                <>
                  {filtered.length > 0 && (
                    <div className="flex items-center px-1 mb-2">
                      <button onClick={() => setAssignSelected(prev => { const next = new Set(prev); allVisible ? filtered.forEach(c => next.delete(c.id)) : filtered.forEach(c => next.add(c.id)); return next; })} className="text-xs text-sky-400 hover:text-sky-300 transition-colors">
                        {allVisible ? 'Deselect all' : 'Select all'}
                      </button>
                      <span className="text-gray-600 text-xs ml-auto">{filtered.length} car{filtered.length !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {filtered.map(car => {
                      const isSelected   = assignSelected.has(car.id);
                      const inOtherShip  = car.shipmentId && car.shipmentId !== assignModal.id;
                      const statusLabel  = car.status !== 'coming_soon' ? car.status.replace(/_/g, ' ') : null;
                      return (
                        <div key={car.id} onClick={() => setAssignSelected(prev => { const next = new Set(prev); isSelected ? next.delete(car.id) : next.add(car.id); return next; })} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${isSelected ? 'bg-sky-500/10 border-sky-500/40' : 'bg-obsidian-700/40 border-obsidian-400/30 hover:border-obsidian-400/60'}`}>
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-sky-500 border-sky-500' : 'border-gray-600'}`}>
                            {isSelected && <Check size={10} className="text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-xs font-medium">{car.year} {car.make} {car.model}</p>
                            <p className="text-gray-500 text-[11px]">
                              {car.colour}{car.carPlate ? ` · ${car.carPlate}` : ''}
                              {statusLabel && <span className="text-amber-400/80"> · {statusLabel}</span>}
                              {inOtherShip && <span className="text-orange-400/80"> · In other ship</span>}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {filtered.length === 0 && <p className="text-center text-gray-600 text-sm py-6">{assignSearch ? 'No cars match your search' : 'No cars available'}</p>}
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => { setAssignModal(null); setAssignSearch(''); }} className="flex-1 py-2.5 rounded-xl border border-obsidian-400/60 text-gray-400 text-sm">Cancel</button>
                    <button onClick={saveAssign} className="flex-1 py-2.5 rounded-xl btn-gold text-sm font-semibold">
                      Save{assignSelected.size > 0 ? ` (${assignSelected.size})` : ''}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>,
        document.body
      )}

      {/* ── Delete confirm ── */}
      {deleteId && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteId(null)}>
          <div className="bg-obsidian-800 border border-obsidian-400/60 rounded-2xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <p className="text-white font-semibold">Delete Shipment?</p>
            <p className="text-gray-400 text-sm">Cars assigned to this shipment will be unlinked.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 rounded-xl border border-obsidian-400/60 text-gray-400 text-sm">Cancel</button>
              <button onClick={async () => { await deleteShipment(deleteId); setDeleteId(null); }} className="flex-1 py-2.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 text-sm font-semibold">Delete</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
