// Bank check, "Before 1 Nov": the bank's lines from before its start date in the
// app, month by month. Every answer here is a DRAFT kept with the line: nothing
// goes into the books. When every month is ready, Claude prepares one step that
// connects them, and it runs only after the Director says yes.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Upload } from 'lucide-react';
import { useStore } from '../store';
import type { Bank } from '../lib/investorFinance';
import { formatCents, parseRinggit } from '../lib/investorFinance';
import { financeFrom } from '../lib/privateFinance';
import { insertRows, saveLine } from '../lib/bankCheckLines';
import { guessPayee, lineIds, toCents, type BankCheckDetails, type BankCheckLine, type BankMove, type DraftBill } from '../lib/bankCheckMatch';
import { HISTORY_IN_KINDS, HISTORY_OUT_KINDS, CARD, dayLabel, errorText, historyKindLabel, monthLabel } from '../lib/bankCheckWords';
import { paymentBalanceCents } from '../lib/companyBankPayments';
import {
  billCover, carBills, moveCover, explainedCents, hasDraft, historyState, linesForBill, monthTallies, readCheckedLines, suggestions,
  type BillLite, type CheckedLine, type CheckedMonth, type EntryNote, type HistoryState, type MonthTally, type Suggestion,
} from '../lib/bankHistory';
import { AnswerForm } from './BankCheckParts';

type BankRow = Bank & { balanceCents?: number };
type Tab = 'needs' | 'answered' | 'linked' | 'all';
const OLD_BANK = 'acct-bank-operating';
const NOT_BILLS = new Set(['salary', 'allowance', 'campaign_bonus', 'panel_charge', 'customer_collection', 'loan_disbursement', 'consignment_collection', 'supplier_credit_collection']);
const CHIP: Record<HistoryState, [string, string]> = {
  needs: ['Needs you', 'bg-amber-400/15 text-amber-200'],
  part: ['Part done', 'bg-sky-400/15 text-sky-200'],
  answered: ['Answered', 'bg-violet-400/15 text-violet-200'],
  linked: ['Matched', 'bg-emerald-400/15 text-emerald-200'],
};
const signed = (cents: number) => (cents > 0 ? '+' : '') + formatCents(cents).replace('RM ', '');
const plain = (cents: number) => formatCents(cents).replace('RM ', '');
const keyedDay = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const order = (a: BankCheckLine, b: BankCheckLine) => a.date.localeCompare(b.date) || (a.details.seq ?? 0) - (b.details.seq ?? 0);
const clearDraft = (d: BankCheckDetails): BankCheckDetails => { const { answer: _a, linkIds: _l, billIds: _b, billCents: _c, linkCents: _k, toAdd: _t, payee: _p, alsoPayee: _q, ...rest } = d; return rest; };
const DRAFT_NOTE = 'Draft only. Nothing you save here goes into the books.';

export default function BankHistory({ bank, lines, accountId, actorId, onLine, onReload }: {
  bank: BankRow; lines: BankCheckLine[]; accountId: string; actorId: string;
  onLine: (l: BankCheckLine) => void; onReload: () => Promise<void>;
}) {
  const payments = useStore((s) => s.payments), journalEntries = useStore((s) => s.journalEntries), cars = useStore((s) => s.cars);
  const booksReady = useStore((s) => s.phase2Loaded);
  const [month, setMonth] = useState(''), [openId, setOpenId] = useState<string | null>(null), [tab, setTab] = useState<Tab>('needs');
  const [reloadFile, setReloadFile] = useState(false), [byCar, setByCar] = useState(false);
  const before = dayLabel(bank.openingDate) + ' ' + bank.openingDate.slice(0, 4);

  // Books entries that moved money in or out of this bank before its start date:
  // on the old bank account (the same Public Bank account under its old name) or on
  // this bank's own account. The start figures entry is not one of them.
  const moves = useMemo<BankMove[]>(() => {
    const ids = new Set([OLD_BANK, accountId].filter(Boolean));
    const out: BankMove[] = [];
    for (const e of journalEntries) {
      const date = String(e.date).slice(0, 10);
      if (e.voided || date >= bank.openingDate || String(e.sourceId ?? '').startsWith('opening:')) continue;
      let cents = 0;
      for (const l of e.lines ?? []) if (ids.has(l.accountId)) cents += toCents(Number(l.debit) || 0) - toCents(Number(l.credit) || 0);
      if (cents) out.push({ id: e.id, date, label: e.description ?? '', cents });
    }
    return out;
  }, [journalEntries, accountId, bank.openingDate]);

  // Bills a line could have paid: not paid yet, or paid before the start date.
  const plateOf = useMemo(() => new Map(cars.map((c) => [c.id, c.carPlate ?? ''])), [cars]);
  const bills = useMemo<BillLite[]>(() => payments.filter((p) => !NOT_BILLS.has(p.type) && !p.obligationReplaced && (p.status === 'pending' ? paymentBalanceCents(p) > 0 : !!p.transferredAt && keyedDay(p.transferredAt) < bank.openingDate))
    .map((p) => ({ id: p.id, cents: p.status === 'pending' ? paymentBalanceCents(p) : toCents(p.amount), date: keyedDay(p.createdAt), label: [plateOf.get(p.carId ?? '') || '', p.description || p.type].filter(Boolean).join(' · '), payee: p.recipientName || '', plate: (plateOf.get(p.carId ?? '') || '').toUpperCase().replace(/[^A-Z0-9]/g, '') })), [payments, plateOf, bank.openingDate]);
  const billCents = useMemo(() => new Map(bills.map((b) => [b.id, b.cents])), [bills]);
  const moveCents = useMemo(() => new Map(moves.map((m) => [m.id, m.cents])), [moves]);
  const states = useMemo(() => new Map(lines.map((l) => [l.id, historyState(l, (id) => billCents.get(id) ?? 0, (id) => moveCents.get(id))])), [lines, billCents, moveCents]);
  const payees = useMemo(() => [...new Set(bills.map((b) => b.payee).filter(Boolean))], [bills]);
  const linePayee = useMemo(() => new Map(lines.map((l) => [l.id, guessPayee(`${l.details.who ?? ''} ${l.text}`, payees)])), [lines, payees]);
  const hints = useMemo(() => suggestions(lines, moves, bills, (l) => linePayee.get(l.id)), [lines, moves, bills, linePayee]);

  // What the Director said about books entries no line stands for, kept on the history upload.
  const uploadId = `history-${bank.id}`;
  const [notes, setNotes] = useState<Record<string, EntryNote>>({});
  const [notesSetUp, setNotesSetUp] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    financeFrom('bank_statement_uploads').select('*').eq('id', uploadId).range(0, 0).then(({ data }: { data: Record<string, unknown>[] | null }) => {
      const row = (data ?? [])[0];
      if (!live) return;
      setNotesSetUp(row ? 'details' in row : null);
      setNotes(((row?.details as { entries?: Record<string, EntryNote> } | undefined)?.entries) ?? {});
    }, () => { /* the notes stay empty; lines still work */ });
    return () => { live = false; };
  }, [uploadId, lines.length]);
  const saveNote = async (entryId: string, note: EntryNote | null) => {
    const { data, error } = await financeFrom('bank_statement_uploads').select('*').eq('id', uploadId).range(0, 0);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (!row || !('details' in row)) { setNotesSetUp(false); throw new Error('Saving notes on books entries needs a one-time setup in the database. Ask Claude for the setup step.'); }
    const details = (row.details ?? {}) as { entries?: Record<string, EntryNote> };
    const entries = { ...(details.entries ?? {}) };
    if (note) entries[entryId] = note; else delete entries[entryId];
    const saved = await financeFrom('bank_statement_uploads').update({ details: { ...details, entries } }).eq('id', uploadId);
    if (saved.error) throw new Error(saved.error.message);
    setNotes(entries);
  };

  const tallies = useMemo(() => monthTallies(lines, states, moves, (id) => notes[id]), [lines, states, moves, notes]);
  const tally = tallies.find((t) => t.month === month);
  const open = openId ? lines.find((l) => l.id === openId) : undefined;

  if (!booksReady) return <p className="text-gray-500 text-sm py-8 text-center"><Loader2 size={16} className="inline animate-spin mr-2" />Loading the books…</p>;
  if (!lines.length || reloadFile) return <LoadFile bank={bank} have={lines} actorId={actorId} uploadId={uploadId} before={before} onDone={async () => { setReloadFile(false); await onReload(); }} onCancel={lines.length ? () => setReloadFile(false) : undefined} />;

  if (open) {
    const usedMoves = moveCover(lines, (id) => moveCents.get(id), open.id);
    const covered = billCover(lines, (id) => billCents.get(id) ?? 0, open.id);
    return <HistoryLine key={open.id} line={open} state={states.get(open.id)!} hint={hints.get(open.id)} moves={moves} bills={bills} covered={covered} usedMoves={usedMoves}
      billCents={billCents} moveCents={moveCents} actorId={actorId} onBack={() => setOpenId(null)} onChange={onLine} />;
  }

  if (tally) return <MonthView tally={tally} lines={lines.filter((l) => l.date.startsWith(month)).sort(order)} states={states} hints={hints} notes={notes} notesSetUp={notesSetUp}
    tab={tab} setTab={setTab} actorId={actorId} billCents={billCents} moveCents={moveCents} onBack={() => setMonth('')} onOpen={setOpenId} onLine={onLine} onNote={saveNote} />;

  const ready = tallies.filter((t) => t.done).length;
  const settled = lines.filter((l) => { const s = states.get(l.id); return s === 'answered' || s === 'linked'; }).length;
  const undecided = tallies.reduce((s, t) => s + t.undecided.length, 0);
  return <div className="space-y-4">
    <div>
      <h2 className="font-display text-white font-bold text-xl">Before {before}</h2>
      <p className="text-gray-400 text-sm">{bank.name} · {lines.length.toLocaleString('en-MY')} lines from {dayLabel(lines[0].date)} {lines[0].date.slice(0, 4)}</p>
    </div>
    <p className="text-sm text-sky-100 rounded-lg border border-sky-400/30 bg-sky-400/10 p-3">{DRAFT_NOTE} When every month is ready, Claude prepares one step that connects them to the books and shows you what it will do. It runs only after you say yes.</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Work by">
      {([[false, 'By month'], [true, 'By car: match its bills']] as const).map(([v, name]) => <button key={name} type="button" aria-pressed={byCar === v} onClick={() => setByCar(v)}
        className={`min-h-[40px] px-4 rounded-full text-sm ${byCar === v ? 'bg-gold-gradient text-obsidian-950 font-semibold' : 'border border-obsidian-400/70 text-gray-200'}`}>{name}</button>)}
    </div>
    {byCar ? <ByCar lines={lines} bills={bills} roomOf={(l) => Math.abs(l.cents) - explainedCents(l, (id) => billCents.get(id) ?? 0, (id) => moveCents.get(id))}
      payeeOf={(l) => linePayee.get(l.id)} actorId={actorId} onLine={onLine} /> : <>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className={`${CARD} p-4`}><p className="text-xs text-gray-400">Months ready</p><p className="text-white text-xl font-semibold mt-1">{ready} of {tallies.length}</p></div>
      <div className={`${CARD} p-4`}><p className="text-xs text-gray-400">Lines answered</p><p className="text-white text-xl font-semibold mt-1">{settled.toLocaleString('en-MY')} of {lines.length.toLocaleString('en-MY')}</p></div>
      <div className={`${CARD} p-4`}><p className="text-xs text-gray-400">Books entries with no bank line</p><p className="text-white text-xl font-semibold mt-1">{undecided} to check</p></div>
    </div>
    <div className={`${CARD} overflow-hidden divide-y divide-obsidian-400/50`}>
      {tallies.map((t) => {
        const left = t.needs + t.part + t.undecided.length;
        return <button key={t.month} type="button" onClick={() => { setMonth(t.month); setTab('needs'); window.scrollTo({ top: 0 }); }} className="w-full text-left flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-white/5">
          <span className="flex-[999_1_220px] min-w-0">
            <span className="block text-white text-sm font-semibold">{monthLabel(t.month)}</span>
            <span className="block text-gray-400 text-xs">{t.lines} lines · in {plain(t.inCents)} · out {plain(t.outCents)}{t.closingCents !== null ? ` · closed at ${plain(t.closingCents)}` : ''}</span>
          </span>
          <span className="text-xs text-gray-400">{t.done ? '' : `${left} left${t.undecided.length ? `, ${t.undecided.length} books ${t.undecided.length === 1 ? 'entry' : 'entries'}` : ''}`}</span>
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${t.done ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'}`}>{t.done ? 'Ready' : 'Not ready'}</span>
        </button>;
      })}
    </div>
    <button type="button" className="text-xs text-gray-500 underline min-h-[40px]" onClick={() => setReloadFile(true)}>Load the checked file again (adds only lines that are missing)</button>
    </>}
  </div>;
}

