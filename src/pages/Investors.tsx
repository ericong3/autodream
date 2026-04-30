import { useState, useMemo } from 'react';
import {
  Users, Plus, ChevronDown, ChevronUp, Car as CarIcon,
  Package, CheckCircle2, Edit2, X, Eye, EyeOff,
} from 'lucide-react';
import { useStore } from '../store';
import { formatRM, generateId } from '../utils/format';
import { User, Car } from '../types';

const STATUS_LABEL: Record<Car['status'], string> = {
  coming_soon: 'Coming Soon', in_workshop: 'In Workshop', ready: 'Ready',
  photo_complete: 'Photo Done', submitted: 'Submitted', deal_pending: 'Deal Pending',
  sold: 'Sold', available: 'Available', reserved: 'Reserved', delivered: 'Delivered',
};

const emptyInvestorForm = {
  name: '', username: '', password: '', phone: '', capitalAmount: 0,
};

export default function Investors() {
  const users = useStore((s) => s.users);
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const customers = useStore((s) => s.customers);
  const addUser = useStore((s) => s.addUser);
  const updateUser = useStore((s) => s.updateUser);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyInvestorForm);
  const [showPass, setShowPass] = useState(false);
  const [editingCapital, setEditingCapital] = useState<{ id: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const investors = useMemo(
    () => users.filter((u) => u.role === 'investor'),
    [users]
  );

  // Per-car profit calculation (same formula as InvestorPortal)
  const getCarData = (car: Car) => {
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
    const profitBeforeComm = dealPrice - car.purchasePrice - repairCost - miscCost - additionalTotal;
    const commission = car.outgoingConsignment ? 0 : car.priceFloor != null
      ? (dealPrice >= car.priceFloor ? (profitBeforeComm >= 10000 ? 2000 : 1500) : 1000)
      : (profitBeforeComm >= 10000 ? 1500 : 1000);
    const netProfit = profitBeforeComm - commission;
    return { car, repairCost, miscCost, additionalTotal, commission, dealPrice, netProfit, myShare: netProfit * split, split, customer };
  };

  const investorStats = useMemo(() => {
    return investors.map((inv) => {
      const myCars = cars.filter((c) => c.investorId === inv.id);
      const active = myCars.filter((c) => c.status !== 'delivered');
      const realized = myCars.filter((c) => c.status === 'delivered');
      const deployed = active.reduce((s, c) => s + c.purchasePrice, 0);
      const available = (inv.capitalAmount ?? 0) - deployed;
      const realizedProfit = realized.map(getCarData).reduce((s, d) => s + d.myShare, 0);
      return { inv, myCars, active, realized, deployed, available, realizedProfit };
    });
  }, [investors, cars, repairs, customers]);

  const handleAddInvestor = async () => {
    if (!form.name.trim() || !form.username.trim() || !form.password.trim()) return;
    setSaving(true);
    const newUser: User = {
      id: generateId(),
      name: form.name.trim(),
      username: form.username.trim(),
      password: form.password,
      role: 'investor',
      phone: form.phone.trim(),
      monthlyTarget: 0,
      carsInMonth: 0,
      capitalAmount: form.capitalAmount,
    };
    await addUser(newUser);
    setForm(emptyInvestorForm);
    setShowAdd(false);
    setSaving(false);
  };

  const handleSaveCapital = async (invId: string) => {
    if (!editingCapital) return;
    await updateUser(invId, { capitalAmount: Number(editingCapital.value) });
    setEditingCapital(null);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-white font-bold text-xl">Investors</h1>
          <p className="text-gray-500 text-sm mt-0.5">{investors.length} investor account{investors.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm"
        >
          <Plus size={15} /> Add Investor
        </button>
      </div>

      {/* Add investor form */}
      {showAdd && (
        <div className="bg-card-gradient border border-gold-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-white font-semibold text-sm">New Investor Account</h3>
            <button onClick={() => setShowAdd(false)} className="p-1.5 text-gray-400 hover:text-white rounded-lg transition-colors"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-gray-400 text-xs block mb-1">Full Name</label>
              <input className="input w-full px-3 py-2 rounded-lg text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ahmad Razif" />
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">Phone</label>
              <input className="input w-full px-3 py-2 rounded-lg text-sm" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="01X-XXXXXXX" />
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">Username (login)</label>
              <input className="input w-full px-3 py-2 rounded-lg text-sm" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="investor_username" autoCapitalize="none" />
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  className="input w-full px-3 py-2 pr-8 rounded-lg text-sm"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="col-span-2">
              <label className="text-gray-400 text-xs block mb-1">Capital Amount (RM)</label>
              <input type="number" className="input w-full px-3 py-2 rounded-lg text-sm" value={form.capitalAmount || ''} onChange={(e) => setForm({ ...form, capitalAmount: Number(e.target.value) })} placeholder="e.g. 200000" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-400 border border-obsidian-400/60 rounded-lg hover:text-white transition-colors">Cancel</button>
            <button
              onClick={handleAddInvestor}
              disabled={saving || !form.name || !form.username || !form.password}
              className="px-4 py-2 text-sm btn-gold rounded-lg disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </div>
      )}

      {investors.length === 0 && !showAdd && (
        <div className="flex flex-col items-center justify-center py-20 bg-card-gradient border border-obsidian-400/70 rounded-xl">
          <Users size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400">No investor accounts yet</p>
          <p className="text-gray-600 text-xs mt-1">Create an account to start tracking investor capital</p>
        </div>
      )}

      {/* Investor cards */}
      {investorStats.map(({ inv, myCars, active, realized, deployed, available, realizedProfit }) => {
        const isExpanded = expanded === inv.id;
        return (
          <div key={inv.id} className="bg-card-gradient border border-obsidian-400/70 rounded-xl overflow-hidden">
            {/* Header row */}
            <button
              className="w-full flex items-center gap-4 px-5 py-4 hover:bg-obsidian-700/30 transition-colors text-left"
              onClick={() => setExpanded(isExpanded ? null : inv.id)}
            >
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-base flex-shrink-0">
                {inv.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm">{inv.name}</p>
                <p className="text-gray-500 text-xs">{inv.phone || 'No phone'} · @{inv.username}</p>
              </div>
              {/* Quick stats */}
              <div className="hidden sm:flex items-center gap-6 text-right">
                <div>
                  <p className="text-gray-600 text-[10px] uppercase tracking-wide">Capital</p>
                  <p className="text-white font-semibold text-sm">{formatRM(inv.capitalAmount ?? 0)}</p>
                </div>
                <div>
                  <p className="text-gray-600 text-[10px] uppercase tracking-wide">Deployed</p>
                  <p className="text-amber-400 font-semibold text-sm">{formatRM(deployed)}</p>
                </div>
                <div>
                  <p className="text-gray-600 text-[10px] uppercase tracking-wide">Available</p>
                  <p className={`font-semibold text-sm ${available >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatRM(available)}</p>
                </div>
                <div>
                  <p className="text-gray-600 text-[10px] uppercase tracking-wide">Realized P&amp;L</p>
                  <p className={`font-semibold text-sm ${realizedProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatRM(realizedProfit)}</p>
                </div>
              </div>
              {isExpanded ? <ChevronUp size={16} className="text-gray-500 flex-shrink-0" /> : <ChevronDown size={16} className="text-gray-500 flex-shrink-0" />}
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="border-t border-obsidian-400/40 p-5 space-y-5">
                {/* Capital editor */}
                <div className="flex items-center gap-3">
                  <p className="text-gray-400 text-xs">Capital:</p>
                  {editingCapital?.id === inv.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        className="input px-2 py-1 rounded-lg text-sm w-36"
                        value={editingCapital.value}
                        onChange={(e) => setEditingCapital({ id: inv.id, value: e.target.value })}
                      />
                      <button onClick={() => handleSaveCapital(inv.id)} className="px-3 py-1 text-xs btn-gold rounded-lg">Save</button>
                      <button onClick={() => setEditingCapital(null)} className="px-3 py-1 text-xs text-gray-400 border border-obsidian-400/60 rounded-lg">Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingCapital({ id: inv.id, value: String(inv.capitalAmount ?? 0) })}
                      className="flex items-center gap-1.5 text-white font-semibold text-sm hover:text-gold-400 transition-colors"
                    >
                      {formatRM(inv.capitalAmount ?? 0)} <Edit2 size={11} className="text-gray-500" />
                    </button>
                  )}
                </div>

                {/* Mobile quick stats */}
                <div className="sm:hidden grid grid-cols-3 gap-3">
                  {[
                    { label: 'Deployed', value: formatRM(deployed), cls: 'text-amber-400' },
                    { label: 'Available', value: formatRM(available), cls: available >= 0 ? 'text-green-400' : 'text-red-400' },
                    { label: 'Realized P&L', value: formatRM(realizedProfit), cls: realizedProfit >= 0 ? 'text-emerald-400' : 'text-red-400' },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className="bg-obsidian-800/60 rounded-lg p-3">
                      <p className="text-gray-600 text-[10px] uppercase tracking-wide">{label}</p>
                      <p className={`font-semibold text-sm mt-0.5 ${cls}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Active cars */}
                {active.length > 0 && (
                  <div>
                    <p className="text-gray-500 text-xs font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5"><Package size={11} />Active ({active.length})</p>
                    <div className="space-y-2">
                      {active.map((car) => {
                        const d = getCarData(car);
                        return (
                          <div key={car.id} className="bg-obsidian-800/60 border border-obsidian-400/40 rounded-xl p-3 flex gap-3 items-start">
                            <div className="w-16 h-11 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                              {car.photo ? <img src={car.photo} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={16} className="text-gray-600" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-white text-sm font-medium">{car.year} {car.make} {car.model}</p>
                                {car.carPlate && <span className="text-[10px] font-mono text-gold-300 bg-[#2C2415] px-1.5 py-0.5 rounded border border-[#3C321E]">{car.carPlate}</span>}
                                <span className="text-[10px] text-gray-400 bg-obsidian-700/60 px-1.5 py-0.5 rounded-full">{STATUS_LABEL[car.status]}</span>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs">
                                <div><p className="text-gray-600">Purchase</p><p className="text-white font-medium">{formatRM(car.purchasePrice)}</p></div>
                                <div><p className="text-gray-600">Repair+Misc</p><p className="text-white font-medium">{formatRM(d.repairCost + d.miscCost)}</p></div>
                                <div><p className="text-gray-600">Commission</p><p className="text-white font-medium">{formatRM(d.commission)}</p></div>
                                <div><p className="text-gray-600">Est. Share ({Math.round(d.split * 100)}%)</p><p className={`font-semibold ${d.myShare >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatRM((car.sellingPrice - car.purchasePrice - d.repairCost - d.miscCost - d.commission) * d.split)}</p></div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Realized cars */}
                {realized.length > 0 && (
                  <div>
                    <p className="text-gray-500 text-xs font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5"><CheckCircle2 size={11} />Realized ({realized.length})</p>
                    <div className="bg-obsidian-800/60 border border-obsidian-400/40 rounded-xl divide-y divide-obsidian-400/30">
                      {realized.map((car) => {
                        const d = getCarData(car);
                        return (
                          <div key={car.id} className="flex items-center gap-3 px-4 py-3">
                            <div className="w-12 h-8 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                              {car.photo ? <img src={car.photo} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={12} className="text-gray-600" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-300 text-sm font-medium">{car.year} {car.make} {car.model}</p>
                              <div className="flex gap-3 text-xs text-gray-600 mt-0.5 flex-wrap">
                                <span>Sold: {formatRM(d.dealPrice)}</span>
                                <span>Costs: {formatRM(car.purchasePrice + d.repairCost + d.miscCost + d.additionalTotal + d.commission)}</span>
                                <span>Net: {formatRM(d.netProfit)}</span>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-gray-600 text-[10px]">{Math.round(d.split * 100)}% share</p>
                              <p className={`text-sm font-bold ${d.myShare >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatRM(d.myShare)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {myCars.length === 0 && (
                  <p className="text-gray-600 text-sm text-center py-4">No cars assigned to this investor yet.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
