// Shared pieces for the Add car and Edit car sheets (graphite liquid glass).
import { useEffect, useId, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import './carForm.css';

// Older or low-memory devices get the same look without live backdrop blur.
function useLiteGlass() {
  return useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const n = navigator as Navigator & { deviceMemory?: number };
    return (n.deviceMemory !== undefined && n.deviceMemory <= 4) || (n.hardwareConcurrency !== undefined && n.hardwareConcurrency <= 4);
  }, []);
}

export function GlassSheet({ open, onClose, title, subtitle, headerLeft, headerRight, children, slip, actions, bar }: {
  open: boolean; onClose: () => void; title: string; subtitle?: ReactNode;
  headerLeft?: ReactNode; headerRight?: ReactNode; children: ReactNode;
  slip: ReactNode; actions: ReactNode; bar: ReactNode;
}) {
  useBodyScrollLock(open);
  const lite = useLiteGlass();
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[500] overscroll-contain" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-black/75 modal-backdrop" onClick={onClose} />
      <div className="absolute inset-0 flex justify-center sm:items-center sm:p-4 pointer-events-none">
        <div className={`g-sheet${lite ? ' g-lite' : ''} pointer-events-auto w-full sm:max-w-6xl h-full sm:h-[92vh] sm:rounded-[28px] overflow-hidden flex flex-col modal-enter`}
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <div className="g-orb g-orb-gold" style={{ width: 760, height: 760, left: -260, top: -320 }} />
          <div className="g-orb g-orb-steel" style={{ width: 700, height: 700, right: -260, top: 260 }} />
          <div className="g-orb g-orb-gold" style={{ width: 600, height: 600, left: '18%', bottom: -320, opacity: 0.6 }} />
          <header className="relative flex items-start justify-between gap-4 px-4 sm:px-8 pt-5 sm:pt-7 pb-4 shrink-0">
            <div className="flex items-center gap-4 min-w-0">
              {headerLeft}
              <div className="min-w-0">
                <h2 id={titleId} className="m-0 text-[28px] sm:text-[36px] font-light tracking-[-0.03em] leading-tight">{title}</h2>
                {subtitle && <div className="mt-2 text-[14px] sm:text-[15px] text-[#A7ACB6] leading-snug">{subtitle}</div>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {headerRight}
              <button type="button" onClick={onClose} aria-label="Close" className="g-card g-icon-btn"><X size={18} /></button>
            </div>
          </header>
          <div className="relative flex-1 overflow-y-auto overscroll-contain px-4 sm:px-8 pb-48 lg:pb-10">
            <div className="flex flex-col lg:flex-row gap-5 lg:gap-7 items-stretch lg:items-start">
              <div className="flex-1 min-w-0 flex flex-col gap-4 sm:gap-5">{children}</div>
              <aside className="w-full lg:w-[340px] shrink-0 lg:sticky lg:top-0 flex flex-col gap-3" aria-label="What saving will do">
                {slip}
                <div className="hidden lg:flex flex-col gap-3">{actions}</div>
              </aside>
            </div>
          </div>
          <div className="lg:hidden absolute inset-x-0 bottom-0 px-3 pt-2" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
            <div className="g-bar p-4 flex flex-col gap-3">{bar}</div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function GSection({ title, lede, right, children }: { title: string; lede?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="g-card p-5 sm:p-[26px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="g-h2">{title}</h3>
        {right}
      </div>
      {lede ? <p className="g-lede">{lede}</p> : <div className="h-4" />}
      {children}
    </section>
  );
}

export const gInput = (error?: string, changed?: boolean) => `g-input${error ? ' is-error' : changed ? ' is-changed' : ''}`;

// A label wrapping its control. Use `group` for a set of buttons (no single control to label).
export function GField({ label, error, help, group, className, children }: { label: string; error?: string; help?: ReactNode; group?: boolean; className?: string; children: ReactNode }) {
  const id = useId();
  const tail = <>{help && <p className="g-help">{help}</p>}{error && <p className="g-error" role="alert">{error}</p>}</>;
  if (group) return <div className={className} role="group" aria-labelledby={id}><span id={id} className="g-label">{label}</span>{children}{tail}</div>;
  return <div className={className}><label className="block"><span className="g-label">{label}</span>{children}</label>{tail}</div>;
}

export function GGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3.5 ${className}`}>{children}</div>;
}

export function Seg<T extends string>({ value, options, onChange, label, disabled, className = '' }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean; className?: string;
}) {
  return (
    <div className={`g-seg ${className}`} role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" disabled={disabled} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Choices<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; title: string; desc: string; disabled?: boolean }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={o.disabled} className="g-choice" onClick={() => onChange(o.value)}>
          <span className="g-radio" aria-hidden="true" />
          <span><b>{o.title}</b><small>{o.desc}</small></span>
        </button>
      ))}
    </div>
  );
}

export function SwitchRow({ on, onToggle, title, desc, disabled }: { on: boolean; onToggle: () => void; title: string; desc?: string; disabled?: boolean }) {
  return (
    <button type="button" className="g-switch" aria-pressed={on} disabled={disabled} onClick={onToggle}>
      <span className="g-track" aria-hidden="true" />
      <span><b>{title}</b>{desc && <small>{desc}</small>}</span>
    </button>
  );
}

export function Chips<T extends string>({ value, options, onChange, label }: {
  value: T | undefined; options: readonly { value: T; label: string; desc: string }[]; onChange: (v: T | undefined) => void; label: string;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="g-chip" aria-pressed={value === o.value} onClick={() => onChange(value === o.value ? undefined : o.value)}>
          <span className="block text-[14px] font-semibold">{o.label}</span>
          <span className="block text-[12px] text-[#A7ACB6] mt-0.5">{o.desc}</span>
        </button>
      ))}
    </div>
  );
}

export const COMING_SOON_TYPES = [
  { value: 'trade_in', label: 'Trade-in', desc: 'Customer changing car' },
  { value: 'direct_purchase', label: 'Buying direct', desc: 'Deal agreed, car not here' },
  { value: 'pending_shipment', label: 'Waiting to ship', desc: 'Still in West Malaysia' },
  { value: 'in_shipment', label: 'On the ship', desc: 'On the way here' },
] as const;

export const Plate = ({ text }: { text?: string }) => text?.trim() ? <span className="g-plate">{text.trim()}</span> : null;

// The slip: what pressing save will make.
export function Slip({ children }: { children: ReactNode }) {
  return <div className="g-card p-6 flex flex-col gap-4 rounded-[26px]">{children}</div>;
}
export const SlipRule = () => <div className="g-rule" />;
export const SlipCaption = ({ children }: { children: ReactNode }) => <p className="m-0 text-[13px] text-[#A7ACB6]">{children}</p>;
export function SlipBill({ who, note, amount }: { who: string; note?: string; amount: string }) {
  return (
    <div className="flex justify-between gap-3 items-start">
      <span className="min-w-0"><b className="block text-[14.5px] font-medium break-words">{who}</b>{note && <small className="block text-[12.5px] text-[#A7ACB6]">{note}</small>}</span>
      <span className="g-num text-[14.5px] font-semibold whitespace-nowrap">{amount}</span>
    </div>
  );
}
export function SlipTotal({ label, amount }: { label: string; amount: string }) {
  return <div><SlipCaption>{label}</SlipCaption><p className="g-total">{amount}</p></div>;
}
export function Checklist({ items }: { items: { text: string; done: boolean }[] }) {
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-2">
      {items.map((c) => (
        <li key={c.text} className="flex items-center gap-2.5 text-[14px] text-[#E3E5EA]">
          {c.done
            ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#7FD1A0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Done"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#F2B266" strokeWidth="2.2" strokeLinecap="round" role="img" aria-label="Still needed"><circle cx="12" cy="12" r="8.5" /><path d="M12 8v5M12 16h.01" /></svg>}
          {c.text}
        </li>
      ))}
    </ul>
  );
}

// "RM 1,234.56" from ringgit.
export const rm = (n: number | undefined) => 'RM ' + (Number.isFinite(n) ? (n as number) : 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
