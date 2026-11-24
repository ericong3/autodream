// Accounting → Every entry → Repair tools: the accountant's tools, kept out of
// the way. These are the same tools the old General Ledger and Chart of
// Accounts tabs had, and they work the same way.
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { formatRM, generateId } from '../utils/format';
import type { LedgerAccountType } from '../types';
import { companyBankPaymentsEnabled } from '../lib/companyBankPayments';
import { collectMissingJournalEntries, findStaleLoanSaleEntries, buildCarSaleEntry } from '../utils/generateJournalEntries';
import Modal from './Modal';
import DeleteConfirmModal from './DeleteConfirmModal';

const ACCOUNT_TYPE_LABELS: Record<LedgerAccountType, string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity',
  revenue: 'Revenue', cogs: 'Cost of Goods Sold', expense: 'Expenses',
};
const ACCOUNT_TYPE_ORDER: LedgerAccountType[] = ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'];
const DEBIT_NORMAL: Record<LedgerAccountType, boolean> = { asset: true, expense: true, cogs: true, liability: false, equity: false, revenue: false };

export default function AccountingRepairTools() {
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const users = useStore((s) => s.users);
  const customers = useStore((s) => s.customers);
  const payments = useStore((s) => s.payments);
  const ledgerAccounts = useStore((s) => s.ledgerAccounts);
  const journalEntries = useStore((s) => s.journalEntries);
  const currentUser = useStore((s) => s.currentUser);
  const addLedgerAccount = useStore((s) => s.addLedgerAccount);
  const deleteLedgerAccount = useStore((s) => s.deleteLedgerAccount);
  const voidJournalEntry = useStore((s) => s.voidJournalEntry);
  const addJournalEntry = useStore((s) => s.addJournalEntry);
  const batchAddJournalEntries = useStore((s) => s.batchAddJournalEntries);

  const [open, setOpen] = useState<'' | 'loans' | 'trial' | 'accounts'>('');
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<number | null>(null);
  const [staleSelection, setStaleSelection] = useState<Record<string, string>>({}); // entryId -> customerId | 'manual'
  const [staleOverrides, setStaleOverrides] = useState<Record<string, { loanAmount: number; bookingFee: number }>>({});
  const [applyingStale, setApplyingStale] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: '', type: 'expense' as LedgerAccountType, investorTagged: false });
  const [accountDeleteTarget, setAccountDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // Loan-deal sales posted before the AR/refund split fix.
  const staleLoanSales = useMemo(() => findStaleLoanSaleEntries({ journalEntries, cars, customers }), [journalEntries, cars, customers]);

  const trialBalance = useMemo(() => {
    const totals: Record<string, { debit: number; credit: number }> = {};
    journalEntries.filter((e) => !e.voided).forEach((e) => e.lines.forEach((l) => {
      if (!totals[l.accountId]) totals[l.accountId] = { debit: 0, credit: 0 };
      totals[l.accountId].debit += l.debit;
      totals[l.accountId].credit += l.credit;
    }));
    return totals;
  }, [journalEntries]);
  const totalDebits = Object.values(trialBalance).reduce((s, t) => s + t.debit, 0);
  const totalCredits = Object.values(trialBalance).reduce((s, t) => s + t.credit, 0);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

  const row = 'flex flex-wrap items-center gap-x-6 gap-y-3 px-4 sm:px-5 py-3.5';
  const toolBtn = 'min-h-[44px] px-4 rounded-[10px] border border-[#6B3A2C] bg-transparent text-sm text-[#F3EEE2] hover:border-[#F08A5D] disabled:opacity-40';
  const flip = (k: typeof open) => setOpen(open === k ? '' : k);

  return (
    <div className="rounded-xl border border-[#6B3A2C] bg-[#1D1210] divide-y divide-[#3A2320]">
      <p className="px-4 sm:px-5 py-3 text-[13px] text-[#C9C2B3]">These change the books. Use them only with your accountant.</p>

      {/* Old loan sales to correct */}
      <div>
        <div className={row}>
          <span className="flex-[1_1_320px] flex flex-col gap-0.5">
            <span className="text-[15px] font-medium text-[#F3EEE2]">Old loan sales to correct</span>
            <span className="text-[13px] text-[#C9C2B3]">{staleLoanSales.length ? `${staleLoanSales.length} to review` : 'Nothing to correct'}</span>
          </span>
          {staleLoanSales.length > 0 && <button type="button" aria-expanded={open === 'loans'} onClick={() => flip('loans')} className={toolBtn}>{open === 'loans' ? 'Close' : 'Review'}</button>}
        </div>
        {open === 'loans' && staleLoanSales.length > 0 && (
          <div className="border-t border-[#3A2320]">
            <p className="px-5 pt-3 text-[11px] text-gray-500">
              These loan-deal sales were posted before the fix that splits the loan amount (Receivable) from cash already
              collected before delivery. Pick the correct work order per car (or type the numbers in), review the
              corrected split, then apply — the old entry gets voided (not deleted) and a corrected one is posted.
            </p>
            <div className="divide-y divide-obsidian-400/40">
              {staleLoanSales.map(({ entry, car, dealPrice, cost, candidates }) => {
                const selection = staleSelection[entry.id] ?? (candidates[0]?.customerId ?? 'manual');
                const selectedCandidate = candidates.find((c) => c.customerId === selection);
                const override = staleOverrides[entry.id];
                const loanAmount = override?.loanAmount ?? selectedCandidate?.loanAmount ?? 0;
                const bookingFee = override?.bookingFee ?? selectedCandidate?.bookingFee ?? 0;
                const refundOwed = Math.max(loanAmount - (dealPrice - bookingFee), 0);
                const bankAmount = bookingFee + Math.max((dealPrice - bookingFee) - loanAmount, 0);
                const carLabel = `${car.year} ${car.make} ${car.model}${car.carPlate ? ` (${car.carPlate})` : ''}`;
                return (
                  <div key={entry.id} className="px-5 py-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-white text-sm font-medium">{carLabel}</span>
                      <span className="text-xs text-gray-500">Old: Dr AR {formatRM(dealPrice)}</span>
                    </div>
                    {candidates.length > 0 && (
                      <div className="space-y-1.5">
                        {candidates.map((c) => (
                          <label key={c.customerId} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                            <input type="radio" checked={selection === c.customerId} onChange={() => setStaleSelection((s) => ({ ...s, [entry.id]: c.customerId }))} />
                            {c.customerName} — Loan {formatRM(c.loanAmount)}, Booking Fee {formatRM(c.bookingFee)}
                          </label>
                        ))}
                        <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                          <input type="radio" checked={selection === 'manual'} onChange={() => setStaleSelection((s) => ({ ...s, [entry.id]: 'manual' }))} />
                          None of these — enter manually
                        </label>
                      </div>
                    )}
                    {candidates.length === 0 && <p className="text-xs text-gray-500">No matching work order found for this car — enter the figures manually.</p>}
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="text-xs text-gray-500 flex items-center gap-1.5">
                        Loan amount
                        <input type="number" value={loanAmount || ''} onChange={(e) => setStaleOverrides((s) => ({ ...s, [entry.id]: { loanAmount: Number(e.target.value), bookingFee } }))}
                          className="w-28 px-2 py-1 rounded bg-obsidian-800 border border-white/[0.08] text-white text-xs" />
                      </label>
                      <label className="text-xs text-gray-500 flex items-center gap-1.5">
                        Booking fee
                        <input type="number" value={bookingFee || ''} onChange={(e) => setStaleOverrides((s) => ({ ...s, [entry.id]: { loanAmount, bookingFee: Number(e.target.value) } }))}
                          className="w-28 px-2 py-1 rounded bg-obsidian-800 border border-white/[0.08] text-white text-xs" />
                      </label>
                    </div>
                    <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-obsidian-400/30">
                      <div className="text-xs text-gray-400 space-x-3">
                        <span>New: Dr AR {formatRM(loanAmount)}</span>
                        <span>Dr Bank {formatRM(bankAmount)}</span>
                        {refundOwed > 0 && <span className="text-blue-400">Cr Refund Payable {formatRM(refundOwed)}</span>}
                      </div>
                      <button
                        disabled={applyingStale === entry.id}
                        onClick={async () => {
                          if (!currentUser) return;
                          setApplyingStale(entry.id);
                          try {
                            await voidJournalEntry(entry.id, currentUser.id, 'Corrected loan-deal AR/refund split');
                            await addJournalEntry(buildCarSaleEntry({ car, dealPrice, cost, isLoan: true, loanAmount, bookingFee, createdBy: currentUser.id }));
                          } finally {
                            setApplyingStale(null);
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-gold-gradient text-obsidian-950 text-xs font-bold shadow-gold-sm disabled:opacity-40"
                      >
                        {applyingStale === entry.id ? 'Applying...' : 'Apply Correction'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Backfill: catches up cars/commissions that existed before ledger posting did */}
      <div className={row}>
        <span className="flex-[1_1_320px] flex flex-col gap-0.5">
          <span className="text-[15px] font-medium text-[#F3EEE2]">Fill in missing history</span>
          <span className="text-[13px] text-[#C9C2B3]">Adds entries for old cars and commissions from before the books started. Changes many entries. Ask first.</span>
        </span>
        <button
          type="button"
          onClick={async () => {
            if (!currentUser) return;
            setBackfilling(true);
            try {
              const missing = collectMissingJournalEntries({ bankReceiptMode: companyBankPaymentsEnabled, cars, customers, repairs, payments, journalEntries, users, createdBy: currentUser.id });
              if (missing.length > 0) await batchAddJournalEntries(missing);
              setBackfillResult(missing.length);
            } finally {
              setBackfilling(false);
              setTimeout(() => setBackfillResult(null), 4000);
            }
          }}
          disabled={backfilling}
          className={toolBtn}
        >
          {backfilling ? '...' : backfillResult !== null ? `+${backfillResult} entries` : 'Fill in'}
        </button>
      </div>

      {/* Trial balance */}
      <div>
        <div className={row}>
          <span className="flex-[1_1_320px] flex flex-col gap-0.5">
            <span className="text-[15px] font-medium text-[#F3EEE2]">Trial balance</span>
            <span className={`text-[13px] ${isBalanced ? 'text-[#C9C2B3]' : 'text-[#F5A37E]'}`}>{isBalanced ? 'Debits equal credits' : `Out of balance by ${formatRM(Math.abs(totalDebits - totalCredits))}`}</span>
          </span>
          <button type="button" aria-expanded={open === 'trial'} onClick={() => flip('trial')} className={toolBtn}>{open === 'trial' ? 'Close' : 'Show'}</button>
        </div>
        {open === 'trial' && (
          <div className="overflow-x-auto border-t border-[#3A2320]">
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
              </tbody>
              <tfoot>
                <tr className="border-t border-obsidian-400/60 font-semibold">
                  <td className="px-5 py-2.5 text-gray-300">Total</td>
                  <td className="px-5 py-2.5 text-right text-white">{formatRM(totalDebits)}</td>
                  <td className="px-5 py-2.5 text-right text-white">{formatRM(totalCredits)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Account names (chart of accounts) */}
      <div>
        <div className={row}>
          <span className="flex-[1_1_320px] flex flex-col gap-0.5">
            <span className="text-[15px] font-medium text-[#F3EEE2]">Account names</span>
            <span className="text-[13px] text-[#C9C2B3]">{ledgerAccounts.length} accounts in the books</span>
          </span>
          <button type="button" aria-expanded={open === 'accounts'} onClick={() => flip('accounts')} className={toolBtn}>{open === 'accounts' ? 'Close' : 'Show'}</button>
        </div>
        {open === 'accounts' && (
          <div className="border-t border-[#3A2320] px-4 sm:px-5 py-4 space-y-4">
            <div className="flex justify-end">
              <button onClick={() => setShowAddAccount(true)} className="btn-gold px-4 py-2 rounded-xl text-sm flex items-center gap-2"><Plus size={14} /> Add Account</button>
            </div>
            {ACCOUNT_TYPE_ORDER.map((type) => {
              const accounts = ledgerAccounts.filter((a) => a.type === type);
              if (accounts.length === 0) return null;
              return (
                <div key={type} className="bg-card-gradient border border-obsidian-400/70 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-obsidian-400/60">
                    <span className="text-white font-medium text-sm">{ACCOUNT_TYPE_LABELS[type]}</span>
                    <span className="ml-2 text-xs text-gray-500">{accounts.length}</span>
                  </div>
                  <div className="divide-y divide-obsidian-400/40">
                    {accounts.map((a) => (
                      <div key={a.id} className="flex items-center justify-between px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-white text-sm">{a.name}</span>
                          {a.investorTagged && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/20">Investor</span>}
                        </div>
                        <button onClick={() => setAccountDeleteTarget({ id: a.id, name: a.name })} aria-label={`Delete account ${a.name}`} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
              {ACCOUNT_TYPE_ORDER.map((type) => <option key={type} value={type}>{ACCOUNT_TYPE_LABELS[type]}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={accountForm.investorTagged} onChange={(e) => setAccountForm({ ...accountForm, investorTagged: e.target.checked })} className="accent-gold-500" />
            Tied to investor funds
          </label>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowAddAccount(false)} className="flex-1 btn-ghost py-2 rounded-xl text-sm">Cancel</button>
            <button
              disabled={!accountForm.name.trim()}
              onClick={async () => {
                if (!accountForm.name.trim()) return;
                await addLedgerAccount({ id: generateId(), name: accountForm.name.trim(), type: accountForm.type, investorTagged: accountForm.investorTagged || undefined });
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
  );
}
