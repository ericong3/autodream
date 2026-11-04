import { useState, type ReactNode } from 'react';
import { Car as CarIcon, ChevronDown, AlertTriangle, RotateCw, Paperclip, Loader2, CheckCircle2 } from 'lucide-react';
import ConfirmSheet from './ConfirmSheet';
import InvestorMoneyDocuments, { type MoneyProofSelection } from './InvestorMoneyDocuments';
import InvestorSaleMoney from './InvestorSaleMoney';
import {
  BILL_CATEGORIES, CAR_STATE_LABEL, carTitle, formatCents, formatDay, investorRequest, investorShare, basisPointsLabel,
  malaysiaToday, parseRinggit, prepareProof, useInvestorAction, useInvestorQuery, InvestorFinanceError,
  type ActionError, type Bank, type BillCategory, type CarBill, type CarDetail, type CarSummary, type PendingMutation,
} from '../lib/investorFinance';

export type CarMode = 'investor' | 'director' | 'admin' | 'viewer';

// ── Small shared pieces (also used by the investor portal and console) ──────
export function CarPhoto({ src, className = '' }: { src: string | null; className?: string }) {
  return (
    <div className={`bg-obsidian-700/60 overflow-hidden flex items-center justify-center ${className}`}>
      {src ? <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" /> : <CarIcon size={28} className="text-gray-600" />}
    </div>
  );
}

export function Section({ title, hint, children, defaultOpen = false }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-obsidian-400/40">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="text-gray-300 text-xs font-semibold uppercase tracking-wider">{title}</span>
        <span className="flex items-center gap-2 text-gray-500 text-xs">{hint}<ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} /></span>
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

export function Figure({ label, value, tone = 'text-white', note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div>
      <p className="text-gray-500 text-[10px] uppercase tracking-wider">{label}</p>
      <p className={`font-semibold text-sm mt-0.5 ${tone}`}>{value}</p>
      {note && <p className="text-gray-600 text-[10px] mt-0.5">{note}</p>}
    </div>
  );
}

export function LoadState({ loading, error, onRetry, children }: { loading: boolean; error: InvestorFinanceError | null; onRetry: () => void; children?: ReactNode }) {
  if (error) return (
    <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 space-y-2">
      <p className="text-red-300 text-sm flex items-start gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{error.message}</p>
      {error.code !== 'SETUP' && <button type="button" onClick={onRetry} className="btn-ghost text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5"><RotateCw size={12} /> Try again</button>}
    </div>
  );
  if (loading && !children) return <div className="flex items-center gap-2 text-gray-500 text-sm py-8 justify-center"><Loader2 size={15} className="animate-spin" /> Loading…</div>;
  return <>{children}</>;
}

export function ActionErrorBox({ error, slot, onRetry, onDismiss }: { error: ActionError | null; slot: string; onRetry: () => void; onDismiss: () => void }) {
  if (!error || error.slot !== slot) return null;
  return (
    <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 space-y-2">
      <p className="text-red-300 text-xs">{error.message}</p>
      <div className="flex gap-2">
        {error.retryable && <button type="button" onClick={onRetry} className="text-xs px-3 py-1.5 rounded-lg bg-gold-500/15 text-gold-300 border border-gold-500/30">Retry original save</button>}
        <button type="button" onClick={onDismiss} className="text-xs px-3 py-1.5 rounded-lg text-gray-400 border border-obsidian-400/60">Close</button>
      </div>
    </div>
  );
}

/** Saves that were sent but not confirmed. Retrying reuses the same reference so nothing is recorded twice. */
export function PendingSaves({ pending, busy, onRetry, onDiscard }: { pending: PendingMutation[]; busy: string | null; onRetry: (slot: string) => void; onDiscard: (slot: string) => void }) {
  const [confirmDiscard, setConfirmDiscard] = useState<PendingMutation | null>(null);
  if (!pending.length) return null;
  return (
    <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 space-y-2">
      <p className="text-amber-300 text-xs font-semibold flex items-center gap-1.5"><AlertTriangle size={13} /> Not yet confirmed by the server</p>
      {pending.map((p) => (
        <div key={p.slot} className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-gray-300">{p.label} <span className="text-gray-600">· {formatDay(p.createdAt)}</span></span>
          <span className="flex gap-2">
            <button type="button" disabled={busy !== null} onClick={() => onRetry(p.slot)} className="px-3 py-1.5 rounded-lg bg-gold-500/15 text-gold-300 border border-gold-500/30 disabled:opacity-40">{busy === p.slot ? 'Retrying…' : 'Retry original save'}</button>
            <button type="button" disabled={busy !== null} onClick={() => setConfirmDiscard(p)} className="px-3 py-1.5 rounded-lg text-gray-400 border border-obsidian-400/60 disabled:opacity-40">Discard</button>
          </span>
        </div>
      ))}
      <ConfirmSheet isOpen={!!confirmDiscard} onClose={() => setConfirmDiscard(null)} variant="warning" confirmLabel="Discard"
        title="Discard this unconfirmed save?"
        message="It may already have been saved. Check the records first — if you discard it and enter it again, it could be recorded twice."
        onConfirm={() => { if (confirmDiscard) onDiscard(confirmDiscard.slot); setConfirmDiscard(null); }} />
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-gray-400 text-[11px] block mb-1">{label}</span>
      {children}
      {hint && <span className="text-gray-600 text-[10px] block mt-1">{hint}</span>}
    </label>
  );
}

export type BankPayment = { bankAccountId: string; bankReference: string; paidOn: string };
export const emptyBankPayment = (): BankPayment => ({ bankAccountId: '', bankReference: '', paidOn: malaysiaToday() });
export const bankPaymentReady = (p: BankPayment) => !!p.bankAccountId && p.bankReference.trim().length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(p.paidOn) && p.paidOn <= malaysiaToday();

export function BankPaymentFields({ banks, value, onChange, dateLabel = 'Date paid' }: { banks: Bank[]; value: BankPayment; onChange: (v: BankPayment) => void; dateLabel?: string }) {
  if (!banks.length) return <p className="text-amber-300 text-xs">Add a company bank account in “Bank accounts” first.</p>;
  return (
    <div className="grid sm:grid-cols-3 gap-2">
      <Field label="Bank account">
        <select className="input w-full px-3 py-2 rounded-lg text-sm" value={value.bankAccountId} onChange={(e) => onChange({ ...value, bankAccountId: e.target.value })}>
          <option value="">Choose…</option>
          {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
      <Field label="Bank reference" hint="As shown on the bank slip">
        <input className="input w-full px-3 py-2 rounded-lg text-sm" data-no-capitalize maxLength={80} value={value.bankReference} onChange={(e) => onChange({ ...value, bankReference: e.target.value })} />
      </Field>
      <Field label={dateLabel}>
        <input type="date" className="input w-full px-3 py-2 rounded-lg text-sm" max={malaysiaToday()} value={value.paidOn} onChange={(e) => onChange({ ...value, paidOn: e.target.value })} />
      </Field>
    </div>
  );
}

export const CASH_NOTE = 'This only records money that has already moved in the bank. It does not send or request any bank transfer. Records are entered by staff and are not matched to a bank statement.';
export type PendingConfirm = { title: string; message: string; label: string; go: () => void };
export function CashConfirm({ confirm, onClose }: { confirm: PendingConfirm | null; onClose: () => void }) {
  return <ConfirmSheet isOpen={!!confirm} onClose={onClose} variant="warning" title={confirm?.title ?? ''} message={confirm?.message ?? ''} confirmLabel={confirm?.label ?? 'Confirm'} onConfirm={() => { const go = confirm?.go; onClose(); go?.(); }} />;
}

const STATE_CLS: Record<string, string> = {
  reserved: 'bg-amber-500/15 text-amber-300 border-amber-500/30', in_stock: 'bg-gold-500/15 text-gold-300 border-gold-500/30',
  sold: 'bg-blue-500/15 text-blue-300 border-blue-500/30', settled: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};
export function StateChip({ state }: { state?: CarSummary['state'] }) {
  if (!state) return null;
  return <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATE_CLS[state]}`}>{CAR_STATE_LABEL[state]}</span>;
}

/** Investor-facing profit figure: confirmed share once settled, otherwise a labelled estimate after sale. */
export function profitFigure(car: CarSummary): { label: string; value: string; tone: string } {
  if (car.settlement) {
    const v = car.settlement.investor_result_cents;
    return { label: 'Your profit', value: formatCents(v), tone: v >= 0 ? 'text-emerald-400' : 'text-red-400' };
  }
  const est = investorShare(car.profitCents, car.investorBasisPoints);
  if (est === null) return { label: 'Your profit', value: 'After sale', tone: 'text-gray-500' };
  return { label: 'Est. profit', value: formatCents(est), tone: est >= 0 ? 'text-emerald-400/80' : 'text-red-400/80' };
}

export function CarCard({ car, onOpen }: { car: CarSummary; onOpen: () => void }) {
  const profit = profitFigure(car);
  return (
    <button type="button" onClick={onOpen} className="text-left bg-card-gradient border border-obsidian-400/70 rounded-xl overflow-hidden hover:border-gold-500/40 transition-colors">
      <CarPhoto src={car.photo} className="h-36 w-full" />
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">{carTitle(car)}</p>
            {car.plate && <p className="text-gray-500 text-xs">{car.plate}</p>}
          </div>
          <StateChip state={car.state} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Figure label="Price" value={formatCents(car.purchaseCents)} />
          <Figure label="Expenses" value={formatCents(car.costCents ?? 0)} />
          <Figure label={profit.label} value={profit.value} tone={profit.tone} />
        </div>
      </div>
    </button>
  );
}

// ── Car detail ───────────────────────────────────────────────────────────────
const categoryLabel = (c: BillCategory) => BILL_CATEGORIES.find((x) => x.value === c)?.label ?? c;
const ACTIVITY_LABEL: Record<string, string> = {
  fund_car: 'Car allocated to account', purchase_paid: 'Purchase payment recorded', add_car_bill: 'Bill added', approve_car_bill: 'Bill approved',
  void_car_bill: 'Bill voided', pay_car_bill: 'Bill payment recorded', agree_sale: 'Sale price agreed', sale_received: 'Sale money recorded', settle_car: 'Profit confirmed', proof_upload: 'Document uploaded', payment_receipt_linked: 'Payment receipt attached',
  claim_submit: 'Staff claim submitted', claim_approve: 'Staff claim approved', claim_reject: 'Staff claim rejected', commission_bills_created: 'Commission bills added', record_misc: 'Car cost recorded',
};
const activityLabel = (a: string) => ACTIVITY_LABEL[a] ?? a.replace(/_/g, ' ');

type Props = { carId: string; actorId: string; mode: CarMode; banks?: Bank[]; onChanged?: () => void; onClose?: () => void };

export default function InvestorFinanceCar({ carId, actorId, mode, banks = [], onChanged, onClose }: Props) {
  const query = useInvestorQuery<CarDetail>(`${actorId}:${carId}`, () => investorRequest<CarDetail>('car_snapshot', { carId }));
  const act = useInvestorAction(actorId);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const director = mode === 'director', canAddBill = mode === 'director' || mode === 'admin', seesProof = true;
  const car = query.data;

  const after = async (result: unknown) => { if (!result) return false; await query.reload(); onChanged?.(); return true; };
  const mutate = async (slot: string, action: string, data: Record<string, unknown>, label: string) => after(await act.run(slot, action, data, label));
  const retry = async (slot: string) => after(await act.retry(slot));
  const errorBox = (slot: string) => <ActionErrorBox error={act.error} slot={slot} onRetry={() => void retry(slot)} onDismiss={act.clearError} />;

  return (
    <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl overflow-hidden">
      <LoadState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
        {car && (
          <>
            <div className="relative">
              <CarPhoto src={car.photo} className="h-48 sm:h-56 w-full" />
              {onClose && <button type="button" onClick={onClose} className="absolute top-2 right-2 bg-black/60 text-gray-200 text-xs px-3 py-1.5 rounded-lg">Back</button>}
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-white font-display font-bold text-lg">{carTitle(car)}</p>
                  {car.plate && <p className="text-gray-500 text-xs">{car.plate}</p>}
                </div>
                <StateChip state={car.state} />
              </div>
              {car.purchaseCents !== undefined && (() => { const p = profitFigure(car); return (
                <div className="grid grid-cols-3 gap-3">
                  <Figure label="Price" value={formatCents(car.purchaseCents)} />
                  <Figure label="Expenses" value={formatCents(car.costCents ?? 0)} note={car.pendingBills ? `${car.pendingBills} bill${car.pendingBills > 1 ? 's' : ''} waiting` : undefined} />
                  <Figure label={p.label} value={p.value} tone={p.tone} note={car.investorBasisPoints !== undefined ? `${basisPointsLabel(car.investorBasisPoints)} share` : undefined} />
                </div>); })()}
              <PendingSaves pending={act.pending.filter((p) => p.slot.endsWith(`:${carId}`) || p.slot.includes(`:${carId}:`))} busy={act.busy} onRetry={(s) => void retry(s)} onDiscard={act.discard} />
            </div>

            {director && car.state === 'reserved' && (
              <Section title="Purchase payment" hint="Not recorded" defaultOpen>
                <PurchasePaid car={car} banks={banks} busy={act.busy} onSubmit={(pay) => setConfirm({
                  title: 'Record purchase payment?', label: 'Record payment',
                  message: `Record that ${formatCents(car.purchaseCents)} was paid for this car on ${formatDay(pay.paidOn)}. ${CASH_NOTE}`,
                  go: () => void mutate(`purchase:${carId}`, 'purchase_paid', { carId, ...pay, bankReference: pay.bankReference.trim() }, `Purchase payment · ${carTitle(car)}`),
                })} />
                {errorBox(`purchase:${carId}`)}
              </Section>
            )}

            {(director || mode === 'investor') && car.state !== 'reserved' && <InvestorMoneyDocuments source={{ target: 'purchase', carId }} amountCents={car.purchaseCents ?? 0} />}
            <Section title="Bills" hint={`${car.bills.filter((b) => b.state !== 'voided').length}`} defaultOpen={mode === 'admin'}>
              {car.bills.length === 0 && <p className="text-gray-500 text-xs">No bills recorded for this car.</p>}
              {car.bills.map((bill) => (
                <BillRow key={bill.id} bill={bill} carId={carId} mode={mode} banks={banks} busy={act.busy} seesProof={seesProof}
                  onApprove={() => void mutate(`approve:${carId}:${bill.id}`, 'approve_car_bill', { carId, billId: bill.id }, `Approve bill · ${bill.purpose}`)}
                  onVoid={(note) => void mutate(`void:${carId}:${bill.id}`, 'void_car_bill', { carId, billId: bill.id, note }, `Void bill · ${bill.purpose}`)}
                  onPay={(amountCents, pay) => setConfirm({
                    title: 'Record bill payment?', label: 'Record payment',
                    message: `Record ${formatCents(amountCents)} paid to ${bill.payee} on ${formatDay(pay.paidOn)}. ${CASH_NOTE}`,
                    go: () => void mutate(`pay:${carId}:${bill.id}`, 'pay_car_bill', { carId, billId: bill.id, amountCents, ...pay, bankReference: pay.bankReference.trim() }, `Bill payment · ${bill.purpose}`),
                  })}
                  onUploaded={() => void query.reload()}
                  errorBox={errorBox} />
              ))}
              {canAddBill && car.state !== 'settled' && (
                <>
                  <AddBill busy={act.busy === `bill:${carId}`} onSubmit={(bill) => mutate(`bill:${carId}`, 'add_car_bill', { carId, ...bill }, `New bill · ${bill.purpose}`)} />
                  {errorBox(`bill:${carId}`)}
                </>
              )}
            </Section>

            {mode !== 'admin' && (
              <Section title="Sale" hint={car.saleCents ? formatCents(car.saleCents) : 'Not sold'}>
                {car.saleCents ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Figure label="Agreed sale price" value={formatCents(car.saleCents)} />
                    <Figure label="Sale price covered" value={formatCents(car.receivedCents ?? 0)} tone={(car.receivedCents ?? 0) >= car.saleCents ? 'text-emerald-400' : 'text-amber-300'} note={(car.receivedCents ?? 0) < car.saleCents ? `${formatCents(car.saleCents - (car.receivedCents ?? 0))} still to cover` : 'Fully covered'} />
                    <Figure label="Actual bank receipts" value={formatCents(car.actualReceivedCents ?? car.receivedCents ?? 0)} />
                  </div>
                ) : <p className="text-gray-500 text-xs">{car.state === 'reserved' ? 'The purchase payment must be recorded first.' : 'No sale price agreed yet.'}</p>}
                {director && car.state === 'in_stock' && !car.saleCents && (
                  <>
                    <AmountForm label="Agreed sale price (RM)" submitLabel="Agree sale price" busy={act.busy === `sale:${carId}`}
                      onSubmit={(amountCents) => setConfirm({ title: 'Agree this sale price?', label: 'Agree price', message: `Set the agreed sale price to ${formatCents(amountCents)}. Once agreed it can only be corrected by Director review.`,
                        go: () => void mutate(`sale:${carId}`, 'agree_sale', { carId, amountCents }, `Agree sale · ${carTitle(car)}`) })} />
                    {errorBox(`sale:${carId}`)}
                  </>
                )}
                {car.saleCents && (director || mode === 'investor') && <InvestorSaleMoney key={actorId + ':' + carId} car={car} actorId={actorId} banks={banks} director={director} onChanged={async () => { await query.reload(); onChanged?.(); }} />}
              </Section>
            )}

            {mode !== 'admin' && (
              <Section title="Profit" hint={car.settlement ? 'Confirmed' : car.saleCents ? 'Estimate' : undefined}>
                {car.settlement ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Figure label="Car profit" value={formatCents(car.settlement.profit_cents)} />
                    <Figure label="Total costs" value={formatCents(car.settlement.cost_cents)} />
                    <Figure label="Investor result" value={formatCents(car.settlement.investor_result_cents)} tone={car.settlement.investor_result_cents >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                    {mode !== 'investor' && <Figure label="Company profit" value={formatCents(car.settlement.company_profit_cents)} />}
                    <p className="col-span-2 text-gray-500 text-[11px] flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-400" /> Confirmed by the Director on {formatDay(car.settlement.approved_at)}</p>
                  </div>
                ) : car.profitCents !== null && car.profitCents !== undefined ? (
                  <div className="space-y-1">
                    <div className="grid grid-cols-2 gap-3">
                      <Figure label="Estimated car profit" value={formatCents(car.profitCents)} />
                      <Figure label={`Estimated share (${basisPointsLabel(car.investorBasisPoints)})`} value={formatCents(investorShare(car.profitCents, car.investorBasisPoints))} />
                    </div>
                    <p className="text-gray-600 text-[11px]">Estimate only. Profit is final after all sale money is received, every bill is checked, and the Director confirms it.</p>
                  </div>
                ) : <p className="text-gray-500 text-xs">Profit is worked out after the car is sold.</p>}
                {director && car.state === 'sold' && (() => {
                  const ready = (car.receivedCents ?? 0) >= (car.saleCents ?? Infinity) && !car.pendingBills;
                  return (
                    <>
                      {!ready && <p className="text-amber-300 text-[11px]">Before confirming: cover the full sale price and review every waiting bill.</p>}
                      {!!car.unpaidBillCents && <p className="text-gray-400 text-[11px]">{formatCents(car.unpaidBillCents)} of approved unpaid bills stays reserved after profit is confirmed.</p>}
                      <button type="button" disabled={!ready || act.busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40"
                        onClick={() => setConfirm({ title: 'Confirm final profit?', label: 'Confirm profit',
                          message: `Car profit ${formatCents(car.profitCents)} after ${formatCents(car.costCents)} of approved costs. Investor share ${basisPointsLabel(car.investorBasisPoints)} ≈ ${formatCents(investorShare(car.profitCents, car.investorBasisPoints))}. This cannot be undone without a Director correction.`,
                          go: () => void mutate(`settle:${carId}`, 'settle_car', { carId, confirmCosts: true }, `Confirm profit · ${carTitle(car)}`) })}>
                        {act.busy === `settle:${carId}` ? 'Confirming…' : 'Confirm profit'}
                      </button>
                      {errorBox(`settle:${carId}`)}
                    </>
                  );
                })()}
              </Section>
            )}

            {car.activity && (
              <Section title="History" hint={`${car.activity.length}`}>
                {car.activity.length === 0 ? <p className="text-gray-500 text-xs">No history yet.</p> : (
                  <ul className="space-y-1.5">
                    {car.activity.map((a) => (
                      <li key={a.id} className="flex justify-between gap-3 text-xs"><span className="text-gray-300">{activityLabel(a.action)} <span className="text-gray-600">· {a.actorName}</span></span><span className="text-gray-600 shrink-0">{formatDay(a.createdAt)}</span></li>
                    ))}
                  </ul>
                )}
              </Section>
            )}
          </>
        )}
      </LoadState>
      <CashConfirm confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

// ── Forms ────────────────────────────────────────────────────────────────────
function PurchasePaid({ car, banks, busy, onSubmit }: { car: CarSummary; banks: Bank[]; busy: string | null; onSubmit: (p: BankPayment & MoneyProofSelection) => void }) {
  const [pay, setPay] = useState(emptyBankPayment);
  const [proof, setProof] = useState<MoneyProofSelection>({});
  const ready = bankPaymentReady(pay) && !!proof.invoiceDocumentId && !!proof.receiptDocumentId;
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (ready) onSubmit({ ...pay, ...proof }); }}>
      <p className="text-gray-400 text-xs">Amount: <span className="text-white font-medium">{formatCents(car.purchaseCents)}</span> (the allocated purchase price)</p>
      <BankPaymentFields banks={banks} value={pay} onChange={setPay} />
      <InvestorMoneyDocuments key={car.carId} source={{ target: 'purchase', carId: car.carId }} amountCents={car.purchaseCents ?? 0} editable onChoose={setProof} />
      <button type="submit" disabled={!ready || busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40">Record purchase payment</button>
    </form>
  );
}

export function AmountForm({ label, submitLabel, busy, maxCents, onSubmit }: { label: string; submitLabel: string; busy: boolean; maxCents?: number; onSubmit: (cents: number) => void }) {
  const [value, setValue] = useState('');
  const cents = parseRinggit(value);
  const over = cents !== null && maxCents !== undefined && cents > maxCents;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (cents && !over) onSubmit(cents); }}>
      <div className="flex-1 min-w-[160px]"><Field label={label}><input inputMode="decimal" className="input w-full px-3 py-2 rounded-lg text-sm" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" /></Field></div>
      <button type="submit" disabled={!cents || over || busy} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40">{busy ? 'Saving…' : submitLabel}</button>
      {over && <p className="w-full text-red-400 text-[11px]">More than {formatCents(maxCents)}.</p>}
    </form>
  );
}

function AddBill({ busy, onSubmit }: { busy: boolean; onSubmit: (b: { category: BillCategory; purpose: string; payee: string; amountCents: number }) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<BillCategory>('repair');
  const [purpose, setPurpose] = useState('');
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const cents = parseRinggit(amount), ok = !!cents && purpose.trim().length >= 2 && payee.trim().length >= 2;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="btn-ghost text-xs px-3 py-1.5 rounded-lg">Add a bill</button>;
  return (
    <form className="space-y-2 bg-obsidian-800/50 rounded-lg p-3" onSubmit={async (e) => { e.preventDefault(); if (!ok || !cents) return; if (await onSubmit({ category, purpose: purpose.trim(), payee: payee.trim(), amountCents: cents })) { setOpen(false); setPurpose(''); setPayee(''); setAmount(''); } }}>
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label="Type of bill">
          <select className="input w-full px-3 py-2 rounded-lg text-sm" value={category} onChange={(e) => setCategory(e.target.value as BillCategory)}>
            {BILL_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Amount (RM)"><input inputMode="decimal" className="input w-full px-3 py-2 rounded-lg text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
        <Field label="What it was for"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={120} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Front brake pads" /></Field>
        <Field label="Paid to / supplier"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={120} value={payee} onChange={(e) => setPayee(e.target.value)} /></Field>
      </div>
      <p className="text-gray-600 text-[10px]">Save the bill, then upload the supplier invoice. The Director can approve it once the invoice is attached.</p>
      <div className="flex gap-2">
        <button type="submit" disabled={!ok || busy} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40">{busy ? 'Saving…' : 'Save bill'}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs px-3 py-2 rounded-lg text-gray-400 border border-obsidian-400/60">Cancel</button>
      </div>
    </form>
  );
}

const BILL_STATE: Record<CarBill['state'], [string, string]> = { pending: ['Waiting for Director', 'text-amber-300'], approved: ['Approved', 'text-emerald-400'], voided: ['Voided', 'text-gray-500'] };

function BillRow({ bill, carId, mode, banks, busy, seesProof, onApprove, onVoid, onPay, onUploaded, errorBox }: {
  bill: CarBill; carId: string; mode: CarMode; banks: Bank[]; busy: string | null; seesProof: boolean;
  onApprove: () => void; onVoid: (note: string) => void; onPay: (cents: number, p: BankPayment & { receiptDocumentId: string }) => void; onUploaded: () => void; errorBox: (slot: string) => ReactNode;
}) {
  const [panel, setPanel] = useState<null | 'void' | 'pay'>(null);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [pay, setPay] = useState(emptyBankPayment);
  const director = mode === 'director', remaining = bill.amountCents - bill.paidCents;
  const [receiptId, setReceiptId] = useState('');
  const receipts = (bill.documents ?? []).filter((d) => d.kind === 'receipt' && !d.used);
  const cents = parseRinggit(amount), payOk = !!cents && cents <= remaining && bankPaymentReady(pay) && receipts.some((d) => d.id === receiptId);
  const [label, tone] = BILL_STATE[bill.state];
  const hasInvoice = (bill.documents ?? []).some((d) => d.kind === 'bill');
  return (
    <div className={`rounded-lg border border-obsidian-400/50 p-3 space-y-2 ${bill.state === 'voided' ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-white text-sm font-medium">{bill.purpose}</p>
          <p className="text-gray-500 text-[11px]">{categoryLabel(bill.category)} · {bill.payee} · {formatDay(bill.createdAt)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-white text-sm font-semibold">{formatCents(bill.amountCents)}</p>
          <p className={`text-[10px] ${tone}`}>{label}</p>
        </div>
      </div>
      {bill.state !== 'voided' && !hasInvoice && <p className="text-[11px] text-amber-300">Invoice needed</p>}
      {bill.state === 'approved' && (
        <p className="text-[11px] text-gray-400">Paid {formatCents(bill.paidCents)}{remaining > 0 ? <span className="text-amber-300"> · {formatCents(remaining)} still owing</span> : ' · fully paid'}</p>
      )}
      {!!bill.withheldCents && <p className="text-[11px] text-gray-400">Bank deducted {formatCents(bill.withheldCents)}. See the bank proof under Sale.</p>}
      {bill.payments && bill.payments.length > 0 && (
        <ul className="text-[11px] text-gray-500 space-y-0.5">
          {bill.payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span>{formatCents(p.amountCents)} paid {formatDay(p.paidOn)}</span>
              {!p.receiptDocumentId && !(bill.documents ?? []).some((d) => d.entryId === p.id && d.kind === 'payment') && <span className="text-amber-300">Payment receipt needed</span>}
              {!p.receiptDocumentId && seesProof && (director || mode === 'admin') && <ProofUpload billId={bill.id} entryId={p.id} kind="payment" onUploaded={onUploaded} />}
            </li>
          ))}
        </ul>
      )}
      {seesProof && (
        <div className="flex flex-wrap items-center gap-2">
          {(bill.documents ?? []).map((d) => <ProofLink key={d.id} documentId={d.id} name={d.name} />)}
          {(director || mode === 'admin') && bill.state !== 'voided' && <ProofUpload billId={bill.id} kind="bill" onUploaded={onUploaded} />}
        </div>
      )}
      {director && bill.state !== 'voided' && (
        <div className="flex flex-wrap gap-2">
          {bill.state === 'pending' && <button type="button" disabled={busy !== null || !hasInvoice} title={hasInvoice ? 'Approve bill' : 'Upload the supplier invoice first'} onClick={onApprove} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 disabled:opacity-40">{busy === `approve:${carId}:${bill.id}` ? 'Approving…' : 'Approve'}</button>}
          {bill.state === 'approved' && remaining > 0 && <button type="button" onClick={() => setPanel(panel === 'pay' ? null : 'pay')} className="text-xs px-3 py-1.5 rounded-lg bg-gold-500/15 text-gold-300 border border-gold-500/30">Record payment</button>}
          {bill.paidCents === 0 && <button type="button" onClick={() => setPanel(panel === 'void' ? null : 'void')} className="text-xs px-3 py-1.5 rounded-lg text-gray-400 border border-obsidian-400/60">Void</button>}
        </div>
      )}
      {panel === 'void' && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 3) { onVoid(note.trim()); setPanel(null); } }}>
          <div className="flex-1 min-w-[180px]"><Field label="Reason for voiding"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
          <button type="submit" disabled={note.trim().length < 3 || busy !== null} className="text-xs px-4 py-2 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 disabled:opacity-40">Void bill</button>
        </form>
      )}
      {panel === 'pay' && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (payOk && cents) { onPay(cents, { ...pay, receiptDocumentId: receiptId }); setPanel(null); } }}>
          <Field label="Amount paid (RM)" hint={`Up to ${formatCents(remaining)}`}><input inputMode="decimal" className="input w-full px-3 py-2 rounded-lg text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
          <BankPaymentFields banks={banks} value={pay} onChange={setPay} />
          <ProofUpload billId={bill.id} kind="receipt" onUploaded={(id) => { setReceiptId(id); onUploaded(); }} />
          <Field label="Payment receipt"><select className="input w-full px-3 py-2 rounded-lg text-sm" value={receiptId} onChange={(e) => setReceiptId(e.target.value)}><option value="">Choose the uploaded receipt</option>{receipts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          {!receiptId && <p className="text-[11px] text-amber-300">Payment receipt needed</p>}
          <button type="submit" disabled={!payOk || busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40">Record bill payment</button>
        </form>
      )}
      {errorBox(`approve:${carId}:${bill.id}`)}{errorBox(`void:${carId}:${bill.id}`)}{errorBox(`pay:${carId}:${bill.id}`)}
    </div>
  );
}

