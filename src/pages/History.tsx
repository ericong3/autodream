import { useState, useMemo, useEffect, useRef } from 'react';
import { thumbUrl } from '../utils/photoUrl';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutGrid,
  List,
  Car as CarIcon,
  TrendingUp,
  CheckCircle,
  DollarSign,
  MapPin,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Banknote,
  SlidersHorizontal,
  Building2,
  HeartHandshake,
  Lock,
  Unlock,
  Clock,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
  useDroppable,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Car } from '../types';
import { formatRM as _formatRM } from '../utils/format';
import Modal from '../components/Modal';
import { useStore } from '../store';
import { generateLoanDisbursement, getDeliveryDate } from '../utils/generatePayments';
import { buildDisbursementReceivedEntry } from '../utils/generateJournalEntries';
import { getCaseCompletion } from '../utils/caseCompletion';
import { formatRM, formatMileage, shortName } from '../utils/format';
import StatCard from '../components/StatCard';
import { CarDetailContent } from './CarDetail';
import { SkeletonCard, SkeletonRow } from '../components/Skeleton';

// ── Drag helpers ─────────────────────────────────────────────────────────────

function SortableCarItem({ id, children, dragEnabled }: { id: string; children: React.ReactNode; dragEnabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !dragEnabled });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.2 : 1,
        touchAction: 'none',
        userSelect: 'none',
      }}
      {...(dragEnabled ? attributes : {})}
      {...(dragEnabled ? listeners : {})}
      className={`touch-none ${dragEnabled ? 'cursor-grab active:cursor-grabbing' : ''}`}
      onDragStart={(e) => e.preventDefault()}
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
          <p className="text-gold-400 text-xs font-bold mt-0.5">{_formatRM(car.sellingPrice)}</p>
        </div>
      </div>
    </div>
  );
}

function MonthDropZone({ id, onClick, children, isDragActive }: {
  id: string;
  onClick: () => void;
  children: React.ReactNode;
  isDragActive: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef}>
      <button
        onClick={onClick}
        className={`px-3 py-2.5 transition-all duration-150 ${
          isOver
            ? 'text-white bg-gold-500 scale-125'
            : isDragActive
            ? 'text-gold-400 bg-gold-500/20'
            : 'text-gray-400 hover:text-white hover:bg-obsidian-500/60'
        }`}
      >
        {children}
      </button>
    </div>
  );
}

