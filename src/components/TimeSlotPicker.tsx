import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Clock } from 'lucide-react';

interface TimeSlotPickerProps {
  value: string; // 'HH:MM' (24h) or ''
  onChange: (value: string) => void;
  startHour?: number;
  endHour?: number;
  stepMinutes?: number;
  placeholder?: string;
}

function formatSlotLabel(h: number, m: number) {
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// Click-to-pick time slots, like Google Calendar's start/end time dropdowns
// — no typing, just scroll and click. Portals the list to document.body
// (same trick Modal.tsx uses) so it isn't clipped when this picker lives
// inside a modal's own overflow-hidden container.
export default function TimeSlotPicker({
  value, onChange, startHour = 6, endHour = 23, stepMinutes = 30, placeholder = 'Select time',
}: TimeSlotPickerProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleReposition() { setOpen(false); }
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedEl = listRef.current?.querySelector('[data-selected="true"]');
    selectedEl?.scrollIntoView({ block: 'center' });
  }, [open]);

  const toggleOpen = () => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen((v) => !v);
  };

  const slots = useMemo(() => {
    const out: string[] = [];
    for (let h = startHour; h <= endHour; h++) {
      for (let m = 0; m < 60; m += stepMinutes) {
        out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return out;
  }, [startHour, endHour, stepMinutes]);

  const label = value ? formatSlotLabel(...(value.split(':').map(Number) as [number, number])) : placeholder;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center justify-between gap-2 bg-obsidian-700/60 border border-obsidian-400/60
          rounded-lg px-3 py-2 text-sm outline-none focus:border-gold-500 transition-colors"
      >
        <span className={`flex items-center gap-2 ${value ? 'text-white' : 'text-gray-600'}`}>
          <Clock size={14} className="text-white/30 shrink-0" /> {label}
        </span>
        <ChevronDown size={14} className={`text-white/40 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && rect && createPortal(
        <div
          ref={listRef}
          style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 1000 }}
          className="bg-obsidian-800 border border-obsidian-400/60 rounded-lg max-h-52 overflow-y-auto shadow-card-lg"
        >
          {slots.map((slot) => {
            const [h, m] = slot.split(':').map(Number);
            const selected = slot === value;
            return (
              <button
                key={slot}
                type="button"
                data-selected={selected}
                onClick={() => { onChange(slot); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  selected ? 'bg-gold-500/15 text-gold-400 font-medium' : 'text-white/70 hover:bg-white/5'
                }`}
              >
                {formatSlotLabel(h, m)}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
