import { DollarSign, TrendingUp, Car, Wrench, Award } from 'lucide-react';
import { useStore } from '../store';
import StatCard from '../components/StatCard';
import { formatRM } from '../utils/format';

const COMMISSION_PER_CAR = 500;

export default function Finance() {
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const users = useStore((s) => s.users);

  const soldCars = cars.filter((c) => c.status === 'sold');

  const getRepairCosts = (carId: string) =>
    repairs.filter((r) => r.carId === carId).reduce((sum, r) => sum + r.totalCost, 0);

  const getSalesperson = (id?: string) =>
    id ? users.find((u) => u.id === id) : null;

  // Aggregates
  const totalRevenue = soldCars.reduce((s, c) => s + c.sellingPrice, 0);
  const totalPurchaseCosts = soldCars.reduce((s, c) => s + c.purchasePrice, 0);
  const totalRepairCosts = soldCars.reduce((s, c) => s + getRepairCosts(c.id), 0);
  const totalCommission = soldCars.length * COMMISSION_PER_CAR;
  const netProfit = totalRevenue - totalPurchaseCosts - totalRepairCosts - totalCommission;
  const avgProfitPerCar = soldCars.length > 0 ? netProfit / soldCars.length : 0;

  // Per-car data
  const carData = soldCars.map((car) => {
    const repairCosts = getRepairCosts(car.id);
    const commission = COMMISSION_PER_CAR;
    const profit = car.sellingPrice - car.purchasePrice - repairCosts - commission;
    const sp = getSalesperson(car.assignedSalesperson);
    return { car, repairCosts, commission, profit, sp };
  });

  // Commission per salesperson
  const commissionBySalesperson = users
    .filter((u) => u.role === 'salesperson')
    .map((sp) => {
      const soldCount = soldCars.filter((c) => c.assignedSalesperson === sp.id).length;
      return { sp, soldCount, commission: soldCount * COMMISSION_PER_CAR };
    })
    .filter((x) => x.soldCount > 0);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
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
          subtitle="After all costs"
          icon={TrendingUp}
          borderColor={netProfit >= 0 ? 'border-l-green-400' : 'border-l-red-400'}
          iconColor={netProfit >= 0 ? 'text-green-400' : 'text-red-400'}
          trendUp={netProfit >= 0}
        />
        <StatCard
          title="Avg Profit/Car"
          value={formatRM(avgProfitPerCar)}
          icon={Car}
          borderColor="border-l-cyan-400"
          iconColor="text-cyan-400"
        />
        <StatCard
          title="Total Repair Costs"
          value={formatRM(totalRepairCosts)}
          icon={Wrench}
          borderColor="border-l-orange-400"
          iconColor="text-orange-400"
        />
        <StatCard
          title="Total Commission"
          value={formatRM(totalCommission)}
          subtitle={`${soldCars.length} × RM ${COMMISSION_PER_CAR}`}
          icon={Award}
          borderColor="border-l-purple-400"
          iconColor="text-purple-400"
        />
      </div>

      {/* P&L Summary */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">P&L Summary</h3>
          <div className="space-y-3">
            <PLRow label="Revenue (Sales)" value={totalRevenue} positive />
            <PLRow label="Purchase Costs" value={-totalPurchaseCosts} />
            <PLRow label="Repair & Workshop" value={-totalRepairCosts} />
            <PLRow label="Commission Paid" value={-totalCommission} />
            <div className="border-t border-[#1a2a4a] pt-3">
              <div className="flex justify-between items-center">
                <span className="text-white font-semibold">Net Profit</span>
                <span className={`text-xl font-bold ${netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {netProfit < 0 ? `-${formatRM(Math.abs(netProfit))}` : formatRM(netProfit)}
                </span>
              </div>
              <p className="text-gray-600 text-xs mt-1 text-right">
                Margin: {totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0'}%
              </p>
            </div>
          </div>
        </div>

        {/* Commission by salesperson */}
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Commission by Salesperson</h3>
          {commissionBySalesperson.length === 0 ? (
            <p className="text-gray-500 text-sm">No commissions earned yet</p>
          ) : (
            <div className="space-y-3">
              {commissionBySalesperson.map(({ sp, soldCount, commission }) => (
                <div key={sp.id} className="flex items-center justify-between p-3 bg-[#111d35] rounded-lg border border-[#1a2a4a]">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-cyan-500/20 rounded-full flex items-center justify-center text-cyan-400 font-bold text-sm uppercase">
                      {sp.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">{sp.name}</p>
                      <p className="text-gray-500 text-xs">{soldCount} car{soldCount !== 1 ? 's' : ''} sold</p>
                    </div>
                  </div>
                  <span className="text-purple-400 font-bold">{formatRM(commission)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick stats */}
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Cost Breakdown</h3>
          <div className="space-y-3">
            {[
              { label: 'Purchase Costs', value: totalPurchaseCosts, pct: totalRevenue > 0 ? (totalPurchaseCosts / totalRevenue) * 100 : 0, color: 'bg-blue-500' },
              { label: 'Repair Costs', value: totalRepairCosts, pct: totalRevenue > 0 ? (totalRepairCosts / totalRevenue) * 100 : 0, color: 'bg-orange-500' },
              { label: 'Commission', value: totalCommission, pct: totalRevenue > 0 ? (totalCommission / totalRevenue) * 100 : 0, color: 'bg-purple-500' },
              { label: 'Net Profit', value: Math.max(0, netProfit), pct: totalRevenue > 0 ? (Math.max(0, netProfit) / totalRevenue) * 100 : 0, color: 'bg-green-500' },
            ].map(({ label, value, pct, color }) => (
              <div key={label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">{label}</span>
                  <span className="text-gray-300">{formatRM(value)} ({pct.toFixed(1)}%)</span>
                </div>
                <div className="h-1.5 bg-[#111d35] rounded-full">
                  <div className={`h-1.5 rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sold Cars Table */}
      <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl">
        <div className="p-5 border-b border-[#1a2a4a]">
          <h3 className="text-white font-semibold">Sold Cars Detail</h3>
        </div>
        {soldCars.length === 0 ? (
          <div className="text-center py-10 text-gray-500">No cars sold yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-[#1a2a4a] bg-[#111d35]">
                  <th className="text-left px-5 py-3 font-medium">Car</th>
                  <th className="text-right px-5 py-3 font-medium">Sell Price</th>
                  <th className="text-right px-5 py-3 font-medium">Buy Price</th>
                  <th className="text-right px-5 py-3 font-medium">Repair Costs</th>
                  <th className="text-right px-5 py-3 font-medium">Commission</th>
                  <th className="text-right px-5 py-3 font-medium">Net Profit</th>
                  <th className="text-left px-5 py-3 font-medium">Salesperson</th>
                </tr>
              </thead>
              <tbody>
                {carData.map(({ car, repairCosts, commission, profit, sp }, i) => (
                  <tr key={car.id} className={`border-b border-[#1a2a4a]/50 ${i % 2 === 0 ? 'bg-[#0d1526]' : 'bg-[#0a0f1e]/50'} hover:bg-[#111d35] transition-colors`}>
                    <td className="px-5 py-3">
                      <p className="text-white font-medium">{car.make} {car.model}</p>
                      <p className="text-gray-500 text-xs">{car.year} · {car.colour}</p>
                    </td>
                    <td className="px-5 py-3 text-cyan-400 font-semibold text-right">{formatRM(car.sellingPrice)}</td>
                    <td className="px-5 py-3 text-gray-400 text-right">{formatRM(car.purchasePrice)}</td>
                    <td className="px-5 py-3 text-orange-400 text-right">{formatRM(repairCosts)}</td>
                    <td className="px-5 py-3 text-purple-400 text-right">{formatRM(commission)}</td>
                    <td className={`px-5 py-3 font-bold text-right ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {profit < 0 ? `-${formatRM(Math.abs(profit))}` : formatRM(profit)}
                    </td>
                    <td className="px-5 py-3 text-gray-400">{sp?.name ?? 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#111d35] border-t border-[#1a2a4a]">
                  <td className="px-5 py-3 text-white font-semibold">Totals</td>
                  <td className="px-5 py-3 text-cyan-400 font-bold text-right">{formatRM(totalRevenue)}</td>
                  <td className="px-5 py-3 text-gray-400 font-bold text-right">{formatRM(totalPurchaseCosts)}</td>
                  <td className="px-5 py-3 text-orange-400 font-bold text-right">{formatRM(totalRepairCosts)}</td>
                  <td className="px-5 py-3 text-purple-400 font-bold text-right">{formatRM(totalCommission)}</td>
                  <td className={`px-5 py-3 font-bold text-right ${netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {netProfit < 0 ? `-${formatRM(Math.abs(netProfit))}` : formatRM(netProfit)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PLRow({ label, value, positive }: { label: string; value: number; positive?: boolean }) {
  const isPos = value >= 0 || positive;
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-[#1a2a4a]/50">
      <span className="text-gray-300 text-sm">{label}</span>
      <span className={`text-sm font-semibold ${isPos ? 'text-green-400' : 'text-red-400'}`}>
        {value < 0 ? `-${formatRM(Math.abs(value))}` : formatRM(value)}
      </span>
    </div>
  );
}
