// Bank check (Finance, Director only): every line of the bank statement next to
// the app. Lines already in the books show as Done. For a transfer that paid many
// bills, the Director ticks the bills, adds any that were never keyed in, checks
// the list and records the payment. Other lines get a short answer that stays
// with the line, so whoever records it later knows what it was.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Upload } from 'lucide-react';
import { useStore } from '../store';
import { REPAIR_TYPES, type MiscCost, type Payment, type RepairJob } from '../types';
import { financeFrom } from '../lib/privateFinance';
import { companyBankRequest, paymentBalanceCents, type CompanyBankSave } from '../lib/companyBankPayments';
import { uploadCompanyEvidence } from '../lib/companyEvidence';
import { formatCents, parseRinggit, type Bank } from '../lib/investorFinance';
import { extractTransactionsFromStatement } from '../utils/bankReconciliation';
import { generateMiscCostPayment, generateRepairPayment } from '../utils/generatePayments';
import { buildCarCostRecognizedEntry } from '../utils/generateJournalEntries';
import { generateId } from '../utils/format';
import {
  appSaysAt, bankMoves, bankSaysAt, guessPayee, lineIds, lineState, matchLines, samePlate, toCents,
  type BankCheckDetails, type BankCheckLine, type BankMove, type LineState,
} from '../lib/bankCheckMatch';

type BankRow = Bank & { balanceCents?: number };
type Tab = 'needs' | 'answered' | 'done' | 'all';
const SALARY = new Set(['salary', 'allowance', 'campaign_bonus']);
const OUT_KINDS: [string, string][] = [['bills', 'Bills in To pay'], ['staff', 'Paid back to staff (they paid first)'], ['customer_refund', 'Paid back to a customer (overloan / refund)'], ['garage_back', 'Paid back to the garage'], ['office', 'Office cost'], ['car_purchase', 'Car purchase'], ['salary', 'Salary or director fee'], ['own_transfer', 'Moved to our other account'], ['other', 'Other']];
const IN_KINDS: [string, string][] = [['car_sale', 'Customer paid for a car'], ['booking', 'Booking fee'], ['garage', 'Garage job'], ['garage_money', 'Garage money (used our card machine)'], ['director_in', 'A director put money in'], ['own_transfer', 'From our other account'], ['other', 'Other']];
const OFFICE_TYPES = ['Rent', 'Electricity and water', 'Internet and phone', 'Office supplies', 'Refreshments', 'Uniforms', 'Other'];
const kindLabel = (k?: string) => [...OUT_KINDS, ...IN_KINDS].find((x) => x[0] === k)?.[1] ?? k ?? '';
const dayLabel = (d: string) => new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
const monthLabel = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
const signed = (cents: number) => (cents > 0 ? '+' : '') + formatCents(cents).replace('RM ', '');
const errorText = (e: unknown, fallback: string) => {
  if ((e as { code?: string } | null)?.code === 'RATE_LIMITED') return 'Too many requests from your account in the last few minutes. Wait about 10 minutes, then try again. Nothing you typed is lost.';
  return e instanceof Error && e.message ? e.message : fallback;
};
const card = 'bg-card-gradient border border-obsidian-400/70 rounded-xl';
const CHIP: Record<LineState, [string, string]> = {
  needs: ['Needs you', 'bg-amber-400/15 text-amber-200'],
  ready: ['Ready', 'bg-sky-400/15 text-sky-200'],
  answered: ['Answered', 'bg-violet-400/15 text-violet-200'],
  done: ['Done', 'bg-emerald-400/15 text-emerald-200'],
};

function rowToLine(r: Record<string, unknown>): BankCheckLine | null {
  const d = r.details && typeof r.details === 'object' ? (r.details as BankCheckDetails) : null;
  if (!d?.bankId) return null;
  return { id: String(r.id), date: String(r.txn_date).slice(0, 10), cents: toCents(Number(r.amount)) * (r.direction === 'debit' ? -1 : 1), text: String(r.description ?? ''), status: String(r.status), details: d };
}

