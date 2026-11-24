// Small pieces shared by the Accounting screens: money in words, a progress
// ring, and the "?" that explains a plain name in one sentence.
import { useState, type ReactNode } from 'react';
import { formatRM } from '../utils/format';

export const rm = (c: number) => (c < 0 ? '−' : '') + formatRM(Math.abs(c) / 100);
export const signedRm = (c: number) => (c > 0 ? '+' : c < 0 ? '−' : '') + formatRM(Math.abs(c) / 100);
export const monthLong = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
export const monthShort = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-MY', { month: 'short', year: 'numeric' });
export const dayShort = (d: string) => new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });

// A ring filled by parts, in order (the first part sits on top).
export function Ring({ size = 56, stroke = 7, parts, total, label, big, small }: {
  size?: number; stroke?: number; total: number; label: string;
  parts: { value: number; color: string }[];
  big?: string; small?: string;
}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, mid = size / 2;
  let run = 0;
  const arcs = parts.map((p) => { run += Math.max(0, p.value); return { color: p.color, upTo: run }; }).reverse();
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="shrink-0">
      <circle cx={mid} cy={mid} r={r} fill="none" stroke="#2A2316" strokeWidth={stroke} />
      {total > 0 && arcs.map((a, i) => a.upTo > 0 && (
        <circle key={i} cx={mid} cy={mid} r={r} fill="none" stroke={a.color} strokeWidth={stroke}
          strokeDasharray={`${(Math.min(a.upTo, total) / total) * c} ${c}`} transform={`rotate(-90 ${mid} ${mid})`} />
      ))}
      {big && <text x={mid} y={small ? mid + size * 0.02 : mid + size * 0.08} textAnchor="middle" fontSize={size * 0.23} fontWeight={500} fill="#F3EEE2">{big}</text>}
      {small && <text x={mid} y={mid + size * 0.16} textAnchor="middle" fontSize={size * 0.085} fill="#ABA597">{small}</text>}
    </svg>
  );
}

// A plain name with a "?" that opens a one-line explanation.
export function Explained({ name, explain, formal, showFormal }: { name: string; explain: string; formal?: string; showFormal?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="min-w-0 flex flex-col">
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="text-[#F3EEE2] text-sm truncate">{showFormal && formal ? formal : name}</span>
        {explain && (
          <button type="button" aria-expanded={open} aria-label={`What is ${name}?`} onClick={() => setOpen(!open)}
            className={`shrink-0 w-5 h-5 rounded-full border text-[11px] leading-none flex items-center justify-center ${open ? 'border-gold-400 text-gold-300' : 'border-white/15 text-[#ABA597] hover:text-white'}`}>?</button>
        )}
      </span>
      {showFormal && formal && formal !== name && <span className="text-[11px] text-[#8C8679] truncate">{name}</span>}
      {open && <span className="text-xs text-[#C9C2B3] mt-1 leading-snug">{explain}</span>}
    </span>
  );
}

export function SectionTitle({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-[15px] font-medium text-[#C9C2B3]">{children}</h2>
      {note && <span className="text-xs text-[#8C8679]">{note}</span>}
    </div>
  );
}
