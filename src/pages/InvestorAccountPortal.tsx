import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowUp, ArrowUpCircle, Car as CarIcon, ChevronLeft, ChevronRight, Clock, Eye, FileText, Home, List, Lock, Pencil, Plus, Printer, Receipt, TrendingUp, Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import Modal from '../components/Modal';
import InvestorMoneyDocuments from '../components/InvestorMoneyDocuments';
import InvestorFinanceCar, { ActionErrorBox, CarPhoto, Field, LoadState, PendingSaves, Section, StateChip, profitFigure } from '../components/InvestorFinanceCar';
import {
  carTitle, earnedProfit, entryLabel, formatCents, formatDay, investorRequest, isInStock, malaysiaToday, parseRinggit, useInvestorAction, useInvestorQuery,
  WITHDRAWAL_LABEL, type CarSummary, type CashEntry, type InvestorSnapshot,
} from '../lib/investorFinance';
import DealerAccountView from '../components/DealerAccountView';
import DealerStockForm from '../components/DealerStockForm';
import { dealerCarStatus, dealerRequest, printAgreement, termsLabel, type DealerCar, type DealerList, type DealerView } from '../lib/dealerAccounts';

type Tab = 'home' | 'cars' | 'activity';
type CarFilter = 'invested' | 'dealer' | 'sold';

// Money put into a car so far: purchase paid plus its paid costs.
const moneyInCar = (c: CarSummary) => (c.purchasePaidCents ?? c.purchaseCents ?? 0) + (c.costCents ?? 0) - (c.unpaidBillCents ?? 0);
const dealerInStock = (c: DealerCar) => !['delivered', 'sold'].includes(c.status);
const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function entryIcon(e: CashEntry) {
  if (e.kind === 'capital_converted' || e.kind === 'capital_in' || e.kind === 'capital_advance') return { icon: Lock, cls: 'bg-gold-500/15 text-gold-300' };
  if (e.kind === 'withdrawal_out') return { icon: ArrowUp, cls: 'bg-obsidian-700 text-gray-300' };
  if (e.kind === 'car_purchase' || e.kind === 'car_expense') return { icon: CarIcon, cls: 'bg-obsidian-700 text-gray-300' };
  if (e.amountCents > 0) return { icon: TrendingUp, cls: 'bg-emerald-500/15 text-emerald-400' };
  return { icon: Receipt, cls: 'bg-obsidian-700 text-gray-300' };
}

