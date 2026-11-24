// The bank statement lines next to the books, for the Accounting screens. Uses the
// same matching as the Bank check page, so both always agree on what is done.
// Read only: nothing here saves.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { loadLines } from './bankCheckLines';
import { bankMoves, lineState, matchLines, type BankCheckLine, type BankMove, type LineState } from './bankCheckMatch';
import { companyBankRequest, paymentBalanceCents } from './companyBankPayments';
import type { Bank } from './investorFinance';

export type BankRow = Bank & { balanceCents?: number };
export type OneBank = {
  bank: BankRow;
  accountId: string;                // the bank's account in the books ('' if none)
  lines: BankCheckLine[];           // its statement lines
  moves: BankMove[];                // its money moves in the books
  matched: Map<string, string[]>;   // statement line → books entries
  states: Map<string, LineState>;
};
export type BankBook = {
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  banks: OneBank[];
  entryLine: Map<string, string>;   // books entry → the statement line it was found on
};

export function useBankBook(enabled: boolean): BankBook {
  const payments = useStore((s) => s.payments);
  const journalEntries = useStore((s) => s.journalEntries);
  const ledgerAccounts = useStore((s) => s.ledgerAccounts);
  const [lines, setLines] = useState<BankCheckLine[]>([]);
  const [bankList, setBankList] = useState<BankRow[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [loaded, list] = await Promise.all([loadLines(), companyBankRequest<{ banks: BankRow[] }>('banks')]);
      setLines(loaded.lines); setBankList(list.banks ?? []);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not load the bank lines.');
    } finally { setLoading(false); }
  }, [enabled]);
  useEffect(() => { void reload(); }, [reload]);

  const banks = useMemo<OneBank[]>(() => {
    const bankAccounts = ledgerAccounts.filter((a) => a.id.startsWith('acct-bank-uc-'));
    const balances = new Map(payments.map((p) => [p.id, paymentBalanceCents(p)]));
    return bankList.map((bank) => {
      const accountId = (bankAccounts.find((a) => a.name === bank.name) ?? (bankList.length === 1 && bankAccounts.length === 1 ? bankAccounts[0] : undefined))?.id ?? '';
      const moves = accountId ? bankMoves(journalEntries, accountId) : [];
      const mine = lines.filter((l) => l.details.bankId === bank.id);
      const matched = matchLines(mine, moves);
      const states = new Map(mine.map((l) => [l.id, lineState(l, matched.has(l.id), (id) => balances.get(id) ?? 0)] as const));
      return { bank, accountId, lines: mine, moves, matched, states };
    });
  }, [bankList, lines, ledgerAccounts, journalEntries, payments]);

  const entryLine = useMemo(() => {
    const out = new Map<string, string>();
    for (const b of banks) for (const [lineId, ids] of b.matched) for (const id of ids) if (!out.has(id)) out.set(id, lineId);
    return out;
  }, [banks]);

  return { loading, error, reload, banks, entryLine };
}
