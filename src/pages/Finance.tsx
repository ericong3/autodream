import { useState } from 'react';
import { DollarSign, TrendingUp, Car, Wrench, Award, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../store';
import StatCard from '../components/StatCard';
import { formatRM, shortName } from '../utils/format';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function Finance() {
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const users = useStore((s) => s.users);
  const customers = useStore((s) => s.customers);

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth()); // 0-indexed

  const prevMonth = () => {
    if (selectedMonth === 0) { setSelectedMonth(11); setSelectedYear((y) => y - 1); }
    else setSelectedMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (selectedMonth === 11) { setSelectedMonth(0); setSelectedYear((y) => y + 1); }
    else setSelectedMonth((m) => m + 1);
  };

  // Derive sold date: approvedAt > submittedAt > dateAdded
  const getSoldDateFor = (car: typeof cars[0]): Date => {
    const str = car.finalDeal?.approvedAt ?? car.finalDeal?.submittedAt ?? car.dateAdded;
    return new Date(str);
  };

  // Cars sold in selected month
  const soldCarsThisMonth = cars.filter((c) => {
    if (c.status !== 'delivered') return false;
    const d = getSoldDateFor(c);
    return d.getFullYear() === selectedYear && d.getMonth() === selectedMonth;
  });

  // Done repairs for a specific car
  const getRepairCosts = (carId: string) =>
    repairs
      .filter((r) => r.carId === carId && r.status === 'done')
      .reduce((sum, r) => sum + (r.actualCost ?? r.totalCost), 0);

  const getDealSalespersonId = (car: typeof cars[0]): string | undefined => {
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    return car.assignedSalesperson || dealCustomer?.assignedSalesId;
  };

  const getSalesperson = (id?: string) =>
    id ? users.find((u) => u.id === id) : null;

  const getWorkOrder = (car: typeof cars[0]) => {
    const dealCustomer = customers.find(c => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    return dealCustomer?.loanWorkOrder ?? dealCustomer?.cashWorkOrder;
  };

  const calcCommission = (car: typeof cars[0], repairCosts: number, miscCosts: number, additionalTotal: number): number => {
    if (car.outgoingConsignment) return 0;
    const wo = getWorkOrder(car);
    const dealPrice = (wo?.sellingPrice ?? car.finalDeal?.dealPrice ?? car.sellingPrice) - (wo?.discount ?? 0);
    const netBeforeComm = dealPrice - car.purchasePrice - repairCosts - miscCosts - additionalTotal;
    if (car.priceFloor != null) {
      return dealPrice >= car.priceFloor
        ? (netBeforeComm >= 10000 ? 2000 : 1500)
        : 1000;
    }
    return netBeforeComm >= 10000 ? 1500 : 1000;
  };

  // Per-car data (compute first so totals derive from it)
  const carData = soldCarsThisMonth.map((car) => {
    const wo = getWorkOrder(car);
    const repairCosts = getRepairCosts(car.id);
    const miscCosts = (car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0);
    const additionalTotal = wo?.additionalItems?.reduce((s, i) => s + i.amount, 0) ?? 0;
    const dealPrice = (wo?.sellingPrice ?? car.finalDeal?.dealPrice ?? car.sellingPrice) - (wo?.discount ?? 0);
    const commission = calcCommission(car, repairCosts, miscCosts, additionalTotal);
    const profit = dealPrice - car.purchasePrice - repairCosts - miscCosts - additionalTotal - commission;
    const sp = getSalesperson(getDealSalespersonId(car));
    return { car, dealPrice, repairCosts, miscCosts, additionalTotal, commission, profit, sp };
  });

  // Aggregates derived from carData
  const totalRevenue = carData.reduce((s, d) => s + d.dealPrice, 0);
  const totalPurchaseCosts = carData.reduce((s, d) => s + d.car.purchasePrice, 0);
  const totalRepairCosts = carData.reduce((s, d) => s + d.repairCosts, 0);
  const totalCommission = carData.reduce((s, d) => s + d.commission, 0);
  const netProfit = carData.reduce((s, d) => s + d.profit, 0);
  const avgProfitPerCar = carData.length > 0 ? netProfit / carData.length : 0;

  // Commission per salesperson (this month)
  const commissionBySalesperson = users
    .filter((u) => u.role === 'salesperson')
    .map((sp) => {
      const soldBySp = soldCarsThisMonth.filter((c) => getDealSalespersonId(c) === sp.id);
      const commission = soldBySp.reduce((sum, car) => {
        const wo = getWorkOrder(car);
        const additionalTotal = wo?.additionalItems?.reduce((s, i) => s + i.amount, 0) ?? 0;
        return sum + calcCommission(car, getRepairCosts(car.id), (car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0), additionalTotal);
      }, 0);
      return { sp, soldCount: soldBySp.length, commission };
    })
    .filter((x) => x.soldCount > 0);

  // Done repairs for cars sold this month (for workshop expenses table)
  const workshopRepairs = repairs.filter(
    (r) => r.status === 'done' && soldCarsThisMonth.some((c) => c.id === r.carId)
  );

  return (
    <div className="space-y-6">
      {/* Month selector */}
      <div className="flex items-center gap-3">
        <button
          onClick={prevMonth}
          className="p-2 rounded-lg border border-obsidian-400/60 text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-lg px-5 py-2 text-white font-semibold min-w-[160px] text-center">
          {MONTH_NAMES[selectedMonth]} {selectedYear}
        </div>
        <button
          onClick={nextMonth}
          className="p-2 rounded-lg border border-obsidian-400/60 text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
        >
          <ChevronRight size={16} />
        </button>
        <span className="text-gray-500 text-sm">
          {soldCarsThisMonth.length} car{soldCarsThisMonth.length !== 1 ? 's' : ''} sold this month
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard
          title="Total Revenue"
          value={formatRM(totalRevenue)}
          subtitle={`${soldCarsThisMonth.length} cars sold`}
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
          borderColor="border-l-gold-400"
          iconColor="text-gold-400"
        />
        <StatCard
          title="Repair & Workshop"
          value={formatRM(totalRepairCosts)}
          subtitle={`${workshopRepairs.length} job${workshopRepairs.length !== 1 ? 's' : ''} completed`}
          icon={Wrench}
          borderColor="border-l-orange-400"
          iconColor="text-orange-400"
        />
        <StatCard
          title="Salesman Commission"
          value={formatRM(totalCommission)}
          subtitle={`${soldCarsThisMonth.length} car${soldCarsThisMonth.length !== 1 ? 's' : ''} delivered`}
          icon={Award}
          borderColor="border-l-purple-400"
          iconColor="text-purple-400"
        />
      </div>

      {/* P&L Summary */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-5">
          <h3 className="text-white font-semibold mb-1">P&L Summary</h3>
          <p className="text-gray-500 text-xs mb-4">{MONTH_NAMES[selectedMonth]} {selectedYear}</p>
          <div className="space-y-3">
            <PLRow label="Revenue (Sales)" value={totalRevenue} positive />
            <PLRow label="Purchase Costs" value={-totalPurchaseCosts} />
            <PLRow label="Repair & Workshop" value={-totalRepairCosts} />
            <PLRow label="Salesman Commission" value={-totalCommission} />
            <div className="border-t border-obsidian-400/60 pt-3">
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
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-5">
          <h3 className="text-white font-semibold mb-1">Commission by Salesperson</h3>
          <p className="text-gray-500 text-xs mb-4">{MONTH_NAMES[selectedMonth]} {selectedYear}</p>
          {commissionBySalesperson.length === 0 ? (
            <p className="text-gray-500 text-sm">No commissions this month</p>
          ) : (
            <div className="space-y-3">
              {commissionBySalesperson.map(({ sp, soldCount, commission }) => (
                <div key={sp.id} className="flex items-center justify-between p-3 bg-obsidian-700/60 rounded-lg border border-obsidian-400/60">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gold-500/20 rounded-full flex items-center justify-center text-gold-400 font-bold text-sm uppercase">
                      {shortName(sp.name).charAt(0)}
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">{shortName(sp.name)}</p>
                      <p className="text-gray-500 text-xs">{soldCount} car{soldCount !== 1 ? 's' : ''} sold</p>
                    </div>
                  </div>
                  <span className="text-purple-400 font-bold">{formatRM(commission)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cost breakdown */}
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-5">
          <h3 className="text-white font-semibold mb-1">Cost Breakdown</h3>
          <p className="text-gray-500 text-xs mb-4">{MONTH_NAMES[selectedMonth]} {selectedYear}</p>
          <div className="space-y-3">
            {[
              { label: 'Purchase Costs', value: totalPurchaseCosts, pct: totalRevenue > 0 ? (totalPurchaseCosts / totalRevenue) * 100 : 0, color: 'bg-blue-500' },
              { label: 'Repair Costs', value: totalRepairCosts, pct: totalRevenue > 0 ? (totalRepairCosts / totalRevenue) * 100 : 0, color: 'bg-orange-500' },
              { label: 'Salesman Commission', value: totalCommission, pct: totalRevenue > 0 ? (totalCommission / totalRevenue) * 100 : 0, color: 'bg-purple-500' },
              { label: 'Net Profit', value: Math.max(0, netProfit), pct: totalRevenue > 0 ? (Math.max(0, netProfit) / totalRevenue) * 100 : 0, color: 'bg-green-500' },
            ].map(({ label, value, pct, color }) => (
              <div key={label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">{label}</span>
                  <span className="text-gray-300">{formatRM(value)} ({pct.toFixed(1)}%)</span>
                </div>
                <div className="h-1.5 bg-obsidian-700/60 rounded-full">
                  <div className={`h-1.5 rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Workshop Expenses Table */}
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
        <div className="p-5 border-b border-obsidian-400/60 flex items-center justify-between">
          <div>
            <h3 className="text-white font-semibold">Repair & Workshop Expenses</h3>
            <p className="text-gray-500 text-xs mt-0.5">For cars sold in {MONTH_NAMES[selectedMonth]} {selectedYear}</p>
          </div>
          <span className="text-orange-400 font-bold text-sm">{formatRM(totalRepairCosts)}</span>
        </div>
        {workshopRepairs.length === 0 ? (
          <div className="text-center py-10 text-gray-500 text-sm">No repair costs for cars sold this month</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-obsidian-400/60 bg-[#161410]">
                  <th className="text-left px-5 py-3 font-medium">Car</th>
                  <th className="text-left px-5 py-3 font-medium">Repair Type</th>
                  <th className="text-left px-5 py-3 font-medium">Location</th>
                  <th className="text-left px-5 py-3 font-medium">Completed</th>
                  <th className="text-right px-5 py-3 font-medium">Actual Cost</th>
                </tr>
              </thead>
              <tbody>
                {workshopRepairs.map((r, i) => {
                  const car = cars.find((c) => c.id === r.carId);
                  return (
                    <tr key={r.id} className={`border-b border-obsidian-400/60/50 ${i % 2 === 0 ? 'bg-[#0F0E0C]' : 'bg-obsidian-950/30'}`}>
                      <td className="px-5 py-3">
                        {car ? (
                          <div>
                            <p className="text-white font-medium">{car.make} {car.model}</p>
                            <p className="text-gray-500 text-xs">{car.year}</p>
                          </div>
                        ) : <span className="text-gray-500">—</span>}
                      </td>
                      <td className="px-5 py-3 text-gray-300">{r.typeOfRepair}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{r.location ?? '—'}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {r.completedAt ? new Date(r.completedAt).toLocaleDateString('en-MY') : '—'}
                      </td>
                      <td className="px-5 py-3 text-orange-400 font-semibold text-right">
                        {formatRM(r.actualCost ?? r.totalCost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-obsidian-700/60 border-t border-obsidian-400/60">
                  <td colSpan={4} className="px-5 py-3 text-white font-semibold">Total</td>
                  <td className="px-5 py-3 text-orange-400 font-bold text-right">{formatRM(totalRepairCosts)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Sold Cars Table */}
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
        <div className="p-5 border-b border-obsidian-400/60">
          <h3 className="text-white font-semibold">Sold Cars Detail</h3>
          <p className="text-gray-500 text-xs mt-0.5">{MONTH_NAMES[selectedMonth]} {selectedYear}</p>
        </div>
        {soldCarsThisMonth.length === 0 ? (
          <div className="text-center py-10 text-gray-500">No cars sold this month</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-obsidian-400/60 bg-[#161410]">
                  <th className="text-left px-5 py-3 font-medium">Car</th>
                  <th className="text-right px-5 py-3 font-medium">Deal Price</th>
                  <th className="text-right px-5 py-3 font-medium">Buy Price</th>
                  <th className="text-right px-5 py-3 font-medium">Repair Costs</th>
                  <th className="text-right px-5 py-3 font-medium">Salesman Commission</th>
                  <th className="text-right px-5 py-3 font-medium">Net Profit</th>
                  <th className="text-left px-5 py-3 font-medium">Salesperson</th>
                </tr>
              </thead>
              <tbody>
                {carData.map(({ car, dealPrice, repairCosts, commission, profit, sp }, i) => (
                  <tr key={car.id} className={`border-b border-obsidian-400/60/50 ${i % 2 === 0 ? 'bg-[#0F0E0C]' : 'bg-obsidian-950/30'} hover:bg-obsidian-700/50 transition-colors`}>
                    <td className="px-5 py-3">
                      <p className="text-white font-medium">{car.make} {car.model}</p>
                      <p className="text-gray-500 text-xs">{car.year} · {car.colour}</p>
                    </td>
                    <td className="px-5 py-3 text-gold-400 font-semibold text-right">{formatRM(dealPrice)}</td>
                    <td className="px-5 py-3 text-gray-400 text-right">{formatRM(car.purchasePrice)}</td>
                    <td className="px-5 py-3 text-orange-400 text-right">{formatRM(repairCosts)}</td>
                    <td className="px-5 py-3 text-purple-400 text-right">{formatRM(commission)}</td>
                    <td className={`px-5 py-3 font-bold text-right ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {profit < 0 ? `-${formatRM(Math.abs(profit))}` : formatRM(profit)}
                    </td>
                    <td className="px-5 py-3 text-gray-400">{sp ? shortName(sp.name) : 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-obsidian-700/60 border-t border-obsidian-400/60">
                  <td className="px-5 py-3 text-white font-semibold">Totals</td>
                  <td className="px-5 py-3 text-gold-400 font-bold text-right">{formatRM(totalRevenue)}</td>
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
    <div className="flex justify-between items-center py-1.5 border-b border-obsidian-400/60/50">
      <span className="text-gray-300 text-sm">{label}</span>
      <span className={`text-sm font-semibold ${isPos ? 'text-green-400' : 'text-red-400'}`}>
        {value < 0 ? `-${formatRM(Math.abs(value))}` : formatRM(value)}
      </span>
    </div>
  );
}
