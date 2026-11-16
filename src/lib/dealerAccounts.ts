// Dealer accounts: a consignment dealer linked to an investor account, and
// unpaid dealer payouts locked as investment. Requests reuse the investor
// request/retry helpers with scope 'dealer_accounts'.
import { investorRequest } from './investorFinance';

export const DEALER_SCOPE = { scope: 'dealer_accounts' } as const;

export type DealerCar = {
  carId: string; make: string; model: string; year: number | null; plate: string | null; photo: string | null; status: string;
  dateAdded: string | null; sellingPriceCents: number; moneyReceived: boolean; terms: Record<string, unknown> | null; deliveredAt: string | null; hasPayout: boolean;
  variant: string | null; colour: string | null; mileage: number | null; transmission: string | null; notes: string | null; photos: string[];
  repairCents: number; miscCents: number; editable: boolean;
};
export type DealerPayout = {
  paymentId: string; carId: string | null; status: string; createdAt: string | null; transferredAt: string | null; replaced: boolean;
  amountCents: number; paidCents: number; convertedCents: number; balanceCents: number;
  bankReady: boolean; needsPreparing: boolean;
  // Costs confirmed at the current amount: ticked by the Director, or approved in the consignment workflow.
  costsConfirmed?: boolean; confirmedVia?: 'case' | 'director' | null; confirmedAt?: string | null;
};
export type DealerDraft = { targetCents: number; paymentIds: string[]; updatedAt: string };
export type DealerReversal = { conversionId: string; amountCents: number; reason: string; reversedAt: string; convertedOn: string; actorName: string };
export type DealerConversion = { id: string; amountCents: number; convertedOn: string; note: string; createdAt: string; actorName: string; allocations: { paymentId: string; amountCents: number }[] };
export type DealerTotals = {
  payoutCents: number; paidCents: number; convertedCents: number; owedCents: number;
  carsInStock: number; carsDelivered: number; deliveredWithoutPayout: number; deliveredNotDisbursed: number;
  needsPreparingCents: number; needsPreparingCount: number;
};
export type DealerView = {
  dealer: { id: string; name: string; bankName: string | null; accountHolder: string | null; accountEnding: string } | null;
  investor: { potId: string; name: string; linkedAt: string } | null;
  cars: DealerCar[]; payouts: DealerPayout[]; conversions: DealerConversion[]; totals: DealerTotals;
  draft?: DealerDraft | null; reversals?: DealerReversal[];
};

export const carLabel = (c: DealerCar | undefined) => (c ? `${[c.year, c.make, c.model].filter(Boolean).join(' ')}${c.plate ? ` · ${c.plate}` : ''}` : 'Car not found');

// Walk the payouts in order: each gives what it still owes until the target is
// reached; the last one may be split. Mirrors the database lock exactly.
export function planLock(targetCents: number, payouts: DealerPayout[]) {
  let remaining = targetCents;
  const rows = payouts.map((p) => { const take = Math.min(remaining, p.balanceCents); remaining -= take; return { payout: p, investCents: take, cashCents: p.balanceCents - take }; });
  return { rows, shortCents: remaining };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const rm = (cents: number) => 'RM ' + (cents / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A printable agreement for one lock: which cars, how much of each payout is
// kept as investment, signature lines. Opens the browser's print dialog.
export function printAgreement(view: DealerView, conversion: DealerConversion) {
  const byId = new Map(view.payouts.map((p) => [p.paymentId, p]));
  const cars = new Map(view.cars.map((c) => [c.carId, c]));
  const rows = conversion.allocations.map((a, i) => {
    const p = byId.get(a.paymentId), car = p?.carId ? cars.get(p.carId) : undefined;
    return `<tr><td>${i + 1}</td><td>${esc(carLabel(car))}</td><td class="n">${p ? rm(p.amountCents) : '—'}</td><td class="n">${rm(a.amountCents)}</td></tr>`;
  }).join('');
  const dealer = esc(view.dealer?.name ?? 'Dealer'), investor = esc(view.investor?.name ?? 'Investor');
  const day = new Date(conversion.convertedOn + 'T00:00:00+08:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Investment agreement · ${dealer}</title><style>
body{font-family:Georgia,serif;color:#111;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.5}h1{font-size:22px;margin:0 0 4px}p.sub{color:#555;margin:0 0 24px}
table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #bbb;padding:6px 8px;font-size:13px;text-align:left}td.n,th.n{text-align:right}tfoot td{font-weight:bold}
.sig{display:flex;gap:48px;margin-top:64px}.sig div{flex:1;border-top:1px solid #111;padding-top:6px;font-size:13px}@media print{body{margin:0}}</style></head><body>
<h1>Investment agreement</h1><p class="sub">Dated ${esc(day)}</p>
<p>AutoDream owes <b>${dealer}</b> the consignment payouts listed below. By agreement, <b>${rm(conversion.amountCents)}</b> of these payouts is not paid in cash but kept by AutoDream as the investment capital of <b>${investor}</b>. Any part of a payout not listed as kept remains payable to ${dealer} in the normal way.</p>
<table><thead><tr><th>#</th><th>Car</th><th class="n">Payout</th><th class="n">Kept as investment</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="3">Total investment</td><td class="n">${rm(conversion.amountCents)}</td></tr></tfoot></table>
<p>Note: ${esc(conversion.note)}</p>
<div class="sig"><div>For AutoDream<br><br>Name:<br>Date:</div><div>For ${dealer} / ${investor}<br><br>Name:<br>Date:</div></div>
<script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open(); w.document.write(html); w.document.close();
  return true;
}
export type DealerListItem = { id: string; name: string; potId: string | null; investorName: string | null; cars: number };
export type DealerList = { dealers: DealerListItem[]; investors: { potId: string; name: string; linkedDealerId: string | null }[] };

export const dealerRequest = <T,>(action: string, data: Record<string, unknown> = {}) => investorRequest<T>(action, { ...DEALER_SCOPE, ...data });

export const DEALER_CAR_STATUS: Record<string, string> = {
  available: 'In stock', coming_soon: 'Coming soon', in_workshop: 'In workshop', ready: 'Ready', photo_complete: 'Photos done', submitted: 'Submitted',
  reserved: 'Reserved', deal_pending: 'Deal pending', sold: 'Sold', delivered: 'Delivered',
};
export const dealerCarStatus = (s: string) => DEALER_CAR_STATUS[s] ?? s.replace(/_/g, ' ');
export const termsLabel = (t: Record<string, unknown> | null) => {
  if (!t || !t.terms) return 'Terms not set';
  if (t.terms === 'fixed_amount') return 'Fixed amount';
  if (t.terms === 'profit_split') return `${Number(t.splitPercent ?? 0)}% profit split`;
  return String(t.terms).replace(/_/g, ' ');
};
