import { useMemo, useRef, useState } from 'react';

export interface TimelineMarker {
  id: string;
  time: Date;
  label: string;
}

interface DayTimelinePickerProps {
  value: string; // 'HH:MM' (24h) or ''
  onChange: (value: string) => void;
  markers?: TimelineMarker[];
  startHour?: number;
  endHour?: number;
}

const ROW_HEIGHT = 44;
const SNAP_MINUTES = 15;

function formatLabel(h: number, m: number) {
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// A real hour-by-hour timeline (like the Garage Calendar's own day/week
// grid) instead of a dropdown list — click anywhere to jump the selected
// time there, or press and drag up/down to slide it, with existing
// commitments for that day shown as markers for context.
export default function DayTimelinePicker({
  value, onChange, markers = [], startHour = 6, endHour = 22,
}: DayTimelinePickerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const hours = useMemo(() => Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i), [startHour, endHour]);
  const totalHeight = hours.length * ROW_HEIGHT;

  const yToTime = (clientY: number): string => {
    const rect = trackRef.current!.getBoundingClientRect();
    const y = Math.min(Math.max(clientY - rect.top, 0), totalHeight);
    const totalMinutes = (y / ROW_HEIGHT) * 60;
    const snapped = Math.round(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;
    const h = startHour + Math.floor(snapped / 60);
    const m = snapped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(yToTime(e.clientY));
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    onChange(yToTime(e.clientY));
  };
  const stopDragging = () => setDragging(false);

  const [selH, selM] = value ? value.split(':').map(Number) : [null, null];
  const selectedTop = selH !== null ? ((selH - startHour) * 60 + (selM ?? 0)) / 60 * ROW_HEIGHT : null;

  return (
    <div>
      <p className="text-white/50 text-xs mb-2">
        {value ? <>Selected: <span className="text-gold-400 font-medium">{formatLabel(selH!, selM!)}</span></> : 'Click or drag on the timeline to pick a time'}
      </p>
      <div className="flex border border-obsidian-400/60 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
        <div className="w-12 shrink-0 border-r border-white/10 bg-obsidian-800/60">
          {hours.map((h) => (
            <div key={h} style={{ height: ROW_HEIGHT }} className="text-right pr-1.5 pt-0.5 border-b border-white/[0.06] last:border-b-0">
              <span className="text-white/30 text-[10px]">{h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'am' : 'pm'}</span>
            </div>
          ))}
        </div>
        <div
          ref={trackRef}
          className="relative flex-1 cursor-pointer touch-none select-none bg-obsidian-700/40"
          style={{ height: totalHeight }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerLeave={stopDragging}
        >
          {hours.map((h) => (
            <div key={h} style={{ height: ROW_HEIGHT }} className="border-b border-white/[0.06] last:border-b-0" />
          ))}

          {markers.map((mk) => {
            const top = (mk.time.getHours() - startHour + mk.time.getMinutes() / 60) * ROW_HEIGHT;
            if (top < 0 || top > totalHeight) return null;
            return (
              <div
                key={mk.id}
                className="absolute left-1 right-1 flex items-center gap-1 pointer-events-none"
                style={{ top: top - 7 }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                <span className="text-blue-200 text-[10px] truncate bg-blue-500/20 rounded px-1 py-0.5">{mk.label}</span>
              </div>
            );
          })}

          {selectedTop !== null && (
            <div className="absolute left-0 right-0 pointer-events-none" style={{ top: selectedTop }}>
              <div className="h-0.5 bg-gold-400 shadow-[0_0_6px_rgba(212,175,55,0.6)]" />
              <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-gold-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
