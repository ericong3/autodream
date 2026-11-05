import { useState } from 'react';
import CompanyPot from '../components/CompanyPot';
import { companyBankPaymentsEnabled } from '../lib/companyBankPayments';
import { useSearchParams } from 'react-router-dom';
import { Plus, Link2, Copy, Landmark, Users, ChevronLeft } from 'lucide-react';
import { useStore } from '../store';
import InvestorMoneyDocuments, { type MoneyProofSelection } from '../components/InvestorMoneyDocuments';
import InvestorFinanceCar, {
  ActionErrorBox, BankPaymentFields, CarCard, CarPhoto, CashConfirm, CASH_NOTE, Field, Figure, LoadState, PendingSaves, Section,
  bankPaymentReady, emptyBankPayment, type BankPayment, type PendingConfirm,
} from '../components/InvestorFinanceCar';
import {
  basisPointsLabel, carTitle, entryLabel, formatCents, formatDay, investorRequest, malaysiaToday, parsePercentToBasisPoints, parseRinggit,
  useInvestorAction, useInvestorQuery, WITHDRAWAL_LABEL,
  type Bank, type FundableCar, type InvestorProfile, type InvestorSnapshot, type ProfileList, type CarSummary, type Withdrawal, type WithdrawalDestination,
} from '../lib/investorFinance';

type Act = ReturnType<typeof useInvestorAction>;

export default function InvestorFinanceConsole() {
  const user = useStore((s) => s.currentUser);
  if (!user) return null;
  if (user.role === 'admin') return <AdminCarBills actorId={user.id} />;
  return <DirectorConsole key={user.id} actorId={user.id} canWrite={user.role === 'director'} />;
}

// Admin: record bills and attach receipts for one car only. No balances, salaries or bank statements.
function AdminCarBills({ actorId }: { actorId: string }) {
  const [params,setParams] = useSearchParams();
  const carId = params.get('carId') ?? '';
  const valid = /^[A-Za-z0-9_-]{1,100}$/.test(carId);
  const [page,setPage]=useState(0);
  const choices=useInvestorQuery<{cars:CarSummary[];hasMore:boolean}>(valid?null:actorId+':billing:'+page,()=>investorRequest('car_billing_list',{page}));
  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div>
        <h1 className="font-display text-white font-bold text-xl">Investor car bills</h1>
        <p className="text-gray-500 text-sm mt-0.5">Record bills and attach receipts. The Director approves them.</p>
      </div>
      {valid ? <InvestorFinanceCar key={carId} carId={carId} actorId={actorId} mode="admin" onClose={()=>setParams({})} /> : (
        <LoadState loading={choices.loading} error={choices.error} onRetry={()=>void choices.reload()}>
          <div className="space-y-2">{choices.data?.cars.map(car=><button key={car.carId} className="w-full flex items-center gap-3 rounded-xl border border-white/10 p-3 text-left" onClick={()=>setParams({carId:car.carId})}><div className="w-20 shrink-0"><CarPhoto src={car.photo}/></div><div><p className="text-white text-sm">{carTitle(car)}</p><p className="text-gray-500 text-xs">{car.plate}{car.pendingBills?` · ${car.pendingBills} bills waiting`:''}</p></div></button>)}{choices.data&&!choices.data.cars.length&&<p className="py-8 text-gray-500 text-center">No investor cars waiting for bills.</p>}</div>
          <div className="flex gap-3 mt-3">{page>0&&<button className="text-gold-400 text-sm" onClick={()=>setPage(page-1)}>Previous</button>}{choices.data?.hasMore&&<button className="text-gold-400 text-sm" onClick={()=>setPage(page+1)}>More cars</button>}</div>
        </LoadState>
      )}
    </div>
  );
}