function ActivityRow({ e }: { e: CashEntry }) {
  const { icon: Icon, cls } = entryIcon(e);
  return (
    <div className="flex items-center gap-3 py-3 border-b border-white/5 last:border-0">
      <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${cls}`}><Icon size={17} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-gray-100 text-sm truncate">{entryLabel(e.kind)}</p>
        <p className="text-gray-500 text-xs">{formatDay(e.paidOn ?? e.recordedAt)}</p>
      </div>
      <span className={`text-sm font-semibold shrink-0 ${e.amountCents >= 0 ? 'text-emerald-400' : 'text-gray-200'}`}>{e.amountCents >= 0 ? '+ ' : ''}{formatCents(e.amountCents)}</span>
    </div>
  );
}

// Profit over time from cars whose profit is confirmed; nothing drawn with fewer than two points.
function ProfitLine({ cars }: { cars: CarSummary[] }) {
  const pts = cars.filter((c) => c.settlement).sort((a, b) => (a.settledAt ?? '').localeCompare(b.settledAt ?? ''))
    .reduce<number[]>((acc, c) => [...acc, (acc[acc.length - 1] ?? 0) + (c.settlement?.investor_result_cents ?? 0)], [0]);
  if (pts.length < 3) return null;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (pts.length - 1)) * 200).toFixed(1)} ${(32 - ((v - min) / span) * 28).toFixed(1)}`).join(' ');
  return <svg viewBox="0 0 200 36" className="w-full h-9 mt-2" fill="none" aria-hidden="true"><path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function InvestedCarCard({ car, onOpen, wide }: { car: CarSummary; onOpen: () => void; wide?: boolean }) {
  const profit = profitFigure(car);
  return (
    <button type="button" onClick={onOpen} className={`text-left bg-card-gradient border border-obsidian-400/70 rounded-2xl overflow-hidden hover:border-gold-500/40 transition-colors ${wide ? 'w-full' : 'w-64 shrink-0 snap-start'}`}>
      <div className="relative">
        <CarPhoto src={car.photo} className={wide ? 'h-48 w-full' : 'h-36 w-full'} />
        <span className="absolute left-2.5 top-2.5"><StateChip state={car.state} /></span>
      </div>
      <div className="p-3.5 space-y-2.5">
        <div className="min-w-0">
          <p className="text-white font-semibold text-[15px] truncate">{carTitle(car)}</p>
          {car.plate && <p className="text-gray-500 text-xs">{car.plate}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-obsidian-800/70 rounded-xl px-3 py-2"><p className="text-gray-500 text-[11px]">Your money in it</p><p className="text-white text-sm font-semibold mt-0.5">{formatCents(moneyInCar(car))}</p></div>
          <div className="bg-obsidian-800/70 rounded-xl px-3 py-2"><p className="text-gray-500 text-[11px]">{profit.label}</p><p className={`text-sm font-semibold mt-0.5 ${profit.tone}`}>{profit.value}</p></div>
        </div>
      </div>
    </button>
  );
}

function DealerCarCard({ car, dealerName, onEdit }: { car: DealerCar; dealerName: string; onEdit?: () => void }) {
  return (
    <div className="bg-card-gradient border border-obsidian-400/70 rounded-2xl overflow-hidden">
      <div className="relative">
        <CarPhoto src={car.photo} className="h-48 w-full" />
        <span className="absolute left-2.5 top-2.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-obsidian-950/80 text-sky-300 border-sky-500/30">{dealerCarStatus(car.status)}</span>
      </div>
      <div className="p-3.5 space-y-2.5">
        <div className="min-w-0">
          <p className="text-white font-semibold text-[15px] truncate">{[car.year, car.make, car.model].filter(Boolean).join(' ')}</p>
          <p className="text-gray-500 text-xs truncate">{[car.plate, car.mileage ? `${car.mileage.toLocaleString()} km` : null, `from ${dealerName}`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-obsidian-800/70 rounded-xl px-3 py-2"><p className="text-gray-500 text-[11px]">Selling price</p><p className="text-white text-sm font-semibold mt-0.5">{car.sellingPriceCents ? formatCents(car.sellingPriceCents) : 'Not set'}</p></div>
          <div className="bg-obsidian-800/70 rounded-xl px-3 py-2"><p className="text-gray-500 text-[11px]">Deal</p><p className="text-white text-sm font-semibold mt-0.5 truncate">{termsLabel(car.terms)}</p></div>
        </div>
        {onEdit && car.editable && <button type="button" onClick={onEdit} className="text-gold-300 text-xs flex items-center gap-1"><Pencil size={12} /> Update details</button>}
      </div>
    </div>
  );
}

function SoldRow({ car, onOpen }: { car: CarSummary; onOpen: () => void }) {
  const profit = profitFigure(car);
  return (
    <button type="button" onClick={onOpen} className="w-full text-left flex items-center gap-3 bg-card-gradient border border-obsidian-400/70 rounded-2xl p-3 hover:border-gold-500/40 transition-colors">
      <CarPhoto src={car.photo} className="w-24 h-16 rounded-xl shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm font-semibold truncate">{carTitle(car)}</p>
        <p className="text-gray-500 text-xs">{car.settledAt ? `Profit confirmed ${formatDay(car.settledAt)}` : 'Sold · profit not confirmed yet'}</p>
        <p className={`text-xs font-semibold mt-0.5 ${profit.tone}`}>{profit.label}: {profit.value}</p>
      </div>
      <ChevronRight size={16} className="text-gray-600 shrink-0" />
    </button>
  );
}

function QuickAction({ icon: Icon, label, onClick, disabled }: { icon: typeof Home; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex flex-col items-center gap-2 text-xs text-gray-200 disabled:opacity-40">
      <span className="w-[52px] h-[52px] rounded-2xl bg-obsidian-800 border border-obsidian-400/50 flex items-center justify-center text-gold-300"><Icon size={21} /></span>{label}
    </button>
  );
}

function Heading({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div><p className="font-display text-white font-semibold text-base">{title}</p>{note && <p className="text-gray-500 text-xs mt-0.5">{note}</p>}</div>
      {action}
    </div>
  );
}

// preview: the Director sees an investor's portal as that investor would,
// read-only. Same screens, loaded with the Director's own login; every button
// that saves (withdraw, add or update dealer stock) is hidden.
export default function InvestorAccountPortal({ preview }: { preview?: { potId: string } } = {}) {
  const actorId = useStore((s) => s.currentUser?.id);
  const potKey = preview ? ':' + preview.potId : '';
  const query = useInvestorQuery<InvestorSnapshot>(actorId ? actorId + potKey : null, () => investorRequest<InvestorSnapshot>('snapshot', preview ? { potId: preview.potId } : {}));
  const act = useInvestorAction(actorId);
  const [tab, setTab] = useState<Tab>('home');
  const [carFilter, setCarFilter] = useState<CarFilter>('invested');
  const [openCar, setOpenCar] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const snap = query.data;
  // A dealer linked to this investor (e.g. 2TN): their consignment stock and payouts.
  // They may add stock and update their own cars; prices and terms stay with AutoDream.
  const dealer = useInvestorQuery<DealerView>(actorId ? actorId + (preview ? ':dealer' + potKey : ':my-dealer') : null, async () => {
    if (!preview) return dealerRequest<DealerView>('mine');
    const linked = (await dealerRequest<DealerList>('list')).dealers.find((d) => d.potId === preview.potId);
    return linked ? dealerRequest<DealerView>('view', { dealerId: linked.id }) : ({ dealer: null } as DealerView);
  });
  const [dealerOpen, setDealerOpen] = useState(false);
  const dv = dealer.data?.dealer ? dealer.data : null;
  const dealerName = dv?.dealer?.name;
  // undefined = closed, null = add a new car, a car = update that car.
  const [stockForm, setStockForm] = useState<DealerCar | null | undefined>(undefined);

  const { stock, sold, earned, earnedThisMonth } = useMemo(() => {
    const cars = snap?.cars ?? [];
    const month = malaysiaToday().slice(0, 7);
    return {
      stock: cars.filter(isInStock),
      sold: cars.filter((c) => !isInStock(c)),
      earned: cars.reduce((sum, c) => sum + (earnedProfit(c) ?? 0), 0),
      earnedThisMonth: cars.filter((c) => (c.settledAt ?? '').slice(0, 7) === month).reduce((sum, c) => sum + (earnedProfit(c) ?? 0), 0),
    };
  }, [snap]);

  if (!actorId) return null;
  const potId = snap?.position.potId;
  const pos = snap?.position;
  const waiting = pos?.advanceWaitingCents ?? 0;
  const available = waiting > 0 ? 0 : pos?.availableCents ?? 0;
  const investedValue = (pos?.cashCents ?? 0) + (pos?.investedCents ?? 0) - waiting;
  const owed = dv?.totals.owedCents ?? 0;
  const total = investedValue + owed;
  const openWithdrawal = snap?.withdrawals.find((w) => w.state === 'requested' || w.state === 'approved');
  const latestLock = dv ? [...dv.conversions].sort((a, b) => (b.convertedOn + b.createdAt).localeCompare(a.convertedOn + a.createdAt))[0] : undefined;
  const entries = [...(snap?.entries ?? [])].sort((a, b) => (b.paidOn ?? b.recordedAt).localeCompare(a.paidOn ?? a.recordedAt) || b.recordedAt.localeCompare(a.recordedAt));
  const dealerStock = dv ? dv.cars.filter(dealerInStock) : [];
  const dealerSold = dv ? dv.cars.length - dealerStock.length : 0;
  const cents = parseRinggit(amount);
  const tooMuch = cents !== null && cents > available;
  const slot = `withdraw:${potId ?? 'own'}`;

  const submitWithdrawal = async () => {
    if (!cents || tooMuch || !potId) return;
    const done = await act.run(slot, 'request_withdrawal', { potId, amountCents: cents }, `Withdrawal request ${formatCents(cents)}`);
    if (done) { setWithdrawOpen(false); setAmount(''); await query.reload(); }
  };
  const retryWithdrawal = async (s: string) => { if (await act.retry(s)) { setWithdrawOpen(false); setAmount(''); await query.reload(); } };
  const printLatest = () => { if (dv && latestLock && !printAgreement(dv, latestLock)) alert('Allow pop-ups for this site to print the agreement.'); };
  const addCar = preview || !dv ? undefined : () => setStockForm(null);
  const goCars = (f: CarFilter) => { setCarFilter(f); setTab('cars'); window.scrollTo({ top: 0 }); };

  const banner = preview ? (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-sky-500/10 border border-sky-500/30 text-sky-200 rounded-xl px-4 py-2.5 text-xs">
      <span className="flex items-center gap-2"><Eye size={14} /> Preview: this is what {snap?.profile.name ?? 'this investor'} sees. Nothing can be saved here.</span>
      <Link to="/investor-finance" className="flex items-center gap-1 text-sky-300 font-semibold"><ChevronLeft size={13} /> Back to Investor accounts</Link>
    </div>
  ) : null;
  const stockFormModal = !preview && stockForm !== undefined && (
    <DealerStockForm key={stockForm?.carId ?? 'new'} actorId={actorId} dealerName={dealerName ?? 'dealer'} car={stockForm}
      onClose={() => setStockForm(undefined)} onSaved={() => { setStockForm(undefined); void dealer.reload(); }} />
  );

  if (openCar) return (
    <div className="max-w-2xl mx-auto space-y-4">
      {banner}
      <InvestorFinanceCar carId={openCar} actorId={actorId} mode={preview ? 'viewer' : 'investor'} onClose={() => setOpenCar(null)} />
    </div>
  );

  // The dealer's full consignment account: payouts, locks and agreements.
  if (dealerOpen && dv) return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {banner}
      <button type="button" onClick={() => setDealerOpen(false)} className="flex items-center gap-1 text-gold-300 text-sm"><ChevronLeft size={16} /> Back</button>
      <div>
        <h1 className="font-display text-white font-bold text-xl">{dealerName} consignment</h1>
        <p className="text-gray-500 text-sm mt-0.5">Your cars with AutoDream and what is owed to you</p>
      </div>
      <DealerAccountView view={dv} audience="dealer" onAdd={addCar} onEdit={preview ? undefined : (c) => setStockForm(c)} />
      {stockFormModal}
    </div>
  );

  const withdrawBlock = openWithdrawal ? (
    <div className="flex items-center justify-between gap-3 bg-obsidian-800/60 border border-amber-500/20 rounded-xl px-4 py-3">
      <span className="flex items-center gap-2 text-amber-300 text-xs"><Clock size={14} /> {WITHDRAWAL_LABEL[openWithdrawal.state]}</span>
      <span className="text-white font-semibold text-sm">{formatCents(openWithdrawal.amountCents)}</span>
    </div>
  ) : null;

  const home = snap && (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-obsidian-800/80 to-obsidian-900/60 border border-gold-500/25 rounded-3xl p-5 sm:p-6">
        <p className="text-gold-300 text-xs font-semibold uppercase tracking-wider">Total with AutoDream</p>
        <p className="text-white font-display font-bold text-4xl sm:text-5xl mt-2 tracking-tight">{formatCents(total)}</p>
        {earnedThisMonth !== 0 && <p className={`text-sm mt-1.5 ${earnedThisMonth > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{earnedThisMonth > 0 ? '+ ' : ''}{formatCents(earnedThisMonth)} profit this month</p>}
      </div>

      <div className={`flex gap-3 overflow-x-auto snap-x pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid ${dv ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
        <div className="snap-start shrink-0 w-[78%] sm:w-auto rounded-2xl p-4 bg-gold-300 text-obsidian-950">
          <div className="flex items-center justify-between"><p className="text-sm font-semibold">Invested account</p><TrendingUp size={18} /></div>
          <p className="font-display font-bold text-2xl mt-3">{formatCents(investedValue)}</p>
          <p className="text-xs mt-0.5">{formatCents(available)} free to withdraw · {formatCents(earned)} profit</p>
          {waiting > 0 && <p className="text-[11px] mt-0.5 text-amber-200">{formatCents(waiting)} fronted by AutoDream, waiting for your capital</p>}
          <ProfitLine cars={snap.cars} />
        </div>
        {dv && (
          <button type="button" onClick={() => setDealerOpen(true)} className="snap-start shrink-0 w-[78%] sm:w-auto text-left rounded-2xl p-4 bg-obsidian-800/80 border border-obsidian-400/60 hover:border-gold-500/40 transition-colors">
            <div className="flex items-center justify-between"><p className="text-white text-sm font-semibold">Consignment · {dealerName}</p><ChevronRight size={18} className="text-gray-500" /></div>
            <p className="text-white font-display font-bold text-2xl mt-3">{formatCents(owed)}</p>
            <p className={`text-xs mt-0.5 ${owed > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>{owed > 0 ? 'Still to be paid to you' : 'All paid'}</p>
            <p className="text-gray-500 text-xs mt-4">{dealerStock.length} in stock · {dealerSold} sold{dv.totals.convertedCents > 0 ? ` · ${formatCents(dv.totals.convertedCents)} kept as investment` : ''}</p>
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {!preview && <QuickAction icon={ArrowUpCircle} label="Withdraw" onClick={() => setWithdrawOpen(true)} disabled={available <= 0 || !!openWithdrawal} />}
          <QuickAction icon={FileText} label="Statement" onClick={() => setTab('activity')} />
          {latestLock && <QuickAction icon={Printer} label="Agreement" onClick={printLatest} />}
          {addCar && <QuickAction icon={Plus} label="Add car" onClick={addCar} />}
        </div>
        {withdrawBlock}
        <PendingSaves pending={act.pending} busy={act.busy} onRetry={(s) => void retryWithdrawal(s)} onDiscard={act.discard} />
      </div>

      <div className="space-y-3">
        <Heading title="Your cars" note={stock.length ? `Your money is working in ${stock.length} car${stock.length === 1 ? '' : 's'}` : undefined}
          action={<button type="button" onClick={() => goCars('invested')} className="text-gold-300 text-sm">See all</button>} />
        {stock.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 bg-card-gradient border border-obsidian-400/70 rounded-2xl">
            <CarIcon size={30} className="text-gray-600 mb-2" /><p className="text-gray-500 text-sm">No cars in stock right now</p>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto snap-x pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
            {stock.map((car) => <InvestedCarCard key={car.carId} car={car} onOpen={() => setOpenCar(car.carId)} />)}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Heading title="Recent activity" action={entries.length > 4 ? <button type="button" onClick={() => setTab('activity')} className="text-gold-300 text-sm">See all</button> : undefined} />
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-2xl px-4 py-1">
          {entries.length === 0 ? <p className="text-gray-500 text-sm py-4">No money recorded yet.</p> : entries.slice(0, 4).map((e) => <ActivityRow key={e.id} e={e} />)}
        </div>
      </div>
    </div>
  );

  const filters: [CarFilter, string][] = [['invested', `Invested ${stock.length}`], ...(dv ? [['dealer', `${dealerName} stock ${dealerStock.length}`] as [CarFilter, string]] : []), ['sold', `Sold ${sold.length}`]];
  const cars = snap && (
    <div className="space-y-5">
      <div className={`grid gap-2 ${dv ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-2xl px-3 py-2.5"><p className="text-gray-500 text-[11px]">In cars</p><p className="text-white text-sm font-semibold mt-0.5">{formatCents(pos?.investedCents ?? 0)}</p></div>
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-2xl px-3 py-2.5"><p className="text-gray-500 text-[11px]">Profit so far</p><p className={`text-sm font-semibold mt-0.5 ${earned >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCents(earned)}</p></div>
        {dv && <div className="bg-card-gradient border border-obsidian-400/70 rounded-2xl px-3 py-2.5"><p className="text-gray-500 text-[11px]">{dealerName} owed</p><p className={`text-sm font-semibold mt-0.5 ${owed > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>{formatCents(owed)}</p></div>}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {filters.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={carFilter === key} onClick={() => setCarFilter(key)} className={`px-4 py-2 rounded-full text-xs font-semibold border transition-colors ${carFilter === key ? 'bg-gold-500/15 text-gold-300 border-gold-500/40' : 'text-gray-400 border-obsidian-400/60'}`}>{label}</button>
        ))}
        {addCar && <button type="button" onClick={addCar} aria-label="Add car" className="btn-gold ml-auto w-10 h-10 rounded-full flex items-center justify-center"><Plus size={18} /></button>}
      </div>
      {carFilter === 'invested' && (stock.length === 0 ? <p className="text-gray-500 text-sm text-center py-10">No cars in stock right now</p>
        : <div className="grid sm:grid-cols-2 gap-4">{stock.map((car) => <InvestedCarCard key={car.carId} car={car} wide onOpen={() => setOpenCar(car.carId)} />)}</div>)}
      {carFilter === 'dealer' && dv && (dealerStock.length === 0 ? <p className="text-gray-500 text-sm text-center py-10">No {dealerName} cars in stock</p>
        : <div className="grid sm:grid-cols-2 gap-4">{dealerStock.map((car) => <DealerCarCard key={car.carId} car={car} dealerName={dealerName ?? 'dealer'} onEdit={preview ? undefined : () => setStockForm(car)} />)}</div>)}
      {carFilter === 'dealer' && dv && <button type="button" onClick={() => setDealerOpen(true)} className="w-full text-center text-gold-300 text-sm py-2">Sold {dealerName} cars and payouts</button>}
      {carFilter === 'sold' && (sold.length === 0 ? <p className="text-gray-500 text-sm text-center py-10">No sold cars yet</p>
        : <div className="grid sm:grid-cols-2 gap-3">{sold.map((car) => <SoldRow key={car.carId} car={car} onOpen={() => setOpenCar(car.carId)} />)}</div>)}
    </div>
  );

  const activity = snap && (
    <div className="space-y-5">
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-2xl px-4 py-1">
        {entries.length === 0 ? <p className="text-gray-500 text-sm py-4">No money recorded yet.</p> : entries.map((e) => <ActivityRow key={e.id} e={e} />)}
      </div>
      <p className="text-gray-600 text-[11px]">Recorded by AutoDream staff from bank slips. Not automatically matched to a bank statement.</p>
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-2xl overflow-hidden">
        <Section title="Withdrawals" hint={`${snap.withdrawals.length}`} defaultOpen={snap.withdrawals.length > 0}>
          {snap.withdrawals.length === 0 ? <p className="text-gray-500 text-xs">No withdrawals yet.</p> : snap.withdrawals.map((w) => (
            <div key={w.id} className="flex justify-between gap-3 text-xs">
              <div className="text-gray-300">{WITHDRAWAL_LABEL[w.state]} <span className="text-gray-600">· {formatDay(w.requestedAt)}</span>{w.note && <span className="block text-gray-500">{w.note}</span>}{snap.withdrawalDestinations?.filter(d=>d.withdrawalId===w.id).map(d=><span key={d.destinationId} className="block text-gray-400">{d.bankName} · account ending {d.accountNumber.slice(-4)} · {d.accountHolder}</span>)}{w.state === 'paid' && <InvestorMoneyDocuments source={{ target: 'withdrawal', withdrawalId: w.id }} amountCents={w.amountCents} />}</div>
              <span className="text-white font-medium shrink-0">{formatCents(w.amountCents)}</span>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );

  const tabs: [Tab, string, typeof Home][] = [['home', 'Home', Home], ['cars', 'Cars', CarIcon], ['activity', 'Activity', List]];
  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-gray-400 text-sm">{greeting()},</p>
          <h1 className="font-display text-white font-bold text-xl truncate">{snap?.profile.name ?? 'My investment'}</h1>
        </div>
        <span className="w-11 h-11 rounded-full bg-gold-500/15 text-gold-300 flex items-center justify-center shrink-0"><Wallet size={19} /></span>
      </div>
      {banner}
      <div className="grid grid-cols-3 gap-1 bg-obsidian-800/70 border border-obsidian-400/50 rounded-2xl p-1">
        {tabs.map(([key, label, Icon]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${tab === key ? 'bg-gold-500/15 text-gold-300' : 'text-gray-400'}`}><Icon size={15} /> {label}</button>
        ))}
      </div>

      <LoadState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
        {tab === 'home' ? home : tab === 'cars' ? cars : activity}
      </LoadState>
      {stockFormModal}

      <Modal isOpen={!preview && withdrawOpen} onClose={() => setWithdrawOpen(false)} title="Request a withdrawal"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setWithdrawOpen(false)} className="btn-ghost px-4 py-2 rounded-lg text-sm">Cancel</button>
            <button type="button" onClick={() => void submitWithdrawal()} disabled={!cents || tooMuch || act.busy !== null || act.pending.some((p) => p.slot === slot)} className="btn-gold px-4 py-2 rounded-lg text-sm disabled:opacity-40">{act.busy === slot ? 'Sending…' : 'Send request'}</button>
          </div>
        }>
        <div className="space-y-3">
          <p className="text-gray-400 text-xs">Available: <span className="text-white font-semibold">{formatCents(available)}</span></p>
          <Field label="Amount (RM)">
            <input inputMode="decimal" autoFocus className="input w-full px-3 py-2.5 rounded-lg text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          {tooMuch && <p className="text-red-400 text-[11px]">More than your available balance.</p>}
          <p className="text-gray-500 text-[11px]">The Director reviews every request. Nothing is transferred from this screen — you will see it here once the company records the payment.</p>
          <ActionErrorBox error={act.error} slot={slot} onRetry={() => void retryWithdrawal(slot)} onDismiss={act.clearError} />
        </div>
      </Modal>
    </div>
  );
}
