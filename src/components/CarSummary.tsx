import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Car as CarIcon, Check, ChevronRight, FileText } from 'lucide-react';
import type { Car, Payment } from '../types';
import { useStore } from '../store';
import { thumbUrl } from '../utils/photoUrl';
import { formatCents, parseRinggit, useInvestorQuery } from '../lib/investorFinance';
import { paymentBalanceCents } from '../lib/companyBankPayments';
import { moneyRequest, type MoneyEntry } from '../lib/moneyReceived';
import { loadCarCases, todoRequest, type CarCase, type DocTodoList } from '../lib/docTodo';
import { RecordMoney, type LoanContext } from './MoneyReceivedPanel';
import CompanyBankPaymentDialog from './CompanyBankPaymentDialog';
import CompanyPaymentDocuments from './CompanyPaymentDocuments';

export type ProfitRow = { label: string; amount: number };
export type DealLine = { label: string; amount: number };
/** The customer's final deal as shown in the Final deal tab. Amounts in RM. */
export type DealCard = {
  approval: 'approved' | 'pending' | 'rejected';
  payment: string; bank: string; sellingPrice: number;
  plus: DealLine[]; minus: DealLine[]; balance: number;
  tradeIn: { label: string; amount: number; swap: boolean } | null;
  submittedBy?: string; submittedAt?: string; approvedBy?: string; approvedAt?: string;
  notes?: string; rejectionNotes?: string; receiptUrl?: string;
};
/** Delivery to the buyer: the old Delivery box, as a guide stage. Amounts in RM. */
export type DeliveryInfo = {
  done: boolean; balance: number; checking: boolean; onRefresh: () => void;
  receiptUrl?: string; onUploadReceipt?: (file: File) => Promise<void>;
  onDeliver?: () => void; photo?: string; dealReceiptUrl?: string;
};
/** How the buyer pays, from the deal and the Delivered tab's disbursement button. Amounts in RM. */
export type MoneyPlan = {
  kind: 'loan' | 'cash'; bank?: string; expected: number; status: 'pending' | 'processing' | 'disbursed'; received: boolean;
  onProcessing?: () => void; onReceived?: () => void;
};
export type RefundForm = { bank: string; accountNo: string; accountName: string };
export type RefundInfo = {
  claim?: Payment; form: RefundForm; setForm: (f: RefundForm) => void; onSubmit: () => void; saving: boolean;
};
export type CostAction = { label: string; run: () => void; danger?: boolean; disabled?: boolean; title?: string };
/** A cost recorded on the car (repair, misc cost, panel charge) and whether it has a bill yet. Amounts in RM. */
export type BillCost = {
  id: string; name: string; sub: string; amount: number | null; receiptUrl?: string;
  state: 'open' | 'nobill' | 'billed' | 'free'; billId?: string; fromLoan?: boolean;
  noBillWhy?: string; actions: CostAction[];
};
export type CarRecords = {
  info: [string, string][]; notes?: string; onEdit?: () => void;
  loans: { id: string; name: string; by: string; inactive: boolean; apps: { bank: string; status: string }[] }[];
  moves: { id: string; type: 'in' | 'out'; text: string; when: string; notes?: string }[] | null;
};
const LOAN_TONE: Record<string, string> = { approved: 'bg-emerald-950 text-emerald-300', rejected: 'bg-red-950 text-red-300', submitted: 'bg-sky-950 text-sky-300' };
const day = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
type StageId = 'sold' | 'delivered' | 'money' | 'bills' | 'dealer' | 'paper' | 'closed';
const INBOUND = new Set(['customer_collection', 'loan_disbursement', 'consignment_collection', 'supplier_credit_collection']);
const IN_LABEL: Record<string, string> = { customer_collection: 'Customer', loan_disbursement: 'Bank loan', consignment_collection: 'From dealer', supplier_credit_collection: 'Supplier credit' };
const NAMES: Record<StageId, string> = { sold: 'Sold', delivered: 'Delivered', money: 'Money in', bills: 'Bills', dealer: 'Dealer approved', paper: 'Paperwork', closed: 'Closed' };
const words = (t: string) => t.split('_').join(' ');
const cents = (rm: number) => Math.round(rm * 100);

/**
 * Sold car page: car card, then a guide that walks the case stage by stage
 * (Sold → Money in → Bills paid → Dealer → Paperwork → Closed). Any stage can
 * be opened at any time; each one ends with a button to the next.
 */
