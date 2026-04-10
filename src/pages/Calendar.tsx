import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalIcon, Car, User, Clock, CheckCircle, XCircle, Circle } from 'lucide-react';
import { useStore } from '../store';
import { TestDrive } from '../types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STATUS_STYLE: Record<TestDrive['status'], { bg: string; text: string; icon: typeof Circle }> = {
  scheduled: { bg: 'bg-gold-500/20 border-gold-500/40 text-gold-300',   text: 'text-gold-400',   icon: Clock },
  completed: { bg: 'bg-green-500/20 border-green-500/40 text-green-300', text: 'text-green-400', icon: CheckCircle },
  cancelled: { bg: 'bg-red-500/20 border-red-500/40 text-red-300',       text: 'text-red-400',   icon: XCircle },
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function Calendar() {
  const testDrives = useStore((s) => s.testDrives);
  const customers = useStore((s) => s.customers);
  const cars = useStore((s) => s.cars);
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const updateTestDrive = useStore((s) => s.updateTestDrive);

  const isDirector = currentUser?.role === 'director';
  const today = new Date();

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [salesFilter, setSalesFilter] = useState<string>(isDirector ? 'all' : (currentUser?.id ?? ''));

  const salespeople = users.filter(u => u.role === 'salesperson');

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  };

  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
  };

  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDay(today.getDate());
  };

  // All test drives visible to this user
  const visibleDrives = useMemo(() => {
    return testDrives.filter(td => {
      const matchUser = isDirector
        ? (salesFilter === 'all' || td.salesId === salesFilter)
        : td.salesId === currentUser?.id;
      return matchUser;
    });
  }, [testDrives, isDirector, salesFilter, currentUser]);

  // Group by day string "YYYY-MM-DD"
  const drivesByDay = useMemo(() => {
    const map: Record<string, TestDrive[]> = {};
    visibleDrives.forEach(td => {
      const day = td.scheduledAt.slice(0, 10);
      if (!map[day]) map[day] = [];
      map[day].push(td);
    });
    return map;
  }, [visibleDrives]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month);

  // Blank cells before first day
  const blanks = Array.from({ length: firstDow });
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const pad = (n: number) => String(n).padStart(2, '0');
  const selectedKey = selectedDay ? `${year}-${pad(month + 1)}-${pad(selectedDay)}` : null;
  const selectedDrives = selectedKey ? (drivesByDay[selectedKey] ?? []) : [];

  const isToday_ = (d: number) =>
    d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const getCustomer = (id: string) => customers.find(c => c.id === id);
  const getCar = (id: string) => cars.find(c => c.id === id);
  const getSalesName = (id: string) => users.find(u => u.id === id)?.name ?? id;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-xl font-bold">Test Drive Calendar</h1>
          <p className="text-gray-500 text-sm mt-0.5">{visibleDrives.filter(t => t.status === 'scheduled').length} upcoming</p>
        </div>
        <div className="flex items-center gap-2">
          {isDirector && (
            <select
              value={salesFilter}
              onChange={e => setSalesFilter(e.target.value)}
              className="input rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
            >
              <option value="all">All Salespeople</option>
              {salespeople.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={goToday}
            className="px-3 py-2 text-sm border border-obsidian-400/60 text-gray-400 hover:text-white hover:border-[#3C321E] rounded-lg transition-colors"
          >
            Today
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Calendar grid */}
        <div className="lg:col-span-2 bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-obsidian-600/60 transition-colors">
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-white font-semibold text-base">
              {MONTHS[month]} {year}
            </h2>
            <button onClick={nextMonth} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-obsidian-600/60 transition-colors">
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-2">
            {DAYS.map(d => (
              <div key={d} className="text-center text-xs font-medium text-gray-500 py-1">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-px">
            {blanks.map((_, i) => (
              <div key={`b${i}`} className="aspect-square" />
            ))}
            {days.map(d => {
              const key = `${year}-${pad(month + 1)}-${pad(d)}`;
              const dayDrives = drivesByDay[key] ?? [];
              const isSelected = selectedDay === d;
              const isTodayDay = isToday_(d);
              const hasScheduled = dayDrives.some(t => t.status === 'scheduled');
              const hasCompleted = dayDrives.some(t => t.status === 'completed');
              const hasCancelled = dayDrives.some(t => t.status === 'cancelled') && !hasScheduled && !hasCompleted;

              return (
                <button
                  key={d}
                  onClick={() => setSelectedDay(isSelected ? null : d)}
                  className={`aspect-square rounded-lg flex flex-col items-center justify-start pt-1.5 px-1 transition-all relative
                    ${isSelected ? 'bg-gold-500/20 border border-gold-500/50' : 'hover:bg-obsidian-700/50 border border-transparent'}
                    ${isTodayDay && !isSelected ? 'border border-gold-500/30' : ''}
                  `}
                >
                  <span className={`text-xs font-medium leading-none
                    ${isTodayDay ? 'text-gold-400' : isSelected ? 'text-white' : 'text-gray-400'}
                  `}>
                    {d}
                  </span>
                  {dayDrives.length > 0 && (
                    <div className="flex gap-0.5 mt-1 flex-wrap justify-center">
                      {hasScheduled && <span className="w-1.5 h-1.5 rounded-full bg-gold-400" />}
                      {hasCompleted && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                      {hasCancelled && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-obsidian-400/60">
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-gold-400" /> Scheduled
            </span>
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-green-400" /> Completed
            </span>
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-red-400" /> Cancelled
            </span>
          </div>
        </div>

        {/* Day detail panel */}
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <CalIcon size={16} className="text-gold-400" />
            <h3 className="text-white font-medium text-sm">
              {selectedDay
                ? `${MONTHS[month]} ${selectedDay}, ${year}`
                : 'Select a date'}
            </h3>
          </div>

          {!selectedDay ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
              <CalIcon size={32} className="text-gray-700 mb-2" />
              <p className="text-gray-500 text-sm">Click a day to view appointments</p>
            </div>
          ) : selectedDrives.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
              <CalIcon size={32} className="text-gray-700 mb-2" />
              <p className="text-gray-500 text-sm">No test drives this day</p>
            </div>
          ) : (
            <div className="space-y-3 flex-1 overflow-y-auto">
              {selectedDrives
                .slice()
                .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
                .map(td => {
                  const customer = getCustomer(td.customerId);
                  const car = getCar(td.carId);
                  const style = STATUS_STYLE[td.status];
                  const StatusIcon = style.icon;
                  const time = td.scheduledAt.length >= 16
                    ? td.scheduledAt.slice(11, 16)
                    : null;

                  return (
                    <div key={td.id} className={`rounded-lg border p-3 ${style.bg}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <StatusIcon size={13} className={style.text} />
                            <span className={`text-xs font-semibold capitalize ${style.text}`}>
                              {td.status.replace('_', ' ')}
                            </span>
                            {time && (
                              <span className="text-xs text-gray-500 ml-auto">{time}</span>
                            )}
                          </div>
                          <p className="text-white text-sm font-medium truncate">
                            {customer?.name ?? 'Unknown Customer'}
                          </p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Car size={11} className="text-gray-500 shrink-0" />
                            <p className="text-gray-400 text-xs truncate">
                              {car ? `${car.year} ${car.make} ${car.model}` : 'Unknown Car'}
                            </p>
                          </div>
                          {isDirector && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <User size={11} className="text-gray-500 shrink-0" />
                              <p className="text-gray-500 text-xs">{getSalesName(td.salesId)}</p>
                            </div>
                          )}
                          {td.notes && (
                            <p className="text-gray-500 text-xs mt-1 italic truncate">{td.notes}</p>
                          )}
                        </div>
                      </div>

                      {/* Status actions */}
                      {td.status === 'scheduled' && (
                        <div className="flex gap-1.5 mt-2">
                          <button
                            onClick={() => updateTestDrive(td.id, { status: 'completed' })}
                            className="flex-1 flex items-center justify-center gap-1 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 text-xs py-1.5 rounded-lg transition-colors"
                          >
                            <CheckCircle size={11} /> Done
                          </button>
                          <button
                            onClick={() => updateTestDrive(td.id, { status: 'cancelled' })}
                            className="flex-1 flex items-center justify-center gap-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs py-1.5 rounded-lg transition-colors"
                          >
                            <XCircle size={11} /> Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
