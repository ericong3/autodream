import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { thumbUrl } from '../utils/photoUrl';
import {
  Search,
  LayoutGrid,
  List,
  Plus,
  Filter,
  ChevronDown,
  Car as CarIcon,
  AlertCircle,
  ImagePlus,
  X,
  FileText,
  Upload,
  MapPin,
  Trash2,
  Users,
  Clock,
  ClipboardList,
  Edit2,
  Check,
  Lock,
  CheckCircle,
  XCircle,
  RotateCcw,
  Calendar,
} from 'lucide-react';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';
import { Car, Customer, LoanWorkOrder, CashWorkOrder, PostSaleChecklist } from '../types';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from '../components/Modal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { formatRM, formatMileage, generateId } from '../utils/format';
import { SkeletonCard, SkeletonRow } from '../components/Skeleton';


// Loan/deal pipeline badge — based purely on case/loan progress, not car location
interface DealBadge { cls: string; label: string }

function getDealBadge(car: Car): DealBadge {
  if (car.status === 'coming_soon') {
    return { cls: 'bg-gray-500/80 text-white', label: 'Coming Soon' };
  }
  if (car.status === 'delivered') {
    return { cls: 'bg-violet-500/90 text-white', label: 'Sold · Delivered' };
  }
  if (car.status === 'sold' || car.finalDeal?.approvalStatus === 'approved') {
    return { cls: 'bg-violet-500/90 text-white', label: 'Sold · Pending Delivery' };
  }

  const submissions = car.loanSubmissions ?? [];
  const hasApproval = submissions.some((s) => s.status === 'approved');
  const hasPending  = submissions.some((s) => s.status === 'submitted');

  if (hasApproval) return { cls: 'bg-emerald-500/90 text-white', label: 'Approval Received' };
  if (hasPending)  return { cls: 'bg-blue-500/90 text-white',    label: 'Loan in Process' };

  return { cls: 'bg-teal-500/90 text-white', label: 'Available' };
}

const CAR_MAKES = ['All', 'Perodua', 'Proton', 'Honda', 'Toyota', 'Nissan', 'Other'];


const emptyForm: Omit<Car, 'id' | 'dateAdded'> = {
  make: '',
  model: '',
  variant: '',
  year: new Date().getFullYear(),
  carPlate: '',
  colour: '',
  mileage: 0,
  condition: 'good',
  purchasePrice: 0,
  sellingPrice: 0,
  transmission: 'auto',
  status: 'available',
  photo: '',
  photos: [],
  greenCard: '',
  assignedSalesperson: '',
  notes: '',
  currentLocation: 'Showroom',
  consignment: undefined,
  investorId: undefined,
  investorSplit: 50,
  sourceType: undefined,
  externalSalesmanId: undefined,
  sourceSalesmanId: undefined,
  sourceCommission: undefined,
  sourceSalesman: undefined,
  intakeCommission: undefined,
};

// ── Drag helpers ─────────────────────────────────────────────────────────────

function SortableCarItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.2 : 1,
        touchAction: 'none',    // must be inline — Tailwind class alone can miss iOS
        userSelect: 'none',     // prevent text selection fighting the drag
      }}
      {...attributes}
      {...listeners}
      className="touch-none cursor-grab active:cursor-grabbing"
      onDragStart={(e) => e.preventDefault()}   // block browser native image/element drag
    >
      {children}
    </div>
  );
}

