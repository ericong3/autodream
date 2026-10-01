import type { GarageInvoice, GarageInstallerJob } from '../types';

// Operational indicators for an active installer job — derived on the fly
// from the appointment / acceptance / start / estimate times and the
// current time. Nothing here is stored or changes a status; it only tells
// whoever's looking what needs attention.
//
//   UPCOMING      appointment more than DUE_WINDOW away, not started
//   DUE NOW       within DUE_WINDOW either side of the appointment, not started
//   OVERDUE       more than DUE_WINDOW past the appointment, not started
//   RUNNING LATE  estimated completion passed, job not completed
//
// A job can be OVERDUE and RUNNING LATE at once (never started, promised
// finish time gone). Completed jobs get no indicators.

export type JobPriorityKey = 'upcoming' | 'due_now' | 'overdue' | 'running_late';

export const DUE_WINDOW_MS = 30 * 60 * 1000;

export const JOB_PRIORITY_META: Record<JobPriorityKey, { label: string; badge: string; severity: number }> = {
  running_late: { label: 'Running Late', badge: 'bg-orange-500/15 border-orange-500/40 text-orange-400', severity: 0 },
  overdue: { label: 'Overdue', badge: 'bg-red-500/15 border-red-500/40 text-red-400', severity: 1 },
  due_now: { label: 'Due Now', badge: 'bg-gold-500/15 border-gold-400/50 text-gold-400', severity: 2 },
  upcoming: { label: 'Upcoming', badge: 'bg-sky-500/10 border-sky-400/30 text-sky-300', severity: 3 },
};

export interface JobTiming {
  appointmentAt?: string;
  estimatedCompleteAt?: string;
  sinceAssignedMs?: number;
  sinceStartedMs?: number;
  indicators: JobPriorityKey[]; // most urgent first
}

export function getJobTiming(invoice: GarageInvoice, job: GarageInstallerJob | null, now: number): JobTiming {
  const timing: JobTiming = {
    appointmentAt: invoice.appointmentAt,
    estimatedCompleteAt: job?.estimatedCompleteAt,
    sinceAssignedMs: job?.acceptedAt ? now - new Date(job.acceptedAt).getTime() : undefined,
    sinceStartedMs: job?.startedAt ? now - new Date(job.startedAt).getTime() : undefined,
    indicators: [],
  };
  if (!job || job.status === 'completed') return timing;

  // Started = the work order says so (also covers jobs from before
  // started_at existed).
  const started = invoice.workStatus === 'in_progress' || !!job.startedAt;

  if (job.status === 'accepted' && job.estimatedCompleteAt && new Date(job.estimatedCompleteAt).getTime() < now) {
    timing.indicators.push('running_late');
  }
  if (!started && invoice.appointmentAt) {
    const appt = new Date(invoice.appointmentAt).getTime();
    if (now > appt + DUE_WINDOW_MS) timing.indicators.push('overdue');
    else if (now >= appt - DUE_WINDOW_MS) timing.indicators.push('due_now');
    else timing.indicators.push('upcoming');
  }
  timing.indicators.sort((a, b) => JOB_PRIORITY_META[a].severity - JOB_PRIORITY_META[b].severity);
  return timing;
}

// "45m", "3h 10m", "2d 4h"
export function formatElapsed(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
