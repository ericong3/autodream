import { useState, useMemo } from 'react';
import {
  Users, Plus, ChevronDown, ChevronUp, Car as CarIcon,
  Package, CheckCircle2, Edit2, X, Eye, EyeOff,
  Building2, ArrowDownToLine, ArrowUpFromLine,
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

  const [activeTab, setActiveTab] = useState<'investors' | 'consignment'>('investors');
  const [investorView, setInvestorView] = useState<'all' | 'by_investor'>('all');
  const [consignView, setConsignView] = useState<'all' | 'by_dealer'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedDealer, setExpandedDealer] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyInvestorForm);
  const [showPass, setShowPass] = useState(false);
  const [editingCapital, setEditingCapital] = useState<{ id: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingPassword, setEditingPassword] = useState<{ id: string; value: string } | null>(null);
  const [showResetPw, setShowResetPw] = useState(false);

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
    setSaveError(null);
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
    try {
      await addUser(newUser);
      setForm(emptyInvestorForm);
      setShowAdd(false);
    } catch (e: any) {
      setSaveError(e.message ?? 'Failed to create account. Check Supabase permissions.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCapital = async (invId: string) => {
    if (!editingCapital) return;
    await updateUser(invId, { capitalAmount: Number(editingCapital.value) });
    setEditingCapital(null);
  };

  const handleSavePassword = async (invId: string) => {
    if (!editingPassword || editingPassword.value.trim().length < 6) return;
    await updateUser(invId, { password: editingPassword.value.trim() });
    setEditingPassword(null);
  };

  const allInvestorCars = useMemo(() => cars.filter(c => c.investorId), [cars]);

  const consignInCars  = useMemo(() => cars.filter(c => c.consignment),        [cars]);
  const consignOutCars = useMemo(() => cars.filter(c => c.outgoingConsignment), [cars]);

  // Group all consignment cars by dealer name into unified dealer profiles
  const dealerProfiles = useMemo(() => {
    const map: Record<string, { in: Car[]; out: Car[] }> = {};
    for (const car of consignInCars) {
      const dealer = car.consignment!.dealer || 'Unknown Dealer';
      if (!map[dealer]) map[dealer] = { in: [], out: [] };
      map[dealer].in.push(car);
    }
    for (const car of consignOutCars) {
      const dealer = car.outgoingConsignment!.dealer || 'Unknown Dealer';
      if (!map[dealer]) map[dealer] = { in: [], out: [] };
      map[dealer].out.push(car);
    }
    return Object.entries(map).map(([dealer, { in: cIn, out: cOut }]) => ({
      dealer,
      cIn,
      cOut,
      activeIn:  cIn.filter(c => c.status !== 'delivered').length,
      activeOut: cOut.filter(c => c.status !== 'delivered').length,
      doneIn:    cIn.filter(c => c.status === 'delivered').length,
      doneOut:   cOut.filter(c => c.status === 'delivered').length,
    }));
  }, [consignInCars, consignOutCars]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-white font-bold text-xl">Investors / Consignment</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {activeTab === 'investors'
              ? `${investors.length} investor account${investors.length !== 1 ? 's' : ''}`
              : `${consignInCars.length} consign in · ${consignOutCars.length} consign out`}
          </p>
        </div>
        {activeTab === 'investors' && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm"
          >
            <Plus size={15} /> Add Investor
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-obsidian-800/60 border border-obsidian-400/40 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('investors')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'investors' ? 'bg-gold-500/20 text-gold-300 border border-gold-500/30' : 'text-gray-400 hover:text-white'
          }`}
        >
          Investors
          {investors.length > 0 && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${activeTab === 'investors' ? 'bg-gold-500/30 text-gold-200' : 'bg-obsidian-600 text-gray-400'}`}>
              {investors.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('consignment')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'consignment' ? 'bg-gold-500/20 text-gold-300 border border-gold-500/30' : 'text-gray-400 hover:text-white'
          }`}
        >
          Consignment
          {(consignInCars.length + consignOutCars.length) > 0 && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${activeTab === 'consignment' ? 'bg-gold-500/30 text-gold-200' : 'bg-obsidian-600 text-gray-400'}`}>
              {consignInCars.length + consignOutCars.length}
            </span>
          )}
        </button>
      </div>

      {/* ── INVESTORS TAB ── */}
      {activeTab === 'investors' && (<>

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
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
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
          {saveError && (
            <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{saveError}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setShowAdd(false); setSaveError(null); }} className="px-4 py-2 text-sm text-gray-400 border border-obsidian-400/60 rounded-lg hover:text-white transition-colors">Cancel</button>
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

      {/* View toggle */}
      <div className="flex gap-1 bg-obsidian-800/60 border border-obsidian-400/40 rounded-xl p-1 w-fit">
        {(['all', 'by_investor'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setInvestorView(v)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              investorView === v
                ? 'bg-gold-500/20 text-gold-300 border border-gold-500/30'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {v === 'all' ? 'All Cars' : 'By Investor'}
          </button>
        ))}
      </div>

      {/* ── ALL CARS view ── */}
      {investorView === 'all' && (
        <div className="space-y-2">
          {allInvestorCars.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 bg-card-gradient border border-obsidian-400/70 rounded-xl">
              <CarIcon size={40} className="text-gray-600 mb-3" />
              <p className="text-gray-400">No investor cars yet</p>
              <p className="text-gray-600 text-xs mt-1">Assign an investor to a car to see it here</p>
            </div>
          )}
          {allInvestorCars.length > 0 && (
            <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl divide-y divide-obsidian-400/30">
              {allInvestorCars.map((car) => {
                const d = getCarData(car);
                const inv = investors.find(i => i.id === car.investorId);
                const isDelivered = car.status === 'delivered';
                return (
                  <div key={car.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-14 h-10 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {car.photo ? <img src={car.photo} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={13} className="text-gray-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white text-sm font-medium">{car.year} {car.make} {car.model}</p>
                        {car.carPlate && <span className="text-[10px] font-mono text-gold-300 bg-[#2C2415] px-1.5 py-0.5 rounded border border-[#3C321E]">{car.carPlate}</span>}
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isDelivered ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-obsidian-700/60 text-gray-400 border-obsidian-400/40'}`}>
                          {isDelivered ? 'Sold' : STATUS_LABEL[car.status]}
                        </span>
                      </div>
                      <div className="flex gap-3 text-xs text-gray-500 mt-0.5 flex-wrap">
                        {inv && <span className="text-amber-400/80">{inv.name}</span>}
                        <span>Purchase: <span className="text-white">{formatRM(car.purchasePrice)}</span></span>
                        {isDelivered
                          ? <span>Net: <span className={d.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatRM(d.netProfit)}</span> · Share ({Math.round(d.split * 100)}%): <span className={d.myShare >= 0 ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>{formatRM(d.myShare)}</span></span>
                          : <span>Est. share ({Math.round(d.split * 100)}%): <span className="text-amber-400 font-medium">{formatRM((car.sellingPrice - car.purchasePrice - d.repairCost - d.miscCost - d.commission) * d.split)}</span></span>
                        }
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── BY INVESTOR view ── */}
      {investorView === 'by_investor' && (<>

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
            <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="overflow-hidden">
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

                {/* Password reset */}
                <div className="flex items-center gap-3">
                  <p className="text-gray-400 text-xs">Password:</p>
                  {editingPassword?.id === inv.id ? (
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <input
                          type={showResetPw ? 'text' : 'password'}
                          className="input px-2 py-1 pr-7 rounded-lg text-sm w-40"
                          value={editingPassword.value}
                          onChange={(e) => setEditingPassword({ id: inv.id, value: e.target.value })}
                          placeholder="New password"
                          autoComplete="new-password"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                        <button type="button" onClick={() => setShowResetPw(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                          {showResetPw ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                      <button
                        onClick={() => handleSavePassword(inv.id)}
                        disabled={editingPassword.value.trim().length < 6}
                        className="px-3 py-1 text-xs btn-gold rounded-lg disabled:opacity-40"
                      >Save</button>
                      <button onClick={() => { setEditingPassword(null); setShowResetPw(false); }} className="px-3 py-1 text-xs text-gray-400 border border-obsidian-400/60 rounded-lg">Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingPassword({ id: inv.id, value: '' })}
                      className="flex items-center gap-1.5 text-gray-400 text-sm hover:text-gold-400 transition-colors"
                    >
                      ••••••• <Edit2 size={11} className="text-gray-500" />
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
              </div>
            </div>
          </div>
        );
      })}

      </>)}

      </>)}

      {/* ── CONSIGNMENT TAB ── */}
      {activeTab === 'consignment' && (
        <div className="space-y-4">

          {/* View toggle */}
          <div className="flex gap-1 bg-obsidian-800/60 border border-obsidian-400/40 rounded-xl p-1 w-fit">
            {(['all', 'by_dealer'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setConsignView(v)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  consignView === v
                    ? 'bg-gold-500/20 text-gold-300 border border-gold-500/30'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {v === 'all' ? 'All Cars' : 'By Dealer'}
              </button>
            ))}
          </div>

          {/* ── ALL CARS view ── */}
          {consignView === 'all' && (
            <div className="space-y-4">
              {consignInCars.length === 0 && consignOutCars.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 bg-card-gradient border border-obsidian-400/70 rounded-xl">
                  <Building2 size={40} className="text-gray-600 mb-3" />
                  <p className="text-gray-400">No consignment deals yet</p>
                  <p className="text-gray-600 text-xs mt-1">Add consignment details to a car to see it here</p>
                </div>
              )}

              {consignInCars.length > 0 && (
                <div>
                  <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <ArrowDownToLine size={11} /> Consign In ({consignInCars.length}) — dealer's car, we sell it
                  </p>
                  <div className="bg-card-gradient border border-blue-500/20 rounded-xl divide-y divide-obsidian-400/30">
                    {consignInCars.map((car) => {
                      const c = car.consignment!;
                      const isDelivered = car.status === 'delivered';
                      return (
                        <div key={car.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="w-14 h-10 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                            {car.photo ? <img src={car.photo} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={13} className="text-gray-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-white text-sm font-medium">{car.year} {car.make} {car.model}</p>
                              {car.carPlate && <span className="text-[10px] font-mono text-gold-300 bg-[#2C2415] px-1.5 py-0.5 rounded border border-[#3C321E]">{car.carPlate}</span>}
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isDelivered ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-obsidian-700/60 text-gray-400 border-obsidian-400/40'}`}>
                                {isDelivered ? 'Sold' : STATUS_LABEL[car.status]}
                              </span>
                            </div>
                            <div className="flex gap-3 text-xs text-gray-500 mt-0.5 flex-wrap">
                              <span className="text-blue-400/80">{c.dealer || 'Unknown Dealer'}</span>
                              {c.terms === 'fixed_amount'
                                ? <span>Dealer takes back: <span className="text-blue-400 font-medium">{formatRM(c.fixedAmount ?? 0)}</span></span>
                                : <span>Split — Dealer <span className="text-white">{c.splitPercent ?? 50}%</span> / Us <span className="text-green-400">{100 - (c.splitPercent ?? 50)}%</span></span>
                              }
                              {isDelivered && car.finalDeal?.dealPrice && (
                                <span>Sold at: <span className="text-emerald-400 font-medium">{formatRM(car.finalDeal.dealPrice)}</span></span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {consignOutCars.length > 0 && (
                <div>
                  <p className="text-orange-400 text-xs font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <ArrowUpFromLine size={11} /> Consign Out ({consignOutCars.length}) — our car, dealer sells it
                  </p>
                  <div className="bg-card-gradient border border-orange-500/20 rounded-xl divide-y divide-obsidian-400/30">
                    {consignOutCars.map((car) => {
                      const oc = car.outgoingConsignment!;
                      const isDelivered = car.status === 'delivered';
                      return (
                        <div key={car.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="w-14 h-10 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                            {car.photo ? <img src={car.photo} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={13} className="text-gray-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-white text-sm font-medium">{car.year} {car.make} {car.model}</p>
                              {car.carPlate && <span className="text-[10px] font-mono text-gold-300 bg-[#2C2415] px-1.5 py-0.5 rounded border border-[#3C321E]">{car.carPlate}</span>}
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isDelivered ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-obsidian-700/60 text-gray-400 border-obsidian-400/40'}`}>
                                {isDelivered ? 'Sold' : STATUS_LABEL[car.status]}
                              </span>
                            </div>
                            <div className="flex gap-3 text-xs text-gray-500 mt-0.5 flex-wrap">
                              <span className="text-orange-400/80">{oc.dealer || 'Unknown Dealer'}</span>
                              {oc.terms === 'fixed_amount'
                                ? <span>We receive: <span className="text-orange-400 font-medium">{formatRM(oc.fixedAmount ?? 0)}</span></span>
                                : <span>Split — Us <span className="text-green-400">{oc.splitPercent ?? 50}%</span> / Dealer <span className="text-white">{100 - (oc.splitPercent ?? 50)}%</span></span>
                              }
                              {isDelivered && car.finalDeal?.dealPrice && (
                                <span>Received: <span className="text-emerald-400 font-medium">{formatRM(car.finalDeal.dealPrice)}</span></span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── BY DEALER view ── */}
          {consignView === 'by_dealer' && (
            <div className="space-y-4">

          {dealerProfiles.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 bg-card-gradient border border-obsidian-400/70 rounded-xl">
              <Building2 size={40} className="text-gray-600 mb-3" />
              <p className="text-gray-400">No consignment deals yet</p>
              <p className="text-gray-600 text-xs mt-1">Add consignment details to a car to see it here</p>
            </div>
          )}

          {dealerProfiles.map(({ dealer, cIn, cOut, activeIn, activeOut, doneIn, doneOut }) => {
            const isExp = expandedDealer === dealer;
            const totalActive = activeIn + activeOut;
            const totalDone   = doneIn + doneOut;
            return (
              <div key={dealer} className="bg-card-gradient border border-obsidian-400/70 rounded-xl overflow-hidden">
                {/* Dealer header row */}
                <button
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-obsidian-700/30 transition-colors text-left"
                  onClick={() => setExpandedDealer(isExp ? null : dealer)}
                >
                  <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-base flex-shrink-0">
                    {dealer.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm">{dealer}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {cIn.length > 0 && <span className="text-[10px] text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded-full">{cIn.length} Consign In</span>}
                      {cOut.length > 0 && <span className="text-[10px] text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded-full">{cOut.length} Consign Out</span>}
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-6 text-right">
                    <div>
                      <p className="text-gray-600 text-[10px] uppercase tracking-wide">Active</p>
                      <p className="text-white font-semibold text-sm">{totalActive}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-[10px] uppercase tracking-wide">Completed</p>
                      <p className="text-emerald-400 font-semibold text-sm">{totalDone}</p>
                    </div>
                  </div>
                  {isExp ? <ChevronUp size={16} className="text-gray-500 flex-shrink-0" /> : <ChevronDown size={16} className="text-gray-500 flex-shrink-0" />}
                </button>

                {/* Expanded detail */}
                <div className={`grid transition-all duration-300 ease-in-out ${isExp ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                  <div className="border-t border-obsidian-400/40 p-5 space-y-5">

                    {/* Mobile stats */}
                    <div className="sm:hidden grid grid-cols-2 gap-3">
                      {[
                        { label: 'Active', value: String(totalActive), cls: 'text-white' },
                        { label: 'Completed', value: String(totalDone), cls: 'text-emerald-400' },
                      ].map(({ label, value, cls }) => (
                        <div key={label} className="bg-obsidian-800/60 rounded-lg p-3">
                          <p className="text-gray-600 text-[10px] uppercase tracking-wide">{label}</p>
                          <p className={`font-semibold text-sm mt-0.5 ${cls}`}>{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Consign In cars */}
                    {cIn.length > 0 && (
                      <div>
                        <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5">
                          <ArrowDownToLine size={11} /> Consign In ({cIn.length}) — dealer's car, we sell it
                        </p>
                        <div className="bg-obsidian-800/60 border border-blue-500/20 rounded-xl divide-y divide-obsidian-400/30">
                          {cIn.map((car) => {
                            const c = car.consignment!;
                            const isDelivered = car.status === 'delivered';
                            return (
                              <div key={car.id} className="flex items-center gap-3 px-4 py-3">
                                <div className="w-14 h-10 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                                  {car.photo ? <img src={car.photo} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={13} className="text-gray-600" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-white text-sm font-medium">{car.year} {car.make} {car.model}</p>
                                    {car.carPlate && <span className="text-[10px] font-mono text-gold-300 bg-[#2C2415] px-1.5 py-0.5 rounded border border-[#3C321E]">{car.carPlate}</span>}
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isDelivered ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-obsidian-700/60 text-gray-400 border-obsidian-400/40'}`}>
                                      {isDelivered ? 'Sold' : STATUS_LABEL[car.status]}
                                    </span>
                                  </div>
                                  <div className="flex gap-3 text-xs text-gray-500 mt-0.5 flex-wrap">
                                    {c.terms === 'fixed_amount'
                                      ? <span>Dealer takes back: <span className="text-blue-400 font-medium">{formatRM(c.fixedAmount ?? 0)}</span></span>
                                      : <span>Split — Dealer <span className="text-white">{c.splitPercent ?? 50}%</span> / Us <span className="text-green-400">{100 - (c.splitPercent ?? 50)}%</span></span>
                                    }
                                    {isDelivered && car.finalDeal?.dealPrice && (
                                      <span>Sold at: <span className="text-emerald-400 font-medium">{formatRM(car.finalDeal.dealPrice)}</span></span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Consign Out cars */}
                    {cOut.length > 0 && (
                      <div>
                        <p className="text-orange-400 text-xs font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5">
                          <ArrowUpFromLine size={11} /> Consign Out ({cOut.length}) — our car, dealer sells it
                        </p>
                        <div className="bg-obsidian-800/60 border border-orange-500/20 rounded-xl divide-y divide-obsidian-400/30">
                          {cOut.map((car) => {
                            const oc = car.outgoingConsignment!;
                            const isDelivered = car.status === 'delivered';
                            return (
                              <div key={car.id} className="flex items-center gap-3 px-4 py-3">
                                <div className="w-14 h-10 bg-obsidian-700/60 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                                  {car.photo ? <img src={car.photo} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={13} className="text-gray-600" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-white text-sm font-medium">{car.year} {car.make} {car.model}</p>
                                    {car.carPlate && <span className="text-[10px] font-mono text-gold-300 bg-[#2C2415] px-1.5 py-0.5 rounded border border-[#3C321E]">{car.carPlate}</span>}
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isDelivered ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-obsidian-700/60 text-gray-400 border-obsidian-400/40'}`}>
                                      {isDelivered ? 'Sold' : STATUS_LABEL[car.status]}
                                    </span>
                                  </div>
                                  <div className="flex gap-3 text-xs text-gray-500 mt-0.5 flex-wrap">
                                    {oc.terms === 'fixed_amount'
                                      ? <span>We receive: <span className="text-orange-400 font-medium">{formatRM(oc.fixedAmount ?? 0)}</span></span>
                                      : <span>Split — Us <span className="text-green-400">{oc.splitPercent ?? 50}%</span> / Dealer <span className="text-white">{100 - (oc.splitPercent ?? 50)}%</span></span>
                                    }
                                    {isDelivered && car.finalDeal?.dealPrice && (
                                      <span>Received: <span className="text-emerald-400 font-medium">{formatRM(car.finalDeal.dealPrice)}</span></span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  </div>
                  </div>
                </div>
              </div>
            );
          })}

            </div>
          )}

        </div>
      )}

    </div>
  );
}
