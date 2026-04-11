import { useNavigate } from 'react-router-dom';
import {
  Car,
  TrendingUp,
  DollarSign,
  Wrench,
  ArrowRight,
} from 'lucide-react';
import { useStore } from '../store';
import StatCard from '../components/StatCard';
import { formatRM } from '../utils/format';

export default function Dashboard() {
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const navigate = useNavigate();

  const soldCars = cars.filter((c) => c.status === 'sold');
  const availableCars = cars.filter((c) => c.status === 'available');
  const totalRepairCosts = repairs.reduce((sum, r) => sum + r.totalCost, 0);
  const commission = soldCars.length * 500;

  const getRepairCostsForCar = (carId: string) =>
    repairs.filter((r) => r.carId === carId).reduce((sum, r) => sum + r.totalCost, 0);

  const totalRevenue = soldCars.reduce((s, c) => s + c.sellingPrice, 0);
  const totalCosts = soldCars.reduce((s, c) => s + c.purchasePrice, 0);
  const soldRepairs = soldCars.reduce((s, c) => s + getRepairCostsForCar(c.id), 0);
  const netProfit = totalRevenue - totalCosts - soldRepairs - commission;

  return (
    <div className="space-y-6">

      {/* ── Stat Cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Inventory"
          value={cars.length}
          subtitle={`${availableCars.length} available`}
          icon={Car}
          borderColor="border-l-gold-400"
          iconColor="text-gold-300"
        />
        <StatCard
          title="Total Revenue"
          value={formatRM(totalRevenue)}
          subtitle={`${soldCars.length} cars sold`}
          icon={DollarSign}
          borderColor="border-l-emerald-400"
          iconColor="text-emerald-400"
        />
        <StatCard
          title="Net Profit"
          value={formatRM(netProfit)}
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

      {/* ── Two column section ───────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* P&L Summary */}
        <div className="card-surface rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-obsidian-400/60
            bg-gradient-to-r from-obsidian-600/40 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 rounded-full bg-gold-gradient" />
              <h3 className="text-white font-semibold text-sm">P&L Summary</h3>
            </div>
            <p className="text-white/40 text-xs mt-0.5 ml-3">Based on sold vehicles</p>
          </div>
          <div className="p-5 space-y-1">
            <PLRow label="Total Revenue (Sales)" value={totalRevenue} positive />
            <PLRow label="Total Purchase Costs" value={-totalCosts} />
            <PLRow label="Repair & Refurbishment" value={-soldRepairs} />
            <PLRow label="Commission Paid" value={-commission} subtitle={`${soldCars.length} × RM 500`} />
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
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 rounded-full bg-gold-gradient" />
              <h3 className="text-white font-semibold text-sm">Inventory Status</h3>
            </div>
            <button
              onClick={() => navigate('/inventory')}
              className="text-gold-400 text-xs flex items-center gap-1 hover:text-gold-300 transition-colors font-medium"
            >
              View all <ArrowRight size={13} />
            </button>
          </div>
          <div className="p-5 space-y-4">
            {(['available', 'reserved', 'sold'] as const).map((status) => {
              const count = cars.filter((c) => c.status === status).length;
              const pct = cars.length > 0 ? (count / cars.length) * 100 : 0;
              const bar = status === 'available'
                ? 'from-emerald-500 to-emerald-400'
                : status === 'reserved'
                  ? 'from-yellow-500 to-yellow-400'
                  : 'from-obsidian-400 to-obsidian-300';
              const text = status === 'available'
                ? 'text-emerald-400'
                : status === 'reserved'
                  ? 'text-yellow-400'
                  : 'text-white/40';
              return (
                <div key={status}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${text}`}>{status}</span>
                    <span className="text-white text-sm font-bold">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-obsidian-700 overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${bar} transition-all duration-500`}
                      style={{ width: `${pct}%` }}
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
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 rounded-full bg-gold-gradient" />
            <h3 className="text-white font-semibold text-sm">Workshop Overview</h3>
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
            { label: 'Total Repair Spend', value: formatRM(totalRepairCosts), color: 'text-orange-400', icon: '🔧' },
            { label: 'Active Jobs', value: repairs.filter(r => r.status !== 'done').length, color: 'text-yellow-400', icon: '⚙️' },
            { label: 'Completed Jobs', value: repairs.filter(r => r.status === 'done').length, color: 'text-emerald-400', icon: '✓' },
          ].map(item => (
            <div key={item.label}
              className="bg-obsidian-700/60 rounded-xl p-4 border border-obsidian-400/50
                hover:border-obsidian-300/60 transition-colors">
              <p className="text-white/50 text-[11px] uppercase tracking-wider font-medium mb-2">{item.label}</p>
              <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
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
