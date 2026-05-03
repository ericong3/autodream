import { useState, useMemo, useEffect } from 'react';
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
} from 'lucide-react';
import { useStore } from '../store';
import { formatRM, formatMileage, shortName } from '../utils/format';
import StatCard from '../components/StatCard';
import { CarDetailContent } from './CarDetail';
import { SkeletonCard, SkeletonRow } from '../components/Skeleton';

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
  const viewPreference = useStore((s) => s.viewPreference);
  const setViewPreference = useStore((s) => s.setViewPreference);

  const { id: selectedCarId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const isDirector = currentUser?.role === 'director';
  const viewKey = `${currentUser?.id}-history`;
  const view = viewPreference[viewKey] ?? 'grid';

  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState<string>(new Date().toISOString().slice(0, 7));
  const [initialLoad, setInitialLoad] = useState(true);

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

  const soldCars = useMemo(() => {
    let result = cars.filter((c) => c.status === 'delivered');
    if (monthFilter) result = result.filter((c) => (c.finalDeal?.submittedAt ?? c.dateAdded).startsWith(monthFilter));
    if (filterMake !== 'All') result = result.filter((c) => c.make === filterMake);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.make.toLowerCase().includes(q) ||
          c.model.toLowerCase().includes(q) ||
          c.colour.toLowerCase().includes(q) ||
          String(c.year).includes(q) ||
          (c.carPlate ?? '').toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => new Date(b.finalDeal?.submittedAt ?? b.dateAdded).getTime() - new Date(a.finalDeal?.submittedAt ?? a.dateAdded).getTime());
  }, [cars, search, monthFilter, filterMake]);

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
      const commission = c.outgoingConsignment ? 0 : c.priceFloor != null
        ? (dealNetPrice >= c.priceFloor ? (profitBeforeCommission >= 10000 ? 2000 : 1500) : 1000)
        : (profitBeforeCommission >= 10000 ? 1500 : 1000);
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

  // Determine payment type for a delivered car
  const getPaymentType = (car: typeof cars[0]): { type: 'loan' | 'cash' | 'consignment'; label: string } => {
    if (car.outgoingConsignment) return { type: 'consignment', label: 'Dealer Payment' };
    const customer = customers.find(c => c.interestedCarId === car.id);
    if (customer?.loanWorkOrder) return { type: 'loan', label: `${customer.loanWorkOrder.bank} Disbursement` };
    if (car.finalDeal?.bank && car.finalDeal.bank.toLowerCase() !== 'cash') return { type: 'loan', label: `${car.finalDeal.bank} Disbursement` };
    return { type: 'cash', label: 'Cash Payment' };
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

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Units Delivered" value={soldCars.length} icon={CheckCircle} borderColor="border-l-green-400" iconColor="text-green-400" />
        <StatCard title="Total Revenue" value={formatRM(totalRevenue)} icon={DollarSign} borderColor="border-l-gold-400" iconColor="text-gold-400" />
        <StatCard title="Total Profit" value={formatRM(totalProfit)} icon={TrendingUp} borderColor="border-l-yellow-400" iconColor="text-yellow-400" />
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
            <button onClick={() => shiftMonth(-1)} className="px-2.5 py-2.5 text-gray-400 hover:text-white hover:bg-obsidian-500/60 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 text-sm text-white font-medium whitespace-nowrap">{monthLabel}</span>
            <button onClick={() => shiftMonth(1)} className="px-2.5 py-2.5 text-gray-400 hover:text-white hover:bg-obsidian-500/60 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {soldCars.map((car, idx) => {
            const dealPrice = carCalcMap[car.id]?.dealNetPrice ?? car.sellingPrice;
            const profit = carCalcMap[car.id]?.profit;
            const staggerCls = `stagger-enter stagger-${Math.min(idx + 1, 12)}`;
            return (
              <div
                key={car.id}
                onClick={() => navigate(`/history/${car.id}`)}
                className={`relative bg-obsidian-900 rounded-xl overflow-hidden cursor-pointer aspect-[4/3] shadow-card hover:shadow-xl hover:shadow-gold-500/10 border border-obsidian-400/50 hover:border-gold-500/30 transition-all duration-300 group card-lift card-streak ${staggerCls}`}
              >
                {/* Full-bleed photo */}
                <div className="absolute inset-0">
                  {car.photo
                    ? <img
                        src={car.photo}
                        alt=""
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
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
                    {isDirector && profit !== undefined && (
                      <p className={`text-xs font-semibold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {profit >= 0 ? '+' : ''}{formatRM(profit)}
                      </p>
                    )}
                  </div>
                  <p className="text-gray-600 text-[10px] mt-0.5 truncate">{getSalesperson(getDealSalespersonId(car))}</p>

                  {/* Money received button — all delivered cars */}
                  {isDirector && (() => {
                    const { type, label } = getPaymentType(car);
                    const Icon = type === 'loan' ? Building2 : type === 'consignment' ? HeartHandshake : Banknote;
                    return (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!car.moneyReceived) updateCar(car.id, { moneyReceived: true });
                        }}
                        className={`mt-1.5 w-full flex items-center justify-center gap-1.5 py-1 rounded-lg border text-[10px] font-bold transition-colors ${
                          car.moneyReceived
                            ? 'bg-green-500/15 border-green-500/40 text-green-400 cursor-default'
                            : 'bg-black/30 border-amber-500/30 text-amber-400 hover:border-green-500/40 hover:text-green-400'
                        }`}
                      >
                        {car.moneyReceived
                          ? <><CheckCircle size={9} /> Received</>
                          : <><Icon size={9} /> {label}</>
                        }
                      </button>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
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
                    ? <img src={car.photo} alt={`${car.make} ${car.model}`} className="w-full h-full object-cover" loading="lazy" />
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
                  {isDirector && (() => {
                    const { type, label } = getPaymentType(car);
                    const Icon = type === 'loan' ? Building2 : type === 'consignment' ? HeartHandshake : Banknote;
                    return (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!car.moneyReceived) updateCar(car.id, { moneyReceived: true });
                        }}
                        className={`flex items-center gap-1 text-[10px] font-bold transition-colors ${
                          car.moneyReceived
                            ? 'text-green-400 cursor-default'
                            : 'text-amber-400 hover:text-green-400'
                        }`}
                      >
                        {car.moneyReceived
                          ? <><CheckCircle size={9} /> Received</>
                          : <><Icon size={9} /> {label}</>
                        }
                      </button>
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
                  {isDirector && profit !== undefined && (
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
    </div>
  );
}
