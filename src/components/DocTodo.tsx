import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CornerUpLeft, FileWarning, Upload } from 'lucide-react';
import { useStore } from '../store';
import { formatCents, parseRinggit, prepareProof, useInvestorQuery } from '../lib/investorFinance';
import { uploadCompanyEvidence } from '../lib/companyEvidence';
import { uploadMoneySlip } from '../lib/moneyReceived';
import { consignmentRequest } from '../lib/consignmentFinance';
import { todoRequest, type DocReturn, type DocTodoList } from '../lib/docTodo';

type Target = { paymentId?: string; moneyId?: string; carId?: string };
type Row = { key: string; car: string; carId: string | null; title: string; sub: string; needs: { label: string; upload: (f: File) => Promise<unknown> }[]; target: Target };

const typeLabel = (t: string) => t.split('_').join(' ');
const pill = 'text-[10px] px-2 py-0.5 rounded-full border';

/** Paperwork to-do on the dashboard. Admin: upload or send back. Director: answer what was sent back. */
export default function DocTodo({ mode }: { mode: 'admin' | 'director' }) {
  const actor = useStore((s) => s.currentUser);
  const query = useInvestorQuery<DocTodoList>(actor ? `doc-todo:${actor.id}` : null, () => todoRequest('list'));
  const [error, setError] = useState('');
  const reload = () => void query.reload();
  if (!actor) return null;
  const data = query.data;
  return (
    <div className="space-y-3">
      {(error || query.error) && <p role="alert" className="text-sm text-red-400">{error || query.error?.message}</p>}
      {query.loading && !data && <p className="text-sm text-gray-400">Loading…</p>}
      {data && (mode === 'director'
        ? <DirectorView data={data} onChanged={reload} setError={setError} />
        : <AdminView data={data} onChanged={reload} setError={setError} />)}
    </div>
  );
}

function DirectorView({ data, onChanged, setError }: { data: DocTodoList; onChanged: () => void; setError: (m: string) => void }) {
  if (data.open.length === 0) return <p className="text-sm text-emerald-300">Nothing sent back to you.</p>;
  return <div className="space-y-2">{data.open.map((r) => <DirectorItem key={r.id} r={r} onChanged={onChanged} setError={setError} />)}</div>;
}

