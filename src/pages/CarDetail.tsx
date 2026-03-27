import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Car as CarIcon,
  Edit,
  Wrench,
  Plus,
  Trash2,
  AlertCircle,
  MapPin,
  CheckSquare,
  Square,
  Camera,
  CreditCard,
  FileCheck,
  Truck,
  Upload,
  Check,
  X,
  Clock,
  ChevronLeft,
  ChevronRight,
  Download,
  Image,
} from 'lucide-react';
import { useStore } from '../store';
import { Car, RepairJob, ChecklistItem, LoanSubmission, FinalDeal, BANKS, REPAIR_TYPES, REPAIR_LOCATIONS, DEFAULT_CHECKLIST_LABELS } from '../types';
import Modal from '../components/Modal';
import { formatRM, formatMileage, generateId } from '../utils/format';

const CONDITION_BADGE: Record<string, string> = {
  excellent: 'bg-green-500/20 text-green-400 border border-green-500/30',
  good: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  fair: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  poor: 'bg-red-500/20 text-red-400 border border-red-500/30',
};

const STATUS_BADGE: Record<string, string> = {
  coming_soon: 'bg-purple-500/20 text-purple-400',
  in_workshop: 'bg-orange-500/20 text-orange-400',
  ready: 'bg-cyan-500/20 text-cyan-400',
  photo_complete: 'bg-blue-500/20 text-blue-400',
  submitted: 'bg-indigo-500/20 text-indigo-400',
  deal_pending: 'bg-yellow-500/20 text-yellow-400',
  available: 'bg-green-500/20 text-green-400',
  reserved: 'bg-yellow-500/20 text-yellow-400',
  sold: 'bg-gray-500/20 text-gray-400',
};

const STATUS_LABEL: Record<string, string> = {
  coming_soon: 'Coming Soon',
  in_workshop: 'In Workshop',
  ready: 'Ready',
  photo_complete: 'Photo Complete',
  submitted: 'Submitted',
  deal_pending: 'Deal Pending',
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
};

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

