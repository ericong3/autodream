import { supabase } from './supabase';
import type { GarageInstallerJob, GarageService } from '../types';
import { generateId } from '../utils/format';

function rowToJob(r: any): GarageInstallerJob {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    service: r.service,
    status: r.status,
    createdAt: r.created_at,
    acceptedBy: r.accepted_by ?? undefined,
    acceptedAt: r.accepted_at ?? undefined,
    estimatedCompleteAt: r.estimated_complete_at ?? undefined,
    startedAt: r.started_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
    completedBy: r.completed_by ?? undefined,
    finalInspectionAt: r.final_inspection_at ?? undefined,
    remark: r.remark ?? undefined,
  };
}

export async function getInstallerJob(jobId: string): Promise<GarageInstallerJob | null> {
  const { data, error } = await supabase.from('garage_installer_jobs').select('*').eq('id', jobId).maybeSingle();
  if (error) throw error;
  return data ? rowToJob(data) : null;
}

export async function createInstallerJob(input: { invoiceId: string; service: GarageService }): Promise<GarageInstallerJob> {
  const row = { id: generateId(), invoice_id: input.invoiceId, service: input.service };
  const { data, error } = await supabase.from('garage_installer_jobs').insert(row).select().single();
  if (error) throw error;
  return rowToJob(data);
}

export async function listPendingInstallerJobs(service: GarageService): Promise<GarageInstallerJob[]> {
  const { data, error } = await supabase
    .from('garage_installer_jobs')
    .select('*')
    .eq('status', 'pending')
    .eq('service', service)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToJob);
}

export async function listAcceptedInstallerJobs(service: GarageService): Promise<GarageInstallerJob[]> {
  const { data, error } = await supabase
    .from('garage_installer_jobs')
    .select('*')
    .eq('status', 'accepted')
    .eq('service', service)
    .order('accepted_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToJob);
}

export async function listCompletedInstallerJobs(service: GarageService): Promise<GarageInstallerJob[]> {
  const { data, error } = await supabase
    .from('garage_installer_jobs')
    .select('*')
    .eq('status', 'completed')
    .eq('service', service)
    .order('completed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToJob);
}

export async function getInstallerJobForInvoice(invoiceId: string): Promise<GarageInstallerJob | null> {
  const { data, error } = await supabase.from('garage_installer_jobs').select('*').eq('invoice_id', invoiceId).maybeSingle();
  if (error) throw error;
  return data ? rowToJob(data) : null;
}

// Thrown when someone else claimed the job first — the caller shows who.
export class JobAlreadyAcceptedError extends Error {
  constructor() { super('This job has already been accepted by another installer'); }
}

// Claims the job for this installer and moves the work order to
// installer_assigned, atomically in the database (see the
// accept_garage_installer_job function) — only succeeds while the job is
// still unassigned, so two installers can never both get it.
export async function acceptInstallerJob(jobId: string, userId: string, estimatedCompleteAt: string): Promise<GarageInstallerJob> {
  const { data, error } = await supabase.rpc('accept_garage_installer_job', {
    p_job_id: jobId, p_installer_id: userId, p_estimated_complete_at: estimatedCompleteAt,
  });
  if (error) {
    if (error.message?.includes('JOB_ALREADY_ACCEPTED')) throw new JobAlreadyAcceptedError();
    throw error;
  }
  return rowToJob(data);
}

// Starts work on an accepted job and moves the work order to in_progress,
// atomically (see the start_garage_installer_job function) — a second start
// can't overwrite the first start time.
export async function startInstallerJob(jobId: string, actorId: string): Promise<GarageInstallerJob> {
  const { data, error } = await supabase.rpc('start_garage_installer_job', { p_job_id: jobId, p_actor_id: actorId });
  if (error) {
    if (error.message?.includes('JOB_ALREADY_STARTED')) throw new Error('This job has already been started');
    if (error.message?.includes('JOB_NOT_ASSIGNED')) throw new Error('This job is no longer assigned — refresh and try again');
    throw error;
  }
  return rowToJob(data);
}

const COMPLETE_ERRORS: Record<string, string> = {
  GLASS_NOT_ALL_CONFIRMED: 'Every glass must be confirmed completed first',
  FINAL_INSPECTION_REQUIRED: 'Confirm the final inspection first',
  JOB_NOT_STARTED: 'Start the installation before completing it',
  JOB_ALREADY_COMPLETED: 'This job has already been completed',
};

// Completes the installation and moves the work order on to payment_due or
// ready_for_delivery, atomically (see complete_garage_installer_job) — the
// database itself refuses if any glass isn't confirmed or the job wasn't
// started, so a stale screen can't complete a half-done job.
export async function completeInstallerJob(
  jobId: string, completedBy: string, remark: string, finalInspectionDone: boolean,
): Promise<GarageInstallerJob> {
  const { data, error } = await supabase.rpc('complete_garage_installer_job', {
    p_job_id: jobId, p_completed_by: completedBy, p_remark: remark, p_final_inspection_done: finalInspectionDone,
  });
  if (error) {
    const known = Object.keys(COMPLETE_ERRORS).find((code) => error.message?.includes(code));
    throw known ? new Error(COMPLETE_ERRORS[known]) : error;
  }
  return rowToJob(data);
}
