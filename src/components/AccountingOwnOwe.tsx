// Accounting → What we own and owe: the balance sheet as two bars on one
// scale. When the books add up, the bars are the same length. Display only.
import { useState } from 'react';
import type { OwnOwe, OwnOweItem } from '../lib/booksView';
import { StatusIcon } from './BillsBoard';
import { Explained, rm } from './AccountingParts';

// Fixed colours per side, in order. Items past the list share the last colour.
const OWN = ['#4A4232', '#EAB820', '#7FB3E6', '#94845F', '#C9C2B3', '#6E6248'];
const OWE = ['#F08A5D', '#D9A27A', '#E8C3A8', '#B9876A', '#8F6A55'];
const OURS = ['#3D3420', '#BFAE84', '#6E6248'];
const colourOf = (list: string[], i: number) => list[Math.min(i, list.length - 1)];

type Seg = { key: string; name: string; cents: number; colour: string };

export default function AccountingOwnOwe({ view, onFindGap }: { view: OwnOwe; onFindGap: () => void }) {
  const [formal, setFormal] = useState(false);
  const own = colour(view.own, OWN), owe = colour(view.owe, OWE), ours = colour(view.ours, OURS);
  const right = [...owe, ...ours];
  const plus = (xs: Seg[]) => xs.reduce((s, x) => s + Math.max(0, x.cents), 0);
  const scale = Math.max(plus(own), plus(right), 1);
  const gap = view.gapCents;

  return (
    <div className="space-y-8">
      <section aria-labelledby="bars" className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="bars" className="text-xl font-medium text-[#F3EEE2]">What we own and owe, today</h2>
          {gap ? (
            <span className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#2A1912] text-[#F5A37E] text-sm font-medium"><StatusIcon kind="missing" size={18} />Off by {rm(Math.abs(gap))}</span>
              <button type="button" onClick={onFindGap} className="min-h-[40px] px-4 rounded-[10px] bg-gold-gradient text-obsidian-950 font-semibold text-sm">Find the {rm(Math.abs(gap))}</button>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#252118] text-[#F3EEE2] text-sm"><StatusIcon kind="done" size={18} />The books add up</span>
          )}
        </div>
        <Bar label="What we own" total={view.ownCents} segs={own} scale={scale} />
        <Bar label="What we owe, and what is ours" total={view.oweCents + view.oursCents} segs={right} scale={scale} />
        <p className="text-[13px] text-[#ABA597] max-w-2xl">
          {gap ? `The two bars should be the same length. The bottom bar is ${rm(Math.abs(gap))} ${gap > 0 ? 'shorter' : 'longer'}, because some entries do not add up or use an account missing from the list. “Find the ${rm(Math.abs(gap))}” lists them.` : 'The two bars are the same length: everything we own is matched by what we owe and what is ours.'}
        </p>
      </section>

      <div className="flex justify-end">
        <label className="inline-flex items-center gap-2.5 text-sm text-[#C9C2B3] cursor-pointer select-none">
          <input type="checkbox" className="accent-gold-500 w-4 h-4" checked={formal} onChange={(e) => setFormal(e.target.checked)} />
          Accounting names
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-10 gap-y-8">
        <Side title="What we own" formalTitle="Assets" total={view.ownCents} segs={own} items={view.own} formal={formal} />
        <Side title="What we owe" formalTitle="Liabilities" total={view.oweCents} segs={owe} items={view.owe} formal={formal} />
        <Side title="What is ours" formalTitle="Equity" total={view.oursCents} segs={ours} items={view.ours} formal={formal} />
      </div>
    </div>
  );
}

function colour(items: OwnOweItem[], list: string[]): Seg[] {
  let i = 0;
  return items.map((x) => ({ key: x.id, name: x.name, cents: x.cents, colour: x.cents > 0 ? colourOf(list, i++) : '#F08A5D' }));
}

// Positive parts fill the bar; anything below zero is shown as a striped
// piece taken back off the end, so the plain part is the real total.
function Bar({ label, total, segs, scale }: { label: string; total: number; segs: Seg[]; scale: number }) {
  const pos = segs.filter((s) => s.cents > 0);
  const gross = pos.reduce((s, x) => s + x.cents, 0);
  const minus = segs.filter((s) => s.cents < 0).reduce((s, x) => s - x.cents, 0);
  const pct = (c: number) => (c / scale) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-[#C9C2B3]">{label}</span>
        <span className="text-lg font-medium text-[#F3EEE2] tabular-nums">{rm(total)}</span>
      </div>
      <div className="relative h-12">
        <div className="absolute inset-y-0 left-0 flex gap-[2px] rounded-[10px] overflow-hidden" style={{ width: `${pct(gross)}%` }}
          role="img" aria-label={`${label}: ${pos.map((s) => `${s.name} ${rm(s.cents)}`).join(', ')}${minus ? `, less ${rm(minus)} below zero` : ''}`}>
          {pos.map((s) => {
            const share = (s.cents / gross) * 100;
            const dark = s.colour === '#4A4232' || s.colour === '#3D3420' || s.colour === '#6E6248' || s.colour === '#8F6A55';
            return (
              <div key={s.key} className="flex items-center px-3 min-w-[4px] overflow-hidden" style={{ flex: `0 0 calc(${share}% - 2px)`, background: s.colour }}>
                {pct(s.cents) > 13 && <span className={`hidden sm:inline text-[13px] font-semibold whitespace-nowrap ${dark ? 'text-[#F3EEE2]' : 'text-[#0A0906]'}`}>{s.name}</span>}
              </div>
            );
          })}
        </div>
        {minus > 0 && <div aria-hidden className="absolute inset-y-[-3px] rounded-[10px] border-2 border-[#F08A5D]"
          style={{ left: `${pct(Math.max(0, gross - minus))}%`, width: `${pct(Math.min(minus, gross))}%`, background: 'repeating-linear-gradient(135deg, rgba(240,138,93,0.45) 0 4px, transparent 4px 8px)' }} />}
      </div>
      {minus > 0 && <p className="text-xs text-[#F5A37E]">The striped end ({rm(minus)}) is below zero and comes off the total.</p>}
    </div>
  );
}

function Side({ title, formalTitle, total, segs, items, formal }: { title: string; formalTitle: string; total: number; segs: Seg[]; items: OwnOweItem[]; formal: boolean }) {
  const colourOfItem = new Map(segs.map((s) => [s.key, s.colour]));
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-[#3D3420] pb-2">
        <h3 className="text-[15px] font-medium text-[#F3EEE2]">{formal ? formalTitle : title}</h3>
        <span className="text-[15px] font-semibold text-[#F3EEE2] tabular-nums">{rm(total)}</span>
      </div>
      {items.length === 0 && <p className="text-sm text-[#8C8679]">Nothing here yet.</p>}
      <ul className="space-y-3">
        {items.map((x) => (
          <li key={x.id} className="flex items-start gap-3">
            <span aria-hidden className="mt-1 w-3.5 h-3.5 rounded-[4px] shrink-0" style={{ background: colourOfItem.get(x.id) }} />
            <span className="flex-1 min-w-0"><Explained name={x.name} explain={x.explain} formal={x.formal} showFormal={formal} /></span>
            <span className="text-right shrink-0">
              <span className={`block text-sm font-medium tabular-nums ${x.cents < 0 ? 'text-[#F5A37E]' : 'text-[#F3EEE2]'}`}>{rm(x.cents)}</span>
              {x.cents < 0 && <span className="block text-[11px] text-[#F5A37E]">below zero</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
