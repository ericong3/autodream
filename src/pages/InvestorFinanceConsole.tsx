import { useState } from 'react';
import CompanyPot from '../components/CompanyPot';
import { companyBankPaymentsEnabled } from '../lib/companyBankPayments';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Link2, Copy, Users, ChevronLeft, Eye } from 'lucide-react';
import { useStore } from '../store';
import InvestorMoneyDocuments, { type MoneyProofSelection } from '../components/InvestorMoneyDocuments';
import InvestorFinanceCar, {
  ActionErrorBox, BankPaymentFields, CarCard, CarPhoto, CashConfirm, CASH_NOTE, Field, Figure, LoadState, PendingSaves, Section,
  bankPaymentReady, emptyBankPayment, type BankPayment, type PendingConfirm,
} from '../components/InvestorFinanceCar';
import {
  basisPointsLabel, carTitle, entryLabel, formatCents, formatDay, investorRequest, parsePercentToBasisPoints, parseRinggit,
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
  const [view, setView] = useState<'investors' | 'company'>('investors');
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
          <button type="button" aria-pressed={view === 'investors'} onClick={() => { setView('investors'); setPotId(null); }} className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 ${view === 'investors' ? 'bg-gold-500/15 text-gold-300 border-gold-500/40' : 'text-gray-400 border-obsidian-400/60'}`}><Users size={12} />Investors</button>
        </div>
      </div>

      <PendingSaves pending={act.pending.filter(p => p.slot !== 'save_bank')} busy={act.busy} onRetry={(s) => void retry(s)} onDiscard={act.discard} />
      {view==='company' && canWrite && <CompanyPot key={actorId} actorId={actorId} />}

      <LoadState loading={list.loading} error={list.error} onRetry={() => void list.reload()}>
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
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && <Link to={`/investor-preview/${profile.potId}`} className="btn-ghost text-xs px-3 py-2 rounded-lg flex items-center gap-1.5"><Eye size={13} /> Preview as investor</Link>}
            {canWrite && !profile.linkedStaffId && <Invite potId={profile.potId} {...s} />}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Figure label="Available" value={formatCents(pos.availableCents)} tone="text-gold-300" />
          <Figure label="Cash held" value={formatCents(pos.cashCents)} />
          <Figure label="Reserved" value={formatCents(pos.reservedCents)} note="Withdrawals, purchases, bills, unconfirmed profit" />
          <Figure label="In cars" value={formatCents(pos.investedCents)} />
          {(pos.advanceWaitingCents ?? 0) > 0 && <Figure label="Waiting for capital" value={formatCents(pos.advanceWaitingCents)} tone="text-red-400" note="Fronted by the company. Locked or received capital fills this first. No withdrawals until it is zero." />}
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
        {canWrite && (
          <Section title={`Company cars bought with ${profile.name}'s money`}>
            <InvestorDeals potId={profile.potId} name={profile.name} {...s} />
          </Section>
        )}
        {canWrite && (
          <Section title="Move a company stock car">
            <MoveCompanyCar potId={profile.potId} availableCents={pos.availableCents} name={profile.name} {...s} />
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

type DealCar = { id: string; make: string; model: string; year: number | null; plate: string | null; photo: string | null; status: string | null; sold: boolean; profitCents: number; dealPotId: string | null };
type Deal = { carId: string; make: string; model: string; year: number | null; plate: string | null; photo: string | null; status: string | null; sold: boolean; profitCents: number; investorBasisPoints: number; note: string; state: 'draft' | 'confirmed'; estimatedShareCents: number | null; shareCents: number | null; confirmNote: string | null; confirmedAt: string | null };
function InvestorDeals({ potId, name, act, run, setConfirm, errorBox }: Shared & { potId: string; name: string }) {
  const deals = useInvestorQuery<{ deals: Deal[] }>(`deals:${potId}`, () => investorRequest<{ deals: Deal[] }>('deals_list', { potId }));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DealCar[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [editing, setEditing] = useState<{ carId: string; title: string; share: string; note: string } | null>(null);
  const [confirming, setConfirming] = useState<{ deal: Deal; amount: string; note: string } | null>(null);
  const search = async () => {
    setSearching(true); setSearchError('');
    try { setResults((await investorRequest<{ cars: DealCar[] }>('deal_search', { potId, query: query.trim() })).cars); }
    catch (e) { setSearchError(e instanceof Error ? e.message : 'Could not search.'); }
    finally { setSearching(false); }
  };
  const done = () => { setEditing(null); setConfirming(null); setResults(null); setQuery(''); void deals.reload(); };
  if (editing) {
    const bp = parsePercentToBasisPoints(editing.share), slot = `deal:${editing.carId}`;
    return (
      <div className="space-y-3">
        <p className="text-white text-sm font-semibold">{editing.title}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={`${name}'s profit share (%)`}><input inputMode="decimal" className="input w-full px-3 py-2 rounded-lg text-sm" value={editing.share} onChange={(e) => setEditing({ ...editing, share: e.target.value })} /></Field>
          <Field label="Note (optional)"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={500} value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} placeholder={`e.g. Bought with ${name}'s money`} /></Field>
        </div>
        <p className="text-gray-500 text-[11px]">Saved as a draft. You can change or remove it any time until you confirm the final share. Nothing moves in {name}'s account until then.</p>
        <div className="flex gap-2">
          <button type="button" disabled={bp === null || act.busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40"
            onClick={async () => { if (bp !== null && await run(slot, 'save_deal', { potId, carId: editing.carId, investorBasisPoints: bp, note: editing.note.trim() }, `Deal draft · ${editing.title}`)) done(); }}>{act.busy === slot ? 'Saving…' : 'Save draft'}</button>
          <button type="button" onClick={() => setEditing(null)} className="text-xs px-3 py-2 rounded-lg text-gray-400 border border-obsidian-400/60">Cancel</button>
        </div>
        {errorBox(slot)}
      </div>
    );
  }
  if (confirming) {
    const d = confirming.deal, cents = parseRinggit(confirming.amount), slot = `deal-confirm:${d.carId}`;
    const ok = cents !== null && confirming.note.trim().length >= 3 && cents <= Math.max(0, d.profitCents) && act.busy === null;
    return (
      <div className="space-y-3">
        <p className="text-white text-sm font-semibold">Confirm {name}'s share · {carTitle(d)}</p>
        <div className="grid grid-cols-3 gap-3">
          <Figure label="Car profit (from the accounts)" value={formatCents(d.profitCents)} />
          <Figure label="Share" value={basisPointsLabel(d.investorBasisPoints)} />
          <Figure label="Calculated" value={formatCents(d.estimatedShareCents ?? 0)} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={`Final amount for ${name} (RM)`} hint="You can adjust it, up to the car profit"><input inputMode="decimal" className="input w-full px-3 py-2 rounded-lg text-sm" value={confirming.amount} onChange={(e) => setConfirming({ ...confirming, amount: e.target.value })} /></Field>
          <Field label="Note"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={500} value={confirming.note} onChange={(e) => setConfirming({ ...confirming, note: e.target.value })} placeholder="e.g. All costs checked" /></Field>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={!ok} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40"
            onClick={() => cents !== null && setConfirm({ title: `Confirm ${name}'s share?`, label: 'Confirm share',
              message: `${formatCents(cents)} from ${carTitle(d)} goes into ${name}'s account as profit. No bank money moves. Once confirmed it cannot be changed.`,
              go: async () => { if (await run(slot, 'confirm_deal', { potId, carId: d.carId, shareCents: cents, note: confirming.note.trim() }, `Confirm share · ${carTitle(d)}`)) done(); } })}>{act.busy === slot ? 'Saving…' : 'Confirm share'}</button>
          <button type="button" onClick={() => setConfirming(null)} className="text-xs px-3 py-2 rounded-lg text-gray-400 border border-obsidian-400/60">Cancel</button>
        </div>
        {errorBox(slot)}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-gray-500 text-[11px]">Mark company cars that were bought with {name}'s money. Keep the share as a draft while the profit is not final, then confirm it.</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (query.trim().length >= 2) void search(); }}>
        <input className="input flex-1 px-3 py-2 rounded-lg text-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search plate or model, e.g. VLM6465" />
        <button type="submit" disabled={query.trim().length < 2 || searching} className="btn-ghost text-xs px-3 py-2 rounded-lg disabled:opacity-40">{searching ? 'Searching…' : 'Search'}</button>
      </form>
      {searchError && <p className="text-red-400 text-xs">{searchError}</p>}
      {results && (results.length === 0 ? <p className="text-gray-500 text-xs">No matching company cars.</p> : (
        <div className="grid sm:grid-cols-2 gap-2">
          {results.map((c) => (
            <button key={c.id} type="button" disabled={!!c.dealPotId} onClick={() => setEditing({ carId: c.id, title: carTitle(c), share: '40', note: '' })} className="flex gap-3 items-center text-left rounded-lg border border-obsidian-400/50 p-2 hover:border-gold-500/40 disabled:opacity-60">
              <CarPhoto src={c.photo} className="w-20 h-14 rounded-md shrink-0" />
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">{carTitle(c)}</p>
                <p className="text-gray-500 text-[11px]">{c.plate ?? ''} · {c.sold ? `Sold · profit ${formatCents(c.profitCents)}` : 'Not sold yet'}</p>
                {c.dealPotId && <p className="text-amber-300 text-[10px]">Already marked{c.dealPotId === potId ? '' : ' for another investor'}</p>}
              </div>
            </button>
          ))}
        </div>
      ))}
      <LoadState loading={deals.loading} error={deals.error} onRetry={() => void deals.reload()}>
        {deals.data && deals.data.deals.length > 0 && (
          <div className="space-y-2">
            {deals.data.deals.map((d) => (
              <div key={d.carId} className="rounded-lg border border-obsidian-400/50 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{carTitle(d)} <span className="text-gray-500 text-[11px]">{d.plate ?? ''}</span></p>
                    <p className="text-gray-500 text-[11px]">{d.sold ? `Sold · profit so far ${formatCents(d.profitCents)}` : 'Not sold yet'} · {basisPointsLabel(d.investorBasisPoints)} share{d.note ? ` · ${d.note}` : ''}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${d.state === 'confirmed' ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300'}`}>{d.state === 'confirmed' ? 'Confirmed' : 'Draft'}</span>
                </div>
                {d.state === 'confirmed'
                  ? <p className="text-emerald-300 text-xs">{formatCents(d.shareCents ?? 0)} credited to {name}{d.confirmNote ? ` · ${d.confirmNote}` : ''}</p>
                  : <>
                    {d.sold && d.estimatedShareCents !== null && <p className="text-gray-300 text-xs">Estimated share now: <span className="text-gold-300 font-semibold">{formatCents(d.estimatedShareCents)}</span></p>}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setEditing({ carId: d.carId, title: carTitle(d), share: String(d.investorBasisPoints / 100), note: d.note })} className="btn-ghost text-xs px-3 py-1.5 rounded-lg">Change</button>
                      <button type="button" disabled={act.busy !== null} onClick={() => setConfirm({ title: 'Remove this draft?', label: 'Remove', message: `${carTitle(d)} will no longer be marked as bought with ${name}'s money.`, go: async () => { if (await run(`deal-remove:${d.carId}`, 'remove_deal', { potId, carId: d.carId }, `Remove deal · ${carTitle(d)}`)) done(); } })} className="text-xs px-3 py-1.5 rounded-lg text-gray-400 border border-obsidian-400/60">Remove</button>
                      {d.sold && <button type="button" onClick={() => setConfirming({ deal: d, amount: ((d.estimatedShareCents ?? 0) / 100).toFixed(2), note: '' })} className="btn-gold text-xs px-3 py-1.5 rounded-lg">Confirm final share</button>}
                    </div>
                    {errorBox(`deal-remove:${d.carId}`)}
                  </>}
              </div>
            ))}
          </div>
        )}
      </LoadState>
    </div>
  );
}

type MovableCar = { id: string; make: string; model: string; year: number | null; car_plate: string | null; photo: string | null; purchaseCents: number; stockCents: number; blocker: string | null };
const MOVE_BLOCKER: Record<string, string> = {
  COMPANY_BILLS_UNPAID: 'Has unpaid company bills. Pay them, or mark them paid before the bank start date, first.',
  REPAIR_IN_PROGRESS: 'Has an open repair. Finish or cancel it first.',
};
function MoveCompanyCar({ potId, availableCents, name, act, run, setConfirm, errorBox }: Shared & { potId: string; availableCents: number; name: string }) {
  const cars = useInvestorQuery<{ cars: MovableCar[] }>(`movable:${potId}`, () => investorRequest<{ cars: MovableCar[] }>('transferable_cars', { potId }));
  const [chosen, setChosen] = useState<MovableCar | null>(null);
  const [share, setShare] = useState('40');
  const [reason, setReason] = useState('');
  const [advanceReason, setAdvanceReason] = useState('');
  const bp = parsePercentToBasisPoints(share);
  if (chosen) {
    const slot = `move:${chosen.id}`, carried = chosen.stockCents - chosen.purchaseCents, short = chosen.stockCents > availableCents;
    const ok = bp !== null && reason.trim().length >= 3 && (!short || advanceReason.trim().length >= 3) && act.busy === null;
    return (
      <div className="space-y-3">
        <div className="flex gap-3 items-center">
          <CarPhoto src={chosen.photo} className="w-24 h-16 rounded-lg" />
          <div><p className="text-white text-sm font-semibold">{carTitle(chosen)}</p><p className="text-gray-500 text-xs">{chosen.car_plate ?? ''}</p></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Figure label="Purchase price" value={formatCents(chosen.purchaseCents)} />
          <Figure label="Costs already on car" value={formatCents(carried)} note="Repairs and misc costs" />
          <Figure label={`Charged to ${name}`} value={formatCents(chosen.stockCents)} tone="text-gold-300" />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Investor profit share (%)"><input inputMode="decimal" className="input w-full px-3 py-2 rounded-lg text-sm" value={share} onChange={(e) => setShare(e.target.value)} /></Field>
          <Field label="Why this car moves"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`e.g. Bought with ${name}'s money`} /></Field>
        </div>
        {short && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 space-y-2">
            <p className="text-amber-200 text-[11px]">{name} has only {formatCents(availableCents)} available. The company fronts {formatCents(chosen.stockCents - availableCents)} until {name}'s capital is locked or received. No withdrawals until then.</p>
            <Field label="Reason for fronting the money"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={500} value={advanceReason} onChange={(e) => setAdvanceReason(e.target.value)} placeholder="e.g. Capital coming from 2TN payouts" /></Field>
          </div>
        )}
        <p className="text-gray-500 text-[11px]">No bank money moves. The car leaves company stock with its purchase and costs, and later bills on it come from {name}'s account.</p>
        <div className="flex gap-2">
          <button type="button" disabled={!ok} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40"
            onClick={() => bp !== null && setConfirm({ title: `Move this car to ${name}?`, label: 'Move car',
              message: `${carTitle(chosen)} moves from company stock to ${name} for ${formatCents(chosen.stockCents)} (purchase ${formatCents(chosen.purchaseCents)} + costs ${formatCents(carried)}). Investor share of profit: ${basisPointsLabel(bp)}.${short ? ` The company fronts ${formatCents(chosen.stockCents - availableCents)}.` : ''} This cannot be undone.`,
              go: async () => { if (await run(slot, 'transfer_car', { carId: chosen.id, potId, investorBasisPoints: bp, reason: reason.trim(), ...(short ? { advanceReason: advanceReason.trim() } : {}) }, `Move ${carTitle(chosen)} · ${name}`)) { setChosen(null); setReason(''); setAdvanceReason(''); void cars.reload(); } } })}>
            {act.busy === slot ? 'Saving…' : 'Move car'}
          </button>
          <button type="button" onClick={() => setChosen(null)} className="text-xs px-3 py-2 rounded-lg text-gray-400 border border-obsidian-400/60">Choose another</button>
        </div>
        {errorBox(slot)}
      </div>
    );
  }
  return (
    <LoadState loading={cars.loading} error={cars.error} onRetry={() => void cars.reload()}>
      {cars.data && (cars.data.cars.length === 0 ? <p className="text-gray-500 text-xs">No company stock cars can be moved right now.</p> : (
        <div className="grid sm:grid-cols-2 gap-2">
          {cars.data.cars.map((c) => (
            <button key={c.id} type="button" disabled={!!c.blocker} onClick={() => setChosen(c)} className="flex gap-3 items-center text-left rounded-lg border border-obsidian-400/50 p-2 hover:border-gold-500/40 disabled:opacity-60 disabled:hover:border-obsidian-400/50">
              <CarPhoto src={c.photo} className="w-20 h-14 rounded-md shrink-0" />
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">{carTitle(c)}</p>
                <p className="text-gray-500 text-[11px]">{c.car_plate ?? ''} · {formatCents(c.stockCents)}</p>
                {c.blocker && <p className="text-amber-300 text-[10px] mt-0.5">{MOVE_BLOCKER[c.blocker] ?? c.blocker}</p>}
              </div>
            </button>
          ))}
        </div>
      ))}
    </LoadState>
  );
}

function AllocateCar({ potId, availableCents, name, act, run, setConfirm, errorBox }: Shared & { potId: string; availableCents: number; name: string }) {
  const cars = useInvestorQuery<{ cars: FundableCar[] }>(`fundable:${potId}`, () => investorRequest<{ cars: FundableCar[] }>('fundable_cars', { page: 0 }));
  const [chosen, setChosen] = useState<FundableCar | null>(null);
  const [share, setShare] = useState('40');
  const [advanceReason, setAdvanceReason] = useState('');
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
        {short && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 space-y-2">
            <p className="text-amber-200 text-[11px]">{name} has only {formatCents(availableCents)} available. You can still allocate: the company fronts {formatCents(purchaseCents - availableCents)} until {name}'s capital is locked or received. No withdrawals are allowed until then.</p>
            <Field label="Reason for fronting the money"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={500} value={advanceReason} onChange={(e) => setAdvanceReason(e.target.value)} placeholder="e.g. Capital coming from 2TN payouts" /></Field>
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" disabled={bp === null || (short && advanceReason.trim().length < 3) || act.busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40"
            onClick={() => bp !== null && setConfirm({ title: short ? 'Allocate before the money is in?' : 'Allocate this car?', label: 'Allocate car',
              message: `${carTitle(chosen)} will be funded from ${name}'s account. ${formatCents(purchaseCents)} is reserved until the purchase payment is recorded. Investor share of profit: ${basisPointsLabel(bp)}.${short ? ` The company fronts ${formatCents(purchaseCents - availableCents)} until ${name}'s capital comes in. This cannot be undone.` : ''}`,
              go: async () => { if (await run(slot, 'fund_car', { carId: chosen.id, potId, purchaseCents, investorBasisPoints: bp, ...(short ? { advanceReason: advanceReason.trim() } : {}) }, `Allocate ${carTitle(chosen)} · ${name}`)) { setChosen(null); setAdvanceReason(''); void cars.reload(); } } })}>
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
