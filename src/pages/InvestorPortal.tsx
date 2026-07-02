import { useState, useMemo } from 'react';
import {
  Car as CarIcon, Package, CheckCircle2, Wallet,
  ArrowUpCircle, ArrowDownCircle, Clock,
} from 'lucide-react';
import { useStore } from '../store';
import { formatRM, generateId } from '../utils/format';
import { thumbUrl } from '../utils/photoUrl';
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
  const investorTransactions = useStore((s) => s.investorTransactions);
  const addInvestorTransaction = useStore((s) => s.addInvestorTransaction);

  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const myCars = useMemo(
    () => cars.filter((c) => c.investorId === currentUser?.id),
    [cars, currentUser]
  );

  const carData = useMemo(() => {
    return myCars.map((car) => {
      const split = (car.investorSplit ?? 50) / 100;
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

      const commission = car.isStaffSale ? 0 : (car.consignment || (car.priceFloor != null && dealPrice < car.priceFloor)) ? 1000 : 1500;

      const totalExpenses = repairCost + miscCost + additionalTotal + commission;
      const netProfit = dealPrice - car.purchasePrice - totalExpenses;
      const myShare = netProfit * split;

      return { car, repairCost, miscCost, additionalTotal, commission, dealPrice, netProfit, myShare, split };
    });
  }, [myCars, repairs, customers]);

  const myTxns = useMemo(
    () => investorTransactions.filter(t => t.investorId === currentUser?.id),
    [investorTransactions, currentUser]
  );

  const buyIn = myTxns.find(t => t.type === 'buy_in')?.amount ?? currentUser?.capitalAmount ?? 0;
  let totalCapital = 0;
  for (const t of myTxns) {
    if (t.type === 'buy_in' || t.type === 'top_up') totalCapital += t.amount;
    if (t.type === 'withdrawal' && t.status === 'transferred') totalCapital -= t.amount;
  }
  if (myTxns.length === 0) totalCapital = currentUser?.capitalAmount ?? 0;

  const deployed = myCars
    .filter((c) => !['delivered'].includes(c.status))
    .reduce((s, c) => s + c.purchasePrice, 0);

  const onHold = myTxns
    .filter(t => t.type === 'withdrawal' && ['pending', 'approved'].includes(t.status))
    .reduce((s, t) => s + t.amount, 0);

  const available = totalCapital - deployed - onHold;

  const realizedProfit = carData
    .filter((d) => d.car.status === 'delivered')
    .reduce((s, d) => s + d.myShare, 0);

  const projectedProfit = carData
    .filter((d) => d.car.status !== 'delivered')
    .reduce((s, d) => {
      const est = (d.car.sellingPrice - d.car.purchasePrice - d.repairCost - d.miscCost - d.commission) * d.split;
      return s + est;
    }, 0);

  const active = carData.filter((d) => d.car.status !== 'delivered');
  const realized = carData.filter((d) => d.car.status === 'delivered');

  const pendingWithdrawal = myTxns.find(
    t => t.type === 'withdrawal' && ['pending', 'approved'].includes(t.status)
  );

  const handleWithdraw = async () => {
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0 || amt > available || !currentUser) return;
    setSaving(true);
    try {
      await addInvestorTransaction({
        id: generateId(),
        investorId: currentUser.id,
        type: 'withdrawal',
        amount: amt,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      setShowWithdraw(false);
      setWithdrawAmount('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="font-display text-white font-bold text-xl">My Investment Portfolio</h1>
        <p className="text-gray-500 text-sm mt-0.5">AutoDream · {currentUser?.name}</p>
      </div>

      {/* ── Wallet Card ── */}
      <div className="bg-gradient-to-br from-obsidian-800/80 to-obsidian-900/60 border border-gold-500/20 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-gold-400" />
            <span className="text-gold-300 text-xs font-semibold uppercase tracking-wider">My Wallet</span>
          </div>
          {!pendingWithdrawal && available > 0 && (
            <button
              onClick={() => setShowWithdraw(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors"
            >
              <ArrowUpCircle size={12} /> Withdraw
            </button>
          )}
        </div>

        {/* Balance grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-obsidian-800/60 rounded-xl p-3">
            <p className="text-gray-500 text-[10px] uppercase tracking-wider">Total Capital</p>
            <p className="text-white font-bold text-lg mt-1">{formatRM(totalCapital)}</p>
            <p className="text-gray-600 text-[9px] mt-0.5">Buy-in: {formatRM(buyIn)}</p>
          </div>
          <div className="bg-obsidian-800/60 rounded-xl p-3">
            <p className="text-amber-400/80 text-[10px] uppercase tracking-wider">In Stock</p>
            <p className="text-amber-400 font-bold text-lg mt-1">{formatRM(deployed)}</p>
            <p className="text-gray-600 text-[9px] mt-0.5">{active.length} car{active.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="bg-obsidian-800/60 rounded-xl p-3">
            <p className={`text-[10px] uppercase tracking-wider ${available >= 0 ? 'text-green-400/80' : 'text-red-400/80'}`}>Available</p>
            <p className={`font-bold text-lg mt-1 ${available >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatRM(available)}</p>
            {onHold > 0 && <p className="text-orange-400 text-[9px] mt-0.5">On hold: {formatRM(onHold)}</p>}
          </div>
          <div className="bg-obsidian-800/60 rounded-xl p-3">
            <p className="text-gray-500 text-[10px] uppercase tracking-wider">Realized P&amp;L</p>
            <p className={`font-bold text-lg mt-1 ${realizedProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatRM(realizedProfit)}</p>
            {projectedProfit !== 0 && (
              <p className="text-gray-600 text-[9px] mt-0.5">
                Proj: <span className={projectedProfit >= 0 ? 'text-emerald-400/60' : 'text-red-400/60'}>{formatRM(projectedProfit)}</span>
              </p>
            )}
          </div>
        </div>

        {/* Pending withdrawal status */}
        {pendingWithdrawal && (
          <div className={`border rounded-xl p-3 ${
            pendingWithdrawal.status === 'pending'
              ? 'bg-orange-500/5 border-orange-500/20'
              : 'bg-blue-500/5 border-blue-500/20'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={14} className={pendingWithdrawal.status === 'pending' ? 'text-orange-400' : 'text-blue-400'} />
                <span className={`text-xs font-semibold ${pendingWithdrawal.status === 'pending' ? 'text-orange-400' : 'text-blue-400'}`}>
                  {pendingWithdrawal.status === 'pending' ? 'Withdrawal Pending Approval' : 'Withdrawal Approved'}
                </span>
              </div>
              <span className="text-white font-bold text-sm">{formatRM(pendingWithdrawal.amount)}</span>
            </div>
            {pendingWithdrawal.status === 'approved' && (
              <div className="mt-2 text-gray-400 text-xs">
                <p>Approved {pendingWithdrawal.approvedAt ? new Date(pendingWithdrawal.approvedAt).toLocaleDateString() : ''} · {pendingWithdrawal.waitingMonths} months waiting</p>
                <p>Expected transfer: <span className="text-white font-medium">{pendingWithdrawal.dueDate ? new Date(pendingWithdrawal.dueDate).toLocaleDateString() : '—'}</span></p>
              </div>
            )}
            {pendingWithdrawal.status === 'pending' && (
              <p className="mt-1.5 text-gray-500 text-[10px]">Submitted {new Date(pendingWithdrawal.createdAt).toLocaleDateString()} · Waiting for director approval</p>
            )}
          </div>
        )}
      </div>

      {/* Withdraw form modal */}
      {showWithdraw && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowWithdraw(false)}>
          <div className="bg-obsidian-800 border border-obsidian-400/60 rounded-xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-semibold text-sm">Request Withdrawal</h3>
            <p className="text-gray-400 text-xs">Available: <span className="text-green-400 font-medium">{formatRM(available)}</span></p>
            <div>
              <label className="text-gray-400 text-[10px] block mb-1">Amount (RM)</label>
              <input
                type="number"
                className="input w-full px-3 py-2.5 rounded-lg text-sm"
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
                placeholder="e.g. 100000"
                max={available}
              />
              {Number(withdrawAmount) > available && (
                <p className="text-red-400 text-[10px] mt-1">Amount exceeds available balance</p>
              )}
            </div>
            <p className="text-gray-600 text-[10px]">
              Your withdrawal will be reviewed by the director. Once approved, a 3-6 month waiting period applies for asset dilution.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowWithdraw(false)} className="px-4 py-2 text-sm text-gray-400 border border-obsidian-400/60 rounded-lg">Cancel</button>
              <button
                onClick={handleWithdraw}
                disabled={saving || !withdrawAmount || Number(withdrawAmount) <= 0 || Number(withdrawAmount) > available}
                className="px-4 py-2 text-sm bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg disabled:opacity-40 hover:bg-red-500/30 transition-colors"
              >
                {saving ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction History */}
      {myTxns.length > 0 && (
        <section>
          <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2">
            <Wallet size={13} /> Transaction History
          </h2>
          <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl divide-y divide-obsidian-400/40">
            {[...myTxns].reverse().map(t => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  t.type === 'buy_in' ? 'bg-gold-500/20' :
                  t.type === 'top_up' ? 'bg-emerald-500/20' :
                  'bg-red-500/20'
                }`}>
                  {t.type === 'buy_in' && <Wallet size={14} className="text-gold-400" />}
                  {t.type === 'top_up' && <ArrowDownCircle size={14} className="text-emerald-400" />}
                  {t.type === 'withdrawal' && <ArrowUpCircle size={14} className="text-red-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">
                    {t.type === 'buy_in' ? 'Initial Buy-in' : t.type === 'top_up' ? 'Capital Top Up' : 'Withdrawal'}
                  </p>
                  <p className="text-gray-600 text-[10px]">
                    {new Date(t.createdAt).toLocaleDateString()}
                    {t.type === 'withdrawal' && (
                      <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                        t.status === 'pending' ? 'bg-orange-500/20 text-orange-400' :
                        t.status === 'approved' ? 'bg-blue-500/20 text-blue-400' :
                        t.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                        t.status === 'transferred' ? 'bg-emerald-500/20 text-emerald-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {t.status === 'transferred' ? 'Transferred' : t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                      </span>
                    )}
                    {t.type === 'withdrawal' && t.status === 'approved' && t.dueDate && (
                      <span className="ml-1 text-gray-500">· Due {new Date(t.dueDate).toLocaleDateString()}</span>
                    )}
                  </p>
                </div>
                <p className={`text-sm font-bold shrink-0 ${
                  t.type === 'withdrawal' ? 'text-red-400' : 'text-emerald-400'
                }`}>
                  {t.type === 'withdrawal' ? '-' : '+'}{formatRM(t.amount)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

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
                    <div className="w-20 h-14 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {car.photo
                        ? <img src={thumbUrl(car.photo, 300, 72)!} alt="" className="w-full h-full object-cover" loading="lazy" />
                        : <CarIcon size={20} className="text-gray-600" />}
                    </div>
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
