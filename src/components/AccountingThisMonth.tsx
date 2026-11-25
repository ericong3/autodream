// Accounting → This month: are the books in order, what we made, and where the
// customers' money went, car by car. Display only; nothing here saves.
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useStore } from '../store';
import { salesCommission } from '../utils/salesCommission';
import { shortName } from '../utils/format';
import { cents, perHundred } from '../lib/booksView';
import { StatusIcon } from './BillsBoard';
import { Ring, SectionTitle, rm } from './AccountingParts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const C = { car: '#4A4232', repairs: '#6E6248', other: '#94845F', commission: '#BFAE84', profit: '#EAB820', staff: '#3D3420' };
const PART_NAMES: Record<keyof typeof C, string> = { car: 'Car', repairs: 'Repairs', other: 'Other costs', commission: 'Commission', profit: 'Profit', staff: 'Staff sales, no profit counted' };
type PartKey = keyof typeof C;

export type BankCheckSummary = { loading: boolean; error: string; total: number; done: number; answered: number; needs: number };

export default function AccountingThisMonth({ year, month, bank, gapCents, missing, deletes, onBank, onGap, onBills, onDeletes }: {
  year: number; month: number;
  bank: BankCheckSummary;
  gapCents: number | null; // null while the books are still loading
  missing: number | null;
  deletes: number | null;
  onBank: () => void; onGap: () => void; onBills: () => void; onDeletes: () => void;
}) {
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const users = useStore((s) => s.users);
  const customers = useStore((s) => s.customers);
  const [who, setWho] = useState('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showJobs, setShowJobs] = useState(false);
  const monthName = MONTHS[month];

  // The same rules the old Overview used: a car counts in the month it was
  // approved (else submitted, else added), and the profit sums are unchanged.
  const data = useMemo(() => {
    const soldDate = (car: typeof cars[0]) => new Date(car.finalDeal?.approvedAt ?? car.finalDeal?.submittedAt ?? car.dateAdded);
    const sold = cars.filter((c) => {
      if (c.status !== 'delivered') return false;
      const d = soldDate(c);
      return d.getFullYear() === year && d.getMonth() === month;
    });
    const dealCustomer = (car: typeof cars[0]) => customers.find((c) => c.interestedCarId === car.id && (c.cashWorkOrder || c.loanWorkOrder));
    const rows = sold.map((car) => {
      const dc = dealCustomer(car);
      const wo = dc?.loanWorkOrder ?? dc?.cashWorkOrder;
      const repairCosts = repairs.filter((r) => r.carId === car.id && r.status === 'done').reduce((s, r) => s + (r.actualCost ?? r.totalCost), 0);
      const miscCosts = (car.miscCosts ?? []).reduce((s, m) => s + m.amount, 0);
      const additionalTotal = wo?.additionalItems?.reduce((s, i) => s + i.amount, 0) ?? 0;
      const dealPrice = ((wo?.sellingPrice ?? car.finalDeal?.dealPrice ?? car.sellingPrice) - (wo?.discount ?? 0)) || car.sellingPrice;
      const commission = salesCommission(car, customers);
      const profit = car.isStaffSale ? 0 : dealPrice - car.purchasePrice - repairCosts - miscCosts - additionalTotal - commission;
      const spId = car.assignedSalesperson || dc?.assignedSalesId;
      const sp = spId ? users.find((u) => u.id === spId) : undefined;
      return {
        id: car.id, name: `${car.make} ${car.model} ${car.year}`, plate: car.carPlate, staff: !!car.isStaffSale,
        spId: sp?.id ?? '', spName: sp ? shortName(sp.name) : '',
        paid: cents(dealPrice), car: cents(car.purchasePrice), repairs: cents(repairCosts), other: cents(miscCosts + additionalTotal), extras: cents(additionalTotal),
        commission: cents(commission), profit: cents(profit),
      };
    }).sort((a, b) => b.profit - a.profit || a.name.localeCompare(b.name));
    const jobs = repairs.filter((r) => r.status === 'done' && sold.some((c) => c.id === r.carId));
    return { rows, jobs };
  }, [cars, repairs, users, customers, year, month]);

  const { rows, jobs } = data;
  const sum = (k: 'paid' | 'car' | 'repairs' | 'other' | 'commission' | 'profit') => rows.reduce((s, r) => s + r[k], 0);
  const paid = sum('paid'), profit = sum('profit');
  const costs = sum('car') + sum('repairs') + sum('other') + sum('commission');
  const leftover = paid - costs - Math.max(0, profit);
  const parts: { key: PartKey; cents: number }[] = [
    { key: 'car', cents: sum('car') }, { key: 'repairs', cents: sum('repairs') }, { key: 'other', cents: sum('other') },
    { key: 'commission', cents: sum('commission') }, { key: 'profit', cents: Math.max(0, profit) },
    ...(leftover > 0 && rows.some((r) => r.staff) ? [{ key: 'staff' as const, cents: leftover }] : []),
  ];
  const per100 = new Map(perHundred(parts, paid).map((p) => [p.key, p.per100]));
  const barBase = Math.max(paid, parts.reduce((s, p) => s + p.cents, 0), 1);

  // Who sold what: filter chips, and commission per person.
  const people = useMemo(() => {
    const m = new Map<string, { id: string; name: string; cars: number; commission: number }>();
    for (const r of rows) {
      const k = r.spId || 'none';
      const p = m.get(k) ?? { id: k, name: r.spName || 'No salesperson', cars: 0, commission: 0 };
      p.cars += 1; p.commission += r.commission; m.set(k, p);
    }
    return [...m.values()].sort((a, b) => b.cars - a.cars || a.name.localeCompare(b.name));
  }, [rows]);
  const losses = rows.filter((r) => r.profit < 0).length;
  const shown = rows.filter((r) => who === 'all' || (who === 'loss' ? r.profit < 0 : (r.spId || 'none') === who));
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.paid, r.car + r.repairs + r.other + r.commission + Math.max(0, r.profit))));
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-9">
      {/* Are the books in order? Each tile opens its fix. */}
      <section aria-labelledby="checks" className="space-y-3">
        <SectionTitle>Books check</SectionTitle>
        <div id="checks" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <CheckTile onClick={onBank} title="Bank vs statement"
            icon={bank.loading ? <StatusIcon kind="notyet" size={48} /> : bank.total ? <Ring size={56} stroke={7} total={bank.total} label={`${bank.done} of ${bank.total} lines done`} parts={[{ value: bank.done, color: '#EAB820' }, { value: bank.answered, color: '#6E6248' }]} /> : <StatusIcon kind="missing" size={48} />}
            value={bank.loading ? 'Loading…' : bank.error ? 'Could not load' : bank.total ? `${bank.done} of ${bank.total} lines` : 'No statement yet'}
            note={bank.loading ? '' : bank.error ? 'Open Bank to try again' : !bank.total ? `Upload ${monthName} in Bank check` : bank.needs ? `${bank.needs} need you` : bank.done === bank.total ? 'All done' : 'Answered, waiting to record'}
            warn={!bank.loading && (!!bank.error || !bank.total || bank.needs > 0)} />
          <CheckTile onClick={onGap} title="Books add up"
            icon={<StatusIcon kind={gapCents === null ? 'notyet' : gapCents ? 'missing' : 'done'} size={48} />}
            value={gapCents === null ? 'Loading…' : gapCents ? `Off by ${rm(Math.abs(gapCents))}` : 'Adds up'}
            note={gapCents === null ? '' : gapCents ? 'Find the difference' : 'What we own = what we owe + ours'} warn={!!gapCents} />
          <CheckTile onClick={onBills} title="Bills missing an invoice or slip"
            icon={<StatusIcon kind={missing === null ? 'notyet' : missing ? 'missing' : 'done'} size={48} />}
            value={missing === null ? '…' : missing ? `${missing.toLocaleString('en-MY')} bills` : 'None'}
            note={missing ? 'Add them in Bills and money due' : missing === null ? 'Loading…' : 'Every bill has its papers'} warn={!!missing} />
          <CheckTile onClick={onDeletes} title="Delete requests"
            icon={<StatusIcon kind={deletes === null ? 'notyet' : deletes ? 'owed' : 'done'} size={48} />}
            value={deletes === null ? 'Loading…' : deletes ? `${deletes} waiting` : 'None waiting'}
            note={deletes === null ? '' : deletes ? 'Nothing goes until you say yes' : 'Nothing to approve'} blue={!!deletes} />
        </div>
      </section>

      {/* What we made */}
      <section aria-labelledby="profit" className="flex flex-wrap items-end gap-x-12 gap-y-5">
        <div className="flex flex-col gap-1.5">
          <h2 id="profit" className="text-[15px] font-medium text-[#C9C2B3]">{profit < 0 ? `Lost in ${monthName}` : `Profit in ${monthName}`}</h2>
          <span className={`text-5xl sm:text-6xl font-light leading-none tabular-nums ${profit < 0 ? 'text-[#F5A37E]' : 'text-[#F7D96A]'}`}>{rm(Math.abs(profit))}</span>
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-3 pb-1">
          <Stat value={String(rows.length)} label={rows.length === 1 ? 'car sold' : 'cars sold'} />
          <Stat value={rm(paid)} label="customers paid" />
          <Stat value={rows.length ? rm(Math.round(profit / rows.length)) : '—'} label="profit per car" />
        </div>
      </section>

      {rows.length === 0 ? (
        <p className="text-[#ABA597] text-sm border-t border-[#2A2316] pt-6">No cars sold in {monthName} {year}. Pick another month above.</p>
      ) : <>
        {/* Where each RM 100 went */}
        <section aria-labelledby="rm100" className="space-y-3.5">
          <SectionTitle note={profit < 0 ? <span className="text-[#F5A37E]">Costs were {rm(costs - paid)} more than customers paid</span> : undefined}>
            <span id="rm100">Where each RM 100 from customers went</span>
          </SectionTitle>
          <div role="img" aria-label={parts.map((p) => `${PART_NAMES[p.key]} RM ${(per100.get(p.key)! / 100).toFixed(2)}`).join(', ')} className="flex h-14 rounded-[10px] overflow-hidden gap-[2px]">
            {parts.filter((p) => p.cents > 0).map((p) => {
              const w = (p.cents / barBase) * 100;
              const dark = p.key === 'car' || p.key === 'repairs' || p.key === 'staff';
              return (
                <div key={p.key} className="flex items-center px-3 min-w-[6px] overflow-hidden" style={{ flex: `0 0 calc(${w}% - 2px)`, background: C[p.key] }}>
                  {w > 12 && <span className={`hidden sm:inline text-sm font-semibold whitespace-nowrap ${dark ? 'text-[#F3EEE2]' : 'text-[#0A0906]'}`}>RM {(per100.get(p.key)! / 100).toFixed(2)}{p.key === 'car' && w > 30 ? ' paid for the car' : ''}</span>}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-7 gap-y-2.5">
            {parts.map((p) => (
              <span key={p.key} className="inline-flex items-center gap-2 text-sm">
                <span aria-hidden className="w-3 h-3 rounded-[3px]" style={{ background: C[p.key] }} />
                <span className="text-[#C9C2B3]">{PART_NAMES[p.key]}</span>
                <span className="font-semibold text-[#F3EEE2] tabular-nums">RM {(per100.get(p.key)! / 100).toFixed(2)}</span>
              </span>
            ))}
          </div>
        </section>

        {/* Each car sold */}
        <section aria-labelledby="cars" className="space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="cars" className="text-xl font-medium text-[#F3EEE2]">Each car sold</h2>
            <div role="group" aria-label="Show cars" className="flex flex-wrap gap-2">
              <CountChip on={who === 'all'} onClick={() => setWho('all')} label="All" count={rows.length} />
              {people.length > 1 && people.map((p) => <CountChip key={p.id} on={who === p.id} onClick={() => setWho(p.id)} label={p.name} count={p.cars} />)}
              {losses > 0 && <CountChip on={who === 'loss'} onClick={() => setWho('loss')} label="Lost money" count={losses} />}
            </div>
          </div>
          <div className="border-t border-[#3D3420]">
            {shown.map((r) => {
              const isOpen = open.has(r.id), loss = r.profit < 0;
              const bars: [PartKey, number][] = [['car', r.car], ['repairs', r.repairs], ['other', r.other], ['commission', r.commission]];
              if (!loss) bars.push(['profit', r.profit]);
              return (
                <div key={r.id} className="border-b border-[#2A2316]">
                  <button type="button" aria-expanded={isOpen} onClick={() => toggle(r.id)} className="w-full flex flex-wrap items-center gap-x-5 gap-y-2.5 py-3.5 text-left">
                    <span className="flex-[0_0_230px] min-w-0 flex items-start gap-2">
                      {isOpen ? <ChevronDown size={14} className="mt-1 text-[#8C8679] shrink-0" /> : <ChevronRight size={14} className="mt-1 text-[#8C8679] shrink-0" />}
                      <span className="min-w-0 flex flex-col gap-0.5">
                        <span className="text-[15px] font-semibold text-[#F3EEE2] truncate">{r.name}</span>
                        <span className={`text-[13px] truncate ${r.spName ? 'text-[#ABA597]' : 'text-[#F5A37E]'}`}>{r.plate ? `${r.plate}, ` : ''}{r.spName ? `sold by ${r.spName}` : 'no salesperson'}{r.staff ? ', staff sale' : ''}</span>
                      </span>
                    </span>
                    <span className="flex-[1_1_320px] min-w-0 relative h-[22px]">
                      <span className="absolute inset-0 flex gap-[2px] rounded-md overflow-hidden">
                        {bars.filter(([, v]) => v > 0).map(([k, v]) => <span key={k} style={{ flex: `0 0 ${(v / scale) * 100}%`, background: C[k] }} />)}
                      </span>
                      {loss && <span aria-hidden className="absolute -top-1 -bottom-1 rounded-md border-2 border-[#F08A5D]"
                        style={{ left: `${(r.paid / scale) * 100}%`, width: `${(-r.profit / scale) * 100}%`, background: 'repeating-linear-gradient(135deg, rgba(240,138,93,0.35) 0 4px, transparent 4px 8px)' }} />}
                    </span>
                    <span className="flex-[0_0_150px] text-right flex flex-col gap-0.5 ml-auto">
                      <span className={`text-[17px] font-semibold tabular-nums ${loss ? 'text-[#F5A37E]' : 'text-[#F3EEE2]'}`}>{loss ? `Lost ${rm(-r.profit)}` : rm(r.profit)}</span>
                      <span className="text-xs text-[#8C8679] tabular-nums">of {rm(r.paid)}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="flex flex-wrap gap-x-7 gap-y-2.5 pb-4 sm:pl-[250px] text-sm">
                      <Detail chip={<span className="w-2.5 h-2.5 rounded-full border-2 border-[#F3EEE2]" />} name="Customer paid" value={rm(r.paid)} />
                      <Detail chip={<Sq c={C.car} />} name="Car" value={rm(r.car)} />
                      <Detail chip={<Sq c={C.repairs} />} name="Repairs" value={rm(r.repairs)} />
                      <Detail chip={<Sq c={C.other} />} name="Other costs" value={rm(r.other) + (r.extras ? ` (${rm(r.extras)} extras in the deal)` : '')} />
                      <Detail chip={<Sq c={C.commission} />} name="Commission" value={rm(r.commission)} />
                      {r.staff && <span className="text-[#ABA597]">Staff sale: no profit is counted.</span>}
                    </div>
                  )}
                </div>
              );
            })}
            {shown.length === 0 && <p className="py-6 text-sm text-[#ABA597]">No cars match. Pick All.</p>}
          </div>
        </section>

        {/* Commission earned */}
        <section aria-labelledby="who" className="space-y-3.5">
          <SectionTitle><span id="who">Commission earned</span></SectionTitle>
          <div className="flex flex-wrap gap-x-12 gap-y-4">
            {people.map((p) => (
              <div key={p.id} className="flex items-center gap-3.5 flex-[0_1_340px]">
                <span aria-hidden className="w-11 h-11 rounded-full bg-[#252118] flex items-center justify-center font-semibold text-[#F7D96A] shrink-0">{p.name.charAt(0).toUpperCase()}</span>
                <span className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className="flex justify-between gap-3"><span className="text-[15px] text-[#F3EEE2] truncate">{p.name}</span><span className="text-[15px] font-semibold text-[#F3EEE2] tabular-nums">{rm(p.commission)}</span></span>
                  <span className="flex items-center gap-1.5 text-[13px] text-[#ABA597]">
                    {Array.from({ length: Math.min(p.cars, 12) }, (_, i) => <span key={i} aria-hidden className="w-2 h-2 rounded-full bg-[#BFAE84]" />)}
                    <span className="ml-1">{p.cars} {p.cars === 1 ? 'car' : 'cars'} sold</span>
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Repair jobs on these cars */}
        <section className="border-t border-[#2A2316] pt-4">
          <button type="button" aria-expanded={showJobs} onClick={() => setShowJobs(!showJobs)} className="min-h-[44px] flex items-center gap-2 text-[15px] text-[#C9C2B3] hover:text-white">
            {showJobs ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            Repair jobs on these cars
            <span className="text-[#8C8679] tabular-nums">{jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}, {rm(sum('repairs'))}</span>
          </button>
          {showJobs && (jobs.length === 0 ? <p className="text-sm text-[#ABA597] py-2">No repair jobs on the cars sold this month.</p> : (
            <div className="divide-y divide-[#2A2316] border-t border-[#2A2316]">
              {jobs.map((j) => {
                const car = cars.find((c) => c.id === j.carId);
                return (
                  <div key={j.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 py-2.5 text-sm">
                    <span className="flex-[0_0_220px] min-w-0 text-[#F3EEE2] truncate">{car ? `${car.make} ${car.model} ${car.year}` : '—'}</span>
                    <span className="flex-1 min-w-[140px] text-[#C9C2B3]">{j.typeOfRepair}{j.location ? <span className="text-[#8C8679]">, {j.location}</span> : null}</span>
                    <span className="text-[#8C8679] text-xs w-24">{j.completedAt ? new Date(j.completedAt).toLocaleDateString('en-MY') : '—'}</span>
                    <span className="w-32 text-right font-medium text-[#F3EEE2] tabular-nums">{rm(cents(j.actualCost ?? j.totalCost))}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      </>}
    </div>
  );
}

function CheckTile({ icon, title, value, note, warn, blue, onClick }: { icon: ReactNode; title: string; value: string; note: string; warn?: boolean; blue?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-4 px-4 py-4 rounded-2xl bg-[#141210] border border-[#2A2316] hover:border-[#3D3420] text-left transition-colors">
      <span className="w-14 h-14 flex items-center justify-center shrink-0">{icon}</span>
      <span className="min-w-0 flex flex-col gap-0.5">
        <span className="text-sm text-[#C9C2B3]">{title}</span>
        <span className="text-xl font-medium text-[#F3EEE2] tabular-nums leading-tight">{value}</span>
        {note && <span className={`text-[13px] ${warn ? 'text-[#F5A37E]' : blue ? 'text-[#9FC7E8]' : 'text-[#ABA597]'}`}>{note}</span>}
      </span>
    </button>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <span className="flex flex-col gap-0.5"><span className="text-2xl font-medium text-[#F3EEE2] tabular-nums">{value}</span><span className="text-[13px] text-[#ABA597]">{label}</span></span>;
}

function CountChip({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`min-h-[40px] inline-flex items-center gap-2 px-4 rounded-full text-sm border transition-colors ${on ? 'bg-gold-gradient text-obsidian-950 border-transparent font-semibold' : 'border-white/10 text-[#C9C2B3] hover:text-white hover:border-white/25'}`}>
      {label}<span className={on ? 'text-[#3D3420]' : 'text-[#8C8679]'}>{count}</span>
    </button>
  );
}

const Sq = ({ c }: { c: string }) => <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: c }} />;
function Detail({ chip, name, value }: { chip: ReactNode; name: string; value: string }) {
  return <span className="inline-flex items-center gap-2" aria-hidden={false}>{chip}<span className="text-[#C9C2B3]">{name}</span><span className="font-medium text-[#F3EEE2] tabular-nums">{value}</span></span>;
}
