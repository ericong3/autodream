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
  Truck,
  Upload,
  Check,
  X,
  Clock,
  ChevronLeft,
  ChevronRight,
  Download,
  Image,
  FileText,
  Building2,
  Banknote,
  CheckCircle,
  XCircle,
  Pencil,
  Receipt,
} from 'lucide-react';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';
import { Car, RepairJob, ChecklistItem, DEFAULT_CHECKLIST_LABELS, WorkOrderItem } from '../types';
import Modal from '../components/Modal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { formatRM, formatMileage, generateId, shortName } from '../utils/format';


const STATUS_BADGE: Record<string, string> = {
  coming_soon: 'bg-purple-500/20 text-purple-400',
  in_workshop: 'bg-orange-500/20 text-orange-400',
  ready: 'bg-gold-500/20 text-gold-400',
  photo_complete: 'bg-blue-500/20 text-blue-400',
  submitted: 'bg-indigo-500/20 text-indigo-400',
  deal_pending: 'bg-yellow-500/20 text-yellow-400',
  available: 'bg-green-500/20 text-green-400',
  reserved: 'bg-yellow-500/20 text-yellow-400',
  sold: 'bg-gray-500/20 text-gray-400',
  delivered: 'bg-violet-500/20 text-violet-400',
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
  delivered: 'Delivered',
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
  return `w-full bg-obsidian-700/60 border ${error ? 'border-red-500/50' : 'border-obsidian-400/60'} text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors`;
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

function SectionHeader({ icon: Icon, title, count, color = 'text-gold-400' }: { icon: React.ElementType; title: string; count?: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 p-5 border-b border-obsidian-400/60">
      <Icon size={18} className={color} />
      <h3 className="text-white font-semibold">{title}</h3>
      {count !== undefined && (
        <span className="bg-obsidian-700/60 text-gray-400 text-xs px-2 py-0.5 rounded-full">{count}</span>
      )}
    </div>
  );
}

export function CarDetailContent({ id, onBack, backLabel = 'Back to Inventory', initialTab }: { id: string; onBack: () => void; backLabel?: string; initialTab?: 'repairs' | 'loans' | 'final_deal' }) {
  const cars = useStore((s) => s.cars);
  const users = useStore((s) => s.users);
  const customers = useStore((s) => s.customers);
  const repairs = useStore((s) => s.repairs);
  const workshops = useStore((s) => s.workshops);
  const merchants = useStore((s) => s.merchants);
  const currentUser = useStore((s) => s.currentUser);
  const updateCar = useStore((s) => s.updateCar);
  const updateCustomer = useStore((s) => s.updateCustomer);
  const addRepair = useStore((s) => s.addRepair);
  const updateRepair = useStore((s) => s.updateRepair);
  const deleteRepair = useStore((s) => s.deleteRepair);
  const addMiscCost = useStore((s) => s.addMiscCost);
  const deleteMiscCost = useStore((s) => s.deleteMiscCost);

  const car = cars.find((c) => c.id === id);
  const isDirector = currentUser?.role === 'director';
  const isAdmin = currentUser?.role === 'admin';
  const isMechanic = currentUser?.role === 'mechanic';
  const isSalesperson = currentUser?.role === 'salesperson';
  const salespeople = users.filter((u) => u.role === 'salesperson');
  const carRepairs = repairs.filter((r) => r.carId === id);
  const totalRepairCost = carRepairs.filter(r => r.status === 'done').reduce((sum, r) => sum + (r.actualCost ?? r.totalCost), 0);

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


  // ── Delete confirmation ──
  const [deleteTarget, setDeleteTarget] = useState<{ action: () => void | Promise<void>; label: string } | null>(null);

  // ── Misc Cost Modal ──
  const [showMiscModal, setShowMiscModal] = useState(false);
  const [miscForm, setMiscForm] = useState({ category: '', merchantName: '', description: '', amount: '', notes: '' });
  const [miscErrors, setMiscErrors] = useState<Record<string, string>>({});

  // ── Repair / Loans tab ──
  const [jobTab, setJobTab] = useState<'repairs' | 'loans' | 'final_deal' | 'misc'>(initialTab ?? 'repairs');
  const [dealView, setDealView] = useState<'salesman' | 'director'>('salesman');
  const [showConsignment, setShowConsignment] = useState(false);

  // ── Final Deal — derived data (needed by edit handler) ──
  const dealCustomer = car ? customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder)) : undefined;
  const dealWo = dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
  const dealIsLoan = !!dealCustomer?.loanWorkOrder;

  // ── Edit Deal Modal ──
  const [showEditDeal, setShowEditDeal] = useState(false);
  const [editDealForm, setEditDealForm] = useState({
    bank: '', sellingPrice: 0, discount: 0, insurance: 0,
    bankProduct: 0, loanAmount: 0, downpayment: 0, bookingFee: 0,
    additionalItems: [] as WorkOrderItem[],
  });
  const [savingDeal, setSavingDeal] = useState(false);

  const openEditDeal = () => {
    if (!car) return;
    const deal = car.finalDeal!;
    setEditDealForm({
      bank: dealWo && 'bank' in dealWo ? (dealWo as any).bank : deal.bank ?? '',
      sellingPrice: dealWo?.sellingPrice ?? deal.dealPrice,
      discount: dealWo?.discount ?? 0,
      insurance: dealWo?.insurance ?? 0,
      bankProduct: dealWo?.bankProduct ?? 0,
      loanAmount: (dealWo as any)?.loanAmount ?? 0,
      downpayment: (dealWo as any)?.downpayment ?? 0,
      bookingFee: dealWo?.bookingFee ?? 0,
      additionalItems: [...(dealWo?.additionalItems ?? [])],
    });
    setShowEditDeal(true);
  };

  const handleSaveDeal = async () => {
    if (!car || !dealCustomer || !dealWo) return;
    setSavingDeal(true);
    try {
      const updatedWo = { ...dealWo, ...editDealForm } as any;
      if (dealIsLoan) {
        await updateCustomer(dealCustomer.id, { loanWorkOrder: updatedWo });
      } else {
        await updateCustomer(dealCustomer.id, { cashWorkOrder: updatedWo });
      }
      await updateCar(car.id, {
        finalDeal: {
          ...car.finalDeal!,
          dealPrice: editDealForm.sellingPrice - editDealForm.discount,
          bank: editDealForm.bank,
        },
      });
      setShowEditDeal(false);
    } finally {
      setSavingDeal(false);
    }
  };

  // ── Delivery Modal ──
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryPhoto, setDeliveryPhoto] = useState('');
  const deliveryRef = useRef<HTMLInputElement>(null);

  // ── Photo Gallery ──
  const [showGallery, setShowGallery] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [editingPhotos, setEditingPhotos] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const replacePhotoRef = useRef<HTMLInputElement>(null);
  const addPhotoRef = useRef<HTMLInputElement>(null);
  const addPhotoMainRef = useRef<HTMLInputElement>(null);
  const allPhotos = car?.photos?.length ? car.photos : (car?.photo ? [car.photo] : []);

  const openGallery = (idx = 0) => { setGalleryIndex(idx); setShowGallery(true); setEditingPhotos(false); };
  const galleryPrev = () => setGalleryIndex((i) => (i - 1 + allPhotos.length) % allPhotos.length);
  const galleryNext = () => setGalleryIndex((i) => (i + 1) % allPhotos.length);
  const downloadPhoto = (src: string, idx: number) => {
    const a = document.createElement('a');
    a.href = src;
    a.download = `${car?.make}-${car?.model}-${car?.year}-photo-${idx + 1}.jpg`;
    a.click();
  };

  const handleReplacePhoto = async (files: FileList | null) => {
    if (!files || !files[0] || !car) return;
    setPhotoUploading(true);
    try {
      const url = await uploadToStorage(files[0], 'cars');
      const updated = [...allPhotos];
      updated[galleryIndex] = url;
      await updateCar(car.id, { photos: updated, photo: updated[0] });
    } catch (e) { console.error(e); }
    finally { setPhotoUploading(false); }
  };

  const handleDeletePhoto = () => {
    if (!car || allPhotos.length === 0) return;
    setDeleteTarget({
      label: `photo ${galleryIndex + 1} of ${car.year} ${car.make} ${car.model}`,
      action: async () => {
        const updated = allPhotos.filter((_, i) => i !== galleryIndex);
        await updateCar(car.id, { photos: updated, photo: updated[0] ?? '' });
        setGalleryIndex((i) => Math.min(i, updated.length - 1));
        if (updated.length === 0) setShowGallery(false);
      },
    });
  };

  const handleAddPhotos = async (files: FileList | null) => {
    if (!files || !car) return;
    setPhotoUploading(true);
    try {
      const urls = await Promise.all(Array.from(files).map((f) => uploadToStorage(f, 'cars')));
      const updated = [...allPhotos, ...urls];
      await updateCar(car.id, { photos: updated, photo: updated[0] });
    } catch (e) { console.error(e); }
    finally { setPhotoUploading(false); }
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

  const compressImage = (file: File, maxWidth = 1280, quality = 0.82): Promise<Blob> =>
    new Promise((resolve) => {
      const img = document.createElement('img');
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', quality);
      };
      img.src = url;
    });

  const uploadToStorage = async (file: File, folder: string): Promise<string> => {
    const compressed = await compressImage(file);
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error } = await supabase.storage.from('car-photos').upload(path, compressed, { contentType: 'image/jpeg' });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from('car-photos').getPublicUrl(path);
    return data.publicUrl;
  };

  if (!car) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <CarIcon size={40} className="text-gray-600 mb-3" />
        <p className="text-gray-400">Car not found</p>
        <button onClick={onBack} className="text-gold-400 text-sm mt-3 hover:underline">
          {backLabel}
        </button>
      </div>
    );
  }

  const totalMiscCost = (car.miscCosts ?? []).reduce((sum, m) => sum + m.amount, 0);

  const assignedSalespersonId = car.assignedSalesperson || dealCustomer?.assignedSalesId;
  const assignedSalesperson = assignedSalespersonId ? users.find((u) => u.id === assignedSalespersonId) : null;

  // Net profit matching director view formula
  const _wo = dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
  const _dealPrice = (_wo?.sellingPrice ?? car.sellingPrice) - (_wo?.discount ?? 0);
  const _additionalTotal = _wo?.additionalItems?.reduce((s, i) => s + i.amount, 0) ?? 0;
  const _profitBeforeComm = _dealPrice - car.purchasePrice - totalRepairCost - totalMiscCost - _additionalTotal;
  const _commission = car.priceFloor != null
    ? (_dealPrice >= car.priceFloor ? (_profitBeforeComm >= 10000 ? 2000 : 1500) : 1000)
    : (_profitBeforeComm >= 10000 ? 1500 : 1000);
  const netProfit = _profitBeforeComm - _commission;

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

  // ── Delivery ──
  const handleDeliverySubmit = () => {
    setShowDeliveryModal(false);
    updateCar(car.id, {
      status: 'delivered',
      deliveryPhoto: deliveryPhoto || undefined,
      deliveryCollected: true,
    });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft size={16} />
          {backLabel}
        </button>
        <div className="flex gap-3 flex-wrap">
          {(isMechanic || isDirector) && (
            <button
              onClick={openAddRepair}
              className="flex items-center gap-2 bg-obsidian-700/60 hover:bg-obsidian-600/60 border border-obsidian-400/60 text-gray-300 hover:text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              <Plus size={15} />
              Add Repair
            </button>
          )}
          {(isAdmin || isDirector) && (
            <button
              onClick={() => { setMiscForm({ category: '', merchantName: '', description: '', amount: '', notes: '' }); setMiscErrors({}); setShowMiscModal(true); }}
              className="flex items-center gap-2 bg-obsidian-700/60 hover:bg-obsidian-600/60 border border-obsidian-400/60 text-gray-300 hover:text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              <Receipt size={15} />
              Misc Cost
            </button>
          )}
          {isDirector && (
            <button
              onClick={openEdit}
              className="flex items-center gap-2 btn-gold text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Edit size={15} />
              Edit Car
            </button>
          )}
        </div>
      </div>

      {/* Main info */}
      <div className={`bg-card-gradient border rounded-xl shadow-card overflow-hidden ${car.consignment ? 'border-blue-500/50' : 'border-obsidian-400/70'}`}>
        {car.consignment && (
          <div>
            <button
              onClick={() => setShowConsignment(!showConsignment)}
              className="flex items-center gap-2 bg-blue-500 hover:bg-blue-400 text-white text-xs font-bold px-4 py-1.5 rounded-br-xl transition-colors"
            >
              <Building2 size={11} /> CONSIGN {showConsignment ? '▲' : '▼'}
            </button>
            {showConsignment && (
              <div className="px-5 py-4 bg-blue-500/5 border-b border-blue-500/20 grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-2 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Dealer</p>
                  <p className="text-white font-medium mt-0.5">{car.consignment.dealer || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Terms</p>
                  <p className="text-white mt-0.5">{car.consignment.terms === 'fixed_amount' ? 'Fixed Amount' : 'Profit Split'}</p>
                </div>
                {car.consignment.terms === 'fixed_amount' && (
                  <div>
                    <p className="text-gray-500 text-xs">Amount</p>
                    <p className="text-blue-400 font-semibold mt-0.5">{formatRM(car.consignment.fixedAmount ?? 0)}</p>
                  </div>
                )}
                {car.consignment.terms === 'profit_split' && (
                  <>
                    <div>
                      <p className="text-gray-500 text-xs">Dealer's Split</p>
                      <p className="text-white mt-0.5">{car.consignment.splitPercent ?? 50}%</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Our Split</p>
                      <p className="text-green-400 font-semibold mt-0.5">{100 - (car.consignment.splitPercent ?? 50)}%</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-col md:flex-row">
          <div className="w-full md:w-72 h-52 md:h-auto bg-obsidian-700/60 flex items-center justify-center flex-shrink-0 relative group">
            <div
              className={`absolute inset-0 ${allPhotos.length > 0 ? 'cursor-pointer' : ''}`}
              onClick={() => allPhotos.length > 0 && openGallery(0)}
            />
            {car.photo ? (
              <img
                src={car.photo}
                alt={`${car.make} ${car.model}`}
                className="w-full h-full object-cover opacity-0 transition-opacity duration-300"
                loading="lazy"
                onLoad={(e) => e.currentTarget.classList.replace('opacity-0', 'opacity-100')}
              />
            ) : (
              <CarIcon size={56} className="text-gray-700" />
            )}
            {allPhotos.length > 0 && (
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 pointer-events-none">
                <Image size={24} className="text-white" />
                <span className="text-white text-xs font-medium">{allPhotos.length} photo{allPhotos.length !== 1 ? 's' : ''}</span>
              </div>
            )}
            {/* Edit Photos button — always visible for director/salesperson */}
            {(isDirector || isSalesperson) && (
              <button
                onClick={() => allPhotos.length > 0 ? openGallery(0) : addPhotoMainRef.current?.click()}
                className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5 bg-black/70 hover:bg-black/90 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border border-white/20"
              >
                <Camera size={13} /> {allPhotos.length === 0 ? 'Add Photos' : 'Edit Photos'}
              </button>
            )}
            <input ref={addPhotoMainRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleAddPhotos(e.target.files)} />
          </div>

          <div className="flex-1 p-6">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <h1 className="text-2xl font-bold text-white">{car.year} {car.make} {car.model}{car.variant ? ` ${car.variant}` : ''}</h1>
                <p className="text-gray-400 mt-1">{car.colour} · {car.transmission === 'auto' ? 'Automatic' : 'Manual'}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_BADGE[car.status] ?? 'bg-gray-500/20 text-gray-400'}`}>
                  {STATUS_LABEL[car.status] ?? car.status}
                </span>
              </div>
            </div>

            {/* Current location banner */}
            {car.status === 'delivered' ? (
              <div className="mt-4 flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-2">
                <MapPin size={14} className="text-violet-400 flex-shrink-0" />
                <span className="text-violet-300 text-sm font-semibold">Delivered</span>
              </div>
            ) : hasActiveRepair && car.currentLocation ? (
              <div className="mt-4 flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
                <MapPin size={14} className="text-orange-400 flex-shrink-0" />
                <span className="text-orange-300 text-sm">
                  Currently at: <span className="font-semibold">{car.currentLocation}</span>
                </span>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2 bg-obsidian-700/40 border border-obsidian-400/40 rounded-lg px-3 py-2">
                <MapPin size={14} className="text-gray-500 flex-shrink-0" />
                <span className="text-gray-400 text-sm">Showroom</span>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
              <InfoItem label="Car Plate" value={car.carPlate || '—'} valueClass={car.carPlate ? 'font-mono font-bold text-gold-300 tracking-wider' : 'text-gray-600'} />
              <InfoItem label="Mileage" value={formatMileage(car.mileage)} />
              <InfoItem label="Year" value={String(car.year)} />
              <InfoItem label="Transmission" value={car.transmission === 'auto' ? 'Automatic' : 'Manual'} />
              <InfoItem label="Date Added" value={car.dateAdded} />
              <InfoItem label="Selling Price" value={car.sellingPrice > 0 ? formatRM(car.sellingPrice) : 'TBD'} valueClass="text-gold-400 font-bold" />
              {isDirector && (
                <>
                  <InfoItem label="Purchase Price" value={formatRM(car.purchasePrice)} />
                  <InfoItem label="Repair Costs" value={formatRM(totalRepairCost)} valueClass="text-orange-400" />
                  <InfoItem label="Misc Costs" value={formatRM(totalMiscCost)} valueClass="text-purple-400" />
                  {car.priceFloor != null && (
                    <InfoItem label="Floor Price" value={formatRM(car.priceFloor)} valueClass="text-blue-400 font-semibold" />
                  )}
                  <InfoItem label="Net Profit" value={formatRM(netProfit)} valueClass={netProfit >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'} />
                </>
              )}
              <InfoItem label="Assigned Salesperson" value={assignedSalesperson ? shortName(assignedSalesperson.name) : 'Unassigned'} />
            </div>

            {car.notes && (
              <div className="mt-4 p-3 bg-obsidian-700/60 rounded-lg border border-obsidian-400/60">
                <p className="text-gray-500 text-xs font-medium mb-1">Notes</p>
                <p className="text-gray-300 text-sm">{car.notes}</p>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── Green Card ── */}
      {car.greenCard && (
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
          <SectionHeader icon={FileText} title="Green Card" color="text-green-400" />
          <div className="p-5">
            <div className="flex items-center gap-4">
              {car.greenCard.startsWith('http') && (car.greenCard.includes('.jpg') || car.greenCard.includes('.jpeg') || car.greenCard.includes('.png') || car.greenCard.includes('.webp')) ? (
                <img src={car.greenCard} alt="Green Card" className="w-32 h-24 object-cover rounded-lg border border-obsidian-400/60" />
              ) : (
                <div className="w-16 h-16 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center justify-center">
                  <FileText size={28} className="text-green-400" />
                </div>
              )}
              <button
                onClick={async () => {
                  const res = await fetch(car.greenCard!);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${car.make}-${car.model}-${car.year}-greencard.jpg`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="flex items-center gap-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Download size={15} />
                Download Green Card
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ── Repair Jobs & Loans ── */}
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
        {/* Tab bar */}
        <div className="flex items-center gap-1 px-4 pt-4 pb-0 border-b border-obsidian-400/60">
          <button
            onClick={() => setJobTab('repairs')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px ${
              jobTab === 'repairs' ? 'border-orange-400 text-orange-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <Wrench size={14} /> Repair Jobs
            {carRepairs.length > 0 && <span className="text-xs bg-obsidian-700/60 px-1.5 py-0.5 rounded-full">{carRepairs.length}</span>}
          </button>
          <button
            onClick={() => setJobTab('loans')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px ${
              jobTab === 'loans' ? 'border-blue-400 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <Banknote size={14} /> Loan Log
            {(() => { const isSoldDelivered = car.status === 'delivered'; const n = isSoldDelivered ? 0 : customers.filter(c => c.interestedCarId === car.id && c.loanApplications?.length && !c.isTrashed).length; return n > 0 ? <span className="text-xs bg-obsidian-700/60 px-1.5 py-0.5 rounded-full">{n}</span> : null; })()}
          </button>
          {(isAdmin || isDirector) && (
            <button
              onClick={() => setJobTab('misc')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px ${
                jobTab === 'misc' ? 'border-purple-400 text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              <Receipt size={14} /> Misc
              {(car.miscCosts?.length ?? 0) > 0 && <span className="text-xs bg-obsidian-700/60 px-1.5 py-0.5 rounded-full">{car.miscCosts!.length}</span>}
            </button>
          )}
          {car.finalDeal && (
            <button
              onClick={() => setJobTab('final_deal')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px ${
                jobTab === 'final_deal' ? 'border-gold-400 text-gold-400' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              <CheckCircle size={14} /> Final Deal
            </button>
          )}
          {car.finalDeal && jobTab === 'final_deal' && isDirector && dealWo && (
            <button
              onClick={openEditDeal}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 mb-1 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-obsidian-600/50 transition-colors border border-obsidian-400/40"
            >
              <Pencil size={12} /> Edit Deal
            </button>
          )}
        </div>
        {jobTab === 'repairs' && (carRepairs.length === 0 ? (
          <div className="text-center py-10 text-gray-600 text-sm">No repair jobs recorded</div>
        ) : (
          <div className="divide-y divide-obsidian-400/60/50">
            {carRepairs.map((r, i) => {
              const partsTotal = r.parts.reduce((sum, p) => sum + p.cost, 0);
              const isActive = r.status === 'pending' || r.status === 'in_progress';
              const isQueued = r.status === 'queued';
              return (
                <div key={r.id} className={`p-5 ${i % 2 === 0 ? 'bg-[#0F0E0C]' : 'bg-[#080808]/30'}`}>
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
                        <a href={r.receiptPhoto} target="_blank" rel="noopener noreferrer" className="text-xs text-gold-400 hover:underline mt-1 inline-block">
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
                          className="flex items-center gap-1.5 bg-gold-500/10 hover:bg-gold-500/20 border border-gold-500/30 text-gold-400 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                          onClick={() => setDeleteTarget({ label: `repair job "${r.typeOfRepair}"`, action: () => deleteRepair(r.id) })}
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
        ))}
        {jobTab === 'repairs' && isDirector && carRepairs.length > 0 && (
          <div className="px-5 py-3 border-t border-obsidian-400/60 text-right">
            <p className="text-sm text-gray-400">
              Total Repair Cost: <span className="text-orange-400 font-semibold">{formatRM(totalRepairCost)}</span>
            </p>
          </div>
        )}

        {/* ── Misc tab ── */}
        {jobTab === 'misc' && (
          <div>
            {(car.miscCosts?.length ?? 0) === 0 ? (
              <div className="text-center py-10 text-gray-600 text-sm">No misc costs recorded</div>
            ) : (
              <div className="divide-y divide-obsidian-400/60/50">
                {car.miscCosts!.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-5 py-3 hover:bg-obsidian-700/20 transition-colors">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white text-sm font-medium">{m.description}</p>
                        {m.category && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/20 text-purple-400 border border-purple-500/30">{m.category}</span>
                        )}
                        {m.merchant && (
                          <span className="text-gray-400 text-xs">{m.merchant}</span>
                        )}
                      </div>
                      <p className="text-gray-500 text-xs mt-0.5">{new Date(m.createdAt).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-purple-400 font-semibold text-sm">{formatRM(m.amount)}</span>
                      {(isAdmin || isDirector) && (
                        <button
                          onClick={() => setDeleteTarget({ label: `misc cost "${m.description}"`, action: () => deleteMiscCost(car.id, m.id) })}
                          className="text-red-400 hover:text-red-300 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="px-5 py-3 border-t border-obsidian-400/60 text-right">
              <p className="text-sm text-gray-400">
                Total Misc Cost: <span className="text-purple-400 font-semibold">{formatRM((car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0))}</span>
              </p>
            </div>
          </div>
        )}

        {/* ── Loan Log tab ── */}
        {jobTab === 'loans' && (() => {
          const BANK_CLS: Record<string, string> = {
            submitted: 'bg-blue-500/20 text-blue-400',
            approved:  'bg-emerald-500/20 text-emerald-400',
            rejected:  'bg-red-500/20 text-red-400',
          };
          const BANK_ICON: Record<string, React.ReactNode> = {
            submitted: <Clock size={10} />,
            approved:  <CheckCircle size={10} />,
            rejected:  <XCircle size={10} />,
          };
          const isCarSoldDelivered = car.status === 'delivered';
          const loanCustomers = customers
            .filter(c => c.interestedCarId === car.id && c.loanApplications?.length && !isCarSoldDelivered)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          const trashedLoanCustomers = customers
            .filter(c => c.interestedCarId === car.id && c.loanApplications?.length && c.isTrashed)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          const activeCustomers = loanCustomers.filter(c => !c.isTrashed);
          const allVisible = [...activeCustomers, ...trashedLoanCustomers.filter(c => !activeCustomers.find(a => a.id === c.id))];

          if (isCarSoldDelivered) {
            return (
              <div className="flex flex-col items-center justify-center py-12 text-gray-600 text-sm gap-2">
                <CheckCircle size={28} className="text-green-700" />
                <p>Loan closed — car sold &amp; delivered</p>
                <p className="text-xs text-gray-700">See Final Deal tab for details</p>
              </div>
            );
          }
          if (allVisible.length === 0) {
            return (
              <div className="flex flex-col items-center justify-center py-12 text-gray-600 text-sm gap-2">
                <Banknote size={28} className="text-gray-700" />
                No loan submissions recorded
              </div>
            );
          }
          return (
            <div className="divide-y divide-obsidian-400/40">
              {allVisible.map(c => {
                const apps = c.loanApplications ?? [];
                const hasApproved = apps.some(a => a.status === 'approved');
                const allRejected = apps.every(a => a.status === 'rejected');
                const isTrashed = !!c.isTrashed;
                const overallCls = isTrashed ? 'text-gray-600' : hasApproved ? 'text-emerald-400' : allRejected ? 'text-red-400' : 'text-blue-400';
                return (
                  <div key={c.id} className={`px-5 py-4 ${isTrashed ? 'opacity-50' : ''}`}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className={`font-semibold text-sm ${isTrashed ? 'text-gray-500 line-through' : 'text-white'}`}>{c.name}</p>
                          {isTrashed && <span className="text-[10px] bg-gray-700/60 text-gray-500 px-1.5 py-0.5 rounded-full">Inactive</span>}
                        </div>
                        <p className="text-gray-500 text-xs mt-0.5">{c.phone} · by {users.find(u => u.id === c.assignedSalesId)?.name ?? '—'}</p>
                      </div>
                      <span className={`text-xs font-medium ${overallCls}`}>
                        {isTrashed ? 'Trashed' : hasApproved ? 'Approved' : allRejected ? 'All Rejected' : `${apps.length} bank${apps.length > 1 ? 's' : ''} pending`}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {apps.map(app => (
                        <span key={app.bank} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${isTrashed ? 'bg-gray-700/40 text-gray-600' : BANK_CLS[app.status] ?? 'bg-gray-500/20 text-gray-400'}`}>
                          {BANK_ICON[app.status]} {app.bank}
                          {!isTrashed && app.status === 'rejected' && (
                            <button
                              onClick={() => {
                                const updated = apps.filter(a => a.bank !== app.bank);
                                updateCustomer(c.id, { loanApplications: updated });
                              }}
                              className="ml-1 hover:text-red-300 transition-colors"
                              title="Remove rejected entry"
                            >
                              <Trash2 size={10} />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* ── Final Deal tab ── */}
        {jobTab === 'final_deal' && (() => {
          const deal = car.finalDeal!;
          const soldCustomer = customers.find(
            c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder)
          );
          const wo = soldCustomer?.loanWorkOrder ?? soldCustomer?.cashWorkOrder;
          const isLoan = !!soldCustomer?.loanWorkOrder;
          const approvedByUser = users.find(u => u.id === deal.approvedBy);

          const DRow = ({ label, value, valueClass, border = true }: { label: string; value: React.ReactNode; valueClass?: string; border?: boolean }) => (
            <div className={`flex justify-between items-center py-2.5 ${border ? 'border-b border-obsidian-400/30' : ''}`}>
              <span className="text-gray-500 text-sm">{label}</span>
              <span className={`text-sm font-medium text-right ${valueClass ?? 'text-white'}`}>{value}</span>
            </div>
          );

          const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
            <div className="px-5 py-4 border-b border-obsidian-400/30 last:border-0">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{title}</p>
              {children}
            </div>
          );

          const sellingPrice = wo?.sellingPrice ?? deal.dealPrice;
          const purchasePrice = car.purchasePrice;
          const discount = wo?.discount ?? 0;
          const insurance = wo?.insurance ?? 0;
          const bankProduct = wo?.bankProduct ?? 0;
          const additionalItems = wo?.additionalItems ?? [];
          const additionalTotal = additionalItems.reduce((s, i) => s + i.amount, 0);
          const loanAmount = isLoan ? ((wo as any)?.loanAmount ?? 0) : 0;
          // Salesman balance: total payable minus loan amount = amount to collect from customer
          const balance = sellingPrice - discount + insurance + bankProduct + additionalTotal - loanAmount;


          // Director profit
          const dealNetPrice = sellingPrice - discount;
          const profitBeforeCommission = dealNetPrice - purchasePrice - totalRepairCost - totalMiscCost - additionalTotal;
          const commission = (() => {
            if (car.priceFloor != null) {
              return dealNetPrice >= car.priceFloor
                ? (profitBeforeCommission >= 10000 ? 2000 : 1500)
                : 1000;
            }
            return profitBeforeCommission >= 10000 ? 1500 : 1000;
          })();
          const netProfit = profitBeforeCommission - commission;

          return (
            <div className="divide-y-0">
              {/* Deal approval summary */}
              <Section title="Deal Approval">
                <DRow label="Status" value={
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    car.status === 'sold' || car.status === 'delivered' ? 'bg-green-500/20 text-green-400' :
                    deal.approvalStatus === 'rejected' ? 'bg-red-500/20 text-red-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {deal.approvalStatus === 'rejected' ? 'Rejected' : (STATUS_LABEL[car.status] ?? car.status)}
                  </span>
                } />
                <DRow label="Submitted At" value={new Date(deal.submittedAt).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} />
                {deal.approvedBy && <DRow label="Approved By" value={approvedByUser?.name ?? deal.approvedBy} />}
                {deal.approvedAt && <DRow label="Approved At" value={new Date(deal.approvedAt).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} />}
                {deal.rejectionNotes && <DRow label="Rejection Notes" value={deal.rejectionNotes} valueClass="text-red-400" />}
                {deal.notes && <DRow label="Notes" value={deal.notes} border={false} />}
              </Section>

              {/* View toggle (director only) */}
              {isDirector && (
                <div className="px-5 py-3 border-b border-obsidian-400/30 flex gap-2">
                  <button
                    onClick={() => setDealView('salesman')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${dealView === 'salesman' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white bg-obsidian-600/40'}`}
                  >
                    Salesman View
                  </button>
                  <button
                    onClick={() => setDealView('director')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${dealView === 'director' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white bg-obsidian-600/40'}`}
                  >
                    Director View
                  </button>
                </div>
              )}

              {/* ── Salesman View: collection balance (loan only) ── */}
              {(dealView === 'salesman' || !isDirector) && isLoan && wo && (
                <Section title="Collection Balance">
                  <DRow label="Selling Price" value={formatRM(sellingPrice)} valueClass="text-gold-400 font-bold" />
                  {discount > 0 && <DRow label="− Discount" value={formatRM(discount)} valueClass="text-red-400" />}
                  {insurance > 0 && <DRow label="+ Insurance" value={formatRM(insurance)} valueClass="text-white" />}
                  {bankProduct > 0 && <DRow label="+ Bank Product" value={formatRM(bankProduct)} valueClass="text-white" />}
                  {additionalItems.map((item, i) => (
                    <DRow key={i} label={`+ ${item.label}`} value={formatRM(item.amount)} valueClass="text-white" />
                  ))}
                  {loanAmount > 0 && <DRow label="− Loan Amount" value={formatRM(loanAmount)} valueClass="text-red-400" />}
                  <div className={`flex justify-between items-center pt-3 mt-1 border-t-2 ${Math.abs(balance) < 0.01 ? 'border-green-500/40' : 'border-red-500/40'}`}>
                    <span className="text-white font-semibold text-sm">Balance</span>
                    <div className="text-right">
                      <span className={`text-lg font-bold ${Math.abs(balance) < 0.01 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatRM(balance)}
                      </span>
                      <p className={`text-xs mt-0.5 ${Math.abs(balance) < 0.01 ? 'text-green-500' : 'text-red-400'}`}>
                        {Math.abs(balance) < 0.01 ? '✓ Balanced' : 'Amounts do not balance'}
                      </p>
                    </div>
                  </div>
                </Section>
              )}

              {/* ── Director View: profit breakdown ── */}
              {(dealView === 'director' && isDirector) && (
                <Section title="Deal Financials">
                  {car.priceFloor != null && (
                    <div className="flex justify-between items-center px-5 py-1.5 mb-1 bg-blue-500/5 rounded-lg border border-blue-500/20 mx-5">
                      <span className="text-blue-400 text-xs font-medium">Floor Price</span>
                      <span className="text-blue-400 text-xs font-bold">{formatRM(car.priceFloor)}</span>
                    </div>
                  )}
                  <DRow label="Selling Price" value={formatRM(sellingPrice)} valueClass="text-gold-400 font-bold" />
                  {discount > 0 && <DRow label="− Discount" value={formatRM(discount)} valueClass="text-red-400" />}
                  <DRow label="− Purchase Price" value={formatRM(purchasePrice)} valueClass="text-red-400" />
                  {totalRepairCost > 0 && <DRow label="− Repair Expenses" value={formatRM(totalRepairCost)} valueClass="text-red-400" />}
                  {additionalTotal > 0 && <DRow label="− Additional Expenses" value={formatRM(additionalTotal)} valueClass="text-red-400" />}
                  <DRow label="− Salesman Commission" value={formatRM(commission)} valueClass="text-purple-400" />
                  {car.priceFloor != null && (
                    <p className="text-xs text-gray-500 text-right pr-5 pb-1">
                      Deal ({formatRM(dealNetPrice)}) {dealNetPrice >= car.priceFloor ? '≥' : '<'} floor → {commission === 1000 ? 'RM 1,000 fixed' : commission === 2000 ? 'RM 2,000 (profit ≥ 10k)' : 'RM 1,500 (profit < 10k)'}
                    </p>
                  )}
                  <div className="flex justify-between items-center pt-3 mt-1 border-t-2 border-obsidian-400/50">
                    <span className="text-white font-semibold">Net Profit</span>
                    <span className={`text-lg font-bold ${netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {netProfit < 0 ? `− ${formatRM(Math.abs(netProfit))}` : formatRM(netProfit)}
                    </span>
                  </div>
                </Section>
              )}

              {/* For non-loan deals, always show regular financials */}
              {!isLoan && (
                <Section title="Deal Financials">
                  <DRow label="Selling Price" value={formatRM(sellingPrice)} valueClass="text-gold-400 font-bold" />
                  {isDirector && (
                    <>
                      <DRow label="Purchase Price" value={`− ${formatRM(purchasePrice)}`} valueClass="text-red-400" />
                      {discount > 0 && <DRow label="Discount" value={`− ${formatRM(discount)}`} valueClass="text-red-400" />}
                      {insurance > 0 && <DRow label="Insurance" value={`− ${formatRM(insurance)}`} valueClass="text-red-400" />}
                      {bankProduct > 0 && <DRow label="Bank Product" value={`− ${formatRM(bankProduct)}`} valueClass="text-red-400" />}
                      <DRow label="Salesman Commission" value={`− ${formatRM(commission)}`} valueClass="text-red-400" />
                      {totalRepairCost > 0 && <DRow label="Repair Expenses" value={`− ${formatRM(totalRepairCost)}`} valueClass="text-red-400" />}
                      {additionalTotal > 0 && <DRow label="Additional Expenses" value={`− ${formatRM(additionalTotal)}`} valueClass="text-red-400" />}
                      <div className="flex justify-between items-center pt-3 mt-1 border-t-2 border-obsidian-400/50">
                        <span className="text-white font-semibold">Net Profit</span>
                        <span className={`text-lg font-bold ${netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {netProfit >= 0 ? '' : '− '}{formatRM(Math.abs(netProfit))}
                        </span>
                      </div>
                    </>
                  )}
                </Section>
              )}

              {/* Work order breakdown */}
              {wo && (
                <Section title={isLoan ? 'Loan Work Order' : 'Cash Work Order'}>
                  {isLoan
                    ? <DRow label="Loan Amount" value={formatRM((wo as any).loanAmount ?? 0)} valueClass="text-gold-400 font-bold" border={false} />
                    : (
                      <>
                        <DRow label="Selling Price" value={formatRM(wo.sellingPrice)} />
                        {wo.discount > 0 && <DRow label="Discount" value={`− ${formatRM(wo.discount)}`} valueClass="text-red-400" />}
                        {wo.insurance > 0 && <DRow label="Insurance" value={formatRM(wo.insurance)} />}
                        {wo.bankProduct > 0 && <DRow label="Bank Product" value={formatRM(wo.bankProduct)} />}
                        {wo.bookingFee > 0 && <DRow label="Booking Fee / Deposit" value={formatRM(wo.bookingFee)} />}
                        {(wo as any).downpayment > 0 && <DRow label="Downpayment" value={formatRM((wo as any).downpayment)} />}
                        {wo.additionalItems?.length > 0 && wo.additionalItems.map((item, i) => (
                          <DRow key={i} label={item.label} value={formatRM(item.amount)} />
                        ))}
                        <div className="mt-3 pt-3 border-t border-obsidian-400/40 flex justify-between items-center">
                          <span className="text-white text-sm font-semibold">Final Amount</span>
                          <span className="text-gold-400 text-base font-bold">
                            {formatRM(wo.sellingPrice - wo.discount + wo.insurance + wo.bankProduct + additionalTotal)}
                          </span>
                        </div>
                      </>
                    )
                  }
                </Section>
              )}

              {/* Customer info */}
              {wo && (
                <Section title="Customer">
                  <DRow label="Name" value={wo.customerName} />
                  <DRow label="IC" value={wo.customerIc || '—'} />
                  <DRow label="Phone" value={wo.customerPhone || '—'} />
                  {wo.customerEmail && <DRow label="Email" value={wo.customerEmail} />}
                  {wo.customerAddress && <DRow label="Address" value={wo.customerAddress} valueClass="text-gray-300 text-right max-w-[200px]" border={false} />}
                </Section>
              )}

              {/* Trade-in */}
              {wo?.hasTradeIn && (
                <Section title="Trade-In">
                  <DRow label="Vehicle" value={`${wo.tradeInMake} ${wo.tradeInModel}${wo.tradeInVariant ? ` ${wo.tradeInVariant}` : ''}`} />
                  <DRow label="Plate" value={wo.tradeInPlate || '—'} />
                  <DRow label="Trade-In Value" value={formatRM(wo.tradeInPrice)} valueClass="text-green-400" />
                  {wo.settlementFigure > 0 && <DRow label="Settlement" value={formatRM(wo.settlementFigure)} valueClass="text-orange-400" border={false} />}
                </Section>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Mechanic Checklist ── (visible to mechanic and director) */}
      {(isMechanic || isDirector) && (car.status === 'in_workshop' || car.status === 'ready') && (
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
          <SectionHeader icon={CheckSquare} title="Pre-Ready Checklist" color="text-gold-400" />
          <div className="p-5 space-y-3">
            {checklist.map((item, i) => (
              <button
                key={item.id}
                onClick={() => (isMechanic || isDirector) ? toggleChecklistItem(i) : undefined}
                className="w-full flex items-center gap-3 group hover:bg-obsidian-700/50 px-3 py-2 rounded-lg transition-colors text-left"
              >
                {item.checked ? (
                  <CheckSquare size={18} className="text-gold-400 flex-shrink-0" />
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
                className="w-full mt-4 btn-gold text-white py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Check size={16} />
                Mark Car as Ready
              </button>
            )}
            {car.status === 'ready' && (
              <div className="flex items-center gap-2 text-gold-400 text-sm font-medium mt-2">
                <Check size={16} />
                Car marked as ready
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Photo Section ── (visible to salesperson and director when car is ready/photo_complete) */}
      {(isSalesperson || isDirector) && (car.status === 'ready' || car.status === 'photo_complete') && (
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
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
                  <div key={sp.id} className="flex items-center justify-between bg-obsidian-700/60 rounded-lg px-4 py-3 border border-obsidian-400/60">
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
              <p className="text-gold-400 text-sm font-medium text-center">All photos complete.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Delivery ── (salesperson when deal approved / sold) */}
      {(isSalesperson || isDirector) && car.status === 'sold' && (
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
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
                    <img src={car.deliveryPhoto} alt="Delivery" className="w-48 h-32 object-cover rounded-lg border border-obsidian-400/60 hover:opacity-80 transition-opacity" />
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
          <FormField label="Car Plate">
            <input className={inputCls()} value={editForm.carPlate ?? ''} onChange={(e) => setEditForm({ ...editForm, carPlate: e.target.value.toUpperCase() })} placeholder="e.g. WXX 1234" />
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
          {isDirector && (
            <FormField label="Floor Price (RM) — Lowest acceptable deal" className="col-span-2">
              <input
                type="number"
                className={inputCls()}
                value={editForm.priceFloor ?? ''}
                onChange={(e) => setEditForm({ ...editForm, priceFloor: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="e.g. 55800 — below this = RM1k commission"
              />
              <p className="text-gray-600 text-xs mt-1">Deal ≥ floor → 2k or 1.5k commission · Deal below floor → 1k commission</p>
            </FormField>
          )}
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
              <option value="delivered">Delivered</option>
            </select>
          </FormField>

          <FormField label="Notes" className="col-span-2">
            <textarea className={`${inputCls()} h-20 resize-none`} value={editForm.notes ?? ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
          </FormField>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={() => setShowEditModal(false)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleEditSubmit} className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm">Save Changes</button>
        </div>
      </Modal>

      {/* ── Misc Cost Modal ── */}
      <Modal isOpen={showMiscModal} onClose={() => setShowMiscModal(false)} title="Add Misc Cost" maxWidth="max-w-xl">
        <div className="space-y-4">
          {(() => {
            const merchantCategories = Array.from(new Set(merchants.map(m => m.category).filter(Boolean))) as string[];
            const filteredMerchants = miscForm.category
              ? merchants.filter(m => m.category === miscForm.category)
              : merchants;
            return (
              <>
                <FormField label="Category" error={miscErrors.category}>
                  {merchantCategories.length === 0 ? (
                    <p className="text-xs text-gray-500 py-2">
                      No categories yet — add merchants in <span className="text-gold-400">Data → Misc</span>
                    </p>
                  ) : (
                    <select
                      className={inputCls(miscErrors.category)}
                      value={miscForm.category}
                      onChange={(e) => setMiscForm({ ...miscForm, category: e.target.value, merchantName: '' })}
                    >
                      <option value="">All categories</option>
                      {merchantCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                </FormField>

                <FormField label="Merchant" error={miscErrors.merchantName}>
                  {merchants.length === 0 ? (
                    <p className="text-xs text-gray-500 py-2">
                      No merchants yet — add one in <span className="text-gold-400">Data → Misc</span>
                    </p>
                  ) : filteredMerchants.length === 0 ? (
                    <p className="text-xs text-gray-500 py-2">
                      No merchants under <span className="text-white">{miscForm.category}</span> — add one in <span className="text-gold-400">Data → Misc</span>
                    </p>
                  ) : (
                    <select
                      className={inputCls(miscErrors.merchantName)}
                      value={miscForm.merchantName}
                      onChange={(e) => setMiscForm({ ...miscForm, merchantName: e.target.value })}
                    >
                      <option value="">Select merchant...</option>
                      {filteredMerchants.map((m) => (
                        <option key={m.id} value={m.name}>{m.name}{m.phone ? ` — ${m.phone}` : ''}</option>
                      ))}
                    </select>
                  )}
                </FormField>
              </>
            );
          })()}

          <FormField label="Description" error={miscErrors.description}>
            <input
              className={inputCls(miscErrors.description)}
              placeholder="e.g. Road tax renewal, JPJ fee..."
              value={miscForm.description}
              onChange={(e) => setMiscForm({ ...miscForm, description: e.target.value })}
            />
          </FormField>

          <FormField label="Amount (RM) *" error={miscErrors.amount}>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputCls(miscErrors.amount)}
              placeholder="0.00"
              value={miscForm.amount}
              onChange={(e) => setMiscForm({ ...miscForm, amount: e.target.value })}
            />
          </FormField>

          <FormField label="Notes">
            <textarea
              className={`${inputCls()} h-16 resize-none`}
              placeholder="Additional notes..."
              value={miscForm.notes}
              onChange={(e) => setMiscForm({ ...miscForm, notes: e.target.value })}
            />
          </FormField>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowMiscModal(false)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button
            onClick={async () => {
              const errs: Record<string, string> = {};
              const amt = parseFloat(miscForm.amount);
              if (!miscForm.amount || isNaN(amt) || amt <= 0) errs.amount = 'Enter a valid amount';
              if (Object.keys(errs).length) { setMiscErrors(errs); return; }
              await addMiscCost(car!.id, {
                id: generateId(),
                description: miscForm.description.trim() || miscForm.merchantName || miscForm.category || 'Misc',
                amount: amt,
                category: miscForm.category || undefined,
                merchant: miscForm.merchantName || undefined,
                createdAt: new Date().toISOString(),
                createdBy: currentUser?.id,
              });
              setShowMiscModal(false);
            }}
            className="flex-1 bg-purple-600 hover:bg-purple-500 px-4 py-2.5 rounded-lg text-sm text-white"
          >
            Add Misc Cost
          </button>
        </div>
      </Modal>

      {/* ── Add Repair Modal ── */}
      <Modal isOpen={showRepairModal} onClose={() => setShowRepairModal(false)} title="Add Repair Job" maxWidth="max-w-xl">
        <div className="space-y-4">
          {(() => {
            const repairTypes = Array.from(new Set(workshops.map(w => w.speciality).filter(Boolean))) as string[];
            const filteredWorkshops = repairForm.typeOfRepair
              ? workshops.filter(w => w.speciality === repairForm.typeOfRepair)
              : [];
            return (
              <>
                <FormField label="Type of Repair" error={repairErrors.typeOfRepair}>
                  {repairTypes.length === 0 ? (
                    <p className="text-xs text-gray-500 py-2">
                      No repair types yet — add workshops with a speciality in <span className="text-gold-400">Data → Workshops</span>
                    </p>
                  ) : (
                    <select
                      className={inputCls(repairErrors.typeOfRepair)}
                      value={repairForm.typeOfRepair}
                      onChange={(e) => setRepairForm({ ...repairForm, typeOfRepair: e.target.value, location: '' })}
                    >
                      <option value="">Select type...</option>
                      {repairTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}
                </FormField>

                <FormField label="Send to Workshop" error={repairErrors.location}>
                  {!repairForm.typeOfRepair ? (
                    <p className="text-xs text-gray-500 py-2">Select a repair type first</p>
                  ) : filteredWorkshops.length === 0 ? (
                    <p className="text-xs text-gray-500 py-2">
                      No <span className="text-white">{repairForm.typeOfRepair}</span> workshops — add one in <span className="text-gold-400">Data → Workshops</span>
                    </p>
                  ) : (
                    <select
                      className={inputCls(repairErrors.location)}
                      value={repairForm.location}
                      onChange={(e) => setRepairForm({ ...repairForm, location: e.target.value })}
                    >
                      <option value="">Select workshop...</option>
                      {filteredWorkshops.map((w) => (
                        <option key={w.id} value={w.name}>{w.name}{w.phone ? ` — ${w.phone}` : ''}</option>
                      ))}
                    </select>
                  )}
                </FormField>
              </>
            );
          })()}

          <div>
            <label className="block text-gray-300 text-xs font-medium mb-2">Parts (optional)</label>
            <div className="space-y-2">
              {repairForm.parts.map((part, i) => (
                <div key={i} className="flex gap-2">
                  <input className={`flex-1 ${inputCls()}`} placeholder="Part name" value={part.name} onChange={(e) => updatePart(i, 'name', e.target.value)} />
                  <input type="number" className="w-28 bg-obsidian-700/60 border border-obsidian-400/60 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500" placeholder="RM" value={part.cost} onChange={(e) => updatePart(i, 'cost', Number(e.target.value))} />
                  {repairForm.parts.length > 1 && (
                    <button onClick={() => removePart(i)} className="text-red-400 hover:text-red-300 transition-colors px-1"><Trash2 size={15} /></button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addPartRow} className="text-gold-400 text-xs mt-2 flex items-center gap-1 hover:text-gold-300 transition-colors">
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
            {car.status === 'delivered'
              ? 'Repair will be logged against this delivered unit. Status remains Delivered.'
              : <>Adding this repair will mark the car as <span className="font-semibold">In Workshop</span> and update its location to the garage above.</>
            }
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowRepairModal(false)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleRepairSubmit} className="flex-1 bg-orange-500 hover:bg-orange-400 px-4 py-2.5 rounded-lg text-sm">Send Out for Repair</button>
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
                <img src={completeForm.receiptPhoto} alt="Receipt" className="w-32 h-24 object-cover rounded-lg border border-obsidian-400/60" />
                <button onClick={() => setCompleteForm({ ...completeForm, receiptPhoto: '' })} className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => receiptRef.current?.click()}
                className="w-full border-2 border-dashed border-obsidian-400/60 hover:border-gold-500/50 rounded-lg p-4 flex flex-col items-center gap-2 text-gray-600 hover:text-gold-400 transition-colors"
              >
                <Upload size={18} />
                <span className="text-xs">Upload receipt photo</span>
              </button>
            )}
            <input ref={receiptRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
              if (e.target.files?.[0]) {
                const url = await uploadToStorage(e.target.files[0], 'receipts');
                setCompleteForm({ ...completeForm, receiptPhoto: url });
              }
            }} />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowCompleteModal(false)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleCompleteRepair} className="flex-1 bg-green-500 hover:bg-green-400 px-4 py-2.5 rounded-lg text-sm">Confirm Done</button>
        </div>
      </Modal>

      {/* ── Photo Gallery Modal ── */}
      {showGallery && allPhotos.length > 0 && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={() => { setShowGallery(false); setEditingPhotos(false); }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <span className="text-white font-semibold text-sm">{car.year} {car.make} {car.model}</span>
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm">{galleryIndex + 1} / {allPhotos.length}</span>
              {(isDirector || isSalesperson) && (
                <button
                  onClick={() => setEditingPhotos((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${editingPhotos ? 'bg-gold-500 text-black' : 'bg-obsidian-700 text-gray-300 hover:text-white'}`}
                >
                  <Edit size={13} /> {editingPhotos ? 'Done' : 'Edit'}
                </button>
              )}
              <button
                onClick={() => downloadPhoto(allPhotos[galleryIndex], galleryIndex)}
                className="p-1.5 text-gray-400 hover:text-white transition-colors"
              >
                <Download size={18} />
              </button>
              <button onClick={() => { setShowGallery(false); setEditingPhotos(false); }} className="p-1.5 text-gray-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Edit toolbar */}
          {editingPhotos && (
            <div className="flex items-center gap-2 px-4 pb-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => replacePhotoRef.current?.click()}
                disabled={photoUploading}
                className="flex items-center gap-1.5 bg-blue-500/20 border border-blue-500/40 text-blue-300 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-50"
              >
                <Upload size={13} /> Replace
              </button>
              <button
                onClick={() => addPhotoRef.current?.click()}
                disabled={photoUploading}
                className="flex items-center gap-1.5 bg-green-500/20 border border-green-500/40 text-green-300 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-500/30 transition-colors disabled:opacity-50"
              >
                <Plus size={13} /> Add Photos
              </button>
              <button
                onClick={handleDeletePhoto}
                disabled={photoUploading}
                className="flex items-center gap-1.5 bg-red-500/20 border border-red-500/40 text-red-300 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50"
              >
                <Trash2 size={13} /> Delete
              </button>
              {photoUploading && (
                <div className="flex items-center gap-1.5 text-gold-400 text-xs">
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Uploading...
                </div>
              )}
              <input ref={replacePhotoRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleReplacePhoto(e.target.files)} />
              <input ref={addPhotoRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleAddPhotos(e.target.files)} />
            </div>
          )}

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
                  className={`flex-shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition-colors ${i === galleryIndex ? 'border-gold-400' : 'border-transparent opacity-50 hover:opacity-80'}`}
                >
                  <img
                    src={src}
                    alt={`thumb-${i}`}
                    className="w-full h-full object-cover opacity-0 transition-opacity duration-200"
                    loading="lazy"
                    onLoad={(e) => e.currentTarget.classList.replace('opacity-0', 'opacity-100')}
                  />
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
                <img src={deliveryPhoto} alt="Delivery" className="w-full h-40 object-cover rounded-lg border border-obsidian-400/60" />
                <button onClick={() => setDeliveryPhoto('')} className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-0.5">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => deliveryRef.current?.click()}
                className="w-full border-2 border-dashed border-obsidian-400/60 hover:border-green-500/50 rounded-lg p-4 flex flex-col items-center gap-2 text-gray-600 hover:text-green-400 transition-colors"
              >
                <Upload size={18} />
                <span className="text-xs">Upload delivery photo</span>
              </button>
            )}
            <input ref={deliveryRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
              if (e.target.files?.[0]) {
                const url = await uploadToStorage(e.target.files[0], 'delivery');
                setDeliveryPhoto(url);
              }
            }} />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowDeliveryModal(false)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleDeliverySubmit} className="flex-1 bg-green-500 hover:bg-green-400 px-4 py-2.5 rounded-lg text-sm">
            Confirm Delivered
          </button>
        </div>
      </Modal>

      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) await deleteTarget.action(); }}
        itemName={deleteTarget?.label ?? ''}
      />

      {/* ── Edit Deal Modal ── */}
      <Modal isOpen={showEditDeal} onClose={() => setShowEditDeal(false)} title="Edit Deal Details" maxWidth="max-w-md">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">

          {/* Bank (loan only) */}
          {dealIsLoan && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Bank</label>
              <input
                className="input w-full"
                value={editDealForm.bank}
                onChange={e => setEditDealForm(f => ({ ...f, bank: e.target.value }))}
                placeholder="Bank name"
              />
            </div>
          )}

          {/* Core financials */}
          {([
            { key: 'sellingPrice', label: 'Selling Price' },
            { key: 'discount', label: 'Discount' },
            { key: 'insurance', label: 'Insurance' },
            { key: 'bankProduct', label: 'Bank Product' },
            ...(dealIsLoan ? [{ key: 'loanAmount', label: 'Loan Amount' }] : [{ key: 'downpayment', label: 'Downpayment' }]),
            { key: 'bookingFee', label: 'Deposit / Booking Fee' },
          ] as { key: keyof typeof editDealForm; label: string }[]).map(({ key, label }) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 mb-1">{label}</label>
              <input
                type="number"
                className="input w-full"
                value={(editDealForm[key] as number) || ''}
                onChange={e => setEditDealForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                placeholder="0.00"
                min={0}
              />
            </div>
          ))}

          {/* Additional items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500">Additional Items</label>
              <button
                onClick={() => setEditDealForm(f => ({ ...f, additionalItems: [...f.additionalItems, { label: '', amount: 0 }] }))}
                className="text-xs text-gold-400 hover:text-gold-300 flex items-center gap-1"
              >
                <Plus size={12} /> Add
              </button>
            </div>
            {editDealForm.additionalItems.length === 0 && (
              <p className="text-xs text-gray-600 italic">No additional items</p>
            )}
            {editDealForm.additionalItems.map((item, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  className="input flex-1 text-sm"
                  value={item.label}
                  onChange={e => setEditDealForm(f => ({ ...f, additionalItems: f.additionalItems.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))}
                  placeholder="Item name"
                />
                <input
                  type="number"
                  className="input w-28 text-sm"
                  value={item.amount || ''}
                  onChange={e => setEditDealForm(f => ({ ...f, additionalItems: f.additionalItems.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x) }))}
                  placeholder="0.00"
                  min={0}
                />
                <button
                  onClick={() => setEditDealForm(f => ({ ...f, additionalItems: f.additionalItems.filter((_, j) => j !== i) }))}
                  className="p-2 text-gray-500 hover:text-red-400 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          {/* Balance preview (loan only) */}
          {dealIsLoan && (() => {
            const { sellingPrice, discount, insurance, bankProduct, loanAmount, additionalItems } = editDealForm;
            const addTotal = additionalItems.reduce((s, x) => s + x.amount, 0);
            const bal = sellingPrice - discount + insurance + bankProduct + addTotal - loanAmount;
            return (
              <div className={`rounded-lg px-4 py-3 border ${Math.abs(bal) < 0.01 ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Balance</span>
                  <span className={`text-sm font-bold ${Math.abs(bal) < 0.01 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatRM(bal)}
                  </span>
                </div>
                <p className={`text-xs mt-0.5 ${Math.abs(bal) < 0.01 ? 'text-green-600' : 'text-red-500'}`}>
                  {Math.abs(bal) < 0.01 ? '✓ Balanced' : 'Amounts do not balance to zero'}
                </p>
              </div>
            );
          })()}
        </div>

        <div className="flex gap-3 mt-5 pt-4 border-t border-obsidian-400/30">
          <button onClick={() => setShowEditDeal(false)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">
            Cancel
          </button>
          <button
            onClick={handleSaveDeal}
            disabled={savingDeal}
            className="flex-1 px-4 py-2.5 btn-gold rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingDeal ? 'Saving…' : 'Save Changes'}
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

export default function CarDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  return <CarDetailContent id={id!} onBack={() => navigate('/inventory')} />;
}
