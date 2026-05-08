import { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, subMonths, format, isSameMonth,
  isSameDay, isToday, parseISO,
} from 'date-fns';

interface Props {
  customerName: string;
  initialCarId?: string;
  cars: { id: string; year: number; make: string; model: string }[];
  onSave: (scheduledAt: string, carId: string, notes: string) => void;
  onSkip: () => void;
  onClose: () => void;
}

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIME_GROUPS = [
  { label: 'Morning',   slots: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'] },
  { label: 'Afternoon', slots: ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'] },
  { label: 'Evening',   slots: ['18:00', '18:30', '19:00', '19:30', '20:00'] },
];

function fmt12(t: string) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export default function TdScheduleModal({ customerName, initialCarId = '', cars, onSave, onSkip, onClose }: Props) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [carId, setCarId] = useState(initialCarId);
  const [notes, setNotes] = useState('');
  const [cursor, setCursor] = useState(new Date());

  const selected = date ? parseISO(date) : null;

  const monthStart = startOfMonth(cursor);
  const weeks: Date[][] = [];
  let day = startOfWeek(monthStart);
  while (day <= endOfWeek(endOfMonth(cursor))) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) { week.push(day); day = addDays(day, 1); }
    weeks.push(week);
  }

  const handleSave = () => {
    if (!date || !time) return;
    onSave(`${date}T${time}`, carId, notes);
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#0E0D0B]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-obsidian-400/60 shrink-0">
        <div>
          <p className="text-white font-semibold text-sm">Schedule Test Drive</p>
          <p className="text-gray-500 text-xs mt-0.5">{customerName}</p>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-white rounded-xl bg-obsidian-700/60"
        >
          <X size={18} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">

        {/* Calendar */}
        <div>
          {/* Month nav */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setCursor(subMonths(cursor, 1))}
              className="w-11 h-11 flex items-center justify-center rounded-xl bg-obsidian-700/60 text-gray-300"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-white font-semibold">{format(cursor, 'MMMM yyyy')}</span>
            <button
              onClick={() => setCursor(addMonths(cursor, 1))}
              className="w-11 h-11 flex items-center justify-center rounded-xl bg-obsidian-700/60 text-gray-300"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-2">
            {DAY_HEADERS.map(d => (
              <div key={d} className="text-center text-gray-600 text-xs font-semibold">{d}</div>
            ))}
          </div>

          {/* Date grid */}
          <div className="space-y-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((d, di) => {
                  const inMonth    = isSameMonth(d, cursor);
                  const isSelected = !!selected && isSameDay(d, selected);
                  const today      = isToday(d);
                  return (
                    <button
                      key={di}
                      onClick={() => { setDate(format(d, 'yyyy-MM-dd')); setTime(''); }}
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                      className={[
                        'flex items-center justify-center h-12 rounded-xl text-sm font-medium',
                        isSelected
                          ? 'bg-yellow-400 text-black font-bold'
                          : today && inMonth
                            ? 'border-2 border-yellow-400/60 text-yellow-400 font-semibold'
                            : inMonth
                              ? 'bg-obsidian-700/60 text-white'
                              : 'text-gray-700',
                      ].join(' ')}
                    >
                      {format(d, 'd')}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Time slots — only after date is picked */}
        {date && (
          <div>
            <p className="text-yellow-400 text-sm font-semibold mb-3">
              {format(parseISO(date), 'EEEE, d MMMM')}
            </p>
            <div className="space-y-4">
              {TIME_GROUPS.map(group => (
                <div key={group.label}>
                  <p className="text-gray-600 text-xs font-semibold uppercase tracking-widest mb-2">{group.label}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {group.slots.map(slot => (
                      <button
                        key={slot}
                        onClick={() => setTime(slot)}
                        style={{ WebkitTapHighlightColor: 'transparent' }}
                        className={[
                          'py-3.5 rounded-xl text-sm font-medium',
                          time === slot
                            ? 'bg-yellow-400 text-black font-bold'
                            : 'bg-obsidian-700/60 border border-obsidian-400/40 text-gray-300',
                        ].join(' ')}
                      >
                        {fmt12(slot)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Car + Notes */}
        {date && time && (
          <div className="space-y-3">
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Car (optional)</label>
              <select
                value={carId}
                onChange={e => setCarId(e.target.value)}
                className="w-full bg-obsidian-700/60 border border-obsidian-400/60 rounded-xl px-3 py-2.5 text-white text-sm outline-none"
              >
                <option value="">— Any —</option>
                {cars.map(car => (
                  <option key={car.id} value={car.id}>{car.year} {car.make} {car.model}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any notes..."
                className="w-full bg-obsidian-700/60 border border-obsidian-400/60 rounded-xl px-3 py-2.5 text-white text-sm outline-none h-16 resize-none"
              />
            </div>
          </div>
        )}

        <div className="h-2" />
      </div>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-obsidian-400/60 space-y-2 shrink-0" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
        <button
          disabled={!date || !time}
          onClick={handleSave}
          className="w-full py-3.5 rounded-xl text-sm font-bold bg-yellow-400 text-black disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {date && time ? `Save — ${format(parseISO(date), 'd MMM')} at ${fmt12(time)}` : 'Save to Calendar'}
        </button>
        <button
          onClick={onSkip}
          className="w-full py-3 rounded-xl text-sm text-gray-400 border border-obsidian-400/40"
        >
          Skip Test Drive
        </button>
      </div>
    </div>,
    document.body
  );
}
