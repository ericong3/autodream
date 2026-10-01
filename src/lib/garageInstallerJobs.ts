import { supabase } from './supabase';
import type { GarageInstallerJob, GarageService } from '../types';
import { generateId } from '../utils/format';

// A work order's installation record (garage_installer_jobs, one per work
// order). Tinted installation is team work: the record holds team-level
// facts — started, submitted for approval, approved / returned, final
// inspection, overall remark, ETA — while each glass piece has its own
// installer (see garageTint). accepted_by / accepted_at / assigned_by are
// legacy history from the old one-installer-per-car model.
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
    assignedBy: r.assigned_by ?? undefined,
    startedAt: r.started_at ?? undefined,
    submittedForApprovalAt: r.submitted_for_approval_at ?? undefined,
    submittedBy: r.submitted_by ?? undefined,
    approvedAt: r.approved_at ?? undefined,
    approvedBy: r.approved_by ?? undefined,
    returnedAt: r.returned_at ?? undefined,
    returnedBy: r.returned_by ?? undefined,
    returnReason: r.return_reason ?? undefined,
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

// Every installation record for a service — the team queue groups them by
// their work order's stage.
export async function listInstallerJobsForService(service: GarageService): Promise<GarageInstallerJob[]> {
  const { data, error } = await supabase
    .from('garage_installer_jobs')
    .select('*')
    .eq('service', service)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToJob);
}

export async function getInstallerJobForInvoice(invoiceId: string): Promise<GarageInstallerJob | null> {
  const { data, error } = await supabase.from('garage_installer_jobs').select('*').eq('invoice_id', invoiceId).maybeSingle();
  if (error) throw error;
  return data ? rowToJob(data) : null;
}

const INSTALLATION_ERRORS: Record<string, string> = {
  NOT_AN_INSTALLER: 'Only installers (or a Garage Head / Director / Shareholder) can start installation',
  NOT_A_MANAGER: 'Only a Garage Head, Director or Shareholder can do that',
  NOT_OPEN_FOR_INSTALLATION: 'This car isn\'t open for installation any more — refresh and try again',
  NOT_IN_PROGRESS: 'The installation isn\'t in progress — refresh and try again',
  NOT_ON_THIS_JOB: 'Only an installer who worked on this car (or management) can submit it',
  GLASS_NOT_ALL_CONFIRMED: 'Every glass must be installed before submitting',
  NOT_PENDING_APPROVAL: 'This installation isn\'t waiting for approval — refresh and try again',
  FINAL_INSPECTION_REQUIRED: 'Confirm the final inspection first',
  RETURN_REASON_REQUIRED: 'Give a reason for returning it',
  INSTALLATION_FINISHED: 'The installation is already approved',
};

async function installationStep(fn: string, args: Record<string, unknown>): Promise<GarageInstallerJob> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const known = Object.keys(INSTALLATION_ERRORS).find((code) => error.message?.includes(code));
    throw known ? new Error(INSTALLATION_ERRORS[known]) : error;
  }
  return rowToJob(data);
}

// Start the car (any installer or management). Claiming a glass also
// starts it, so this is only needed to start before taking a piece.
export function startInstallerJob(jobId: string, actorId: string): Promise<GarageInstallerJob> {
  return installationStep('start_garage_installer_job', { p_job_id: jobId, p_actor_id: actorId });
}

// Every glass installed → submitted for the Garage Head's approval. By an
// installer who worked on at least one glass of this car, or management.
export function submitInstallation(jobId: string, actorId: string): Promise<GarageInstallerJob> {
  return installationStep('submit_garage_installation', { p_job_id: jobId, p_actor_id: actorId });
}

// Garage Head / Director / Shareholder approves after final inspection:
// paid → ready for delivery, unpaid → payment due. Locks the installation.
export function approveInstallation(
  jobId: string, actorId: string, finalInspectionDone: boolean, remark?: string,
): Promise<GarageInstallerJob> {
  return installationStep('approve_garage_installation', {
    p_job_id: jobId, p_actor_id: actorId, p_final_inspection_done: finalInspectionDone, p_remark: remark ?? null,
  });
}

// …or returns it for correction (reason required), optionally flagging the
// glass pieces that need work.
export function returnInstallation(
  jobId: string, actorId: string, reason: string, itemIds: string[],
): Promise<GarageInstallerJob> {
  return installationStep('return_garage_installation', {
    p_job_id: jobId, p_actor_id: actorId, p_reason: reason, p_item_ids: itemIds.length ? itemIds : null,
  });
}

// The car's estimated completion — managed by management, optional.
export function setInstallationEta(jobId: string, eta: string | null, actorId: string): Promise<GarageInstallerJob> {
  return installationStep('set_garage_installation_eta', { p_job_id: jobId, p_eta: eta, p_actor_id: actorId });
}
