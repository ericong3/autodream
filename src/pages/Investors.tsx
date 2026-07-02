import { useState, useMemo } from 'react';
import { thumbUrl } from '../utils/photoUrl';
import {
  Users, Plus, ChevronDown, ChevronUp, Car as CarIcon,
  Package, CheckCircle2, Edit2, X, Eye, EyeOff,
  Building2, ArrowDownToLine, ArrowUpFromLine, Trash2,
  Wallet, ArrowUpCircle, ArrowDownCircle, Clock, Check, XCircle, Send,
} from 'lucide-react';
import { useStore } from '../store';
import { formatRM, generateId } from '../utils/format';
import { User, Car, InvestorTransaction } from '../types';

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
  const deleteUser = useStore((s) => s.deleteUser);
  const investorTransactions = useStore((s) => s.investorTransactions);
  const addInvestorTransaction = useStore((s) => s.addInvestorTransaction);
  const updateInvestorTransaction = useStore((s) => s.updateInvestorTransaction);
  const currentUser = useStore((s) => s.currentUser);

  const [activeTab, setActiveTab] = useState<'investors' | 'consignment'>('investors');
  const [investorView, setInvestorView] = useState<'all' | 'by_investor'>('all');
  const [consignView, setConsignView] = useState<'all' | 'by_dealer'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedDealer, setExpandedDealer] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyInvestorForm);
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingPassword, setEditingPassword] = useState<{ id: string; value: string } | null>(null);
  const [showResetPw, setShowResetPw] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showTopUp, setShowTopUp] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpDate, setTopUpDate] = useState(new Date().toISOString().slice(0, 10));
  const [approvalModal, setApprovalModal] = useState<{ txn: InvestorTransaction; months: number } | null>(null);

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
    const commission = (car.outgoingConsignment || car.isStaffSale) ? 0 : (car.consignment || (car.priceFloor != null && dealPrice < car.priceFloor)) ? 1000 : 1500;
    const netProfit = profitBeforeComm - commission;
    return { car, repairCost, miscCost, additionalTotal, commission, dealPrice, netProfit, myShare: netProfit * split, split, customer };
  };

  const investorStats = useMemo(() => {
    return investors.map((inv) => {
      const myCars = cars.filter((c) => c.investorId === inv.id);
      const active = myCars.filter((c) => c.status !== 'delivered');
      const realized = myCars.filter((c) => c.status === 'delivered');
      const deployed = active.reduce((s, c) => s + c.purchasePrice, 0);
      const txns = investorTransactions.filter(t => t.investorId === inv.id);
      const buyIn = txns.find(t => t.type === 'buy_in')?.amount ?? inv.capitalAmount ?? 0;
      let totalCapital = 0;
      for (const t of txns) {
        if (t.type === 'buy_in' || t.type === 'top_up') totalCapital += t.amount;
        if (t.type === 'withdrawal' && t.status === 'transferred') totalCapital -= t.amount;
      }
      if (txns.length === 0) totalCapital = inv.capitalAmount ?? 0;
      const onHold = txns
        .filter(t => t.type === 'withdrawal' && ['pending', 'approved'].includes(t.status))
        .reduce((s, t) => s + t.amount, 0);
      const available = totalCapital - deployed - onHold;
      const realizedProfit = realized.map(getCarData).reduce((s, d) => s + d.myShare, 0);
      return { inv, myCars, active, realized, deployed, available, realizedProfit, totalCapital, buyIn, onHold, txns };
    });
  }, [investors, cars, repairs, customers, investorTransactions]);

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
      if (form.capitalAmount > 0) {
        await addInvestorTransaction({
          id: generateId(),
          investorId: newUser.id,
          type: 'buy_in',
          amount: form.capitalAmount,
          status: 'completed',
          createdAt: new Date().toISOString(),
        });
      }
      setForm(emptyInvestorForm);
      setShowAdd(false);
    } catch (e: any) {
      setSaveError(e.message ?? 'Failed to create account. Check Supabase permissions.');
    } finally {
      setSaving(false);
    }
  };

  const handleTopUp = async (invId: string) => {
    const amt = Number(topUpAmount);
    if (!amt || amt <= 0) return;
    setSaving(true);
    try {
      await addInvestorTransaction({
        id: generateId(),
        investorId: invId,
        type: 'top_up',
        amount: amt,
        status: 'completed',
        createdAt: new Date(topUpDate + 'T00:00:00').toISOString(),
      });
      await updateUser(invId, { capitalAmount: (investors.find(i => i.id === invId)?.capitalAmount ?? 0) + amt });
      setShowTopUp(null);
      setTopUpAmount('');
      setTopUpDate(new Date().toISOString().slice(0, 10));
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApproveWithdrawal = async (txnId: string, months: number) => {
    const now = new Date();
    const dueDate = new Date(now);
    dueDate.setMonth(dueDate.getMonth() + months);
    await updateInvestorTransaction(txnId, {
      status: 'approved',
      approvedAt: now.toISOString(),
      approvedBy: currentUser?.id,
      waitingMonths: months,
      dueDate: dueDate.toISOString(),
    });
    setApprovalModal(null);
  };

  const handleRejectWithdrawal = async (txnId: string) => {
    await updateInvestorTransaction(txnId, {
      status: 'rejected',
      rejectedBy: currentUser?.id,
      rejectedAt: new Date().toISOString(),
    });
  };

  const handleMarkTransferred = async (txn: InvestorTransaction) => {
    await updateInvestorTransaction(txn.id, { status: 'transferred' });
    await updateUser(txn.investorId, {
      capitalAmount: Math.max(0, (investors.find(i => i.id === txn.investorId)?.capitalAmount ?? 0) - txn.amount),
    });
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
              <input className="input w-full px-3 py-2 rounded-lg text-sm" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="investor_username" autoCapitalize="none" autoComplete="username" />
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
                  autoComplete="new-password"
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
                      {car.photo ? <img src={thumbUrl(car.photo, 300, 72)!} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={13} className="text-gray-600" />}
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
      {investorStats.map(({ inv, myCars, active, realized, deployed, available, realizedProfit, totalCapital, buyIn, onHold, txns }) => {

        const isExpanded = expanded === inv.id;
        const pendingWithdrawal = txns.find(t => t.type === 'withdrawal' && ['pending', 'approved'].includes(t.status));
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
                  <p className="text-white font-semibold text-sm">{formatRM(totalCapital)}</p>
                </div>
                <div>
                  <p className="text-gray-600 text-[10px] uppercase tracking-wide">Deployed</p>
                  <p className="text-amber-400 font-semibold text-sm">{formatRM(deployed)}</p>
                </div>
                <div>
                  <p className="text-gray-600 text-[10px] uppercase tracking-wide">Available</p>
                  <p className={`font-semibold text-sm ${available >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatRM(available)}</p>
                </div>
                {onHold > 0 && (
                  <div>
                    <p className="text-gray-600 text-[10px] uppercase tracking-wide">On Hold</p>
                    <p className="text-orange-400 font-semibold text-sm">{formatRM(onHold)}</p>
                  </div>
                )}
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
                {/* ── Wallet Card ── */}
                <div className="bg-gradient-to-br from-obsidian-800/80 to-obsidian-900/60 border border-gold-500/20 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Wallet size={15} className="text-gold-400" />
                      <span className="text-gold-300 text-xs font-semibold uppercase tracking-wider">Wallet</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setShowTopUp(inv.id); setTopUpAmount(''); setTopUpDate(new Date().toISOString().slice(0, 10)); }}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors"
                      >
                        <ArrowDownCircle size={12} /> Top Up
                      </button>
                    </div>
                  </div>

                  {/* Wallet stats grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-obsidian-800/60 rounded-lg p-2.5">
                      <p className="text-gray-600 text-[10px] uppercase tracking-wide">Total Capital</p>
                      <p className="text-white font-bold text-sm mt-0.5">{formatRM(totalCapital)}</p>
                      <p className="text-gray-600 text-[9px] mt-0.5">Buy-in: {formatRM(buyIn)}</p>
                    </div>
                    <div className="bg-obsidian-800/60 rounded-lg p-2.5">
                      <p className="text-amber-400/80 text-[10px] uppercase tracking-wide">Deployed</p>
                      <p className="text-amber-400 font-bold text-sm mt-0.5">{formatRM(deployed)}</p>
                      <p className="text-gray-600 text-[9px] mt-0.5">{active.length} active car{active.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="bg-obsidian-800/60 rounded-lg p-2.5">
                      <p className={`text-[10px] uppercase tracking-wide ${available >= 0 ? 'text-green-400/80' : 'text-red-400/80'}`}>Available</p>
                      <p className={`font-bold text-sm mt-0.5 ${available >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatRM(available)}</p>
                      {onHold > 0 && <p className="text-orange-400 text-[9px] mt-0.5">On hold: {formatRM(onHold)}</p>}
                    </div>
                    <div className="bg-obsidian-800/60 rounded-lg p-2.5">
                      <p className="text-gray-500 text-[10px] uppercase tracking-wide">Realized P&amp;L</p>
                      <p className={`font-bold text-sm mt-0.5 ${realizedProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatRM(realizedProfit)}</p>
                      <p className="text-gray-600 text-[9px] mt-0.5">{realized.length} sold</p>
                    </div>
                  </div>
                </div>

                {/* Top-up form */}
                {showTopUp === inv.id && (
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 space-y-3">
                    <p className="text-emerald-400 text-xs font-semibold">Top Up Capital</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-gray-400 text-[10px] block mb-1">Amount (RM)</label>
                        <input type="number" className="input w-full px-3 py-2 rounded-lg text-sm" value={topUpAmount} onChange={e => setTopUpAmount(e.target.value)} placeholder="e.g. 150000" />
                      </div>
                      <div>
                        <label className="text-gray-400 text-[10px] block mb-1">Date</label>
                        <input type="date" className="input w-full px-3 py-2 rounded-lg text-sm" value={topUpDate} onChange={e => setTopUpDate(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowTopUp(null)} className="px-3 py-1.5 text-xs text-gray-400 border border-obsidian-400/60 rounded-lg">Cancel</button>
                      <button onClick={() => handleTopUp(inv.id)} disabled={saving || !topUpAmount || Number(topUpAmount) <= 0} className="px-3 py-1.5 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg disabled:opacity-40">
                        {saving ? 'Saving...' : 'Confirm Top Up'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Pending withdrawal action */}
                {pendingWithdrawal && (
                  <div className={`border rounded-xl p-4 space-y-3 ${
                    pendingWithdrawal.status === 'pending'
                      ? 'bg-orange-500/5 border-orange-500/20'
                      : 'bg-blue-500/5 border-blue-500/20'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock size={14} className={pendingWithdrawal.status === 'pending' ? 'text-orange-400' : 'text-blue-400'} />
                        <span className={`text-xs font-semibold ${pendingWithdrawal.status === 'pending' ? 'text-orange-400' : 'text-blue-400'}`}>
                          {pendingWithdrawal.status === 'pending' ? 'Withdrawal Request' : 'Withdrawal Approved — Waiting'}
                        </span>
                      </div>
                      <span className="text-white font-bold text-sm">{formatRM(pendingWithdrawal.amount)}</span>
                    </div>
                    {pendingWithdrawal.status === 'pending' && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-gray-400 text-xs">Submitted {new Date(pendingWithdrawal.createdAt).toLocaleDateString()}</span>
                        <div className="flex-1" />
                        <button
                          onClick={() => setApprovalModal({ txn: pendingWithdrawal, months: 3 })}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 transition-colors"
                        >
                          <Check size={12} /> Approve
                        </button>
                        <button
                          onClick={() => handleRejectWithdrawal(pendingWithdrawal.id)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors"
                        >
                          <XCircle size={12} /> Reject
                        </button>
                      </div>
                    )}
                    {pendingWithdrawal.status === 'approved' && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-gray-400 text-xs space-y-0.5">
                          <p>Approved {pendingWithdrawal.approvedAt ? new Date(pendingWithdrawal.approvedAt).toLocaleDateString() : ''} · {pendingWithdrawal.waitingMonths} months</p>
                          <p>Due: <span className="text-white font-medium">{pendingWithdrawal.dueDate ? new Date(pendingWithdrawal.dueDate).toLocaleDateString() : '—'}</span></p>
                        </div>
                        <div className="flex-1" />
                        <button
                          onClick={() => handleMarkTransferred(pendingWithdrawal)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 transition-colors"
                        >
                          <Send size={12} /> Mark Transferred
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Transaction history */}
                {txns.length > 0 && (
                  <div>
                    <p className="text-gray-500 text-xs font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      <Wallet size={11} /> Transaction History
                    </p>
                    <div className="bg-obsidian-800/60 border border-obsidian-400/40 rounded-xl divide-y divide-obsidian-400/30">
                      {[...txns].reverse().map(t => (
                        <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                            t.type === 'buy_in' ? 'bg-gold-500/20' :
                            t.type === 'top_up' ? 'bg-emerald-500/20' :
                            'bg-red-500/20'
                          }`}>
                            {t.type === 'buy_in' && <Wallet size={13} className="text-gold-400" />}
                            {t.type === 'top_up' && <ArrowDownCircle size={13} className="text-emerald-400" />}
                            {t.type === 'withdrawal' && <ArrowUpCircle size={13} className="text-red-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium">
                              {t.type === 'buy_in' ? 'Buy-in' : t.type === 'top_up' ? 'Top Up' : 'Withdrawal'}
                            </p>
                            <p className="text-gray-600 text-[10px]">
                              {new Date(t.createdAt).toLocaleDateString()}
                              {t.type === 'withdrawal' && t.status !== 'completed' && (
                                <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                                  t.status === 'pending' ? 'bg-orange-500/20 text-orange-400' :
                                  t.status === 'approved' ? 'bg-blue-500/20 text-blue-400' :
                                  t.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                                  'bg-emerald-500/20 text-emerald-400'
                                }`}>
                                  {t.status === 'transferred' ? 'Transferred' : t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                                </span>
                              )}
                            </p>
                          </div>
                          <p className={`text-sm font-semibold shrink-0 ${
                            t.type === 'withdrawal' ? 'text-red-400' : 'text-emerald-400'
                          }`}>
                            {t.type === 'withdrawal' ? '-' : '+'}{formatRM(t.amount)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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

                {/* Delete account */}
                <div className="flex items-center gap-3">
                  {confirmDelete === inv.id ? (
                    <div className="flex items-center gap-2">
                      <p className="text-red-400 text-xs">
                        {myCars.length > 0
                          ? `This investor has ${myCars.length} car(s). Delete anyway?`
                          : 'Delete this investor account?'}
                      </p>
                      <button
                        onClick={async () => { await deleteUser(inv.id); setConfirmDelete(null); setExpanded(null); }}
                        className="px-3 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/40 rounded-lg hover:bg-red-500/30 transition-colors"
                      >Confirm Delete</button>
                      <button onClick={() => setConfirmDelete(null)} className="px-3 py-1 text-xs text-gray-400 border border-obsidian-400/60 rounded-lg">Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(inv.id)}
                      className="flex items-center gap-1.5 text-gray-600 text-xs hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={12} /> Delete Account
                    </button>
                  )}
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
                            {car.photo ? <img src={thumbUrl(car.photo, 300, 72)!} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={13} className="text-gray-600" />}
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
                            {car.photo ? <img src={thumbUrl(car.photo, 300, 72)!} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={13} className="text-gray-600" />}
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
                                  {car.photo ? <img src={thumbUrl(car.photo, 300, 72)!} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={13} className="text-gray-600" />}
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
                                  {car.photo ? <img src={thumbUrl(car.photo, 300, 72)!} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={13} className="text-gray-600" />}
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

      {/* Approval modal */}
      {approvalModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setApprovalModal(null)}>
          <div className="bg-obsidian-800 border border-obsidian-400/60 rounded-xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-semibold text-sm">Approve Withdrawal</h3>
            <p className="text-gray-400 text-xs">
              {investors.find(i => i.id === approvalModal.txn.investorId)?.name} wants to withdraw <span className="text-white font-medium">{formatRM(approvalModal.txn.amount)}</span>
            </p>
            <div>
              <label className="text-gray-400 text-[10px] block mb-1.5">Waiting Period</label>
              <div className="flex gap-2">
                {[3, 6].map(m => (
                  <button
                    key={m}
                    onClick={() => setApprovalModal({ ...approvalModal, months: m })}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                      approvalModal.months === m
                        ? 'bg-gold-500/20 text-gold-300 border-gold-500/30'
                        : 'text-gray-400 border-obsidian-400/40 hover:text-white'
                    }`}
                  >
                    {m} Months
                  </button>
                ))}
              </div>
            </div>
            <p className="text-gray-500 text-[10px]">
              Due date: {(() => {
                const d = new Date();
                d.setMonth(d.getMonth() + approvalModal.months);
                return d.toLocaleDateString();
              })()}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setApprovalModal(null)} className="px-4 py-2 text-sm text-gray-400 border border-obsidian-400/60 rounded-lg">Cancel</button>
              <button
                onClick={() => handleApproveWithdrawal(approvalModal.txn.id, approvalModal.months)}
                className="px-4 py-2 text-sm btn-gold rounded-lg"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