// Match old bills car by car: choose a car, see all its bills from every payee,
// and pick the bank line that paid each one. A bill paid in two transfers takes
// one line for part of it, then another line for the rest. Drafts only.
type Paid = { line: BankCheckLine; cents: number };
function ByCar({ lines, bills, roomOf, payeeOf, actorId, onLine }: {
  lines: BankCheckLine[]; bills: BillLite[]; roomOf: (l: BankCheckLine) => number; payeeOf: (l: BankCheckLine) => string | undefined;
  actorId: string; onLine: (l: BankCheckLine) => void;
}) {
  const full = useMemo(() => new Map(bills.map((b) => [b.id, b.cents])), [bills]);
  const paidBy = useMemo(() => {
    const m = new Map<string, Paid[]>();
    for (const l of lines) for (const id of l.details.billIds ?? []) m.set(id, [...(m.get(id) ?? []), { line: l, cents: l.details.billCents?.[id] ?? full.get(id) ?? 0 }]);
    return m;
  }, [lines, full]);
  // Money-out lines that can take bills: not already answered as something else.
  const outLines = useMemo(() => lines.filter((l) => l.cents < 0 && (!l.details.answer || l.details.answer.kind === 'bills' || l.details.answer.kind === 'staff')), [lines]);
  const cars = useMemo(() => {
    const m = new Map<string, { name: string; n: number; open: number }>();
    for (const b of bills) if (b.plate) {
      const x = m.get(b.plate) ?? { name: b.label.split(' · ')[0], n: 0, open: 0 };
      x.n++;
      if ((paidBy.get(b.id) ?? []).reduce((s, p) => s + p.cents, 0) < b.cents) x.open++;
      m.set(b.plate, x);
    }
    return m;
  }, [bills, paidBy]);
  const [carText, setCarText] = useState(''), [all, setAll] = useState(false);
  const key = carText.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const car = cars.get(key);
  const waiting = [...cars.entries()].filter(([, x]) => x.open > 0).sort((a, b) => a[1].name.localeCompare(b[1].name));
  return <div className="space-y-4">
    <label className="block text-xs text-gray-400">Car
      <input className="input w-full sm:max-w-sm rounded-lg px-3 py-2 text-sm mt-1" list="bycar-plates" value={carText} maxLength={20} placeholder="Type a plate, e.g. QAA8563K" onChange={(e) => setCarText(e.target.value)} /></label>
    <datalist id="bycar-plates">{[...cars.values()].sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.name} value={x.name}>{x.n} {x.n === 1 ? 'bill' : 'bills'}, {x.open} not matched</option>)}</datalist>
    {carText.trim() && !car && <p className="text-sm text-gray-400">No bills for {carText.trim().toUpperCase()} in the app.</p>}
    {car ? <CarBills key={key} name={car.name} list={bills.filter((b) => b.plate === key).sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))}
      lines={outLines} paidBy={paidBy} roomOf={roomOf} payeeOf={payeeOf} actorId={actorId} onLine={onLine} onBack={() => setCarText('')} />
      : <div className="space-y-2">
        <p className="text-xs text-gray-500">{waiting.length} cars have bills not matched to a bank line yet. Tap one, or type its plate.</p>
        <div className="flex flex-wrap gap-2">{(all ? waiting : waiting.slice(0, 40)).map(([k, x]) => <button key={k} type="button" onClick={() => setCarText(x.name)}
          className="min-h-[36px] px-3 rounded-full border border-obsidian-400/70 text-sm text-gray-200 hover:bg-white/5">{x.name} · {x.open}</button>)}</div>
        {waiting.length > 40 && !all && <button type="button" className="text-xs text-gold-400 min-h-[36px]" onClick={() => setAll(true)}>Show all {waiting.length}</button>}
      </div>}
  </div>;
}

