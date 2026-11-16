import { useState } from 'react';
import { AlertTriangle, Pencil, Plus, Printer, Undo2 } from 'lucide-react';
import { CarPhoto, Figure, Section } from './InvestorFinanceCar';
import { formatCents, formatDay } from '../lib/investorFinance';
import { dealerCarStatus, printAgreement, termsLabel, type DealerCar, type DealerConversion, type DealerView } from '../lib/dealerAccounts';

// One dealer's consignment account: totals, cars and payouts. Read-only;
// the Director's actions live on the Dealer accounts page. The dealer may add
// stock and update their own cars that have no deal yet (onAdd / onEdit).
export default function DealerAccountView({ view, audience, onAdd, onEdit, onUndo }: {
  view: DealerView; audience: 'director' | 'dealer'; onAdd?: () => void; onEdit?: (car: DealerCar) => void; onUndo?: (lock: DealerConversion) => void;
}) {
  const [tab, setTab] = useState<'stock' | 'sold'>('stock');
  const t = view.totals;
  const payoutsByCar = new Map<string, typeof view.payouts>();
  for (const p of view.payouts) if (p.carId) payoutsByCar.set(p.carId, [...(payoutsByCar.get(p.carId) ?? []), p]);
  const sold = view.cars.filter((c) => ['delivered', 'sold'].includes(c.status));
  const stock = view.cars.filter((c) => !['delivered', 'sold'].includes(c.status));
  const list = tab === 'stock' ? stock : sold;
  const owedLabel = audience === 'director' ? 'Still to transfer' : 'Still to be paid to you';

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-obsidian-800/80 to-obsidian-900/60 border border-gold-500/25 rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Figure label="Total payouts" value={formatCents(t.payoutCents)} note="All sold consignment cars" />
          <Figure label="Paid" value={formatCents(t.paidCents)} />
          <Figure label="Kept as investment" value={formatCents(t.convertedCents)} tone="text-gold-300" />
          <Figure label={owedLabel} value={formatCents(t.owedCents)} tone={t.owedCents > 0 ? 'text-amber-300' : 'text-emerald-400'} />
        </div>
        {audience === 'director' && (t.deliveredWithoutPayout > 0 || t.deliveredNotDisbursed > 0) && (
          <div className="flex gap-2 items-start text-amber-300 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <div>
              {t.deliveredNotDisbursed > 0 && <p>{t.deliveredNotDisbursed} delivered car{t.deliveredNotDisbursed === 1 ? '' : 's'} not marked as money received yet.</p>}
              {t.deliveredWithoutPayout > 0 && <p>{t.deliveredWithoutPayout} delivered car{t.deliveredWithoutPayout === 1 ? '' : 's'} without a dealer payout yet, so the total owed is still incomplete.</p>}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 items-center">
        {([['stock', `In stock (${stock.length})`], ['sold', `Sold (${sold.length})`]] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} className={`px-4 py-2 rounded-full text-xs font-semibold border ${tab === key ? 'bg-gold-500/15 text-gold-300 border-gold-500/40' : 'text-gray-400 border-obsidian-400/60'}`}>{label}</button>
        ))}
        {onAdd && <button type="button" onClick={onAdd} className="btn-gold ml-auto px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5"><Plus size={14} /> Add car</button>}
      </div>
      {list.length === 0 ? <p className="text-gray-500 text-sm text-center py-8">{tab === 'stock' ? 'No cars in stock.' : 'No sold cars yet.'}</p> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {list.map((c) => {
            const payouts = payoutsByCar.get(c.carId) ?? [];
            const live = payouts.filter((p) => !p.replaced);
            const amount = live.reduce((s, p) => s + p.amountCents, 0), balance = live.reduce((s, p) => s + p.balanceCents, 0), converted = live.reduce((s, p) => s + p.convertedCents, 0);
            return (
              <div key={c.carId} className="bg-card-gradient border border-obsidian-400/70 rounded-xl p-3 flex gap-3">
                <CarPhoto src={c.photo} className="w-24 h-16 rounded-lg shrink-0" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-white text-sm font-medium truncate">{[c.year, c.make, c.model].filter(Boolean).join(' ')}</p>
                  <p className="text-gray-500 text-[11px]">{c.plate ?? 'No plate'} · {dealerCarStatus(c.status)}{c.deliveredAt ? ` ${formatDay(c.deliveredAt)}` : ''}</p>
                  {(c.variant || c.colour || c.mileage) && <p className="text-gray-500 text-[11px] truncate">{[c.variant, c.colour, c.mileage ? `${c.mileage.toLocaleString()} km` : null].filter(Boolean).join(' · ')}</p>}
                  <p className="text-gray-400 text-[11px]">{termsLabel(c.terms)}{c.sellingPriceCents ? ` · Selling ${formatCents(c.sellingPriceCents)}` : ''}</p>
                  {(c.repairCents > 0 || c.miscCents > 0) && <p className="text-gray-400 text-[11px]">{[c.repairCents > 0 ? `Repairs ${formatCents(c.repairCents)}` : null, c.miscCents > 0 ? `Other costs ${formatCents(c.miscCents)}` : null].filter(Boolean).join(' · ')}</p>}
                  {c.status === 'delivered' && (
                    <p className="text-[11px]">
                      {!c.moneyReceived && <span className="text-amber-300">Waiting for bank money · </span>}
                      {!c.hasPayout ? <span className="text-amber-300">Payout not worked out yet</span>
                        : balance === 0 ? <span className="text-emerald-400">Payout {formatCents(amount)} settled{converted > 0 ? ` (${formatCents(converted)} kept as investment)` : ''}</span>
                        : <span className="text-gray-300">Payout {formatCents(amount)} · {formatCents(balance)} unpaid{converted > 0 ? ` · ${formatCents(converted)} invested` : ''}</span>}
                    </p>
                  )}
                  {onEdit && c.editable && <button type="button" onClick={() => onEdit(c)} className="text-gold-300 text-[11px] flex items-center gap-1 pt-0.5"><Pencil size={11} /> Update details</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl overflow-hidden">
        <Section title="Kept as investment" hint={`${view.conversions.length}`} defaultOpen={audience === 'dealer' && view.conversions.length > 0}>
          {view.conversions.length === 0 ? <p className="text-gray-500 text-xs">Nothing locked as investment yet.</p> : view.conversions.map((v) => (
            <div key={v.id} className="flex justify-between gap-3 text-xs">
              <div className="text-gray-300">{formatDay(v.convertedOn)} · {v.note}<span className="block text-gray-600">Recorded by {v.actorName} · {v.allocations.length} payout{v.allocations.length === 1 ? '' : 's'}</span>
                <span className="flex gap-3 pt-1">
                  <button type="button" onClick={() => { if (!printAgreement(view, v)) alert('Allow pop-ups for this site to print the agreement.'); }} className="text-gold-300 text-[11px] flex items-center gap-1"><Printer size={11} /> Print agreement</button>
                  {onUndo && <button type="button" onClick={() => onUndo(v)} className="text-red-300 text-[11px] flex items-center gap-1"><Undo2 size={11} /> Undo lock</button>}
                </span>
              </div>
              <span className="text-gold-300 font-medium shrink-0">{formatCents(v.amountCents)}</span>
            </div>
          ))}
          {audience === 'director' && (view.reversals ?? []).map((r) => (
            <div key={r.conversionId} className="flex justify-between gap-3 text-xs opacity-60">
              <div className="text-gray-400">Undone lock from {formatDay(r.convertedOn)} · {r.reason}<span className="block text-gray-600">Undone by {r.actorName} · {formatDay(r.reversedAt)}</span></div>
              <span className="text-gray-400 line-through shrink-0">{formatCents(r.amountCents)}</span>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}
