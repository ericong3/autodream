import { useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { Car } from '../types';
import Modal from './Modal';
import { useStore } from '../store';
import { companyBankRequest } from '../lib/companyBankPayments';
import { formatCents, parseRinggit, useInvestorQuery, type Bank } from '../lib/investorFinance';
import { DEDUCTION_GROUPS, moneyRequest, uploadMoneySlip, type DeductionGroup, type MoneyEntry } from '../lib/moneyReceived';

/** A bank loan being marked received: what is still owed, and what a deduction can pay or match. */
export type LoanContext = {
  paymentId: string; leftCents: number;
  bills: { id: string; label: string; leftCents: number }[];
  addOns: { label: string; amountCents: number }[];
};
type DedLine = { key: string; label: string; group: DeductionGroup; amount: string; billId: string };
let lineKey = 0;
const blankLine = (): DedLine => ({ key: 'l' + (++lineKey), label: '', group: 'other', amount: '', billId: '' });

const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** Money received for any car: amount, date, bank and an optional slip. Nothing else blocks it. */
export default function MoneyReceivedPanel({ car, actorId, role }: { car: Car; actorId: string; role: string }) {
  const director = role === 'director';
  const query = useInvestorQuery<{ entries: MoneyEntry[] }>(`money-received:${actorId}:${car.id}`, () => moneyRequest('list', { carId: car.id }));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const entries = query.data?.entries ?? [];
  const total = entries.reduce((s, e) => s + e.amountCents, 0);
  const same = () => useStore.getState().currentUser?.id === actorId;
  const slip = async (id: string, file?: File) => {
    if (!file) return;
    setBusy(id); setError('');
    try { await uploadMoneySlip(id, file); if (same()) await query.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not upload the slip.'); }
    finally { setBusy(null); }
  };
  const view = async (id: string) => {
    setBusy(id); setError('');
    try { const r = await moneyRequest<{ url: string }>('open_slip', { id }); if (same()) setLink({ id, url: r.url }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open the slip.'); }
    finally { setBusy(null); }
  };
  return (
    <section className="rounded-xl border border-emerald-400/25 bg-emerald-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">{entries.length > 0 && <CheckCircle2 size={15} className="text-emerald-400" />}Money received{entries.length > 0 ? ` · ${formatCents(total)}` : ''}</h3>
        {director && <button type="button" className="btn-gold rounded-lg px-3 py-1.5 text-xs" onClick={() => setOpen(true)}>+ Money received</button>}
      </div>
      {(error || query.error) && <p role="alert" className="text-xs text-red-400">{error || query.error?.message}</p>}
      {query.data && entries.length === 0 && <p className="text-xs text-gray-400">Nothing recorded yet. When the bank or customer pays, record it here. Only the amount, date and bank are needed.</p>}
      {entries.map((e) => (
        <div key={e.id} className="rounded-lg bg-black/20 p-3 space-y-1">
          <div className="flex justify-between gap-3 text-sm"><span className="text-white">{formatCents(e.amountCents)}</span><span className="text-gray-400 text-xs">{new Date(e.receivedOn).toLocaleDateString('en-MY')} · {e.bankName}</span></div>
          <p className="text-[11px] text-gray-500">{e.bankReference}{e.note ? ` · ${e.note}` : ''} · by {e.recordedBy || 'Director'}</p>
          <div className="flex flex-wrap gap-1.5 items-center">
            {e.beforeOpening
              ? <span className="text-[10px] px-2 py-0.5 rounded-full border border-sky-500/40 text-sky-300">Before the bank opened · not on the statement</span>
              : <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300">{e.bankName ?? 'Bank'} · on the statement</span>}
            {e.state === 'to_match' && <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300">To match</span>}
            {e.hasSlip
              ? (link?.id === e.id ? <a className="text-xs text-emerald-300 underline" href={link.url} target="_blank" rel="noopener noreferrer">Open slip</a> : <button type="button" className="text-xs text-emerald-300" disabled={busy !== null} onClick={() => void view(e.id)}>Slip ✓ view</button>)
              : <label className={`text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300 ${busy ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>{busy === e.id ? 'Uploading…' : 'No slip · upload'}<input type="file" className="hidden" accept="image/png,image/jpeg,application/pdf" onChange={(ev) => { void slip(e.id, ev.target.files?.[0]); ev.target.value = ''; }} /></label>}
          </div>
        </div>
      ))}
      {open && <RecordMoney car={car} actorId={actorId} onClose={() => setOpen(false)} onSaved={() => void query.reload()} />}
    </section>
  );
}

export function RecordMoney({ car, actorId, onClose, onSaved, defaultAmountCents, defaultNote, loan }: { car: Car; actorId: string; onClose: () => void; onSaved: () => void; defaultAmountCents?: number; defaultNote?: string; loan?: LoanContext }) {
  const banks = useInvestorQuery<{ banks: Bank[] }>(`company-banks:${actorId}`, () => companyBankRequest('banks'));
  const [amount, setAmount] = useState(defaultAmountCents ? (defaultAmountCents / 100).toFixed(2) : ''), [day, setDay] = useState(today()), [bankId, setBankId] = useState(''), [reference, setReference] = useState(''), [note, setNote] = useState(defaultNote ?? '');
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [savedId, setSavedId] = useState<string | null>(null);
  // One reference per form: a retry after a network error never records the money twice.
  const requestId = useRef('money_' + crypto.randomUUID().replace(/-/g, ''));
  const list = banks.data?.banks ?? [];
  const bank = bankId || (list.length === 1 ? list[0].id : '');
  const chosen = list.find((b) => b.id === bank);
  const cents = parseRinggit(amount);
  // Bank loan: what was taken out before the money reached us.
  const [lines, setLines] = useState<DedLine[]>([]);
  const setLine = (key: string, patch: Partial<DedLine>) => setLines((ls) => ls.map((l) => l.key === key ? { ...l, ...patch } : l));
  const lineCents = lines.map((l) => parseRinggit(l.amount) ?? 0);
  const dedTotal = lineCents.reduce((s, n) => s + n, 0);
  const toExplain = loan && cents ? loan.leftCents - cents : 0;
  const linesOk = lines.every((l, i) => l.label.trim() && lineCents[i] > 0 && (!l.billId || lineCents[i] <= (loan?.bills.find((b) => b.id === l.billId)?.leftCents ?? 0)));
  const dedOk = !loan || lines.length === 0 ? (!loan || !cents || cents <= loan.leftCents) : linesOk && dedTotal === toExplain;
  const usedBills = new Set(lines.map((l) => l.billId).filter(Boolean));
  const ready = !!cents && cents > 0 && !!day && day <= today() && !!bank && !busy && dedOk;
  const same = () => useStore.getState().currentUser?.id === actorId;
  const save = async () => {
    setBusy(true); setError('');
    try {
      let id = savedId;
      if (!id) {
        const deductions = loan && lines.length ? { loanPaymentId: loan.paymentId, deductions: lines.map((l, i) => ({ label: l.label.trim(), group: l.group, amountCents: lineCents[i], ...(l.billId ? { paymentId: l.billId } : {}) })) } : {};
        const r = await moneyRequest<{ entry: MoneyEntry }>('record', { carId: car.id, amountCents: cents, receivedOn: day, bankAccountId: bank, ...(reference.trim() ? { bankReference: reference.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...deductions, requestId: requestId.current });
        id = r.entry.id; setSavedId(id); onSaved();
        // Deductions add or pay bills on the car: refresh them for the profit and bills.
        if ('deductions' in deductions && same()) void useStore.getState().loadAll(true);
      }
      if (file) {
        try { await uploadMoneySlip(id, file); }
        catch (e) { if (same()) setError('Money saved. The slip did not upload: ' + (e instanceof Error ? e.message : 'try again') + '. You can upload it later.'); onSaved(); return; }
      }
      onSaved(); if (same()) onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={loan ? 'Loan money received' : 'Money received'}>
      <div className="space-y-3">
        <p className="text-sm text-gray-300">{car.make} {car.model} {car.carPlate ?? ''}</p>
        {(error || banks.error) && <p role="alert" className="text-xs text-red-400">{error || banks.error?.message}</p>}
        {loan && <div className="rounded-lg bg-white/[0.04] px-3 py-2"><p className="text-xs text-gray-400">Loan still to receive</p><p className="text-white font-semibold">{formatCents(loan.leftCents)}</p></div>}
        <label className="block text-xs text-gray-400">{loan ? 'Bank or panel transferred to us (RM)' : 'Amount received (RM)'}<input className="input w-full rounded-lg px-3 py-2 mt-1 text-sm" inputMode="decimal" value={amount} disabled={!!savedId} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="block text-xs text-gray-400">Date received<input type="date" max={today()} className="input w-full rounded-lg px-3 py-2 mt-1 text-sm" value={day} disabled={!!savedId} onChange={(e) => setDay(e.target.value)} /></label>
        <label className="block text-xs text-gray-400">Bank<select className="input w-full rounded-lg px-3 py-2 mt-1 text-sm" value={bank} disabled={!!savedId} onChange={(e) => setBankId(e.target.value)}><option value="">Choose bank</option>{list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        {chosen && day && (day < chosen.openingDate
          ? <p className="text-xs text-sky-300">Before {new Date(chosen.openingDate + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })} · not on your {chosen.name} statement. It is already in the starting balance, so nothing is added to {chosen.name}. The car is marked as received.</p>
          : <p className="text-xs text-emerald-300">On your {chosen.name} statement · goes into {chosen.name}.</p>)}
        <label className="block text-xs text-gray-400">Bank reference (optional)<input className="input w-full rounded-lg px-3 py-2 mt-1 text-sm" maxLength={200} value={reference} disabled={!!savedId} onChange={(e) => setReference(e.target.value)} /></label>
        <label className="block text-xs text-gray-400">Note (optional)<input className="input w-full rounded-lg px-3 py-2 mt-1 text-sm" maxLength={500} placeholder="e.g. Maybank loan disbursement" value={note} disabled={!!savedId} onChange={(e) => setNote(e.target.value)} /></label>
        {loan && <div className="space-y-2 border-t border-white/10 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-white font-semibold">What was deducted?</p>
            {!!cents && toExplain > 0 && <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${dedTotal === toExplain && linesOk ? 'bg-emerald-950 text-emerald-300' : 'bg-[#2A2210] text-[#F3C969]'}`}>{dedTotal === toExplain && linesOk ? `All ${formatCents(toExplain)} explained ✓` : `${formatCents(toExplain - dedTotal)} still to explain`}</span>}
          </div>
          {!!cents && toExplain < 0 && <p className="text-xs text-red-400">This is more than the loan still to receive.</p>}
          {lines.length === 0 && <p className="text-xs text-gray-400">{!!cents && toExplain > 0 ? 'Add each charge from the bank or panel statement (panel fee, processing fee, insurance, road tax, runner). Leave empty if the rest will come later.' : 'If the bank or panel took charges out, add each one here.'}</p>}
          {lines.map((l, i) => {
            const addOn = loan.addOns.find((a) => a.amountCents === lineCents[i]);
            const bill = loan.bills.find((b) => b.id === l.billId);
            return <div key={l.key} className="rounded-lg bg-black/20 p-2.5 space-y-2">
              <div className="flex gap-2">
                <input aria-label="Deduction name" className="input flex-1 min-w-0 rounded-lg px-2.5 py-2 text-sm" placeholder="e.g. Processing fee" maxLength={120} value={l.label} disabled={!!savedId} onChange={(e) => setLine(l.key, { label: e.target.value })} />
                <input aria-label="Deduction amount" className="input w-28 rounded-lg px-2.5 py-2 text-sm text-right" inputMode="decimal" placeholder="0.00" value={l.amount} disabled={!!savedId}
                  onChange={(e) => { const v = e.target.value; const c = parseRinggit(v); const match = !l.billId && c ? loan.bills.find((b) => b.leftCents === c && !usedBills.has(b.id)) : undefined; setLine(l.key, { amount: v, ...(match ? { billId: match.id } : {}) }); }} />
                <button type="button" aria-label="Remove deduction" className="w-9 rounded-lg text-gray-400 hover:text-white" disabled={!!savedId} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>×</button>
              </div>
              <div className="flex flex-wrap gap-2">
                <select aria-label="Group" className="input rounded-lg px-2 py-1.5 text-xs" value={l.group} disabled={!!savedId} onChange={(e) => setLine(l.key, { group: e.target.value as DeductionGroup })}>{DEDUCTION_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select>
                {loan.bills.length > 0 && <select aria-label="Pays a bill" className="input flex-1 min-w-0 rounded-lg px-2 py-1.5 text-xs" value={l.billId} disabled={!!savedId} onChange={(e) => setLine(l.key, { billId: e.target.value })}>
                  <option value="">New cost on this car</option>
                  {loan.bills.filter((b) => b.id === l.billId || !usedBills.has(b.id)).map((b) => <option key={b.id} value={b.id}>Pays bill: {b.label} · {formatCents(b.leftCents)}</option>)}
                </select>}
              </div>
              {bill && <p className="text-xs text-emerald-300">Pays the bill {bill.label} {formatCents(bill.leftCents)}{lineCents[i] < bill.leftCents ? ' (part of it)' : ''} ✓</p>}
              {bill && lineCents[i] > bill.leftCents && <p className="text-xs text-red-400">More than the bill still to pay.</p>}
              {!bill && addOn && <p className="text-xs text-emerald-300">Matches the deal: + {addOn.label} {formatCents(addOn.amountCents)}. The customer paid for it, so the profit is not lower.</p>}
            </div>;
          })}
          {!savedId && <button type="button" className="w-full min-h-[40px] rounded-lg border border-dashed border-white/15 text-sm text-gold-400" onClick={() => setLines((ls) => [...ls, blankLine()])}>+ Add deduction</button>}
        </div>}
        <label className="block text-xs text-gray-400">{loan ? 'Bank or panel statement / slip (add it now if you have it; admin can upload it later)' : 'Bank slip (add it now if you have it; admin can upload it later)'}<input type="file" accept="image/png,image/jpeg,application/pdf" className="block mt-2 text-sm" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <button type="button" className="btn-gold w-full rounded-lg px-4 py-2 text-sm disabled:opacity-40" disabled={savedId ? busy || !file : !ready} onClick={() => void save()}>{busy ? 'Saving…' : savedId ? 'Retry slip upload' : 'Save money received'}</button>
      </div>
    </Modal>
  );
}
