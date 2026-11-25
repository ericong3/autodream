// Accounting (Director only): five screens in plain words. They read the books
// and show them; only the folded repair tools and the existing pay, record and
// void actions change anything.
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import Payments from './Payments';
import { companyBankPaymentsEnabled } from '../lib/companyBankPayments';
import { missingDocuments, privateCompanyEvidence } from '../lib/companyEvidence';
import { useInvestorQuery } from '../lib/investorFinance';
import { docCoverage, docState } from '../lib/billsBoard';
import { accountTotals, ownOwe } from '../lib/booksView';
import { useBankBook } from '../lib/useBankBook';
import type { JournalEntry, Payment } from '../types';
import AccountingThisMonth, { type BankCheckSummary } from '../components/AccountingThisMonth';
import AccountingBank from '../components/AccountingBank';
import AccountingOwnOwe from '../components/AccountingOwnOwe';
import AccountingEntries, { type EntryProblem } from '../components/AccountingEntries';
import AccountingRepairTools from '../components/AccountingRepairTools';

type Tab = 'overview' | 'payments' | 'banks' | 'balance_sheet' | 'ledger';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'This month' },
  { key: 'payments', label: 'Bills and money due' },
  ...(companyBankPaymentsEnabled ? [{ key: 'banks' as const, label: 'Bank' }] : []),
  { key: 'balance_sheet', label: 'What we own and owe' },
  { key: 'ledger', label: 'Every entry' },
];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function Finance() {
  const currentUser = useStore((s) => s.currentUser);
  const cars = useStore((s) => s.cars);
  const payments = useStore((s) => s.payments);
  const ledgerAccounts = useStore((s) => s.ledgerAccounts);
  const journalEntries = useStore((s) => s.journalEntries);
  const voidJournalEntry = useStore((s) => s.voidJournalEntry);
  const isDirector = currentUser?.role === 'director';
  // The books (entries, accounts, bills) arrive in the second loading step.
  const booksReady = useStore((s) => s.phase2Loaded);
  const loadingBooks = <p className="text-[#ABA597] text-sm py-10 text-center">Loading the books…</p>;

  // The screen is in the link (?tab=…), so Back and shared links work.
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = asked && TABS.some((t) => t.key === asked) ? asked : 'overview';
  const [paymentsStart, setPaymentsStart] = useState<'documents' | 'deletes' | undefined>();
  const [problem, setProblem] = useState<EntryProblem>('');
  const go = (next: Tab, opts: { start?: 'documents' | 'deletes'; problem?: EntryProblem } = {}) => {
    setPaymentsStart(opts.start);
    if (opts.problem !== undefined) setProblem(opts.problem);
    setParams((previous) => { const p = new URLSearchParams(previous); if (next === 'overview') p.delete('tab'); else p.set('tab', next); return p; });
    window.scrollTo({ top: 0 });
  };

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth()); // 0-indexed
  const prevMonth = () => { if (selectedMonth === 0) { setSelectedMonth(11); setSelectedYear((y) => y - 1); } else setSelectedMonth((m) => m - 1); };
  const nextMonth = () => { if (selectedMonth === 11) { setSelectedMonth(0); setSelectedYear((y) => y + 1); } else setSelectedMonth((m) => m + 1); };
  const monthKey = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;

  // What we own and owe, from every entry that still counts.
  const view = useMemo(() => ownOwe(ledgerAccounts, accountTotals(journalEntries)), [ledgerAccounts, journalEntries]);

  // Bank statement lines next to the books (the same matching as Bank check).
  const book = useBankBook(isDirector && companyBankPaymentsEnabled);
  const bankSummary = useMemo<BankCheckSummary>(() => {
    const s = { loading: book.loading, error: book.error, total: 0, done: 0, answered: 0, needs: 0 };
    for (const b of book.banks) for (const l of b.lines) {
      if (!l.date.startsWith(monthKey)) continue;
      const st = b.states.get(l.id);
      s.total += 1;
      if (st === 'done') s.done += 1; else if (st === 'answered') s.answered += 1; else s.needs += 1;
    }
    return s;
  }, [book, monthKey]);

  // Which bills are missing an invoice or a slip.
  const evidenceActor = privateCompanyEvidence && currentUser && (isDirector || currentUser.role === 'admin') ? currentUser.id : null;
  const missingQ = useInvestorQuery(evidenceActor ? `accounting-missing:${evidenceActor}` : null, missingDocuments);
  const coverage = useMemo(() => (missingQ.data ? docCoverage(missingQ.data.items, missingQ.data.total) : null), [missingQ.data]);
  const docOf = useMemo(() => (coverage ? (p: Payment) => docState(coverage, p) : null), [coverage]);
  const deletes = payments.filter((p) => p.deleteRequestedBy).length;

  const onVoid = (e: JournalEntry) => {
    const reason = prompt('Reason for voiding this entry?');
    if (reason && currentUser) void voidJournalEntry(e.id, currentUser.id, reason);
  };

  return (
    <div className="space-y-7 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4 pt-1">
        <h1 className="font-display text-white text-3xl font-semibold tracking-wide">Accounting</h1>
        {tab === 'overview' && (
          <div className="flex items-center gap-1 border border-[#3D3420] rounded-[10px] p-1">
            <button type="button" aria-label="Previous month" onClick={prevMonth} className="w-11 h-10 flex items-center justify-center text-[#ABA597] hover:text-white"><ChevronLeft size={16} /></button>
            <span className="text-[15px] font-medium text-[#F3EEE2] px-2.5 min-w-[140px] text-center">{MONTH_NAMES[selectedMonth]} {selectedYear}</span>
            <button type="button" aria-label="Next month" onClick={nextMonth} className="w-11 h-10 flex items-center justify-center text-[#ABA597] hover:text-white"><ChevronRight size={16} /></button>
          </div>
        )}
      </header>

      <nav aria-label="Accounting sections" className="flex items-end gap-x-7 border-b border-[#2A2316] overflow-x-auto whitespace-nowrap">
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <button key={t.key} type="button" aria-current={on ? 'page' : undefined} onClick={() => go(t.key)}
              className={`py-3 -mb-px border-b-2 text-[15px] transition-colors ${on ? 'text-[#F7D96A] font-semibold border-[#EAB820]' : 'text-[#ABA597] border-transparent hover:text-white'}`}>
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'overview' && (
        <AccountingThisMonth
          year={selectedYear} month={selectedMonth}
          bank={bankSummary} gapCents={booksReady ? view.gapCents : null} missing={missingQ.data ? missingQ.data.total : null} deletes={booksReady ? deletes : null}
          onBank={() => go(companyBankPaymentsEnabled ? 'banks' : 'ledger')}
          onGap={() => (view.gapCents ? go('ledger', { problem: 'gap' }) : go('balance_sheet'))}
          onBills={() => go('payments', { start: 'documents' })}
          onDeletes={() => go('payments', { start: 'deletes' })}
        />
      )}

      {tab === 'payments' && <Payments key={paymentsStart ?? 'bills'} embedded start={paymentsStart} />}

      {tab === 'banks' && (isDirector
        ? <AccountingBank book={book} actorId={currentUser!.id} />
        : <p className="text-[#ABA597] text-sm">Only the Director can see the bank lines.</p>)}

      {tab === 'balance_sheet' && !booksReady && loadingBooks}
      {tab === 'balance_sheet' && booksReady && <AccountingOwnOwe view={view} onFindGap={() => go('ledger', { problem: 'gap' })} />}

      {tab === 'ledger' && !booksReady && loadingBooks}
      {tab === 'ledger' && booksReady && (
        <AccountingEntries
          entries={journalEntries} accounts={ledgerAccounts} payments={payments} cars={cars}
          docOf={docOf} entryLine={book.entryLine}
          problem={problem} onProblem={setProblem} onVoid={onVoid}
          tools={<AccountingRepairTools />}
        />
      )}
    </div>
  );
}
