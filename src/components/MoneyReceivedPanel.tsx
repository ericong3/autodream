import { useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { Car } from '../types';
import Modal from './Modal';
import { useStore } from '../store';
import { companyBankRequest } from '../lib/companyBankPayments';
import { formatCents, parseRinggit, useInvestorQuery, type Bank } from '../lib/investorFinance';
import { moneyRequest, uploadMoneySlip, type MoneyEntry } from '../lib/moneyReceived';

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
            {e.beforeOpening && <span className="text-[10px] px-2 py-0.5 rounded-full border border-sky-500/40 text-sky-300">Before bank opening · in opening balance</span>}
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

export function RecordMoney({ car, actorId, onClose, onSaved, defaultAmountCents, defaultNote }: { car: Car; actorId: string; onClose: () => void; onSaved: () => void; defaultAmountCents?: number; defaultNote?: string }) {
  const banks = useInvestorQuery<{ banks: Bank[] }>(`company-banks:${actorId}`, () => companyBankRequest('banks'));
  const [amount, setAmount] = useState(defaultAmountCents ? (defaultAmountCents / 100).toFixed(2) : ''), [day, setDay] = useState(today()), [bankId, setBankId] = useState(''), [reference, setReference] = useState(''), [note, setNote] = useState(defaultNote ?? '');
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [savedId, setSavedId] = useState<string | null>(null);
  // One reference per form: a retry after a network error never records the money twice.
  const requestId = useRef('money_' + crypto.randomUUID().replace(/-/g, ''));
  const list = banks.data?.banks ?? [];
  const bank = bankId || (list.length === 1 ? list[0].id : '');
  const chosen = list.find((b) => b.id === bank);
  const cents = parseRinggit(amount);
  const ready = !!cents && cents > 0 && !!day && day <= today() && !!bank && !busy;
  const same = () => useStore.getState().currentUser?.id === actorId;
  const save = async () => {
    setBusy(true); setError('');
    try {
      let id = savedId;
      if (!id) {
        const r = await moneyRequest<{ entry: MoneyEntry }>('record', { carId: car.id, amountCents: cents, receivedOn: day, bankAccountId: bank, ...(reference.trim() ? { bankReference: reference.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}), requestId: requestId.current });
        id = r.entry.id; setSavedId(id); onSaved();
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
    <Modal isOpen onClose={onClose} title="Money received">
      <div className="space-y-3">
        <p className="text-sm text-gray-300">{car.make} {car.model} {car.carPlate ?? ''}</p>
        {(error || banks.error) && <p role="alert" className="text-xs text-red-400">{error || banks.error?.message}</p>}
        <label className="block text-xs text-gray-400">Amount received (RM)<input className="input w-full rounded-lg px-3 py-2 mt-1 text-sm" inputMode="decimal" value={amount} disabled={!!savedId} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="block text-xs text-gray-400">Date received<input type="date" max={today()} className="input w-full rounded-lg px-3 py-2 mt-1 text-sm" value={day} disabled={!!savedId} onChange={(e) => setDay(e.target.value)} /></label>
        <label className="block text-xs text-gray-400">Bank<select className="input w-full rounded-lg px-3 py-2 mt-1 text-sm" value={bank} disabled={!!savedId} onChange={(e) => setBankId(e.target.value)}><option value="">Choose bank</option>{list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        {chosen && day && day < chosen.openingDate && <p className="text-xs text-sky-300">Before {chosen.name} opened ({chosen.openingDate}): this money is already in the opening balance. The car is marked received; the bank balance does not change.</p>}
        <label className="block text-xs text-gray-400">Bank reference (optional)<input className="input w-full rounded-lg px-3 py-2 mt-1 text-sm" maxLength={200} value={reference} disabled={!!savedId} onChange={(e) => setReference(e.target.value)} /></label>
        <label className="block text-xs text-gray-400">Note (optional)<input className="input w-full rounded-lg px-3 py-2 mt-1 text-sm" maxLength={500} placeholder="e.g. Maybank loan disbursement" value={note} disabled={!!savedId} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="block text-xs text-gray-400">Bank slip (add it now if you have it; admin can upload it later)<input type="file" accept="image/png,image/jpeg,application/pdf" className="block mt-2 text-sm" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <button type="button" className="btn-gold w-full rounded-lg px-4 py-2 text-sm disabled:opacity-40" disabled={savedId ? busy || !file : !ready} onClick={() => void save()}>{busy ? 'Saving…' : savedId ? 'Retry slip upload' : 'Save money received'}</button>
      </div>
    </Modal>
  );
}