function SectionHeader({ icon: Icon, title, count, color = 'text-cyan-400' }: { icon: React.ElementType; title: string; count?: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 p-5 border-b border-[#1a2a4a]">
      <Icon size={18} className={color} />
      <h3 className="text-white font-semibold">{title}</h3>
      {count !== undefined && (
        <span className="bg-[#111d35] text-gray-400 text-xs px-2 py-0.5 rounded-full">{count}</span>
      )}
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
  const updateRepair = useStore((s) => s.updateRepair);
  const deleteRepair = useStore((s) => s.deleteRepair);

  const car = cars.find((c) => c.id === id);
  const isDirector = currentUser?.role === 'director';
  const isMechanic = currentUser?.role === 'mechanic';
  const isSalesperson = currentUser?.role === 'salesperson';
  const salespeople = users.filter((u) => u.role === 'salesperson');
  const carRepairs = repairs.filter((r) => r.carId === id);
  const totalRepairCost = carRepairs.reduce((sum, r) => sum + r.totalCost, 0);

  // ── Edit Car Modal ──
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Car>>({});
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // ── Add/Complete Repair Modal ──
  const [showRepairModal, setShowRepairModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [targetRepair, setTargetRepair] = useState<RepairJob | null>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const [repairForm, setRepairForm] = useState({
    typeOfRepair: '',
    location: '',
    parts: [{ name: '', cost: 0 }],
    labourCost: 0,
    notes: '',
  });
  const [repairErrors, setRepairErrors] = useState<Record<string, string>>({});
  const [completeForm, setCompleteForm] = useState({ actualCost: 0, receiptPhoto: '' });

  // ── Loan Submission Modal ──
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [loanBanks, setLoanBanks] = useState<string[]>([]);
  const [loanCustomerName, setLoanCustomerName] = useState('');
  const [loanCustomerPhone, setLoanCustomerPhone] = useState('');
  const [loanNotes, setLoanNotes] = useState('');
  const [loanErrors, setLoanErrors] = useState<Record<string, string>>({});

  const toggleLoanBank = (bank: string) =>
    setLoanBanks((prev) => prev.includes(bank) ? prev.filter((b) => b !== bank) : [...prev, bank]);

  // ── Loan Detail Modal ──
  const [showLoanDetailModal, setShowLoanDetailModal] = useState(false);
  const [loanDetailGroup, setLoanDetailGroup] = useState<LoanSubmission[]>([]);

  const openLoanDetail = (group: LoanSubmission[]) => {
    setLoanDetailGroup(group);
    setShowLoanDetailModal(true);
  };

  // ── Edit Loan Status Modal ──
  const [showLoanEditModal, setShowLoanEditModal] = useState(false);
  const [loanEditGroup, setLoanEditGroup] = useState<LoanSubmission[]>([]);
  const [loanEditStatuses, setLoanEditStatuses] = useState<Record<string, LoanSubmission['status']>>({});

  const openLoanEdit = (group: LoanSubmission[]) => {
    setLoanEditGroup(group);
    setLoanEditStatuses(Object.fromEntries(group.map((ls) => [ls.id, ls.status])));
    setShowLoanEditModal(true);
  };

  const handleLoanEditSave = () => {
    if (!car) return;
    const updated = loanSubmissions.map((ls) =>
      loanEditStatuses[ls.id] ? { ...ls, status: loanEditStatuses[ls.id] } : ls
    );
    setShowLoanEditModal(false);
    updateCar(car.id, { loanSubmissions: updated });
  };

  // ── Final Deal Modal ──
  const [showDealModal, setShowDealModal] = useState(false);
  const [dealForm, setDealForm] = useState<{ dealPrice: number; bank: string; notes: string }>({ dealPrice: 0, bank: BANKS[0], notes: '' });
  const [dealErrors, setDealErrors] = useState<Record<string, string>>({});

  // ── Delivery Modal ──
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryPhoto, setDeliveryPhoto] = useState('');
  const deliveryRef = useRef<HTMLInputElement>(null);

  // ── Photo Gallery ──
  const [showGallery, setShowGallery] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const allPhotos = car?.photos?.length ? car.photos : (car?.photo ? [car.photo] : []);

  const openGallery = (idx = 0) => { setGalleryIndex(idx); setShowGallery(true); };
  const galleryPrev = () => setGalleryIndex((i) => (i - 1 + allPhotos.length) % allPhotos.length);
  const galleryNext = () => setGalleryIndex((i) => (i + 1) % allPhotos.length);
  const downloadPhoto = (src: string, idx: number) => {
    const a = document.createElement('a');
    a.href = src;
    a.download = `${car?.make}-${car?.model}-${car?.year}-photo-${idx + 1}.jpg`;
    a.click();
  };

  useEffect(() => {
    if (!showGallery) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') galleryPrev();
      else if (e.key === 'ArrowRight') galleryNext();
      else if (e.key === 'Escape') setShowGallery(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showGallery, allPhotos.length]);

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

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

  const assignedSalesperson = car.assignedSalesperson ? users.find((u) => u.id === car.assignedSalesperson) : null;
  const netProfit = car.sellingPrice - car.purchasePrice - totalRepairCost;

  // Checklist helpers
  const checklist: ChecklistItem[] = car.checklistItems ?? DEFAULT_CHECKLIST_LABELS.map((label, i) => ({
    id: `cl-${i}`,
    label,
    checked: false,
  }));
  const allChecked = checklist.every((item) => item.checked);
  const hasActiveRepair = carRepairs.some((r) => r.status === 'pending' || r.status === 'in_progress');
  const hasSentOutRepair = hasActiveRepair;

  // Photo tracking helpers
  const photoTakenBy = car.photoTakenBy ?? [];
  const currentUserTookPhoto = photoTakenBy.includes(currentUser?.id ?? '');
  const allSalespeoplePhotosDone = salespeople.length > 0 && salespeople.every((sp) => photoTakenBy.includes(sp.id));

  // Loan submission helpers
  const loanSubmissions: LoanSubmission[] = car.loanSubmissions ?? [];
  const finalDeal: FinalDeal | undefined = car.finalDeal;

  // ── Edit Car ──
  const openEdit = () => {
    setEditForm({ ...car });
    setEditErrors({});
    setShowEditModal(true);
  };

  const handleEditSubmit = () => {
    const e: Record<string, string> = {};
    if (!editForm.make?.trim()) e.make = 'Required';
    if (!editForm.model?.trim()) e.model = 'Required';
    if (!editForm.colour?.trim()) e.colour = 'Required';
    if (!editForm.purchasePrice || editForm.purchasePrice <= 0) e.purchasePrice = 'Required';
    setEditErrors(e);
    if (Object.keys(e).length > 0) return;
    setShowEditModal(false);
    updateCar(car.id, editForm);
  };

  // ── Add Repair ──
  const openAddRepair = () => {
    setRepairForm({ typeOfRepair: '', location: '', parts: [{ name: '', cost: 0 }], labourCost: 0, notes: '' });
    setRepairErrors({});
    setShowRepairModal(true);
  };

  const handleRepairSubmit = () => {
    const e: Record<string, string> = {};
    if (!repairForm.typeOfRepair.trim()) e.typeOfRepair = 'Required';
    if (!repairForm.location.trim()) e.location = 'Location is required';
    setRepairErrors(e);
    if (Object.keys(e).length > 0) return;

    const validParts = repairForm.parts.filter((p) => p.name.trim());
    const partsTotal = validParts.reduce((sum, p) => sum + p.cost, 0);
    const total = partsTotal + repairForm.labourCost;
    const newRepair: RepairJob = {
      id: generateId(),
      carId: car.id,
      typeOfRepair: repairForm.typeOfRepair,
      location: repairForm.location,
      parts: validParts,
      labourCost: repairForm.labourCost,
      totalCost: total,
      status: hasActiveRepair ? 'queued' : 'pending',
      notes: repairForm.notes,
      createdAt: new Date().toISOString(),
    };
    setShowRepairModal(false);
    addRepair(newRepair);
  };

  const handleProceedRepair = (r: RepairJob) => {
    updateRepair(r.id, { status: 'pending' });
  };

  const addPartRow = () => setRepairForm({ ...repairForm, parts: [...repairForm.parts, { name: '', cost: 0 }] });
  const updatePart = (idx: number, field: 'name' | 'cost', val: string | number) => {
    const parts = [...repairForm.parts];
    parts[idx] = { ...parts[idx], [field]: val };
    setRepairForm({ ...repairForm, parts });
  };
  const removePart = (idx: number) => setRepairForm({ ...repairForm, parts: repairForm.parts.filter((_, i) => i !== idx) });

  // ── Complete Repair ──
  const openCompleteRepair = (r: RepairJob) => {
    setTargetRepair(r);
    setCompleteForm({ actualCost: r.totalCost, receiptPhoto: '' });
    setShowCompleteModal(true);
  };

  const handleCompleteRepair = () => {
    if (!targetRepair) return;
    setShowCompleteModal(false);
    setTargetRepair(null);
    updateRepair(targetRepair.id, {
      status: 'done',
      actualCost: completeForm.actualCost,
      receiptPhoto: completeForm.receiptPhoto || undefined,
      completedAt: new Date().toISOString(),
    });
  };

  // ── Checklist ──
  const toggleChecklistItem = (idx: number) => {
    const updated = checklist.map((item, i) =>
      i === idx
        ? { ...item, checked: !item.checked, checkedBy: currentUser?.id, checkedAt: new Date().toISOString() }
        : item
    );
    updateCar(car.id, { checklistItems: updated });
  };

  const markCarReady = () => {
    updateCar(car.id, { status: 'ready', currentLocation: 'Shop' });
  };

  // ── Photo Tracking ──
  const markPhotoDone = () => {
    const updated = [...photoTakenBy];
    if (!updated.includes(currentUser!.id)) updated.push(currentUser!.id);
    const newStatus = salespeople.every((sp) => updated.includes(sp.id)) ? 'photo_complete' : car.status;
    updateCar(car.id, { photoTakenBy: updated, status: newStatus as Car['status'] });
  };

  // ── Loan Submission ──
  const openLoanModal = () => {
    setLoanBanks([]);
    setLoanCustomerName('');
    setLoanCustomerPhone('');
    setLoanNotes('');
    setLoanErrors({});
    setShowLoanModal(true);
  };

  const handleLoanSubmit = () => {
    const e: Record<string, string> = {};
    if (loanBanks.length === 0) e.banks = 'Select at least one bank';
    if (!loanCustomerName.trim()) e.customerName = 'Required';
    if (!loanCustomerPhone.trim()) e.customerPhone = 'Required';
    setLoanErrors(e);
    if (Object.keys(e).length > 0) return;

    const now = new Date().toISOString();
    const newSubmissions: LoanSubmission[] = loanBanks.map((bank) => ({
      id: generateId(),
      bank,
      customerName: loanCustomerName.trim(),
      customerPhone: loanCustomerPhone.trim(),
      submittedBy: currentUser!.id,
      submittedAt: now,
      status: 'submitted',
      notes: loanNotes || undefined,
    }));
    const updated = [...loanSubmissions, ...newSubmissions];
    setShowLoanModal(false);
    setLoanNotes('');
    updateCar(car.id, { loanSubmissions: updated, status: 'submitted' });
  };

  // ── Final Deal ──
  const handleDealSubmit = () => {
    const e: Record<string, string> = {};
    if (!dealForm.dealPrice || dealForm.dealPrice <= 0) e.dealPrice = 'Required';
    setDealErrors(e);
    if (Object.keys(e).length > 0) return;

    const deal: FinalDeal = {
      submittedBy: currentUser!.id,
      submittedAt: new Date().toISOString(),
      dealPrice: dealForm.dealPrice,
      bank: dealForm.bank,
      notes: dealForm.notes || undefined,
      approvalStatus: 'pending',
    };
    setShowDealModal(false);
    updateCar(car.id, { finalDeal: deal, status: 'deal_pending' });
  };

  const handleDealApproval = (approved: boolean) => {
    if (!finalDeal) return;
    updateCar(car.id, {
      finalDeal: {
        ...finalDeal,
        approvedBy: currentUser!.id,
        approvedAt: new Date().toISOString(),
        approvalStatus: approved ? 'approved' : 'rejected',
      },
      status: approved ? 'sold' : 'submitted',
    });
  };

  // ── Delivery ──
  const handleDeliverySubmit = () => {
    setShowDeliveryModal(false);
    updateCar(car.id, {
      deliveryPhoto: deliveryPhoto || undefined,
      deliveryCollected: true,
    });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          onClick={() => navigate('/inventory')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft size={16} />
          Back to Inventory
        </button>
        <div className="flex gap-3 flex-wrap">
          {(isMechanic || isDirector) && (
            <button
              onClick={openAddRepair}
              className="flex items-center gap-2 bg-[#111d35] hover:bg-[#1a2a4a] border border-[#1a2a4a] text-gray-300 hover:text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              <Plus size={15} />
              Add Repair
            </button>
          )}
          {(isSalesperson || isDirector) && (
            <button
              onClick={openLoanModal}
              className="flex items-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 px-4 py-2 rounded-lg text-sm transition-colors"
            >
              <CreditCard size={15} />
              Add Loan Process
            </button>
          )}
          {isDirector && (
            <button
              onClick={openEdit}
              className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Edit size={15} />
              Edit Car
            </button>
          )}
        </div>
      </div>

      {/* Main info */}
      <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl overflow-hidden">
        <div className="flex flex-col md:flex-row">
          <div
            className={`w-full md:w-72 h-52 md:h-auto bg-[#111d35] flex items-center justify-center flex-shrink-0 relative group ${allPhotos.length > 0 ? 'cursor-pointer' : ''}`}
            onClick={() => allPhotos.length > 0 && openGallery(0)}
          >
            {car.photo ? (
              <img src={car.photo} alt={`${car.make} ${car.model}`} className="w-full h-full object-cover" />
            ) : (
              <CarIcon size={56} className="text-gray-700" />
            )}
            {allPhotos.length > 0 && (
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                <Image size={24} className="text-white" />
                <span className="text-white text-xs font-medium">{allPhotos.length} photo{allPhotos.length !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          <div className="flex-1 p-6">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <h1 className="text-2xl font-bold text-white">{car.year} {car.make} {car.model}</h1>
                <p className="text-gray-400 mt-1">{car.colour} · {car.transmission === 'auto' ? 'Automatic' : 'Manual'}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_BADGE[car.status] ?? 'bg-gray-500/20 text-gray-400'}`}>
                  {STATUS_LABEL[car.status] ?? car.status}
                </span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${CONDITION_BADGE[car.condition]}`}>
                  {car.condition}
                </span>
              </div>
            </div>

            {/* Current location banner */}
            {car.currentLocation && (
              <div className="mt-4 flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
                <MapPin size={14} className="text-orange-400 flex-shrink-0" />
                <span className="text-orange-300 text-sm">
                  Currently at: <span className="font-semibold">{car.currentLocation}</span>
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
              <InfoItem label="Mileage" value={formatMileage(car.mileage)} />
              <InfoItem label="Year" value={String(car.year)} />
              <InfoItem label="Transmission" value={car.transmission === 'auto' ? 'Automatic' : 'Manual'} />
              <InfoItem label="Date Added" value={car.dateAdded} />
              <InfoItem label="Selling Price" value={car.sellingPrice > 0 ? formatRM(car.sellingPrice) : 'TBD'} valueClass="text-cyan-400 font-bold" />
              {isDirector && (
                <>
                  <InfoItem label="Purchase Price" value={formatRM(car.purchasePrice)} />
                  <InfoItem label="Repair Costs" value={formatRM(totalRepairCost)} valueClass="text-orange-400" />
                  <InfoItem label="Net Profit" value={formatRM(netProfit)} valueClass={netProfit >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'} />
                </>
              )}
              <InfoItem label="Assigned Salesperson" value={assignedSalesperson?.name ?? 'Unassigned'} />
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

      {/* ── Repair History ── */}
      <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl">
        <SectionHeader icon={Wrench} title="Repair Jobs" count={carRepairs.length} color="text-orange-400" />
        {carRepairs.length === 0 ? (
          <div className="text-center py-10 text-gray-600 text-sm">No repair jobs recorded</div>
        ) : (
          <div className="divide-y divide-[#1a2a4a]/50">
            {carRepairs.map((r, i) => {
              const partsTotal = r.parts.reduce((sum, p) => sum + p.cost, 0);
              const isActive = r.status === 'pending' || r.status === 'in_progress';
              const isQueued = r.status === 'queued';
              return (
                <div key={r.id} className={`p-5 ${i % 2 === 0 ? 'bg-[#0d1526]' : 'bg-[#0a0f1e]/30'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-white font-medium">{r.typeOfRepair}</h4>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${REPAIR_STATUS_BADGE[r.status]}`}>
                          {REPAIR_STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </div>
                      {r.location && (
                        <div className="flex items-center gap-1 mt-1">
                          <MapPin size={12} className="text-gray-500" />
                          <p className="text-gray-500 text-xs">{r.location}</p>
                        </div>
                      )}
                      <p className="text-gray-600 text-xs mt-0.5">{new Date(r.createdAt).toLocaleDateString('en-MY')}</p>

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
                      {r.actualCost !== undefined && r.status === 'done' && (
                        <p className="text-xs text-green-400 mt-2">
                          Actual cost: <span className="font-semibold">{formatRM(r.actualCost)}</span>
                        </p>
                      )}
                      {r.completedAt && (
                        <p className="text-gray-600 text-xs mt-1">
                          Completed: {new Date(r.completedAt).toLocaleDateString('en-MY')}
                        </p>
                      )}
                      {r.receiptPhoto && (
                        <a href={r.receiptPhoto} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 hover:underline mt-1 inline-block">
                          View Receipt
                        </a>
                      )}
                      {r.notes && <p className="text-gray-500 text-xs mt-2 italic">{r.notes}</p>}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {isDirector && (
                        <div className="text-right">
                          <div className="text-xs text-gray-500">Parts: {formatRM(partsTotal)}</div>
                          <div className="text-xs text-gray-500">Labour: {formatRM(r.labourCost)}</div>
                          <div className="text-orange-400 font-bold text-sm">{formatRM(r.totalCost)}</div>
                        </div>
                      )}
                      {/* Proceed button for queued repairs */}
                      {isQueued && (isMechanic || isDirector) && (
                        <button
                          onClick={() => handleProceedRepair(r)}
                          disabled={hasSentOutRepair}
                          title={hasSentOutRepair ? 'Complete the current active job first' : 'Send this job out'}
                          className="flex items-center gap-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Check size={12} />
                          Proceed
                        </button>
                      )}
                      {/* Mark Done button for sent-out / in-progress repairs */}
                      {isActive && (isMechanic || isDirector) && (
                        <button
                          onClick={() => openCompleteRepair(r)}
                          className="flex items-center gap-1.5 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          <Check size={12} />
                          Mark Done
                        </button>
                      )}
                      {isDirector && (
                        <button
                          onClick={() => { if (window.confirm('Delete this repair job?')) deleteRepair(r.id); }}
                          className="text-red-400 hover:text-red-300 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {isDirector && carRepairs.length > 0 && (
          <div className="px-5 py-3 border-t border-[#1a2a4a] text-right">
            <p className="text-sm text-gray-400">
              Total Repair Cost: <span className="text-orange-400 font-semibold">{formatRM(totalRepairCost)}</span>
            </p>
          </div>
        )}
      </div>

      {/* ── Mechanic Checklist ── (visible to mechanic and director) */}
      {(isMechanic || isDirector) && (car.status === 'in_workshop' || car.status === 'ready') && (
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl">
          <SectionHeader icon={CheckSquare} title="Pre-Ready Checklist" color="text-cyan-400" />
          <div className="p-5 space-y-3">
            {checklist.map((item, i) => (
              <button
                key={item.id}
                onClick={() => (isMechanic || isDirector) ? toggleChecklistItem(i) : undefined}
                className="w-full flex items-center gap-3 group hover:bg-[#111d35] px-3 py-2 rounded-lg transition-colors text-left"
              >
                {item.checked ? (
                  <CheckSquare size={18} className="text-cyan-400 flex-shrink-0" />
                ) : (
                  <Square size={18} className="text-gray-600 flex-shrink-0 group-hover:text-gray-400 transition-colors" />
                )}
                <span className={`text-sm ${item.checked ? 'text-gray-400 line-through' : 'text-gray-200'}`}>
                  {item.label}
                </span>
                {item.checked && item.checkedBy && (
                  <span className="text-gray-600 text-xs ml-auto">
                    {users.find((u) => u.id === item.checkedBy)?.name ?? ''}
                  </span>
                )}
              </button>
            ))}

            {allChecked && !hasActiveRepair && car.status !== 'ready' && (
              <button
                onClick={markCarReady}
                className="w-full mt-4 bg-cyan-500 hover:bg-cyan-400 text-white py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Check size={16} />
                Mark Car as Ready
              </button>
            )}
            {car.status === 'ready' && (
              <div className="flex items-center gap-2 text-cyan-400 text-sm font-medium mt-2">
                <Check size={16} />
                Car marked as ready
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Photo Section ── (visible to salesperson and director when car is ready/photo_complete) */}
      {(isSalesperson || isDirector) && (car.status === 'ready' || car.status === 'photo_complete') && (
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl">
          <SectionHeader icon={Camera} title="Car Photos" color="text-blue-400" />
          <div className="p-5 space-y-4">
            <p className="text-gray-400 text-sm">
              Car is ready. Each salesperson needs to take photos and mark as done.
            </p>

            {/* List of salespeople and their photo status */}
            <div className="space-y-2">
              {salespeople.map((sp) => {
                const done = photoTakenBy.includes(sp.id);
                return (
                  <div key={sp.id} className="flex items-center justify-between bg-[#111d35] rounded-lg px-4 py-3 border border-[#1a2a4a]">
                    <span className="text-gray-300 text-sm">{sp.name}</span>
                    {done ? (
                      <span className="flex items-center gap-1.5 text-green-400 text-xs font-medium">
                        <Check size={13} /> Done
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-gray-500 text-xs">
                        <Clock size={13} /> Pending
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Current salesperson mark done button */}
            {isSalesperson && !currentUserTookPhoto && (
              <button
                onClick={markPhotoDone}
                className="w-full bg-blue-500 hover:bg-blue-400 text-white py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Camera size={16} />
                Done Photo
              </button>
            )}
            {isSalesperson && currentUserTookPhoto && (
              <p className="text-green-400 text-sm text-center">You have marked your photos as done.</p>
            )}
            {allSalespeoplePhotosDone && (
              <p className="text-cyan-400 text-sm font-medium text-center">All photos complete — car is ready for loan submission.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Loan Submission ── (salesperson when photo_complete or submitted) */}
      {(isSalesperson || isDirector) && (car.status === 'photo_complete' || car.status === 'submitted' || car.status === 'deal_pending') && (
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl">
          <SectionHeader icon={CreditCard} title="Loan Submissions" count={loanSubmissions.length > 0 ? new Set(loanSubmissions.map((ls) => `${ls.customerName}__${ls.submittedBy}`)).size : 0} color="text-indigo-400" />
          <div className="p-5 space-y-4">
            {loanSubmissions.length === 0 ? (
              <p className="text-gray-500 text-sm">No loan submissions yet.</p>
            ) : (
              <div className="space-y-3">
                {Object.values(
                  loanSubmissions.reduce<Record<string, typeof loanSubmissions>>((groups, ls) => {
                    const key = `${ls.customerName ?? ''}__${ls.customerPhone ?? ''}__${ls.submittedBy}`;
                    if (!groups[key]) groups[key] = [];
                    groups[key].push(ls);
                    return groups;
                  }, {})
                ).map((group) => {
                  const first = group[0];
                  const submitter = users.find((u) => u.id === first.submittedBy);
                  return (
                    <div
                      key={`${first.customerName}-${first.submittedBy}`}
                      className="bg-[#111d35] rounded-lg border border-[#1a2a4a] overflow-hidden cursor-pointer hover:border-indigo-500/40 hover:bg-[#131f38] transition-colors"
                      onClick={() => openLoanDetail(group)}
                    >
                      {/* Customer header */}
                      <div className="px-4 py-3 border-b border-[#1a2a4a]/60 flex items-center justify-between">
                        <div>
                          <p className="text-white text-sm font-semibold">{first.customerName || 'Unknown'}</p>
                          {first.customerPhone && <p className="text-gray-400 text-xs mt-0.5">{first.customerPhone}</p>}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-gray-500 text-xs">{submitter?.name}</p>
                            <p className="text-gray-600 text-xs">{new Date(first.submittedAt).toLocaleDateString('en-MY')}</p>
                          </div>
                          {(isSalesperson || isDirector) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); openLoanEdit(group); }}
                              className="p-1.5 text-gray-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors"
                              title="Edit loan statuses"
                            >
                              <Edit size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Banks */}
                      <div className="px-4 py-3 flex flex-wrap gap-2">
                        {group.map((ls) => (
                          <span
                            key={ls.id}
                            className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                              ls.status === 'approved'
                                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                                : ls.status === 'rejected'
                                ? 'bg-red-500/10 border-red-500/30 text-red-400'
                                : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                            }`}
                          >
                            {ls.bank}
                          </span>
                        ))}
                      </div>
                      {first.notes && (
                        <p className="px-4 pb-3 text-gray-500 text-xs italic">{first.notes}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {isSalesperson && car.status !== 'deal_pending' && (
              <button
                onClick={openLoanModal}
                className="flex items-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Plus size={15} />
                Loan Submission
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Final Deal ── (salesperson submits, director approves) */}
      {(isSalesperson || isDirector) && (car.status === 'submitted' || car.status === 'deal_pending' || car.status === 'sold') && (
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl">
          <SectionHeader icon={FileCheck} title="Final Deal" color="text-yellow-400" />
          <div className="p-5 space-y-4">
            {!finalDeal ? (
              <>
                <p className="text-gray-400 text-sm">Loan approved and customer agreed? Submit the final deal for Director approval.</p>
                {isSalesperson && (
                  <button
                    onClick={() => { setDealForm({ dealPrice: car.sellingPrice, bank: BANKS[0], notes: '' }); setDealErrors({}); setShowDealModal(true); }}
                    className="flex items-center gap-2 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Plus size={15} />
                    Submit Final Deal
                  </button>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="bg-[#111d35] rounded-lg p-4 border border-[#1a2a4a] space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400 text-sm">Deal Price</span>
                    <span className="text-cyan-400 font-bold">{formatRM(finalDeal.dealPrice)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400 text-sm">Bank</span>
                    <span className="text-white text-sm">{finalDeal.bank}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400 text-sm">Submitted by</span>
                    <span className="text-white text-sm">{users.find((u) => u.id === finalDeal.submittedBy)?.name}</span>
                  </div>
                  {finalDeal.notes && (
                    <div>
                      <span className="text-gray-500 text-xs">Notes: </span>
                      <span className="text-gray-300 text-xs">{finalDeal.notes}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-[#1a2a4a] flex items-center justify-between">
                    <span className="text-gray-400 text-sm">Status</span>
                    {finalDeal.approvalStatus === 'approved' && (
                      <span className="text-green-400 text-sm font-medium flex items-center gap-1"><Check size={14} /> Approved</span>
                    )}
                    {finalDeal.approvalStatus === 'rejected' && (
                      <span className="text-red-400 text-sm font-medium flex items-center gap-1"><X size={14} /> Rejected</span>
                    )}
                    {finalDeal.approvalStatus === 'pending' && (
                      <span className="text-yellow-400 text-sm font-medium flex items-center gap-1"><Clock size={14} /> Awaiting Approval</span>
                    )}
                  </div>
                </div>

                {/* Director approval buttons */}
                {isDirector && finalDeal.approvalStatus === 'pending' && (
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleDealApproval(false)}
                      className="flex-1 flex items-center justify-center gap-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 py-2.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      <X size={14} /> Reject
                    </button>
                    <button
                      onClick={() => handleDealApproval(true)}
                      className="flex-1 flex items-center justify-center gap-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 py-2.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      <Check size={14} /> Approve
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Delivery ── (salesperson when deal approved / sold) */}
      {(isSalesperson || isDirector) && car.status === 'sold' && (
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl">
          <SectionHeader icon={Truck} title="Delivery" color="text-green-400" />
          <div className="p-5 space-y-4">
            {!car.deliveryCollected ? (
              <>
                <p className="text-gray-400 text-sm">Deal approved. Upload delivery photo and confirm final payment collected.</p>
                {isSalesperson && (
                  <button
                    onClick={() => { setDeliveryPhoto(''); setShowDeliveryModal(true); }}
                    className="flex items-center gap-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Truck size={15} />
                    Mark Delivered & Payment Collected
                  </button>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-400 font-medium">
                  <Check size={16} />
                  Car delivered — payment collected
                </div>
                {car.deliveryPhoto && (
                  <a href={car.deliveryPhoto} target="_blank" rel="noopener noreferrer">
                    <img src={car.deliveryPhoto} alt="Delivery" className="w-48 h-32 object-cover rounded-lg border border-[#1a2a4a] hover:opacity-80 transition-opacity" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Car Modal ── */}
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
          <FormField label="Selling Price (RM)">
            <input type="number" className={inputCls()} value={editForm.sellingPrice ?? ''} onChange={(e) => setEditForm({ ...editForm, sellingPrice: Number(e.target.value) })} />
          </FormField>
          <FormField label="Transmission">
            <select className={inputCls()} value={editForm.transmission ?? 'auto'} onChange={(e) => setEditForm({ ...editForm, transmission: e.target.value as Car['transmission'] })}>
              <option value="auto">Automatic</option>
              <option value="manual">Manual</option>
            </select>
          </FormField>
          <FormField label="Status">
            <select className={inputCls()} value={editForm.status ?? 'coming_soon'} onChange={(e) => setEditForm({ ...editForm, status: e.target.value as Car['status'] })}>
              <option value="coming_soon">Coming Soon</option>
              <option value="in_workshop">In Workshop</option>
              <option value="ready">Ready</option>
              <option value="photo_complete">Photo Complete</option>
              <option value="submitted">Submitted</option>
              <option value="deal_pending">Deal Pending</option>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
              <option value="sold">Sold</option>
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

      {/* ── Add Repair Modal ── */}
      <Modal isOpen={showRepairModal} onClose={() => setShowRepairModal(false)} title="Add Repair Job" maxWidth="max-w-xl">
        <div className="space-y-4">
          <FormField label="Type of Repair" error={repairErrors.typeOfRepair}>
            <select className={inputCls(repairErrors.typeOfRepair)} value={repairForm.typeOfRepair} onChange={(e) => setRepairForm({ ...repairForm, typeOfRepair: e.target.value })}>
              <option value="">Select type...</option>
              {REPAIR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>

          <FormField label="Send to Location" error={repairErrors.location}>
            <select className={inputCls(repairErrors.location)} value={repairForm.location} onChange={(e) => setRepairForm({ ...repairForm, location: e.target.value })}>
              <option value="">Select location...</option>
              {REPAIR_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </FormField>

          <div>
            <label className="block text-gray-300 text-xs font-medium mb-2">Parts (optional)</label>
            <div className="space-y-2">
              {repairForm.parts.map((part, i) => (
                <div key={i} className="flex gap-2">
                  <input className={`flex-1 ${inputCls()}`} placeholder="Part name" value={part.name} onChange={(e) => updatePart(i, 'name', e.target.value)} />
                  <input type="number" className="w-28 bg-[#111d35] border border-[#1a2a4a] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500" placeholder="RM" value={part.cost} onChange={(e) => updatePart(i, 'cost', Number(e.target.value))} />
                  {repairForm.parts.length > 1 && (
                    <button onClick={() => removePart(i)} className="text-red-400 hover:text-red-300 transition-colors px-1"><Trash2 size={15} /></button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addPartRow} className="text-cyan-400 text-xs mt-2 flex items-center gap-1 hover:text-cyan-300 transition-colors">
              <Plus size={13} /> Add part
            </button>
          </div>

          <FormField label="Estimated Labour Cost (RM)">
            <input type="number" className={inputCls()} value={repairForm.labourCost} onChange={(e) => setRepairForm({ ...repairForm, labourCost: Number(e.target.value) })} />
          </FormField>

          <FormField label="Notes">
            <textarea className={`${inputCls()} h-16 resize-none`} value={repairForm.notes} onChange={(e) => setRepairForm({ ...repairForm, notes: e.target.value })} placeholder="Additional notes..." />
          </FormField>

          <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-3 text-xs text-orange-300">
            Adding this repair will mark the car as <span className="font-semibold">In Workshop</span> and update its location to the garage above.
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowRepairModal(false)} className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleRepairSubmit} className="flex-1 bg-orange-500 hover:bg-orange-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">Send Out for Repair</button>
        </div>
      </Modal>

      {/* ── Complete Repair Modal ── */}
      <Modal isOpen={showCompleteModal} onClose={() => setShowCompleteModal(false)} title="Mark Repair Complete" maxWidth="max-w-sm">
        <div className="space-y-4">
          <p className="text-gray-400 text-sm">
            Confirm job <span className="text-white font-medium">"{targetRepair?.typeOfRepair}"</span> is collected and complete.
          </p>
          <FormField label="Actual Cost (RM)">
            <input type="number" className={inputCls()} value={completeForm.actualCost} onChange={(e) => setCompleteForm({ ...completeForm, actualCost: Number(e.target.value) })} />
          </FormField>
          <div>
            <label className="block text-gray-300 text-xs font-medium mb-1.5">Receipt Photo (optional)</label>
            {completeForm.receiptPhoto ? (
              <div className="relative inline-block">
                <img src={completeForm.receiptPhoto} alt="Receipt" className="w-32 h-24 object-cover rounded-lg border border-[#1a2a4a]" />
                <button onClick={() => setCompleteForm({ ...completeForm, receiptPhoto: '' })} className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => receiptRef.current?.click()}
                className="w-full border-2 border-dashed border-[#1a2a4a] hover:border-cyan-500/50 rounded-lg p-4 flex flex-col items-center gap-2 text-gray-600 hover:text-cyan-400 transition-colors"
              >
                <Upload size={18} />
                <span className="text-xs">Upload receipt photo</span>
              </button>
            )}
            <input ref={receiptRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
              if (e.target.files?.[0]) {
                const b64 = await readFileAsBase64(e.target.files[0]);
                setCompleteForm({ ...completeForm, receiptPhoto: b64 });
              }
            }} />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowCompleteModal(false)} className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleCompleteRepair} className="flex-1 bg-green-500 hover:bg-green-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">Confirm Done</button>
        </div>
      </Modal>

      {/* ── Edit Loan Status Modal ── */}
      <Modal isOpen={showLoanEditModal} onClose={() => setShowLoanEditModal(false)} title="Update Loan Status" maxWidth="max-w-sm">
        <div className="space-y-3">
          <div className="bg-[#111d35] rounded-lg px-4 py-3 border border-[#1a2a4a]">
            <p className="text-white text-sm font-semibold">{loanEditGroup[0]?.customerName}</p>
            {loanEditGroup[0]?.customerPhone && <p className="text-gray-400 text-xs mt-0.5">{loanEditGroup[0]?.customerPhone}</p>}
          </div>
          {loanEditGroup.map((ls) => (
            <div key={ls.id} className="flex items-center justify-between gap-3">
              <span className="text-gray-300 text-sm font-medium w-28 flex-shrink-0">{ls.bank}</span>
              <div className="flex gap-2 flex-1">
                {(['submitted', 'approved', 'rejected'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setLoanEditStatuses((prev) => ({ ...prev, [ls.id]: s }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize ${
                      loanEditStatuses[ls.id] === s
                        ? s === 'approved'
                          ? 'bg-green-500/20 border-green-500/50 text-green-400'
                          : s === 'rejected'
                          ? 'bg-red-500/20 border-red-500/50 text-red-400'
                          : 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400'
                        : 'bg-[#111d35] border-[#1a2a4a] text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowLoanEditModal(false)} className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleLoanEditSave} className="flex-1 bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">Save</button>
        </div>
      </Modal>

      {/* ── Loan Detail Modal ── */}
      <Modal isOpen={showLoanDetailModal} onClose={() => setShowLoanDetailModal(false)} title="Loan Case Details" maxWidth="max-w-md">
        {loanDetailGroup.length > 0 && (() => {
          const first = loanDetailGroup[0];
          const submitter = users.find((u) => u.id === first.submittedBy);
          return (
            <div className="space-y-4">
              {/* Customer Info */}
              <div className="bg-[#111d35] rounded-lg border border-[#1a2a4a] p-4 space-y-2">
                <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">Customer</p>
                <p className="text-white font-semibold">{first.customerName || 'Unknown'}</p>
                {first.customerPhone && <p className="text-gray-400 text-sm">{first.customerPhone}</p>}
              </div>

              {/* Submission Info */}
              <div className="bg-[#111d35] rounded-lg border border-[#1a2a4a] p-4 space-y-2">
                <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">Submitted By</p>
                <p className="text-white font-medium">{submitter?.name ?? '—'}</p>
                <p className="text-gray-500 text-xs">{new Date(first.submittedAt).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </div>

              {/* Bank Statuses */}
              <div className="bg-[#111d35] rounded-lg border border-[#1a2a4a] p-4 space-y-3">
                <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">Bank Applications</p>
                {loanDetailGroup.map((ls) => (
                  <div key={ls.id} className="flex items-center justify-between">
                    <span className="text-gray-200 text-sm font-medium">{ls.bank}</span>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${
                      ls.status === 'approved'
                        ? 'bg-green-500/10 border-green-500/30 text-green-400'
                        : ls.status === 'rejected'
                        ? 'bg-red-500/10 border-red-500/30 text-red-400'
                        : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                    }`}>
                      {ls.status}
                    </span>
                  </div>
                ))}
              </div>

              {/* Notes */}
              {first.notes && (
                <div className="bg-[#111d35] rounded-lg border border-[#1a2a4a] p-4">
                  <p className="text-gray-500 text-xs font-medium uppercase tracking-wider mb-2">Notes</p>
                  <p className="text-gray-300 text-sm">{first.notes}</p>
                </div>
              )}

              {(isSalesperson || isDirector) && (
                <button
                  onClick={() => { setShowLoanDetailModal(false); openLoanEdit(loanDetailGroup); }}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  <Edit size={14} />
                  Update Status
                </button>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ── Loan Submission Modal ── */}
      <Modal isOpen={showLoanModal} onClose={() => setShowLoanModal(false)} title="Add Loan Process" maxWidth="max-w-md">
        <div className="space-y-4">
          <div>
            <label className="block text-gray-300 text-xs font-medium mb-2">
              Bank <span className="text-gray-500">(select one or more)</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {BANKS.map((b) => {
                const selected = loanBanks.includes(b);
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => toggleLoanBank(b)}
                    className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors text-center ${
                      selected
                        ? 'bg-indigo-500/20 border-indigo-500/60 text-indigo-300'
                        : 'bg-[#111d35] border-[#1a2a4a] text-gray-400 hover:border-indigo-500/40 hover:text-gray-200'
                    }`}
                  >
                    {b}
                  </button>
                );
              })}
            </div>
            {loanErrors.banks && (
              <p className="text-red-400 text-xs mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{loanErrors.banks}</p>
            )}
          </div>

          <FormField label="Customer Name" error={loanErrors.customerName}>
            <input
              className={inputCls(loanErrors.customerName)}
              value={loanCustomerName}
              onChange={(e) => setLoanCustomerName(e.target.value)}
              placeholder="e.g. Ahmad bin Ali"
            />
          </FormField>
          <FormField label="Phone Number" error={loanErrors.customerPhone}>
            <input
              className={inputCls(loanErrors.customerPhone)}
              value={loanCustomerPhone}
              onChange={(e) => setLoanCustomerPhone(e.target.value)}
              placeholder="e.g. 012-3456789"
            />
          </FormField>
          <FormField label="Notes (optional)">
            <textarea className={`${inputCls()} h-16 resize-none`} value={loanNotes} onChange={(e) => setLoanNotes(e.target.value)} placeholder="Any remarks..." />
          </FormField>
          <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3 text-xs text-indigo-300">
            Car status will automatically change to <span className="font-semibold">Submitted</span>.
            {loanBanks.length > 1 && (
              <span className="ml-1">One entry will be created per bank selected.</span>
            )}
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowLoanModal(false)} className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleLoanSubmit} className="flex-1 bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            Submit{loanBanks.length > 1 ? ` (${loanBanks.length} banks)` : ''}
          </button>
        </div>
      </Modal>

      {/* ── Final Deal Modal ── */}
      <Modal isOpen={showDealModal} onClose={() => setShowDealModal(false)} title="Submit Final Deal" maxWidth="max-w-sm">
        <div className="space-y-4">
          <FormField label="Final Deal Price (RM)" error={dealErrors.dealPrice}>
            <input type="number" className={inputCls(dealErrors.dealPrice)} value={dealForm.dealPrice} onChange={(e) => setDealForm({ ...dealForm, dealPrice: Number(e.target.value) })} />
          </FormField>
          <FormField label="Bank">
            <select className={inputCls()} value={dealForm.bank} onChange={(e) => setDealForm({ ...dealForm, bank: e.target.value })}>
              {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </FormField>
          <FormField label="Notes (optional)">
            <textarea className={`${inputCls()} h-16 resize-none`} value={dealForm.notes} onChange={(e) => setDealForm({ ...dealForm, notes: e.target.value })} placeholder="Terms, remarks, etc." />
          </FormField>
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-300">
            This will be sent to the Director for approval.
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowDealModal(false)} className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleDealSubmit} className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">Send for Approval</button>
        </div>
      </Modal>

      {/* ── Photo Gallery Modal ── */}
      {showGallery && allPhotos.length > 0 && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={() => setShowGallery(false)}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <span className="text-white font-semibold">{car.year} {car.make} {car.model}</span>
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-sm">{galleryIndex + 1} / {allPhotos.length}</span>
              <button
                onClick={() => downloadPhoto(allPhotos[galleryIndex], galleryIndex)}
                className="flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-400 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Download size={15} /> Download
              </button>
              <button onClick={() => setShowGallery(false)} className="p-1.5 text-gray-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Main image */}
          <div className="flex-1 flex items-center justify-center relative px-14 min-h-0" onClick={(e) => e.stopPropagation()}>
            <img
              src={allPhotos[galleryIndex]}
              alt={`Photo ${galleryIndex + 1}`}
              className="max-w-full max-h-full object-contain rounded-lg"
            />
            {allPhotos.length > 1 && (
              <>
                <button
                  onClick={galleryPrev}
                  className="absolute left-3 p-2.5 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors"
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  onClick={galleryNext}
                  className="absolute right-3 p-2.5 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors"
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}
          </div>

          {/* Thumbnail strip */}
          {allPhotos.length > 1 && (
            <div className="flex gap-2 px-5 py-4 overflow-x-auto flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              {allPhotos.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setGalleryIndex(i)}
                  className={`flex-shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition-colors ${i === galleryIndex ? 'border-cyan-400' : 'border-transparent opacity-50 hover:opacity-80'}`}
                >
                  <img src={src} alt={`thumb-${i}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Delivery Modal ── */}
      <Modal isOpen={showDeliveryModal} onClose={() => setShowDeliveryModal(false)} title="Confirm Delivery" maxWidth="max-w-sm">
        <div className="space-y-4">
          <p className="text-gray-400 text-sm">Upload a delivery photo and confirm payment has been collected.</p>
          <div>
            <label className="block text-gray-300 text-xs font-medium mb-1.5">Delivery Photo (optional)</label>
            {deliveryPhoto ? (
              <div className="relative inline-block">
                <img src={deliveryPhoto} alt="Delivery" className="w-full h-40 object-cover rounded-lg border border-[#1a2a4a]" />
                <button onClick={() => setDeliveryPhoto('')} className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-0.5">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => deliveryRef.current?.click()}
                className="w-full border-2 border-dashed border-[#1a2a4a] hover:border-green-500/50 rounded-lg p-4 flex flex-col items-center gap-2 text-gray-600 hover:text-green-400 transition-colors"
              >
                <Upload size={18} />
                <span className="text-xs">Upload delivery photo</span>
              </button>
            )}
            <input ref={deliveryRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
              if (e.target.files?.[0]) {
                const b64 = await readFileAsBase64(e.target.files[0]);
                setDeliveryPhoto(b64);
              }
            }} />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowDeliveryModal(false)} className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleDeliverySubmit} className="flex-1 bg-green-500 hover:bg-green-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            Confirm Delivered
          </button>
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
