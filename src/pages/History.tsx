import { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { useStore } from '../store';
import { formatRM, formatMileage, shortName } from '../utils/format';
import StatCard from '../components/StatCard';
import { CarDetailContent } from './CarDetail';

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
  const viewPreference = useStore((s) => s.viewPreference);
  const setViewPreference = useStore((s) => s.setViewPreference);

  const isDirector = currentUser?.role === 'director';
  const viewKey = `${currentUser?.id}-history`;
  const view = viewPreference[viewKey] ?? 'grid';

  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState<string>(new Date().toISOString().slice(0, 7));

  const shiftMonth = (dir: -1 | 1) => {
    const [y, m] = monthFilter.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setMonthFilter(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const [filterMake, setFilterMake] = useState('All');
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null);

  const soldCars = useMemo(() => {
    let result = cars.filter((c) => c.status === 'delivered');
    if (monthFilter) result = result.filter((c) => c.dateAdded.startsWith(monthFilter));
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
    return result.sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
  }, [cars, search, monthFilter, filterMake]);

  const carCalcMap = useMemo(() => {
    const map: Record<string, { sellingPrice: number; profit: number }> = {};
    for (const c of cars.filter(x => x.status === 'delivered')) {
      const wo = customers.find(cu => cu.interestedCarId === c.id && (cu.cashWorkOrder || cu.loanWorkOrder));
      const w = wo?.loanWorkOrder ?? wo?.cashWorkOrder;
      const sellingPrice = (w?.sellingPrice && w.sellingPrice > 0) ? w.sellingPrice : c.sellingPrice;
      const discount = w?.discount ?? 0;
      const additionalTotal = w?.additionalItems?.reduce((a, i) => a + i.amount, 0) ?? 0;
      const repairCosts = repairs.filter(r => r.carId === c.id && r.status === 'done').reduce((a, r) => a + (r.actualCost ?? r.totalCost), 0);
      const dealNetPrice = sellingPrice - discount;
      const profitBeforeCommission = dealNetPrice - c.purchasePrice - repairCosts - additionalTotal;
      const commission = c.priceFloor != null
        ? (dealNetPrice >= c.priceFloor ? (profitBeforeCommission >= 10000 ? 2000 : 1500) : 1000)
        : (profitBeforeCommission >= 10000 ? 1500 : 1000);
      map[c.id] = { sellingPrice, profit: profitBeforeCommission - commission };
    }
    return map;
  }, [cars, customers, repairs]);

  const totalRevenue = soldCars.reduce((s, c) => s + (carCalcMap[c.id]?.sellingPrice ?? c.sellingPrice), 0);
  const totalProfit = soldCars.reduce((s, c) => s + (carCalcMap[c.id]?.profit ?? 0), 0);

  const getSalesperson = (id?: string) => {
    const name = id ? users.find((u) => u.id === id)?.name : undefined;
    return name ? shortName(name) : 'Unassigned';
  };

  const monthLabel = monthFilter
    ? new Date(monthFilter + '-01').toLocaleString('en-MY', { month: 'long', year: 'numeric' })
    : '';

  if (selectedCarId) {
    return (
      <CarDetailContent
        id={selectedCarId}
        onBack={() => setSelectedCarId(null)}
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

      {/* Top bar */}
      <div className="flex flex-wrap gap-3">
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

        <div className="flex items-center border border-obsidian-400/60 rounded-lg overflow-hidden" style={{ background: '#0E0D0B' }}>
          <button onClick={() => shiftMonth(-1)} className="px-2.5 py-2.5 text-gray-400 hover:text-white hover:bg-obsidian-500/60 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="px-3 text-sm text-white font-medium whitespace-nowrap">{monthLabel}</span>
          <button onClick={() => shiftMonth(1)} className="px-2.5 py-2.5 text-gray-400 hover:text-white hover:bg-obsidian-500/60 transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>

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

      {/* Count */}
      <p className="text-gray-500 text-sm">
        <span className="text-white font-medium">{soldCars.length}</span> delivered unit{soldCars.length !== 1 ? 's' : ''}
        {monthLabel && <span className="ml-1">in {monthLabel}</span>}
      </p>

      {/* Empty */}
      {soldCars.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CarIcon size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400 font-medium">No delivered units{monthFilter ? ` for this month` : ''}</p>
          <p className="text-gray-600 text-sm mt-1">Try adjusting your filters</p>
        </div>
      )}

      {/* ── Grid view ── */}
      {view === 'grid' && soldCars.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {soldCars.map((car) => {
            const dealPrice = carCalcMap[car.id]?.sellingPrice ?? car.sellingPrice;
            const profit = carCalcMap[car.id]?.profit;
            return (
              <div
                key={car.id}
                onClick={() => setSelectedCarId(car.id)}
                className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card overflow-hidden cursor-pointer hover:border-gold-500/40 hover:shadow-xl hover:shadow-gold-500/10 transition-all group"
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
                  <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-500/90 text-white">
                    Sold · Delivered
                  </span>
                </div>

                {/* Info */}
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <h3 className="text-white font-semibold text-sm group-hover:text-gold-400 transition-colors">
                        {car.year} {car.make} {car.model}
                      </h3>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {car.variant ? `${car.variant} · ` : ''}{car.colour} · {car.transmission}
                      </p>
                    </div>
                    {car.carPlate && (
                      <span className="ml-2 shrink-0 text-xs font-mono font-semibold px-2 py-0.5 rounded bg-[#2C2415] text-gold-300 border border-[#3C321E] tracking-wider">
                        {car.carPlate}
                      </span>
                    )}
                  </div>
                  {car.currentLocation && (
                    <div className="flex items-center gap-1 mt-1">
                      <MapPin size={11} className="text-gray-500 flex-shrink-0" />
                      <span className="text-gray-400 text-xs truncate">{car.currentLocation}</span>
                    </div>
                  )}

                  <p className="text-gray-400 text-xs mt-2">{formatMileage(car.mileage)}</p>

                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <p className="text-gold-400 text-lg font-bold">{formatRM(dealPrice)}</p>
                      {isDirector && profit !== undefined && (
                        <p className={`text-xs font-medium mt-0.5 ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          Profit: {formatRM(profit)}
                        </p>
                      )}
                    </div>
                  </div>

                  <p className="text-gray-600 text-xs mt-1 truncate">{getSalesperson(car.assignedSalesperson)}</p>

                  {/* Deal strip */}
                  {car.finalDeal && (
                    <div className="mt-2 pt-2 border-t border-obsidian-400/30">
                      <p className="text-[10px] text-violet-400 font-medium truncate">
                        {car.finalDeal.bank} · {formatRM(car.finalDeal.dealPrice)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── List view ── */}
      {view === 'list' && soldCars.length > 0 && (
        <div className="space-y-2">
          {soldCars.map((car) => {
            const dealPrice = carCalcMap[car.id]?.sellingPrice ?? car.sellingPrice;
            const profit = carCalcMap[car.id]?.profit;
            return (
              <div
                key={car.id}
                onClick={() => setSelectedCarId(car.id)}
                className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card cursor-pointer hover:border-gold-500/40 hover:bg-obsidian-700/30 transition-all flex items-center gap-4 px-4 py-3"
              >
                {/* Thumbnail */}
                <div className="w-24 h-16 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {car.photo
                    ? <img src={car.photo} alt={`${car.make} ${car.model}`} className="w-full h-full object-cover" loading="lazy" />
                    : <CarIcon size={20} className="text-gray-600" />
                  }
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
                <div className="hidden md:flex flex-col gap-0.5 min-w-[120px]">
                  <span className="text-xs text-gray-500">{getSalesperson(car.assignedSalesperson)}</span>
                  {car.finalDeal?.bank && <p className="text-xs text-violet-400">{car.finalDeal.bank}</p>}
                </div>

                {/* Badge */}
                <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-500/90 text-white">
                    Sold · Delivered
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
