import { useEffect, useState } from 'react';
import { Car, UserCheck, Wrench, Hourglass, CalendarClock, Flag, Banknote } from 'lucide-react';
import {
  WORK_ORDER_STAGE_LABEL, WORK_ORDER_STAGE_BADGE, stageEnteredAt,
} from '../utils/garageWorkOrderStatus';
import type { WorkOrderStage } from '../utils/garageWorkOrderStatus';
import { getJobTiming } from '../utils/garageJobPriority';
import { JobPriorityBadges } from './GarageJobPriority';
import type { GarageInvoice, GarageVehicle, GarageInstallerJob } from '../types';

export interface BoardRow {
  invoice: GarageInvoice;
  vehicle: GarageVehicle | null;
  job: GarageInstallerJob | null;
  stage: WorkOrderStage;
}

// Operational board — one column per stage, left to right in pipeline
// order. Read-only: cards open the work order, there's no dragging between
// columns; stages only change through each role's own actions.
const COLUMNS: { stage: WorkOrderStage; label: string; dot: string }[] = [
  { stage: 'waiting_for_installer', label: 'Waiting for Installer', dot: 'bg-white/40' },
  { stage: 'installer_assigned', label: 'Assigned', dot: 'bg-violet-400' },
  { stage: 'in_progress', label: 'In Progress', dot: 'bg-blue-400' },
  { stage: 'payment_due', label: 'Payment Due', dot: 'bg-orange-400' },
  { stage: 'ready_for_delivery', label: 'Ready for Delivery', dot: 'bg-gold-400' },
  { stage: 'ready_for_warranty', label: 'Ready for Warranty', dot: 'bg-gold-300' },
  { stage: 'closed', label: 'Closed', dot: 'bg-emerald-400' },
];

// Closed only ever grows — show the most recent few.
const CLOSED_LIMIT = 10;

// Past this long in one stage (other than Closed), the timer turns amber.
const SLOW_AFTER_MS = 24 * 60 * 60 * 1000;