function CarBills({ name, list, lines, paidBy, roomOf, payeeOf, actorId, onLine, onBack }: {
  name: string; list: BillLite[]; lines: BankCheckLine[]; paidBy: Map<string, Paid[]>; roomOf: (l: BankCheckLine) => number;
  payeeOf: (l: BankCheckLine) => string | undefined; actorId: string; onLine: (l: BankCheckLine) => void; onBack: () => void;
}) {
  const paidOf = (b: BillLite) => (paidBy.get(b.id) ?? []).reduce((s, p) => s + p.cents, 0);
  const open = list.filter((b) => paidOf(b) < b.cents);
  const leftOf = new Map(open.map((b) => [b.id, b.cents - paidOf(b)]));
  const cands = new Map(open.map((b) => [b.id, linesForBill(b, lines, roomOf, payeeOf, leftOf.get(b.id)).slice(0, 12)]));
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('');
  // What each chosen bill pays on its line: going down the bills, each takes what
  // is left of the bill or what is left of the line, whichever is smaller.
  const alloc = (p: Record<string, string>) => {
    const room = new Map<string, number>(), part = new Map<string, number>();
    for (const b of open) {
      const l = lineById.get(p[b.id] ?? '');
      if (!l) continue;
      const r = room.get(l.id) ?? roomOf(l), c = Math.min(leftOf.get(b.id)!, r);
      part.set(b.id, c); room.set(l.id, r - c);
    }
    return { part, room };
  };
  const roomFor = (p: Record<string, string>, b: BillLite, l: BankCheckLine) => alloc({ ...p, [b.id]: '' }).room.get(l.id) ?? roomOf(l);
  // A likely line names this car: the same amount first, else a bigger transfer to the same payee.
  const likely = (p: Record<string, string>) => {
    const next = { ...p };
    for (const b of open) {
      if (next[b.id]) continue;
      const need = leftOf.get(b.id)!, cs = cands.get(b.id) ?? [], fits = (x: { line: BankCheckLine }) => roomFor(next, b, x.line) >= need;
      const c = cs.find((x) => x.plate && x.exact && fits(x)) ?? cs.find((x) => x.plate && x.payee && fits(x));
      if (c) next[b.id] = c.line.id;
    }
    return next;
  };
  const count = (p: Record<string, string>) => Object.values(p).filter(Boolean).length;
  const canFill = count(likely(pick)) - count(pick);
  const { part } = alloc(pick);
  const picked = Object.entries(pick).filter(([, l]) => l);
  const over = picked.some(([b]) => (part.get(b) ?? 0) <= 0);
  const save = async () => {
    setBusy(true); setError(''); setDone('');
    let n = 0;
    try {
      const byLine = new Map<string, string[]>();
      for (const [b, l] of picked) byLine.set(l, [...(byLine.get(l) ?? []), b]);
      for (const [lineId, ids] of byLine) {
        const l = lineById.get(lineId)!;
        const had = new Set(l.details.billIds ?? []), parts = { ...(l.details.billCents ?? {}) };
        for (const id of ids) {
          const whole = list.find((b) => b.id === id)!.cents;
          const now = (had.has(id) ? parts[id] ?? whole : 0) + part.get(id)!;
          if (now < whole) parts[id] = now; else delete parts[id];
        }
        const answer = l.details.answer ?? { kind: 'bills', at: new Date().toISOString(), by: actorId };
        onLine(await saveLine(l.id, { details: { ...l.details, billIds: [...new Set([...had, ...ids])], billCents: Object.keys(parts).length ? parts : undefined, payee: l.details.payee || list.find((b) => b.id === ids[0])?.payee, answer } }));
        n += ids.length;
      }
      setPick({}); setDone(`Saved: ${n} ${n === 1 ? 'bill' : 'bills'} matched to their bank lines.`);
    } catch (e) { setError(errorText(e, `Could not save all of them. ${n} saved before this.`)); } finally { setBusy(false); }
  };
  const undo = async (b: BillLite, l: BankCheckLine) => {
    setBusy(true); setError(''); setDone('');
    const { [b.id]: _gone, ...parts } = l.details.billCents ?? {};
    try { onLine(await saveLine(l.id, { details: { ...l.details, billIds: (l.details.billIds ?? []).filter((x) => x !== b.id), billCents: Object.keys(parts).length ? parts : undefined } })); }
    catch (e) { setError(errorText(e, 'Could not undo.')); } finally { setBusy(false); }
  };
  const short = (s: string) => (s.length > 28 ? s.slice(0, 27) + '…' : s);
  return <div className={`${CARD} p-4 space-y-3`}>
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <p className="text-white font-semibold">{name}</p>
        <p className="text-xs text-gray-400">{list.length} {list.length === 1 ? 'bill' : 'bills'} · {formatCents(list.reduce((s, b) => s + b.cents, 0))} · {list.length - open.length} fully matched to bank lines</p>
      </div>
      <button type="button" className="text-xs text-gold-400 min-h-[36px]" onClick={onBack}>Choose another car</button>
    </div>
    <div className="rounded-lg border border-obsidian-400/60 divide-y divide-obsidian-400/40">
      {list.map((b) => {
        const paid = paidBy.get(b.id) ?? [], left = leftOf.get(b.id) ?? 0, cs = cands.get(b.id) ?? [];
        return <div key={b.id} className="px-3 py-3 text-sm space-y-2">
          <div className="flex flex-wrap justify-between gap-x-3">
            <span className="text-white min-w-0">{b.label.split(' · ').slice(1).join(' · ') || b.label}<span className="text-gray-500"> · {b.payee || 'no payee'} · keyed {dayLabel(b.date)} {b.date.slice(0, 4)}</span></span>
            <span className="text-white">{plain(b.cents)}</span>
          </div>
          {paid.map((p) => <p key={p.line.id} className="text-xs text-emerald-300">{p.cents < b.cents ? `${plain(p.cents)} paid` : 'Paid'} by the bank line on {dayLabel(p.line.date)} {p.line.date.slice(0, 4)} · {p.line.details.who || p.line.text} · {plain(-p.line.cents)}
            <button type="button" className="underline text-gray-400 ml-2 min-h-[32px]" disabled={busy} onClick={() => void undo(b, p.line)}>Undo</button></p>)}
          {left > 0 && (cs.length ? <>
            {paid.length > 0 && <p className="text-xs text-gold-300">{plain(left)} still to match</p>}
            <select className="input w-full rounded-lg px-3 py-2 text-sm" value={pick[b.id] ?? ''} aria-label={`Bank line that paid ${b.label}`} onChange={(e) => setPick((p) => ({ ...p, [b.id]: e.target.value }))}>
              <option value="">Which bank line paid it? Choose…</option>
              {cs.map((c) => { const room = roomFor(pick, b, c.line); return <option key={c.line.id} value={c.line.id} disabled={room <= 0}>
                {dayLabel(c.line.date)} {c.line.date.slice(0, 4)} · {c.line.details.who || c.line.text}{c.line.details.memo ? ` "${short(c.line.details.memo)}"` : ''} · {plain(-c.line.cents)}{c.exact ? ' · same amount' : room < left ? ` · pays ${plain(Math.max(0, room))} of it` : ` · ${plain(room)} left to explain`}</option>; })}
            </select>
            {pick[b.id] && (part.get(b.id) ?? 0) > 0 && (part.get(b.id) ?? 0) < left && <p className="text-xs text-sky-200">That line pays {plain(part.get(b.id)!)} of it. Save, then choose the line that paid the other {plain(left - part.get(b.id)!)}.</p>}
          </> : <p className="text-xs text-gray-500">No bank line names this car or {b.payee || 'its payee'} with room for it. If it was paid inside a bigger transfer, open that line from its month and tick it there.</p>)}
        </div>;
      })}
    </div>
    {over && <p className="text-sm text-amber-200">One bank line has no room left for a bill chosen on it. Change that choice.</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {done && <p className="text-sm text-emerald-300">{done}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {canFill > 0 && <button type="button" className="btn-ghost px-4 py-2.5 rounded-lg text-sm" disabled={busy} onClick={() => setPick((p) => likely(p))}>Fill in the likely lines ({canFill})</button>}
      <button type="button" className="btn-gold px-5 py-2.5 rounded-lg text-sm" disabled={busy || !picked.length || over} onClick={() => void save()}>{busy ? 'Saving…' : `Save ${picked.length} ${picked.length === 1 ? 'bill' : 'bills'}`}</button>
    </div>
    <p className="text-xs text-gray-500">Check each choice before you save. {DRAFT_NOTE}</p>
  </div>;
}

function LoadFile({ bank, have, actorId, uploadId, before, onDone, onCancel }: { bank: BankRow; have: BankCheckLine[]; actorId: string; uploadId: string; before: string; onDone: () => Promise<void>; onCancel?: () => void }) {
  const [found, setFound] = useState<{ name: string; lines: CheckedLine[]; months: CheckedMonth[]; openingCents: number } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const ids = useMemo(() => (found ? lineIds(bank.id, found.lines) : []), [found, bank.id]);
  const haveIds = useMemo(() => new Set(have.map((l) => l.id)), [have]);
  const fresh = found ? found.lines.map((l, i) => ({ ...l, id: ids[i], seq: i + 1 })).filter((l) => !haveIds.has(l.id)) : [];
  const pick = async (file: File) => {
    setError(''); setFound(null);
    try {
      const r = readCheckedLines(JSON.parse(await file.text()), bank);
      if ('problem' in r) setError('Not loaded. ' + r.problem); else setFound({ name: file.name, ...r });
    } catch { setError('Not loaded. This file could not be read.'); }
  };
  const add = async () => {
    if (!found) return;
    setBusy(true); setError('');
    try {
      const { data, error: readError } = await financeFrom('bank_statement_uploads').select('*').eq('id', uploadId).range(0, 0);
      if (readError) throw new Error(readError.message);
      if (!(data ?? []).length) await insertRows('bank_statement_uploads', [{ id: uploadId, file_path: 'not-stored', file_name: found.name.slice(0, 200), uploaded_by: actorId, status: 'ready' }]);
      for (let i = 0; i < fresh.length; i += 200) {
        setProgress(`Adding lines ${i + 1}–${Math.min(i + 200, fresh.length)} of ${fresh.length}…`);
        await insertRows('bank_transactions', fresh.slice(i, i + 200).map((l) => ({
          id: l.id, upload_id: uploadId, txn_date: l.date, description: (l.type || l.who || 'Bank line').slice(0, 500), amount: Math.abs(l.cents) / 100,
          direction: l.cents < 0 ? 'debit' : 'credit', status: 'unmatched',
          details: { bankId: bank.id, seq: l.seq, balanceCents: l.balanceCents, history: true, ...(l.who ? { who: l.who } : {}), ...(l.memo ? { memo: l.memo } : {}), ...(l.ref ? { ref: l.ref } : {}) },
        })));
      }
      await onDone();
    } catch (e) { setError(errorText(e, 'Could not add the lines.')); } finally { setBusy(false); setProgress(''); }
  };
  return <div className="space-y-4">
    <div>
      <h2 className="font-display text-white font-bold text-xl">Before {before}</h2>
      <p className="text-gray-400 text-sm">{bank.name}</p>
    </div>
    <div className={`${CARD} p-5 space-y-3`}>
      <p className="text-white font-semibold">Load the old statements</p>
      <p className="text-sm text-gray-400">Choose the checked-lines file Claude made from your statements. Before anything is added, the app checks every line: each balance must follow from the one before, each month must match the totals printed on its statement, and the last balance must be {formatCents(bank.openingCents)}, the figure this bank starts with on {before}. If anything does not match, nothing is added.</p>
      <label className={`btn-ghost px-4 py-2 rounded-lg text-sm inline-flex items-center gap-2 ${busy ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}><Upload size={14} />Choose the file
        <input type="file" accept=".json,application/json" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f); }} /></label>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {found && <div className="space-y-3">
        <p className="text-sm text-emerald-300">Every line checks out: {found.lines.length.toLocaleString('en-MY')} lines, {formatCents(found.openingCents)} on {dayLabel(found.lines[0].date)} {found.lines[0].date.slice(0, 4)} to {formatCents(bank.openingCents)} on {dayLabel(found.lines[found.lines.length - 1].date)}.</p>
        <div className="rounded-lg border border-obsidian-400/60 divide-y divide-obsidian-400/40 text-sm">
          {found.months.map((m) => <div key={m.month} className="flex flex-wrap justify-between gap-x-4 px-3 py-2">
            <span className="text-white w-36">{monthLabel(m.month)}</span>
            <span className="text-gray-400">in {plain(m.creditCents)} ({m.credits}) · out {plain(m.debitCents)} ({m.debits}) · closed {plain(m.closingCents)}</span>
          </div>)}
        </div>
        <p className="text-xs text-gray-500">{fresh.length === found.lines.length ? `${fresh.length.toLocaleString('en-MY')} lines will be added.` : `${fresh.length.toLocaleString('en-MY')} of these lines are not here yet and will be added.`} RM 0.00 lines are left out. {DRAFT_NOTE}</p>
        {progress && <p className="text-sm text-sky-200">{progress} Keep this page open.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-gold px-5 py-2.5 rounded-lg text-sm" disabled={busy || !fresh.length} onClick={() => void add()}>{busy ? 'Adding…' : fresh.length ? `Add ${fresh.length.toLocaleString('en-MY')} lines` : 'Every line is already here'}</button>
          {onCancel && <button type="button" className="btn-ghost px-4 py-2.5 rounded-lg text-sm" disabled={busy} onClick={onCancel}>Go back</button>}
        </div>
      </div>}
      {!found && onCancel && <button type="button" className="text-xs text-gray-400 underline" onClick={onCancel}>Go back</button>}
    </div>
  </div>;
}

function lineHint(l: BankCheckLine, s: HistoryState, hint: Suggestion | undefined, left: number) {
  const memo = l.details.memo ? `"${l.details.memo}" · ` : '';
  if (s === 'linked') return memo + 'Matches ' + [l.details.linkIds?.length ? `${l.details.linkIds.length} books ${l.details.linkIds.length === 1 ? 'entry' : 'entries'}` : '', (l.details.billIds?.length ?? 0) + (l.details.toAdd?.length ?? 0) ? `${(l.details.billIds?.length ?? 0) + (l.details.toAdd?.length ?? 0)} bills` : ''].filter(Boolean).join(' and ');
  if (s === 'answered') return memo + 'You said: ' + historyKindLabel(l.details.answer?.kind) + (l.details.answer?.type ? ` · ${l.details.answer.type}` : '') + (l.details.answer?.car ? ` · ${l.details.answer.car}` : '');
  if (s === 'part') return memo + `Started · ${formatCents(left)} still to explain`;
  if (hint?.kind === 'entry') return memo + `Likely: ${hint.move.label} (${dayLabel(hint.move.date)})`;
  if (hint?.kind === 'bills') return memo + `Likely: ${hint.bills.length === 1 ? hint.bills[0].label : `${hint.bills.length} bills from ${hint.payee}`}`;
  return memo + (l.cents > 0 ? 'What was this money?' : 'Tick the bills, or say what it was');
}

// A suggested bill can be what is left of a bill another line paid part of:
// then this line pays only that part.
const hintPatch = (l: BankCheckLine, h: Suggestion, actorId: string, full: Map<string, number>, moveFull: Map<string, number>): BankCheckDetails => {
  if (h.kind === 'entry') { const whole = Math.abs(moveFull.get(h.move.id) ?? h.move.cents), c = Math.abs(h.move.cents); return { ...l.details, linkIds: [h.move.id], ...(c < whole ? { linkCents: { [h.move.id]: c } } : {}) }; }
  const parts = Object.fromEntries(h.bills.filter((b) => b.cents < (full.get(b.id) ?? b.cents)).map((b) => [b.id, b.cents]));
  return { ...l.details, payee: h.payee, billIds: h.bills.map((b) => b.id), ...(Object.keys(parts).length ? { billCents: parts } : {}), answer: { kind: 'bills', at: new Date().toISOString(), by: actorId } };
};

function MonthView({ tally, lines, states, hints, notes, notesSetUp, tab, setTab, actorId, billCents, moveCents, onBack, onOpen, onLine, onNote }: {
  tally: MonthTally; lines: BankCheckLine[]; states: Map<string, HistoryState>; hints: Map<string, Suggestion>; notes: Record<string, EntryNote>; notesSetUp: boolean | null;
  tab: Tab; setTab: (t: Tab) => void; actorId: string; billCents: Map<string, number>; moveCents: Map<string, number>;
  onBack: () => void; onOpen: (id: string) => void; onLine: (l: BankCheckLine) => void; onNote: (entryId: string, note: EntryNote | null) => Promise<void>;
}) {
  const inTab = (t: Tab, s: HistoryState) => t === 'all' || (t === 'needs' ? s === 'needs' || s === 'part' : s === t);
  // Search by name, memo, reference or type, e.g. "STAMP FEE".
  const [q, setQ] = useState('');
  const found = (l: BankCheckLine) => !q.trim() || `${l.details.who ?? ''} ${l.text} ${l.details.memo ?? ''} ${l.details.ref ?? ''}`.toLowerCase().includes(q.trim().toLowerCase());
  const shown = lines.filter((l) => inTab(tab, states.get(l.id)!) && found(l));
  const count = (t: Tab) => lines.filter((l) => inTab(t, states.get(l.id)!) && found(l)).length;
  const offered = lines.filter((l) => states.get(l.id) === 'needs' && hints.has(l.id));
  const [review, setReview] = useState(false), [picked, setPicked] = useState<Set<string>>(new Set()), [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('');
  // Answer several lines at once: tick them, then one answer saves to each.
  const [selecting, setSelecting] = useState(false), [sel, setSel] = useState<Set<string>>(new Set()), [bulkSaved, setBulkSaved] = useState('');
  const ticked = lines.filter((l) => sel.has(l.id));
  const tick = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const leftOf = (l: BankCheckLine) => Math.abs(l.cents) - explainedCents(l, (id) => billCents.get(id) ?? 0, (id) => moveCents.get(id));
  const saveAll = async () => {
    setBusy(true); setError('');
    try {
      const todo = offered.filter((l) => picked.has(l.id));
      for (let i = 0; i < todo.length; i++) {
        setProgress(`Saving ${i + 1} of ${todo.length}…`);
        onLine(await saveLine(todo[i].id, { details: hintPatch(todo[i], hints.get(todo[i].id)!, actorId, billCents, moveCents) }));
      }
      setReview(false);
    } catch (e) { setError(errorText(e, 'Could not save. The ones before this are saved.')); } finally { setBusy(false); setProgress(''); }
  };
  const left = tally.needs + tally.part;
  return <div className="space-y-4">
    <button type="button" onClick={onBack} className="text-gold-400 text-sm inline-flex items-center gap-1 min-h-[40px]"><ArrowLeft size={14} />All months</button>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-white font-bold text-xl">{monthLabel(tally.month)}</h2>
        <p className="text-gray-400 text-sm">{tally.lines} lines · {DRAFT_NOTE}</p>
      </div>
      <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${tally.done ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'}`}>{tally.done ? 'Ready' : 'Not ready'}</span>
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      <div className={`${CARD} p-4 space-y-1 text-sm`}>
        <p className="text-xs text-gray-400">The statement</p>
        <div className="flex justify-between gap-3"><span className="text-gray-400">Opened</span><span className="text-white">{tally.openingCents === null ? '—' : formatCents(tally.openingCents)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-gray-400">Money in</span><span className="text-emerald-300">{formatCents(tally.inCents)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-gray-400">Money out</span><span className="text-white">{formatCents(tally.outCents)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-gray-400">Closed</span><span className="text-white font-semibold">{tally.closingCents === null ? '—' : formatCents(tally.closingCents)}</span></div>
      </div>
      <div className={`${CARD} p-4 space-y-1 text-sm`}>
        <p className="text-xs text-gray-400">Answered so far</p>
        <div className="flex justify-between gap-3"><span className="text-gray-400">Money in</span><span className="text-white">{plain(tally.answeredInCents)} of {plain(tally.inCents)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-gray-400">Money out</span><span className="text-white">{plain(tally.answeredOutCents)} of {plain(tally.outCents)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-gray-400">Matched to the books</span><span className="text-white">{tally.linked} lines</span></div>
      </div>
      <div className="rounded-xl border border-gold-500/40 bg-gold-500/10 p-4 space-y-1 text-sm">
        <p className="text-xs text-gray-400">Left to do</p>
        <div className="flex justify-between gap-3"><span className="text-gray-400">Bank lines</span><span className="text-gold-300 font-semibold">{left}</span></div>
        <div className="flex justify-between gap-3"><span className="text-gray-400">Books entries with no line</span><span className="text-gold-300 font-semibold">{tally.undecided.length}</span></div>
        <p className="text-xs text-gray-500 pt-1">The month is ready when both are 0.</p>
      </div>
    </div>

    {offered.length > 0 && !review && <div className="rounded-lg border border-sky-400/30 bg-sky-400/10 p-3 flex flex-wrap items-center justify-between gap-2 text-sm text-sky-100">
      <span>Claude found a likely partner for {offered.length} {offered.length === 1 ? 'line' : 'lines'} in this month: the same amount, on or near the same day.</span>
      <button type="button" className="btn-ghost px-4 py-2 rounded-lg text-sm" onClick={() => { setPicked(new Set(offered.map((l) => l.id))); setReview(true); setError(''); }}>Check them</button>
    </div>}
    {review && <div className={`${CARD} p-4 space-y-3 border-gold-500/40`}>
      <p className="text-white font-semibold">Check each pair. Untick any that are wrong.</p>
      <div className="rounded-lg border border-obsidian-400/60 divide-y divide-obsidian-400/40 max-h-[60vh] overflow-y-auto">
        {offered.map((l) => { const h = hints.get(l.id)!; return <label key={l.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5 text-sm cursor-pointer">
          <input type="checkbox" className="w-5 h-5 mt-0.5 accent-[#EAB820]" checked={picked.has(l.id)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} />
          <span className="flex-1 min-w-[200px]"><span className="block text-white">{dayLabel(l.date)} · {l.details.who || l.text}</span>
            <span className="block text-gray-400 text-xs">{h.kind === 'entry' ? `Books: ${h.move.label} · ${dayLabel(h.move.date)}` : `${h.bills.length === 1 ? 'Bill' : `${h.bills.length} bills`} from ${h.payee}: ${h.bills.slice(0, 3).map((b) => b.label).join(', ')}${h.bills.length > 3 ? '…' : ''}`}</span></span>
          <span className="w-28 text-right text-white">{signed(l.cents)}</span>
        </label>; })}
      </div>
      {progress && <p className="text-sm text-sky-200">{progress}</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="btn-gold px-5 py-2.5 rounded-lg text-sm" disabled={busy || !picked.size} onClick={() => void saveAll()}>{busy ? 'Saving…' : `Save ${picked.size} as drafts`}</button>
        <button type="button" className="btn-ghost px-4 py-2.5 rounded-lg text-sm" disabled={busy} onClick={() => setReview(false)}>Go back</button>
        <span className="text-xs text-gray-500">Drafts only. You can start any line again later.</span>
      </div>
    </div>}

    <div className="flex flex-wrap gap-2" role="group" aria-label="Show lines">
      {([['needs', 'Needs you'], ['answered', 'Answered'], ['linked', 'Matched'], ['all', 'All']] as [Tab, string][]).map(([t, name]) =>
        <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}
          className={`min-h-[40px] px-4 rounded-full text-sm ${tab === t ? 'bg-gold-gradient text-obsidian-950 font-semibold' : 'border border-obsidian-400/70 text-gray-200'}`}>{name} · {count(t)}</button>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <input className="input rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]" type="search" placeholder="Search this month, e.g. STAMP FEE or a name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search this month" />
      <button type="button" aria-pressed={selecting} onClick={() => { setSelecting((s) => !s); setSel(new Set()); setBulkSaved(''); }}
        className={`min-h-[40px] px-4 rounded-lg text-sm ${selecting ? 'bg-gold-gradient text-obsidian-950 font-semibold' : 'btn-ghost'}`}>{selecting ? 'Done ticking' : 'Answer several at once'}</button>
    </div>
    {bulkSaved && <p className="text-sm text-emerald-300">{bulkSaved}</p>}
    {selecting && <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="text-gray-400">Tick the lines that have the same answer.</span>
      <button type="button" className="text-gold-400 min-h-[36px]" onClick={() => setSel((s) => new Set([...s, ...shown.map((l) => l.id)]))}>Tick all {shown.length} shown</button>
      {sel.size > 0 && <button type="button" className="text-gold-400 min-h-[36px]" onClick={() => setSel(new Set())}>Untick all</button>}
    </div>}
    <div className={`${CARD} overflow-hidden divide-y divide-obsidian-400/50`}>
      {shown.length === 0 && <p className="text-gray-500 text-sm text-center py-8">Nothing here.</p>}
      {shown.map((l) => {
        const st = states.get(l.id)!;
        const body = <>
          <span className="flex-[999_1_320px] min-w-0">
            <span className="block text-xs text-gray-500">{dayLabel(l.date)} · {l.cents > 0 ? 'Money in' : 'Money out'}</span>
            <span className="block text-white text-sm font-semibold truncate">{l.details.who || l.text}</span>
            <span className="block text-gray-400 text-xs truncate">{lineHint(l, st, hints.get(l.id), leftOf(l))}</span>
          </span>
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${CHIP[st][1]}`}>{CHIP[st][0]}</span>
          <span className={`flex-[0_0_120px] text-right text-sm font-semibold ${l.cents > 0 ? 'text-emerald-300' : 'text-white'}`}>{signed(l.cents)}</span>
        </>;
        return selecting
          ? <label key={l.id} className={`w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 cursor-pointer ${sel.has(l.id) ? 'bg-gold-500/10' : 'hover:bg-white/5'}`}>
            <input type="checkbox" className="w-5 h-5 accent-[#EAB820]" checked={sel.has(l.id)} onChange={() => tick(l.id)} />{body}</label>
          : <button key={l.id} type="button" onClick={() => { onOpen(l.id); window.scrollTo({ top: 0 }); }} className="w-full text-left flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-white/5">{body}</button>;
      })}
    </div>
    {selecting && ticked.length > 0 && <BulkAnswer key={ticked.some((l) => l.cents > 0) && ticked.some((l) => l.cents < 0) ? 'mixed' : ticked[0].cents > 0 ? 'in' : 'out'}
      lines={ticked} actorId={actorId} onLine={onLine} onDone={(n) => { setSel(new Set()); setBulkSaved(`Saved the answer to ${n} ${n === 1 ? 'line' : 'lines'}.`); }} />}

    <UnlinkedEntries tally={tally} notes={notes} notesSetUp={notesSetUp} actorId={actorId} onNote={onNote} />
  </div>;
}

// One answer for several ticked lines. Bills are ticked on each line's own page,
// so they are not offered here. Each line keeps its links and ticked bills; only
// its answer is set. Drafts only.
function BulkAnswer({ lines, actorId, onLine, onDone }: { lines: BankCheckLine[]; actorId: string; onLine: (l: BankCheckLine) => void; onDone: (n: number) => void }) {
  const inCents = lines.filter((l) => l.cents > 0).reduce((s, l) => s + l.cents, 0), outCents = -lines.filter((l) => l.cents < 0).reduce((s, l) => s + l.cents, 0);
  const mixed = inCents > 0 && outCents > 0;
  const kinds = mixed ? [['other', 'Other']] : (outCents > 0 ? HISTORY_OUT_KINDS : HISTORY_IN_KINDS).filter(([k]) => k !== 'bills' && k !== 'staff');
  const [kind, setKind] = useState(''), [type, setType] = useState(''), [car, setCar] = useState(''), [month, setMonth] = useState(''), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const ready = !busy && !!kind && (kind !== 'other' || note.trim().length > 0);
  const save = async () => {
    setBusy(true); setError('');
    const answer = { kind, ...(type.trim() ? { type: type.trim().slice(0, 120) } : {}), ...(car.trim() ? { car: car.trim().slice(0, 40) } : {}), ...(month.trim() ? { month: month.trim().slice(0, 60) } : {}), ...(note.trim() ? { note: note.trim().slice(0, 1000) } : {}), at: new Date().toISOString(), by: actorId };
    let done = 0;
    try {
      for (const l of lines) {
        setProgress(`Saving ${done + 1} of ${lines.length}…`);
        onLine(await saveLine(l.id, { details: { ...l.details, answer } }));
        done++;
      }
      onDone(done);
    } catch (e) { setError(errorText(e, `Could not save. ${done} of ${lines.length} were saved.`)); } finally { setBusy(false); setProgress(''); }
  };
  const field = 'input w-full rounded-lg px-3 py-2 text-sm mt-1';
  return <div className="sticky bottom-2 z-10 rounded-xl border border-gold-500/50 bg-obsidian-800 p-4 space-y-3 shadow-lg shadow-black/60">
    <p className="text-white text-sm font-semibold">{lines.length} {lines.length === 1 ? 'line' : 'lines'} ticked{inCents ? ` · in ${plain(inCents)}` : ''}{outCents ? ` · out ${plain(outCents)}` : ''}</p>
    {mixed && <p className="text-xs text-amber-200">You ticked money in and money out together, so only "Other" fits both.</p>}
    <label className="block text-xs text-gray-400">What were they?
      <select className={field} value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="">Choose…</option>
        {kinds.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
      </select></label>
    {kind && <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs text-gray-400">Who or what (optional)<input className={field} value={type} maxLength={120} placeholder="e.g. a name, Rent" onChange={(e) => setType(e.target.value)} /></label>
      <label className="text-xs text-gray-400">Car (optional)<input className={field} value={car} maxLength={40} placeholder="Plate" onChange={(e) => setCar(e.target.value)} /></label>
      <label className="text-xs text-gray-400">For which month (optional)<input className={field} value={month} maxLength={60} placeholder="e.g. December 2025" onChange={(e) => setMonth(e.target.value)} /></label>
      <label className="text-xs text-gray-400 sm:col-span-3">{kind === 'other' ? 'What were they? (needed)' : 'Note (optional)'}<input className={field} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
    </div>}
    <p className="text-xs text-gray-500">Bills are ticked on each line's own page. Lines that already have an answer get this one instead. Drafts only.</p>
    {progress && <p className="text-sm text-sky-200">{progress}</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <button type="button" className="btn-gold px-5 py-2.5 rounded-lg text-sm" disabled={!ready} onClick={() => void save()}>{busy ? 'Saving…' : `Save this answer to ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`}</button>
  </div>;
}

// Books entries of the month that no bank line stands for. Either a line is this
// money (open the line and link it), or say what it was.
function UnlinkedEntries({ tally, notes, notesSetUp, actorId, onNote }: { tally: MonthTally; notes: Record<string, EntryNote>; notesSetUp: boolean | null; actorId: string; onNote: (entryId: string, note: EntryNote | null) => Promise<void> }) {
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [text, setText] = useState<Record<string, string>>({});
  const set = async (id: string, how: EntryNote['how'] | null) => {
    setBusy(id); setError('');
    try { await onNote(id, how ? { how, ...(text[id]?.trim() ? { note: text[id].trim().slice(0, 500) } : {}), at: new Date().toISOString(), by: actorId } : null); }
    catch (e) { setError(errorText(e, 'Could not save.')); } finally { setBusy(''); }
  };
  if (!tally.unlinked.length) return null;
  return <section className={`${CARD} p-4 space-y-3`} aria-labelledby="no-line">
    <div>
      <p id="no-line" className="text-white text-sm font-semibold">In the books, but no bank line yet · {tally.unlinked.length}</p>
      <p className="text-xs text-gray-400">If a bank line above is this money (even with a different amount), open that line and link this entry. If not, say what it was.</p>
    </div>
    {notesSetUp === false && <p className="text-xs text-amber-200">Saving these answers needs a one-time setup in the database. Ask Claude for the setup step.</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <div className="rounded-lg border border-obsidian-400/60 divide-y divide-obsidian-400/40">
      {tally.unlinked.map((m) => { const n = notes[m.id]; return <div key={m.id} className="px-3 py-2.5 text-sm space-y-2">
        <div className="flex flex-wrap justify-between gap-x-3"><span className="text-white min-w-0">{dayLabel(m.date)} · {m.label}</span><span className="text-white">{signed(m.cents)}</span></div>
        {n ? <p className="text-xs text-violet-200">You said: {n.how === 'wrong' ? 'Not real money. Remove it in the books step.' : 'Not through this bank (cash, or someone else paid).'}{n.note ? ` · ${n.note}` : ''} <button type="button" className="underline text-gray-400 ml-2" disabled={!!busy} onClick={() => void set(m.id, null)}>Change</button></p>
          : <div className="flex flex-wrap items-center gap-2 text-xs">
            <input className="input rounded-lg px-3 py-1.5 text-xs flex-1 min-w-[180px]" placeholder="Note (optional)" maxLength={500} value={text[m.id] ?? ''} onChange={(e) => setText((t) => ({ ...t, [m.id]: e.target.value }))} />
            <button type="button" className="btn-ghost px-3 py-1.5 rounded-lg" disabled={!!busy || notesSetUp === false} onClick={() => void set(m.id, 'elsewhere')}>Not through this bank</button>
            <button type="button" className="btn-ghost px-3 py-1.5 rounded-lg" disabled={!!busy || notesSetUp === false} onClick={() => void set(m.id, 'wrong')}>Not real money</button>
          </div>}
      </div>; })}
    </div>
  </section>;
}

// covered: how much of each bill other lines already pay. parts: the part of a
// ticked bill this line pays, when less than the whole bill.
function BillRows({ bills, ticked, onToggle, covered, parts, onPart }: {
  bills: BillLite[]; ticked?: Set<string>; onToggle?: (id: string) => void; covered?: Map<string, number>;
  parts?: Record<string, number>; onPart?: (id: string, cents: number) => void;
}) {
  return <div className="rounded-lg border border-obsidian-400/60 divide-y divide-obsidian-400/40">
    {bills.map((b) => {
      const elsewhere = covered?.get(b.id) ?? 0, left = b.cents - elsewhere, on = !!ticked?.has(b.id), taken = left <= 0 && !on;
      const part = parts?.[b.id] ?? b.cents;
      const body = <>
        <span className="flex-1 min-w-[160px] text-gray-300">{b.label}<span className="text-gray-500">{b.payee ? ` · ${b.payee}` : ''} · keyed {dayLabel(b.date)}</span>
          {taken && <span className="ml-2 text-[11px] text-amber-300">paid on another line</span>}
          {!on && !taken && elsewhere > 0 && <span className="ml-2 text-[11px] text-amber-300">{plain(left)} left; another line paid {plain(elsewhere)}</span>}</span>
        <span className="w-28 text-right text-white">{plain(b.cents)}</span>
      </>;
      if (!onToggle) return <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">{body}</div>;
      return <div key={b.id} className="px-3 py-2.5 text-sm space-y-2">
        <label className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${taken ? 'opacity-50' : 'cursor-pointer'}`}><input type="checkbox" className="w-5 h-5 accent-[#EAB820]" disabled={taken} checked={on} onChange={() => onToggle(b.id)} />{body}</label>
        {on && part < b.cents && <p className="pl-8 text-xs text-sky-200 flex flex-wrap items-center gap-2">This line pays
          {onPart ? <PartInput cents={part} max={left} onChange={(c) => onPart(b.id, c)} /> : <span className="text-white">{plain(part)}</span>}
          of this bill.{left - part > 0 ? ` ${plain(left - part)} is left for another line.` : ''}</p>}
      </div>;
    })}
  </div>;
}

function PartInput({ cents, max, onChange }: { cents: number; max: number; onChange: (cents: number) => void }) {
  const [text, setText] = useState(plain(cents));
  useEffect(() => setText(plain(cents)), [cents]);
  const commit = () => { const c = parseRinggit(text); if (c && c <= max) onChange(c); else setText(plain(cents)); };
  return <input className="input w-28 rounded-lg px-2 py-1 text-sm text-right" inputMode="decimal" value={text} aria-label="Amount this line pays of the bill"
    onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />;
}

function HistoryLine({ line, state, hint, moves, bills, covered, usedMoves, billCents, moveCents, actorId, onBack, onChange }: {
  line: BankCheckLine; state: HistoryState; hint?: Suggestion; moves: BankMove[]; bills: BillLite[]; covered: Map<string, number>; usedMoves: Map<string, number>;
  billCents: Map<string, number>; moveCents: Map<string, number>; actorId: string; onBack: () => void; onChange: (l: BankCheckLine) => void;
}) {
  const out = line.cents < 0;
  const kinds = out ? HISTORY_OUT_KINDS : HISTORY_IN_KINDS;
  const [kind, setKind] = useState(line.details.answer?.kind ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [ask, setAsk] = useState(false);
  const left = Math.abs(line.cents) - explainedCents(line, (id) => billCents.get(id) ?? 0, (id) => moveCents.get(id));
  const save = async (details: BankCheckDetails) => {
    setBusy(true); setError('');
    try { onChange(await saveLine(line.id, { details })); } catch (e) { setError(errorText(e, 'Could not save.')); } finally { setBusy(false); }
  };
  return <div className="space-y-4">
    <button type="button" onClick={onBack} className="text-gold-400 text-sm inline-flex items-center gap-1 min-h-[40px]"><ArrowLeft size={14} />{monthLabel(line.date.slice(0, 7))}</button>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] tracking-wider text-gray-500 uppercase">{dayLabel(line.date)} {line.date.slice(0, 4)} · {out ? 'Money out' : 'Money in'}{line.details.memo ? ` · "${line.details.memo}"` : ''}</p>
        <h2 className="font-display text-white font-bold text-xl break-words">{line.details.who || line.text}</h2>
        <p className="text-gray-400 text-xs break-words">{line.details.who ? line.text : ''}{line.details.ref ? ` · ref ${line.details.ref}` : ''}{Number.isSafeInteger(line.details.balanceCents) ? ` · balance after ${formatCents(line.details.balanceCents)}` : ''}</p>
      </div>
      <div className="text-right">
        <p className={`text-2xl font-semibold ${out ? 'text-white' : 'text-emerald-300'}`}>{signed(line.cents)}</p>
        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${CHIP[state][1]}`}>{CHIP[state][0]}</span>
        {state === 'part' && left > 0 && <p className="text-xs text-gold-300 mt-1">{formatCents(left)} still to explain</p>}
      </div>
    </div>
    <p className="text-xs text-sky-200">{DRAFT_NOTE}</p>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

    {hint && !hasDraft(line) && <div className="rounded-xl border border-sky-400/30 bg-sky-400/10 p-4 space-y-3">
      <p className="text-sm text-sky-100">{hint.kind === 'entry' ? 'Likely the same money as this books entry:' : hint.bills.length === 1 ? 'Likely paid this bill:' : `Likely paid these ${hint.bills.length} bills from ${hint.payee}. They add up exactly:`}</p>
      {hint.kind === 'entry'
        ? <div className="flex flex-wrap justify-between gap-3 text-sm"><span className="text-white">{dayLabel(hint.move.date)} · {hint.move.label}</span><span className="text-white">{signed(hint.move.cents)}</span></div>
        : <BillRows bills={hint.bills} />}
      <button type="button" className="btn-gold px-5 py-2 rounded-lg text-sm" disabled={busy} onClick={() => void save(hintPatch(line, hint, actorId, billCents, moveCents))}>{hint.kind === 'entry' ? 'Yes, same money' : hint.bills.length === 1 ? 'Yes, this bill' : 'Yes, these bills'}</button>
    </div>}

    <LinkEntries line={line} moves={moves} covered={usedMoves} busy={busy} onSave={(ids, parts) => void save({ ...line.details, linkIds: ids, linkCents: Object.keys(parts).length ? parts : undefined })} />

    <fieldset className={`${CARD} p-4 space-y-3`}>
      <legend className="sr-only">What was this?</legend>
      <p className="text-white text-sm font-semibold">{out ? 'What was this payment?' : 'What was this money?'}</p>
      <div className="flex flex-wrap gap-2">
        {kinds.map(([k, name]) => <label key={k} className={`min-h-[40px] px-3.5 rounded-full border text-sm inline-flex items-center gap-2 cursor-pointer ${kind === k ? 'border-gold-500/60 bg-gold-500/10 text-white' : 'border-obsidian-400/70 text-gray-300'}`}>
          <input type="radio" name="kind" className="accent-[#EAB820]" checked={kind === k} onChange={() => setKind(k)} />{name}</label>)}
      </div>
    </fieldset>
    {out && (kind === 'bills' || kind === 'staff')
      ? <DraftBills key={kind} line={line} kind={kind} bills={bills} covered={covered} linked={(line.details.linkIds ?? []).reduce((s, id) => s + (line.details.linkCents?.[id] ?? Math.abs(moveCents.get(id) ?? 0)), 0)} actorId={actorId} busy={busy} onSave={(d) => void save(d)} />
      : kind ? <AnswerForm key={kind} line={line} kind={kind} actorId={actorId} onChange={onChange} /> : null}

    {hasDraft(line) && <div className="text-xs text-gray-500">
      {!ask ? <button type="button" className="underline min-h-[40px]" onClick={() => setAsk(true)}>Start this line again</button>
        : <span className="inline-flex flex-wrap items-center gap-2">This clears your answer, links and ticked bills for this line.
          <button type="button" className="btn-ghost px-3 py-1.5 rounded-lg" disabled={busy} onClick={() => { setAsk(false); setKind(''); void save(clearDraft(line.details)); }}>Clear it</button>
          <button type="button" className="underline" onClick={() => setAsk(false)}>Cancel</button></span>}
    </div>}
  </div>;
}

// Books entries with the same direction near the line's day; tick the ones that
// are this money. The amount can differ (for example a car bought for 19,000 that
// the books show as 18,500): the difference is fixed in the books step. An entry
// bigger than the line (a car's booking, then its balance) is split: this line is
// part of it, and another line can be the rest.
function LinkEntries({ line, moves, covered, busy, onSave }: { line: BankCheckLine; moves: BankMove[]; covered: Map<string, number>; busy: boolean; onSave: (ids: string[], parts: Record<string, number>) => void }) {
  const size = (id: string) => Math.abs(moves.find((m) => m.id === id)?.cents ?? 0);
  const leftOf = (id: string) => size(id) - (covered.get(id) ?? 0);
  const [ticked, setTicked] = useState<string[]>(line.details.linkIds ?? []);
  // An entry ticked before splitting existed, bigger than the line: start it as the line's part.
  const [parts, setParts] = useState<Record<string, number>>(() => {
    const p = { ...(line.details.linkCents ?? {}) };
    let room = Math.abs(line.cents);
    for (const id of line.details.linkIds ?? []) { const c = p[id] ?? Math.min(leftOf(id), Math.max(room, 0)); if (c > 0 && c < size(id)) p[id] = c; room -= c; }
    return p;
  });
  const [wide, setWide] = useState(false);
  const days = (a: string) => Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(line.date + 'T00:00:00Z')) / 864e5;
  const near = moves.filter((m) => Math.sign(m.cents) === Math.sign(line.cents) && (ticked.includes(m.id) || days(m.date) <= (wide ? 60 : 15)))
    .sort((a, b) => Number(ticked.includes(b.id)) - Number(ticked.includes(a.id)) || Math.abs(leftOf(a.id) - Math.abs(line.cents)) - Math.abs(leftOf(b.id) - Math.abs(line.cents)) || days(a.date) - days(b.date)).slice(0, wide ? 40 : 12);
  const payOf = (id: string) => parts[id] ?? size(id);
  const total = ticked.reduce((s, id) => s + payOf(id), 0);
  const mine = (p: Record<string, number>, t: string[]) => Object.fromEntries(Object.entries(p).filter(([id]) => t.includes(id)));
  const changed = ticked.join() !== (line.details.linkIds ?? []).join() || JSON.stringify(mine(parts, ticked)) !== JSON.stringify(line.details.linkCents ?? {});
  const toggle = (id: string) => {
    if (ticked.includes(id)) { setTicked((t) => t.filter((x) => x !== id)); setParts(({ [id]: _gone, ...rest }) => rest); return; }
    const room = Math.abs(line.cents) - total, left = leftOf(id), part = room > 0 ? Math.min(left, room) : left;
    setTicked((t) => [...t, id]);
    if (part < size(id)) setParts((p) => ({ ...p, [id]: part }));
  };
  const setPart = (id: string, c: number) => setParts((p) => { if (c >= size(id)) { const { [id]: _gone, ...rest } = p; return rest; } return { ...p, [id]: c }; });
  if (!near.length && !wide) return <p className="text-xs text-gray-500">No books entries for this bank within 15 days of this line. <button type="button" className="underline" onClick={() => setWide(true)}>Look further</button></p>;
  return <div className={`${CARD} p-4 space-y-3`}>
    <div className="flex flex-wrap justify-between gap-2">
      <p className="text-white text-sm font-semibold">Is this money already in the books?</p>
      <button type="button" className="text-xs text-gold-400" onClick={() => setWide((w) => !w)}>{wide ? 'Show only 15 days around it' : 'Look up to 60 days around it'}</button>
    </div>
    <p className="text-xs text-gray-500">Books entries for this bank around {dayLabel(line.date)}, closest amount first. Tick the ones that are this money. If this line is only part of one (a booking, then the balance), tick it anyway: this line takes its part.</p>
    <div className="rounded-lg border border-obsidian-400/60 divide-y divide-obsidian-400/40">
      {near.map((m) => {
        const on = ticked.includes(m.id), elsewhere = covered.get(m.id) ?? 0, left = leftOf(m.id), taken = left <= 0 && !on, part = payOf(m.id);
        return <div key={m.id} className="px-3 py-2.5 text-sm space-y-2">
          <label className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${taken ? 'opacity-50' : 'cursor-pointer'}`}>
            <input type="checkbox" className="w-5 h-5 accent-[#EAB820]" disabled={taken} checked={on} onChange={() => toggle(m.id)} />
            <span className="flex-1 min-w-[160px] text-gray-300">{dayLabel(m.date)} · {m.label}
              {taken && <span className="ml-2 text-[11px] text-amber-300">on other lines</span>}
              {!on && !taken && elsewhere > 0 && <span className="ml-2 text-[11px] text-amber-300">{plain(left)} left; other lines are {plain(elsewhere)}</span>}</span>
            <span className="w-28 text-right text-white">{signed(m.cents)}</span>
          </label>
          {on && part < size(m.id) && <p className="pl-8 text-xs text-sky-200 flex flex-wrap items-center gap-2">This line is
            <PartInput cents={part} max={left} onChange={(c) => setPart(m.id, c)} />
            of this entry.{left - part > 0 ? ` ${plain(left - part)} is left for another line, e.g. the balance.` : ''}</p>}
        </div>;
      })}
      {!near.length && <p className="text-gray-500 text-sm text-center py-4">None.</p>}
    </div>
    {ticked.length > 0 && <p className="text-xs text-gray-400">Ticked {formatCents(total)} · this line {formatCents(Math.abs(line.cents))}{total !== Math.abs(line.cents) ? ` · differs by ${formatCents(Math.abs(total - Math.abs(line.cents)))}. Say what the line was below, and the difference is fixed in the books step.` : ' · the same.'}</p>}
    {changed && <button type="button" className="btn-ghost px-4 py-2 rounded-lg text-sm" disabled={busy} onClick={() => onSave(ticked, mine(parts, ticked))}>Save links</button>}
  </div>;
}

function DraftBills({ line, kind, bills, covered, linked: links, actorId, busy, onSave }: { line: BankCheckLine; kind: string; bills: BillLite[]; covered: Map<string, number>; linked: number; actorId: string; busy: boolean; onSave: (d: BankCheckDetails) => void }) {
  const payees = useMemo(() => [...new Set(bills.map((b) => b.payee).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [bills]);
  const [payee, setPayee] = useState(() => line.details.payee ?? guessPayee(`${line.details.who ?? ''} ${line.text}`, payees) ?? '');
  const [ticked, setTicked] = useState<string[]>(line.details.billIds ?? []);
  const [parts, setParts] = useState<Record<string, number>>(line.details.billCents ?? {});
  const [toAdd, setToAdd] = useState<DraftBill[]>(line.details.toAdd ?? []);
  const [plate, setPlate] = useState(''), [what, setWhat] = useState(''), [amount, setAmount] = useState('');
  const days = (d: string) => (Date.parse(d + 'T00:00:00Z') - Date.parse(line.date + 'T00:00:00Z')) / 864e5;
  const tickedSet = new Set(ticked);
  // Old bills were often keyed months after they were paid, so no date limit here.
  // Find bills by car (every bill on that car, any payee) or by payee. The car
  // starts as the one written on the line, if any.
  const [all, setAll] = useState(false);
  const cars = useMemo(() => { const m = new Map<string, { name: string; n: number }>(); for (const b of bills) if (b.plate) { const x = m.get(b.plate) ?? { name: b.label.split(' · ')[0], n: 0 }; x.n++; m.set(b.plate, x); } return m; }, [bills]);
  const [carText, setCarText] = useState(() => carBills(line, bills)[0]?.label.split(' · ')[0] ?? '');
  const carKey = carText.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const car = cars.get(carKey);
  const carList = car ? bills.filter((b) => b.plate === carKey).sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label)) : [];
  const inCar = new Set(carList.map((b) => b.id));
  const payeeList = payee ? bills.filter((b) => !inCar.has(b.id) && b.payee.toLowerCase() === payee.toLowerCase()).sort((a, b) => Number(tickedSet.has(b.id)) - Number(tickedSet.has(a.id)) || Math.abs(days(a.date)) - Math.abs(days(b.date))) : [];
  const shownPayee = all ? payeeList : payeeList.slice(0, 25);
  const others = bills.filter((b) => tickedSet.has(b.id) && !inCar.has(b.id) && !payeeList.includes(b));
  const total = ticked.reduce((s, id) => s + (parts[id] ?? bills.find((b) => b.id === id)?.cents ?? 0), 0) + toAdd.reduce((s, b) => s + b.cents, 0);
  const still = -line.cents - links - total;
  const cents = parseRinggit(amount);
  // Ticking a bill bigger than what is left of this transfer (or one another line
  // paid part of) makes this line pay only part of it; the rest goes on another line.
  const toggle = (id: string) => {
    if (ticked.includes(id)) { setTicked((t) => t.filter((x) => x !== id)); setParts(({ [id]: _gone, ...rest }) => rest); return; }
    const b = bills.find((x) => x.id === id);
    if (!b) return;
    const left = b.cents - (covered.get(id) ?? 0), part = still > 0 ? Math.min(left, still) : left;
    setTicked((t) => [...t, id]);
    if (part < b.cents) setParts((p) => ({ ...p, [id]: part }));
  };
  const setPart = (id: string, c: number) => setParts((p) => { const b = bills.find((x) => x.id === id); if (b && c >= b.cents) { const { [id]: _gone, ...rest } = p; return rest; } return { ...p, [id]: c }; });
  const rowProps = { ticked: tickedSet, onToggle: toggle, covered, parts, onPart: setPart };
  const field = 'input w-full rounded-lg px-3 py-2 text-sm mt-1';
  return <div className={`${CARD} p-4 space-y-3`}>
    {kind === 'staff' && <p className="text-sm text-sky-200">Choose the staff member as the payee, then tick what they paid for, or add it below.</p>}
    <p className="text-white text-sm font-semibold">Tick the bills this transfer paid</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-gray-400">By car: all its bills
        <input className={field} list={`cars-${line.id}`} value={carText} maxLength={20} placeholder="Type a plate, e.g. QAA8563K" onChange={(e) => setCarText(e.target.value)} /></label>
      <label className="text-xs text-gray-400">By payee
        <select className={field} value={payee} onChange={(e) => setPayee(e.target.value)}>
          <option value="">Choose…</option>
          {[...new Set([...payees, ...(payee ? [payee] : [])])].sort((a, b) => a.localeCompare(b)).map((n) => <option key={n} value={n}>{n}</option>)}
        </select></label>
    </div>
    <datalist id={`cars-${line.id}`}>{[...cars.values()].sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.name} value={x.name}>{x.n} {x.n === 1 ? 'bill' : 'bills'}</option>)}</datalist>
    {carText.trim() && !car && <p className="text-sm text-gray-400">No bills for {carText.trim().toUpperCase()} in the app. If this transfer paid for it, add it below under "Bills that were never keyed in".</p>}
    {car && <><p className="text-xs text-gray-500">Bills on {car.name}, any payee, oldest first:</p><BillRows bills={carList} {...rowProps} /></>}
    {payee ? (payeeList.length ? <>
      <p className="text-xs text-gray-500">{payee}'s {car ? 'other ' : ''}open bills, closest date first.</p>
      <BillRows bills={shownPayee} {...rowProps} />
      {payeeList.length > shownPayee.length && <button type="button" className="text-xs text-gold-400 min-h-[36px]" onClick={() => setAll(true)}>Show all {payeeList.length}</button>}
    </> : <p className="text-sm text-gray-400">{payee} has no {car ? 'other ' : ''}open bills in the app.</p>)
      : !car && <p className="text-sm text-gray-400">Type the car's plate, or choose who this transfer paid.</p>}
    {others.length > 0 && <><p className="text-xs text-gray-500">Also ticked:</p><BillRows bills={others} {...rowProps} /></>}

    <div className="rounded-lg border border-white/10 p-3 space-y-2">
      <p className="text-xs text-gray-300">Bills that were never keyed in (kept as a draft; Claude adds them in the books step)</p>
      {toAdd.length > 0 && <ul className="text-sm space-y-1">{toAdd.map((b, i) => <li key={i} className="flex flex-wrap justify-between gap-2"><span className="text-white">{b.plate} · {b.what}</span><span className="text-white">{plain(b.cents)} <button type="button" className="text-xs text-gray-400 underline ml-2" onClick={() => setToAdd((t) => t.filter((_, j) => j !== i))}>Remove</button></span></li>)}</ul>}
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-xs text-gray-400">Car plate<input className={field} value={plate} maxLength={20} placeholder="QAA1234A" onChange={(e) => setPlate(e.target.value)} /></label>
        <label className="text-xs text-gray-400 sm:col-span-2">What for<input className={field} value={what} maxLength={200} placeholder="e.g. Aircond repair" onChange={(e) => setWhat(e.target.value)} /></label>
        <label className="text-xs text-gray-400">Amount (RM)<input className={field} inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} /></label>
      </div>
      <button type="button" className="btn-ghost px-3 py-1.5 rounded-lg text-xs" disabled={!plate.trim() || !what.trim() || !cents} onClick={() => { setToAdd((t) => [...t, { plate: plate.trim().toUpperCase().slice(0, 20), what: what.trim().slice(0, 200), cents: cents! }]); setPlate(''); setWhat(''); setAmount(''); }}>Add to this line</button>
    </div>

    <div className="rounded-xl border border-gold-500/40 bg-gold-500/10 p-3 grid gap-3 grid-cols-2 sm:grid-cols-4 text-sm">
      <div><p className="text-xs text-gray-400">Transfer</p><p className="text-white font-semibold">{formatCents(-line.cents)}</p></div>
      <div><p className="text-xs text-gray-400">Bills</p><p className="text-white font-semibold">{formatCents(total)}</p></div>
      {links > 0 && <div><p className="text-xs text-gray-400">Linked entries</p><p className="text-white font-semibold">{formatCents(links)}</p></div>}
      <div><p className="text-xs text-gray-400">{still < 0 ? 'Ticked too much by' : 'Still to explain'}</p><p className={`font-semibold ${still === 0 ? 'text-emerald-300' : 'text-gold-300'}`}>{formatCents(Math.abs(still))}</p></div>
    </div>
    <button type="button" className="btn-gold px-5 py-2 rounded-lg text-sm" disabled={busy}
      onClick={() => onSave({ ...line.details, payee: payee || undefined, billIds: ticked, billCents: Object.keys(parts).some((id) => ticked.includes(id)) ? Object.fromEntries(Object.entries(parts).filter(([id]) => ticked.includes(id))) : undefined, toAdd, answer: { kind, at: new Date().toISOString(), by: actorId } })}>{busy ? 'Saving…' : 'Save draft'}</button>
  </div>;
}