function DragGhostCard({ car }: { car: Car }) {
  const photo = car.photos?.[0] || car.photo;
  return (
    <div
      className="bg-obsidian-900 rounded-xl overflow-hidden shadow-2xl border border-gold-500/50 pointer-events-none"
      style={{ width: 220, transform: 'rotate(2deg) scale(1.05)' }}
    >
      <div className="relative h-28">
        {photo
          ? <img src={photo} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-obsidian-800 flex items-center justify-center"><CarIcon size={28} className="text-gray-700" /></div>
        }
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-2.5">
          <p className="text-white text-xs font-semibold line-clamp-1">{car.year} {car.make} {car.model}</p>
          <p className="text-gold-400 text-xs font-bold mt-0.5">{formatRM(car.sellingPrice)}</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Inventory() {
  const cars = useStore((s) => s.cars);
  const users = useStore((s) => s.users);
  const customers = useStore((s) => s.customers);
  const repairs = useStore((s) => s.repairs);
  const currentUser = useStore((s) => s.currentUser);
  const addCar = useStore((s) => s.addCar);
  const updateCar = useStore((s) => s.updateCar);
  const deleteCar = useStore((s) => s.deleteCar);
  const dealers = useStore((s) => s.dealers);
  const externalSalesmen = useStore((s) => s.externalSalesmen);
  const viewPreference = useStore((s) => s.viewPreference);
  const setViewPreference = useStore((s) => s.setViewPreference);
  const updateCustomer = useStore((s) => s.updateCustomer);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const getLocation = (car: Car): string => {
    if (car.status === 'delivered') return 'Delivered';
    const activeRepair = repairs.some(r => r.carId === car.id && (r.status === 'pending' || r.status === 'in_progress'));
    return activeRepair ? (car.currentLocation ?? 'Showroom') : 'Showroom';
  };

  const isDirector = currentUser?.role === 'director';
  const isShareHolder = currentUser?.role === 'shareholder';
  const isDirectorView = isDirector || isShareHolder;
  const canAddCar = currentUser?.role === 'director' || currentUser?.role === 'salesperson';
  const viewKey = `${currentUser?.id}-inventory`;
  const view = viewPreference[viewKey] ?? 'grid';

  const [initialLoad, setInitialLoad] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setInitialLoad(false), 600);
    return () => clearTimeout(t);
  }, []);

  const tabParam = searchParams.get('tab');
  const [inventoryTab, setInventoryTab] = useState<'stock' | 'coming_soon' | 'pending_delivery'>(
    tabParam === 'coming_soon' ? 'coming_soon' : tabParam === 'pending_delivery' ? 'pending_delivery' : 'stock'
  );
  const [search, setSearch] = useState('');
  const [filterMake, setFilterMake] = useState('All');
  const [filterTransmission, setFilterTransmission] = useState('All');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortBy, setSortBy] = useState('dateAdded-desc');
  const [showModal, setShowModal] = useState(false);
  const [deleteCarId, setDeleteCarId] = useState<string | null>(null);
  const [woViewCar, setWoViewCar] = useState<{ car: Car; buyer: Customer } | null>(null);
  const [reviewDealCar, setReviewDealCar] = useState<Car | null>(null);
  const [woEditMode, setWoEditMode] = useState(false);
  const [woEditData, setWoEditData] = useState<Record<string, any>>({});
  const [woSaving, setWoSaving] = useState(false);
  const [woCancelConfirm, setWoCancelConfirm] = useState(false);
  const [woDeliveryConfirm, setWoDeliveryConfirm] = useState(false);
  const [woTab, setWoTab] = useState<'deal' | 'postsale'>('deal');
  const [form, setForm] = useState(emptyForm);
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [stockOrder, setStockOrder] = useState<string[]>([]);
  const [comingSoonOrder, setComingSoonOrder] = useState<string[]>([]);
  const [pendingOrder, setPendingOrder] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  // Swipe to change tab (mobile) — document-level listeners bypass browser scroll interception
  const TAB_ORDER = ['stock', 'coming_soon', 'pending_delivery'] as const;
  const swipeStartX = useRef<number | null>(null);
  const swipeStartY = useRef<number | null>(null);
  const inventoryTabRef = useRef(inventoryTab);
  inventoryTabRef.current = inventoryTab;
  const dragActiveRef = useRef(false);
  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      swipeStartX.current = e.touches[0].clientX;
      swipeStartY.current = e.touches[0].clientY;
    };
    const onEnd = (e: TouchEvent) => {
      if (swipeStartX.current === null || swipeStartY.current === null) return;
      const dx = swipeStartX.current - e.changedTouches[0].clientX;
      const dy = swipeStartY.current - e.changedTouches[0].clientY;
      swipeStartX.current = null;
      swipeStartY.current = null;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
      // Don't swipe when a modal/sheet is open (z-[500] portals)
      if (document.querySelector('[data-modal-open]')) return;
      // Don't swipe when a card drag is in progress
      if (dragActiveRef.current) return;
      const idx = TAB_ORDER.indexOf(inventoryTabRef.current);
      if (dx > 0 && idx < TAB_ORDER.length - 1) {
        const next = TAB_ORDER[idx + 1];
        setInventoryTab(next);
        setSearchParams(next === 'stock' ? {} : { tab: next });
      } else if (dx < 0 && idx > 0) {
        const prev = TAB_ORDER[idx - 1];
        setInventoryTab(prev);
        setSearchParams(prev === 'stock' ? {} : { tab: prev });
      }
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Auto-open add car modal when navigated here with ?add=1 (e.g. from QuickActions)
  useEffect(() => {
    if (searchParams.get('add') === '1' && canAddCar) {
      setForm(emptyForm);
      setErrors({});
      setSubmitError('');
      setShowModal(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const greenCardInputRef = useRef<HTMLInputElement>(null);
  const dragIndexRef = useRef<number | null>(null);

  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragIndexRef.current === null) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const photoEl = el?.closest('[data-photo-idx]') as HTMLElement | null;
    if (!photoEl) return;
    const targetIdx = Number(photoEl.dataset.photoIdx);
    const from = dragIndexRef.current;
    if (from === targetIdx) return;
    const updated = [...(form.photos ?? [])];
    const [moved] = updated.splice(from, 1);
    updated.splice(targetIdx, 0, moved);
    dragIndexRef.current = targetIdx;
    setForm((prev) => ({ ...prev, photos: updated, photo: updated[0] ?? '' }));
  };


  const compressImage = (file: File, maxWidth = 900, quality = 0.78): Promise<Blob> =>
    new Promise((resolve) => {
      const img = new Image();
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

  const handlePhotoFiles = async (files: FileList | null) => {
    if (!files) return;
    const valid = Array.from(files).filter((f) => f.type.startsWith('image/'));
    setUploadingPhotos(true);
    try {
      const urls = await Promise.all(valid.map((f) => uploadToStorage(f, 'cars')));
      const updated = [...(form.photos ?? []), ...urls].slice(0, 20);
      setForm((prev) => ({ ...prev, photos: updated, photo: updated[0] ?? prev.photo }));
      setErrors((prev) => ({ ...prev, photos: '' }));
    } catch (e) {
      setErrors((prev) => ({ ...prev, photos: 'Failed to upload photos. Please try again.' }));
    } finally {
      setUploadingPhotos(false);
    }
  };

  const removePhoto = (idx: number) => {
    const updated = (form.photos ?? []).filter((_, i) => i !== idx);
    setForm((prev) => ({ ...prev, photos: updated, photo: updated[0] ?? '' }));
  };

  const handleGreenCard = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const url = await uploadToStorage(file, 'greencards');
    setForm((prev) => ({ ...prev, greenCard: url }));
    setErrors((prev) => ({ ...prev, greenCard: '' }));
  };

  // Lead & deal stats per car
  const carStats = useMemo(() => {
    const map: Record<string, { leadCount: number }> = {};
    for (const c of customers) {
      if (c.interestedCarId) {
        map[c.interestedCarId] = { leadCount: (map[c.interestedCarId]?.leadCount ?? 0) + 1 };
      }
    }
    return map;
  }, [customers]);

  // Final deal price per car (confirmed customers only)
  const confirmedDealPrice = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of customers) {
      const wo = c.loanWorkOrder ?? c.cashWorkOrder;
      if (wo && c.interestedCarId) {
        map[c.interestedCarId] = wo.sellingPrice - (wo.discount ?? 0);
      }
    }
    return map;
  }, [customers]);

  // Net profit per car matching director view formula
  const carProfitMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const car of cars) {
      const customer = customers.find(c => c.interestedCarId === car.id && (c.loanWorkOrder || c.cashWorkOrder));
      const wo = customer?.loanWorkOrder ?? customer?.cashWorkOrder;
      const dealPrice = confirmedDealPrice[car.id] ?? car.finalDeal?.dealPrice ?? car.sellingPrice;
      const additionalTotal = wo?.additionalItems?.reduce((s, i) => s + i.amount, 0) ?? 0;
      const repairCosts = repairs.filter(r => r.carId === car.id && r.status === 'done').reduce((s, r) => s + (r.actualCost ?? r.totalCost), 0);
      const miscCosts = (car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0);
      const profitBeforeComm = dealPrice - car.purchasePrice - repairCosts - miscCosts - additionalTotal;
      const commission = car.outgoingConsignment ? 0 : (car.priceFloor != null && dealPrice < car.priceFloor) ? 1000 : 1500;
      map[car.id] = profitBeforeComm - commission;
    }
    return map;
  }, [cars, customers, repairs, confirmedDealPrice]);

  const comingSoonFiltered = useMemo(() => {
    let result = cars.filter((c) => c.status === 'coming_soon');
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c) =>
        (c.make ?? '').toLowerCase().includes(q) ||
        (c.model ?? '').toLowerCase().includes(q) ||
        (c.colour ?? '').toLowerCase().includes(q) ||
        String(c.year).includes(q) ||
        (c.carPlate ?? '').toLowerCase().includes(q)
      );
    }
    if (filterMake !== 'All') result = result.filter((c) => c.make === filterMake);
    return result.sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
  }, [cars, search, filterMake]);

  const consignedOut = useMemo(() =>
    cars.filter((c) => !!c.outgoingConsignment && c.status !== 'delivered'),
  [cars]);

  const pendingDelivery = useMemo(() =>
    cars.filter((c) => c.status === 'deal_pending'),
  [cars]);

  const filtered = useMemo(() => {
    // Stock tab: exclude delivered, coming_soon, deal_pending, and consigned-out cars
    let result = cars.filter((c) => c.status !== 'delivered' && c.status !== 'coming_soon' && c.status !== 'deal_pending' && !c.outgoingConsignment);

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          (c.make ?? '').toLowerCase().includes(q) ||
          (c.model ?? '').toLowerCase().includes(q) ||
          (c.colour ?? '').toLowerCase().includes(q) ||
          String(c.year).includes(q) ||
          (c.carPlate ?? '').toLowerCase().includes(q)
      );
    }
    if (filterMake !== 'All') result = result.filter((c) => c.make === filterMake);
    if (filterTransmission !== 'All')
      result = result.filter((c) => c.transmission === filterTransmission);
    if (filterStatus !== '')
      result = result.filter((c) => c.status === filterStatus);

    result.sort((a, b) => {
      switch (sortBy) {
        case 'dateAdded-desc':
          return new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
        case 'dateAdded-asc':
          return new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime();
        case 'price-asc':
          return a.sellingPrice - b.sellingPrice;
        case 'price-desc':
          return b.sellingPrice - a.sellingPrice;
        case 'brand-asc':
          return (a.make ?? '').localeCompare(b.make ?? '');
        default:
          return 0;
      }
    });

    return result;
  }, [cars, search, filterMake, filterTransmission, filterStatus, sortBy]);

  // Sync drag-order arrays — preserve user-defined order, only add/remove changed cars
  useEffect(() => {
    setStockOrder(prev => {
      const ids = filtered.map(c => c.id);
      const set = new Set(ids);
      return [...prev.filter(id => set.has(id)), ...ids.filter(id => !prev.includes(id))];
    });
  }, [filtered]);
  useEffect(() => {
    setComingSoonOrder(prev => {
      const ids = comingSoonFiltered.map(c => c.id);
      const set = new Set(ids);
      return [...prev.filter(id => set.has(id)), ...ids.filter(id => !prev.includes(id))];
    });
  }, [comingSoonFiltered]);
  useEffect(() => {
    setPendingOrder(prev => {
      const ids = pendingDelivery.map(c => c.id);
      const set = new Set(ids);
      return [...prev.filter(id => set.has(id)), ...ids.filter(id => !prev.includes(id))];
    });
  }, [pendingDelivery]);

  // Ordered views: use manual drag order, mapping back to car objects
  const filteredOrdered   = useMemo(() => stockOrder.map(id => filtered.find(c => c.id === id)).filter(Boolean) as Car[], [filtered, stockOrder]);
  const comingSoonOrdered = useMemo(() => comingSoonOrder.map(id => comingSoonFiltered.find(c => c.id === id)).filter(Boolean) as Car[], [comingSoonFiltered, comingSoonOrder]);
  const pendingOrdered    = useMemo(() => pendingOrder.map(id => pendingDelivery.find(c => c.id === id)).filter(Boolean) as Car[], [pendingDelivery, pendingOrder]);

  const isComingSoon = form.status === 'coming_soon';

  const handleSubmit = async () => {
    const newErrors: Record<string, string> = {};

    if (!form.make.trim()) newErrors.make = 'Make is required';
    if (!form.model.trim()) newErrors.model = 'Model is required';
    if (!form.colour.trim()) newErrors.colour = 'Colour is required';
    if (!isComingSoon && (form.photos?.length ?? 0) < 4) {
      newErrors.photos = 'Please upload at least 4 photos';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const newCar: Car = {
      ...form,
      id: generateId(),
      dateAdded: new Date().toISOString().split('T')[0],
      consignment: form.consignment?.terms === 'fixed_amount'
        ? { ...form.consignment, fixedAmount: form.purchasePrice || 0 }
        : form.consignment,
    };

    setSubmitting(true);
    setSubmitError('');
    try {
      await addCar(newCar);
      setShowModal(false);
      setForm(emptyForm);
      setErrors({});
      if (newCar.status === 'coming_soon') { setInventoryTab('coming_soon'); setSearchParams({ tab: 'coming_soon' }); }
    } catch (e: any) {
      setSubmitError(e.message || 'Failed to save car. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex gap-1 bg-[#0F0E0C] border border-obsidian-400/60 rounded-lg p-1 w-full sm:w-fit">
        <button
          onClick={() => { setInventoryTab('stock'); setSearchParams({}); }}
          className={`flex-1 sm:flex-none min-w-0 px-2 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${inventoryTab === 'stock' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white'}`}
        >
          Stock
          <span className={`shrink-0 text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full font-semibold ${inventoryTab === 'stock' ? 'bg-white/20' : 'bg-obsidian-600/60'}`}>
            {cars.filter(c => c.status !== 'delivered' && c.status !== 'coming_soon' && c.status !== 'deal_pending' && !c.outgoingConsignment).length}
          </span>
        </button>
        <button
          onClick={() => { setInventoryTab('coming_soon'); setSearchParams({ tab: 'coming_soon' }); }}
          className={`flex-1 sm:flex-none min-w-0 px-2 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${inventoryTab === 'coming_soon' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
        >
          <span className="hidden sm:inline">Coming Soon</span>
          <span className="sm:hidden">Soon</span>
          {cars.filter(c => c.status === 'coming_soon').length > 0 && (
            <span className={`shrink-0 text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full font-semibold ${inventoryTab === 'coming_soon' ? 'bg-white/20' : 'bg-purple-500/20 text-purple-400'}`}>
              {cars.filter(c => c.status === 'coming_soon').length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setInventoryTab('pending_delivery'); setSearchParams({ tab: 'pending_delivery' }); }}
          className={`flex-1 sm:flex-none min-w-0 px-2 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${inventoryTab === 'pending_delivery' ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}
        >
          <span className="hidden sm:inline">Pending Delivery</span>
          <span className="sm:hidden">Delivery</span>
          {pendingDelivery.length > 0 && (
            <span className={`shrink-0 text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full font-semibold ${inventoryTab === 'pending_delivery' ? 'bg-white/20' : 'bg-green-500/20 text-green-400'}`}>
              {pendingDelivery.length}
            </span>
          )}
        </button>
      </div>

      {/* Top bar — sticky */}
      <div className="sticky top-0 z-10 bg-obsidian-950/95 backdrop-blur-sm -mx-4 px-4 md:-mx-6 md:px-6 py-3 border-b border-obsidian-400/20">
        {/* Search + filters row */}
        <div className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search cars..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 pr-4 py-2.5"
            />
          </div>

          {/* Filters */}
          <Select value={filterMake} onChange={setFilterMake} options={CAR_MAKES} placeholder="Brand" />
          {inventoryTab === 'stock' && (
            <Select
              value={filterTransmission}
              onChange={setFilterTransmission}
              options={['All', 'auto', 'manual']}
              placeholder="Transmission"
            />
          )}
          {inventoryTab === 'stock' && (
            <Select
              value={filterStatus}
              onChange={setFilterStatus}
              options={['', 'available', 'coming_soon', 'in_workshop', 'ready', 'photo_complete', 'submitted', 'deal_pending', 'reserved', 'sold', 'delivered']}
              labels={['All Status', 'Available', 'Coming Soon', 'In Workshop', 'Ready', 'Photo Done', 'Submitted', 'Deal Pending', 'Reserved', 'Sold', 'Delivered']}
              placeholder="Status"
            />
          )}
          <Select
            value={sortBy}
            onChange={setSortBy}
            options={['dateAdded-desc', 'dateAdded-asc', 'price-asc', 'price-desc', 'brand-asc']}
            labels={['Newest First', 'Oldest First', 'Price: Low-High', 'Price: High-Low', 'Brand: A–Z']}
            placeholder="Sort"
          />

          {/* View toggle */}
          <div className="flex border border-obsidian-400/60 rounded-lg p-1 gap-1" style={{background:'#0E0D0B'}}>
            <button
              onClick={() => setViewPreference(currentUser!.id, 'inventory', 'grid')}
              className={`p-1.5 rounded-md transition-colors ${view === 'grid' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white'}`}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewPreference(currentUser!.id, 'inventory', 'list')}
              className={`p-1.5 rounded-md transition-colors ${view === 'list' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white'}`}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>

          {canAddCar && (
            <button
              onClick={() => { setForm(emptyForm); setErrors({}); setSubmitError(''); setShowModal(true); }}
              className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm"
            >
              <Plus size={16} />
              Add Car
            </button>
          )}
        </div>

      </div>

      {/* Count */}
      <p className="text-gray-500 text-sm">
        {inventoryTab === 'coming_soon'
          ? <>Showing <span className="text-white font-medium">{comingSoonFiltered.length}</span> coming soon</>
          : inventoryTab === 'pending_delivery'
          ? <><span className="text-green-400 font-medium">{pendingDelivery.length}</span> car{pendingDelivery.length !== 1 ? 's' : ''} sold, awaiting delivery</>
          : <>Showing <span className="text-white font-medium">{filtered.length}</span> of {cars.filter(c => c.status !== 'delivered' && c.status !== 'coming_soon' && c.status !== 'deal_pending' && !c.outgoingConsignment).length} active stock{consignedOut.length > 0 && <> · <span className="text-orange-400 font-medium">{consignedOut.length} consigned out</span></>}</>
        }
      </p>

      {/* ── Pending Delivery tab ── */}
      {inventoryTab === 'pending_delivery' && (
        <>
          {pendingDelivery.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-20 h-20 rounded-2xl bg-obsidian-800/60 border border-obsidian-400/30 flex items-center justify-center mb-5">
                <Clock size={36} className="text-gray-600" />
              </div>
              <p className="text-white font-semibold text-base">No pending deliveries</p>
              <p className="text-gray-500 text-sm mt-1.5">Cars with a submitted work order will appear here</p>
            </div>
          ) : view === 'grid' ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={(e) => { dragActiveRef.current = true; setDragActiveId(e.active.id as string); }}
              onDragEnd={(e) => {
                dragActiveRef.current = false;
                setDragActiveId(null);
                const { active, over } = e;
                if (!over || active.id === over.id) return;
                setPendingOrder(prev => {
                  const oi = prev.indexOf(active.id as string);
                  const ni = prev.indexOf(over.id as string);
                  return (oi >= 0 && ni >= 0) ? arrayMove(prev, oi, ni) : prev;
                });
              }}
              onDragCancel={() => { dragActiveRef.current = false; setDragActiveId(null); }}
            >
              <SortableContext items={pendingOrdered.map(c => c.id)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {pendingOrdered.map((car) => {
                    const buyer = customers.find(c => c.interestedCarId === car.id && (c.loanWorkOrder || c.cashWorkOrder));
                    const isLoan = !!buyer?.loanWorkOrder;
                    const wo = buyer?.loanWorkOrder ?? buyer?.cashWorkOrder;
                    const daysPending = car.finalDeal?.submittedAt
                      ? Math.floor((Date.now() - new Date(car.finalDeal.submittedAt).getTime()) / 86400000)
                      : null;
                    const needsApproval = car.finalDeal?.approvalStatus === 'pending';
                    return (
                      <SortableCarItem key={car.id} id={car.id}>
                        <div
                          onClick={() => navigate(`/inventory/${car.id}`)}
                          className="bg-card-gradient border border-green-500/30 hover:border-green-400/60 rounded-xl shadow-card overflow-hidden cursor-pointer hover:shadow-xl transition-all group"
                        >
                      {/* Photo */}
                      <div className="h-36 bg-obsidian-700/60 flex items-center justify-center relative">
                        {car.photo ? (
                          <img
                            src={car.photo}
                            alt={`${car.make} ${car.model}`}
                            className="w-full h-full object-cover opacity-0 transition-opacity duration-300"
                            loading="lazy"
                            onLoad={(e) => e.currentTarget.classList.replace('opacity-0', 'opacity-100')}
                          />
                        ) : (
                          <CarIcon size={40} className="text-gray-700 group-hover:text-gray-600 transition-colors" />
                        )}
                        <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/20 text-green-300 border border-green-500/30">
                          Pending
                        </span>
                        {needsApproval && (
                          <span className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            <AlertCircle size={10} />Approval
                          </span>
                        )}
                      </div>
                      {/* Info */}
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-white font-semibold text-sm truncate">{car.year} {car.make} {car.model}</p>
                            {car.carPlate && <p className="text-gray-500 text-xs truncate">{car.carPlate}</p>}
                          </div>
                          <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${isLoan ? 'bg-blue-500/15 text-blue-400' : 'bg-green-500/15 text-green-400'}`}>
                            {isLoan ? (wo as any)?.bank ?? 'Loan' : 'Cash'}
                          </span>
                        </div>
                        <div className="mt-3 pt-3 border-t border-obsidian-400/40 space-y-1.5">
                          <p className="text-white font-bold">{car.finalDeal ? formatRM(car.finalDeal.dealPrice) : '—'}</p>
                          {buyer && (
                            <div className="flex items-center gap-1.5">
                              <Users size={11} className="text-gray-500" />
                              <span className="text-gray-300 text-xs truncate">{buyer.name}</span>
                            </div>
                          )}
                          {daysPending !== null && (
                            <div className="flex items-center gap-1.5 text-gray-500 text-xs">
                              <Clock size={11} />
                              {daysPending === 0 ? 'Today' : `${daysPending}d ago`}
                            </div>
                          )}
                          {isDirector && car.finalDeal && car.finalDeal.approvalStatus !== 'approved' ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); buyer ? setWoViewCar({ car, buyer }) : setReviewDealCar(car); }}
                              className="w-full mt-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-400 text-xs font-semibold transition-colors touch-manipulation"
                            >
                              <AlertCircle size={12} />
                              Review Deal
                            </button>
                          ) : buyer && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setWoViewCar({ car, buyer }); }}
                              className="w-full mt-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-500/15 hover:bg-green-500/25 border border-green-500/30 text-green-400 text-xs font-semibold transition-colors touch-manipulation"
                            >
                              <ClipboardList size={12} />
                              Final Deal
                            </button>
                          )}
                        </div>
                      </div>
                        </div>
                      </SortableCarItem>
                    );
                  })}
                </div>
              </SortableContext>
              <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
                {dragActiveId && (() => { const c = cars.find(x => x.id === dragActiveId); return c ? <DragGhostCard car={c} /> : null; })()}
              </DragOverlay>
            </DndContext>
            ) : (
              <div className="space-y-3">
                {pendingDelivery.map((car) => {
                  const buyer = customers.find(c => c.interestedCarId === car.id && (c.loanWorkOrder || c.cashWorkOrder));
                  const isLoan = !!buyer?.loanWorkOrder;
                  const wo = buyer?.loanWorkOrder ?? buyer?.cashWorkOrder;
                  const daysPending = car.finalDeal?.submittedAt
                    ? Math.floor((Date.now() - new Date(car.finalDeal.submittedAt).getTime()) / 86400000)
                    : null;
                  const needsApproval = car.finalDeal?.approvalStatus === 'pending';
                  return (
                    <div
                      key={car.id}
                      onClick={() => navigate(`/inventory/${car.id}`)}
                      className="flex gap-4 p-4 rounded-2xl bg-obsidian-800/60 border border-obsidian-400/40 cursor-pointer hover:border-green-500/40 transition-colors group"
                    >
                      {/* Car photo */}
                      {car.photo ? (
                        <img src={car.photo} alt="" className="w-20 h-14 rounded-xl object-cover shrink-0" />
                      ) : (
                        <div className="w-20 h-14 rounded-xl bg-obsidian-700/60 flex items-center justify-center shrink-0">
                          <CarIcon size={20} className="text-gray-600" />
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-white font-semibold text-sm leading-snug">{car.year} {car.make} {car.model}</p>
                            <p className="text-gray-500 text-xs mt-0.5">{car.carPlate ?? '—'} · {car.colour}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-white font-bold text-sm">{car.finalDeal ? formatRM(car.finalDeal.dealPrice) : '—'}</p>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isLoan ? 'bg-blue-500/15 text-blue-400' : 'bg-green-500/15 text-green-400'}`}>
                              {isLoan ? (wo as any)?.bank ?? 'Loan' : 'Cash'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          {buyer && (
                            <div className="flex items-center gap-1.5">
                              <Users size={11} className="text-gray-500" />
                              <span className="text-gray-300 text-xs font-medium">{buyer.name}</span>
                            </div>
                          )}
                          {needsApproval && (
                            <span className="flex items-center gap-1 text-amber-400 text-xs font-semibold">
                              <AlertCircle size={11} />Awaiting director approval
                            </span>
                          )}
                          {!needsApproval && daysPending !== null && (
                            <span className="flex items-center gap-1 text-gray-500 text-xs">
                              <Clock size={11} />
                              {daysPending === 0 ? 'Today' : `${daysPending}d ago`}
                            </span>
                          )}
                        </div>
                        {isDirector && car.finalDeal && car.finalDeal.approvalStatus !== 'approved' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); setReviewDealCar(car); }}
                            className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-400 text-xs font-semibold transition-colors touch-manipulation"
                          >
                            <AlertCircle size={12} />
                            Review Deal
                          </button>
                        ) : buyer && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setWoViewCar({ car, buyer }); }}
                            className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-500/15 hover:bg-green-500/25 border border-green-500/30 text-green-400 text-xs font-semibold transition-colors touch-manipulation"
                          >
                            <ClipboardList size={12} />
                            Final Deal
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </>
      )}

      {/* ── Coming Soon tab ── */}
      {inventoryTab === 'coming_soon' && (
        <>
          {comingSoonFiltered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <CarIcon size={40} className="text-gray-600 mb-3" />
              <p className="text-gray-400 font-medium">No coming soon cars</p>
              <p className="text-gray-500 text-sm mt-1">Add a car and mark it as Coming Soon</p>
            </div>
          ) : view === 'grid' ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={(e) => { dragActiveRef.current = true; setDragActiveId(e.active.id as string); }}
              onDragEnd={(e) => {
                dragActiveRef.current = false;
                setDragActiveId(null);
                const { active, over } = e;
                if (!over || active.id === over.id) return;
                setComingSoonOrder(prev => {
                  const oi = prev.indexOf(active.id as string);
                  const ni = prev.indexOf(over.id as string);
                  return (oi >= 0 && ni >= 0) ? arrayMove(prev, oi, ni) : prev;
                });
              }}
              onDragCancel={() => { dragActiveRef.current = false; setDragActiveId(null); }}
            >
              <SortableContext items={comingSoonOrdered.map(c => c.id)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {comingSoonOrdered.map((car) => {
                    const inv = car.investorId ? users.find(u => u.id === car.investorId) : null;
                    return (
                      <SortableCarItem key={car.id} id={car.id}>
                        <div className="relative group/card">
                    {isDirector && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteCarId(car.id); }}
                        className="absolute top-2 right-2 z-10 p-1.5 bg-red-500/80 hover:bg-red-500 text-white rounded-lg opacity-0 group-hover/card:opacity-100 transition-opacity"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                    <div
                      onClick={() => navigate(`/inventory/${car.id}`)}
                      className="bg-card-gradient border border-purple-500/30 hover:border-purple-400/60 rounded-xl shadow-card overflow-hidden cursor-pointer hover:shadow-xl transition-all group"
                    >
                      {/* Photo */}
                      <div className="h-36 bg-obsidian-700/60 flex items-center justify-center relative">
                        {car.photo ? (
                          <img
                            src={car.photo}
                            alt={`${car.make} ${car.model}`}
                            className="w-full h-full object-cover opacity-0 transition-opacity duration-300"
                            loading="lazy"
                            onLoad={(e) => e.currentTarget.classList.replace('opacity-0', 'opacity-100')}
                          />
                        ) : (
                          <CarIcon size={40} className="text-gray-700 group-hover:text-gray-600 transition-colors" />
                        )}
                        <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          Coming Soon
                        </span>
                      </div>
                      {/* Info */}
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-white font-semibold text-sm truncate">{car.year} {car.make} {car.model}</p>
                            {car.variant && <p className="text-gray-500 text-xs truncate">{car.variant}</p>}
                          </div>
                          {car.carPlate && (
                            <span className="shrink-0 text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-[#2C2415] text-gold-300 border border-[#3C321E] tracking-wider">
                              {car.carPlate}
                            </span>
                          )}
                        </div>
                        <p className="text-gray-500 text-xs mt-1">{car.colour} · {car.transmission}</p>
                        {isDirectorView && inv && (
                          <p className="text-amber-400/80 text-xs mt-1">{inv.name} · {car.investorSplit ?? 50}%</p>
                        )}
                        <div className="mt-3 pt-3 border-t border-obsidian-400/40 space-y-2">
                          <p className="text-gold-400 font-bold">{formatRM(car.sellingPrice)}</p>
                          {isDirectorView && (
                            <p className="text-gray-600 text-xs">Cost: {formatRM(car.purchasePrice)}</p>
                          )}
                          {isDirector && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateCar(car.id, { status: 'available', carInDate: new Date().toISOString().split('T')[0] });
                                setInventoryTab('stock');
                                setSearchParams({});
                              }}
                              className="w-full mt-1 px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 text-xs font-semibold rounded-lg transition-colors"
                            >
                              Car In ✓
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                      </div>
                      </SortableCarItem>
                    );
                  })}
                </div>
              </SortableContext>
              <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
                {dragActiveId && (() => { const c = cars.find(x => x.id === dragActiveId); return c ? <DragGhostCard car={c} /> : null; })()}
              </DragOverlay>
            </DndContext>
          ) : (
            <div className="bg-card-gradient border border-purple-500/20 rounded-xl shadow-card divide-y divide-obsidian-400/60">
              {comingSoonFiltered.map((car) => {
                const inv = car.investorId ? users.find(u => u.id === car.investorId) : null;
                return (
                  <div
                    key={car.id}
                    onClick={() => navigate(`/inventory/${car.id}`)}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-obsidian-700/40 transition-colors cursor-pointer"
                  >
                    {/* Thumbnail */}
                    <div className="w-16 h-11 bg-obsidian-700/60 rounded-lg flex-shrink-0 flex items-center justify-center">
                      {car.photo
                        ? <img src={thumbUrl(car.photo, 200, 70)!} alt="" className="w-full h-full object-cover rounded-lg" loading="lazy" />
                        : <CarIcon size={18} className="text-gray-600" />
                      }
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-semibold text-sm">{car.year} {car.make} {car.model}</span>
                        {car.variant && <span className="text-gray-500 text-xs">{car.variant}</span>}
                        {car.carPlate && (
                          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-[#2C2415] text-gold-300 border border-[#3C321E] tracking-wider">
                            {car.carPlate}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
                        <span>{car.colour} · {car.transmission}</span>
                        {car.notes && <span className="truncate max-w-[200px] italic">{car.notes}</span>}
                        {isDirectorView && inv && (
                          <span className="text-amber-400/80">{inv.name} · {car.investorSplit ?? 50}%</span>
                        )}
                      </div>
                    </div>

                    {/* Price + actions */}
                    <div className="flex items-center gap-3 shrink-0" onClick={e => e.stopPropagation()}>
                      <div className="text-right">
                        <p className="text-gold-400 font-bold text-sm">{formatRM(car.sellingPrice)}</p>
                        {isDirectorView && (
                          <p className="text-gray-600 text-xs">Cost: {formatRM(car.purchasePrice)}</p>
                        )}
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 whitespace-nowrap">
                        Coming Soon
                      </span>
                      {isDirector && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateCar(car.id, { status: 'available', carInDate: new Date().toISOString().split('T')[0] });
                            setInventoryTab('stock');
                            setSearchParams({});
                          }}
                          className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                        >
                          Car In ✓
                        </button>
                      )}
                      {isDirector && (
                        <button
                          onClick={() => setDeleteCarId(car.id)}
                          className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Stock tab content ── */}
      {inventoryTab === 'stock' && <>

      {/* Empty state */}
      {!initialLoad && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-20 h-20 rounded-2xl bg-obsidian-800/60 border border-obsidian-400/30 flex items-center justify-center mb-5">
            <CarIcon size={36} className="text-gray-600" />
          </div>
          <p className="text-white font-semibold text-base">No cars found</p>
          <p className="text-gray-500 text-sm mt-1.5 max-w-xs">Try adjusting your filters or search term</p>
          <button
            onClick={() => { setSearch(''); setFilterStatus(''); setFilterMake('All'); }}
            className="mt-4 px-4 py-2 text-sm text-gold-400 border border-gold-500/30 rounded-lg hover:bg-gold-500/10 transition-colors"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Skeleton loaders on initial load */}
      {initialLoad && view === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}
      {initialLoad && view === 'list' && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      )}

      {/* Grid view */}
      {!initialLoad && view === 'grid' && filteredOrdered.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => { dragActiveRef.current = true; setDragActiveId(e.active.id as string); }}
          onDragEnd={(e) => {
            dragActiveRef.current = false;
            setDragActiveId(null);
            const { active, over } = e;
            if (!over || active.id === over.id) return;
            setStockOrder(prev => {
              const oi = prev.indexOf(active.id as string);
              const ni = prev.indexOf(over.id as string);
              return (oi >= 0 && ni >= 0) ? arrayMove(prev, oi, ni) : prev;
            });
          }}
          onDragCancel={() => { dragActiveRef.current = false; setDragActiveId(null); }}
        >
          <SortableContext items={filteredOrdered.map(c => c.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredOrdered.map((car, idx) => (
                <SortableCarItem key={car.id} id={car.id}>
                  <div className={`relative group/card stagger-enter stagger-${Math.min(idx + 1, 12)}`}>
              {isDirector && (
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteCarId(car.id); }}
                  className="absolute top-2 right-2 z-10 p-1.5 bg-red-500/80 hover:bg-red-500 text-white rounded-lg opacity-0 group-hover/card:opacity-100 transition-opacity"
                  title="Delete car"
                >
                  <Trash2 size={13} />
                </button>
              )}
            <div
              onClick={() => navigate(`/inventory/${car.id}`)}
              className="relative bg-obsidian-900 rounded-xl overflow-hidden cursor-pointer aspect-[4/3] shadow-card border border-obsidian-400/50 hover:border-gold-500/30 transition-colors duration-300 group card-lift card-streak"
            >
              {/* Full-bleed photo */}
              <div className="absolute inset-0">
                {car.photo
                  ? <img src={thumbUrl(car.photo, 640, 72)!} alt="" className="w-full h-full object-cover" loading="lazy" />
                  : <div className="w-full h-full flex items-center justify-center bg-obsidian-800">
                      <CarIcon size={40} className="text-gray-700" />
                    </div>
                }
              </div>

              {/* Gradient overlay — darkens bottom for text legibility */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

              {/* SOLD watermark overlay — only for delivered cars */}
              {car.status === 'delivered' && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <div className="border-4 border-red-500/70 rounded-lg px-4 py-1 rotate-[-20deg]">
                    <span className="text-red-500/90 font-display font-bold text-2xl tracking-widest">SOLD</span>
                  </div>
                </div>
              )}

              {/* Top badges row */}
              {(() => {
                const statusBadge = getDealBadge(car);
                return (
                  <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1">
                    <div className="flex flex-col gap-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusBadge.cls}`}>
                        {statusBadge.label}
                      </span>
                      {!car.greenCard && car.status !== 'coming_soon' && (
                        <span className="flex items-center gap-1 bg-orange-500/80 border border-orange-400 text-white px-2 py-0.5 rounded-full text-[10px] font-medium w-fit">
                          <AlertCircle size={10} /> No GC
                        </span>
                      )}
                    </div>
                    {car.carPlate && (
                      <span className="text-[10px] font-mono text-gold-300 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded border border-gold-500/20">
                        {car.carPlate}
                      </span>
                    )}
                  </div>
                );
              })()}

              {/* Bottom info overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <p className="text-white font-semibold text-sm leading-tight line-clamp-1">
                  {car.year} {car.make} {car.model}
                </p>
                {car.variant && <p className="text-gray-400 text-[11px] mt-0.5 line-clamp-1">{car.variant}</p>}
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-gray-500 text-[10px]">{car.colour} · {car.transmission} · {formatMileage(car.mileage)}</p>
                  {(() => {
                    if (car.status === 'delivered' || car.status === 'sold') return null;
                    const days = Math.floor((Date.now() - new Date(car.dateAdded).getTime()) / 86400000);
                    if (days < 30) return null;
                    const ageCls = days >= 90
                      ? 'bg-red-500/20 text-red-400 border-red-500/30'
                      : days >= 60
                      ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                      : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
                    return (
                      <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border font-medium ${ageCls}`}>
                        <Clock size={9} />{days}d
                      </span>
                    );
                  })()}
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <div>
                    {confirmedDealPrice[car.id] != null ? (
                      <div>
                        {confirmedDealPrice[car.id] !== car.sellingPrice && (
                          <p className="text-gray-500 text-[10px] line-through">{formatRM(car.sellingPrice)}</p>
                        )}
                        <p className="text-gold-400 font-bold text-base"
                           style={{animation: 'priceIn 0.5s ease forwards', animationDelay: `${filtered.indexOf(car) * 0.05}s`, opacity: 0}}>
                          {formatRM(confirmedDealPrice[car.id])}
                        </p>
                      </div>
                    ) : (
                      <p className="text-gold-400 font-bold text-base"
                         style={{animation: 'priceIn 0.5s ease forwards', animationDelay: `${filtered.indexOf(car) * 0.05}s`, opacity: 0}}>
                        {formatRM(car.sellingPrice)}
                      </p>
                    )}
                  </div>
                  {isDirectorView && (
                    <p className={`text-xs font-semibold ${(carProfitMap[car.id] ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatRM(carProfitMap[car.id] ?? 0)}
                    </p>
                  )}
                </div>

                {/* Deal summary strip */}
                {(() => {
                  const leadCount = carStats[car.id]?.leadCount ?? 0;
                  const submissions = car.loanSubmissions ?? [];
                  const approvedBanks = submissions.filter((s) => s.status === 'approved');
                  const pendingBanks  = submissions.filter((s) => s.status === 'submitted');
                  const deal = car.finalDeal;

                  if (leadCount === 0 && submissions.length === 0 && !deal) return null;

                  return (
                    <div className="mt-1.5 pt-1.5 border-t border-white/10 flex flex-wrap gap-x-2 gap-y-0.5">
                      {leadCount > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
                          <Users size={9} /> {leadCount} lead{leadCount > 1 ? 's' : ''}
                        </span>
                      )}
                      {pendingBanks.length > 0 && (
                        <p className="text-[10px] text-blue-400">
                          {pendingBanks.length} pending
                        </p>
                      )}
                      {approvedBanks.length > 0 && (
                        <p className="text-[10px] text-emerald-400">Approved</p>
                      )}
                      {deal && (
                        <p className="text-[10px] text-violet-400 font-medium truncate">
                          {deal.bank}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Light streak on hover */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-300"
                style={{background: 'linear-gradient(105deg, transparent 40%, rgba(234,184,32,0.06) 50%, transparent 60%)'}}>
              </div>

              {/* Bottom gold line on hover */}
              <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-transparent via-gold-500/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
                  </div>
                </SortableCarItem>
              ))}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
            {dragActiveId && (() => { const c = cars.find(x => x.id === dragActiveId); return c ? <DragGhostCard car={c} /> : null; })()}
          </DragOverlay>
        </DndContext>
      )}

      {/* List view */}
      {!initialLoad && view === 'list' && filteredOrdered.length > 0 && (
        <div className="space-y-2">
          {filteredOrdered.map((car, idx) => {
            const { cls, label } = getDealBadge(car);
            const leadCount = carStats[car.id]?.leadCount ?? 0;
            const submissions = car.loanSubmissions ?? [];
            const approved = submissions.filter((s) => s.status === 'approved');
            const pending  = submissions.filter((s) => s.status === 'submitted');
            const deal = car.finalDeal;
            const price = confirmedDealPrice[car.id] ?? car.sellingPrice;
            const profit = carProfitMap[car.id] ?? 0;

            return (
              <div
                key={car.id}
                onClick={() => navigate(`/inventory/${car.id}`)}
                className={`row-item bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card cursor-pointer hover:border-gold-500/40 hover:bg-obsidian-700/30 transition-all flex items-center gap-4 px-4 py-3 relative stagger-enter stagger-${Math.min(idx + 1, 12)}${car.status === 'delivered' ? ' opacity-60' : ''}`}
              >
                {/* Thumbnail */}
                <div className="w-24 h-16 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center relative">
                  {car.photo
                    ? <img src={thumbUrl(car.photo, 300, 72)!} alt={`${car.make} ${car.model}`} className="w-full h-full object-cover" loading="lazy" />
                    : <CarIcon size={20} className="text-gray-600" />
                  }
                  {car.status === 'delivered' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <span className="text-[9px] font-bold text-red-400 border border-red-500/60 rounded px-1 py-0.5 rotate-[-15deg] tracking-widest">SOLD</span>
                    </div>
                  )}
                </div>

                {/* Car name + details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold text-sm">{car.year} {car.make} {car.model}{car.variant ? ` ${car.variant}` : ''}</span>
                    {car.carPlate && (
                      <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-[#2C2415] text-gold-300 border border-[#3C321E] tracking-wider">{car.carPlate}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="text-gray-500 text-xs">{car.colour} · {car.transmission} · {formatMileage(car.mileage)}</span>
                    {car.status !== 'coming_soon' && (
                      <span className="flex items-center gap-1 text-gray-500 text-xs">
                        <MapPin size={10} />{getLocation(car)}
                      </span>
                    )}
                    {(() => {
                      if (car.status === 'delivered' || car.status === 'sold') return null;
                      const days = Math.floor((Date.now() - new Date(car.dateAdded).getTime()) / 86400000);
                      if (days < 30) return null;
                      const cls = days >= 90 ? 'text-red-400' : days >= 60 ? 'text-orange-400' : 'text-yellow-400';
                      return <span className={`flex items-center gap-0.5 text-[10px] font-medium ${cls}`}><Clock size={9} />{days}d</span>;
                    })()}
                  </div>
                </div>

                {/* Deal summary */}
                <div className="hidden md:flex flex-col gap-0.5 min-w-[120px]">
                  {leadCount > 0 && <span className="flex items-center gap-1 text-xs text-gray-500"><Users size={10} />{leadCount} lead{leadCount > 1 ? 's' : ''}</span>}
                  {pending.length > 0 && <p className="text-xs text-blue-400">{pending.length} pending</p>}
                  {approved.length > 0 && <p className="text-xs text-emerald-400">Approved</p>}
                  {deal && <p className="text-xs text-violet-400 truncate">{deal.bank}</p>}
                  {!leadCount && !submissions.length && !deal && <span className="text-xs text-gray-600">No leads</span>}
                </div>

                {/* Status badge */}
                <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{label}</span>
                  {!car.greenCard && car.status !== 'coming_soon' && (
                    <span className="flex items-center gap-1 bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full text-[10px] font-medium border border-orange-500/30">
                      <AlertCircle size={9} /> No GC
                    </span>
                  )}
                </div>

                {/* Price + profit */}
                <div className="text-right flex-shrink-0">
                  {confirmedDealPrice[car.id] != null && confirmedDealPrice[car.id] !== car.sellingPrice && (
                    <p className="text-gray-600 text-xs line-through">{formatRM(car.sellingPrice)}</p>
                  )}
                  <p className="text-gold-400 font-bold text-sm">{formatRM(price)}</p>
                  {isDirectorView && (
                    <p className={`text-xs font-medium mt-0.5 ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {profit >= 0 ? '+' : ''}{formatRM(profit)}
                    </p>
                  )}
                </div>

                {/* Delete */}
                {isDirector && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteCarId(car.id); }}
                    className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Consigned Out section ── */}
      {consignedOut.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-px flex-1 bg-orange-500/20" />
            <span className="text-orange-400 text-xs font-semibold uppercase tracking-widest px-2">Consigned Out ({consignedOut.length})</span>
            <div className="h-px flex-1 bg-orange-500/20" />
          </div>
          <div className="space-y-2">
            {consignedOut.map((car) => (
              <div
                key={car.id}
                onClick={() => navigate(`/inventory/${car.id}`)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-obsidian-800/60 border border-orange-500/20 cursor-pointer hover:border-orange-500/40 transition-colors"
              >
                {car.photo ? (
                  <img src={car.photo} alt="" className="w-12 h-9 rounded-lg object-cover shrink-0 opacity-80" />
                ) : (
                  <div className="w-12 h-9 rounded-lg bg-obsidian-700/60 flex items-center justify-center shrink-0">
                    <CarIcon size={14} className="text-gray-600" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{car.year} {car.make} {car.model}</p>
                  <p className="text-gray-500 text-xs truncate">{car.carPlate ?? '—'} · {car.colour}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-orange-400 text-xs font-semibold">{car.outgoingConsignment!.dealer}</p>
                  <p className="text-gray-600 text-xs">{car.outgoingConsignment!.terms === 'fixed_amount' ? `RM ${(car.outgoingConsignment!.fixedAmount ?? 0).toLocaleString()}` : `${car.outgoingConsignment!.splitPercent ?? 50}% split`}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      </>}

      <DeleteConfirmModal
        isOpen={!!deleteCarId}
        onClose={() => setDeleteCarId(null)}
        onConfirm={async () => {
          if (deleteCarId) await deleteCar(deleteCarId);
          setSearch('');
          setFilterStatus('');
          setFilterMake('All');
          setFilterTransmission('All');
        }}
        itemName={(() => { const c = cars.find((c) => c.id === deleteCarId); return c ? `${c.year} ${c.make} ${c.model}` : 'this car'; })()}
      />

      {/* Add Car Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add New Car" maxWidth="max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Make" error={errors.make}>
            <input
              className={inputCls(errors.make)}
              value={form.make}
              onChange={(e) => setForm({ ...form, make: e.target.value })}
              placeholder="e.g. Perodua"
            />
          </FormField>
          <FormField label="Model" error={errors.model}>
            <input
              className={inputCls(errors.model)}
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="e.g. Myvi"
            />
          </FormField>
          <FormField label="Variant" className="col-span-2">
            <input
              className={inputCls()}
              value={form.variant ?? ''}
              onChange={(e) => setForm({ ...form, variant: e.target.value })}
              placeholder="e.g. 1.5 Advance"
            />
          </FormField>
          <FormField label="Year" error={errors.year}>
            <input
              type="number"
              className={inputCls(errors.year)}
              value={form.year}
              onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
            />
          </FormField>
          <FormField label="Car Plate">
            <input
              className={inputCls()}
              value={form.carPlate ?? ''}
              onChange={(e) => setForm({ ...form, carPlate: e.target.value.toUpperCase() })}
              placeholder="e.g. WXX 1234"
            />
          </FormField>
          <FormField label="Colour" error={errors.colour}>
            <input
              className={inputCls(errors.colour)}
              value={form.colour}
              onChange={(e) => setForm({ ...form, colour: e.target.value })}
              placeholder="e.g. White"
            />
          </FormField>
          <FormField label="Mileage (km)" error={errors.mileage}>
            <input
              type="number"
              className={inputCls(errors.mileage)}
              value={form.mileage}
              onChange={(e) => setForm({ ...form, mileage: Number(e.target.value) })}
            />
          </FormField>
          <FormField label="Purchase Price (RM)" error={errors.purchasePrice}>
            <input
              type="number"
              className={inputCls(errors.purchasePrice)}
              value={form.purchasePrice}
              onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) })}
            />
          </FormField>
          <FormField label={isDirector ? 'Selling Price (RM)' : 'Selling Price (RM) — Director only'} error={errors.sellingPrice}>
            <input
              type="number"
              className={inputCls(errors.sellingPrice)}
              value={form.sellingPrice}
              onChange={(e) => isDirector && setForm({ ...form, sellingPrice: Number(e.target.value) })}
              readOnly={!isDirector}
              placeholder={isDirector ? '' : 'Set by Director'}
              style={!isDirector ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            />
          </FormField>
          {isDirector && (
            <FormField label="Floor Price (RM) — Lowest acceptable deal" className="col-span-2">
              <input
                type="number"
                className={inputCls()}
                value={form.priceFloor ?? ''}
                onChange={(e) => setForm({ ...form, priceFloor: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="e.g. 55800"
              />
              <p className="text-gray-600 text-xs mt-1">Deal ≥ floor → 1.5k commission · Deal below floor → 1k commission</p>
            </FormField>
          )}
          <FormField label="Transmission">
            <select
              className={inputCls()}
              value={form.transmission}
              onChange={(e) => setForm({ ...form, transmission: e.target.value as Car['transmission'] })}
            >
              <option value="auto">Automatic</option>
              <option value="manual">Manual</option>
            </select>
          </FormField>
          <div className="flex items-center col-span-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, status: isComingSoon ? 'available' : 'coming_soon' })}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg border transition-colors text-left ${isComingSoon ? 'bg-purple-500/10 border-purple-500/40 text-purple-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:border-gold-500/40'}`}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isComingSoon ? 'bg-purple-500 border-purple-500' : 'border-gray-600'}`}>
                {isComingSoon && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <div>
                <p className="text-sm font-medium">Coming Soon</p>
                <p className="text-xs opacity-60 mt-0.5">Car is confirmed but not yet in the shop</p>
              </div>
            </button>
          </div>
          {/* Incoming Consignment */}
          <div className="col-span-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, consignment: form.consignment ? undefined : { dealer: '', terms: 'fixed_amount', fixedAmount: form.purchasePrice || 0 }, outgoingConsignment: undefined })}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg border transition-colors text-left ${form.consignment ? 'bg-blue-500/10 border-blue-500/40 text-blue-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:border-gold-500/40'}`}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${form.consignment ? 'bg-blue-500 border-blue-500' : 'border-gray-600'}`}>
                {form.consignment && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <div>
                <p className="text-sm font-medium">Consign In — Dealer's car, we sell it</p>
                <p className="text-xs opacity-60 mt-0.5">Car belongs to another dealer, sold on their behalf</p>
              </div>
            </button>

            {form.consignment && (
              <div className="mt-3 space-y-3 pl-2 border-l-2 border-blue-500/30">
                <FormField label="Dealer Name">
                  <select
                    className={inputCls()}
                    value={form.consignment.dealer}
                    onChange={(e) => setForm({ ...form, consignment: { ...form.consignment!, dealer: e.target.value } })}
                  >
                    <option value="">— Select dealer —</option>
                    {dealers.map((d) => (
                      <option key={d.id} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                  {dealers.length === 0 && (
                    <p className="text-xs text-gray-500 mt-1">No dealers yet — add them in the Data page under Car Dealers</p>
                  )}
                </FormField>

                <div>
                  <label className="block text-gray-300 text-xs font-medium mb-2">Consignment Terms</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, consignment: { ...form.consignment!, terms: 'fixed_amount', fixedAmount: form.purchasePrice || form.consignment!.fixedAmount || 0 } })}
                      className={`px-3 py-2.5 rounded-lg border text-sm transition-colors text-left ${form.consignment.terms === 'fixed_amount' ? 'bg-blue-500/15 border-blue-500/50 text-blue-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400'}`}
                    >
                      <p className="font-medium">Fixed Amount</p>
                      <p className="text-xs opacity-60 mt-0.5">Dealer takes back purchase price</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, consignment: { ...form.consignment!, terms: 'profit_split', splitPercent: 50 } })}
                      className={`px-3 py-2.5 rounded-lg border text-sm transition-colors text-left ${form.consignment.terms === 'profit_split' ? 'bg-blue-500/15 border-blue-500/50 text-blue-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400'}`}
                    >
                      <p className="font-medium">Profit Split</p>
                      <p className="text-xs opacity-60 mt-0.5">Split profit after expenses</p>
                    </button>
                  </div>
                </div>

                {form.consignment.terms === 'fixed_amount' && (
                  <div className="flex items-center justify-between bg-obsidian-700/40 border border-obsidian-400/40 rounded-lg px-3 py-2.5">
                    <p className="text-gray-400 text-xs">Dealer Takes Back</p>
                    <p className="text-blue-400 font-semibold text-sm">{formatRM(form.purchasePrice || 0)}</p>
                  </div>
                )}

                {form.consignment.terms === 'profit_split' && (
                  <FormField label="Dealer's Split (%)">
                    <input
                      type="number"
                      className={inputCls()}
                      value={form.consignment.splitPercent ?? 50}
                      min={1}
                      max={99}
                      onChange={(e) => setForm({ ...form, consignment: { ...form.consignment!, splitPercent: Number(e.target.value) } })}
                    />
                  </FormField>
                )}
              </div>
            )}
          </div>


          {/* Investor funding — director only */}
          {isDirector && (() => {
            const investors = users.filter(u => u.role === 'investor');
            if (investors.length === 0) return null;
            return (
              <div className="col-span-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, investorId: form.investorId ? undefined : investors[0].id, investorSplit: 50 })}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg border transition-colors text-left ${form.investorId ? 'bg-amber-500/10 border-amber-500/40 text-amber-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:border-gold-500/40'}`}
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${form.investorId ? 'bg-amber-500 border-amber-500' : 'border-gray-600'}`}>
                    {form.investorId && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <div>
                    <p className="text-sm font-medium">Investor-Funded</p>
                    <p className="text-xs opacity-60 mt-0.5">Car capital comes from an investor account</p>
                  </div>
                </button>
                {form.investorId && (
                  <div className="mt-3 space-y-3 pl-2 border-l-2 border-amber-500/30">
                    <FormField label="Investor">
                      <select
                        className={inputCls()}
                        value={form.investorId}
                        onChange={(e) => setForm({ ...form, investorId: e.target.value })}
                      >
                        {investors.map(inv => (
                          <option key={inv.id} value={inv.id}>{inv.name}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Investor Profit Share (%)">
                      <input
                        type="number"
                        className={inputCls()}
                        value={form.investorSplit ?? 50}
                        min={1} max={99}
                        onChange={(e) => setForm({ ...form, investorSplit: Number(e.target.value) })}
                      />
                      <p className="text-gray-600 text-xs mt-1">AutoDream takes the remaining {100 - (form.investorSplit ?? 50)}%</p>
                    </FormField>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Source Salesman */}
          <div className="col-span-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, sourceType: form.sourceType ? undefined : 'external', externalSalesmanId: undefined, sourceSalesmanId: undefined, sourceCommission: undefined, sourceSalesman: undefined, intakeCommission: undefined })}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg border transition-colors text-left ${form.sourceType ? 'bg-green-500/10 border-green-500/40 text-green-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:border-gold-500/40'}`}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${form.sourceType ? 'bg-green-500 border-green-500' : 'border-gray-600'}`}>
                {form.sourceType && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <div>
                <p className="text-sm font-medium">Has Source Salesman</p>
                <p className="text-xs opacity-60 mt-0.5">Car was brought in by an external or internal salesperson</p>
              </div>
            </button>
            {form.sourceType && (
              <div className="mt-3 space-y-3 pl-2 border-l-2 border-green-500/30">
                {/* External / Internal toggle */}
                <div className="grid grid-cols-2 gap-2">
                  {(['external', 'internal'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...form, sourceType: t, externalSalesmanId: undefined, sourceSalesmanId: undefined, sourceSalesman: undefined })}
                      className={`px-3 py-2.5 rounded-lg border text-sm transition-colors ${form.sourceType === t ? 'bg-green-500/15 border-green-500/50 text-green-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:border-gold-500/40'}`}
                    >
                      <p className="font-medium capitalize">{t}</p>
                      <p className="text-xs opacity-60 mt-0.5">{t === 'external' ? 'Not an AutoDream staff' : 'AutoDream salesperson'}</p>
                    </button>
                  ))}
                </div>

                {form.sourceType === 'external' && (
                  <>
                    <FormField label="External Salesman">
                      <select
                        className={inputCls()}
                        value={form.externalSalesmanId ?? ''}
                        onChange={(e) => {
                          const s = externalSalesmen.find(x => x.id === e.target.value);
                          setForm({ ...form, externalSalesmanId: e.target.value || undefined, sourceSalesman: s?.name });
                        }}
                      >
                        <option value="">— Select salesman —</option>
                        {externalSalesmen.map(s => <option key={s.id} value={s.id}>{s.name}{s.ic ? ` (${s.ic})` : ''}</option>)}
                      </select>
                      {externalSalesmen.length === 0 && (
                        <p className="text-xs text-gray-500 mt-1">No external salesmen registered — add them in Data → Ext. Salesmen</p>
                      )}
                    </FormField>
                    <FormField label="Commission to External Salesman (RM)">
                      <input type="number" className={inputCls()} value={form.sourceCommission ?? ''} placeholder="e.g. 500" onChange={e => setForm({ ...form, sourceCommission: e.target.value ? Number(e.target.value) : undefined })} />
                    </FormField>
                    <div>
                      <label className="block text-gray-300 text-xs font-medium mb-2">In-house Salesman Intake Bonus (RM)</label>
                      <div className="grid grid-cols-3 gap-2">
                        {([0, 500, 1000] as const).map((v) => (
                          <button key={v} type="button" onClick={() => setForm({ ...form, intakeCommission: v })}
                            className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${form.intakeCommission === v ? 'bg-teal-500/15 border-teal-500/50 text-teal-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:border-gold-500/40'}`}>
                            {v === 0 ? 'None' : `RM ${v.toLocaleString()}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {form.sourceType === 'internal' && (
                  <>
                    <FormField label="AutoDream Salesperson">
                      <select
                        className={inputCls()}
                        value={form.sourceSalesmanId ?? ''}
                        onChange={(e) => {
                          const u = users.find(x => x.id === e.target.value);
                          setForm({ ...form, sourceSalesmanId: e.target.value || undefined, sourceSalesman: u?.name });
                        }}
                      >
                        <option value="">— Select salesperson —</option>
                        {users.filter(u => u.role === 'salesperson').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Sourcing Commission (RM)">
                      <input type="number" className={inputCls()} value={form.sourceCommission ?? ''} placeholder="e.g. 500" onChange={e => setForm({ ...form, sourceCommission: e.target.value ? Number(e.target.value) : undefined })} />
                    </FormField>
                  </>
                )}
              </div>
            )}
          </div>

          <FormField label="Notes" className="col-span-2">
            <textarea
              className={`${inputCls()} h-20 resize-none`}
              value={form.notes ?? ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Any additional notes..."
            />
          </FormField>

          {/* Car Photos — not required for Coming Soon */}
          {!isComingSoon && <div className="col-span-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-gray-300 text-xs font-medium">
                Car Photos
                <span className="ml-1.5 text-gray-500 font-normal">(minimum 4 required)</span>
              </label>
              <span className={`text-xs font-medium ${(form.photos?.length ?? 0) >= 4 ? 'text-green-400' : 'text-yellow-400'}`}>
                {form.photos?.length ?? 0} / 4 min
              </span>
            </div>

            {/* Thumbnail grid — drag to reorder */}
            <div className="flex flex-wrap gap-2 mb-2">
              {(form.photos ?? []).map((src, idx) => (
                <div
                  key={idx}
                  data-photo-idx={idx}
                  draggable
                  onDragStart={() => { dragIndexRef.current = idx; }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const from = dragIndexRef.current;
                    if (from === null || from === idx) return;
                    const updated = [...(form.photos ?? [])];
                    const [moved] = updated.splice(from, 1);
                    updated.splice(idx, 0, moved);
                    dragIndexRef.current = idx;
                    setForm((prev) => ({ ...prev, photos: updated, photo: updated[0] ?? '' }));
                  }}
                  onDragEnd={() => { dragIndexRef.current = null; }}
                  onTouchStart={() => { dragIndexRef.current = idx; }}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={() => { dragIndexRef.current = null; }}
                  style={{ touchAction: 'none' }}
                  className="relative w-20 h-20 rounded-lg overflow-hidden border border-obsidian-400/60 group cursor-grab active:cursor-grabbing"
                >
                  <img src={src} alt={`car-${idx + 1}`} className="w-full h-full object-cover pointer-events-none" />
                  <button
                    type="button"
                    onClick={() => removePhoto(idx)}
                    className="absolute top-1 right-1 bg-black/70 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  >
                    <X size={12} className="text-white" />
                  </button>
                  {idx === 0 && (
                    <span className="absolute bottom-0 left-0 right-0 bg-gold-500/80 text-white text-[9px] text-center py-0.5">
                      Cover
                    </span>
                  )}
                </div>
              ))}

              {/* Uploading indicator */}
              {uploadingPhotos && (
                <div className="w-20 h-20 rounded-lg border border-obsidian-400/60 flex flex-col items-center justify-center gap-1 text-gold-400">
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span className="text-[9px]">Uploading...</span>
                </div>
              )}

              {/* Add photo button */}
              {!uploadingPhotos && (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="w-20 h-20 rounded-lg border-2 border-dashed border-obsidian-400/60 hover:border-gold-500/50 flex flex-col items-center justify-center gap-1 text-gray-600 hover:text-gold-400 transition-colors"
                >
                  <ImagePlus size={18} />
                  <span className="text-[10px]">Add</span>
                </button>
              )}
            </div>

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handlePhotoFiles(e.target.files)}
            />

            {errors.photos && (
              <p className="text-red-400 text-xs flex items-center gap-1">
                <AlertCircle size={12} /> {errors.photos}
              </p>
            )}
          </div>}

          {/* Green Card */}
          {!isComingSoon && <div className="col-span-2">
            <label className="block text-gray-300 text-xs font-medium mb-1.5">
              Green Card
              <span className="ml-1.5 text-gray-500 font-normal">(JPG, PNG or PDF)</span>
            </label>

            {form.greenCard ? (
              <div className="flex items-center gap-3 bg-obsidian-700/60 border border-obsidian-400/60 rounded-lg p-3">
                {form.greenCard.startsWith('data:image') ? (
                  <img src={form.greenCard} alt="green card" className="w-16 h-12 object-cover rounded border border-obsidian-400/60" />
                ) : (
                  <div className="w-16 h-12 bg-green-500/10 border border-green-500/30 rounded flex items-center justify-center">
                    <FileText size={20} className="text-green-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-medium">Green card uploaded</p>
                  <p className="text-gray-500 text-xs mt-0.5">Click replace to change</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => greenCardInputRef.current?.click()}
                    className="text-xs text-gold-400 hover:text-gold-300 transition-colors"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, greenCard: '' }))}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => greenCardInputRef.current?.click()}
                className={`w-full border-2 border-dashed ${errors.greenCard ? 'border-red-500/50' : 'border-obsidian-400/60 hover:border-gold-500/50'} rounded-lg p-5 flex flex-col items-center gap-2 text-gray-600 hover:text-gold-400 transition-colors`}
              >
                <Upload size={20} />
                <span className="text-xs">Click to upload green card</span>
                <span className="text-[10px] text-gray-700">JPG, PNG, PDF accepted</span>
              </button>
            )}

            <input
              ref={greenCardInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => handleGreenCard(e.target.files)}
            />

            {errors.greenCard && (
              <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                <AlertCircle size={12} /> {errors.greenCard}
              </p>
            )}
          </div>}
        </div>

        {submitError && (
          <p className="mt-4 text-red-400 text-xs flex items-center gap-1.5">
            <AlertCircle size={13} /> {submitError}
          </p>
        )}
        <div className="flex gap-3 mt-4">
          <button
            onClick={() => setShowModal(false)}
            disabled={submitting}
            className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || uploadingPhotos}
            className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Saving...
              </>
            ) : 'Add Car'}
          </button>
        </div>
      </Modal>

      {/* ── Director Deal Review Sheet (fallback: no WO on record) ── */}
      {reviewDealCar && (() => {
        const rc = cars.find(c => c.id === reviewDealCar.id) ?? reviewDealCar;
        const deal = rc.finalDeal!;
        const anyBuyer = customers.find(c => c.interestedCarId === rc.id && c.dealPrice);
        const discount = rc.sellingPrice - deal.dealPrice;
        const isLoanDeal = deal.bank !== 'Cash';
        return createPortal(
          <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0f1e]">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-4 border-b border-obsidian-400/30 shrink-0">
              <button onClick={() => setReviewDealCar(null)} className="p-2 rounded-xl hover:bg-obsidian-700/60 transition-colors">
                <X size={18} className="text-gray-400" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm truncate">{rc.year} {rc.make} {rc.model}</p>
                <p className="text-amber-400 text-xs font-medium">Pending Director Approval</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="max-w-lg mx-auto px-4 py-5 space-y-5" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>

                {/* Financial summary — mirrors WO modal layout */}
                <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden">
                  {/* Charges */}
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Charges</p>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Selling Price</span>
                        <span className="text-white font-mono">+ {formatRM(rc.sellingPrice)}</span>
                      </div>
                    </div>
                  </div>
                  {/* Deductions */}
                  <div className="px-4 pt-2 pb-1 border-t border-obsidian-400/20">
                    <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Deductions</p>
                    <div className="space-y-1.5">
                      {discount > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400">Discount</span>
                          <span className="flex items-center gap-1.5 font-mono">
                            <span className="text-gray-600 line-through text-xs">RM 0</span>
                            <span className="text-red-400 text-xs">›</span>
                            <span className="text-red-400 font-bold">− {formatRM(discount)}</span>
                          </span>
                        </div>
                      )}
                      {discount === 0 && (
                        <p className="text-gray-600 text-xs italic">No deductions</p>
                      )}
                    </div>
                  </div>
                  {/* Balance */}
                  <div className="flex items-center gap-3 px-4 py-3 border-t border-obsidian-400/40 bg-obsidian-700/30">
                    <span className="text-white font-bold text-sm flex-1">Deal Price</span>
                    <span className="text-gold-400 font-bold text-base font-mono">{formatRM(deal.dealPrice)}</span>
                  </div>
                </div>

                {/* Deal meta */}
                <div>
                  <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3">Submission</p>
                  <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden divide-y divide-obsidian-400/30">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="text-gray-400 text-sm flex-1">Type</span>
                      <span className="text-white text-sm">{isLoanDeal ? `Loan · ${deal.bank}` : 'Cash'}</span>
                    </div>
                    {anyBuyer && (
                      <div className="flex items-center gap-3 px-4 py-3">
                        <span className="text-gray-400 text-sm flex-1">Buyer</span>
                        <span className="text-white text-sm">{anyBuyer.name}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="text-gray-400 text-sm flex-1">Submitted by</span>
                      <span className="text-white text-sm">{deal.submittedBy}</span>
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="text-gray-400 text-sm flex-1">Submitted at</span>
                      <span className="text-white text-sm">{new Date(deal.submittedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                    {deal.notes && (
                      <div className="flex items-start gap-3 px-4 py-3">
                        <span className="text-gray-400 text-sm flex-1">Notes</span>
                        <span className="text-white text-sm text-right max-w-[60%]">{deal.notes}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="text-gray-400 text-sm flex-1">Approval</span>
                      <span className="text-amber-400 text-sm font-semibold">Pending</span>
                    </div>
                  </div>
                </div>

                {/* Approve / Reject */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      updateCar(rc.id, { finalDeal: { ...deal, approvalStatus: 'approved', approvedBy: currentUser!.name, approvedAt: new Date().toISOString() } });
                      setReviewDealCar(null);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-green-500/15 hover:bg-green-500/25 border border-green-500/40 text-green-400 font-semibold transition-colors"
                  >
                    <CheckCircle size={16} /> Approve
                  </button>
                  <button
                    onClick={() => {
                      const notes = window.prompt('Reason for rejection (optional):') ?? '';
                      updateCar(rc.id, { finalDeal: { ...deal, approvalStatus: 'rejected', rejectionNotes: notes || undefined } });
                      setReviewDealCar(null);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-400 font-semibold transition-colors"
                  >
                    <XCircle size={16} /> Reject
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* ── Work Order View / Edit Sheet ── */}
      {woViewCar && (() => {
        const car = cars.find(c => c.id === woViewCar.car.id) ?? woViewCar.car;
        const buyer = customers.find(c => c.id === woViewCar.buyer.id) ?? woViewCar.buyer;
        const isLoan = !!buyer.loanWorkOrder;

        const handleCancelDeal = async () => {
          const { updateCar } = useStore.getState();
          if (isLoan) {
            updateCustomer(buyer.id, { loanWorkOrder: undefined, dealPrice: 0, loanStatus: 'submitted' });
            await supabase.from('customers').update({ loan_work_order: null, deal_price: 0 }).eq('id', buyer.id);
          } else {
            updateCustomer(buyer.id, { cashWorkOrder: undefined, dealPrice: 0, leadStatus: 'follow_up' });
            await supabase.from('customers').update({ cash_work_order: null, deal_price: 0 }).eq('id', buyer.id);
          }
          updateCar(car.id, { status: 'available', finalDeal: undefined });
          await supabase.from('cars').update({ status: 'available', final_deal: null }).eq('id', car.id);
          setWoViewCar(null);
          setWoCancelConfirm(false);
        };

        const handleDelivery = () => {
          const { updateCar } = useStore.getState();
          const wo = buyer.loanWorkOrder ?? buyer.cashWorkOrder;
          const dealPrice = wo ? (wo.sellingPrice - (wo.discount ?? 0)) : (car.sellingPrice ?? 0);
          const commission = (car.priceFloor != null && dealPrice < car.priceFloor) ? 1000 : 1500;
          updateCustomer(buyer.id, {
            delivered: true,
            deliveredAt: new Date().toISOString(),
            commission,
            lastActionAt: new Date().toISOString(),
          });
          updateCar(car.id, {
            status: 'delivered',
            deliveryCollected: true,
            ...(buyer.assignedSalesId && !car.assignedSalesperson ? { assignedSalesperson: buyer.assignedSalesId } : {}),
          });
          setWoViewCar(null);
          setWoDeliveryConfirm(false);
        };
        const lwo = buyer.loanWorkOrder as LoanWorkOrder | undefined;
        const cwo = buyer.cashWorkOrder as CashWorkOrder | undefined;
        const activeWo = (lwo ?? cwo)!;

        // Use edit data in edit mode, otherwise use activeWo
        const d: any = woEditMode ? woEditData : activeWo;
        const editExtras: { label: string; amount: number }[] = woEditMode ? (woEditData.additionalItems ?? []) : (activeWo.additionalItems ?? []);

        const editNetTradeIn = (d.hasTradeIn ? ((Number(d.tradeInPrice) || 0) - (Number(d.settlementFigure) || 0)) : 0);
        const viewNetTradeIn = (activeWo.hasTradeIn ? (activeWo.tradeInPrice - activeWo.settlementFigure) : 0);

        const calcTotal = (src: any, extras: { label: string; amount: number }[]) =>
          (Number(src.sellingPrice) || 0)
          - (isLoan ? (Number(src.loanAmount) || 0) : 0)
          - (!isLoan ? (Number(src.downpayment) || 0) : 0)
          - (Number(src.bookingFee) || 0)
          - (Number(src.discount) || 0)
          + (Number(src.insurance) || 0)
          + (Number(src.bankProduct) || 0)
          + extras.reduce((s, i) => s + (Number(i.amount) || 0), 0)
          - (src.hasTradeIn ? ((Number(src.tradeInPrice) || 0) - (Number(src.settlementFigure) || 0)) : 0);

        const displayTotal = woEditMode
          ? calcTotal(woEditData, editExtras)
          : calcTotal(activeWo, activeWo.additionalItems ?? []);

        const setD = (patch: Record<string, any>) => setWoEditData((prev: any) => ({ ...prev, ...patch }));

        const handleSave = async () => {
          setWoSaving(true);
          try {
            const updated = { ...activeWo, ...woEditData, additionalItems: editExtras };
            if (isLoan) {
              await updateCustomer(buyer.id, { loanWorkOrder: updated as LoanWorkOrder });
            } else {
              await updateCustomer(buyer.id, { cashWorkOrder: updated as CashWorkOrder });
            }
            // Re-queue for director approval whenever a salesman edits the deal
            if (!isDirector && car.finalDeal) {
              updateCar(car.id, {
                finalDeal: {
                  ...car.finalDeal,
                  approvalStatus: 'pending',
                  approvedBy: undefined,
                  approvedAt: undefined,
                },
              });
            }
            setWoEditMode(false);
          } catch (e) {
            console.error(e);
          } finally {
            setWoSaving(false);
          }
        };

        const numInput = (field: string, label: string, prefix = 'RM') => (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-obsidian-400/30">
            <span className="text-gray-400 text-sm flex-1">{label}</span>
            <div className="flex items-center gap-1">
              <span className="text-gray-600 text-xs">{prefix}</span>
              <input
                type="number"
                value={d[field] || ''}
                onChange={e => setD({ [field]: Number(e.target.value) })}
                className="w-28 bg-transparent text-white text-sm text-right outline-none border-b border-transparent focus:border-gold-500/60 transition-colors"
                placeholder="0"
              />
            </div>
          </div>
        );

        const txtInput = (field: string, label: string, multiline = false) => (
          <div className="flex items-start gap-3 px-4 py-3 border-b border-obsidian-400/30">
            <span className="text-gray-400 text-sm flex-1 pt-0.5">{label}</span>
            {multiline ? (
              <textarea
                value={d[field] || ''}
                onChange={e => setD({ [field]: e.target.value })}
                rows={2}
                className="w-40 bg-transparent text-white text-sm text-right outline-none border-b border-transparent focus:border-gold-500/60 transition-colors resize-none"
                placeholder="—"
              />
            ) : (
              <input
                type="text"
                value={d[field] || ''}
                onChange={e => setD({ [field]: e.target.value })}
                className="w-40 bg-transparent text-white text-sm text-right outline-none border-b border-transparent focus:border-gold-500/60 transition-colors"
                placeholder="—"
              />
            )}
          </div>
        );

        return createPortal(
          <div className="fixed inset-0 z-[500] bg-[#080808] overflow-y-auto">
            {/* Header */}
            <div
              className="sticky top-0 z-10 bg-[#0F0E0C] border-b border-obsidian-400/60 px-4 flex items-center justify-between gap-3"
              style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))', paddingBottom: '0.75rem' }}
            >
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm">{isLoan ? 'Loan Work Order' : 'Cash Work Order'}</p>
                <p className="text-gray-500 text-xs truncate">{car.year} {car.make} {car.model} · {buyer.name}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {woTab === 'deal' && (woEditMode ? (
                  <>
                    <button
                      onClick={() => setWoEditMode(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-gray-400 border border-obsidian-400/60 rounded-lg hover:bg-obsidian-700/60 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={woSaving}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-obsidian-900 bg-gold-500 hover:bg-gold-400 rounded-lg transition-colors disabled:opacity-60"
                    >
                      {woSaving ? <><svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving</> : <><Check size={13} />Save</>}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => { setWoEditData({ ...activeWo }); setWoEditMode(true); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gold-400 border border-gold-500/40 rounded-lg hover:bg-gold-500/10 transition-colors"
                    >
                      <Edit2 size={12} />
                      Edit
                    </button>
                    <button
                      onClick={() => setWoCancelConfirm(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
                    >
                      <RotateCcw size={12} />
                      Cancel Deal
                    </button>
                  </>
                ))}
                <button
                  onClick={() => { setWoViewCar(null); setWoEditMode(false); setWoCancelConfirm(false); setWoDeliveryConfirm(false); setWoTab('deal'); }}
                  className="p-1.5 text-gray-500 hover:text-white hover:bg-obsidian-600/60 rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            {/* Tabs */}
            <div className="border-b border-obsidian-400/60 bg-[#0F0E0C] flex justify-center">
              <div className="flex gap-1">
                <button onClick={() => setWoTab('deal')} className={`px-5 py-2.5 text-xs font-semibold transition-colors ${woTab === 'deal' ? 'text-white border-b-2 border-gold-500' : 'text-gray-500 hover:text-gray-300'}`}>Work Order</button>
                <button onClick={() => { setWoTab('postsale'); setWoEditMode(false); }} className={`px-5 py-2.5 text-xs font-semibold transition-colors ${woTab === 'postsale' ? 'text-white border-b-2 border-gold-500' : 'text-gray-500 hover:text-gray-300'}`}>Post-Sale</button>
              </div>
            </div>

            {woTab === 'deal' && <div className="max-w-lg mx-auto px-4 py-5 space-y-6" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>

              {/* ── Deal Section ── */}
              <div>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3">Deal of the Car</p>
                <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden divide-y divide-obsidian-400/30">
                  {woEditMode ? (
                    <>
                      {/* Charges group */}
                      <div className="px-4 pt-3 pb-1">
                        <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-1">Charges</p>
                      </div>
                      {numInput('sellingPrice', 'Selling Price')}
                      {numInput('insurance', 'Insurance')}
                      {numInput('bankProduct', 'Bank Product')}
                      {editExtras.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-3 px-4 py-3 border-b border-obsidian-400/30">
                          <input
                            value={item.label}
                            onChange={e => setD({ additionalItems: editExtras.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) })}
                            placeholder="Item name..."
                            className="flex-1 bg-transparent text-gray-300 text-sm outline-none border-b border-transparent focus:border-gold-500/60"
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-gray-600 text-xs">RM</span>
                            <input
                              type="number"
                              value={item.amount || ''}
                              onChange={e => setD({ additionalItems: editExtras.map((x, i) => i === idx ? { ...x, amount: Number(e.target.value) } : x) })}
                              className="w-24 bg-transparent text-white text-sm text-right outline-none border-b border-transparent focus:border-gold-500/60"
                              placeholder="0"
                            />
                            <button onClick={() => setD({ additionalItems: editExtras.filter((_, i) => i !== idx) })} className="ml-1 text-gray-600 hover:text-red-400 transition-colors">
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        onClick={() => setD({ additionalItems: [...editExtras, { label: '', amount: 0 }] })}
                        className="w-full px-4 py-2.5 text-xs text-gray-600 hover:text-gold-400 text-left transition-colors border-b border-obsidian-400/30"
                      >
                        + Add item
                      </button>

                      {/* Payments Received group */}
                      <div className="px-4 pt-3 pb-1 border-t border-obsidian-400/20">
                        <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-1">Payments Received</p>
                      </div>
                      {isLoan && (
                        <>
                          <div className="flex items-center gap-3 px-4 py-3 border-b border-obsidian-400/30">
                            <span className="text-gray-400 text-sm flex-1">Approved Bank</span>
                            <span className="text-green-400 text-sm font-medium">{lwo?.bank ?? '—'}</span>
                          </div>
                          {numInput('loanAmount', 'Loan Amount')}
                        </>
                      )}
                      {!isLoan && numInput('downpayment', 'Downpayment')}
                      {numInput('bookingFee', 'Booking Fee')}
                      {numInput('discount', 'Discount')}
                    </>
                  ) : (
                    <>
                      {/* Additions */}
                      <div className="px-4 pt-3 pb-1">
                        <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Charges</p>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-400">Selling Price</span>
                            {isDirector && car.finalDeal?.approvalStatus !== 'approved' && activeWo.sellingPrice !== car.sellingPrice ? (
                              <span className="flex items-center gap-1.5 font-mono">
                                <span className="text-gray-600 line-through text-xs">+ {formatRM(car.sellingPrice)}</span>
                                <span className="text-red-400 text-xs">›</span>
                                <span className="text-red-400 font-bold">+ {formatRM(activeWo.sellingPrice)}</span>
                              </span>
                            ) : (
                              <span className="text-white font-mono">+ {formatRM(activeWo.sellingPrice)}</span>
                            )}
                          </div>
                          {activeWo.insurance > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">Insurance</span>
                              <span className="text-white font-mono">+ {formatRM(activeWo.insurance)}</span>
                            </div>
                          )}
                          {activeWo.bankProduct > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">Bank Product</span>
                              <span className="text-white font-mono">+ {formatRM(activeWo.bankProduct)}</span>
                            </div>
                          )}
                          {(activeWo.additionalItems ?? []).filter(x => x.amount > 0).map((item, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-gray-400">{item.label || 'Extra'}</span>
                              <span className="text-white font-mono">+ {formatRM(item.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Deductions */}
                      <div className="px-4 pt-2 pb-1 border-t border-obsidian-400/20">
                        <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Payments Received</p>
                        <div className="space-y-1.5">
                          {isLoan && lwo && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">Loan ({lwo.bank})</span>
                              <span className="text-red-400 font-mono">− {formatRM(lwo.loanAmount)}</span>
                            </div>
                          )}
                          {!isLoan && cwo && (cwo.downpayment ?? 0) > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">Downpayment</span>
                              <span className="text-red-400 font-mono">− {formatRM(cwo.downpayment)}</span>
                            </div>
                          )}
                          {(activeWo.bookingFee ?? 0) > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">Booking Fee</span>
                              <span className="text-red-400 font-mono">− {formatRM(activeWo.bookingFee)}</span>
                            </div>
                          )}
                          {activeWo.discount > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">Discount</span>
                              {isDirector && car.finalDeal?.approvalStatus !== 'approved' ? (
                                <span className="flex items-center gap-1.5 font-mono">
                                  <span className="text-gray-600 line-through text-xs">RM 0</span>
                                  <span className="text-red-400 text-xs">›</span>
                                  <span className="text-red-400 font-bold">− {formatRM(activeWo.discount)}</span>
                                </span>
                              ) : (
                                <span className="text-red-400 font-mono">− {formatRM(activeWo.discount)}</span>
                              )}
                            </div>
                          )}
                          {activeWo.hasTradeIn && viewNetTradeIn > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">Trade-In (net)</span>
                              <span className="text-red-400 font-mono">− {formatRM(viewNetTradeIn)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                  {/* Balance row */}
                  <div className="flex items-center gap-3 px-4 py-3 border-t border-obsidian-400/40 bg-obsidian-700/30">
                    <span className="text-white font-bold text-sm flex-1">
                      {displayTotal < 0 ? 'Refund to Customer' : displayTotal > 0 ? 'Balance Due' : 'Fully Settled'}
                    </span>
                    <span className={`font-bold text-sm font-mono ${displayTotal < 0 ? 'text-green-400' : displayTotal > 0 ? 'text-amber-300' : 'text-gold-400'}`}>
                      {displayTotal < 0 ? `− ${formatRM(Math.abs(displayTotal))}` : formatRM(displayTotal)}
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Customer Section ── */}
              <div>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3">Customer Info</p>
                <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden divide-y divide-obsidian-400/30">
                  {woEditMode ? (
                    <>
                      {txtInput('customerName', 'Name')}
                      {txtInput('customerIc', 'IC')}
                      {txtInput('customerPhone', 'Phone')}
                      {txtInput('customerEmail', 'Email')}
                      {txtInput('customerAddress', 'Address', true)}
                    </>
                  ) : (
                    <>
                      <Row label="Name" value={activeWo.customerName} />
                      <Row label="IC" value={activeWo.customerIc || '—'} />
                      <Row label="Phone" value={activeWo.customerPhone || '—'} />
                      {activeWo.customerEmail && <Row label="Email" value={activeWo.customerEmail} />}
                      {activeWo.customerAddress && <Row label="Address" value={activeWo.customerAddress} />}
                    </>
                  )}
                </div>
              </div>

              {/* ── Trade-In Section ── */}
              {(activeWo.hasTradeIn || (woEditMode && d.hasTradeIn)) && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest">Trade-In</p>
                    {woEditMode && (
                      <button
                        onClick={() => setD({ hasTradeIn: !d.hasTradeIn })}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Remove trade-in
                      </button>
                    )}
                  </div>
                  <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden divide-y divide-obsidian-400/30">
                    {woEditMode ? (
                      <>
                        {txtInput('tradeInPlate', 'Plate')}
                        {txtInput('tradeInMake', 'Make')}
                        {txtInput('tradeInModel', 'Model')}
                        {txtInput('tradeInVariant', 'Variant')}
                        {numInput('tradeInPrice', 'Trade-In Value')}
                        {numInput('settlementFigure', 'Settlement')}
                        <div className="flex items-center gap-3 px-4 py-3 bg-obsidian-700/30">
                          <span className="text-gray-400 text-sm flex-1">Net Trade-In</span>
                          <span className="text-white font-semibold text-sm">{formatRM(editNetTradeIn)}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <Row label="Plate" value={activeWo.tradeInPlate || '—'} />
                        <Row label="Car" value={`${activeWo.tradeInMake} ${activeWo.tradeInModel}${activeWo.tradeInVariant ? ` ${activeWo.tradeInVariant}` : ''}`} />
                        <Row label="Trade-In Value" value={formatRM(activeWo.tradeInPrice)} valueClass="text-green-400" />
                        {activeWo.settlementFigure > 0 && <Row label="Settlement" value={`- ${formatRM(activeWo.settlementFigure)}`} valueClass="text-red-400" />}
                        <Row label="Net Trade-In" value={formatRM(viewNetTradeIn)} valueClass="text-white font-semibold" />
                      </>
                    )}
                  </div>
                </div>
              )}
              {woEditMode && !d.hasTradeIn && (
                <button
                  onClick={() => setD({ hasTradeIn: true, tradeInPlate: '', tradeInMake: '', tradeInModel: '', tradeInVariant: '', tradeInPrice: 0, settlementFigure: 0 })}
                  className="w-full py-2.5 text-xs font-semibold text-gray-500 border border-dashed border-obsidian-400/40 rounded-xl hover:border-gold-500/40 hover:text-gold-400 transition-colors"
                >
                  + Add Trade-In
                </button>
              )}

              {/* ── Meta Section ── */}
              <div>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3">Submission</p>
                <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden divide-y divide-obsidian-400/30">
                  <Row label="Submitted by" value={activeWo.submittedBy} />
                  <Row label="Submitted at" value={activeWo.createdAt ? new Date(activeWo.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} />
                  {car.finalDeal?.approvalStatus && (
                    <Row
                      label="Approval"
                      value={car.finalDeal.approvalStatus === 'approved' ? 'Approved' : car.finalDeal.approvalStatus === 'rejected' ? 'Rejected' : 'Pending'}
                      valueClass={car.finalDeal.approvalStatus === 'approved' ? 'text-green-400' : car.finalDeal.approvalStatus === 'rejected' ? 'text-red-400' : 'text-amber-400'}
                    />
                  )}
                  {car.finalDeal?.approvedBy && <Row label="Approved by" value={car.finalDeal.approvedBy} />}
                  {car.finalDeal?.notes && <Row label="Notes" value={car.finalDeal.notes} />}
                </div>

                {/* Director approve / reject — shown when pending or unset (legacy deals) */}
                {isDirector && car.finalDeal && car.finalDeal.approvalStatus !== 'approved' && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        updateCar(car.id, {
                          finalDeal: {
                            ...car.finalDeal!,
                            approvalStatus: 'approved',
                            approvedBy: currentUser!.name,
                            approvedAt: new Date().toISOString(),
                          },
                        });
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-500/15 hover:bg-green-500/25 border border-green-500/40 text-green-400 text-sm font-semibold transition-colors"
                    >
                      <CheckCircle size={14} /> Approve
                    </button>
                    <button
                      onClick={() => {
                        const notes = window.prompt('Reason for rejection (optional):') ?? '';
                        updateCar(car.id, {
                          finalDeal: {
                            ...car.finalDeal!,
                            approvalStatus: 'rejected',
                            rejectionNotes: notes || undefined,
                          },
                        });
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-400 text-sm font-semibold transition-colors"
                    >
                      <XCircle size={14} /> Reject
                    </button>
                  </div>
                )}
              </div>

            </div>}

            {woTab === 'postsale' && (
              <div className="max-w-lg mx-auto px-4 py-5 space-y-4" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>
                <PostSalePanel buyerId={buyer.id} />

                {/* Deliver — button or inline confirm, always visible in the same spot */}
                {!woDeliveryConfirm ? (
                  <button
                    onClick={() => setWoDeliveryConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors"
                  >
                    <ClipboardList size={15} />
                    Confirm Delivery
                  </button>
                ) : (
                  <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-4 space-y-3">
                    <p className="text-violet-200 text-sm font-semibold text-center">Mark as delivered?</p>
                    <p className="text-violet-300/60 text-xs text-center">Car moves to delivered, deal archived.</p>
                    <div className="flex gap-2">
                      <button onClick={() => setWoDeliveryConfirm(false)} className="flex-1 py-2.5 text-xs font-semibold text-gray-400 border border-obsidian-400/50 rounded-lg hover:bg-obsidian-700/60 transition-colors">Cancel</button>
                      <button onClick={handleDelivery} className="flex-1 py-2.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors">Yes, Delivered</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Cancel Deal confirmation banner — floats above both tabs */}
            {woCancelConfirm && (
              <div className="max-w-lg mx-auto px-4 pb-4">
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-red-400 text-sm font-semibold">Cancel this deal?</p>
                      <p className="text-red-400/70 text-xs mt-0.5">Work order will be removed, car returns to available, and customer reverts to lead.</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setWoCancelConfirm(false)} className="flex-1 py-2 text-xs font-semibold text-gray-400 border border-obsidian-400/50 rounded-lg hover:bg-obsidian-700/60 transition-colors">Keep Deal</button>
                    <button onClick={handleCancelDeal} className="flex-1 py-2 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors">Yes, Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}

function PostSalePanel({ buyerId }: { buyerId: string }) {
  const buyer = useStore((s) => s.customers.find((c) => c.id === buyerId));
  const updateCustomer = useStore((s) => s.updateCustomer);
  const addPersonalReminder = useStore((s) => s.addPersonalReminder);

  // Local state drives all toggles immediately — avoids realtime-overwrite flicker
  const [cl, setCl] = React.useState<PostSaleChecklist>(() => buyer?.postSaleChecklist ?? {});

  // Auto-open calendar the moment "Book Puspakom" is first ticked
  const dateInputRef = React.useRef<HTMLInputElement>(null);
  const prevBooked = React.useRef(!!buyer?.postSaleChecklist?.puspakomBooked);
  React.useLayoutEffect(() => {
    if (!prevBooked.current && cl.puspakomBooked && dateInputRef.current) {
      try { dateInputRef.current.showPicker(); } catch { dateInputRef.current.click(); }
    }
    prevBooked.current = !!cl.puspakomBooked;
  }, [cl.puspakomBooked]);

  if (!buyer) return null;

  const isLoan = !!buyer.loanWorkOrder;
  const bankName = buyer.loanWorkOrder?.bank ?? '';

  const update = (patch: Partial<PostSaleChecklist>) => {
    const newCl = { ...cl, ...patch };
    setCl(newCl);
    updateCustomer(buyerId, { postSaleChecklist: newCl });
  };

  // B5 (+ B7 for loan) are automatically obtained once Puspakom Done is ticked
  const puspakomDone = !!cl.puspakomDone;
  const canEHak = isLoan && puspakomDone;
  const canInsurance = isLoan ? !!cl.eHakDone : puspakomDone;
  const canTransfer = !!cl.insuranceCoverNote;

  // Progress steps
  const allSteps: boolean[] = [
    !!cl.agreementSigned,
    !!cl.thumbprintDone,
    !!cl.puspakomBooked,
    ...(cl.wantsCustomPlate ? [!!cl.b2Booked, !!cl.b2Obtained] : []),
    puspakomDone,
    ...(isLoan ? [!!cl.eHakDone] : []),
    !!cl.insuranceCoverNote,
    !!cl.nameTransferDone,
  ];
  const doneCt = allSteps.filter(Boolean).length;
  const totalCt = allSteps.length;
  const pct = totalCt === 0 ? 0 : Math.round((doneCt / totalCt) * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest">Post-Sale Checklist</p>
        <span className={`text-xs font-bold ${pct === 100 ? 'text-green-400' : pct >= 60 ? 'text-gold-400' : 'text-gray-400'}`}>{doneCt}/{totalCt} · {pct}%</span>
      </div>
      <div className="h-1.5 bg-obsidian-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-gold-500'}`} style={{ width: `${pct}%` }} />
      </div>

      {/* ── Sale Agreement ── */}
      <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-obsidian-700/40 border-b border-obsidian-400/30">
          <p className="text-white text-[10px] font-bold uppercase tracking-wide">Sale Agreement</p>
        </div>
        <PSStep
          done={!!cl.agreementSigned}
          label={isLoan ? `Sign Loan Agreement · ${bankName}` : 'Sign S&P Agreement'}
          onToggle={() => update({ agreementSigned: !cl.agreementSigned })}
        />
        <PSStep
          done={!!cl.thumbprintDone}
          label="Buyer Thumbprint"
          onToggle={() => update({ thumbprintDone: !cl.thumbprintDone })}
        />
      </div>

      {/* ── Puspakom ── */}
      <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-obsidian-700/40 border-b border-obsidian-400/30">
          <p className="text-white text-[10px] font-bold uppercase tracking-wide">Puspakom</p>
        </div>
        <PSStep
          done={!!cl.puspakomBooked}
          label="Book Puspakom"
          sub={isLoan ? 'Will obtain: B5 + B7' : 'Will obtain: B5'}
          onToggle={() => update({ puspakomBooked: !cl.puspakomBooked })}
        />
        {/* Date picker slides in after booking */}
        {cl.puspakomBooked && (
          <div className="relative border-b border-obsidian-400/20 bg-obsidian-800/30">
            <div className="flex items-center justify-between px-4 py-3 pointer-events-none">
              <span className="text-xs text-gray-400 flex items-center gap-2">
                <Calendar size={13} />
                Appointment Date
              </span>
              <span className={`text-xs font-medium ${cl.puspakomDate ? 'text-white' : 'text-gray-600'}`}>
                {cl.puspakomDate
                  ? new Date(cl.puspakomDate + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
                  : 'Tap to pick date'}
              </span>
            </div>
            <input
              ref={dateInputRef}
              type="date"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              value={cl.puspakomDate ?? ''}
              onChange={e => {
                const newDate = e.target.value;
                update({ puspakomDate: newDate || undefined });
                if (newDate && buyer.assignedSalesId) {
                  addPersonalReminder({
                    id: generateId(),
                    userId: buyer.assignedSalesId,
                    title: `Puspakom appointment – ${buyer.name}`,
                    dueAt: newDate,
                    isCompleted: false,
                    createdAt: new Date().toISOString(),
                  });
                }
              }}
            />
          </div>
        )}
        {/* Custom plate toggle */}
        <div className="px-4 py-3 border-b border-obsidian-400/20 flex items-center justify-between">
          <div>
            <p className="text-white text-sm font-medium">Custom Plate (B2)</p>
            <p className="text-gray-600 text-xs">Customer wants to change plate number</p>
          </div>
          <button
            onClick={() => update({ wantsCustomPlate: !cl.wantsCustomPlate })}
            className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${cl.wantsCustomPlate ? 'bg-gold-500' : 'bg-obsidian-500'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${cl.wantsCustomPlate ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>
        {cl.wantsCustomPlate && (
          <>
            <PSStep done={!!cl.b2Booked} label="Book B2" sub="Custom plate application" onToggle={() => update({ b2Booked: !cl.b2Booked })} />
            <PSStep done={!!cl.b2Obtained} label="B2 Obtained" onToggle={() => update({ b2Obtained: !cl.b2Obtained })} />
          </>
        )}
        {/* Puspakom Done — auto-implies B5 (+ B7 for loan) obtained */}
        <PSStep
          done={puspakomDone}
          locked={!cl.puspakomBooked}
          label="Puspakom Done"
          sub={!cl.puspakomBooked ? 'Book puspakom first' : undefined}
          onToggle={() => update({ puspakomDone: !cl.puspakomDone })}
        />
        {/* Show B5 / B7 as auto-obtained once done */}
        {puspakomDone && (
          <div className="px-4 py-2.5 flex items-center gap-3 bg-green-500/5 border-t border-green-500/10">
            <CheckCircle size={14} className="text-green-500 shrink-0" />
            <span className="text-xs text-green-400">{isLoan ? 'B5 + B7 obtained' : 'B5 obtained'}</span>
          </div>
        )}
      </div>

      {/* ── eHak (loan only) ── */}
      {isLoan && (
        <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-obsidian-700/40 border-b border-obsidian-400/30">
            <p className="text-white text-[10px] font-bold uppercase tracking-wide">eHak</p>
          </div>
          <PSStep
            done={!!cl.eHakDone}
            locked={!canEHak}
            label="eHak Done"
            sub={!canEHak ? 'Complete Puspakom first' : 'Hire purchase ownership transfer'}
            onToggle={() => update({ eHakDone: !cl.eHakDone })}
          />
        </div>
      )}

      {/* ── Insurance & Transfer ── */}
      <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-obsidian-700/40 border-b border-obsidian-400/30">
          <p className="text-white text-[10px] font-bold uppercase tracking-wide">Insurance & Transfer</p>
        </div>
        <PSStep
          done={!!cl.insuranceCoverNote}
          locked={!canInsurance}
          label="Insurance Cover Note"
          sub={!canInsurance ? (isLoan ? 'Complete eHak first' : 'Complete Puspakom first') : undefined}
          onToggle={() => update({ insuranceCoverNote: !cl.insuranceCoverNote })}
        />
        <PSStep
          done={!!cl.nameTransferDone}
          locked={!canTransfer}
          label="Name Transfer (JPJ)"
          sub={!canTransfer ? 'Requires insurance cover note' : undefined}
          onToggle={() => update({ nameTransferDone: !cl.nameTransferDone })}
        />
      </div>
    </div>
  );
}

function PSStep({ done, locked, label, sub, onToggle }: { done: boolean; locked?: boolean; label: string; sub?: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!!locked}
      className={`w-full flex items-center gap-3 px-4 py-3 border-b border-obsidian-400/20 text-left transition-colors ${locked ? 'opacity-40 cursor-not-allowed' : 'hover:bg-obsidian-700/40'}`}
    >
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${done ? 'bg-green-500 border-green-500' : locked ? 'border-gray-600' : 'border-gray-500'}`}>
        {done && <CheckCircle size={12} className="text-white" />}
        {locked && !done && <Lock size={9} className="text-gray-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${done ? 'text-green-400 line-through opacity-60' : locked ? 'text-gray-600' : 'text-white'}`}>{label}</p>
        {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
      </div>
    </button>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="text-gray-400 text-sm flex-1">{label}</span>
      <span className={`text-sm text-right max-w-[60%] ${valueClass ?? 'text-white'}`}>{value}</span>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  labels,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labels?: string[];
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input appearance-none pl-3 pr-8 py-2.5 cursor-pointer"
      >
        {options.map((opt, i) => (
          <option key={opt} value={opt}>
            {labels ? labels[i] : opt === 'All' ? placeholder ?? opt : opt}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
    </div>
  );
}

function FormField({
  label,
  children,
  error,
  className,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-gray-300 text-xs font-medium mb-1.5">{label}</label>
      {children}
      {error && (
        <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
          <AlertCircle size={12} /> {error}
        </p>
      )}
    </div>
  );
}

function inputCls(error?: string) {
  return `input ${error ? '!border-red-500/50' : ''}`;
}

// Export Filter icon for use
export { Filter };
