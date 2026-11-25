// Pieces shared by the Bank check page and its "Before 1 Nov" area: a list of
// bills, and the short answer for a line that is not a bill. Saving an answer
// only stores it with the line; it never changes the books.
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import type { Payment } from '../types';
import { formatCents } from '../lib/investorFinance';
import { saveLine } from '../lib/bankCheckLines';
import { guessPayee, type BankCheckLine } from '../lib/bankCheckMatch';
import { CARD, dayLabel, errorText } from '../lib/bankCheckWords';

const OFFICE_TYPES = ['Rent', 'Electricity and water', 'Internet and phone', 'Office supplies', 'Refreshments', 'Uniforms', 'Other'];

export function BillTable({ bills, cars, amountOf, ticked, onToggle, flag, hint }: { bills: Payment[]; cars: { id: string; carPlate?: string }[]; amountOf: (p: Payment) => number; ticked?: Set<string>; onToggle?: (id: string) => void; hint?: (p: Payment) => string | undefined; flag?: (p: Payment) => string | undefined }) {
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

export function AnswerForm({ line, kind, actorId, onChange }: { line: BankCheckLine; kind: string; actorId: string; onChange: (l: BankCheckLine) => void }) {
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
  const needsCar = ['car_purchase', 'car_sale', 'booking', 'garage', 'customer_refund', 'loan_in', 'loan_payoff', 'investor_in', 'investor_out'].includes(kind);
  const needsMonth = ['office', 'salary'].includes(kind);
  const investor = kind === 'investor_in' || kind === 'investor_out';
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
  return <div className={`${CARD} p-4 space-y-3`}>
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
      {investor && <label className="text-xs text-gray-400">Which investor or dealer?<input className={field} value={type} maxLength={120} placeholder="e.g. Ting, 2TN Auto World" onChange={(e) => setType(e.target.value)} /></label>}
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
