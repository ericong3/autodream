import { useState } from 'react';
import { ActionErrorBox, Field, LoadState, PendingSaves } from './InvestorFinanceCar';
import { formatCents, formatDay, investorRequest, malaysiaToday, parseRinggit, useInvestorAction, useInvestorQuery, type Bank } from '../lib/investorFinance';

export default function AccountingBankAccounts({ actorId }: { actorId: string }) {
  const query = useInvestorQuery<{ banks: Bank[] }>(actorId + ':accounting-banks', () => investorRequest('banks'));
  const act = useInvestorAction(actorId);
  const retry = async () => { if (await act.retry('save_bank')) await query.reload(); };
  const save = async (body: { name: string; openingDate: string; openingCents: number }) => {
    const saved = await act.run('save_bank', 'save_bank', body, 'Bank account · ' + body.name);
    if (saved) await query.reload();
    return saved;
  };

  return (
    <section className="space-y-4">
      <h1 className="font-display text-white font-bold text-xl">Company bank accounts</h1>
      <PendingSaves pending={act.pending.filter(p => p.slot === 'save_bank')} busy={act.busy} onRetry={() => void retry()} onDiscard={act.discard} />
      <LoadState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
        {query.data && <BankRegister act={act} banks={query.data.banks} run={save} errorBox={<ActionErrorBox error={act.error} slot="save_bank" onRetry={() => void retry()} onDismiss={act.clearError} />} />}
      </LoadState>
    </section>
  );
}

function BankRegister({ act, run, banks, errorBox }: { act: ReturnType<typeof useInvestorAction>; run: (body: { name: string; openingDate: string; openingCents: number }) => Promise<unknown>; banks: Bank[]; errorBox: JSX.Element }) {
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
      <p className="text-gray-600 text-[11px]">Use the full balance from your bank statement on the opening date. Company and investor transactions can use the same bank account. Older records remain available for reconciliation.</p>
      <form className="bg-card-gradient border border-obsidian-400/70 rounded-xl p-4 space-y-2" onSubmit={async (e) => {
        e.preventDefault(); if (!ok || openingCents === null) return;
        if (await run({ name: name.trim(), openingDate, openingCents })) { setName(''); setOpening(''); }
      }}>
        <p className="text-gray-300 text-xs font-semibold uppercase tracking-wider">Add a bank account</p>
        <div className="grid sm:grid-cols-3 gap-2">
          <Field label="Account name" hint="e.g. Public Bank – Used Car"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Opening balance date"><input type="date" max={malaysiaToday()} className="input w-full px-3 py-2 rounded-lg text-sm" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} /></Field>
          <Field label="Opening balance (RM)" hint="From the bank statement on that date"><input inputMode="decimal" className="input w-full px-3 py-2 rounded-lg text-sm" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" /></Field>
        </div>
        <button type="submit" disabled={!ok || act.busy !== null} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40">{act.busy === 'save_bank' ? 'Saving…' : 'Save bank account'}</button>
        {errorBox}
      </form>
    </div>
  );
}
