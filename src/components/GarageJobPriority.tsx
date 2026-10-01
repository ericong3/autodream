import { useEffect, useState } from 'react';
import { CalendarClock, Flag, Timer } from 'lucide-react';
import { JOB_PRIORITY_META, formatElapsed } from '../utils/garageJobPriority';
import type { JobTiming } from '../utils/garageJobPriority';

// Current time, refreshed every minute — so indicators and "time since"
// stay live on screens that are left open.
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// The derived operational labels (UPCOMING / DUE NOW / OVERDUE / RUNNING
// LATE) as pills. Renders nothing when there are none.
export function JobPriorityBadges({ timing, size = 'sm' }: { timing: JobTiming; size?: 'xs' | 'sm' }) {
  if (timing.indicators.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {timing.indicators.map((key) => (
        <span
          key={key}
          className={`inline-flex items-center gap-1 font-semibold uppercase tracking-wide rounded-full border ${
            size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'
          } ${JOB_PRIORITY_META[key].badge} ${key === 'due_now' ? 'animate-pulse' : ''}`}
        >
          {key === 'overdue' || key === 'running_late' ? <Flag size={size === 'xs' ? 8 : 9} /> : null}
          {JOB_PRIORITY_META[key].label}
        </span>
      ))}
    </span>
  );
}

// Appointment, estimated completion, time since assigned / started — the
// times the indicators are based on. Only the ones that exist are shown.
export function JobTimingRows({ timing, compact = false }: { timing: JobTiming; compact?: boolean }) {
  const rows: { icon: typeof Timer; text: string; tone?: string }[] = [];
  if (timing.appointmentAt) rows.push({ icon: CalendarClock, text: `Appointment ${formatWhen(timing.appointmentAt)}` });
  if (timing.estimatedCompleteAt) {
    rows.push({
      icon: Flag,
      text: `Est. done ${formatWhen(timing.estimatedCompleteAt)}`,
      tone: timing.indicators.includes('running_late') ? 'text-orange-400' : undefined,
    });
  }
  if (timing.sinceStartedMs !== undefined) rows.push({ icon: Timer, text: `Started ${formatElapsed(timing.sinceStartedMs)} ago`, tone: 'text-blue-400' });
  if (rows.length === 0) return null;
  return (
    <div className={compact ? 'space-y-0.5' : 'grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1'}>
      {rows.map((r, i) => (
        <p key={i} className={`flex items-center gap-1.5 ${compact ? 'text-[11px]' : 'text-xs'} ${r.tone ?? 'text-white/55'}`}>
          <r.icon size={compact ? 11 : 12} className="shrink-0 opacity-70" /> {r.text}
        </p>
      ))}
    </div>
  );
}