async function loadLines(): Promise<{ lines: BankCheckLine[]; setUp: boolean }> {
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

async function saveLine(id: string, patch: { status?: string; details: BankCheckDetails }): Promise<BankCheckLine> {
  const { data, error } = await financeFrom('bank_transactions').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  const line = row ? rowToLine(row) : null;
  if (!line) throw new Error('This did not save. Reload the page and try again.');
  return line;
}

async function insertRows(table: string, rows: Record<string, unknown>[]) {
  const { error } = await financeFrom(table).insert(rows);
  if (error) throw new Error(error.message);
}

export default function BankCheck() {
  const currentUser = useStore((s) => s.currentUser);
  const payments = useStore((s) => s.payments);
  const journalEntries = useStore((s) => s.journalEntries);
  const ledgerAccounts = useStore((s) => s.ledgerAccounts);
  const actorId = currentUser?.id ?? '';
  const [lines, setLines] = useState<BankCheckLine[]>([]);
  const [setUp, setSetUp] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [bankId, setBankId] = useState('');
  const [month, setMonth] = useState('');
  const [tab, setTab] = useState<Tab>('needs');
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [loaded, bankList] = await Promise.all([loadLines(), companyBankRequest<{ banks: BankRow[] }>('banks')]);
      setLines(loaded.lines); setSetUp(loaded.setUp); setBanks(bankList.banks ?? []);
    } catch (e) { setError(errorText(e, 'Could not load the bank check.')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const bank = banks.find((b) => b.id === bankId) ?? banks[0];
  const bankAccounts = ledgerAccounts.filter((a) => a.id.startsWith('acct-bank-uc-'));
  const accountId = (bankAccounts.find((a) => a.name === bank?.name) ?? (banks.length === 1 && bankAccounts.length === 1 ? bankAccounts[0] : undefined))?.id ?? '';
  const moves = useMemo(() => (accountId ? bankMoves(journalEntries, accountId) : []), [journalEntries, accountId]);
  const bankLines = useMemo(() => lines.filter((l) => l.details.bankId === bank?.id), [lines, bank?.id]);
  const matched = useMemo(() => matchLines(bankLines, moves), [bankLines, moves]);
  const balances = useMemo(() => new Map(payments.map((p) => [p.id, paymentBalanceCents(p)])), [payments]);
  const states = useMemo(() => new Map(bankLines.map((l) => [l.id, lineState(l, matched.has(l.id), (id) => balances.get(id) ?? 0)])), [bankLines, matched, balances]);
  const months = useMemo(() => [...new Set(bankLines.map((l) => l.date.slice(0, 7)))].sort().reverse(), [bankLines]);
  const activeMonth = month && months.includes(month) ? month : months[0] ?? '';
  const monthLines = bankLines.filter((l) => l.date.startsWith(activeMonth)).sort((a, b) => a.date.localeCompare(b.date) || (a.details.seq ?? 0) - (b.details.seq ?? 0));
  const lastDate = monthLines[monthLines.length - 1]?.date;
  const bankSays = bank && lastDate ? bankSaysAt(bankLines, bank.openingCents, lastDate) : null;
  const appSays = bank && lastDate ? (Number.isSafeInteger(bank.balanceCents) ? appSaysAt(bank.balanceCents!, moves, lastDate) : moves.filter((m) => m.date <= lastDate).reduce((s, m) => s + m.cents, 0)) : null;
  const count = (t: Tab) => monthLines.filter((l) => inTab(t, states.get(l.id)!)).length;
  const shown = monthLines.filter((l) => inTab(tab, states.get(l.id)!));
  const open = openId ? bankLines.find((l) => l.id === openId) : undefined;

  const upload = async (file: File) => {
    if (!bank) return;
    const apiKey = localStorage.getItem('autodream_api_key') ?? '';
    if (!apiKey) { setError('To read a statement here, add your Claude key in AI Assistant first. You can also send the statement to Claude to load it.'); return; }
    setUploading(true); setError(''); setNotice('');
    try {
      const found = await extractTransactionsFromStatement(file, apiKey);
      const rows = found.map((t) => ({ date: t.date, cents: toCents(t.amount) * (t.direction === 'debit' ? -1 : 1), text: t.description }))
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isSafeInteger(r.cents) && r.cents !== 0);
      if (!rows.length) throw new Error('No lines were found in this statement.');
      const ids = lineIds(bank.id, rows), have = new Set(lines.map((l) => l.id));
      const fresh = rows.map((r, i) => ({ ...r, id: ids[i], seq: i + 1 })).filter((r) => !have.has(r.id));
      if (!fresh.length) { setNotice('Every line of this statement is already here.'); return; }
      const uploadId = generateId();
      await insertRows('bank_statement_uploads', [{ id: uploadId, file_path: 'not-stored', file_name: file.name.slice(0, 200), uploaded_by: actorId, status: 'ready' }]);
      for (let i = 0; i < fresh.length; i += 200) {
        await insertRows('bank_transactions', fresh.slice(i, i + 200).map((r) => ({
          id: r.id, upload_id: uploadId, txn_date: r.date, description: r.text.slice(0, 500), amount: Math.abs(r.cents) / 100,
          direction: r.cents < 0 ? 'debit' : 'credit', status: 'unmatched', details: { bankId: bank.id, seq: r.seq },
        })));
      }
      setNotice(`${fresh.length} new ${fresh.length === 1 ? 'line' : 'lines'} added.`);
      await reload();
    } catch (e) { setError(errorText(e, 'Could not read this statement.')); }
    finally { setUploading(false); }
  };

  if (currentUser?.role !== 'director') return <p className="text-gray-400 text-sm p-6">Only the Director can open the bank check.</p>;
  if (open && bank) return <LineDetail key={open.id} line={open} state={states.get(open.id)!} bank={bank} bankAccountId={accountId} actorId={actorId}
    moves={(matched.get(open.id) ?? []).map((id) => moves.find((m) => m.id === id)).filter((m): m is BankMove => !!m)}
    onBack={() => setOpenId(null)} onChange={(l) => setLines((all) => all.map((x) => (x.id === l.id ? l : x)))} />;

  return <div className="space-y-4 max-w-5xl mx-auto">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[11px] tracking-wider text-gray-500">DIRECTOR ONLY</p>
        <h2 className="font-display text-white font-bold text-xl">Bank check</h2>
        <p className="text-gray-400 text-sm">{bank ? `${bank.name}${activeMonth ? ` · ${monthLabel(activeMonth)} · ${monthLines.length} lines` : ''}` : 'Loading banks…'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {banks.length > 1 && <label className="text-xs text-gray-400 flex items-center gap-2">Bank
          <select className="input rounded-lg px-3 py-2 text-sm" value={bank?.id ?? ''} onChange={(e) => { setBankId(e.target.value); setOpenId(null); }}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        {months.length > 0 && <label className="text-xs text-gray-400 flex items-center gap-2">Month
          <select className="input rounded-lg px-3 py-2 text-sm" value={activeMonth} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>}
        <label className={`btn-ghost px-4 py-2 rounded-lg text-sm inline-flex items-center gap-2 ${uploading || !bank || !setUp ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}{uploading ? 'Reading…' : 'Upload statement'}
          <input type="file" accept="application/pdf,image/*" className="sr-only" disabled={uploading || !bank || !setUp} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
        </label>
      </div>
    </div>

    {!setUp && <p role="alert" className="text-sm text-amber-200 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">The bank check needs a one-time setup in the database before it can save. Ask Claude for the setup step.</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {notice && <p className="text-sm text-emerald-300">{notice}</p>}

    {loading && !lines.length ? <p className="text-gray-500 text-sm py-8 text-center"><Loader2 size={16} className="inline animate-spin mr-2" />Loading…</p> : !monthLines.length ? (
      <div className={`${card} p-6 text-center space-y-2`}>
        <p className="text-white font-semibold">No statement here yet</p>
        <p className="text-gray-400 text-sm">Upload this month's bank statement (PDF or a photo). Each line shows up here so you can see what is already in the app and what still needs you.</p>
      </div>
    ) : <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`${card} p-4`}><p className="text-xs text-gray-400">Bank says, {dayLabel(lastDate!)}</p><p className="text-white text-xl font-semibold mt-1">{formatCents(bankSays)}</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-gray-400">App says, {dayLabel(lastDate!)}</p><p className="text-white text-xl font-semibold mt-1">{formatCents(appSays)}</p></div>
        <div className="rounded-xl border border-gold-500/40 bg-gold-500/10 p-4"><p className="text-xs text-gray-400">Gap to explain</p><p className="text-gold-300 text-xl font-semibold mt-1">{bankSays === null || appSays === null ? '—' : formatCents(appSays - bankSays)}</p></div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Show lines">
        {([['needs', 'Needs you'], ['answered', 'Answered'], ['done', 'Done'], ['all', 'All']] as [Tab, string][]).map(([t, name]) =>
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}
            className={`min-h-[40px] px-4 rounded-full text-sm ${tab === t ? 'bg-gold-gradient text-obsidian-950 font-semibold' : 'border border-obsidian-400/70 text-gray-200'}`}>{name} · {count(t)}</button>)}
      </div>

      <div className={`${card} overflow-hidden divide-y divide-obsidian-400/50`}>
        {shown.length === 0 && <p className="text-gray-500 text-sm text-center py-8">Nothing here.</p>}
        {shown.map((l) => {
          const st = states.get(l.id)!;
          return <button key={l.id} type="button" onClick={() => setOpenId(l.id)} className="w-full text-left flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-white/5">
            <span className="flex-[999_1_320px] min-w-0">
              <span className="block text-xs text-gray-500">{dayLabel(l.date)} · {l.cents > 0 ? 'Money in' : 'Money out'}</span>
              <span className="block text-white text-sm font-semibold truncate">{l.details.who || l.text}</span>
              <span className="block text-gray-400 text-xs truncate">{hint(l, st)}</span>
            </span>
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${CHIP[st][1]}`}>{CHIP[st][0]}</span>
            <span className={`flex-[0_0_120px] text-right text-sm font-semibold ${l.cents > 0 ? 'text-emerald-300' : 'text-white'}`}>{signed(l.cents)}</span>
          </button>;
        })}
      </div>
      <p className="text-xs text-gray-500">Each month: upload the statement, answer what is left, and the gap goes to RM 0.00. Your answers stay with each line, and Claude can read them too.</p>
    </>}
  </div>;
}

function inTab(t: Tab, s: LineState) {
  return t === 'all' || (t === 'needs' ? s === 'needs' || s === 'ready' : s === t);
}

