import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileWarning } from 'lucide-react';
import CompanyPaymentDocuments from './CompanyPaymentDocuments';
import { missingDocuments, type MissingDocument } from '../lib/companyEvidence';
import { formatCents, useInvestorQuery } from '../lib/investorFinance';
import { useStore } from '../store';

type Filter = 'all' | 'invoice' | 'receipt';

const typeLabel = (t: string) => t.split('_').join(' ');

/** Paperwork still to upload: supplier invoices, payment slips and dealer agreements. Director and admin only. */
export default function MissingDocuments() {
  const actor = useStore((s) => s.currentUser);
  const allowed = !!actor && ['director', 'admin'].includes(actor.role);
  const query = useInvestorQuery(allowed ? `missing-docs:${actor!.id}` : null, missingDocuments);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  if (!allowed) return null;
  const items = (query.data?.items ?? []).filter((d) => filter === 'all' || (filter === 'invoice' ? d.needInvoice : d.needReceipt));
  const agreements = query.data?.agreements ?? [];
  const invoices = query.data?.items.filter((d) => d.needInvoice).length ?? 0;
  const receipts = query.data?.items.filter((d) => d.needReceipt).length ?? 0;
  return (
    <div className="space-y-3 pb-24">
      <p className="text-xs text-gray-400">Bills and payments can go ahead without their paperwork. Upload what is missing here when you have it.</p>
      {query.error && <p role="alert" className="text-sm text-red-400">{query.error.message}</p>}
      {query.loading && !query.data && <p className="text-sm text-gray-400">Loading…</p>}
      {agreements.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <p className="text-amber-300 text-xs font-semibold uppercase tracking-widest">Dealer agreements ({agreements.length})</p>
          {agreements.map((a) => (
            <Link key={a.carId} to={`/inventory/${a.carId}`} className="flex justify-between gap-3 text-sm py-1">
              <span className="text-white truncate">{a.car || a.carId}{a.dealer ? <span className="text-gray-400"> · {a.dealer}</span> : null}</span>
              <span className="text-blue-300 shrink-0">{a.approved ? 'Approved · upload' : 'Upload'}</span>
            </Link>
          ))}
        </div>
      )}
      {query.data && (
        <div className="flex gap-1 rounded-xl bg-obsidian-800/60 border border-white/[0.06] p-1">
          {([['all', `All ${query.data.items.length}`], ['invoice', `Invoices ${invoices}`], ['receipt', `Payment slips ${receipts}`]] as [Filter, string][]).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${filter === key ? 'bg-gold-gradient text-obsidian-950 font-bold' : 'text-gray-400 hover:text-white'}`}>{label}</button>
          ))}
        </div>
      )}
      {query.data && query.data.total > query.data.items.length && <p className="text-xs text-gray-500">Showing the latest {query.data.items.length} of {query.data.total}.</p>}
      {query.data && items.length === 0 && agreements.length === 0 && <p className="text-sm text-emerald-300 text-center py-10">Nothing missing.</p>}
      <div className="rounded-xl border border-white/[0.06] divide-y divide-white/[0.04]">
        {items.map((d) => <Row key={d.paymentId} d={d} onOpen={() => setOpen(d.paymentId)} />)}
      </div>
      {open && <CompanyPaymentDocuments paymentId={open} onClose={() => { setOpen(null); void query.reload(); }} />}
    </div>
  );
}

function Row({ d, onOpen }: { d: MissingDocument; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-white/[0.02]">
      <FileWarning size={16} className="text-amber-300 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white truncate">{d.recipientName || 'Payment'} <span className="text-gray-400 capitalize">· {typeLabel(d.type)}</span></p>
        <p className="text-[11px] text-gray-500 truncate">{d.car ? `${d.car} · ` : ''}{d.status === 'transferred' ? 'Paid' : 'Not paid yet'}{d.date ? ` · ${new Date(d.date).toLocaleDateString('en-MY')}` : ''}</p>
        <div className="flex gap-1.5 mt-1">
          {d.needInvoice && <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300">Invoice / bill</span>}
          {d.needReceipt && <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300">Payment slip</span>}
        </div>
      </div>
      <span className="text-sm text-gray-300 shrink-0">{d.amountCents !== null ? formatCents(d.amountCents) : ''}</span>
    </button>
  );
}
