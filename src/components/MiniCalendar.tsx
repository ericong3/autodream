import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, subMonths, format, isSameMonth,
  isSameDay, isToday, parseISO,
} from 'date-fns';

interface Props {
  date: string;
  time: string;
  onDate: (d: string) => void;
  onTime: (t: string) => void;
}

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const HOURS = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];

function fmtTime(t: string) {
  const h = parseInt(t.split(':')[0], 10);
  return `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`;
}

export default function MiniCalendar({ date, time, onDate, onTime }: Props) {
  const selected = date ? parseISO(date) : null;
  const [cursor, setCursor] = useState(() => date ? parseISO(date) : new Date());

  const monthStart = startOfMonth(cursor);
  const weeks: Date[][] = [];
  let day = startOfWeek(monthStart);
  while (day <= endOfWeek(endOfMonth(cursor))) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) { week.push(day); day = addDays(day, 1); }
    weeks.push(week);
  }

  // Step 1 — pick date
  if (!date) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <button type="button" onClick={() => setCursor(subMonths(cursor, 1))}
            className="w-10 h-10 flex items-center justify-center rounded-xl text-gray-400 hover:text-white hover:bg-obsidian-600/70 touch-manipulation">
            <ChevronLeft size={20} />
          </button>
          <span className="text-white font-semibold text-base">{format(cursor, 'MMMM yyyy')}</span>
          <button type="button" onClick={() => setCursor(addMonths(cursor, 1))}
            className="w-10 h-10 flex items-center justify-center rounded-xl text-gray-400 hover:text-white hover:bg-obsidian-600/70 touch-manipulation">
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="grid grid-cols-7 mb-2">
          {DAY_HEADERS.map(d => (
            <div key={d} className="text-center text-gray-600 text-xs font-semibold">{d}</div>
          ))}
        </div>

        <div className="space-y-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1">
              {week.map((d, di) => {
                const inMonth    = isSameMonth(d, cursor);
                const isSelected = !!selected && isSameDay(d, selected);
                const today      = isToday(d);
                return (
                  <button key={di} type="button"
                    onClick={() => onDate(format(d, 'yyyy-MM-dd'))}
                    className={[
                      'relative flex items-center justify-center h-11 rounded-xl text-sm font-medium touch-manipulation',
                      isSelected
                        ? 'bg-gold-500 text-obsidian-900 font-bold'
                        : today && inMonth
                          ? 'border-2 border-gold-500/50 text-gold-400'
                          : inMonth
                            ? 'text-white hover:bg-obsidian-600/70'
                            : 'text-gray-700',
                    ].join(' ')}>
                    {format(d, 'd')}
                    {today && !isSelected && (
                      <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-gold-500" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Step 2 — pick time (calendar replaced)
  return (
    <div>
      {/* Back to date */}
      <button type="button" onClick={() => onDate('')}
        className="flex items-center gap-2 text-gold-400 text-sm mb-4 touch-manipulation">
        <ChevronLeft size={16} />
        {format(parseISO(date), 'EEE, d MMM yyyy')}
      </button>

      <p className="text-gray-500 text-xs font-semibold uppercase tracking-widest mb-3">Select Time</p>

      <div className="grid grid-cols-3 gap-2">
        {HOURS.map(slot => (
          <button key={slot} type="button" onClick={() => onTime(slot)}
            className={[
              'py-3.5 rounded-xl text-sm font-medium touch-manipulation',
              time === slot
                ? 'bg-gold-500 text-obsidian-900 font-bold'
                : 'bg-obsidian-700/70 border border-obsidian-400/30 text-gray-300 hover:text-white hover:bg-obsidian-600/60',
            ].join(' ')}>
            {fmtTime(slot)}
          </button>
        ))}
      </div>
    </div>
  );
}