function DirectorConsole({ actorId, canWrite }: { actorId: string; canWrite: boolean }) {
  const list = useInvestorQuery<ProfileList>(actorId, () => investorRequest<ProfileList>('list_profiles', {}));
  const [params,setParams]=useSearchParams();
  const requestedCar=params.get('carId');
  const act = useInvestorAction(actorId);
  const [potId, setPotId] = useState<string | null>(null);
  const [view, setView] = useState<'investors' | 'banks' | 'company'>('investors');
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const data = list.data;
  const selected = data?.profiles.find((p) => p.potId === potId) ?? null;
  const banks = data?.banks ?? [];

  const run = async <T,>(slot: string, action: string, body: Record<string, unknown>, label: string) => {
    const result = await act.run<T>(slot, action, body, label);
    if (result) await list.reload();
    return result;
  };
  const retry = async (slot: string) => { if (await act.retry(slot)) await list.reload(); };
  const shared = { act, run, retry, canWrite, banks, setConfirm, errorBox: (slot: string) => <ActionErrorBox error={act.error} slot={slot} onRetry={() => void retry(slot)} onDismiss={act.clearError} /> };

  if(requestedCar&&data?.profiles.some(p=>p.cars.some(c=>c.carId===requestedCar)))return <div className="max-w-3xl mx-auto"><InvestorFinanceCar key={requestedCar} carId={requestedCar} actorId={actorId} mode={canWrite?'director':'viewer'} banks={banks} onClose={()=>setParams({})}/></div>;
  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-white font-bold text-xl">Investor accounts</h1>
          <p className="text-gray-500 text-sm mt-0.5">{canWrite ? 'Record money, cars and profit for each investor.' : 'View only. The Director makes changes.'}</p>
        </div>
        <div className="flex gap-2">
          {canWrite && companyBankPaymentsEnabled && <button type="button" aria-pressed={view==='company'} onClick={() => {setView('company');setPotId(null);}} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${view==='company'?'bg-gold-500/15 text-gold-300 border-gold-500/40':'text-gray-400 border-obsidian-400/60'}`}>Company pot</button>}
          {([['investors', 'Investors', Users], ['banks', 'Bank accounts', Landmark]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => { setView(key); setPotId(null); }} className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 ${view === key ? 'bg-gold-500/15 text-gold-300 border-gold-500/40' : 'text-gray-400 border-obsidian-400/60'}`}><Icon size={12} />{label}</button>
          ))}
        </div>
      </div>

      <PendingSaves pending={act.pending} busy={act.busy} onRetry={(s) => void retry(s)} onDiscard={act.discard} />
      {view==='company' && canWrite && <CompanyPot key={actorId} actorId={actorId} />}

      <LoadState loading={list.loading} error={list.error} onRetry={() => void list.reload()}>
        {data && view === 'banks' && <BankRegister {...shared} />}
        {data && view === 'investors' && !selected && (
          <>
            <div className="bg-gradient-to-br from-obsidian-800/80 to-obsidian-900/60 border border-gold-500/25 rounded-2xl p-5">
              <p className="text-gold-300 text-xs font-semibold uppercase tracking-wider">Company profit</p>
              <p className="text-white font-display font-bold text-3xl mt-1">{formatCents(data.companyProfitCents)}</p>
              <p className="text-gray-600 text-[11px] mt-1">Company share from cars with Director-confirmed profit.</p>
            </div>
            {canWrite && <CreateProfile {...shared} onCreated={(id) => setPotId(id)} />}
            {data.profiles.length === 0 ? <p className="text-gray-500 text-sm text-center py-8">No investor accounts yet.</p> : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.profiles.map((p) => (
                  <button key={p.potId} type="button" onClick={() => setPotId(p.potId)} className="text-left bg-card-gradient border border-obsidian-400/70 rounded-xl p-4 hover:border-gold-500/40 transition-colors space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-white font-semibold text-sm truncate">{p.name}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${p.linkedStaffId ? 'text-emerald-300 border-emerald-500/30' : 'text-gray-500 border-obsidian-400/60'}`}>{p.linkedStaffId ? 'Has login' : 'No login yet'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Figure label="Available" value={formatCents(p.position.availableCents)} />
                      <Figure label="Cars" value={String(p.cars.filter((c) => c.state !== 'settled').length)} />
                      <Figure label="Requests" value={String(p.withdrawals.filter((w) => w.state === 'requested').length)} tone={p.withdrawals.some((w) => w.state === 'requested') ? 'text-amber-300' : 'text-white'} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {data && view === 'investors' && selected && <Account key={selected.potId} profile={selected} actorId={actorId} onBack={() => setPotId(null)} onChanged={() => void list.reload()} {...shared} />}
      </LoadState>
      <CashConfirm confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

type Shared = {
  act: Act; canWrite: boolean; banks: Bank[]; setConfirm: (c: PendingConfirm) => void; errorBox: (slot: string) => JSX.Element; retry: (slot: string) => Promise<void>;
  run: <T>(slot: string, action: string, body: Record<string, unknown>, label: string) => Promise<T | null>;
};

function CreateProfile({ act, run, errorBox, onCreated }: Shared & { onCreated: (potId: string) => void }) {
  const [name, setName] = useState('');
  const ok = name.trim().length >= 2;
  return (
    <form className="bg-card-gradient border border-obsidian-400/70 rounded-xl p-4 flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault(); if (!ok) return;
      const r = await run<{ profileId: string; potId: string }>('create_profile', 'create_profile', { name: name.trim() }, `New investor · ${name.trim()}`);
      if (r) { setName(''); onCreated(r.potId); }
    }}>
      <div className="flex-1 min-w-[200px]"><Field label="New investor's full name"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
      <button type="submit" disabled={!ok || act.busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-40"><Plus size={13} />{act.busy === 'create_profile' ? 'Creating…' : 'Create account'}</button>
      <div className="w-full">{errorBox('create_profile')}</div>
    </form>
  );
}

function BankRegister({ act, run, canWrite, banks, errorBox }: Shared) {
  const [name, setName] = useState('');
  const [openingDate, setOpeningDate] = useState(malaysiaToday());
  const [opening, setOpening] = useState('');
  const openingCents = opening.trim() === '0' ? 0 : parseRinggit(opening);
  const ok = name.trim().length >= 2 && openingCents !== null && /^\d{4}-\d{2}-\d{2}$/.test(openingDate) && openingDate <= malaysiaToday();
  return (
    <div className="space-y-3">
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl divide-y divide-obsidian-400/40">
        {banks.length === 0 ? <p className="text-gray-500 text-sm p-4">No company bank accounts registered yet.</p> : banks.map((b) => (
          <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div><p className="text-white text-sm font-medium">{b.name}</p><p className="text-gray-500 text-[11px]">Opening balance as at {formatDay(b.openingDate)}</p></div>
            <p className="text-white text-sm font-semibold">{formatCents(b.openingCents)}</p>
          </div>
        ))}
      </div>
      <p className="text-gray-600 text-[11px]">Enter the real bank balance on the start date. This is not a new deposit. Differences from older records stay for later review; statement matching is still pending.</p>
      {canWrite && (
        <form className="bg-card-gradient border border-obsidian-400/70 rounded-xl p-4 space-y-2" onSubmit={async (e) => {
          e.preventDefault(); if (!ok || openingCents === null) return;
          if (await run('save_bank', 'save_bank', { name: name.trim(), openingDate, openingCents }, `Bank account · ${name.trim()}`)) { setName(''); setOpening(''); }
        }}>
          <p className="text-gray-300 text-xs font-semibold uppercase tracking-wider">Add a bank account</p>
          <div className="grid sm:grid-cols-3 gap-2">
            <Field label="Account name" hint="e.g. Maybank current ••1234"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Opening balance date"><input type="date" max={malaysiaToday()} className="input w-full px-3 py-2 rounded-lg text-sm" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} /></Field>
            <Field label="Opening balance (RM)" hint="From the bank statement on that date"><input inputMode="decimal" className="input w-full px-3 py-2 rounded-lg text-sm" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" /></Field>
          </div>
          <button type="submit" disabled={!ok || act.busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40">{act.busy === 'save_bank' ? 'Saving…' : 'Save bank account'}</button>
          {errorBox('save_bank')}
        </form>
      )}
    </div>
  );
}

function Account({ profile, actorId, onBack, onChanged, ...shared }: Shared & { profile: InvestorProfile; actorId: string; onBack: () => void; onChanged: () => void }) {
  const { canWrite, banks } = shared;
  const snap = useInvestorQuery<InvestorSnapshot>(`${actorId}:${profile.potId}`, () => investorRequest<InvestorSnapshot>('snapshot', { potId: profile.potId }));
  const [openCar, setOpenCar] = useState<string | null>(null);
  const pos = profile.position;
  const refresh = () => { onChanged(); void snap.reload(); };
  const run = async <T,>(slot: string, action: string, body: Record<string, unknown>, label: string) => { const r = await shared.run<T>(slot, action, body, label); if (r) void snap.reload(); return r; };
  const s = { ...shared, run };

  if (openCar) return (
    <div className="max-w-2xl mx-auto">
      <InvestorFinanceCar key={openCar} carId={openCar} actorId={actorId} mode={canWrite ? 'director' : 'viewer'} banks={banks} onChanged={refresh} onClose={() => setOpenCar(null)} />
    </div>
  );

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-gray-400 text-xs flex items-center gap-1"><ChevronLeft size={14} /> All investors</button>
      <div className="bg-gradient-to-br from-obsidian-800/80 to-obsidian-900/60 border border-gold-500/25 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-white font-display font-bold text-xl">{profile.name}</p>
            <p className="text-gray-500 text-xs">{profile.linkedStaffId ? 'Investor can sign in' : 'No login yet'}</p>
          </div>
          {canWrite && !profile.linkedStaffId && <Invite potId={profile.potId} {...s} />}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Figure label="Available" value={formatCents(pos.availableCents)} tone="text-gold-300" />
          <Figure label="Cash held" value={formatCents(pos.cashCents)} />
          <Figure label="Reserved" value={formatCents(pos.reservedCents)} note="Withdrawals, purchases, bills, unconfirmed profit" />
          <Figure label="In cars" value={formatCents(pos.investedCents)} />
        </div>
      </div>

      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl overflow-hidden">
        {canWrite && (
          <Section title="Record capital received">
            <CapitalReceived potId={profile.potId} name={profile.name} {...s} />
          </Section>
        )}
        {canWrite && (
          <Section title="Allocate a car">
            <AllocateCar potId={profile.potId} availableCents={pos.availableCents} name={profile.name} {...s} />
          </Section>
        )}
        <Section title="Withdrawals" hint={`${profile.withdrawals.filter((w) => w.state === 'requested' || w.state === 'approved').length} open`} defaultOpen={profile.withdrawals.some((w) => w.state === 'requested')}>
          {profile.withdrawals.length === 0 ? <p className="text-gray-500 text-xs">No withdrawals.</p> : profile.withdrawals.map((w) => <WithdrawalRow key={w.id} w={w} destination={snap.data?.withdrawalDestinations?.find(d=>d.withdrawalId===w.id)} potId={profile.potId} name={profile.name} {...s} />)}
        </Section>
        <Section title="Money history" hint={snap.data ? `${snap.data.entries.length}` : undefined}>
          <LoadState loading={snap.loading} error={snap.error} onRetry={() => void snap.reload()}>
            {snap.data && (snap.data.entries.length === 0 ? <p className="text-gray-500 text-xs">No money recorded yet.</p> : snap.data.entries.map((e) => (
              <div key={e.id} className="flex justify-between gap-3 text-xs">
                <span className="text-gray-300">{entryLabel(e.kind)} <span className="text-gray-600">· {formatDay(e.paidOn ?? e.recordedAt)}</span></span>
                <span className={`font-medium shrink-0 ${e.amountCents >= 0 ? 'text-emerald-400' : 'text-gray-300'}`}>{e.amountCents >= 0 ? '+' : ''}{formatCents(e.amountCents)}</span>
              </div>
            )))}
          </LoadState>
        </Section>
      </div>

      <div>
        <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-2">Cars ({profile.cars.length})</p>
        {profile.cars.length === 0 ? <p className="text-gray-500 text-sm">No cars allocated yet.</p> : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{profile.cars.map((c) => <CarCard key={c.carId} car={c} onOpen={() => setOpenCar(c.carId)} />)}</div>
        )}
      </div>
    </div>
  );
}

function Invite({ potId, act, run, errorBox }: Shared & { potId: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const slot = `invite:${potId}`;
  if (link) return (
    <div className="w-full sm:w-auto bg-obsidian-800/70 border border-gold-500/25 rounded-lg p-3 space-y-1.5">
      <p className="text-gray-300 text-[11px]">One-time sign-up link. Send it privately to the investor only.</p>
      <div className="flex gap-2">
        <input readOnly data-no-capitalize value={link} className="input flex-1 px-2 py-1.5 rounded text-[11px]" onFocus={(e) => e.target.select()} />
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }} className="btn-ghost text-[11px] px-2.5 rounded flex items-center gap-1"><Copy size={11} />{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
  return (
    <div className="space-y-1">
      <button type="button" disabled={act.busy !== null} onClick={async () => { const r = await run<{ link: string }>(slot, 'invite_investor', { potId }, 'Investor invite link'); if (r?.link) setLink(r.link); }}
        className="btn-ghost text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-40"><Link2 size={12} />{act.busy === slot ? 'Creating…' : 'Create sign-up link'}</button>
      {errorBox(slot)}
    </div>
  );
}

function CapitalReceived({ potId, name, act, run, banks, setConfirm, errorBox }: Shared & { potId: string; name: string }) {
  const [amount, setAmount] = useState('');
  const [pay, setPay] = useState<BankPayment>(emptyBankPayment);
  const cents = parseRinggit(amount), ok = !!cents && bankPaymentReady(pay), slot = `capital:${potId}`;
  return (
    <form className="space-y-2" onSubmit={(e) => {
      e.preventDefault(); if (!ok || !cents) return;
      setConfirm({ title: 'Record capital received?', label: 'Record capital', message: `Record ${formatCents(cents)} received from ${name} on ${formatDay(pay.paidOn)}. ${CASH_NOTE}`,
        go: async () => { if (await run(slot, 'capital_received', { potId, amountCents: cents, ...pay, bankReference: pay.bankReference.trim() }, `Capital ${formatCents(cents)} · ${name}`)) { setAmount(''); setPay(emptyBankPayment()); } } });
    }}>
      <Field label="Amount received (RM)" hint="Only the amount that actually arrived in the company bank account"><input inputMode="decimal" className="input w-full px-3 py-2 rounded-lg text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
      <BankPaymentFields banks={banks} value={pay} onChange={setPay} dateLabel="Date received" />
      <button type="submit" disabled={!ok || act.busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40">{act.busy === slot ? 'Saving…' : 'Record capital'}</button>
      {errorBox(slot)}
    </form>
  );
}

function AllocateCar({ potId, availableCents, name, act, run, setConfirm, errorBox }: Shared & { potId: string; availableCents: number; name: string }) {
  const cars = useInvestorQuery<{ cars: FundableCar[] }>(`fundable:${potId}`, () => investorRequest<{ cars: FundableCar[] }>('fundable_cars', { page: 0 }));
  const [chosen, setChosen] = useState<FundableCar | null>(null);
  const [share, setShare] = useState('40');
  const bp = parsePercentToBasisPoints(share);
  if (chosen) {
    const purchaseCents = Math.round(chosen.purchase_price * 100), slot = `fund:${chosen.id}`;
    const short = purchaseCents > availableCents;
    return (
      <div className="space-y-3">
        <div className="flex gap-3 items-center">
          <CarPhoto src={chosen.photo} className="w-24 h-16 rounded-lg" />
          <div><p className="text-white text-sm font-semibold">{carTitle(chosen)}</p><p className="text-gray-500 text-xs">{chosen.car_plate ?? ''}</p></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Figure label="Purchase price" value={formatCents(purchaseCents)} note="From the car record" />
          <Field label="Investor profit share (%)"><input inputMode="decimal" className="input w-full px-3 py-2 rounded-lg text-sm" value={share} onChange={(e) => setShare(e.target.value)} /></Field>
        </div>
        {short && <p className="text-red-400 text-[11px]">{name} has only {formatCents(availableCents)} available.</p>}
        <div className="flex gap-2">
          <button type="button" disabled={bp === null || short || act.busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40"
            onClick={() => bp !== null && setConfirm({ title: 'Allocate this car?', label: 'Allocate car',
              message: `${carTitle(chosen)} will be funded from ${name}'s account. ${formatCents(purchaseCents)} is reserved until the purchase payment is recorded. Investor share of profit: ${basisPointsLabel(bp)}.`,
              go: async () => { if (await run(slot, 'fund_car', { carId: chosen.id, potId, purchaseCents, investorBasisPoints: bp }, `Allocate ${carTitle(chosen)} · ${name}`)) { setChosen(null); void cars.reload(); } } })}>
            {act.busy === slot ? 'Saving…' : 'Allocate car'}
          </button>
          <button type="button" onClick={() => setChosen(null)} className="text-xs px-3 py-2 rounded-lg text-gray-400 border border-obsidian-400/60">Choose another</button>
        </div>
        {errorBox(slot)}
      </div>
    );
  }
  return (
    <LoadState loading={cars.loading} error={cars.error} onRetry={() => void cars.reload()}>
      {cars.data && (cars.data.cars.length === 0 ? <p className="text-gray-500 text-xs">No cars are available to fund right now.</p> : (
        <div className="grid sm:grid-cols-2 gap-2">
          {cars.data.cars.map((c) => (
            <button key={c.id} type="button" onClick={() => setChosen(c)} className="flex gap-3 items-center text-left rounded-lg border border-obsidian-400/50 p-2 hover:border-gold-500/40">
              <CarPhoto src={c.photo} className="w-20 h-14 rounded-md shrink-0" />
              <div className="min-w-0"><p className="text-white text-sm font-medium truncate">{carTitle(c)}</p><p className="text-gray-500 text-[11px]">{c.car_plate ?? ''} · {formatCents(Math.round(c.purchase_price * 100))}</p></div>
            </button>
          ))}
        </div>
      ))}
    </LoadState>
  );
}

