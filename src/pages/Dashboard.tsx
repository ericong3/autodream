import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Car,
  TrendingUp,
  DollarSign,
  Wrench,
  Settings,
  CheckCircle2,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react';
import { useStore } from '../store';
import StatCard from '../components/StatCard';
import Sparkline from '../components/Sparkline';
import { formatRM } from '../utils/format';
import { useAnimatedCounter } from '../hooks/useAnimatedCounter';
import { useAnimatedRM } from '../hooks/useAnimatedRM';

export default function Dashboard() {
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const customers = useStore((s) => s.customers);
  const navigate = useNavigate();

  // 15-day stock alert: cars with no leads for 15+ days
  const staleStock = useMemo(() => {
    const threshold = Date.now() - 15 * 86400000;
    return cars.filter(c => {
      if (['sold', 'delivered', 'coming_soon'].includes(c.status)) return false;
      const addedDate = new Date(c.dateAdded).getTime();
      if (addedDate > threshold) return false;
      const hasLead = customers.some(cust => cust.interestedCarId === c.id);
      return !hasLead;
    });
  }, [cars, customers]);

  const soldCars = cars.filter((c) => c.status === 'delivered');
  const availableCars = cars.filter((c) => c.status === 'available');

  // Total repair spend across all jobs (for workshop card)
  const totalRepairCosts = repairs
    .filter((r) => r.status === 'done')
    .reduce((sum, r) => sum + (r.actualCost ?? r.totalCost), 0);

  // Per-car P&L using the same formula as Commission and InvestorPortal
  const soldCarData = useMemo(() => soldCars.map((car) => {
    const repairCost = repairs
      .filter((r) => r.carId === car.id && r.status === 'done')
      .reduce((s, r) => s + (r.actualCost ?? r.totalCost), 0);
    const miscCost = (car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0);

    const customer = customers.find(
      (c) => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder)
    );
    const wo = customer?.loanWorkOrder ?? customer?.cashWorkOrder;
    const dealPrice = wo
      ? wo.sellingPrice - (wo.discount ?? 0)
      : car.finalDeal?.dealPrice ?? car.sellingPrice;
    const additionalTotal = wo?.additionalItems?.reduce((s, i) => s + i.amount, 0) ?? 0;

    const profitBeforeComm = dealPrice - car.purchasePrice - repairCost - miscCost - additionalTotal;
    const commission = car.outgoingConsignment ? 0 : car.priceFloor != null
      ? (dealPrice >= car.priceFloor
          ? (profitBeforeComm >= 10000 ? 2000 : 1500)
          : 1000)
      : (profitBeforeComm >= 10000 ? 1500 : 1000);

    const netCarProfit = profitBeforeComm - commission;
    return { car, dealPrice, repairCost, miscCost, additionalTotal, commission, netCarProfit };
  }), [soldCars, repairs, customers]);

  const totalRevenue   = soldCarData.reduce((s, d) => s + d.dealPrice, 0);
  const totalCosts     = soldCarData.reduce((s, d) => s + d.car.purchasePrice, 0);
  const soldRepairs    = soldCarData.reduce((s, d) => s + d.repairCost, 0);
  const soldMisc       = soldCarData.reduce((s, d) => s + d.miscCost + d.additionalTotal, 0);
  const totalCommission = soldCarData.reduce((s, d) => s + d.commission, 0);
  const netProfit      = soldCarData.reduce((s, d) => s + d.netCarProfit, 0);

  // Animated stat card values
  const animatedInventory  = useAnimatedCounter(cars.length, 800, 0);
  const animatedSold       = useAnimatedCounter(soldCars.length, 800, 100);
  const animatedRevenue    = useAnimatedRM(totalRevenue, 1400, 200);
  const animatedNetProfit  = useAnimatedRM(netProfit, 1400, 300);

  // Last-7-days sold count for sparkline
  const last7DaysSales = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });
    return days.map(day =>
      soldCars.filter(c => (c.finalDeal?.submittedAt ?? c.dateAdded).startsWith(day)).length
    );
  }, [soldCars]);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">

      {/* ── Page Header ─────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-widest font-medium">{dateStr}</p>
          <h1 className="font-display text-white font-bold text-2xl mt-0.5">{greeting} 👋</h1>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-600">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
          Live
        </div>
      </div>

      {/* ── Stat Cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Inventory"
          value={animatedInventory}
          subtitle={`${availableCars.length} available`}
          icon={Car}
          borderColor="border-l-gold-400"
          iconColor="text-gold-300"
        />
        <StatCard
          title="Total Revenue"
          value={animatedRevenue}
          subtitle={`${animatedSold} cars sold`}
          icon={DollarSign}
          borderColor="border-l-emerald-400"
          iconColor="text-emerald-400"
        />
        <StatCard
          title="Net Profit"
          value={animatedNetProfit}
          subtitle="After repairs & commission"
          icon={TrendingUp}
          borderColor="border-l-violet-400"
          iconColor="text-violet-400"
          trendUp={netProfit > 0}
        />
        <StatCard
          title="Total Repair Spend"
          value={formatRM(totalRepairCosts)}
          subtitle={`${repairs.filter((r) => r.status !== 'done').length} active jobs`}
          icon={Wrench}
          borderColor="border-l-orange-400"
          iconColor="text-orange-400"
        />
      </div>

      {/* ── 7-day Sales Trend ───────────────────────────────────── */}
      <div className="glass-panel rounded-xl px-5 py-3 flex items-center gap-4 border border-gold-500/10">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">7-day sales trend</p>
          <p className="text-white text-lg font-bold leading-tight mt-0.5">
            {last7DaysSales.reduce((a, b) => a + b, 0)} sold
          </p>
        </div>
        <div className="flex-1 flex justify-end">
          <Sparkline data={last7DaysSales} width={120} height={36} />
        </div>
      </div>

      {/* ── 15-day stock alert ─────────────────────────────────── */}
      {staleStock.length > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-orange-400" />
            <p className="text-orange-400 font-semibold text-sm">{staleStock.length} car{staleStock.length > 1 ? 's' : ''} with no leads for 15+ days</p>
          </div>
          <div className="space-y-1.5">
            {staleStock.map(c => {
              const days = Math.floor((Date.now() - new Date(c.dateAdded).getTime()) / 86400000);
              return (
                <div key={c.id} className="flex items-center justify-between">
                  <span className="text-white text-sm">{c.year} {c.make} {c.model}{c.variant ? ` ${c.variant}` : ''}</span>
                  <span className="text-orange-400 text-xs">{days} days in stock</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Two column section ───────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* P&L Summary */}
        <div className="card-surface rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-obsidian-400/60
            bg-gradient-to-r from-obsidian-600/40 to-transparent">
            <div className="flex items-center gap-2.5">
              <div className="w-[3px] h-5 rounded-full bg-gold-gradient" />
              <h3 className="text-white font-semibold text-base">P&L Summary</h3>
            </div>
            <p className="text-white/40 text-xs mt-0.5 ml-[19px]">Based on sold vehicles</p>
          </div>
          <div className="p-5 space-y-1">
            <PLRow label="Total Revenue (Sales)" value={totalRevenue} positive />
            <PLRow label="Total Purchase Costs" value={-totalCosts} />
            <PLRow label="Repair & Refurbishment" value={-soldRepairs} />
            <PLRow label="Misc & Additional Items" value={-soldMisc} />
            <PLRow label="Commission Paid" value={-totalCommission} subtitle={`${soldCars.length} car${soldCars.length !== 1 ? 's' : ''}`} />
            <div className="divider-gold my-3" />
            <div className="flex justify-between items-center pt-1">
              <span className="text-white font-bold text-sm">Net Profit</span>
              <span className={`text-xl font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatRM(netProfit)}
              </span>
            </div>
          </div>
        </div>

        {/* Inventory Status */}
        <div className="card-surface rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-obsidian-400/60
            bg-gradient-to-r from-obsidian-600/40 to-transparent">
            <div className="flex items-center gap-2.5">
              <div className="w-[3px] h-5 rounded-full bg-gold-gradient" />
              <h3 className="text-white font-semibold text-base">Inventory Status</h3>
            </div>
            <button
              onClick={() => navigate('/inventory')}
              className="text-gold-400 text-xs flex items-center gap-1 hover:text-gold-300 transition-colors font-medium"
            >
              View all <ArrowRight size={13} />
            </button>
          </div>
          <div className="p-5 space-y-4">
            {(['available', 'reserved', 'delivered'] as const).map((status) => {
              const count = cars.filter((c) => c.status === status).length;
              const pct = cars.length > 0 ? (count / cars.length) * 100 : 0;
              const bar = status === 'available'
                ? 'from-emerald-700 to-emerald-400'
                : status === 'reserved'
                  ? 'from-purple-700 to-purple-400'
                  : 'from-gold-600 to-gold-300';
              const text = status === 'available'
                ? 'text-emerald-400'
                : status === 'reserved'
                  ? 'text-purple-400'
                  : 'text-gold-400';
              return (
                <div key={status}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${text}`}>{status === 'delivered' ? 'Delivered' : status}</span>
                    <span className="text-white text-sm font-bold">{count}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-obsidian-700 overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${bar} bar-animated`}
                      style={{ '--bar-w': `${pct}%` } as React.CSSProperties}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Workshop Overview ─────────────────────────────────── */}
      <div className="card-surface rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-obsidian-400/60
          bg-gradient-to-r from-obsidian-600/40 to-transparent">
          <div className="flex items-center gap-2.5">
            <div className="w-[3px] h-5 rounded-full bg-gold-gradient" />
            <h3 className="text-white font-semibold text-base">Workshop Overview</h3>
          </div>
          <button
            onClick={() => navigate('/workshop')}
            className="text-gold-400 text-xs flex items-center gap-1 hover:text-gold-300 transition-colors font-medium"
          >
            View all <ArrowRight size={13} />
          </button>
        </div>
        <div className="p-5 grid grid-cols-3 gap-4">
          {[
            { label: 'Total Repair Spend', value: formatRM(totalRepairCosts), color: 'text-orange-400', Icon: Wrench },
            { label: 'Active Jobs', value: repairs.filter(r => r.status !== 'done').length, color: 'text-yellow-400', Icon: Settings },
            { label: 'Completed Jobs', value: repairs.filter(r => r.status === 'done').length, color: 'text-emerald-400', Icon: CheckCircle2 },
          ].map(item => (
            <div key={item.label}
              className="bg-obsidian-700/60 rounded-xl p-4 border border-obsidian-400/50
                hover:border-gold-500/30 hover:bg-obsidian-600/60 transition-all duration-200 cursor-default">
              <div className={`inline-flex p-2 rounded-lg bg-obsidian-600/60 ${item.color} mb-3`}>
                <item.Icon size={15} />
              </div>
              <p className="text-white/40 text-[10px] uppercase tracking-widest font-semibold mb-1">{item.label}</p>
              <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PLRow({
  label,
  value,
  subtitle,
  positive,
}: {
  label: string;
  value: number;
  subtitle?: string;
  positive?: boolean;
}) {
  const isPositive = value >= 0 || positive;
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-obsidian-400/30 last:border-0">
      <div>
        <span className="text-white/65 text-sm">{label}</span>
        {subtitle && <p className="text-white/35 text-xs mt-0.5">{subtitle}</p>}
      </div>
      <span className={`text-sm font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
        {value < 0 ? `-${formatRM(Math.abs(value))}` : formatRM(value)}
      </span>
    </div>
  );
}
