import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, X, Trash2, User, Clock, Search,
} from 'lucide-react';
import GarageShell, { SALESMAN_TABS } from '../components/GarageShell';
import Modal from '../components/Modal';
import { useStore } from '../store';
import {
  listAppointmentsInRange, createGarageAppointment, updateGarageAppointment, deleteGarageAppointment,
} from '../lib/garageAppointments';
import {
  searchGarageCustomers, getGarageCustomer, getGarageVehicle, listGarageVehicles,
} from '../lib/garageCustomers';
import { GARAGE_SERVICES, GARAGE_SERVICE_COLOR } from '../utils/garageServices';
import type { GarageAppointment, GarageCustomer, GarageVehicle, GarageService } from '../types';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const HOUR_START = 7;
const HOUR_END = 21;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const ROW_HEIGHT = 56;

type ViewMode = 'day' | 'week' | 'month';

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date) { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; }
function isSameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }
const MINI_DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function pad2(n: number) { return String(n).padStart(2, '0'); }
function toDateInput(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function toTimeInput(d: Date) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function formatTime(d: Date) { return d.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' }); }

interface Layout { appt: GarageAppointment; col: number; totalCols: number }

// Simple greedy overlap packer — good enough for a handful of appointments
// per day; doesn't guarantee the theoretically minimal column count.
function layoutDay(appts: GarageAppointment[]): Layout[] {
  const sorted = [...appts].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const colEnds: number[] = [];
  const assigned = sorted.map((a) => {
    const start = new Date(a.startsAt).getTime();
    const end = new Date(a.endsAt).getTime();
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) { col = colEnds.length; colEnds.push(end); } else { colEnds[col] = end; }
    return { appt: a, col };
  });
  const totalCols = Math.max(1, colEnds.length);
  return assigned.map((x) => ({ ...x, totalCols }));
}

interface DraftAppointment {
  id?: string;
  customer: GarageCustomer | null;
  vehicleId: string;
  service: GarageService;
  title: string;
  notes: string;
  date: string;
  startTime: string;
  endTime: string;
}

function blankDraft(date: Date, startHour?: number): DraftAppointment {
  const start = new Date(date);
  if (startHour !== undefined) start.setHours(startHour, 0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  return {
    customer: null, vehicleId: '', service: 'tinted', title: '', notes: '',
    date: toDateInput(start), startTime: toTimeInput(start), endTime: toTimeInput(end),
  };
}

export default function GarageCalendar() {
  const currentUser = useStore((s) => s.currentUser);
  const allUsers = useStore((s) => s.users);
  const isManager = currentUser?.role === 'director' || currentUser?.role === 'shareholder' || currentUser?.role === 'garage_head';
  const garageSalesmen = useMemo(
    () => allUsers.filter((u) => u.businessAccess === 'garage' && u.role === 'garage_salesman'),
    [allUsers],
  );

  const [view, setView] = useState<ViewMode>('week');
  const [cursor, setCursor] = useState(() => new Date());
  const [appointments, setAppointments] = useState<GarageAppointment[]>([]);
  const [customerCache, setCustomerCache] = useState<Record<string, GarageCustomer>>({});
  const [vehicleCache, setVehicleCache] = useState<Record<string, GarageVehicle>>({});
  const [loading, setLoading] = useState(true);
  const [staffFilter, setStaffFilter] = useState('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<DraftAppointment>(() => blankDraft(new Date()));
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<GarageCustomer[]>([]);
  const [vehicleOptions, setVehicleOptions] = useState<GarageVehicle[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const range = useMemo(() => {
    if (view === 'day') return { start: startOfDay(cursor), end: addDays(startOfDay(cursor), 1) };
    if (view === 'week') { const s = startOfWeek(cursor); return { start: s, end: addDays(s, 7) }; }
    const gridStart = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    return { start: gridStart, end: addDays(gridStart, 42) };
  }, [view, cursor]);

  const load = () => {
    setLoading(true);
    listAppointmentsInRange(range.start.toISOString(), range.end.toISOString())
      .then(async (appts) => {
        setAppointments(appts);
        const customerIds = [...new Set(appts.map((a) => a.customerId))].filter((id) => !customerCache[id]);
        const vehicleIds = [...new Set(appts.map((a) => a.vehicleId).filter((v): v is string => !!v))].filter((id) => !vehicleCache[id]);
        const [customers, vehicles] = await Promise.all([
          Promise.all(customerIds.map((id) => getGarageCustomer(id))),
          Promise.all(vehicleIds.map((id) => getGarageVehicle(id))),
        ]);
        setCustomerCache((prev) => {
          const next = { ...prev };
          customers.forEach((c) => { if (c) next[c.id] = c; });
          return next;
        });
        setVehicleCache((prev) => {
          const next = { ...prev };
          vehicles.forEach((v) => { if (v) next[v.id] = v; });
          return next;
        });
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [range.start.getTime(), range.end.getTime()]);

  useEffect(() => {
    const q = customerQuery.trim();
    if (q.length < 2) { setCustomerResults([]); return; }
    const timer = setTimeout(() => { searchGarageCustomers(q).then(setCustomerResults); }, 250);
    return () => clearTimeout(timer);
  }, [customerQuery]);

  const visibleAppointments = useMemo(() => {
    if (isManager) return staffFilter === 'all' ? appointments : appointments.filter((a) => a.createdBy === staffFilter);
    return appointments.filter((a) => a.createdBy === currentUser?.id);
  }, [appointments, isManager, staffFilter, currentUser?.id]);

  const goToday = () => setCursor(new Date());
  const goPrev = () => {
    if (view === 'day') setCursor((c) => addDays(c, -1));
    else if (view === 'week') setCursor((c) => addDays(c, -7));
    else setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  };
  const goNext = () => {
    if (view === 'day') setCursor((c) => addDays(c, 1));
    else if (view === 'week') setCursor((c) => addDays(c, 7));
    else setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
  };

  const openCreate = (date: Date, hour?: number) => {
    setDraft(blankDraft(date, hour));
    setCustomerQuery('');
    setCustomerResults([]);
    setVehicleOptions([]);
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = async (appt: GarageAppointment) => {
    const customer = customerCache[appt.customerId] ?? await getGarageCustomer(appt.customerId);
    const start = new Date(appt.startsAt);
    const end = new Date(appt.endsAt);
    setDraft({
      id: appt.id, customer, vehicleId: appt.vehicleId ?? '', service: appt.service,
      title: appt.title ?? '', notes: appt.notes ?? '',
      date: toDateInput(start), startTime: toTimeInput(start), endTime: toTimeInput(end),
    });
    setCustomerQuery('');
    setCustomerResults([]);
    setFormError('');
    if (customer) {
      const vehicles = await listGarageVehicles(customer.id);
      setVehicleOptions(vehicles);
    }
    setModalOpen(true);
  };

  const selectCustomer = async (customer: GarageCustomer) => {
    setDraft((d) => ({ ...d, customer, vehicleId: '' }));
    setCustomerQuery('');
    setCustomerResults([]);
    const vehicles = await listGarageVehicles(customer.id);
    setVehicleOptions(vehicles);
  };

  const handleSave = async () => {
    if (!draft.customer) { setFormError('Search and select a customer'); return; }
    const startsAt = new Date(`${draft.date}T${draft.startTime}`);
    const endsAt = new Date(`${draft.date}T${draft.endTime}`);
    if (!(endsAt > startsAt)) { setFormError('End time must be after start time'); return; }
    setFormError('');
    setSaving(true);
    try {
      const input = {
        customerId: draft.customer.id,
        vehicleId: draft.vehicleId || undefined,
        service: draft.service,
        title: draft.title.trim() || undefined,
        notes: draft.notes.trim() || undefined,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      };
      if (draft.id) {
        await updateGarageAppointment(draft.id, input);
      } else {
        await createGarageAppointment({ ...input, createdBy: currentUser?.id });
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message ?? 'Something went wrong — please try again');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft.id) return;
    setSaving(true);
    try {
      await deleteGarageAppointment(draft.id);
      setModalOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const headerLabel = view === 'month'
    ? `${MONTH_LABELS[cursor.getMonth()]} ${cursor.getFullYear()}`
    : view === 'week'
      ? `${MONTH_LABELS[range.start.getMonth()]} ${range.start.getDate()} – ${addDays(range.end, -1).getDate()}, ${range.start.getFullYear()}`
      : `${MONTH_LABELS[cursor.getMonth()]} ${cursor.getDate()}, ${cursor.getFullYear()}`;

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(range.start, i)), [range.start]);
  const monthDays = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(range.start, i)), [range.start]);

  // Mini nav always steps by month regardless of the main view mode, and
  // always tracks whichever month `cursor` is in — same single source of
  // truth as the main grid.
  const miniMonthDays = useMemo(() => {
    const gridStart = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor.getFullYear(), cursor.getMonth()]);
  const miniPrevMonth = () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  const miniNextMonth = () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));

  const appointmentsForDay = (day: Date) => visibleAppointments.filter((a) => isSameDay(new Date(a.startsAt), day));

  const renderHourGrid = (days: Date[]) => (
    <div className="flex border border-white/10 rounded-xl overflow-hidden bg-white/[0.02]">
      <div className="w-14 shrink-0 border-r border-white/10">
        <div className="h-10 border-b border-white/10" />
        {HOURS.map((h) => (
          <div key={h} style={{ height: ROW_HEIGHT }} className="border-b border-white/[0.06] text-right pr-2 pt-0.5">
            <span className="text-white/30 text-[10px]">{h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'am' : 'pm'}</span>
          </div>
        ))}
      </div>
      <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((day) => {
          const dayAppts = layoutDay(appointmentsForDay(day));
          const today = isSameDay(day, new Date());
          return (
            <div key={day.toISOString()} className="border-r border-white/10 last:border-r-0">
              <div className={`h-10 border-b border-white/10 flex flex-col items-center justify-center ${today ? 'bg-gold-500/10' : ''}`}>
                <span className="text-white/40 text-[10px] leading-none">{DAY_LABELS[day.getDay()]}</span>
                <span className={`text-sm leading-none mt-0.5 ${today ? 'text-gold-400 font-semibold' : 'text-white/70'}`}>{day.getDate()}</span>
              </div>
              <div
                className="relative cursor-pointer"
                style={{ height: HOURS.length * ROW_HEIGHT }}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const hour = HOUR_START + (e.clientY - rect.top) / ROW_HEIGHT;
                  openCreate(day, Math.floor(hour));
                }}
              >
                {HOURS.map((h) => (
                  <div key={h} className="border-b border-white/[0.06]" style={{ height: ROW_HEIGHT }} />
                ))}
                {dayAppts.map(({ appt, col, totalCols }) => {
                  const start = new Date(appt.startsAt);
                  const end = new Date(appt.endsAt);
                  const top = Math.max(0, (start.getHours() + start.getMinutes() / 60 - HOUR_START) * ROW_HEIGHT);
                  const height = Math.max(22, (end.getTime() - start.getTime()) / 3600000 * ROW_HEIGHT);
                  const color = GARAGE_SERVICE_COLOR[appt.service];
                  const customer = customerCache[appt.customerId];
                  const widthPct = 100 / totalCols;
                  return (
                    <button
                      key={appt.id}
                      onClick={(e) => { e.stopPropagation(); openEdit(appt); }}
                      className={`absolute rounded-md border px-1.5 py-1 text-left overflow-hidden ${color.bg} ${color.border}`}
                      style={{ top, height, left: `${col * widthPct}%`, width: `${widthPct}%` }}
                    >
                      <p className={`text-[11px] font-semibold leading-tight truncate ${color.text}`}>
                        {appt.title || customer?.name || 'Appointment'}
                      </p>
                      <p className="text-white/50 text-[10px] leading-tight truncate">{formatTime(start)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <GarageShell title="AutoDream Garage" tabs={SALESMAN_TABS} showBack>
      <div className="w-full flex flex-col lg:flex-row gap-6">
        {/* Sidebar — mini month navigator + legend, like Google Calendar */}
        <aside className="lg:w-48 shrink-0 space-y-5">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-center justify-between mb-2">
              <button onClick={miniPrevMonth} className="p-1 rounded text-white/40 hover:text-white transition-colors">
                <ChevronLeft size={14} />
              </button>
              <span className="text-white/70 text-xs font-medium">{MONTH_LABELS[cursor.getMonth()]} {cursor.getFullYear()}</span>
              <button onClick={miniNextMonth} className="p-1 rounded text-white/40 hover:text-white transition-colors">
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-y-1">
              {MINI_DAY_LETTERS.map((l, i) => (
                <div key={i} className="text-center text-white/30 text-[10px]">{l}</div>
              ))}
              {miniMonthDays.map((day) => {
                const inMonth = day.getMonth() === cursor.getMonth();
                const today = isSameDay(day, new Date());
                const selected = isSameDay(day, cursor);
                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => setCursor(day)}
                    className={`text-center text-[11px] py-1 rounded-full transition-colors ${
                      selected
                        ? 'bg-gold-500 text-obsidian-950 font-semibold'
                        : today
                          ? 'text-gold-400 font-semibold hover:bg-white/10'
                          : inMonth
                            ? 'text-white/60 hover:bg-white/10'
                            : 'text-white/20 hover:bg-white/5'
                    }`}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider mb-2">Services</p>
            <div className="space-y-1.5">
              {GARAGE_SERVICES.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5 text-white/50 text-[11px]">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${GARAGE_SERVICE_COLOR[s.key].dot}`} /> {s.label}
                </span>
              ))}
            </div>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
            <div className="flex items-center gap-3">
              <button onClick={goPrev} className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-colors">
                <ChevronLeft size={17} />
              </button>
              <h2 className="font-display text-lg text-white font-semibold tracking-wide min-w-[200px]">{headerLabel}</h2>
              <button onClick={goNext} className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-colors">
                <ChevronRight size={17} />
              </button>
              <button onClick={goToday} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-colors">
                Today
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {isManager && (
                <select
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                  className="bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-white/70 text-xs outline-none"
                >
                  <option value="all" className="bg-obsidian-800">All Salesmen</option>
                  {garageSalesmen.map((u) => (
                    <option key={u.id} value={u.id} className="bg-obsidian-800">{u.name}</option>
                  ))}
                </select>
              )}
              <div className="flex gap-1 bg-white/[0.03] border border-white/10 rounded-lg p-1">
                {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                      view === v ? 'bg-gold-500/15 text-gold-400' : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <button
                onClick={() => openCreate(view === 'month' ? new Date() : cursor, 9)}
                className="flex items-center gap-1.5 btn-gold px-3 py-1.5 rounded-lg text-xs font-medium"
              >
                <Plus size={14} /> New
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-white/40 text-sm text-center py-20">Loading…</p>
          ) : view === 'month' ? (
            <div className="border border-white/10 rounded-xl overflow-hidden bg-white/[0.02]">
              <div className="grid grid-cols-7">
                {DAY_LABELS.map((d) => (
                  <div key={d} className="text-center text-white/40 text-[11px] font-medium py-2 border-b border-white/10">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {monthDays.map((day) => {
                  const inMonth = day.getMonth() === cursor.getMonth();
                  const today = isSameDay(day, new Date());
                  const dayAppts = appointmentsForDay(day);
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => { setCursor(day); setView('day'); }}
                      className={`min-h-[84px] p-1.5 border-r border-b border-white/[0.06] text-left align-top last:border-r-0
                        hover:bg-white/[0.04] transition-colors ${!inMonth ? 'opacity-30' : ''}`}
                    >
                      <span className={`text-xs ${today ? 'text-gold-400 font-semibold' : 'text-white/60'}`}>{day.getDate()}</span>
                      <div className="mt-1 space-y-0.5">
                        {dayAppts.slice(0, 3).map((a) => (
                          <div key={a.id} className={`flex items-center gap-1 text-[10px] truncate px-1 py-0.5 rounded ${GARAGE_SERVICE_COLOR[a.service].bg}`}>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${GARAGE_SERVICE_COLOR[a.service].dot}`} />
                            <span className="text-white/70 truncate">{a.title || customerCache[a.customerId]?.name || 'Appt'}</span>
                          </div>
                        ))}
                        {dayAppts.length > 3 && <p className="text-white/30 text-[10px] pl-1">+{dayAppts.length - 3} more</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : view === 'week' ? (
            renderHourGrid(weekDays)
          ) : (
            renderHourGrid([cursor])
          )}
        </div>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={draft.id ? 'Edit Appointment' : 'New Appointment'}
      >
        <label className="block text-gray-300 text-xs font-medium mb-1.5">Customer</label>
        {draft.customer ? (
          <div className="flex items-center justify-between gap-2 bg-obsidian-700/60 border border-obsidian-400/60 rounded-lg px-3 py-2 mb-4">
            <span className="flex items-center gap-2 text-white text-sm truncate">
              <User size={14} className="text-white/40 shrink-0" /> {draft.customer.name}
            </span>
            <button onClick={() => setDraft((d) => ({ ...d, customer: null, vehicleId: '' }))} className="text-white/40 hover:text-red-400 transition-colors shrink-0">
              <X size={15} />
            </button>
          </div>
        ) : (
          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              placeholder="Search by name or IC"
              className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600
                rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors"
            />
            {customerResults.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-obsidian-800 border border-obsidian-400/60 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {customerResults.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => selectCustomer(c)}
                    className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5 transition-colors"
                  >
                    {c.name} <span className="text-white/30 text-xs">{c.icNumber}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {draft.customer && vehicleOptions.length > 0 && (
          <>
            <label className="block text-gray-300 text-xs font-medium mb-1.5">Vehicle (optional)</label>
            <select
              value={draft.vehicleId}
              onChange={(e) => setDraft((d) => ({ ...d, vehicleId: e.target.value }))}
              className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white rounded-lg px-3 py-2 text-sm mb-4 outline-none focus:border-gold-500"
            >
              <option value="" className="bg-obsidian-800">No specific vehicle</option>
              {vehicleOptions.map((v) => (
                <option key={v.id} value={v.id} className="bg-obsidian-800">{v.year} {v.make} {v.model} · {v.registrationNo}</option>
              ))}
            </select>
          </>
        )}

        <label className="block text-gray-300 text-xs font-medium mb-1.5">Service</label>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {GARAGE_SERVICES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setDraft((d) => ({ ...d, service: s.key }))}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border text-[11px] font-medium transition-colors ${
                draft.service === s.key
                  ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                  : 'bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80'
              }`}
            >
              <s.icon size={15} />
              {s.label}
            </button>
          ))}
        </div>

        <label className="block text-gray-300 text-xs font-medium mb-1.5">Title (optional)</label>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder="e.g. Consultation, Installation"
          className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600
            rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-gold-500 transition-colors"
        />

        <label className="block text-gray-300 text-xs font-medium mb-1.5">Date</label>
        <input
          type="date"
          value={draft.date}
          onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
          className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white rounded-lg px-3 py-2 text-sm mb-4 outline-none focus:border-gold-500"
        />

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-gray-300 text-xs font-medium mb-1.5">Start</label>
            <input
              type="time"
              value={draft.startTime}
              onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value }))}
              className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-gold-500"
            />
          </div>
          <div>
            <label className="block text-gray-300 text-xs font-medium mb-1.5">End</label>
            <input
              type="time"
              value={draft.endTime}
              onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value }))}
              className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-gold-500"
            />
          </div>
        </div>

        <label className="block text-gray-300 text-xs font-medium mb-1.5">Notes (optional)</label>
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600
            rounded-lg px-3 py-2 text-sm h-20 resize-none mb-2 focus:outline-none focus:border-gold-500 transition-colors"
        />

        {formError && <p className="text-red-400 text-xs mb-2 flex items-center gap-1.5"><Clock size={12} /> {formError}</p>}

        <div className="flex gap-3 mt-3">
          {draft.id && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium
                border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-60"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={() => setModalOpen(false)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-60">
            {saving ? 'Saving…' : draft.id ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </Modal>
    </GarageShell>
  );
}