function DirectorItem({ r, onChanged, setError }: { r: DocReturn; onChanged: () => void; setError: (m: string) => void }) {
  const [mode, setMode] = useState<'none' | 'edit' | 'reply' | 'delete'>('none');
  const [amount, setAmount] = useState(r.bill?.amountCents ? (r.bill.amountCents / 100).toFixed(2) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = parseRinggit(amount);
  const canFixBill = !!r.paymentId && !!r.bill && r.bill.status === 'pending';
  const act = async (action: string, data: Record<string, unknown>) => {
    setBusy(true); setError('');
    try {
      await todoRequest(action, { id: r.id, ...data });
      const store = useStore.getState();
      if (action === 'delete_bill' && r.paymentId) useStore.setState({ payments: store.payments.filter((p) => p.id !== r.paymentId) });
      if (action === 'edit_bill' && r.paymentId && typeof data.amountCents === 'number') {
        const bill = store.payments.find((p) => p.id === r.paymentId), amountRm = data.amountCents / 100;
        useStore.setState({
          payments: store.payments.map((p) => p.id === r.paymentId ? { ...p, amount: amountRm } : p),
          ...(bill?.repairJobId && store.payments.filter((p) => p.repairJobId === bill.repairJobId).length === 1 ? { repairs: store.repairs.map((x) => x.id === bill.repairJobId ? { ...x, actualCost: amountRm } : x) } : {}),
        });
      }
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-white truncate">{r.label}</p>
          <p className="text-[11px] text-gray-400 truncate">{r.carId ? <Link className="underline" to={`/inventory/${r.carId}`}>{r.car || r.carId}</Link> : 'No car'}</p>
        </div>
        <span className={`${pill} border-amber-500/40 text-amber-300 shrink-0 h-fit`}>From {r.raisedBy || 'admin'}</span>
      </div>
      <p className="text-sm text-amber-100">“{r.reason}”</p>
      {mode === 'none' && <div className="flex flex-wrap gap-2">
        {canFixBill && <button type="button" disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-red-500/40 text-red-300" onClick={() => setMode('delete')}>Delete bill</button>}
        {canFixBill && <button type="button" disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-white/15 text-gray-200" onClick={() => setMode('edit')}>Edit amount</button>}
        <button type="button" disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-white/15 text-gray-200" onClick={() => setMode('reply')}>Reply to admin</button>
        <button type="button" disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-300" onClick={() => void act('resolve', { resolution: 'done' })}>Done</button>
      </div>}
      {mode === 'delete' && <div className="space-y-2">
        <p className="text-xs text-red-300">Delete {r.bill?.recipientName || 'this bill'} · {typeLabel(r.bill?.type ?? '')} · {formatCents(r.bill?.amountCents ?? 0)}? This cannot be undone.</p>
        <div className="flex gap-2"><button type="button" disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/80 text-white" onClick={() => void act('delete_bill', {})}>{busy ? 'Deleting…' : 'Yes, delete'}</button><button type="button" className="text-xs text-gray-400" onClick={() => setMode('none')}>Cancel</button></div>
      </div>}
      {mode === 'edit' && <div className="flex flex-wrap gap-2 items-center">
        <input className="input rounded-lg px-3 py-1.5 text-sm w-36" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Correct amount (RM)" />
        <button type="button" disabled={busy || !cents || cents === r.bill?.amountCents} className="btn-gold text-xs px-3 py-1.5 rounded-lg disabled:opacity-40" onClick={() => void act('edit_bill', { amountCents: cents })}>{busy ? 'Saving…' : 'Save amount'}</button>
        <button type="button" className="text-xs text-gray-400" onClick={() => setMode('none')}>Cancel</button>
      </div>}
      {mode === 'reply' && <div className="space-y-2">
        <textarea className="input w-full rounded-lg px-3 py-2 text-sm" rows={2} maxLength={500} placeholder="e.g. Not a duplicate, upload the second invoice" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-2"><button type="button" disabled={busy || note.trim().length < 3} className="btn-gold text-xs px-3 py-1.5 rounded-lg disabled:opacity-40" onClick={() => void act('resolve', { resolution: 'returned', note: note.trim() })}>{busy ? 'Sending…' : 'Send to admin'}</button><button type="button" className="text-xs text-gray-400" onClick={() => setMode('none')}>Cancel</button></div>
      </div>}
    </div>
  );
}

function AdminView({ data, onChanged, setError }: { data: DocTodoList; onChanged: () => void; setError: (m: string) => void }) {
  const waiting = new Set(data.open.map((r) => r.paymentId || r.moneyId || ('car:' + r.carId)));
  const rows: Row[] = [];
  for (const d of data.items) {
    if (waiting.has(d.paymentId)) continue;
    rows.push({ key: 'p:' + d.paymentId, car: d.car || 'No car', carId: d.carId, title: `${d.recipientName || 'Payment'} · ${typeLabel(d.type)}`, sub: `${d.amountCents !== null ? formatCents(d.amountCents) : ''} · ${d.status === 'transferred' ? 'Paid' : 'Not paid yet'}`,
      needs: [...(d.needInvoice ? [{ label: 'Invoice / bill', upload: (f: File) => uploadCompanyEvidence(d.paymentId, 'invoice', f) }] : []), ...(d.needReceipt ? [{ label: 'Payment slip', upload: (f: File) => uploadCompanyEvidence(d.paymentId, 'payment', f) }] : [])], target: { paymentId: d.paymentId } });
  }
  for (const m of data.moneyWithoutSlip) {
    if (waiting.has(m.id)) continue;
    rows.push({ key: 'm:' + m.id, car: m.car || 'No car', carId: m.carId, title: `Money received · ${formatCents(m.amountCents)}`, sub: `${new Date(m.receivedOn).toLocaleDateString('en-MY')} · ${m.bankName ?? ''}`, needs: [{ label: 'Bank slip', upload: (f: File) => uploadMoneySlip(m.id, f) }], target: { moneyId: m.id } });
  }
  for (const a of data.agreements) {
    if (waiting.has('car:' + a.carId)) continue;
    rows.push({ key: 'a:' + a.carId, car: a.car || a.carId, carId: a.carId, title: `Dealer agreement${a.dealer ? ` · ${a.dealer}` : ''}`, sub: a.approved ? 'Dealer amount already approved' : 'Consignment deal open',
      needs: [{ label: 'Agreement', upload: async (f: File) => consignmentRequest('upload', { carId: a.carId, ...(await prepareProof(f)) }) }], target: { carId: a.carId } });
  }
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(r.car, [...(groups.get(r.car) ?? []), r]);
  const replies = data.answered.filter((r) => r.resolution === 'returned');
  return (
    <div className="space-y-4">
      {replies.length > 0 && <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-300">Director replied ({replies.length})</p>
        {replies.map((r) => <div key={r.id} className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3"><p className="text-sm text-white">{r.label} <span className="text-gray-400">· {r.car}</span></p><p className="text-xs text-gray-400">You: “{r.reason}”</p><p className="text-sm text-sky-200">{r.resolvedBy || 'Director'}: “{r.note}”</p></div>)}
      </div>}
      {data.open.length > 0 && <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">With the Director ({data.open.length})</p>
        {data.open.map((r) => <div key={r.id} className="rounded-xl border border-white/10 p-3 text-sm"><p className="text-white">{r.label} <span className="text-gray-400">· {r.car}</span></p><p className="text-xs text-gray-400">“{r.reason}” · waiting for the Director</p></div>)}
      </div>}
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Missing paperwork ({rows.length}{data.total > data.items.length ? '+' : ''})</p>
      {rows.length === 0 && <p className="text-sm text-emerald-300">Nothing missing.</p>}
      {[...groups.entries()].map(([car, list]) => (
        <div key={car} className="rounded-xl border border-white/[0.08] overflow-hidden">
          <div className="px-3 py-2 bg-white/[0.03] text-sm text-white font-medium flex justify-between">{list[0].carId ? <Link className="hover:underline" to={`/inventory/${list[0].carId}`}>{car}</Link> : <span>{car}</span>}<span className="text-gray-500 text-xs">{list.length}</span></div>
          <div className="divide-y divide-white/[0.05]">{list.map((r) => <AdminRow key={r.key} r={r} onChanged={onChanged} setError={setError} />)}</div>
        </div>
      ))}
    </div>
  );
}

function AdminRow({ r, onChanged, setError }: { r: Row; onChanged: () => void; setError: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [back, setBack] = useState(false);
  const [reason, setReason] = useState('');
  const upload = async (label: string, run: (f: File) => Promise<unknown>, file?: File) => {
    if (!file) return;
    setBusy(label); setError('');
    try { await run(file); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed. Try again.'); } finally { setBusy(null); }
  };
  const sendBack = async () => {
    setBusy('back'); setError('');
    try { await todoRequest('send_back', { ...r.target, reason: reason.trim() }); setBack(false); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not send. Try again.'); } finally { setBusy(null); }
  };
  return (
    <div className="px-3 py-2.5 space-y-2">
      <div className="flex items-start gap-2">
        <FileWarning size={15} className="text-amber-300 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1"><p className="text-sm text-white truncate capitalize">{r.title}</p><p className="text-[11px] text-gray-500">{r.sub}</p></div>
      </div>
      <div className="flex flex-wrap gap-2">
        {r.needs.map((n) => <label key={n.label} className={`text-xs px-3 py-1.5 rounded-lg border border-gold-500/40 text-gold-300 flex items-center gap-1 ${busy ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}><Upload size={12} />{busy === n.label ? 'Uploading…' : `Upload ${n.label.toLowerCase()}`}<input type="file" className="hidden" accept="image/png,image/jpeg,application/pdf" onChange={(e) => { void upload(n.label, n.upload, e.target.files?.[0]); e.target.value = ''; }} /></label>)}
        {!back && <button type="button" disabled={!!busy} className="text-xs px-3 py-1.5 rounded-lg border border-white/15 text-gray-300 flex items-center gap-1" onClick={() => setBack(true)}><CornerUpLeft size={12} />Send back to Director</button>}
      </div>
      {back && <div className="space-y-2">
        <textarea className="input w-full rounded-lg px-3 py-2 text-sm" rows={2} maxLength={500} placeholder="Reason, e.g. Duplicate bill / wrong amount / no invoice from workshop" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex gap-2"><button type="button" disabled={!!busy || reason.trim().length < 3} className="btn-gold text-xs px-3 py-1.5 rounded-lg disabled:opacity-40" onClick={() => void sendBack()}>{busy === 'back' ? 'Sending…' : 'Send to Director'}</button><button type="button" className="text-xs text-gray-400" onClick={() => setBack(false)}>Cancel</button></div>
      </div>}
    </div>
  );
}