// ── Select helper ─────────────────────────────────────────────────────────────
function Select({ value, onChange, options, labels, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labels?: string[];
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input appearance-none pl-3 pr-8 py-2.5 cursor-pointer">
        {options.map((opt, i) => (
          <option key={opt} value={opt}>{labels ? labels[i] : opt === 'All' ? (placeholder ?? opt) : opt}</option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function History() {
  const cars = useStore((s) => s.cars);
  const users = useStore((s) => s.users);
  const customers = useStore((s) => s.customers);
  const repairs = useStore((s) => s.repairs);
  const currentUser = useStore((s) => s.currentUser);
  const updateCar = useStore((s) => s.updateCar);
  const updateCustomer = useStore((s) => s.updateCustomer);
  const payments = useStore((s) => s.payments);
  const addPayment = useStore((s) => s.addPayment);
  const addJournalEntry = useStore((s) => s.addJournalEntry);
  const ledgerAccounts = useStore((s) => s.ledgerAccounts);
  const addLedgerAccount = useStore((s) => s.addLedgerAccount);
  const updatePayment = useStore((s) => s.updatePayment);
  const viewPreference = useStore((s) => s.viewPreference);
  const setViewPreference = useStore((s) => s.setViewPreference);

  const { id: selectedCarId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const isDirectorView = currentUser?.role === 'director' || currentUser?.role === 'shareholder';
  // Moving delivered cars between months changes finalDeal/dateAdded — director only,
  // and only once they explicitly unlock edit mode (prevents accidental drags).
  const isDirector = currentUser?.role === 'director';
  const [editMode, setEditMode] = useState(false);
  const canDragCars = isDirector && editMode;
  const viewKey = `${currentUser?.id}-history`;
  const view = viewPreference[viewKey] ?? 'grid';

  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState<string>(new Date().toISOString().slice(0, 7));
  const [initialLoad, setInitialLoad] = useState(true);
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [cardOrder, setCardOrder] = useState<string[]>([]);
  const dragActiveRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const emptySensors = useSensors();

  useEffect(() => {
    const t = setTimeout(() => setInitialLoad(false), 500);
    return () => clearTimeout(t);
  }, []);

  const shiftMonth = (dir: -1 | 1) => {
    const [y, m] = monthFilter.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setMonthFilter(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const [filterMake, setFilterMake] = useState('All');
  const [disbursalCarId, setDisbursalCarId] = useState<string | null>(null);
  const [disbursalForm, setDisbursalForm] = useState({
    expected: '',   // Total Price — what the deal says the bank should pay out (prefilled from the loan work order, editable)
    actual: '',     // Amount Disbursed — the actual net amount that landed
    date: '',
    charges: [] as { label: string; amount: string }[], // itemized deductions (processing fee, service charge, insurance cover note, etc.)
  });
  // Read-only snapshot of the work order behind the Total Price prefill, so
  // the modal can show exactly how the bank's loan amount was arrived at
  // (selling price, discount, insurance, bank product, booking fee already
  // collected) instead of just a single opaque number.
  const [disbursalDealInfo, setDisbursalDealInfo] = useState<{
    bank: string; sellingPrice: number; discount: number; insurance: number;
    bankProduct: number; additionalTotal: number; bookingFee: number; loanAmount: number;
  } | null>(null);

  const soldCars = useMemo(() => {
    let result = cars.filter((c) => c.status === 'delivered');
    if (monthFilter) result = result.filter((c) => getDeliveryDate(c, customers).startsWith(monthFilter));
    if (filterMake !== 'All') result = result.filter((c) => c.make === filterMake);
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
    return result.sort((a, b) => new Date(getDeliveryDate(b, customers)).getTime() - new Date(getDeliveryDate(a, customers)).getTime());
  }, [cars, customers, search, monthFilter, filterMake]);

  // Sync drag order — preserve manual order, only add/remove changed cars
  useEffect(() => {
    setCardOrder(prev => {
      const ids = soldCars.map(c => c.id);
      const set = new Set(ids);
      return [...prev.filter(id => set.has(id)), ...ids.filter(id => !prev.includes(id))];
    });
  }, [soldCars]);

  const orderedCars = useMemo(
    () => cardOrder.map(id => soldCars.find(c => c.id === id)).filter(Boolean) as typeof soldCars,
    [soldCars, cardOrder],
  );

  const carCalcMap = useMemo(() => {
    const map: Record<string, { dealNetPrice: number; profit: number }> = {};
    for (const c of cars.filter(x => x.status === 'delivered')) {
      const wo = customers.find(cu => cu.interestedCarId === c.id && (cu.cashWorkOrder || cu.loanWorkOrder));
      const w = wo?.loanWorkOrder ?? wo?.cashWorkOrder;
      const grossPrice = (w?.sellingPrice && w.sellingPrice > 0) ? w.sellingPrice : (c.finalDeal?.dealPrice ?? c.sellingPrice);
      const discount = w?.discount ?? 0;
      const additionalTotal = w?.additionalItems?.reduce((a, i) => a + i.amount, 0) ?? 0;
      const repairCosts = repairs.filter(r => r.carId === c.id && r.status === 'done').reduce((a, r) => a + (r.actualCost ?? r.totalCost), 0);
      const miscCosts = (c.miscCosts ?? []).reduce((a, m) => a + m.amount, 0);
      const dealNetPrice = grossPrice - discount;
      const profitBeforeCommission = dealNetPrice - c.purchasePrice - repairCosts - miscCosts - additionalTotal;
      const commission = (c.outgoingConsignment || c.isStaffSale) ? 0 : (c.consignment || (c.priceFloor != null && dealNetPrice < c.priceFloor)) ? 1000 : 1500;
      map[c.id] = { dealNetPrice, profit: profitBeforeCommission - commission };
    }
    return map;
  }, [cars, customers, repairs]);

  const totalRevenue = soldCars.reduce((s, c) => s + (carCalcMap[c.id]?.dealNetPrice ?? c.sellingPrice), 0);
  const totalProfit = soldCars.reduce((s, c) => s + (carCalcMap[c.id]?.profit ?? 0), 0);

  const getDealSalespersonId = (car: typeof cars[0]): string | undefined => {
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    return car.assignedSalesperson || dealCustomer?.assignedSalesId;
  };

  // A car can have many customer records pointing at it (every lead who was
  // ever interested, not just the one who closed) — only the one with an
  // actual work order attached is the real deal.
  const getDealCustomer = (car: typeof cars[0]) =>
    customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));

  // Determine payment type for a delivered car
  const getPaymentType = (car: typeof cars[0]): { type: 'loan' | 'cash' | 'consignment'; label: string } => {
    if (car.outgoingConsignment) return { type: 'consignment', label: 'Dealer Payment' };
    const customer = getDealCustomer(car);
    if (customer?.loanWorkOrder) return { type: 'loan', label: `${customer.loanWorkOrder.bank} Disbursement` };
    if (car.finalDeal?.bank && car.finalDeal.bank.toLowerCase() !== 'cash') return { type: 'loan', label: `${car.finalDeal.bank} Disbursement` };
    return { type: 'cash', label: 'Cash Payment' };
  };

  // Loan/consignment payouts step Pending -> Processing -> Disbursed (the
  // last tap opens the modal to record the expected vs. actual amount and
  // itemize the difference); cash stays a single-tap toggle. moneyReceived
  // is kept in sync (true only once Disbursed) since other code still reads
  // it directly.
  const handleMoneyStatusClick = (car: typeof cars[0]) => {
    if (car.moneyReceived) { navigate(`/history/${car.id}`); return; }
    const { type } = getPaymentType(car);
    if (type === 'loan' || type === 'consignment') {
      const status = car.disbursementStatus ?? 'pending';
      if (status === 'pending') {
        updateCar(car.id, { disbursementStatus: 'processing' });
      } else {
        const wo = getDealCustomer(car)?.loanWorkOrder;
        const expected = car.disbursementExpectedAmount ?? wo?.loanAmount ?? car.disbursementAmount ?? car.finalDeal?.dealPrice ?? 0;
        setDisbursalDealInfo(wo ? {
          bank: wo.bank,
          sellingPrice: wo.sellingPrice ?? 0,
          discount: wo.discount ?? 0,
          insurance: wo.insurance ?? 0,
          bankProduct: wo.bankProduct ?? 0,
          additionalTotal: (wo.additionalItems ?? []).reduce((s, i) => s + (i.amount || 0), 0),
          bookingFee: wo.bookingFee ?? 0,
          loanAmount: wo.loanAmount ?? 0,
        } : null);
        setDisbursalForm({
          expected: String(expected || ''),
          actual: String(car.disbursementAmount ?? ''),
          date: car.disbursementDate ?? '',
          charges: (car.disbursementCharges ?? []).map(c => ({ label: c.label, amount: String(c.amount) })),
        });
        setDisbursalCarId(car.id);
      }
    } else {
      updateCar(car.id, { moneyReceived: true });
    }
  };

  const getMoneyStatusDisplay = (car: typeof cars[0]): { icon: typeof CheckCircle; text: string; state: 'received' | 'processing' | 'pending' } => {
    const { type, label } = getPaymentType(car);
    if (car.moneyReceived) {
      return { icon: CheckCircle, text: car.disbursementAmount ? `RM ${car.disbursementAmount.toLocaleString()}` : 'Received', state: 'received' };
    }
    if ((type === 'loan' || type === 'consignment') && car.disbursementStatus === 'processing') {
      return { icon: Clock, text: 'Processing', state: 'processing' };
    }
    const Icon = type === 'loan' ? Building2 : type === 'consignment' ? HeartHandshake : Banknote;
    return { icon: Icon, text: label, state: 'pending' };
  };

  // Each distinct deduction label (Processing Fee, Service Charge, Insurance
  // Cover Note, ...) gets its own expense account so the ledger shows how
  // much is being lost to each type of bank/panel charge over time, without
  // requiring the account to be pre-set-up — it's created on first use.
  const getOrCreateChargeAccount = async (label: string): Promise<string> => {
    const trimmed = label.trim();
    const existing = ledgerAccounts.find(a => a.type === 'expense' && a.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || crypto.randomUUID().slice(0, 8);
    const id = `acct-exp-disb-${slug}`;
    await addLedgerAccount({ id, name: trimmed, type: 'expense' });
    return id;
  };

  const getSalesperson = (id?: string) => {
    const name = id ? users.find((u) => u.id === id)?.name : undefined;
    return name ? shortName(name) : 'Unassigned';
  };

  const monthLabel = monthFilter
    ? new Date(monthFilter + '-01').toLocaleString('en-MY', { month: 'long', year: 'numeric' })
    : '';

  const hasFilters = search || filterMake !== 'All';

  if (selectedCarId) {
    return (
      <CarDetailContent
        id={selectedCarId}
        onBack={() => navigate('/history')}
        backLabel="Back to Delivered"
        initialTab="final_deal"
      />
    );
  }

  // Collision: pointer-within month zones takes priority, then closestCenter for grid
  const collisionDetection: CollisionDetection = (args) => {
    const monthHits = pointerWithin({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        c => c.id === 'prev-month' || c.id === 'next-month'
      ),
    });
    if (monthHits.length > 0) return monthHits;
    return closestCenter(args);
  };

  const handleDragEnd = (e: Parameters<NonNullable<React.ComponentProps<typeof DndContext>['onDragEnd']>>[0]) => {
    dragActiveRef.current = false;
    setDragActiveId(null);
    const { active, over } = e;
    if (!over || !canDragCars) return;

    if (over.id === 'prev-month' || over.id === 'next-month') {
      const car = cars.find(c => c.id === active.id as string);
      if (!car) return;
      const dir = over.id === 'next-month' ? 1 : -1;
      const [y, m] = monthFilter.split('-').map(Number);
      const target = new Date(y, m - 1 + dir, 1);
      const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`;
      // Updates the actual deliveredAt on the deal customer — the real
      // source of truth getDeliveryDate() reads everywhere (Commission,
      // Payroll, dashboards) — not finalDeal.submittedAt/dateAdded, which
      // are earlier milestones that can predate actual delivery and used to
      // make dragging here silently not affect commission attribution.
      const dealCustomer = customers.find(cu => cu.interestedCarId === car.id && (cu.cashWorkOrder || cu.loanWorkOrder));
      if (dealCustomer) {
        updateCustomer(dealCustomer.id, { deliveredAt: iso });
      } else if (car.finalDeal) {
        updateCar(car.id, { finalDeal: { ...car.finalDeal, submittedAt: iso } });
      } else {
        updateCar(car.id, { dateAdded: iso.split('T')[0] });
      }
      return;
    }

    if (active.id === over.id) return;
    setCardOrder(prev => {
      const oi = prev.indexOf(active.id as string);
      const ni = prev.indexOf(over.id as string);
      return (oi >= 0 && ni >= 0) ? arrayMove(prev, oi, ni) : prev;
    });
  };

  return (
  <DndContext
    sensors={canDragCars ? sensors : emptySensors}
    collisionDetection={collisionDetection}
    onDragStart={(e) => { dragActiveRef.current = true; setDragActiveId(e.active.id as string); }}
    onDragEnd={handleDragEnd}
    onDragCancel={() => { dragActiveRef.current = false; setDragActiveId(null); }}
  >
    <div className="space-y-5">
      {/* Stat cards */}
      <div className={`grid grid-cols-1 gap-4 ${isDirectorView ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <StatCard title="Units Delivered" value={soldCars.length} icon={CheckCircle} borderColor="border-l-green-400" iconColor="text-green-400" />
        <StatCard title="Total Revenue" value={formatRM(totalRevenue)} icon={DollarSign} borderColor="border-l-gold-400" iconColor="text-gold-400" />
        {isDirectorView && <StatCard title="Total Profit" value={formatRM(totalProfit)} icon={TrendingUp} borderColor="border-l-yellow-400" iconColor="text-yellow-400" />}
      </div>

      {/* ── Sticky filter bar ── */}
      <div className="sticky top-0 z-10 bg-obsidian-950/95 backdrop-blur-sm -mx-4 px-4 md:-mx-6 md:px-6 py-3 border-b border-obsidian-400/20">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search delivered..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 pr-4 py-2.5 w-full"
            />
          </div>

          {/* Month navigator */}
          <div className="flex items-center border border-obsidian-400/60 rounded-lg overflow-hidden" style={{ background: '#0E0D0B' }}>
            <MonthDropZone id="prev-month" onClick={() => shiftMonth(-1)} isDragActive={!!dragActiveId}>
              <ChevronLeft size={16} />
            </MonthDropZone>
            <span className="px-3 text-sm text-white font-medium whitespace-nowrap">{monthLabel}</span>
            <MonthDropZone id="next-month" onClick={() => shiftMonth(1)} isDragActive={!!dragActiveId}>
              <ChevronRight size={16} />
            </MonthDropZone>
          </div>

          {/* Edit mode toggle — director must explicitly unlock before cards can be dragged between months */}
          {isDirector && (
            <button
              onClick={() => setEditMode((v) => !v)}
              title={editMode ? 'Editing enabled — drag a card onto a month arrow to move it. Click to lock.' : 'Unlock to drag cards between months'}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                editMode
                  ? 'bg-gold-500/15 border-gold-500/40 text-gold-400'
                  : 'border-obsidian-400/60 text-gray-400 hover:text-white'
              }`}
              style={editMode ? undefined : { background: '#0E0D0B' }}
            >
              {editMode ? <Unlock size={14} /> : <Lock size={14} />}
              {editMode ? 'Editing On' : 'Edit Mode'}
            </button>
          )}

          {/* Make filter */}
          <Select
            value={filterMake}
            onChange={setFilterMake}
            options={['All', 'Perodua', 'Proton', 'Honda', 'Toyota', 'Nissan', 'Other']}
            placeholder="Brand"
          />

          {/* View toggle */}
          <div className="flex border border-obsidian-400/60 rounded-lg p-1 gap-1" style={{ background: '#0E0D0B' }}>
            <button
              onClick={() => setViewPreference(currentUser!.id, 'history', 'grid')}
              className={`p-1.5 rounded-md transition-colors ${view === 'grid' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewPreference(currentUser!.id, 'history', 'list')}
              className={`p-1.5 rounded-md transition-colors ${view === 'list' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Count */}
      {!initialLoad && soldCars.length > 0 && (
        <p className="text-gray-500 text-sm">
          <span className="text-white font-medium">{soldCars.length}</span> delivered unit{soldCars.length !== 1 ? 's' : ''}
          {monthLabel && <span className="ml-1">in {monthLabel}</span>}
        </p>
      )}

      {/* ── Skeleton loaders ── */}
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

      {/* ── Empty state ── */}
      {!initialLoad && soldCars.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-obsidian-800/80 border border-obsidian-400/40 flex items-center justify-center mb-4">
            <CarIcon size={28} className="text-gray-600" />
          </div>
          <p className="text-white font-semibold text-base">No delivered units</p>
          <p className="text-gray-500 text-sm mt-1">
            {hasFilters ? 'No results match your filters' : `Nothing delivered in ${monthLabel}`}
          </p>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setFilterMake('All'); }}
              className="mt-4 px-4 py-2 rounded-lg bg-obsidian-700/60 border border-obsidian-400/40 text-gray-300 hover:text-white hover:border-gold-500/30 text-sm transition-colors flex items-center gap-2"
            >
              <SlidersHorizontal size={14} /> Clear Filters
            </button>
          )}
        </div>
      )}

      {/* ── Grid view ── */}
      {!initialLoad && view === 'grid' && soldCars.length > 0 && (
        <SortableContext items={orderedCars.map(c => c.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {orderedCars.map((car, idx) => {
            const dealPrice = carCalcMap[car.id]?.dealNetPrice ?? car.sellingPrice;
            const profit = carCalcMap[car.id]?.profit;
            const staggerCls = `stagger-enter stagger-${Math.min(idx + 1, 12)}`;
            return (
              <SortableCarItem key={car.id} id={car.id} dragEnabled={canDragCars}>
              <div
                onClick={() => navigate(`/history/${car.id}`)}
                className={`relative bg-obsidian-900 rounded-xl overflow-hidden cursor-pointer aspect-[4/3] shadow-card border border-obsidian-400/50 hover:border-gold-500/30 transition-colors duration-300 group card-lift card-streak ${staggerCls}`}
              >
                {/* Full-bleed photo */}
                <div className="absolute inset-0">
                  {car.photo
                    ? <img
                        src={thumbUrl(car.photo, 640, 72)!}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    : <div className="w-full h-full flex items-center justify-center bg-obsidian-800">
                        <CarIcon size={40} className="text-gray-700" />
                      </div>
                  }
                </div>

                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />

                {/* SOLD stamp */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="border-[3px] border-red-500/60 rounded-lg px-4 py-1 rotate-[-20deg] bg-black/20">
                    <span className="text-red-500/80 font-display font-bold text-2xl tracking-widest">SOLD</span>
                  </div>
                </div>

                {/* Top badges */}
                <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/80 text-white">
                    {car.finalDeal?.bank ? car.finalDeal.bank : 'Delivered'}
                  </span>
                  {car.carPlate && (
                    <span className="text-[10px] font-mono text-gold-300 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded border border-gold-500/20">
                      {car.carPlate}
                    </span>
                  )}
                </div>

                {/* Bottom info overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <p className="text-white font-semibold text-sm leading-tight line-clamp-1">
                    {car.year} {car.make} {car.model}
                  </p>
                  {car.variant && <p className="text-gray-400 text-[11px] mt-0.5 line-clamp-1">{car.variant}</p>}
                  <p className="text-gray-500 text-[10px] mt-0.5">{car.colour} · {car.transmission} · {formatMileage(car.mileage)}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <p
                      className="text-gold-400 font-bold text-base"
                      style={{ animation: 'priceIn 0.5s ease forwards', opacity: 0 }}
                    >
                      {formatRM(dealPrice)}
                    </p>
                    {isDirectorView && profit !== undefined && (
                      <p className={`text-xs font-semibold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {profit >= 0 ? '+' : ''}{formatRM(profit)}
                      </p>
                    )}
                  </div>
                  <p className="text-gray-600 text-[10px] mt-0.5 truncate">{getSalesperson(getDealSalespersonId(car))}</p>

                  {/* Money received button — all delivered cars */}
                  {isDirectorView && (() => {
                    const { icon: Icon, text, state } = getMoneyStatusDisplay(car);
                    return (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleMoneyStatusClick(car); }}
                        className={`mt-1.5 w-full flex items-center justify-center gap-1.5 py-1 rounded-lg border text-[10px] font-bold transition-colors ${
                          state === 'received'
                            ? 'bg-green-500/15 border-green-500/40 text-green-400 cursor-default'
                            : state === 'processing'
                            ? 'bg-sky-500/15 border-sky-500/40 text-sky-400 hover:border-green-500/40 hover:text-green-400'
                            : 'bg-black/30 border-amber-500/30 text-amber-400 hover:border-green-500/40 hover:text-green-400'
                        }`}
                      >
                        <Icon size={9} /> {text}
                      </button>
                    );
                  })()}

                  {isDirectorView && (() => {
                    const { complete, openItems } = getCaseCompletion({ car, customers, payments });
                    return (
                      <div
                        className={`mt-1 flex items-center gap-1 text-[9px] font-semibold ${complete ? 'text-emerald-500' : 'text-amber-500'}`}
                        title={complete ? 'Case complete' : openItems.join(', ')}
                      >
                        {complete ? <CheckCircle size={8} /> : <Clock size={8} />}
                        {complete ? 'Case Complete' : openItems.join(' · ')}
                      </div>
                    );
                  })()}
                </div>
              </div>
              </SortableCarItem>
            );
          })}
        </div>
        </SortableContext>
      )}

      {/* ── List view ── */}
      {!initialLoad && view === 'list' && soldCars.length > 0 && (
        <div className="space-y-2">
          {soldCars.map((car, idx) => {
            const dealPrice = carCalcMap[car.id]?.dealNetPrice ?? car.sellingPrice;
            const profit = carCalcMap[car.id]?.profit;
            return (
              <div
                key={car.id}
                onClick={() => navigate(`/history/${car.id}`)}
                className={`row-item bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card cursor-pointer hover:border-gold-500/40 hover:bg-obsidian-700/30 transition-all flex items-center gap-4 px-4 py-3 stagger-enter stagger-${Math.min(idx + 1, 12)}`}
              >
                {/* Thumbnail with SOLD badge */}
                <div className="w-24 h-16 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center relative">
                  {car.photo
                    ? <img src={thumbUrl(car.photo, 300, 72)!} alt={`${car.make} ${car.model}`} className="w-full h-full object-cover" loading="lazy" />
                    : <CarIcon size={20} className="text-gray-600" />
                  }
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <span className="text-[9px] font-bold text-red-400 border border-red-500/60 rounded px-1 py-0.5 rotate-[-15deg] tracking-widest">SOLD</span>
                  </div>
                </div>

                {/* Car name + details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold text-sm">
                      {car.year} {car.make} {car.model}{car.variant ? ` ${car.variant}` : ''}
                    </span>
                    {car.carPlate && (
                      <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-[#2C2415] text-gold-300 border border-[#3C321E] tracking-wider">
                        {car.carPlate}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="text-gray-500 text-xs">{car.colour} · {car.transmission} · {formatMileage(car.mileage)}</span>
                    {car.currentLocation && (
                      <span className="flex items-center gap-1 text-gray-500 text-xs">
                        <MapPin size={10} />{car.currentLocation}
                      </span>
                    )}
                  </div>
                </div>

                {/* Deal info */}
                <div className="hidden md:flex flex-col gap-1 min-w-[140px]">
                  <span className="text-xs text-gray-500">{getSalesperson(getDealSalespersonId(car))}</span>
                  {car.finalDeal?.bank && <p className="text-xs text-violet-400">{car.finalDeal.bank}</p>}
                  {isDirectorView && (() => {
                    const { icon: Icon, text, state } = getMoneyStatusDisplay(car);
                    return (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleMoneyStatusClick(car); }}
                        className={`flex items-center gap-1 text-[10px] font-bold transition-colors ${
                          state === 'received'
                            ? 'text-green-400 cursor-default'
                            : state === 'processing'
                            ? 'text-sky-400 hover:text-green-400'
                            : 'text-amber-400 hover:text-green-400'
                        }`}
                      >
                        <Icon size={9} /> {text}
                      </button>
                    );
                  })()}

                  {isDirectorView && (() => {
                    const { complete, openItems } = getCaseCompletion({ car, customers, payments });
                    return (
                      <div
                        className={`flex items-center gap-1 text-[9px] font-semibold ${complete ? 'text-emerald-500' : 'text-amber-500'}`}
                        title={complete ? 'Case complete' : openItems.join(', ')}
                      >
                        {complete ? <CheckCircle size={8} /> : <Clock size={8} />}
                        {complete ? 'Case Complete' : openItems.join(' · ')}
                      </div>
                    );
                  })()}
                </div>

                {/* Badge */}
                <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-500/90 text-white">
                    Delivered
                  </span>
                </div>

                {/* Price + profit */}
                <div className="text-right flex-shrink-0">
                  <p className="text-gold-400 font-bold text-sm">{formatRM(dealPrice)}</p>
                  {isDirectorView && profit !== undefined && (
                    <p className={`text-xs font-medium mt-0.5 ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {profit >= 0 ? '+' : ''}{formatRM(profit)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Disbursement Modal ── */}
      {(() => {
        const expectedNum = Number(disbursalForm.expected || 0);
        const actualNum = Number(disbursalForm.actual || 0);
        const remaining = expectedNum > 0 ? expectedNum - actualNum : 0;
        const chargesTotal = disbursalForm.charges.reduce((s, c) => s + Number(c.amount || 0), 0);
        const allocationDiff = remaining - chargesTotal;
        const isBalanced = expectedNum > 0 ? Math.abs(allocationDiff) < 0.5 : true;
        const canConfirm = !!disbursalForm.actual && isBalanced;

        return (
          <Modal
            isOpen={!!disbursalCarId}
            onClose={() => { setDisbursalCarId(null); setDisbursalDealInfo(null); }}
            title="Record Bank Disbursement"
            maxWidth="max-w-sm"
          >
            <div className="space-y-4">
              <p className="text-gray-400 text-sm">Enter what the deal calls for, what actually landed, and itemize the difference (processing fee, service charge, insurance cover note, etc).</p>

              {disbursalDealInfo && (
                <div className="rounded-lg bg-black/30 border border-obsidian-400/40 p-3 space-y-1 text-xs">
                  <div className="flex justify-between text-gray-400"><span>Selling Price</span><span>RM {disbursalDealInfo.sellingPrice.toLocaleString()}</span></div>
                  {disbursalDealInfo.discount > 0 && (
                    <div className="flex justify-between text-gray-400"><span>Discount</span><span>− RM {disbursalDealInfo.discount.toLocaleString()}</span></div>
                  )}
                  {disbursalDealInfo.insurance > 0 && (
                    <div className="flex justify-between text-gray-400"><span>Insurance</span><span>+ RM {disbursalDealInfo.insurance.toLocaleString()}</span></div>
                  )}
                  {disbursalDealInfo.bankProduct > 0 && (
                    <div className="flex justify-between text-gray-400"><span>Bank Product</span><span>+ RM {disbursalDealInfo.bankProduct.toLocaleString()}</span></div>
                  )}
                  {disbursalDealInfo.additionalTotal > 0 && (
                    <div className="flex justify-between text-gray-400"><span>Additional Items</span><span>+ RM {disbursalDealInfo.additionalTotal.toLocaleString()}</span></div>
                  )}
                  {disbursalDealInfo.bookingFee > 0 && (
                    <div className="flex justify-between text-gray-400"><span>Booking Fee (already collected)</span><span>− RM {disbursalDealInfo.bookingFee.toLocaleString()}</span></div>
                  )}
                  <div className="flex justify-between text-gray-200 font-bold pt-1.5 mt-1 border-t border-obsidian-400/40">
                    <span>{disbursalDealInfo.bank} Approved Loan</span><span>RM {disbursalDealInfo.loanAmount.toLocaleString()}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-gray-300 text-xs font-medium mb-1.5">Total Price (RM)</label>
                <input
                  type="number"
                  className="input w-full"
                  placeholder="e.g. 45000"
                  value={disbursalForm.expected}
                  onChange={e => setDisbursalForm(f => ({ ...f, expected: e.target.value }))}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-gray-300 text-xs font-medium mb-1.5">Amount Disbursed (RM)</label>
                <input
                  type="number"
                  className="input w-full"
                  placeholder="e.g. 44200"
                  value={disbursalForm.actual}
                  onChange={e => setDisbursalForm(f => ({ ...f, actual: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-gray-300 text-xs font-medium mb-1.5">Disbursement Date</label>
                <input
                  type="date"
                  className="input w-full"
                  value={disbursalForm.date}
                  onChange={e => setDisbursalForm(f => ({ ...f, date: e.target.value }))}
                />
              </div>

              {expectedNum > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-black/30 border border-obsidian-400/40">
                    <span className="text-xs text-gray-400">Remaining to itemize</span>
                    <span className={`text-sm font-bold ${isBalanced ? 'text-green-400' : 'text-amber-400'}`}>
                      RM {allocationDiff.toLocaleString()}
                    </span>
                  </div>

                  {disbursalForm.charges.map((charge, i) => (
                    <div key={i} className="space-y-1.5 p-2 rounded-lg bg-black/20 border border-obsidian-400/30">
                      <input
                        type="text"
                        className="input w-full"
                        placeholder="e.g. Processing Fee"
                        value={charge.label}
                        onChange={e => setDisbursalForm(f => ({ ...f, charges: f.charges.map((c, idx) => idx === i ? { ...c, label: e.target.value } : c) }))}
                      />
                      <div className="flex gap-2 items-center">
                        <input
                          type="number"
                          className="input flex-1"
                          placeholder="RM"
                          value={charge.amount}
                          onChange={e => setDisbursalForm(f => ({ ...f, charges: f.charges.map((c, idx) => idx === i ? { ...c, amount: e.target.value } : c) }))}
                        />
                        <button
                          onClick={() => setDisbursalForm(f => ({ ...f, charges: f.charges.filter((_, idx) => idx !== i) }))}
                          className="text-gray-500 hover:text-red-400 text-xs px-2.5 py-2 rounded-lg border border-obsidian-400/40 hover:border-red-400/40"
                        >
                          ✕ Remove
                        </button>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={() => setDisbursalForm(f => ({ ...f, charges: [...f.charges, { label: '', amount: '' }] }))}
                    className="text-xs text-sky-400 hover:text-sky-300 font-medium"
                  >
                    + Add Charge
                  </button>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => { setDisbursalCarId(null); setDisbursalDealInfo(null); }} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
                <button
                  disabled={!canConfirm}
                  onClick={async () => {
                    if (!disbursalCarId) return;
                    const grossAmt = expectedNum || actualNum;
                    const chargeItems = disbursalForm.charges
                      .map(c => ({ label: c.label.trim(), amount: Number(c.amount || 0) }))
                      .filter(c => c.label && c.amount > 0);

                    await updateCar(disbursalCarId, {
                      moneyReceived: true,
                      disbursementStatus: 'disbursed',
                      disbursementAmount: actualNum,
                      disbursementExpectedAmount: grossAmt || undefined,
                      disbursementCharges: chargeItems.length ? chargeItems : undefined,
                      disbursementDate: disbursalForm.date || undefined,
                    });
                    const disbCar = cars.find(c => c.id === disbursalCarId);
                    if (disbCar && grossAmt > 0) {
                      generateLoanDisbursement({ car: disbCar, disbursementAmount: grossAmt, payments, addPayment, updatePayment });
                      // Clears the receivable booked at sale — skip dealer-consignment
                      // cars, which never went through that sale entry in the first place.
                      if (!disbCar.consignment && !disbCar.outgoingConsignment && currentUser) {
                        const resolvedCharges = [];
                        for (const c of chargeItems) {
                          resolvedCharges.push({ accountId: await getOrCreateChargeAccount(c.label), amount: c.amount });
                        }
                        await addJournalEntry(buildDisbursementReceivedEntry({
                          car: disbCar,
                          amount: grossAmt,
                          netAmount: actualNum,
                          charges: resolvedCharges,
                          createdBy: currentUser.id,
                        }));
                      }
                    }
                    setDisbursalCarId(null);
                    setDisbursalDealInfo(null);
                  }}
                  className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
    <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
      {dragActiveId && (() => { const c = cars.find(x => x.id === dragActiveId); return c ? <DragGhostCard car={c} /> : null; })()}
    </DragOverlay>
  </DndContext>
  );
}
