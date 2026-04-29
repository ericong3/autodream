import { useMemo } from 'react';
import { Car as CarIcon, Package, CheckCircle2 } from 'lucide-react';
import { useStore } from '../store';
import { formatRM } from '../utils/format';
import { Car } from '../types';

const STATUS_LABEL: Record<Car['status'], string> = {
  coming_soon: 'Coming Soon',
  in_workshop: 'In Workshop',
  ready: 'Ready',
  photo_complete: 'Photo Done',
  submitted: 'Submitted',
  deal_pending: 'Deal Pending',
  sold: 'Sold',
  available: 'Available',
  reserved: 'Reserved',
  delivered: 'Delivered',
};

const STATUS_CLS: Record<Car['status'], string> = {
  coming_soon: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  in_workshop: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  ready: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  photo_complete: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  submitted: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  deal_pending: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  sold: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  available: 'bg-green-500/20 text-green-400 border-green-500/30',
  reserved: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  delivered: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

export default function InvestorPortal() {
  const currentUser = useStore((s) => s.currentUser);
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const customers = useStore((s) => s.customers);

  const myCars = useMemo(
    () => cars.filter((c) => c.investorId === currentUser?.id),
    [cars, currentUser]
  );

  // Per-car financials — no customer PII exposed
  const carData = useMemo(() => {
    return myCars.map((car) => {
      const split = (car.investorSplit ?? 50) / 100;
      const repairCost = repairs
        .filter((r) => r.carId === car.id && r.status === 'done')
        .reduce((s, r) => s + (r.actualCost ?? r.totalCost), 0);
      const miscCost = (car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0);

      // Deal price from work order (no customer name/phone exposed)
      const customer = customers.find(
        (c) => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder)
      );
      const wo = customer?.loanWorkOrder ?? customer?.cashWorkOrder;
      const dealPrice = wo
        ? wo.sellingPrice - (wo.discount ?? 0)
        : car.finalDeal?.dealPrice ?? car.sellingPrice;
      const additionalTotal = wo?.additionalItems?.reduce((s, i) => s + i.amount, 0) ?? 0;

      const commission = car.priceFloor != null
        ? (dealPrice >= car.priceFloor
            ? ((dealPrice - car.purchasePrice - repairCost - miscCost - additionalTotal) >= 10000 ? 2000 : 1500)
            : 1000)
        : ((dealPrice - car.purchasePrice - repairCost - miscCost - additionalTotal) >= 10000 ? 1500 : 1000);

      const totalExpenses = repairCost + miscCost + additionalTotal + commission;
      const netProfit = dealPrice - car.purchasePrice - totalExpenses;
      const myShare = netProfit * split;

      return { car, repairCost, miscCost, additionalTotal, commission, dealPrice, netProfit, myShare, split };
    });
  }, [myCars, repairs, customers]);

  const capitalAmount = currentUser?.capitalAmount ?? 0;
  const deployed = myCars
    .filter((c) => !['delivered'].includes(c.status))
    .reduce((s, c) => s + c.purchasePrice, 0);
  const available = capitalAmount - deployed;
  const realizedProfit = carData
    .filter((d) => d.car.status === 'delivered')
    .reduce((s, d) => s + d.myShare, 0);

  const active = carData.filter((d) => d.car.status !== 'delivered');
  const realized = carData.filter((d) => d.car.status === 'delivered');

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="font-display text-white font-bold text-xl">My Investment Portfolio</h1>
        <p className="text-gray-500 text-sm mt-0.5">AutoDream · {currentUser?.name}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl p-4">
          <p className="text-gray-500 text-xs uppercase tracking-wider">Total Capital</p>
          <p className="text-white font-bold text-lg mt-1">{formatRM(capitalAmount)}</p>
        </div>
        <div className="bg-card-gradient border border-amber-500/30 rounded-xl p-4">
          <p className="text-amber-400/80 text-xs uppercase tracking-wider">Deployed</p>
          <p className="text-amber-400 font-bold text-lg mt-1">{formatRM(deployed)}</p>
          <p className="text-gray-600 text-[10px] mt-0.5">{active.length} car{active.length !== 1 ? 's' : ''}</p>
        </div>
        <div className={`bg-card-gradient border rounded-xl p-4 ${available >= 0 ? 'border-green-500/30' : 'border-red-500/30'}`}>
          <p className={`text-xs uppercase tracking-wider ${available >= 0 ? 'text-green-400/80' : 'text-red-400/80'}`}>Available</p>
          <p className={`font-bold text-lg mt-1 ${available >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatRM(available)}</p>
        </div>
        <div className={`bg-card-gradient border rounded-xl p-4 ${realizedProfit >= 0 ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
          <p className="text-gray-500 text-xs uppercase tracking-wider">Realized P&amp;L</p>
          <p className={`font-bold text-lg mt-1 ${realizedProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatRM(realizedProfit)}</p>
          <p className="text-gray-600 text-[10px] mt-0.5">{realized.length} sold</p>
        </div>
      </div>

      {/* Active positions */}
      <section>
        <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2">
          <Package size={13} /> Active Positions ({active.length})
        </h2>
        {active.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 bg-card-gradient border border-obsidian-400/70 rounded-xl">
            <CarIcon size={36} className="text-gray-600 mb-2" />
            <p className="text-gray-500 text-sm">No active positions</p>
          </div>
        ) : (
          <div className="space-y-3">
            {active.map(({ car, repairCost, miscCost, commission, split }) => {
              const totalIn = car.purchasePrice + repairCost + miscCost;
              const estProfit = (car.sellingPrice - car.purchasePrice - repairCost - miscCost - commission) * split;
              return (
                <div key={car.id} className="bg-card-gradient border border-obsidian-400/70 rounded-xl overflow-hidden">
                  <div className="flex gap-3 p-4">
                    {/* Photo */}
                    <div className="w-20 h-14 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {car.photo
                        ? <img src={car.photo} alt="" className="w-full h-full object-cover" loading="lazy" />
                        : <CarIcon size={20} className="text-gray-600" />}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-white font-semibold text-sm">{car.year} {car.make} {car.model}</p>
                          <p className="text-gray-500 text-xs">{car.colour} · {car.transmission}{car.carPlate ? ` · ${car.carPlate}` : ''}</p>
                        </div>
                        <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_CLS[car.status]}`}>
                          {STATUS_LABEL[car.status]}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Financials */}
                  <div className="border-t border-obsidian-400/40 px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <p className="text-gray-600 mb-0.5">Purchase Price</p>
                      <p className="text-white font-medium">{formatRM(car.purchasePrice)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 mb-0.5">Repair + Misc</p>
                      <p className="text-white font-medium">{formatRM(repairCost + miscCost)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 mb-0.5">Total In</p>
                      <p className="text-amber-400 font-semibold">{formatRM(totalIn)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 mb-0.5">Est. My Share ({Math.round(split * 100)}%)</p>
                      <p className={`font-semibold ${estProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatRM(estProfit)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Realized positions */}
      {realized.length > 0 && (
        <section>
          <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2">
            <CheckCircle2 size={13} /> Realized ({realized.length})
          </h2>
          <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl divide-y divide-obsidian-400/40">
            {realized.map(({ car, repairCost, miscCost, additionalTotal, commission, dealPrice, myShare, split }) => (
              <div key={car.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-14 h-10 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {car.photo
                    ? <img src={car.photo} alt="" className="w-full h-full object-cover" loading="lazy" />
                    : <CarIcon size={16} className="text-gray-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-300 text-sm font-medium">{car.year} {car.make} {car.model}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-600 flex-wrap">
                    <span>Sold: {formatRM(dealPrice)}</span>
                    <span>Costs: {formatRM(car.purchasePrice + repairCost + miscCost + additionalTotal + commission)}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-gray-500 text-[10px]">My {Math.round(split * 100)}% share</p>
                  <p className={`text-sm font-bold ${myShare >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatRM(myShare)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
