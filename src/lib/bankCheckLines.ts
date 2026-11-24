// Reading the Bank check's statement lines. Shared by the Bank check page and
// the Payments screen (which shows which bills one bank payment covered).
import { financeFrom } from './privateFinance';
import { toCents, type BankCheckDetails, type BankCheckLine } from './bankCheckMatch';

export function rowToLine(r: Record<string, unknown>): BankCheckLine | null {
  const d = r.details && typeof r.details === 'object' ? (r.details as BankCheckDetails) : null;
  if (!d?.bankId) return null;
  return { id: String(r.id), date: String(r.txn_date).slice(0, 10), cents: toCents(Number(r.amount)) * (r.direction === 'debit' ? -1 : 1), text: String(r.description ?? ''), status: String(r.status), details: d };
}

export async function loadLines(): Promise<{ lines: BankCheckLine[]; setUp: boolean }> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < 20000; from += 500) {
    const { data, error } = await financeFrom('bank_transactions').select('*').order('created_at', { ascending: true }).order('id').range(from, from + 499);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < 500) break;
  }
  return { lines: rows.map(rowToLine).filter((l): l is BankCheckLine => !!l), setUp: rows.length === 0 || rows.some((r) => 'details' in r) };
}