function hint(l: BankCheckLine, s: LineState) {
  const memo = l.details.memo ? `"${l.details.memo}" · ` : '';
  if (s === 'done') return memo + 'In the app';
  if (s === 'ready') return memo + `${l.details.billIds?.length ?? 0} bills add up exactly. Check them and record.`;
  if (s === 'answered') return memo + 'You said: ' + kindLabel(l.details.answer?.kind) + (l.details.answer?.type ? ` · ${l.details.answer.type}` : '');
  return memo + (l.cents > 0 ? 'What was this money?' : 'Tick the bills, or say what it was');
}

function LineDetail({ line, state, bank, bankAccountId, moves, actorId, onBack, onChange }: {
  line: BankCheckLine; state: LineState; bank: BankRow; bankAccountId: string; moves: BankMove[]; actorId: string;
  onBack: () => void; onChange: (l: BankCheckLine) => void;
}) {
  const out = line.cents < 0;
  const kinds = out ? OUT_KINDS : IN_KINDS;
  const [kind, setKind] = useState(line.details.answer?.kind ?? (out ? 'bills' : ''));
  const [marking, setMarking] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const markDone = async () => {
    setBusy(true); setError('');
    try { onChange(await saveLine(line.id, { status: 'matched', details: { ...line.details, done: { how: 'marked', at: new Date().toISOString(), by: actorId } } })); setMarking(false); }
    catch (e) { setError(errorText(e, 'Could not save.')); } finally { setBusy(false); }
  };
  return <div className="space-y-4 max-w-5xl mx-auto">
    <button type="button" onClick={onBack} className="text-gold-400 text-sm inline-flex items-center gap-1 min-h-[40px]"><ArrowLeft size={14} />Bank check</button>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] tracking-wider text-gray-500 uppercase">{dayLabel(line.date)} · {out ? 'Money out' : 'Money in'}{line.details.memo ? ` · "${line.details.memo}"` : ''}</p>
        <h2 className="font-display text-white font-bold text-xl break-words">{line.details.who || line.text}</h2>
        <p className="text-gray-400 text-xs break-words">{line.details.who ? line.text : ''}{line.details.ref ? ` · ref ${line.details.ref}` : ''}</p>
      </div>
      <div className="text-right">
        <p className={`text-2xl font-semibold ${out ? 'text-white' : 'text-emerald-300'}`}>{signed(line.cents)}</p>
        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${CHIP[state][1]}`}>{CHIP[state][0]}</span>
      </div>
    </div>
    {line.details.note && <p className="text-sm text-sky-200 rounded-lg border border-sky-400/30 bg-sky-400/10 p-3">Note: {line.details.note}</p>}

    {state === 'done' ? <DoneView line={line} moves={moves} /> : <>
      <fieldset className={`${card} p-4 space-y-3`}>
        <legend className="sr-only">What was this?</legend>
        <p className="text-white text-sm font-semibold">{out ? 'What was this payment?' : 'What was this money?'}</p>
        <div className="flex flex-wrap gap-2">
          {kinds.map(([k, name]) => <label key={k} className={`min-h-[40px] px-3.5 rounded-full border text-sm inline-flex items-center gap-2 cursor-pointer ${kind === k ? 'border-gold-500/60 bg-gold-500/10 text-white' : 'border-obsidian-400/70 text-gray-300'}`}>
            <input type="radio" name="kind" className="accent-[#EAB820]" checked={kind === k} onChange={() => setKind(k)} />{name}</label>)}
        </div>
      </fieldset>
      {out && (kind === 'bills' || kind === 'staff') ? <>{kind === 'staff' && <p className="text-sm text-sky-200 rounded-lg border border-sky-400/30 bg-sky-400/10 p-3">Choose the staff member as the payee. Then in step 2 add what they paid for: the car, what it was, and the amount. It goes on the car as a car cost paid back to them.</p>}<BillsMatch line={line} bank={bank} actorId={actorId} onChange={onChange} /></>
        : kind === 'garage_money' || kind === 'garage_back' ? <GarageEntry key={kind} line={line} bankAccountId={bankAccountId} actorId={actorId} onChange={onChange} />
        : kind ? <AnswerForm key={kind} line={line} kind={kind} actorId={actorId} onChange={onChange} /> : null}
      <div className="text-xs text-gray-500">
        {!marking ? <button type="button" className="underline min-h-[40px]" onClick={() => setMarking(true)}>This is already recorded in the app</button>
          : <span className="inline-flex flex-wrap items-center gap-2">Only use this when the payment is already in the app under a different date or amount.
            <button type="button" className="btn-ghost px-3 py-1.5 rounded-lg" disabled={busy} onClick={() => void markDone()}>Mark as done</button>
            <button type="button" className="underline" onClick={() => setMarking(false)}>Cancel</button></span>}
        {error && <p role="alert" className="text-red-300 mt-1">{error}</p>}
      </div>
    </>}
  </div>;
}

// Money held for the garage: their customers paid on our card machine, so it came
// into our bank but is the garage's. In: bank up, Owed to Garage up. Paid back:
// both go down. It is never AutoDream income. One entry per bank line (fixed id).
const GARAGE_ACCOUNT = 'acct-due-garage';
function GarageEntry({ line, bankAccountId, actorId, onChange }: { line: BankCheckLine; bankAccountId: string; actorId: string; onChange: (l: BankCheckLine) => void }) {
  const journalEntries = useStore((s) => s.journalEntries), ledgerAccounts = useStore((s) => s.ledgerAccounts);
  const addLedgerAccount = useStore((s) => s.addLedgerAccount), addJournalEntry = useStore((s) => s.addJournalEntry);
  const incoming = line.cents > 0, cents = Math.abs(line.cents);
  const owed = useMemo(() => journalEntries.filter((e) => !e.voided).reduce((sum, e) => sum + (e.lines ?? []).filter((l) => l.accountId === GARAGE_ACCOUNT).reduce((t, l) => t + toCents(Number(l.credit) || 0) - toCents(Number(l.debit) || 0), 0), 0), [journalEntries]);
  const [note, setNote] = useState(line.details.answer?.note ?? ''), [ask, setAsk] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const tooMuch = !incoming && cents > owed;
  const save = async () => {
    setBusy(true); setError('');
    try {
      if (!bankAccountId) throw new Error("This bank's account in the books was not found. Reload the page.");
      const id = 'bank-check:' + line.id;
      const { data, error: loadError } = await financeFrom('journal_entries').select('*').eq('id', id).range(0, 0);
      if (loadError) throw new Error(loadError.message);
      if (!(data ?? []).length) {
        if (!ledgerAccounts.some((a) => a.id === GARAGE_ACCOUNT)) await addLedgerAccount({ id: GARAGE_ACCOUNT, name: 'Owed to Garage', type: 'liability', notes: 'Money AutoDream holds for the garage, e.g. their customers paid on our card machine. Paid back by transfer.' });
        const rm = cents / 100, who = (line.details.who || line.text).slice(0, 120);
        await addJournalEntry({ id, date: line.date, createdAt: new Date().toISOString(), createdBy: actorId, sourceType: 'bank_check', sourceId: line.id,
          description: incoming ? `Garage money in (their customer used our card machine): ${who}` : `Paid back to the garage: ${who}`,
          lines: incoming ? [{ accountId: bankAccountId, debit: rm, credit: 0 }, { accountId: GARAGE_ACCOUNT, debit: 0, credit: rm }] : [{ accountId: GARAGE_ACCOUNT, debit: rm, credit: 0 }, { accountId: bankAccountId, debit: 0, credit: rm }] });
      }
      const at = new Date().toISOString();
      onChange(await saveLine(line.id, { status: 'matched', details: { ...line.details, answer: { kind: incoming ? 'garage_money' : 'garage_back', ...(note.trim() ? { note: note.trim().slice(0, 1000) } : {}), at, by: actorId }, done: { how: 'recorded', journalIds: [id], at, by: actorId } } }));
    } catch (e) { setError(errorText(e, 'Could not put this in the books.')); setAsk(false); } finally { setBusy(false); }
  };
  return <div className={`${card} p-4 space-y-3`}>
    <p className="text-sm text-gray-300">{incoming
      ? 'This money belongs to the garage, not AutoDream. It goes in the books as money we owe the garage, not as income.'
      : 'This transfer paid the garage back the money their customers paid on our card machine.'}</p>
    <div className="rounded-lg border border-obsidian-400/60 p-3 text-sm space-y-1">
      <div className="flex justify-between gap-3"><span className="text-gray-400">Bank</span><span className="text-white">{incoming ? '+' : '−'}{formatCents(cents)}</span></div>
      <div className="flex justify-between gap-3"><span className="text-gray-400">Owed to Garage</span><span className="text-white">{incoming ? '+' : '−'}{formatCents(cents)}</span></div>
      <div className="flex justify-between gap-3 text-xs"><span className="text-gray-500">We owe the garage now</span><span className="text-gray-300">{formatCents(owed)} → {formatCents(owed + (incoming ? cents : -cents))}</span></div>
    </div>
    {tooMuch && <p className="text-sm text-amber-200">This is more than we owe the garage ({formatCents(owed)}). Put the garage's card payments in the books first.</p>}
    <label className="block text-xs text-gray-400">Note (optional)<input className="input w-full rounded-lg px-3 py-2 text-sm mt-1" value={note} maxLength={1000} placeholder={incoming ? 'e.g. Garage customer, verified' : ''} onChange={(e) => setNote(e.target.value)} /></label>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {!ask ? <button type="button" className="btn-gold px-5 py-2.5 rounded-lg text-sm" disabled={busy || tooMuch} onClick={() => setAsk(true)}>Put in the books</button>
      : <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn-gold px-5 py-2.5 rounded-lg text-sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : `Yes, put ${formatCents(cents)} in the books`}</button><button type="button" className="btn-ghost px-4 py-2.5 rounded-lg text-sm" disabled={busy} onClick={() => setAsk(false)}>Go back</button></div>}
  </div>;
}

function DoneView({ line, moves }: { line: BankCheckLine; moves: BankMove[] }) {
  const payments = useStore((s) => s.payments), cars = useStore((s) => s.cars);
  const bills = (line.details.done?.how === 'recorded' ? line.details.billIds ?? [] : []).map((id) => payments.find((p) => p.id === id)).filter((p): p is Payment => !!p);
  return <div className={`${card} p-4 space-y-3`}>
    <p className="text-emerald-300 text-sm font-semibold">{line.details.done?.how === 'marked' ? 'You marked this line as already in the app.' : 'This line is in the app.'}</p>
    {bills.length > 0 && <BillTable bills={bills} cars={cars} amountOf={(p) => toCents(p.amount)} />}
    {!bills.length && moves.length > 0 && <ul className="text-sm text-gray-300 space-y-1">{moves.map((m) => <li key={m.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{m.label}</span><span>{signed(m.cents)}</span></li>)}</ul>}
  </div>;
}

function BillTable({ bills, cars, amountOf, ticked, onToggle, flag, hint }: { bills: Payment[]; cars: { id: string; carPlate?: string }[]; amountOf: (p: Payment) => number; ticked?: Set<string>; onToggle?: (id: string) => void; hint?: (p: Payment) => string | undefined; flag?: (p: Payment) => string | undefined }) {
  return <div className="rounded-lg border border-obsidian-400/60 divide-y divide-obsidian-400/40">
    {bills.map((p) => {
      const plate = cars.find((c) => c.id === p.carId)?.carPlate ?? '';
      const body = <>
        <span className="w-24 shrink-0 text-white font-semibold">{plate || '—'}</span>
        <span className="flex-1 min-w-[160px] text-gray-300">{p.description || p.type}<span className="text-gray-500"> · keyed {dayLabel(p.createdAt)}</span>{flag?.(p) ? <span className="ml-2 text-[11px] text-amber-300">{flag(p)}</span> : hint?.(p) && <span className="ml-2 text-[11px] text-sky-300">{hint(p)}</span>}</span>
        <span className="w-28 text-right text-white">{formatCents(amountOf(p)).replace('RM ', '')}</span>
      </>;
      return onToggle
        ? <label key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm cursor-pointer"><input type="checkbox" className="w-5 h-5 accent-[#EAB820]" checked={!!ticked?.has(p.id)} onChange={() => onToggle(p.id)} />{body}</label>
        : <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">{body}</div>;
    })}
  </div>;
}

function AnswerForm({ line, kind, actorId, onChange }: { line: BankCheckLine; kind: string; actorId: string; onChange: (l: BankCheckLine) => void }) {
  const before = line.details.answer?.kind === kind ? line.details.answer : undefined;
  const users = useStore((s) => s.users);
  const pickPerson = kind === 'salary' || kind === 'director_in';
  // Staff to pick from: everyone for a salary, directors and shareholders for money a director put in.
  const people = useMemo(() => [...new Set(users.filter((u) => u.role !== 'investor' && u.role !== 'banker' && (kind === 'salary' || u.role === 'director' || u.role === 'shareholder')).map((u) => u.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [users, kind]);
  const monthOptions = useMemo(() => { const d = new Date(line.date + 'T00:00:00'); return Array.from({ length: 13 }, (_, i) => new Date(d.getFullYear(), d.getMonth() - i, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })); }, [line.date]);
  const [type, setType] = useState(() => before?.type ?? (kind === 'office' ? OFFICE_TYPES[0] : pickPerson ? guessPayee(`${line.details.who ?? ''} ${line.text}`, people) ?? '' : ''));
  const [someoneElse, setSomeoneElse] = useState(() => pickPerson && !!before?.type && !people.includes(before.type));
  const [car, setCar] = useState(before?.car ?? ''), [month, setMonth] = useState(before?.month ?? (kind === 'salary' ? monthOptions[1] : '')), [note, setNote] = useState(before?.note ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const needsCar = ['car_purchase', 'car_sale', 'booking', 'garage', 'customer_refund'].includes(kind);
  const needsMonth = ['office', 'salary'].includes(kind);
  const ready = !busy && (kind !== 'other' || note.trim().length > 0) && (kind !== 'salary' || (type.trim().length > 0 && month.length > 0));
  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {
      const userId = pickPerson && !someoneElse ? users.find((u) => u.name === type)?.id : undefined;
      const answer = { kind, ...(type.trim() ? { type: type.trim().slice(0, 120) } : {}), ...(userId ? { userId } : {}), ...(car.trim() ? { car: car.trim().slice(0, 40) } : {}), ...(month.trim() ? { month: month.trim().slice(0, 60) } : {}), ...(note.trim() ? { note: note.trim().slice(0, 1000) } : {}), at: new Date().toISOString(), by: actorId };
      onChange(await saveLine(line.id, { details: { ...line.details, answer } })); setSaved(true);
    } catch (e) { setError(errorText(e, 'Could not save your answer.')); } finally { setBusy(false); }
  };
  const field = 'input w-full rounded-lg px-3 py-2 text-sm mt-1';
  return <div className={`${card} p-4 space-y-3`}>
    <div className="grid gap-3 sm:grid-cols-2">
      {kind === 'office' && <label className="text-xs text-gray-400">Type<select className={field} value={type} onChange={(e) => setType(e.target.value)}>{OFFICE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>}
      {pickPerson && <label className="text-xs text-gray-400">{kind === 'salary' ? 'Whose salary or fee?' : 'Which director?'}
        <select className={field} value={someoneElse ? '__other' : type} onChange={(e) => { if (e.target.value === '__other') { setSomeoneElse(true); setType(''); } else { setSomeoneElse(false); setType(e.target.value); } }}>
          <option value="">Choose…</option>
          {people.map((n) => <option key={n} value={n}>{n}</option>)}
          <option value="__other">Someone else (type the name)</option>
        </select>
        {someoneElse && <input className={field} value={type} maxLength={120} placeholder="Name" onChange={(e) => setType(e.target.value)} />}</label>}
      {kind === 'customer_refund' && <label className="text-xs text-gray-400">Customer's name<input className={field} value={type} maxLength={120} onChange={(e) => setType(e.target.value)} /></label>}
      {needsCar && <label className="text-xs text-gray-400">Which car?<input className={field} value={car} maxLength={40} placeholder="Plate, e.g. QAA1234A" onChange={(e) => setCar(e.target.value)} /></label>}
      {kind === 'salary' && <label className="text-xs text-gray-400">For which month?<select className={field} value={month} onChange={(e) => setMonth(e.target.value)}><option value="">Choose…</option>{[...new Set([...(month && !monthOptions.includes(month) ? [month] : []), ...monthOptions])].map((m) => <option key={m}>{m}</option>)}</select></label>}
      {needsMonth && kind !== 'salary' && <label className="text-xs text-gray-400">For which month?<input className={field} value={month} maxLength={60} placeholder="e.g. October 2026" onChange={(e) => setMonth(e.target.value)} /></label>}
      <label className="text-xs text-gray-400 sm:col-span-2">{kind === 'other' ? 'What was it? (needed)' : 'Note (optional)'}<input className={field} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
    </div>
    {kind === 'customer_refund' && <p className="text-xs text-gray-400">For example, the loan paid more than the car price and the extra went back to the customer. Claude will put the refund on the car and in the books, and check with you first.</p>}
    {kind === 'car_purchase' && <p className="text-xs text-gray-400">If this car is not in the app yet, add it in Inventory too. Its purchase can then be recorded against this line.</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {saved && <p className="text-sm text-emerald-300">Saved.</p>}
    <button type="button" className="btn-gold px-5 py-2 rounded-lg text-sm" disabled={!ready} onClick={() => void save()}>{busy ? 'Saving…' : 'Save answer'}</button>
  </div>;
}

type Intent = { requestId: string; bankAccountId: string; bankReference: string; paidOn: string; notes: string; billIds: string[]; allocations: { paymentId: string; amountCents: number; documentId: string }[]; sent?: boolean };

function BillsMatch({ line, bank, actorId, onChange }: { line: BankCheckLine; bank: BankRow; actorId: string; onChange: (l: BankCheckLine) => void }) {
  const payments = useStore((s) => s.payments), cars = useStore((s) => s.cars), workshops = useStore((s) => s.workshops), merchants = useStore((s) => s.merchants);
  const addPayment = useStore((s) => s.addPayment), addRepair = useStore((s) => s.addRepair), addMiscCost = useStore((s) => s.addMiscCost), addJournalEntry = useStore((s) => s.addJournalEntry);
  const amount = -line.cents;
  const openBills = useMemo(() => payments.filter((p) => p.status === 'pending' && !SALARY.has(p.type) && p.type !== 'panel_charge' && paymentBalanceCents(p) > 0), [payments]);
  const payees = useMemo(() => { const m = new Map<string, number>(); for (const p of openBills) m.set(p.recipientName, (m.get(p.recipientName) ?? 0) + 1); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])); }, [openBills]);
  const users = useStore((s) => s.users);
  const shopNames = useMemo(() => [...workshops.map((w) => w.name), ...merchants.map((m) => m.name), ...users.filter((u) => u.role !== 'investor').map((u) => u.name)].filter(Boolean), [workshops, merchants, users]);
  const [payee, setPayee] = useState(() => line.details.payee ?? guessPayee(`${line.details.who ?? ''} ${line.text}`, [...new Set([...payees.map((x) => x[0]), ...shopNames])]) ?? '');
  const [ticked, setTicked] = useState<string[]>(line.details.billIds ?? []);
  // Bills that were ticked when the line opened stay on top, so they are easy to compare.
  const [firstTicked] = useState(() => new Set(line.details.billIds ?? []));
  const [slip, setSlip] = useState<File | null>(null), [ref, setRef] = useState(line.details.ref ?? '');
  const [review, setReview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState('');
  const [progress, setProgress] = useState('');
  const key = `autodream-bank-check:${actorId}:${line.id}`;
  const readIntent = (): Intent | null => { try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); return v?.requestId && Array.isArray(v.allocations) && Array.isArray(v.billIds) ? v : null; } catch { return null; } };
  const [intent, setIntent] = useState<Intent | null>(readIntent);
  const keep = (it: Intent | null) => { try { if (it) sessionStorage.setItem(key, JSON.stringify(it)); else sessionStorage.removeItem(key); } catch { /* the save still runs */ } setIntent(it); };

  const byId = useMemo(() => new Map(payments.map((p) => [p.id, p])), [payments]);
  const journalEntries = useStore((s) => s.journalEntries);
  // A repair or car-cost bill can only be paid once its cost is in the books.
  const booked = useMemo(() => new Set(journalEntries.filter((e) => !e.voided && (e.sourceType === 'repair' || e.sourceType === 'misc_cost')).map((e) => e.sourceType + ':' + e.sourceId)), [journalEntries]);
  const unbooked = (p: Payment) => (p.type === 'repair' || p.type === 'misc_cost') && !booked.has(p.type + ':' + p.id);
  // Two bills for the same repair or car cost: one is a duplicate and must never get an entry or be paid.
  const duplicate = (p: Payment) => payments.some((o) => o.id !== p.id && o.type === p.type && ((p.type === 'repair' && !!p.repairJobId && o.repairJobId === p.repairJobId) || (p.type === 'misc_cost' && !!p.miscCostId && o.miscCostId === p.miscCostId)));
  const flag = (p: Payment) => (duplicate(p) ? 'same job as another bill: check before paying' : unbooked(p) ? 'no books entry yet' : undefined);
  const tickedSet = new Set(ticked);
  const list = openBills.filter((p) => p.recipientName.toLowerCase() === payee.toLowerCase()).sort((a, b) => Number(firstTicked.has(b.id)) - Number(firstTicked.has(a.id)) || a.createdAt.localeCompare(b.createdAt));
  // Costs the same person paid can be keyed under another payee (petrol keyed as "Petrol"
  // next to the runner's own bill). Those on the same car and day as a ticked bill are
  // suggested, and a second payee's bills can be shown and ticked too.
  const [alsoPayee, setAlsoPayee] = useState(line.details.alsoPayee ?? '');
  const keyedDay = (p: Payment) => new Date(new Date(p.createdAt).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
  const sameKeys = new Set(ticked.map((id) => byId.get(id)).filter((p): p is Payment => !!p && !!p.carId && p.recipientName.toLowerCase() === payee.toLowerCase()).map((p) => p.carId + '|' + keyedDay(p)));
  const nearSame = (p: Payment) => !!p.carId && sameKeys.has(p.carId + '|' + keyedDay(p));
  const nearby = new Map<string, { n: number; cents: number }>();
  for (const p of openBills) if (p.type === 'misc_cost' && p.recipientName.toLowerCase() !== payee.toLowerCase() && !tickedSet.has(p.id) && nearSame(p)) { const g = nearby.get(p.recipientName) ?? { n: 0, cents: 0 }; nearby.set(p.recipientName, { n: g.n + 1, cents: g.cents + paymentBalanceCents(p) }); }
  const list2 = alsoPayee && alsoPayee.toLowerCase() !== payee.toLowerCase() ? openBills.filter((p) => p.recipientName.toLowerCase() === alsoPayee.toLowerCase()).sort((a, b) => Number(nearSame(b)) - Number(nearSame(a)) || Number(tickedSet.has(b.id)) - Number(tickedSet.has(a.id)) || a.createdAt.localeCompare(b.createdAt)) : [];
  const list2Near = list2.filter(nearSame);
  const others = ticked.map((id) => byId.get(id)).filter((p): p is Payment => !!p && !list.includes(p) && !list2.includes(p));
  const live = ticked.filter((id) => { const p = byId.get(id); return !!p && p.status === 'pending' && paymentBalanceCents(p) > 0; });
  const total = live.reduce((s, id) => s + paymentBalanceCents(byId.get(id)!), 0);
  const left = amount - total;
  const stale = ticked.length - live.length;
  const noBooks = live.filter((id) => unbooked(byId.get(id)!)).length;
  const [bookAsk, setBookAsk] = useState(false);
  // The same entry the app makes when a bill is keyed in: the car's cost goes up and so
  // does what we owe, dated the day the bill was keyed. No money moves.
  const addBooks = async () => {
    setBusy(true); setError(''); setSaved('');
    try {
      const want = live.map((id) => byId.get(id)!).filter(unbooked).slice(0, 200);
      const { data, error: loadError } = await financeFrom('journal_entries').select('*').in('source_id', want.map((p) => p.id)).range(0, 999);
      if (loadError) throw new Error(loadError.message);
      const have = new Set(((data ?? []) as { voided?: boolean; source_type?: string; source_id?: string }[]).filter((e) => !e.voided).map((e) => e.source_type + ':' + e.source_id));
      let added = 0, already = 0; const skipped: string[] = [];
      for (const p of want) {
        if (have.has(p.type + ':' + p.id)) { already++; continue; }
        const car = cars.find((c) => c.id === p.carId);
        if (!car || car.investorFunded || duplicate(p)) { skipped.push(car?.carPlate || p.description || p.id); continue; }
        const entry = buildCarCostRecognizedEntry({ car, amount: p.amount, description: p.type === 'repair' ? `Repair recognized — ${(p.description || 'Repair').replace(/ repair$/, '')}` : `Misc cost recognized — ${p.description || 'Misc cost'}`, sourceType: p.type, sourceId: p.id, createdBy: actorId });
        await addJournalEntry({ ...entry, date: new Date(new Date(p.createdAt).getTime() + 8 * 3600e3).toISOString().slice(0, 10) });
        added++;
      }
      setBookAsk(false);
      setSaved([added ? `${added} books ${added === 1 ? 'entry' : 'entries'} added.` : '', already ? `${already} already had one: reload the page.` : '', skipped.length ? `Not added (check on the car's page): ${skipped.join(', ')}.` : ''].filter(Boolean).join(' '));
    } catch (e) { setError(errorText(e, 'Could not add the books entries.')); } finally { setBusy(false); }
  };
  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const canReview = !busy && !intent && noBooks === 0 && left === 0 && live.length > 0 && live.length <= 50 && !!slip && ref.trim().length > 0 && ref.length <= 200;

  const saveTicks = async (ids = ticked, extra: Partial<BankCheckDetails> = {}) => {
    const l = await saveLine(line.id, { details: { ...line.details, payee, alsoPayee: alsoPayee || undefined, billIds: ids, ...extra } });
    onChange(l); return l;
  };
  const later = async () => {
    setBusy(true); setError(''); setSaved('');
    try { await saveTicks(); setSaved('Saved. Come back any time.'); } catch (e) { setError(errorText(e, 'Could not save.')); } finally { setBusy(false); }
  };

  const record = async () => {
    setBusy(true); setError('');
    try {
      let it = intent ?? { requestId: 'company_bank_' + crypto.randomUUID(), bankAccountId: bank.id, bankReference: ref.trim(), paidOn: line.date, notes: `Bank check: ${line.details.memo || line.details.who || line.text}`.slice(0, 2000), billIds: live, allocations: [] };
      keep(it);
      for (const id of it.billIds) {
        if (it.allocations.some((a) => a.paymentId === id)) continue;
        if (!slip) throw new Error('Pick the bank slip again to carry on.');
        if (useStore.getState().currentUser?.id !== actorId) throw new Error('Your account changed. Reopen this line.');
        const bill = useStore.getState().payments.find((p) => p.id === id);
        if (!bill) throw new Error('A ticked bill is missing. Reload the page.');
        setProgress(`Attaching the slip to bill ${it.allocations.length + 1} of ${it.billIds.length}…`);
        const doc = await uploadCompanyEvidence(id, 'payment', slip);
        it = { ...it, allocations: [...it.allocations, { paymentId: id, amountCents: paymentBalanceCents(bill), documentId: doc.document.documentId }] };
        keep(it);
      }
      setProgress('Recording the payment…');
      it = { ...it, sent: true }; keep(it);
      const saved = await companyBankRequest<CompanyBankSave>('record', { requestId: it.requestId, bankAccountId: it.bankAccountId, bankReference: it.bankReference, paidOn: it.paidOn, notes: it.notes, allocations: it.allocations });
      useStore.getState().applyCompanyBankPayment(actorId, saved);
      const journalIds = (saved.journals ?? []).map((j) => String(j.id ?? '')).filter(Boolean);
      const l = await saveLine(line.id, { status: 'matched', details: { ...line.details, payee, billIds: it.billIds, done: { how: 'recorded', bankPaymentId: saved.bankPaymentId, journalIds, at: new Date().toISOString(), by: actorId } } });
      keep(null); setReview(false); onChange(l);
    } catch (e) { setError(errorText(e, 'Could not record this payment.')); } finally { setBusy(false); setProgress(''); }
  };

  const reviewBills = (intent?.billIds ?? live).map((id) => byId.get(id)).filter((p): p is Payment => !!p);
  if (intent || review) return <div className={`${card} p-4 space-y-3 border-gold-500/40`}>
    <p className="text-white font-semibold">Check every bill against your own list</p>
    <p className="text-sm text-gray-400">{reviewBills.length} bills · paid from {bank.name} on {dayLabel(intent?.paidOn ?? line.date)} · ref {intent?.bankReference ?? ref.trim()}</p>
    <BillTable bills={reviewBills} cars={cars} amountOf={(p) => intent?.allocations.find((a) => a.paymentId === p.id)?.amountCents ?? paymentBalanceCents(p)} />
    <p className="text-right text-white font-semibold">Total {formatCents(amount)}</p>
    {intent && <p className="text-xs text-amber-200">This save was started{intent.allocations.length ? ` (${intent.allocations.length} of ${intent.billIds.length} slips attached)` : ''}. Press the button again to finish it.{!slip && intent.allocations.length < intent.billIds.length ? ' Pick the bank slip again first.' : ''}</p>}
    {intent && intent.allocations.length < intent.billIds.length && <label className="block text-xs text-gray-400">Bank slip{slip ? ` (chosen: ${slip.name})` : ' (pick it again)'}<input type="file" accept="image/png,image/jpeg,application/pdf" className="block mt-1 text-xs" disabled={busy} onChange={(e) => { setSlip(e.target.files?.[0] ?? null); setError(''); }} /></label>}
    {busy && progress && <p className="text-sm text-sky-200">{progress} Keep this page open until it finishes.</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <div className="flex flex-wrap gap-2 items-center">
      <button type="button" className="btn-gold px-5 py-2.5 rounded-lg text-sm" disabled={busy} onClick={() => void record()}>{busy ? 'Recording…' : `Yes, record ${formatCents(amount)}`}</button>
      {!intent?.sent && <button type="button" className="btn-ghost px-4 py-2.5 rounded-lg text-sm" disabled={busy} onClick={() => { keep(null); setReview(false); }}>Go back</button>}
      <span className="text-xs text-gray-500">Recorded payments cannot be undone.</span>
    </div>
  </div>;

  return <>
    <div className={`${card} p-4 space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-white text-sm font-semibold">1 · Tick the bills this transfer paid</p>
        <label className="text-xs text-gray-400 flex items-center gap-2">Payee
          <select className="input rounded-lg px-3 py-2 text-sm max-w-[260px]" value={payee} onChange={(e) => setPayee(e.target.value)}>
            <option value="">Choose…</option>
            {[...new Set([...payees.map((x) => x[0]), ...shopNames, ...(payee ? [payee] : [])])].sort((a, b) => a.localeCompare(b)).map((n) => <option key={n} value={n}>{n} ({payees.find((x) => x[0] === n)?.[1] ?? 0})</option>)}
          </select></label>
      </div>
      {payee ? (list.length ? <>
        <p className="text-xs text-gray-500">{payee}'s unpaid bills{firstTicked.size ? ', ticked ones first' : ''}, oldest first.</p>
        <BillTable bills={list} cars={cars} amountOf={paymentBalanceCents} ticked={tickedSet} onToggle={toggle} flag={flag} />
        <div className="flex gap-3 text-xs"><button type="button" className="text-gold-400 min-h-[36px]" onClick={() => setTicked((t) => [...new Set([...t, ...list.map((p) => p.id)])])}>Tick all</button><button type="button" className="text-gold-400 min-h-[36px]" onClick={() => setTicked((t) => t.filter((id) => !list.some((p) => p.id === id)))}>Untick all</button></div>
      </> : <p className="text-sm text-gray-400">{payee} has no unpaid bills in the app.</p>) : <p className="text-sm text-gray-400">Choose who this transfer paid.</p>}
      {payee && <div className="rounded-lg border border-white/10 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-300">Did this transfer also pay bills keyed under another payee? (e.g. Petrol)</p>
          <select className="input rounded-lg px-3 py-2 text-sm max-w-[260px]" value={alsoPayee} onChange={(e) => setAlsoPayee(e.target.value)}>
            <option value="">No</option>
            {payees.filter((x) => x[0].toLowerCase() !== payee.toLowerCase()).map((x) => <option key={x[0]} value={x[0]}>{x[0]} ({x[1]})</option>)}
          </select>
        </div>
        {!alsoPayee && nearby.size > 0 && <p className="text-xs text-sky-200">On the same cars and days as your ticked bills: {[...nearby.entries()].map(([n, g], i) => <span key={n}>{i ? ', ' : ''}<button type="button" className="underline" onClick={() => setAlsoPayee(n)}>{n} ({g.n} {g.n === 1 ? 'bill' : 'bills'}, {formatCents(g.cents)})</button></span>)}. Tap to show them.</p>}
        {list2.length > 0 && <>
          <p className="text-xs text-gray-500">{alsoPayee}'s unpaid bills{list2Near.length ? `, the ${list2Near.length} on the same cars and days as your ticked bills first` : ''}.</p>
          <BillTable bills={list2} cars={cars} amountOf={paymentBalanceCents} ticked={tickedSet} onToggle={toggle} flag={flag} hint={(p) => (nearSame(p) ? 'same car and day as a ticked bill' : undefined)} />
          <div className="flex flex-wrap gap-3 text-xs">{list2Near.length > 0 && <button type="button" className="text-gold-400 min-h-[36px]" onClick={() => setTicked((t) => [...new Set([...t, ...list2Near.map((p) => p.id)])])}>Tick the {list2Near.length} on the same cars and days</button>}<button type="button" className="text-gold-400 min-h-[36px]" onClick={() => setTicked((t) => t.filter((id) => !list2.some((p) => p.id === id)))}>Untick all {alsoPayee}</button></div>
        </>}
        {alsoPayee && !list2.length && <p className="text-xs text-gray-400">{alsoPayee} has no unpaid bills in the app.</p>}
      </div>}
      {others.length > 0 && <><p className="text-xs text-gray-500">Also ticked, from other payees or already paid:</p><BillTable bills={others} cars={cars} amountOf={paymentBalanceCents} ticked={tickedSet} onToggle={toggle} flag={flag} /></>}
      {stale > 0 && <p className="text-xs text-amber-200">{stale} ticked {stale === 1 ? 'bill is' : 'bills are'} already paid and won't count.</p>}
    </div>

    <AddBill line={line} payee={payee} actorId={actorId}
      deps={{ cars, workshops, merchants, addPayment, addRepair, addMiscCost, addJournalEntry }}
      onAdded={async (billId) => { const ids = [...ticked, billId]; setTicked(ids); await saveTicks(ids, { addedBillIds: [...(line.details.addedBillIds ?? []), billId] }); }} />

    <div className="rounded-xl border border-gold-500/40 bg-gold-500/10 p-4 space-y-3">
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div><p className="text-xs text-gray-400">Transfer</p><p className="text-white font-semibold">{formatCents(amount)}</p></div>
        <div><p className="text-xs text-gray-400">Ticked bills</p><p className="text-white font-semibold">{formatCents(total)} <span className="text-gray-500 text-xs">({live.length})</span></p></div>
        <div className="col-span-2"><p className="text-xs text-gray-400">{left < 0 ? 'Ticked too much by' : 'Still to explain'}</p><p className={`font-semibold ${left === 0 ? 'text-emerald-300' : 'text-gold-300'}`}>{formatCents(Math.abs(left))}</p></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-gray-400">Bank slip (needed to record)<input type="file" accept="image/png,image/jpeg,application/pdf" className="block mt-1 text-xs" onChange={(e) => setSlip(e.target.files?.[0] ?? null)} /></label>
        <label className="text-xs text-gray-400">Bank reference<input className="input w-full rounded-lg px-3 py-2 text-sm mt-1" value={ref} maxLength={200} placeholder="From the slip" onChange={(e) => setRef(e.target.value)} /></label>
      </div>
      {noBooks > 0 && <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 space-y-2 text-xs text-amber-100">
        <p>{noBooks} ticked {noBooks === 1 ? 'bill is' : 'bills are'} in To pay but not in the accounts book yet, so the payment can't be recorded.</p>
        {!bookAsk ? <button type="button" className="btn-ghost px-3 py-1.5 rounded-lg" disabled={busy} onClick={() => setBookAsk(true)}>Add {noBooks === 1 ? 'it' : 'them'} to the accounts book</button>
          : <div className="space-y-2"><p>For each one: the car's cost goes up and what we owe the payee goes up, dated the day the bill was keyed. No money moves.</p>
            <div className="flex flex-wrap gap-2"><button type="button" className="btn-gold px-3 py-1.5 rounded-lg" disabled={busy} onClick={() => void addBooks()}>{busy ? 'Adding…' : 'Yes, add ' + noBooks}</button><button type="button" className="underline" onClick={() => setBookAsk(false)}>Cancel</button></div></div>}
      </div>}
      {live.length > 50 && <p className="text-xs text-amber-200">One payment can hold up to 50 bills. Ask Claude to split this one.</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {saved && <p className="text-sm text-emerald-300">{saved}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-gold px-5 py-2.5 rounded-lg text-sm" disabled={!canReview} onClick={() => { setError(''); setReview(true); }}>Record payment</button>
        <span className="text-xs text-gray-500">{noBooks > 0 ? 'Add the missing books entries first.' : left !== 0 ? 'Unlocks when "Still to explain" is RM 0.00.' : !slip ? 'Pick the bank slip first.' : !ref.trim() ? 'Type the bank reference.' : 'You will check the list once more before it records.'}</span>
        <span className="flex-1" />
        <button type="button" className="btn-ghost px-4 py-2 rounded-lg text-sm" disabled={busy} onClick={() => void later()}>Save, finish later</button>
      </div>
    </div>
  </>;
}

type AddDeps = {
  cars: ReturnType<typeof useStore.getState>['cars'];
  workshops: ReturnType<typeof useStore.getState>['workshops'];
  merchants: ReturnType<typeof useStore.getState>['merchants'];
  addPayment: ReturnType<typeof useStore.getState>['addPayment'];
  addRepair: ReturnType<typeof useStore.getState>['addRepair'];
  addMiscCost: ReturnType<typeof useStore.getState>['addMiscCost'];
  addJournalEntry: ReturnType<typeof useStore.getState>['addJournalEntry'];
};

// A bill the admin never keyed in: it goes on the car as a finished repair (for a
// workshop) or a car cost (for a shop, or a person who paid first and is paid
// back), with its books entry dated on the bank
// line, and is ticked for this transfer.
function AddBill({ line, payee, actorId, deps, onAdded }: { line: BankCheckLine; payee: string; actorId: string; deps: AddDeps; onAdded: (billId: string) => Promise<void> }) {
  const ws = deps.workshops.find((w) => w.name.toLowerCase() === payee.toLowerCase());
  const shop = ws ? undefined : deps.merchants.find((m) => m.name.toLowerCase() === payee.toLowerCase());
  const [plate, setPlate] = useState(''), [job, setJob] = useState<string>(REPAIR_TYPES[0]), [what, setWhat] = useState(''), [amount, setAmount] = useState('');
  const [invoice, setInvoice] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState<string[]>([]);
  const cents = parseRinggit(amount);
  const ready = !busy && !!payee && plate.trim().length > 0 && !!cents && (ws ? !!job : what.trim().length > 0);
  const add = async () => {
    setBusy(true); setError('');
    try {
      const car = deps.cars.find((c) => samePlate(c.carPlate, plate));
      if (!car) throw new Error(`No car with plate ${plate.trim().toUpperCase()} in the app.`);
      if (car.investorFunded) throw new Error('This car has investor money. Add the cost on the car\'s page.');
      const amt = cents! / 100, now = new Date().toISOString();
      let billId: string | undefined;
      if (ws) {
        const repair: RepairJob = { id: generateId(), carId: car.id, typeOfRepair: job, parts: [], labourCost: amt, totalCost: amt, status: 'done', location: ws.name, actualCost: amt, completedAt: new Date(line.date + 'T12:00:00+08:00').toISOString(), notes: 'Added from Bank check', createdAt: now };
        await deps.addRepair(repair, { record: true });
        billId = await generateRepairPayment({ repair, payments: useStore.getState().payments, workshops: deps.workshops, addPayment: deps.addPayment });
        if (billId) await deps.addJournalEntry({ ...buildCarCostRecognizedEntry({ car, amount: amt, description: `Repair recognized — ${job}`, sourceType: 'repair', sourceId: billId, createdBy: actorId }), date: line.date });
      } else {
        // A shop, or a person (staff) who paid first and is paid back by this transfer.
        const misc: MiscCost = { id: generateId(), description: what.trim().slice(0, 200), amount: amt, merchant: shop?.name ?? payee, createdAt: now, createdBy: actorId };
        if (!(await deps.addMiscCost(car.id, misc))) throw new Error('Could not save this cost, so no bill was made. Try again.');
        billId = await generateMiscCostPayment({ carId: car.id, misc, payments: useStore.getState().payments, merchants: deps.merchants, addPayment: deps.addPayment });
        if (billId) await deps.addJournalEntry({ ...buildCarCostRecognizedEntry({ car, amount: amt, description: `Misc cost recognized — ${misc.description}`, sourceType: 'misc_cost', sourceId: billId, createdBy: actorId }), date: line.date });
      }
      if (!billId) throw new Error('The bill was not made. Reload the page and check the car.');
      if (invoice) await uploadCompanyEvidence(billId, 'invoice', invoice);
      await onAdded(billId);
      setDone((d) => [...d, `${car.carPlate} · ${ws ? job : what.trim()} · ${formatCents(cents!)}`]);
      setPlate(''); setAmount(''); setWhat(''); setInvoice(null);
    } catch (e) { setError(errorText(e, 'Could not add this bill.')); } finally { setBusy(false); }
  };
  const field = 'input w-full rounded-lg px-3 py-2 text-sm mt-1';
  return <div className={`${card} p-4 space-y-3`}>
    <p className="text-white text-sm font-semibold">2 · Add bills that were never keyed in</p>
    {!payee ? <p className="text-sm text-gray-400">Choose the payee above first.</p> : <>
      <p className="text-xs text-gray-500">Each one goes on the car as {ws ? `a finished repair from ${payee}` : shop ? `a car cost from ${payee}` : `a car cost paid back to ${payee} (they paid for it first)`}, with its books entry, and is ticked for this transfer.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-xs text-gray-400">Car plate<input className={field} value={plate} maxLength={20} placeholder="QAA1234A" onChange={(e) => setPlate(e.target.value)} /></label>
        {ws ? <label className="text-xs text-gray-400">Job<select className={field} value={job} onChange={(e) => setJob(e.target.value)}>{REPAIR_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          : <label className="text-xs text-gray-400">What for<input className={field} value={what} maxLength={200} placeholder={shop ? "e.g. Insurance" : "e.g. Window switch"} onChange={(e) => setWhat(e.target.value)} /></label>}
        <label className="text-xs text-gray-400">Amount (RM)<input className={field} inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="text-xs text-gray-400">Receipt or invoice (optional)<input type="file" accept="image/png,image/jpeg,application/pdf" className="block mt-2 text-xs w-full" onChange={(e) => setInvoice(e.target.files?.[0] ?? null)} /></label>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button type="button" className="btn-ghost px-4 py-2 rounded-lg text-sm" disabled={!ready} onClick={() => void add()}>{busy ? 'Adding…' : 'Add bill'}</button>
      {done.length > 0 && <ul className="text-xs text-emerald-300 space-y-0.5">{done.map((d, i) => <li key={i}>Added: {d}</li>)}</ul>}
    </>}
  </div>;
}