export default function CarSummary({ car, actorId, role, profit, costs, buyerName, salespersonName, detailsOpen, onOpenDetails, onOpenMedia, onEditDeal, onAddRepair, onAddMisc, deal, generatingReceipt, onReceipt, delivery, dealerPanel, refund, billCosts, onPanelCharge, records, investorLink, moneyPlan }: {
  car: Car; actorId: string; role: string; profit: number | null; costs: ProfitRow[];
  buyerName?: string; salespersonName?: string; detailsOpen: boolean;
  onOpenDetails: (section?: string) => void; onOpenMedia: (tab: 'photos' | 'card') => void;
  onEditDeal?: () => void; onAddRepair?: () => void; onAddMisc?: () => void;
  deal?: DealCard | null; generatingReceipt?: boolean; onReceipt?: () => void;
  delivery?: DeliveryInfo; dealerPanel?: ReactNode; refund?: RefundInfo; billCosts?: BillCost[]; onPanelCharge?: () => void; records?: CarRecords; investorLink?: () => void; moneyPlan?: MoneyPlan;
}) {
  const director = role === 'director';
  const cases = useInvestorQuery(`car-cases:${actorId}`, loadCarCases);
  const money = useInvestorQuery<{ entries: MoneyEntry[] }>(`money-received:${actorId}:${car.id}`, () => moneyRequest('list', { carId: car.id }));
  const payments = useStore((s) => s.payments);
  const [view, setView] = useState<StageId | null>(null);
  const [recording, setRecording] = useState<{ amountCents?: number; note?: string; loan?: LoanContext } | null>(null);
  const [paying, setPaying] = useState<Payment | null>(null);
  const [docs, setDocs] = useState<string | null>(null);
  const [moneyTab, setMoneyTab] = useState<'profit' | 'deal'>('profit');
  const [billOpen, setBillOpen] = useState<Record<string, boolean>>({ paid: false });

  const [openCost, setOpenCost] = useState<string | null>(null);
  const [recTab, setRecTab] = useState<'info' | 'loans' | 'moves'>('info');
  const [uploading, setUploading] = useState(false);
  const [setup, setSetup] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState('');
  const synced = useRef(false);
  const addPayment = useStore((s) => s.addPayment);
  const moneyCard = useRef<HTMLElement>(null);
  const admin = role === 'admin';
  const todo = useInvestorQuery<DocTodoList>(director || role === 'admin' ? `doc-todo:${actorId}` : null, () => todoRequest('list'));
  const reload = () => { void money.reload(); void cases.reload(); void todo.reload(); };

  const c: CarCase | undefined = cases.data?.cars[car.id];
  const mine = payments.filter((p) => p.carId === car.id && !p.obligationReplaced && (p.status === 'pending' || p.status === 'transferred'));
  const entries = money.data?.entries ?? [];
  const consignmentIn = !!car.consignment && !car.outgoingConsignment;
  const paperwork = c ? c.missingDocs + c.moneyNoSlip + c.sentBack + (c.agreementMissing ? 1 : 0) : 0;
  const todoLink = director ? '/dashboard' : role === 'admin' ? '/admin-dashboard?tab=paperwork' : null;
  const photoCount = car.photos?.length || (car.photo ? 1 : 0);
  const soldFor = profit === null ? null : profit + costs.reduce((s, r) => s + r.amount, 0);
  const showProfit = profit !== null && soldFor !== null;
  const tabs = [...(showProfit ? ['profit' as const] : []), ...(deal ? ['deal' as const] : [])];
  const tab = tabs.includes(moneyTab) ? moneyTab : tabs[0];

  // Money in: money recorded under "Money received" covers the expected payments in order.
  let unallocated = entries.filter((e) => e.state === 'to_match').reduce((s, e) => s + e.amountCents + (e.deductionsCents ?? 0), 0);
  const moneyItems = mine.filter((p) => INBOUND.has(p.type)).map((p) => {
    const left = paymentBalanceCents(p);
    const covered = left === 0 || unallocated >= left;
    if (left > 0 && covered) unallocated -= left;
    return { p, left, covered };
  });
  const expectedCents = moneyItems.reduce((s, m) => s + cents(m.p.amount), 0);
  const bills = mine.filter((p) => !INBOUND.has(p.type));

  // The car's own disbursement status (Delivered tab) must agree with Money in.
  const loanLine = mine.find((p) => p.type === 'loan_disbursement');
  const loanWaiting = moneyPlan?.kind === 'loan' && !moneyPlan.received && !loanLine;
  const cashWaiting = moneyPlan?.kind === 'cash' && !moneyPlan.received && moneyItems.length === 0 && entries.length === 0;
  const loanItem = moneyItems.find((m) => m.p.type === 'loan_disbursement');
  const needsSync = !!moneyPlan && !moneyPlan.received && !money.loading && entries.length > 0 && (moneyPlan.kind === 'loan' ? !!loanItem?.covered : c?.toCollectCents === 0);
  useEffect(() => { if (needsSync && !synced.current && moneyPlan?.onReceived) { synced.current = true; moneyPlan.onReceived(); } }, [needsSync, moneyPlan]);
  const loanContext = (paymentId: string, leftCents: number): LoanContext => ({
    paymentId, leftCents,
    bills: mine.filter((b) => ['repair', 'misc_cost', 'panel_charge'].includes(b.type) && b.status === 'pending' && paymentBalanceCents(b) > 0).map((b) => ({ id: b.id, label: [b.recipientName, b.description].filter(Boolean).join(' · ') || words(b.type), leftCents: paymentBalanceCents(b) })),
    addOns: (deal?.plus ?? []).map((a) => ({ label: a.label, amountCents: cents(a.amount) })),
  });
  const setupCents = setup === null ? null : parseRinggit(setup);
  const setupLoan = async () => {
    if (!setupCents) return;
    setSetupBusy(true); setSetupError('');
    const id = 'loan_disbursement_' + car.id;
    try {
      await addPayment({ id, type: 'loan_disbursement', carId: car.id, recipientType: 'customer', recipientId: car.id, recipientName: `${moneyPlan?.bank ?? 'Bank'} — ${car.make} ${car.model}`, amount: setupCents / 100, description: 'Bank loan receivable', status: 'pending', createdAt: new Date().toISOString() });
      setSetup(null);
      setRecording({ amountCents: setupCents, note: `Bank loan · ${moneyPlan?.bank ?? ''}`, loan: loanContext(id, setupCents) });
    } catch (e) { setSetupError(e instanceof Error ? e.message : 'Could not set up the bank loan.'); }
    finally { setSetupBusy(false); }
  };
  const unpaid = bills.filter((p) => p.status === 'pending' && paymentBalanceCents(p) > 0).sort((a, b) => b.amount - a.amount);
  // Bills stage: every cost on the car, grouped by what still has to happen.
  const costByBill = new Map((billCosts ?? []).filter((x) => x.billId).map((x) => [x.billId!, x]));
  const inProgress = (billCosts ?? []).filter((x) => x.state === 'open');
  const noBill = (billCosts ?? []).filter((x) => x.state === 'nobill');
  const paidBills = bills.filter((p) => !(p.status === 'pending' && paymentBalanceCents(p) > 0));
  const freeCosts = (billCosts ?? []).filter((x) => x.state === 'free');
  const billsLeft = inProgress.length + unpaid.length;
  const docOf = new Map((todo.data?.items ?? []).map((d) => [d.paymentId, d]));

  const stages: { id: StageId; done: boolean }[] = c ? [
    { id: 'sold', done: true },
    ...(delivery ? [{ id: 'delivered' as const, done: delivery.done }] : []),
    { id: 'money', done: c.toCollectCents === 0 && !loanWaiting && !cashWaiting },
    { id: 'bills', done: c.toPay === 0 && billsLeft === 0 },
    ...(consignmentIn ? [{ id: 'dealer' as const, done: !!car.consignmentFinanceOpen && !c.dealerNotApproved }] : []),
    { id: 'paper', done: paperwork === 0 },
    { id: 'closed', done: c.state === 'closed' },
  ] : [];
  const firstOpen = stages.findIndex((s) => !s.done);
  const currentIndex = firstOpen === -1 ? stages.length - 1 : firstOpen;
  const current = stages[currentIndex]?.id ?? 'sold';
  const shown: StageId = view && stages.some((s) => s.id === view) ? view : current;
  const shownIndex = stages.findIndex((s) => s.id === shown);
  const shownDone = stages[shownIndex]?.done ?? false;
  const nextStage = stages[shownIndex + 1];
  const when = shownIndex < currentIndex ? 'Done' : shownIndex === currentIndex ? 'Now' : 'Later';

  const copy: Record<StageId, [string, string]> = {
    sold: ['The car is sold', 'Buyer, price and salesperson.'],
    delivered: [delivery?.done ? 'Delivered to the buyer' : 'Hand the car to the buyer', 'The customer’s part must be in before the car leaves. Add the delivery photo when you mark it delivered.'],
    money: [loanWaiting ? `Waiting for the bank loan · ${moneyPlan?.bank ?? ''}` : cashWaiting ? 'Cash from the customer not marked yet' : c && c.toCollectCents > 0 ? `Collect ${formatCents(c.toCollectCents)}` : 'All money is in', 'Mark each payment when it reaches the bank. Add the bank slip if you have it.'],
    bills: [billsLeft ? `${billsLeft} still to pay or finish` : 'All bills are paid', 'Each bill: the admin uploads the invoice, you pay, the admin uploads the proof of payment.'],
    dealer: [!car.consignmentFinanceOpen ? 'Dealer deal not opened yet' : c?.dealerNotApproved ? 'Approve what the dealer receives' : 'Dealer amount approved', 'Check the bills are right, then approve the dealer amount.'],
    paper: [paperwork ? `Finish the paperwork · ${paperwork} open` : 'Paperwork complete', 'Missing invoices, slips and the agreement are handled in the to-do list.'],
    closed: [c?.state === 'closed' ? 'Case closed' : 'Not closed yet', 'The case closes by itself once every stage before it is done.'],
  };

  const card = 'rounded-2xl border border-white/[0.08] bg-[#15151A]';
  const row = 'rounded-xl border border-white/[0.07] bg-[#15151A] px-4 py-3';
  const goldBtn = 'btn-gold rounded-xl px-4 min-h-[44px] text-sm font-bold inline-flex items-center justify-center';
  const ghostBtn = 'rounded-xl px-3 min-h-[40px] text-sm border border-white/10 text-gray-200 hover:text-white inline-flex items-center justify-center';
  const moreBtn = (x: BillCost) => (x.actions.length > 0 || x.receiptUrl) ? <button type="button" aria-label={`More for ${x.name}`} aria-expanded={openCost === x.id} onClick={() => setOpenCost(openCost === x.id ? null : x.id)}
    className="w-10 h-10 flex-shrink-0 rounded-lg border border-white/10 text-gray-300 hover:text-white">⋯</button> : null;
  const menu = (x: BillCost) => <div className="flex flex-wrap gap-2">
    {x.receiptUrl && <a href={x.receiptUrl} target="_blank" rel="noopener noreferrer" className={`${ghostBtn} min-h-[36px]`}>Receipt</a>}
    {x.actions.map((a) => <button key={a.label} type="button" disabled={a.disabled} title={a.title} onClick={() => { setOpenCost(null); a.run(); }}
      className={`${ghostBtn} min-h-[36px] disabled:opacity-40 ${a.danger ? 'text-red-300 border-red-500/30' : ''}`}>{a.label}</button>)}
  </div>;
  const costRow = (x: BillCost, right: ReactNode) => <div key={x.id} className={`${row} space-y-2`}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex-1 min-w-[140px]"><p className="text-sm text-white truncate" title={x.name}>{x.name}</p><p className="text-xs text-gray-400 truncate" title={x.sub}>{x.sub}</p></div>
      {x.amount !== null && <p className="text-sm font-semibold text-white whitespace-nowrap">{formatCents(cents(x.amount))}</p>}
      {right}{moreBtn(x)}
    </div>
    {openCost === x.id && menu(x)}
  </div>;
  // One bill with its three steps: invoice (admin), paid (director), proof of payment (admin).
  const pill = (state: 'ok' | 'missing' | 'later', label: string) => <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${state === 'ok' ? 'bg-emerald-950 text-emerald-300' : state === 'missing' ? 'bg-[#2A2210] text-[#F3C969]' : 'bg-white/[0.05] text-gray-500'}`}>{label} {state === 'ok' ? '✓' : state === 'missing' ? '✗' : '·'}</span>;
  const billRow = (p: Payment, paid: boolean) => {
    const x = costByBill.get(p.id), d = docOf.get(p.id), known = !!todo.data;
    const fromLoan = !!x?.fromLoan, invoiceOk = fromLoan || !d?.needInvoice, proofOk = fromLoan || !d?.needReceipt;
    const adminTodo = known && (!invoiceOk || (paid && !proofOk));
    return <div key={p.id} className={`${row} space-y-2`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex-1 min-w-[140px]"><p className="text-sm text-white truncate">{x?.name ?? (p.recipientName || words(p.type))}</p><p className="text-xs text-gray-400 truncate">{fromLoan ? 'Paid from the bank loan' : paid ? (p.status === 'transferred' ? `Paid${p.transferredAt ? ' ' + day(p.transferredAt) : ''}` : 'Settled') : (x?.sub ?? words(p.type))}</p></div>
        <p className={`text-sm font-semibold whitespace-nowrap ${paid ? 'text-emerald-300' : 'text-white'}`}>{formatCents(paid ? cents(p.amount) : paymentBalanceCents(p))}</p>
        <span className="flex gap-2">
          {(director || admin) && <button type="button" className={ghostBtn} onClick={() => setDocs(p.id)}>{!invoiceOk ? 'Upload invoice' : paid && !proofOk ? 'Upload proof' : 'Documents'}</button>}
          {!paid && director && <button type="button" className="btn-gold rounded-xl px-4 min-h-[40px] text-sm font-bold" onClick={() => setPaying(p)}>Pay</button>}
          {x && moreBtn(x)}
        </span>
      </div>
      {known && <div className="flex flex-wrap items-center gap-1.5">
        {pill(invoiceOk ? 'ok' : 'missing', 'Invoice')}{pill(paid ? 'ok' : 'later', 'Paid')}{pill(!paid ? 'later' : proofOk ? 'ok' : 'missing', 'Proof')}
        {adminTodo && <span className="text-xs text-gray-400">· in the admin's to-do</span>}
      </div>}
      {x && openCost === x.id && menu(x)}
    </div>;
  };
  const tick = (on: boolean) => <span aria-hidden="true" className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${on ? 'bg-emerald-400 text-emerald-950' : 'border-2 border-white/20'}`}>{on && <Check size={15} strokeWidth={3} />}</span>;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4 min-w-0 lg:order-1 order-2">
          {stages.length > 0 && <nav aria-label="Case stages" className={`${card} p-4`}>
            <p className="text-xs text-gray-400 mb-2.5">Where this car is · tap a stage to see or edit it</p>
            <div className="flex gap-1.5 overflow-x-auto sm:grid sm:overflow-visible" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
              {stages.map((s, i) => {
                const now = i === currentIndex && !s.done, sel = s.id === shown;
                return <button key={s.id} type="button" onClick={() => setView(s.id)} aria-current={now ? 'step' : undefined}
                  className={`flex-shrink-0 min-w-[92px] sm:min-w-0 text-left rounded-xl p-2 space-y-1.5 border transition-colors ${sel ? 'bg-white/[0.06] border-white/15' : 'border-transparent hover:bg-white/[0.03]'}`}>
                  <span className={`block h-1.5 rounded-full ${s.done ? 'bg-emerald-400' : now ? 'bg-gold-400' : 'bg-white/10'}`} />
                  <span className={`block text-xs leading-tight ${now ? 'text-gold-300 font-semibold' : s.done ? 'text-emerald-300' : 'text-gray-300'}`}>{NAMES[s.id]}</span>
                  <span className="block text-[10px] text-gray-500">{s.done ? 'Done' : now ? 'Now' : 'Later'}</span>
                </button>;
              })}
            </div>
          </nav>}

          {c && <section aria-live="polite" className="rounded-2xl border border-[#5A4614] bg-[#1C1708] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-wider text-[#F3C969]">STAGE {shownIndex + 1} OF {stages.length} · {NAMES[shown].toUpperCase()} · {(shownDone ? 'Done' : when).toUpperCase()}</p>
                <h2 className="text-white text-xl font-semibold leading-snug mt-1">{copy[shown][0]}</h2>
                <p className="text-sm text-[#C9C3B3] mt-1">{copy[shown][1]}</p>
              </div>
              {shown === 'money' && moneyItems.length > 0 && <span className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full bg-[#2A2210] text-[#F3C969]">{moneyItems.filter((m) => m.covered).length} of {moneyItems.length} received</span>}
            </div>

            {shown === 'sold' && <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className={row}><p className="text-xs text-gray-400">Buyer</p><p className="text-sm text-white mt-0.5">{buyerName || '—'}</p></div>
                <div className={row}><p className="text-xs text-gray-400">Sold for</p><p className="text-sm text-white mt-0.5">{formatCents(cents(soldFor ?? car.sellingPrice))}</p></div>
                <div className={row}><p className="text-xs text-gray-400">Salesperson</p><p className="text-sm text-white mt-0.5">{salespersonName || '—'}</p></div>
              </div>
              {director && onEditDeal && <button type="button" className={ghostBtn} onClick={onEditDeal}>Edit deal</button>}
            </div>}

            {shown === 'delivered' && delivery && <div className="space-y-2">
              {delivery.done ? <>
                <div className={`${row} flex flex-wrap items-center gap-3`}>
                  {tick(true)}
                  <p className="flex-1 min-w-[140px] text-sm text-white">Car delivered · payment collected</p>
                  {delivery.photo && <a href={delivery.photo} target="_blank" rel="noopener noreferrer"><img src={thumbUrl(delivery.photo, 240, 70)!} alt="Delivery photo" className="w-20 h-14 object-cover rounded-lg" /></a>}
                </div>
                {delivery.dealReceiptUrl && <a href={delivery.dealReceiptUrl} target="_blank" rel="noopener noreferrer" className={ghostBtn}>Delivery receipt</a>}
              </> : <>
                {delivery.checking ? <p className={`${row} text-sm text-[#F3C969]`}>Checking the customer balance… <button type="button" className="underline min-h-[40px]" onClick={delivery.onRefresh}>Refresh</button></p>
                  : <div className={`${row} flex flex-wrap items-center gap-3`}>
                    {tick(delivery.balance <= 0 || !!delivery.receiptUrl)}
                    <div className="flex-1 min-w-[140px]">
                      <p className="text-sm text-white">{delivery.balance >= 0.01 ? `Collect ${formatCents(cents(delivery.balance))} from the customer` : delivery.balance <= -0.01 ? `Refund ${formatCents(cents(-delivery.balance))} to the customer` : 'The customer has nothing more to pay'}</p>
                      <p className="text-xs text-gray-400">{delivery.balance >= 0.01 ? (delivery.receiptUrl ? 'Collection receipt uploaded' : 'Upload the receipt after collecting. Needed before delivery.') : delivery.balance <= -0.01 ? 'Add their bank details in the Final deal tab.' : 'Nothing to collect.'}</p>
                    </div>
                    {delivery.balance >= 0.01 && (delivery.receiptUrl
                      ? <a href={delivery.receiptUrl} target="_blank" rel="noopener noreferrer" className={ghostBtn}>View receipt</a>
                      : delivery.onUploadReceipt && <label className={`${goldBtn} cursor-pointer ${uploading ? 'opacity-60' : ''}`}>{uploading ? 'Uploading…' : 'Upload receipt'}
                        <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={uploading} onChange={async (e) => {
                          const f = e.target.files?.[0]; e.target.value = ''; if (!f || !delivery.onUploadReceipt) return;
                          setUploading(true); try { await delivery.onUploadReceipt(f); } finally { setUploading(false); }
                        }} /></label>)}
                  </div>}
                <div className={`${row} flex items-center gap-3`}>{tick(false)}<div><p className="text-sm text-white">Delivery photo</p><p className="text-xs text-gray-400">Added when you press Mark delivered.</p></div></div>
                {delivery.onDeliver && <button type="button" disabled={!(!delivery.checking && (delivery.balance <= 0 || !!delivery.receiptUrl))} onClick={delivery.onDeliver}
                  className={`${goldBtn} w-full sm:w-auto disabled:opacity-40 disabled:cursor-not-allowed`}>{!delivery.checking && (delivery.balance <= 0 || !!delivery.receiptUrl) ? 'Mark delivered' : 'Upload the collection receipt first'}</button>}
              </>}
            </div>}

            {shown === 'money' && <div className="space-y-2">
              {loanWaiting && moneyPlan && <div className={`${row} flex flex-wrap items-center gap-3`}>
                {tick(false)}
                <div className="flex-1 min-w-[140px]"><p className="text-sm text-white truncate">Bank loan · {moneyPlan.bank}</p>
                  <p className="text-xs text-gray-400">{moneyPlan.status === 'processing' ? 'Bank processing' : 'Awaiting disbursement'} · same as the Delivered tab</p></div>
                {moneyPlan.expected > 0 && <p className="text-sm font-semibold text-white whitespace-nowrap">{formatCents(cents(moneyPlan.expected))}</p>}
                {director && <span className="flex gap-2">
                  {moneyPlan.status === 'pending' && moneyPlan.onProcessing && <button type="button" className={ghostBtn} onClick={moneyPlan.onProcessing}>Mark processing</button>}
                  <button type="button" className={goldBtn} onClick={() => { setSetupError(''); setSetup(moneyPlan.expected > 0 ? moneyPlan.expected.toFixed(2) : ''); }}>Disbursed</button>
                </span>}
              </div>}
              {loanWaiting && setup !== null && <div className="rounded-xl border border-[#5A4614] bg-black/20 p-3 space-y-2">
                <label className="block text-xs text-gray-400">Loan approved by the bank (RM)<input className="input w-full rounded-lg px-3 py-2 mt-1 text-sm" inputMode="decimal" value={setup} onChange={(e) => setSetup(e.target.value)} /></label>
                <p className="text-xs text-gray-400">Next: what reached our bank, and what was deducted.</p>
                {setupError && <p role="alert" className="text-xs text-red-400">{setupError}</p>}
                <div className="flex gap-2"><button type="button" className={ghostBtn} onClick={() => setSetup(null)}>Cancel</button>
                  <button type="button" className={`${goldBtn} disabled:opacity-40`} disabled={setupBusy || !setupCents} onClick={() => void setupLoan()}>{setupBusy ? 'Saving…' : 'Continue'}</button></div>
              </div>}
              {cashWaiting && <div className={`${row} flex flex-wrap items-center gap-3`}>
                {tick(false)}
                <div className="flex-1 min-w-[140px]"><p className="text-sm text-white">Cash from the customer</p><p className="text-xs text-gray-400">Not marked received yet · same as the Delivered tab</p></div>
                {director && <button type="button" className={goldBtn} onClick={() => setRecording({ note: 'Cash from the customer' })}>Mark received</button>}
              </div>}
              {!loanWaiting && !cashWaiting && moneyItems.length === 0 && entries.length === 0 && <p className="text-sm text-gray-300">No money is expected for this car.</p>}
              {moneyItems.map(({ p, left, covered }) => <div key={p.id} className={`${row} flex flex-wrap items-center gap-3`}>
                {tick(covered)}
                <div className="flex-1 min-w-[140px]"><p className="text-sm text-white truncate">{IN_LABEL[p.type] ?? words(p.type)}{p.recipientName ? ` · ${p.recipientName}` : ''}</p>
                  <p className="text-xs text-gray-400">{covered ? 'Received' : left < cents(p.amount) ? `${formatCents(left)} still to come` : 'Waiting'}</p></div>
                <p className="text-sm font-semibold text-white whitespace-nowrap">{formatCents(cents(p.amount))}</p>
                {director && !covered && <button type="button" className={goldBtn} onClick={() => setRecording({ amountCents: left, note: `${IN_LABEL[p.type] ?? words(p.type)}${p.recipientName ? ' · ' + p.recipientName : ''}`, ...(p.type === 'loan_disbursement' ? { loan: loanContext(p.id, left) } : {}) })}>Mark received</button>}
              </div>)}
              {entries.length > 0 && <div className="pt-1 space-y-1.5">
                <p className="text-xs text-gray-400">Recorded</p>
                {entries.map((e) => <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20 px-4 py-2.5">
                  <div className="min-w-0"><p className="text-sm text-white truncate">{new Date(e.receivedOn).toLocaleDateString('en-MY')} · {e.bankName}{e.note ? ` · ${e.note}` : ''}</p>{!!e.deductionsCents && <p className="text-xs text-gray-400 truncate" title={(e.deductions ?? []).map((d) => `${d.label} ${formatCents(d.amountCents)}`).join(', ')}>+ {formatCents(e.deductionsCents)} deducted ({(e.deductions ?? []).length} items) · loan covered {formatCents(e.amountCents + e.deductionsCents)}</p>}</div>
                  <span className="flex items-center gap-2 flex-shrink-0"><span className={`text-[11px] px-2 py-0.5 rounded-full ${e.hasSlip ? 'bg-emerald-900/70 text-emerald-200' : 'bg-[#3A2C0E] text-[#F3C969]'}`}>{e.hasSlip ? 'Slip ✓' : 'No slip'}</span><span className="text-sm font-semibold text-emerald-300">{formatCents(e.amountCents)}</span></span>
                </div>)}
              </div>}
              {director && <button type="button" className="text-sm text-gold-400 min-h-[40px]" onClick={() => setRecording({})}>+ Other money received</button>}
              {expectedCents > 0 && <p className="text-xs text-gray-500">Expected in total: {formatCents(expectedCents)}</p>}
            </div>}

            {shown === 'bills' && <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {([['To pay', unpaid.length + inProgress.length, 'text-[#F3C969]'], ['Paid', paidBills.length + freeCosts.length, 'text-emerald-300']] as const).map(([k, n, tone], i) =>
                  <div key={k} className={`rounded-xl bg-[#15151A] px-3 py-2 border ${n && i === 0 ? 'border-[#5A4614]' : 'border-white/[0.07]'}`}><p className="text-xs text-gray-400">{k}</p><p className={`text-lg font-bold ${n ? tone : 'text-gray-600'}`}>{n}</p></div>)}
              </div>
              {([
                { key: 'pay', name: 'To pay', tone: 'text-[#F3C969]', count: unpaid.length + inProgress.length },
                { key: 'paid', name: 'Paid', tone: 'text-emerald-300', count: paidBills.length + freeCosts.length },
                { key: 'none', name: 'Not in Payments', tone: 'text-gray-300', count: noBill.length },
              ]).filter((g) => g.key !== 'none' || g.count > 0).map((g) => {
                const open = (billOpen[g.key] ?? true) && g.count > 0;
                return <div key={g.key} className="space-y-2">
                  <button type="button" aria-expanded={open} disabled={!g.count} onClick={() => setBillOpen((o) => ({ ...o, [g.key]: !(o[g.key] ?? true) }))} className="w-full flex items-center justify-between min-h-[36px] text-left">
                    <span className={`text-sm font-semibold ${g.count ? g.tone : 'text-gray-600'}`}>{g.name} · {g.count}</span>
                    {g.count > 0 && <ChevronRight size={16} className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />}
                  </button>
                  {open && g.key === 'pay' && <>
                    {unpaid.map((p) => billRow(p, false))}
                    {inProgress.map((x) => costRow(x, <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-950 text-sky-300">Repair not finished</span>))}
                  </>}
                  {open && g.key === 'paid' && <>
                    {paidBills.map((p) => billRow(p, true))}
                    {freeCosts.map((x) => costRow(x, <span className="text-xs text-gray-400">No cost</span>))}
                  </>}
                  {open && g.key === 'none' && <>
                    <p className="text-xs text-gray-400">These costs are on the car but have no line in Payments. Old ones were usually paid outside the app.</p>
                    {noBill.map((x) => costRow(x, <span className="text-xs text-gray-400">{x.noBillWhy}</span>))}
                  </>}
                </div>;
              })}
              {(director || admin) && (onAddMisc || onAddRepair || onPanelCharge) && <div className="flex flex-wrap gap-2 pt-1">
                {onAddMisc && <button type="button" className="rounded-xl px-4 min-h-[44px] text-sm border border-dashed border-[#5A4614] text-[#F3C969]" onClick={onAddMisc}>+ Add a bill</button>}
                {onAddRepair && <button type="button" className="rounded-xl px-4 min-h-[44px] text-sm border border-dashed border-[#5A4614] text-[#F3C969]" onClick={onAddRepair}>+ Add a repair</button>}
                {onPanelCharge && <button type="button" className="rounded-xl px-4 min-h-[44px] text-sm border border-dashed border-[#5A4614] text-[#F3C969]" onClick={onPanelCharge}>+ Panel charge</button>}
              </div>}
            </div>}

            {shown === 'dealer' && dealerPanel && <div className="space-y-3">
              <p className="text-xs text-gray-400">{car.consignment?.dealer || 'Dealer'} · {car.consignment?.terms === 'profit_split' ? `${car.consignment.splitPercent ?? 0}% of profit` : 'fixed amount'}{c.agreementMissing ? ' · agreement can follow later' : ''}</p>
              <div className="rounded-2xl bg-[#0B0B0E]/60 overflow-hidden">{dealerPanel}</div>
            </div>}
            {shown === 'dealer' && !dealerPanel && <div className={`${row} flex flex-wrap items-center justify-between gap-3`}>
              <div className="min-w-0"><p className="text-sm text-white">{car.consignment?.dealer || 'Dealer'} · {car.consignment?.terms === 'profit_split' ? `${car.consignment.splitPercent ?? 0}% of profit` : 'fixed amount'}</p>
                <p className="text-xs text-gray-400">{c.dealerNotApproved ? (c.agreementMissing ? 'Agreement can follow later.' : 'Agreement uploaded.') : 'Approved.'}</p></div>
              <button type="button" className={c.dealerNotApproved && director ? goldBtn : ghostBtn} onClick={() => onOpenDetails('consignment')}>{c.dealerNotApproved && director ? 'Open dealer approval' : 'View dealer deal'}</button>
            </div>}

            {shown === 'paper' && (todoLink
              ? <Link to={todoLink} className={`${row} flex items-center justify-between gap-3 hover:border-gold-500/30`}><span className="flex items-center gap-3 text-sm text-white"><FileText size={17} className="text-gray-400" />{paperwork ? `${paperwork} item${paperwork > 1 ? 's' : ''} open · in the to-do list` : 'Nothing open'}</span><span className="text-sm text-gold-400 flex items-center">Open to-do<ChevronRight size={16} /></span></Link>
              : <p className={`${row} text-sm text-gray-300`}>{paperwork ? `${paperwork} paperwork item${paperwork > 1 ? 's' : ''} open` : 'Nothing open'}</p>)}

            {shown === 'closed' && <p className={`${row} text-sm text-gray-300`}>{c.state === 'closed' ? 'Everything is done. Nothing more to do on this car.' : 'Nothing to press here. Finish the stages before it and the case closes by itself.'}</p>}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {nextStage && <button type="button" onClick={() => setView(nextStage.id)}
                className={`rounded-xl px-4 min-h-[44px] text-sm font-bold inline-flex items-center gap-1 ${shownDone ? 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300' : 'border border-[#5A4614] text-[#F3C969] hover:bg-[#2A2210]'}`}>
                {shownDone ? `${NAMES[shown]} done · ` : ''}Next stage: {NAMES[nextStage.id]}<ChevronRight size={16} /></button>}
              {shown !== current && <button type="button" onClick={() => setView(null)} className="rounded-xl px-3 min-h-[44px] text-sm text-[#F3C969]">Back to current stage</button>}
            </div>
          </section>}
          {!c && cases.loading && <p className="text-sm text-gray-400">Loading the case…</p>}
          {cases.error && <p role="alert" className="text-sm text-red-400">{cases.error.message}</p>}
        </div>

        <div className="space-y-4 min-w-0 lg:order-2 order-1">
          <section className={`${card} overflow-hidden relative`}>
            <button type="button" aria-label="Open photos and green card" onClick={() => onOpenMedia('photos')} className="relative block w-full h-44 bg-gradient-to-br from-[#2A2A33] to-[#17171C] group">
              {car.photo ? <img src={thumbUrl(car.photo, 900, 75)!} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <CarIcon size={56} className="absolute inset-0 m-auto text-gray-600" />}
              {c && <span className={`absolute top-3 left-3 text-xs font-semibold px-2.5 py-1 rounded-full ${c.state === 'closed' ? 'bg-emerald-900/90 text-emerald-200' : 'bg-[#3A2C0E]/95 text-[#F3C969]'}`}>{c.state === 'closed' ? 'Closed case' : 'Active case'}</span>}
              {car.carPlate && <span className="absolute top-3 right-3 text-xs font-mono font-semibold px-2 py-1 rounded-md bg-black/70 text-gold-300">{car.carPlate}</span>}
              <span className="absolute bottom-3 left-3 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-black/70 text-white group-hover:bg-black/85"><Camera size={13} />{photoCount ? `${photoCount} photo${photoCount > 1 ? 's' : ''}` : 'Add photos'}</span>
            </button>
            <button type="button" onClick={() => onOpenMedia('card')} className={`absolute top-[8.75rem] right-3 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${car.greenCard ? 'bg-emerald-900/90 text-emerald-200' : 'bg-[#3A2C0E]/95 text-[#F3C969]'}`}><FileText size={13} />{car.greenCard ? 'Green card ✓' : 'Green card missing'}</button>
            <div className="p-5 space-y-3">
              <div>
                <h1 className="font-display text-white text-2xl font-semibold">{car.year} {car.make} {car.model}</h1>
                {investorLink && <button type="button" className={`${ghostBtn} mt-2 float-right`} onClick={investorLink}>Investor deal →</button>}
                <p className="text-sm text-gray-400 mt-0.5">{consignmentIn ? `Consignment · ${car.consignment?.dealer || 'dealer'}` : car.outgoingConsignment ? 'Sent to another dealer' : car.investorFunded ? 'Investor car' : 'Own stock'}</p>
              </div>
              {profit !== null && soldFor !== null && <div className="flex items-end justify-between gap-3 pt-3 border-t border-white/[0.08]">
                <div><p className="text-xs text-gray-400">Profit</p><p className={`font-display text-3xl font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCents(cents(profit))}</p></div>
                <div className="text-right"><p className="text-xs text-gray-400">Sold for</p><p className="text-white font-semibold">{formatCents(cents(soldFor))}</p></div>
              </div>}
            </div>
          </section>

          {tabs.length > 0 && <section ref={moneyCard} className={`${card} p-5 space-y-3 scroll-mt-24`}>
            {tabs.length > 1 && <div role="tablist" aria-label="Profit and deal" className="grid gap-1 rounded-xl border border-white/[0.08] bg-black/20 p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
              {tabs.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setMoneyTab(t)}
                className={`min-h-[40px] rounded-lg text-sm font-semibold ${tab === t ? 'bg-[#2A2210] text-[#F3C969]' : 'text-gray-400 hover:text-white'}`}>{t === 'profit' ? 'Profit' : 'Final deal'}</button>)}
            </div>}
            {tab === 'profit' && showProfit && <div className="space-y-2.5">
              <h2 className="text-white font-semibold mb-1">How the profit adds up</h2>
              <div className="flex justify-between text-sm"><span className="text-gray-300">Sold for</span><span className="text-white">{formatCents(cents(soldFor))}</span></div>
              {costs.filter((r) => r.amount !== 0).map((r) => <div key={r.label} className="flex justify-between text-sm"><span className="text-gray-300">{r.label}</span><span className="text-white">− {formatCents(cents(r.amount))}</span></div>)}
              <div className="flex justify-between pt-2.5 border-t border-white/[0.08]"><span className="font-semibold text-white">Profit</span><span className={`font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCents(cents(profit))}</span></div>
            </div>}
            {tab === 'deal' && deal && <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-white font-semibold">The customer's deal</h2>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${deal.approval === 'approved' ? 'bg-emerald-950 text-emerald-300' : deal.approval === 'rejected' ? 'bg-red-950 text-red-300' : 'bg-[#2A2210] text-[#F3C969]'}`}>{deal.approval === 'approved' ? 'Approved ✓' : deal.approval === 'rejected' ? 'Rejected' : 'Waiting for approval'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[['Buyer', buyerName || '—'], ['Salesperson', salespersonName || '—'], ['Payment', deal.payment], ['Loan bank', deal.bank || '—']].filter(([k]) => k !== 'Loan bank' || deal.payment !== 'Cash').map(([k, v]) => <div key={k} className="rounded-xl bg-white/[0.04] px-3 py-2.5 min-w-0"><p className="text-xs text-gray-400">{k}</p><p className="text-sm text-white mt-0.5 truncate" title={v}>{v}</p></div>)}
              </div>
              <div className="space-y-2 pt-3 border-t border-white/[0.08]">
                <div className="flex justify-between text-sm"><span className="text-gray-300">Selling price</span><span className="text-white">{formatCents(cents(deal.sellingPrice))}</span></div>
                {deal.plus.map((l) => <div key={'p' + l.label} className="flex justify-between text-sm"><span className="text-gray-300">+ {l.label}</span><span className="text-white">{formatCents(cents(l.amount))}</span></div>)}
                {deal.minus.map((l) => <div key={'m' + l.label} className="flex justify-between text-sm"><span className="text-gray-300">− {l.label}</span><span className="text-white">− {formatCents(cents(l.amount))}</span></div>)}
                <div className="flex justify-between pt-2.5 border-t border-white/[0.08]">
                  <span className="font-semibold text-white">{Math.abs(deal.balance) < 0.01 ? 'Nothing more to pay' : deal.balance < 0 ? 'We refund the customer' : 'Customer pays'}</span>
                  <span className={`font-bold ${deal.balance < 0 ? 'text-sky-300' : 'text-[#F3C969]'}`}>{formatCents(cents(Math.abs(deal.balance)))}</span>
                </div>
              </div>
              {refund && deal.balance <= -0.01 && <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-3 space-y-2">
                <p className="text-sm font-semibold text-sky-200">Refund {formatCents(cents(-deal.balance))} to the customer</p>
                {refund.claim?.status === 'transferred' ? <>
                  <p className="text-sm text-emerald-300">Transferred{refund.claim.transferredAt ? ' ' + day(refund.claim.transferredAt) : ''} ✓{refund.claim.bankName ? ` · ${refund.claim.bankName} ${refund.claim.accountNumber ?? ''}` : ''}</p>
                  {refund.claim.receiptUrl && <a href={refund.claim.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-300 underline">View transfer receipt</a>}
                </> : refund.claim?.bankName ? <>
                  <p className="text-sm text-[#F3C969]">Waiting for transfer · {refund.claim.bankName} {refund.claim.accountNumber}</p>
                  <p className="text-xs text-gray-400">Pay it from Bills paid in the guide.</p>
                </> : (director || admin) ? <>
                  <input aria-label="Customer's bank" className="input w-full rounded-lg px-3 py-2 text-sm" placeholder="Bank (e.g. Maybank)" value={refund.form.bank} onChange={(e) => refund.setForm({ ...refund.form, bank: e.target.value })} />
                  <input aria-label="Account number" className="input w-full rounded-lg px-3 py-2 text-sm font-mono" inputMode="numeric" placeholder="Account number" value={refund.form.accountNo} onChange={(e) => refund.setForm({ ...refund.form, accountNo: e.target.value })} />
                  <input aria-label="Account holder" className="input w-full rounded-lg px-3 py-2 text-sm" placeholder="Account holder name" value={refund.form.accountName} onChange={(e) => refund.setForm({ ...refund.form, accountName: e.target.value })} />
                  <button type="button" className={`${goldBtn} w-full disabled:opacity-40`} disabled={refund.saving || !refund.form.bank.trim() || !refund.form.accountNo.trim() || !refund.form.accountName.trim()} onClick={refund.onSubmit}>{refund.saving ? 'Sending…' : 'Send refund to Payments'}</button>
                </> : <p className="text-xs text-gray-400">No bank details yet.</p>}
              </div>}
              {deal.tradeIn && <div className="rounded-xl bg-white/[0.04] px-3 py-2.5 flex justify-between gap-3 text-sm"><span className="text-gray-300 min-w-0 truncate">{deal.tradeIn.swap ? 'Swapped for' : 'Trade-in'} · {deal.tradeIn.label}</span><span className="text-white flex-shrink-0">{formatCents(cents(deal.tradeIn.amount))}</span></div>}
              {deal.rejectionNotes && <p className="text-sm text-red-300">Rejected: {deal.rejectionNotes}</p>}
              {deal.notes && <p className="text-sm text-gray-300">Note: {deal.notes}</p>}
              <p className="text-xs text-gray-400">{[deal.submittedBy && `Submitted by ${deal.submittedBy}${deal.submittedAt ? ' · ' + day(deal.submittedAt) : ''}`, deal.approvedBy && `approved by ${deal.approvedBy}${deal.approvedAt ? ' · ' + day(deal.approvedAt) : ''}`].filter(Boolean).join(' · ')}</p>
              {(onEditDeal && director || onReceipt || deal.receiptUrl) && <div className="flex flex-wrap gap-2">
                {director && onEditDeal && <button type="button" className={`${ghostBtn} flex-1`} onClick={onEditDeal}>Edit deal</button>}
                {onReceipt && <button type="button" className={`${ghostBtn} flex-1`} disabled={generatingReceipt} onClick={onReceipt}>{generatingReceipt ? 'Making receipt…' : deal.receiptUrl ? 'New receipt' : 'Make receipt'}</button>}
                {deal.receiptUrl && <a href={deal.receiptUrl} target="_blank" rel="noopener noreferrer" className={`${ghostBtn} flex-1 text-center`}>View receipt</a>}
              </div>}
            </div>}
          </section>}
        </div>
      </div>

      {records && <section className={`${card} p-5 space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-white font-semibold">Car records</h2>
          <div role="tablist" aria-label="Car records" className="flex gap-1 rounded-xl border border-white/[0.08] bg-black/20 p-1">
            {([['info', 'Car info'], ['loans', 'Loan log'], ...(records.moves ? [['moves', 'Movement log']] : [])] as ['info' | 'loans' | 'moves', string][]).map(([id, name]) =>
              <button key={id} type="button" role="tab" aria-selected={recTab === id} onClick={() => setRecTab(id)}
                className={`min-h-[36px] px-3 rounded-lg text-sm font-semibold ${recTab === id ? 'bg-[#2A2210] text-[#F3C969]' : 'text-gray-400 hover:text-white'}`}>{name}</button>)}
          </div>
        </div>
        {recTab === 'info' && <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {records.info.map(([k, v]) => <div key={k} className="rounded-xl bg-white/[0.04] px-3 py-2.5 min-w-0"><p className="text-xs text-gray-400">{k}</p><p className="text-sm text-white mt-0.5 truncate" title={v}>{v}</p></div>)}
          </div>
          {records.notes && <div className="rounded-xl bg-white/[0.04] px-3 py-2.5"><p className="text-xs text-gray-400">Notes</p><p className="text-sm text-gray-200 mt-0.5 whitespace-pre-line">{records.notes}</p></div>}
          {records.onEdit && <button type="button" className={ghostBtn} onClick={records.onEdit}>Edit car info</button>}
        </div>}
        {recTab === 'loans' && <div className="space-y-2">
          {records.loans.length === 0 && <p className="text-sm text-gray-400">No loan submissions recorded.</p>}
          {records.loans.map((l) => <div key={l.id} className={`rounded-xl bg-white/[0.04] px-3 py-2.5 space-y-2 ${l.inactive ? 'opacity-50' : ''}`}>
            <p className="text-sm text-white">{l.name}<span className="text-xs text-gray-400"> · by {l.by}{l.inactive ? ' · inactive' : ''}</span></p>
            <div className="flex flex-wrap gap-1.5">{l.apps.map((a) => <span key={a.bank} className={`text-xs px-2 py-0.5 rounded-full ${LOAN_TONE[a.status] ?? 'bg-white/[0.06] text-gray-400'}`}>{a.bank} · {a.status}</span>)}</div>
          </div>)}
        </div>}
        {recTab === 'moves' && records.moves && <div className="space-y-2">
          {records.moves.length === 0 && <p className="text-sm text-gray-400">No movements recorded.</p>}
          {records.moves.map((m) => <div key={m.id} className="rounded-xl bg-white/[0.04] px-3 py-2.5 flex items-start gap-3">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${m.type === 'out' ? 'bg-red-950 text-red-300' : 'bg-emerald-950 text-emerald-300'}`}>{m.type === 'out' ? 'OUT' : 'IN'}</span>
            <div className="min-w-0"><p className="text-sm text-white">{m.text}</p><p className="text-xs text-gray-400">{m.when}</p>{m.notes && <p className="text-xs text-gray-500 mt-0.5">{m.notes}</p>}</div>
          </div>)}
        </div>}
      </section>}
      <button type="button" className="text-xs text-gray-500 hover:text-gray-300 underline min-h-[40px]" onClick={() => onOpenDetails()}>{detailsOpen ? 'Hide the old full page' : 'Open the old full page'}</button>
      {recording && <RecordMoney car={car} actorId={actorId} defaultAmountCents={recording.amountCents} defaultNote={recording.note} loan={recording.loan} onClose={() => setRecording(null)} onSaved={reload} />}
      {paying && <CompanyBankPaymentDialog key={actorId + ':' + paying.id} payments={[paying]} actorId={actorId} onClose={() => { setPaying(null); reload(); }} />}
      {docs && <CompanyPaymentDocuments paymentId={docs} onClose={() => { setDocs(null); reload(); }} />}
    </div>
  );
}
