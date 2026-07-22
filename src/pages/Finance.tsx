import { useMemo, useState } from 'react';
import { DollarSign, TrendingUp, Car, Wrench, Award, ChevronLeft, ChevronRight, Wallet, BookOpen, Plus, Trash2, ScrollText, Ban, Scale } from 'lucide-react';
import { useStore } from '../store';
import StatCard from '../components/StatCard';
import { formatRM, shortName, generateId } from '../utils/format';
import { LedgerAccountType } from '../types';
import { collectMissingJournalEntries } from '../utils/generateJournalEntries';
import Modal from '../components/Modal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import Payments from './Payments';

const ACCOUNT_TYPE_LABELS: Record<LedgerAccountType, string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity',
  revenue: 'Revenue', cogs: 'Cost of Goods Sold', expense: 'Expenses',
};
const ACCOUNT_TYPE_ORDER: LedgerAccountType[] = ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'];
// Which side an increase normally posts to — assets/expenses/cogs are debit-normal,
// liabilities/equity/revenue are credit-normal. Just for displaying a sane balance sign.
const DEBIT_NORMAL: Record<LedgerAccountType, boolean> = {
  asset: true, expense: true, cogs: true, liability: false, equity: false, revenue: false,
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function Finance() {
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const users = useStore((s) => s.users);
  const customers = useStore((s) => s.customers);
  const ledgerAccounts = useStore((s) => s.ledgerAccounts);
  const addLedgerAccount = useStore((s) => s.addLedgerAccount);
  const deleteLedgerAccount = useStore((s) => s.deleteLedgerAccount);
  const journalEntries = useStore((s) => s.journalEntries);
  const currentUser = useStore((s) => s.currentUser);
  const voidJournalEntry = useStore((s) => s.voidJournalEntry);
  const payments = useStore((s) => s.payments);
  const batchAddJournalEntries = useStore((s) => s.batchAddJournalEntries);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<number | null>(null);

  const [financeTab, setFinanceTab] = useState<'overview' | 'payments' | 'accounts' | 'ledger' | 'balance_sheet'>('overview');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: '', type: 'expense' as LedgerAccountType, investorTagged: false });
  const [accountDeleteTarget, setAccountDeleteTarget] = useState<{ id: string; name: string } | null>(null);

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

  const calcCommission = (car: typeof cars[0]): number => {
    if (car.outgoingConsignment || car.isStaffSale) return 0;
    const wo = getWorkOrder(car);
    const dealPrice = (wo?.sellingPrice ?? car.finalDeal?.dealPrice ?? car.sellingPrice) - (wo?.discount ?? 0);
    if (car.consignment || (car.priceFloor != null && dealPrice < car.priceFloor)) return 1000;
    return 1500;
  };

  // Per-car data (compute first so totals derive from it)
  const carData = soldCarsThisMonth.map((car) => {
    const wo = getWorkOrder(car);
    const repairCosts = getRepairCosts(car.id);
    const miscCosts = (car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0);
    const additionalTotal = wo?.additionalItems?.reduce((s, i) => s + i.amount, 0) ?? 0;
    const dealPrice = (wo?.sellingPrice ?? car.finalDeal?.dealPrice ?? car.sellingPrice) - (wo?.discount ?? 0);
    const commission = calcCommission(car);
    const profit = car.isStaffSale ? 0 : dealPrice - car.purchasePrice - repairCosts - miscCosts - additionalTotal - commission;
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
      const commission = soldBySp.reduce((sum, car) => sum + calcCommission(car), 0);
      return { sp, soldCount: soldBySp.length, commission };
    })
    .filter((x) => x.soldCount > 0);

  // Done repairs for cars sold this month (for workshop expenses table)
  const workshopRepairs = repairs.filter(
    (r) => r.status === 'done' && soldCarsThisMonth.some((c) => c.id === r.carId)
  );

  const accountById = useMemo(() => {
    const m: Record<string, typeof ledgerAccounts[number]> = {};
    ledgerAccounts.forEach((a) => { m[a.id] = a; });
    return m;
  }, [ledgerAccounts]);

  const activeEntries = useMemo(() => journalEntries.filter((e) => !e.voided), [journalEntries]);

  const trialBalance = useMemo(() => {
    const totals: Record<string, { debit: number; credit: number }> = {};
    activeEntries.forEach((e) => {
      e.lines.forEach((l) => {
        if (!totals[l.accountId]) totals[l.accountId] = { debit: 0, credit: 0 };
        totals[l.accountId].debit += l.debit;
        totals[l.accountId].credit += l.credit;
      });
    });
    return totals;
  }, [activeEntries]);

  const totalDebits = Object.values(trialBalance).reduce((s, t) => s + t.debit, 0);
  const totalCredits = Object.values(trialBalance).reduce((s, t) => s + t.credit, 0);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

  // Balance Sheet — no formal period-close exists yet, so current-period net
  // income (revenue - COGS - expenses) is shown alongside posted Equity,
  // same way an interim/management balance sheet works before year-end close.
  const netOf = (type: LedgerAccountType) =>
    ledgerAccounts.filter((a) => a.type === type).reduce((sum, a) => {
      const t = trialBalance[a.id];
      if (!t) return sum;
      return sum + (DEBIT_NORMAL[type] ? t.debit - t.credit : t.credit - t.debit);
    }, 0);

  const totalAssets = netOf('asset');
  const totalLiabilities = netOf('liability');
  const totalEquityPosted = netOf('equity');
  const netIncome = netOf('revenue') - netOf('cogs') - netOf('expense');
  const totalEquity = totalEquityPosted + netIncome;
  const isBalanceSheetBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 rounded-xl bg-obsidian-800/60 border border-white/[0.06] p-1">
        <button
          onClick={() => setFinanceTab('overview')}
          className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${financeTab === 'overview' ? 'bg-gold-gradient text-obsidian-950 font-bold shadow-gold-sm' : 'text-gray-400 hover:text-white'}`}
        >
          <TrendingUp size={12} />
          Overview
        </button>
        <button
          onClick={() => setFinanceTab('payments')}
          className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${financeTab === 'payments' ? 'bg-gold-gradient text-obsidian-950 font-bold shadow-gold-sm' : 'text-gray-400 hover:text-white'}`}
        >
          <Wallet size={12} />
          Payments
        </button>
        <button
          onClick={() => setFinanceTab('accounts')}
          className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${financeTab === 'accounts' ? 'bg-gold-gradient text-obsidian-950 font-bold shadow-gold-sm' : 'text-gray-400 hover:text-white'}`}
        >
          <BookOpen size={12} />
          Chart of Accounts
        </button>
        <button
          onClick={() => setFinanceTab('ledger')}
          className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${financeTab === 'ledger' ? 'bg-gold-gradient text-obsidian-950 font-bold shadow-gold-sm' : 'text-gray-400 hover:text-white'}`}
        >
          <ScrollText size={12} />
          General Ledger
        </button>
        <button
          onClick={() => setFinanceTab('balance_sheet')}
          className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${financeTab === 'balance_sheet' ? 'bg-gold-gradient text-obsidian-950 font-bold shadow-gold-sm' : 'text-gray-400 hover:text-white'}`}
        >
          <Scale size={12} />
          Balance Sheet
        </button>
      </div>

      {financeTab === 'payments' && <Payments embedded />}

      {financeTab === 'balance_sheet' && (
        <div className="space-y-4">
          <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-obsidian-400/60">
              <span className="text-white font-medium text-sm">Balance Sheet</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${isBalanceSheetBalanced ? 'text-green-400 border-green-500/30 bg-green-500/10' : 'text-red-400 border-red-500/30 bg-red-500/10'}`}>
                {isBalanceSheetBalanced ? 'Balanced' : 'Out of balance'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-obsidian-400/40">
              {/* Assets */}
              <div className="p-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Assets</p>
                <div className="space-y-2">
                  {ledgerAccounts.filter((a) => a.type === 'asset' && trialBalance[a.id]).map((a) => {
                    const t = trialBalance[a.id];
                    const net = t.debit - t.credit;
                    return (
                      <div key={a.id} className="flex justify-between text-sm">
                        <span className="text-gray-400">{a.name}</span>
                        <span className={net >= 0 ? 'text-white' : 'text-red-400'}>{formatRM(net)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-sm font-semibold pt-3 mt-3 border-t border-obsidian-400/40">
                  <span className="text-gray-300">Total Assets</span>
                  <span className="text-white">{formatRM(totalAssets)}</span>
                </div>
              </div>

              {/* Liabilities + Equity */}
              <div className="p-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Liabilities</p>
                <div className="space-y-2">
                  {ledgerAccounts.filter((a) => a.type === 'liability' && trialBalance[a.id]).map((a) => {
                    const t = trialBalance[a.id];
                    const net = t.credit - t.debit;
                    return (
                      <div key={a.id} className="flex justify-between text-sm">
                        <span className="text-gray-400">{a.name}</span>
                        <span className="text-white">{formatRM(net)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-sm pt-2 mt-2 border-t border-obsidian-400/30">
                  <span className="text-gray-300 font-medium">Total Liabilities</span>
                  <span className="text-white font-medium">{formatRM(totalLiabilities)}</span>
                </div>

                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-5">Equity</p>
                <div className="space-y-2">
                  {ledgerAccounts.filter((a) => a.type === 'equity' && trialBalance[a.id]).map((a) => {
                    const t = trialBalance[a.id];
                    const net = t.credit - t.debit;
                    return (
                      <div key={a.id} className="flex justify-between text-sm">
                        <span className="text-gray-400">{a.name}</span>
                        <span className="text-white">{formatRM(net)}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Current Period Net Income</span>
                    <span className={netIncome >= 0 ? 'text-green-400' : 'text-red-400'}>{formatRM(netIncome)}</span>
                  </div>
                </div>
                <div className="flex justify-between text-sm pt-2 mt-2 border-t border-obsidian-400/30">
                  <span className="text-gray-300 font-medium">Total Equity</span>
                  <span className="text-white font-medium">{formatRM(totalEquity)}</span>
                </div>

                <div className="flex justify-between text-sm font-semibold pt-3 mt-3 border-t border-obsidian-400/40">
                  <span className="text-gray-300">Total Liabilities + Equity</span>
                  <span className="text-white">{formatRM(totalLiabilities + totalEquity)}</span>
                </div>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-gray-600 px-1">
            Net income shown here isn't "closed" into retained earnings yet — this is how the balance sheet reads before a formal period close, same as any interim management report.
          </p>
        </div>
      )}

      {financeTab === 'ledger' && (
        <div className="space-y-4">
          {/* Backfill — catches up cars/commissions that existed before ledger posting did */}
          <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-obsidian-800/60 border border-white/[0.06]">
            <div>
              <p className="text-xs text-gray-300 font-medium">Backfill missing history</p>
              <p className="text-[11px] text-gray-600">Generates entries for existing cars/commissions that predate the ledger</p>
            </div>
            <button
              onClick={async () => {
                if (!currentUser) return;
                setBackfilling(true);
                try {
                  const missing = collectMissingJournalEntries({ cars, customers, repairs, payments, journalEntries, createdBy: currentUser.id });
                  if (missing.length > 0) await batchAddJournalEntries(missing);
                  setBackfillResult(missing.length);
                } finally {
                  setBackfilling(false);
                  setTimeout(() => setBackfillResult(null), 4000);
                }
              }}
              disabled={backfilling}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-obsidian-700/60 border border-white/[0.08] text-xs text-gray-300 hover:text-white hover:border-gold-500/30 transition-colors disabled:opacity-40"
            >
              {backfilling ? '...' : backfillResult !== null ? `+${backfillResult} entries` : 'Run Backfill'}
            </button>
          </div>

          {/* Trial balance */}
          <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-obsidian-400/60">
              <span className="text-white font-medium text-sm">Trial Balance</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${isBalanced ? 'text-green-400 border-green-500/30 bg-green-500/10' : 'text-red-400 border-red-500/30 bg-red-500/10'}`}>
                {isBalanced ? 'Balanced' : 'Out of balance'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-obsidian-400/40">
                    <th className="text-left px-5 py-2 font-medium">Account</th>
                    <th className="text-right px-5 py-2 font-medium">Debit</th>
                    <th className="text-right px-5 py-2 font-medium">Credit</th>
                    <th className="text-right px-5 py-2 font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerAccounts.filter((a) => trialBalance[a.id]).map((a) => {
                    const t = trialBalance[a.id];
                    const net = DEBIT_NORMAL[a.type] ? t.debit - t.credit : t.credit - t.debit;
                    return (
                      <tr key={a.id} className="border-b border-obsidian-400/20 last:border-0">
                        <td className="px-5 py-2 text-gray-300">{a.name}</td>
                        <td className="px-5 py-2 text-right text-gray-400">{t.debit > 0 ? formatRM(t.debit) : '—'}</td>
                        <td className="px-5 py-2 text-right text-gray-400">{t.credit > 0 ? formatRM(t.credit) : '—'}</td>
                        <td className={`px-5 py-2 text-right font-semibold ${net >= 0 ? 'text-white' : 'text-red-400'}`}>{formatRM(net)}</td>
                      </tr>
                    );
                  })}
                  {Object.keys(trialBalance).length === 0 && (
                    <tr><td colSpan={4} className="text-center py-8 text-gray-600 text-sm">No entries posted yet</td></tr>
                  )}
                </tbody>
                {Object.keys(trialBalance).length > 0 && (
                  <tfoot>
                    <tr className="border-t border-obsidian-400/60 font-semibold">
                      <td className="px-5 py-2.5 text-gray-300">Total</td>
                      <td className="px-5 py-2.5 text-right text-white">{formatRM(totalDebits)}</td>
                      <td className="px-5 py-2.5 text-right text-white">{formatRM(totalCredits)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Journal entries */}
          <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-obsidian-400/60">
              <span className="text-white font-medium text-sm">Journal Entries</span>
              <span className="ml-2 text-xs text-gray-500">{journalEntries.length}</span>
            </div>
            {journalEntries.length === 0 ? (
              <div className="text-center py-10 text-gray-600 text-sm">No entries yet</div>
            ) : (
              <div className="divide-y divide-obsidian-400/40">
                {journalEntries.map((e) => (
                  <div key={e.id} className={`px-5 py-3 ${e.voided ? 'opacity-50' : ''}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-xs">{e.date}</span>
                        <span className="text-white text-sm">{e.description}</span>
                        {e.voided && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">Voided</span>
                        )}
                      </div>
                      {!e.voided && (
                        <button
                          onClick={() => {
                            const reason = prompt('Reason for voiding this entry?');
                            if (reason && currentUser) voidJournalEntry(e.id, currentUser.id, reason);
                          }}
                          title="Void entry"
                          className="p-1 rounded text-gray-600 hover:text-red-400 transition-colors"
                        >
                          <Ban size={12} />
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 space-y-0.5">
                      {e.lines.map((l, i) => (
                        <div key={i} className="flex items-center justify-between text-xs pl-3">
                          <span className="text-gray-500">{accountById[l.accountId]?.name ?? l.accountId}</span>
                          <span className="text-gray-400">
                            {l.debit > 0 ? `Dr ${formatRM(l.debit)}` : `Cr ${formatRM(l.credit)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                    {e.voided && e.voidReason && (
                      <p className="text-[11px] text-gray-600 mt-1 pl-3">Void reason: {e.voidReason}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {financeTab === 'accounts' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowAddAccount(true)} className="btn-gold px-4 py-2 rounded-xl text-sm flex items-center gap-2">
              <Plus size={14} /> Add Account
            </button>
          </div>

          {ACCOUNT_TYPE_ORDER.map((type) => {
            const accounts = ledgerAccounts.filter((a) => a.type === type);
            if (accounts.length === 0) return null;
            return (
              <div key={type} className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card overflow-hidden">
                <div className="px-5 py-3 border-b border-obsidian-400/60">
                  <span className="text-white font-medium text-sm">{ACCOUNT_TYPE_LABELS[type]}</span>
                  <span className="ml-2 text-xs text-gray-500">{accounts.length}</span>
                </div>
                <div className="divide-y divide-obsidian-400/40">
                  {accounts.map((a) => (
                    <div key={a.id} className="flex items-center justify-between px-5 py-3 hover:bg-obsidian-700/30 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm">{a.name}</span>
                        {a.investorTagged && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/20">Investor</span>
                        )}
                      </div>
                      <button
                        onClick={() => setAccountDeleteTarget({ id: a.id, name: a.name })}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {ledgerAccounts.length === 0 && (
            <div className="text-center py-16 text-gray-600 text-sm">No accounts yet</div>
          )}

          <Modal isOpen={showAddAccount} onClose={() => setShowAddAccount(false)} title="Add Account" maxWidth="max-w-sm">
            <div className="space-y-3">
              <div>
                <label className="block text-gray-400 text-xs mb-1">Account Name *</label>
                <input
                  className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors"
                  placeholder="e.g. Vehicle Maintenance Expense"
                  value={accountForm.name}
                  onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Type</label>
                <select
                  className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors"
                  value={accountForm.type}
                  onChange={(e) => setAccountForm({ ...accountForm, type: e.target.value as LedgerAccountType })}
                >
                  {ACCOUNT_TYPE_ORDER.map((type) => (
                    <option key={type} value={type}>{ACCOUNT_TYPE_LABELS[type]}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={accountForm.investorTagged}
                  onChange={(e) => setAccountForm({ ...accountForm, investorTagged: e.target.checked })}
                  className="accent-gold-500"
                />
                Tied to investor funds
              </label>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowAddAccount(false)} className="flex-1 btn-ghost py-2 rounded-xl text-sm">Cancel</button>
                <button
                  disabled={!accountForm.name.trim()}
                  onClick={async () => {
                    if (!accountForm.name.trim()) return;
                    await addLedgerAccount({
                      id: generateId(),
                      name: accountForm.name.trim(),
                      type: accountForm.type,
                      investorTagged: accountForm.investorTagged || undefined,
                    });
                    setAccountForm({ name: '', type: 'expense', investorTagged: false });
                    setShowAddAccount(false);
                  }}
                  className="flex-1 btn-gold py-2 rounded-xl text-sm disabled:opacity-40"
                >Add Account</button>
              </div>
            </div>
          </Modal>

          <DeleteConfirmModal
            isOpen={!!accountDeleteTarget}
            onClose={() => setAccountDeleteTarget(null)}
            onConfirm={async () => { if (accountDeleteTarget) await deleteLedgerAccount(accountDeleteTarget.id); }}
            itemName={accountDeleteTarget?.name ?? ''}
          />
        </div>
      )}

      {financeTab === 'overview' && <div className="space-y-6">
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
      </div>}
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