function WithdrawalRow({ w, destination, potId, name, act, run, canWrite, banks, setConfirm, errorBox }: Shared & { w: Withdrawal; destination?:WithdrawalDestination; potId: string; name: string }) {
  const [panel, setPanel] = useState<null | 'reject' | 'cancel' | 'paid' | 'destination'>(null);
  const [note, setNote] = useState('');
  const [destBank,setDestBank]=useState(''),[destHolder,setDestHolder]=useState(''),[destAccount,setDestAccount]=useState(''),[destConfirmed,setDestConfirmed]=useState(false);
  const destinationReady=destBank.trim().length>=2&&destHolder.trim().length>=2&&/^[0-9]{6,20}$/.test(destAccount.replace(/[ -]/g,''))&&destConfirmed;
  const [pay, setPay] = useState<BankPayment>(emptyBankPayment);
  const [proof, setProof] = useState<MoneyProofSelection>({});
  const slot = (kind: string) => `${kind}:${potId}:${w.id}`;
  const label = `${formatCents(w.amountCents)} · ${name}`;
  const noteForm = (kind: 'reject' | 'cancel') => (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault(); if (note.trim().length < 3) return;
      if (await run(slot(kind), `${kind}_withdrawal`, { potId, withdrawalId: w.id, note: note.trim() }, `${kind === 'reject' ? 'Reject' : 'Cancel'} withdrawal ${label}`)) { setPanel(null); setNote(''); }
    }}>
      <div className="flex-1 min-w-[180px]"><Field label="Reason (the investor can see this)"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
      <button type="submit" disabled={note.trim().length < 3 || act.busy !== null} className="text-xs px-4 py-2 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 disabled:opacity-40">{kind === 'reject' ? 'Reject request' : 'Cancel withdrawal'}</button>
    </form>
  );
  return (
    <div className="rounded-lg border border-obsidian-400/50 p-3 space-y-2">
      <div className="flex justify-between gap-3">
        <div><p className="text-white text-sm font-medium">{formatCents(w.amountCents)}</p><p className="text-gray-500 text-[11px]">{WITHDRAWAL_LABEL[w.state]} · requested {formatDay(w.requestedAt)}</p>{w.note && <p className="text-gray-500 text-[11px]">{w.note}</p>}</div>
        {canWrite && (
          <div className="flex flex-wrap gap-2 justify-end">
            {w.state === 'requested' && <button type="button" disabled={act.busy !== null} onClick={() => setPanel(panel==='destination'?null:'destination')} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 disabled:opacity-40">{act.busy === slot('approve') ? 'Approving…' : 'Approve'}</button>}
            {w.state === 'requested' && <button type="button" onClick={() => setPanel(panel === 'reject' ? null : 'reject')} className="text-xs px-3 py-1.5 rounded-lg text-gray-400 border border-obsidian-400/60">Reject</button>}
            {w.state === 'approved' && !!destination && <button type="button" onClick={() => setPanel(panel === 'paid' ? null : 'paid')} className="text-xs px-3 py-1.5 rounded-lg bg-gold-500/15 text-gold-300 border border-gold-500/30">Record payment</button>}
            {w.state === 'approved' && <button type="button" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')} className="text-xs px-3 py-1.5 rounded-lg text-gray-400 border border-obsidian-400/60">Cancel</button>}
          </div>
        )}
      </div>
      {destination&&<p className="text-xs text-gray-300">Pay to {destination.accountHolder} · {destination.bankName} · account ending {destination.accountNumber.slice(-4)}<span className="block text-gray-500">Confirmed by {destination.confirmedBy} · {formatDay(destination.confirmedAt)}</span></p>}
      {canWrite&&w.state==='approved'&&!destination&&<button type="button" className="text-xs text-gold-300" onClick={()=>setPanel('destination')}>Confirm payout account</button>}
      {panel==='destination'&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();if(!destinationReady)return;const setup=w.state==='requested'?'approve_withdrawal':'confirm_withdrawal_destination';const fields={potId,withdrawalId:w.id,destinationBank:destBank,destinationHolder:destHolder,destinationAccount:destAccount,destinationConfirmed:true};setConfirm({title:'Confirm withdrawal account?',label:w.state==='requested'?'Approve withdrawal':'Confirm account',message:`Pay ${formatCents(w.amountCents)} to ${destHolder} at ${destBank}, account ending ${destAccount.replace(/[ -]/g,'').slice(-4)}. This account is saved with this withdrawal.`,go:async()=>{if(await run(slot('approve'),setup,fields,'Confirm payout account'))setPanel(null);}});}}><Field label="Recipient bank"><input className="input w-full px-3 py-2 rounded-lg text-sm" value={destBank} maxLength={80} onChange={e=>setDestBank(e.target.value)}/></Field><Field label="Account holder"><input className="input w-full px-3 py-2 rounded-lg text-sm" value={destHolder} maxLength={150} onChange={e=>setDestHolder(e.target.value)}/></Field><Field label="Recipient account number"><input className="input w-full px-3 py-2 rounded-lg text-sm" inputMode="numeric" value={destAccount} maxLength={40} onChange={e=>setDestAccount(e.target.value)}/></Field><label className="text-xs text-gray-300 flex gap-2"><input type="checkbox" checked={destConfirmed} onChange={e=>setDestConfirmed(e.target.checked)}/>I checked this account with the investor.</label><button type="submit" className="btn-gold text-xs px-4 py-2 rounded-lg" disabled={!destinationReady||act.busy!==null}>Review payout account</button></form>}
      {panel === 'reject' && noteForm('reject')}
      {panel === 'cancel' && noteForm('cancel')}
      {panel === 'paid' && (
        <form className="space-y-2" onSubmit={(e) => {
          e.preventDefault(); if (!bankPaymentReady(pay) || !proof.receiptDocumentId || !destination) return;
          setConfirm({ title: 'Record withdrawal paid?', label: 'Record payment', message: `Record that ${formatCents(w.amountCents)} was paid to ${name} on ${formatDay(pay.paidOn)}. ${CASH_NOTE}`,
            go: async () => { if (await run(slot('paid'), 'withdrawal_paid', { potId, withdrawalId: w.id, destinationId:destination?.destinationId, ...pay, receiptDocumentId: proof.receiptDocumentId, bankReference: pay.bankReference.trim() }, `Withdrawal paid ${label}`)) setPanel(null); } });
        }}>
          <BankPaymentFields banks={banks} value={pay} onChange={setPay} />
          <InvestorMoneyDocuments source={{ target: 'withdrawal', withdrawalId: w.id }} amountCents={w.amountCents} editable onChoose={setProof} />
          <button type="submit" disabled={!destination || !bankPaymentReady(pay) || !proof.receiptDocumentId || act.busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40">Record withdrawal paid</button>
        </form>
      )}
      {errorBox(slot('approve'))}{errorBox(slot('reject'))}{errorBox(slot('cancel'))}{errorBox(slot('paid'))}
      {w.state === 'paid' && <InvestorMoneyDocuments source={{ target: 'withdrawal', withdrawalId: w.id }} amountCents={w.amountCents} />}
    </div>
  );
}