function ProofUpload({ billId, entryId, kind, onUploaded }: { billId: string; entryId?: string; kind: 'bill' | 'payment' | 'receipt'; onUploaded: (documentId: string) => void }) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setState({ busy: true, error: null });
    try {
      const proof = await prepareProof(file);
      const saved = await investorRequest<{ documentId: string }>('proof_upload', { billId, ...(entryId ? { entryId } : {}), kind, ...proof });
      setState({ busy: false, error: null }); onUploaded(saved.documentId);
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : 'Upload failed. Try again.' });
    }
  };
  return (
    <span className="inline-flex flex-col">
      <label className={`text-[11px] px-2.5 py-1 rounded-lg border border-obsidian-400/60 text-gray-300 inline-flex items-center gap-1 cursor-pointer ${state.busy ? 'opacity-50 pointer-events-none' : ''}`}>
        <Paperclip size={11} /> {state.busy ? 'Uploading…' : kind === 'bill' ? 'Upload invoice' : 'Upload payment receipt'}
        <input type="file" accept="image/png,image/jpeg,application/pdf" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {state.error && <span className="text-red-400 text-[10px] mt-0.5">{state.error}</span>}
    </span>
  );
}

function ProofLink({ documentId, name }: { documentId: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  if (url) return <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gold-300 underline">Open {name}</a>;
  return (
    <button type="button" disabled={state === 'busy'} onClick={async () => {
      setState('busy');
      try { setUrl((await investorRequest<{ url: string }>('proof_url', { documentId })).url); setState('idle'); } catch { setState('error'); }
    }} className="text-[11px] px-2.5 py-1 rounded-lg border border-obsidian-400/60 text-gray-300 inline-flex items-center gap-1">
      <Paperclip size={11} /> {state === 'busy' ? 'Opening…' : state === 'error' ? `Retry ${name}` : name}
    </button>
  );
}