function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function GarageWorkOrderBoard({
  rows, nameOf, onOpen,
}: { rows: BoardRow[]; nameOf: (userId?: string) => string | undefined; onOpen: (invoiceId: string) => void }) {
  // Re-render every minute so "time in stage" keeps counting.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="overflow-x-auto pb-3">
      <div className="flex gap-4 min-w-max">
        {COLUMNS.map((col) => {
          const all = rows
            .filter((r) => r.stage === col.stage)
            .map((r) => ({ ...r, enteredAt: stageEnteredAt(r.invoice, r.job) }))
            // Longest-waiting first — except Closed, most recent first.
            .sort((a, b) => col.stage === 'closed'
              ? new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime()
              : new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime());
          const cards = col.stage === 'closed' ? all.slice(0, CLOSED_LIMIT) : all;

          return (
            <section key={col.stage} className="w-64 shrink-0 flex flex-col rounded-2xl bg-white/[0.025] border border-white/[0.07]">
              <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.07]">
                <span className="flex items-center gap-2 text-white/80 text-xs font-semibold uppercase tracking-wider">
                  <span className={`w-2 h-2 rounded-full ${col.dot}`} /> {col.label}
                </span>
                <span className="text-white/40 text-xs font-medium">{all.length}</span>
              </header>

              <div className="p-2.5 space-y-2.5 min-h-[120px]">
                {cards.length === 0 && (
                  <p className="text-white/20 text-xs text-center py-6">Nothing here</p>
                )}
                {cards.map(({ invoice, vehicle, job, stage, enteredAt }) => {
                  const inStageMs = now - new Date(enteredAt).getTime();
                  const slow = stage !== 'closed' && inStageMs > SLOW_AFTER_MS;
                  const installer = nameOf(job?.completedBy ?? job?.acceptedBy);
                  const timing = getJobTiming(invoice, job, now);
                  const urgent = timing.indicators.includes('overdue') || timing.indicators.includes('running_late');
                  return (
                    <button
                      key={invoice.id}
                      onClick={() => onOpen(invoice.id)}
                      className={`w-full text-left rounded-xl p-3.5 bg-white/[0.04] backdrop-blur-xl border
                        hover:bg-white/[0.07] hover:-translate-y-0.5 transition-all duration-200 ${
                          urgent ? 'border-red-500/40 hover:border-red-400/60' : 'border-gold-400/15 hover:border-gold-400/45'
                        }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-white text-sm font-semibold whitespace-nowrap">{invoice.invoiceNumber}</p>
                        <span className={`min-w-0 truncate text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${WORK_ORDER_STAGE_BADGE[stage]}`}>
                          {WORK_ORDER_STAGE_LABEL[stage]}
                        </span>
                      </div>

                      {timing.indicators.length > 0 && (
                        <div className="mb-2"><JobPriorityBadges timing={timing} size="xs" /></div>
                      )}
                      {vehicle && (
                        <p className="flex items-center gap-1.5 text-white/80 text-xs">
                          <Car size={12} className="text-white/35 shrink-0" />
                          <span className="truncate">{vehicle.make} {vehicle.model}</span>
                          <span className="ml-auto shrink-0 font-mono text-[11px] text-gold-400/90 tracking-wide">{vehicle.registrationNo}</span>
                        </p>
                      )}

                      <div className="mt-2 space-y-1 text-[11px] text-white/50">
                        <p className="flex items-center gap-1.5">
                          <UserCheck size={11} className="text-white/30 shrink-0" />
                          <span className="truncate">{nameOf(invoice.createdBy) ?? '—'}</span>
                        </p>
                        <p className="flex items-center gap-1.5">
                          <Wrench size={11} className="text-white/30 shrink-0" />
                          <span className="truncate">{installer ?? 'No installer yet'}</span>
                        </p>
                      </div>

                      <div className="mt-1 space-y-1 text-[11px] text-white/50">
                        <p className="flex items-center gap-1.5">
                          <CalendarClock size={11} className="text-white/30 shrink-0" />
                          {invoice.appointmentAt ? formatWhen(invoice.appointmentAt) : <span className="text-white/30">No appointment</span>}
                        </p>
                        <p className={`flex items-center gap-1.5 ${timing.indicators.includes('running_late') ? 'text-orange-400' : ''}`}>
                          <Flag size={11} className="text-white/30 shrink-0" />
                          {job?.estimatedCompleteAt
                            ? <>Est. done {formatWhen(job.estimatedCompleteAt)}</>
                            : <span className="text-white/30">No estimated completion</span>}
                        </p>
                        <p className={`flex items-center gap-1.5 ${invoice.paymentStatus === 'paid' ? 'text-emerald-400' : 'text-orange-400'}`}>
                          <Banknote size={11} className="shrink-0 opacity-70" />
                          {invoice.paymentStatus === 'paid'
                            ? <>Paid{invoice.paymentMethod ? ` · ${invoice.paymentMethod[0].toUpperCase()}${invoice.paymentMethod.slice(1)}` : ''}</>
                            : 'Unpaid'}
                        </p>
                      </div>

                      <p className={`mt-2.5 pt-2 border-t border-white/[0.06] flex items-center gap-1.5 text-[11px] font-medium ${
                        slow ? 'text-orange-400' : 'text-white/45'
                      }`}>
                        <Hourglass size={11} className="shrink-0" />
                        {stage === 'closed' ? `Closed ${formatWhen(enteredAt)}` : `${formatDuration(inStageMs)} in stage`}
                      </p>
                    </button>
                  );
                })}
                {col.stage === 'closed' && all.length > CLOSED_LIMIT && (
                  <p className="text-white/30 text-[11px] text-center pt-1">+{all.length - CLOSED_LIMIT} older — see List view</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
