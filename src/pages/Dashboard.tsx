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
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Inventory"
          value={cars.length}
          subtitle={`${availableCars.length} available`}
          icon={Car}
          borderColor="border-l-cyan-400"
          iconColor="text-cyan-400"
        />
        <StatCard
          title="Total Revenue"
          value={formatRM(totalRevenue)}
          subtitle={`${soldCars.length} cars sold`}
          icon={DollarSign}
          borderColor="border-l-green-400"
          iconColor="text-green-400"
        />
        <StatCard
          title="Net Profit"
          value={formatRM(netProfit)}
          subtitle="After repairs & commission"
          icon={TrendingUp}
          borderColor="border-l-purple-400"
          iconColor="text-purple-400"
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

      {/* Two column section */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* P&L Summary */}
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl">
          <div className="p-5 border-b border-[#1a2a4a]">
            <h3 className="text-white font-semibold">P&L Summary</h3>
            <p className="text-gray-500 text-xs mt-0.5">Based on sold vehicles</p>
          </div>
          <div className="p-5 space-y-3">
            <PLRow label="Total Revenue (Sales)" value={totalRevenue} positive />
            <PLRow label="Total Purchase Costs" value={-totalCosts} />
            <PLRow label="Repair & Refurbishment" value={-soldRepairs} />
            <PLRow label="Commission Paid" value={-commission} subtitle={`${soldCars.length} × RM 500`} />
            <div className="border-t border-[#1a2a4a] pt-3 mt-3">
              <div className="flex justify-between items-center">
                <span className="text-white font-semibold">Net Profit</span>
                <span className={`text-lg font-bold ${netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatRM(netProfit)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Inventory breakdown */}
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl">
          <div className="flex items-center justify-between p-5 border-b border-[#1a2a4a]">
            <h3 className="text-white font-semibold">Inventory Status</h3>
            <button
              onClick={() => navigate('/inventory')}
              className="text-cyan-400 text-sm flex items-center gap-1 hover:text-cyan-300 transition-colors"
            >
              View all <ArrowRight size={14} />
            </button>
          </div>
          <div className="p-5 space-y-3">
            {(['available', 'reserved', 'sold'] as const).map((status) => {
              const count = cars.filter((c) => c.status === status).length;
              const pct = cars.length > 0 ? (count / cars.length) * 100 : 0;
              const color = status === 'available' ? 'bg-green-500' : status === 'reserved' ? 'bg-yellow-500' : 'bg-gray-500';
              const textColor = status === 'available' ? 'text-green-400' : status === 'reserved' ? 'text-yellow-400' : 'text-gray-400';
              return (
                <div key={status} className="flex items-center gap-3">
                  <span className={`text-xs w-20 capitalize ${textColor}`}>{status}</span>
                  <div className="flex-1 bg-[#111d35] rounded-full h-2">
                    <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-gray-400 text-xs w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Workshop overview */}
      <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Workshop Overview</h3>
          <button
            onClick={() => navigate('/workshop')}
            className="text-cyan-400 text-sm flex items-center gap-1 hover:text-cyan-300 transition-colors"
          >
            View all <ArrowRight size={14} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-[#111d35] rounded-lg p-4 border border-[#1a2a4a]">
            <Wrench size={16} className="text-orange-400 mb-2" />
            <p className="text-gray-400 text-xs">Total Repair Spend</p>
            <p className="text-white text-xl font-bold mt-0.5">{formatRM(totalRepairCosts)}</p>
          </div>
          <div className="bg-[#111d35] rounded-lg p-4 border border-[#1a2a4a]">
            <Wrench size={16} className="text-yellow-400 mb-2" />
            <p className="text-gray-400 text-xs">Active Jobs</p>
            <p className="text-white text-xl font-bold mt-0.5">
              {repairs.filter((r) => r.status !== 'done').length}
            </p>
          </div>
          <div className="bg-[#111d35] rounded-lg p-4 border border-[#1a2a4a]">
            <Wrench size={16} className="text-green-400 mb-2" />
            <p className="text-gray-400 text-xs">Completed Jobs</p>
            <p className="text-white text-xl font-bold mt-0.5">
              {repairs.filter((r) => r.status === 'done').length}
            </p>
          </div>
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
    <div className="flex justify-between items-center py-2 border-b border-[#1a2a4a]/50">
      <div>
        <span className="text-gray-300 text-sm">{label}</span>
        {subtitle && <p className="text-gray-600 text-xs">{subtitle}</p>}
      </div>
      <span className={`text-sm font-semibold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
        {value < 0 ? `-${formatRM(Math.abs(value))}` : formatRM(value)}
      </span>
    </div>
  );
}
