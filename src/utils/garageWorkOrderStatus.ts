import type { GarageInvoice, GarageInstallerJob, GarageWorkStatus } from '../types';

// The stages a confirmed work order can be shown in. 'draft' is never
// confirmed, and 'installation_completed' is only passed through on the way
// to payment_due / ready_for_delivery, so neither is ever displayed.
export type WorkOrderStage = Exclude<GarageWorkStatus, 'draft' | 'installation_completed'>;

export const WORK_ORDER_STAGE_LABEL: Record<WorkOrderStage, string> = {
  waiting_for_installer: 'Waiting for Installer',
  installer_assigned: 'Installer Assigned', // legacy only
  in_progress: 'In Progress',
  pending_approval: 'Pending Approval',
  payment_due: 'Payment Due Before Delivery',
  ready_for_delivery: 'Ready for Delivery',
  ready_for_warranty: 'Delivered — Register Warranty',
  closed: 'Closed',
};

export const WORK_ORDER_STAGE_BADGE: Record<WorkOrderStage, string> = {
  waiting_for_installer: 'bg-white/[0.03] border-white/10 text-white/60',
  installer_assigned: 'bg-violet-500/15 border-violet-500/30 text-violet-300',
  in_progress: 'bg-blue-500/15 border-blue-500/30 text-blue-400',
  pending_approval: 'bg-indigo-500/15 border-indigo-400/40 text-indigo-300',
  payment_due: 'bg-orange-500/15 border-orange-500/30 text-orange-400',
  ready_for_delivery: 'bg-gold-500/15 border-gold-400/40 text-gold-400',
  ready_for_warranty: 'bg-gold-500/15 border-gold-400/40 text-gold-400',
  closed: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
};

// What has to happen next, and by whom — shown under the work order's
// activity timeline.
export const WORK_ORDER_NEXT_ACTION: Record<WorkOrderStage, string> = {
  waiting_for_installer: 'Installers to take glass and start the car',
  installer_assigned: 'Installers to start the car',
  in_progress: 'Installers to finish every glass and submit for approval',
  pending_approval: 'Garage Head to review and approve the installation',
  payment_due: 'Salesman to collect payment',
  ready_for_delivery: 'Salesman to hand the car back to the customer',
  ready_for_warranty: 'Salesman to register the e-warranty',
  closed: 'Nothing — this work order is closed',
};

// List ordering — whatever needs someone's action leads.
export const WORK_ORDER_STAGE_ORDER: Record<WorkOrderStage, number> = {
  pending_approval: 0, payment_due: 1, ready_for_delivery: 2, in_progress: 3, installer_assigned: 4,
  waiting_for_installer: 5, ready_for_warranty: 6, closed: 7,
};

// Where the work order is now — read straight from garage_invoices.work_status,
// the single source of truth for the lifecycle. The database keeps it right
// (the pipeline functions set it, and a reconcile trigger re-derives it if
// the underlying facts are ever written some other way). Timestamps,
// job.status and payment_status are details: who, when, how — not where.
//
// installation_completed is only ever passed through on the way to the next
// step, and draft is never confirmed, so neither is a displayed stage.
export function getWorkOrderStage(invoice: GarageInvoice): WorkOrderStage {
  switch (invoice.workStatus) {
    case 'installation_completed':
      return invoice.paymentStatus === 'paid' ? 'ready_for_delivery' : 'payment_due';
    case 'draft':
      return 'waiting_for_installer';
    default:
      return invoice.workStatus;
  }
}

// When the work order entered the stage it's in now — for "how long has it
// been sitting here". Read from the same recorded timestamps the stage
// itself is derived from (each written in the same database step as the
// matching activity-history entry).
export function stageEnteredAt(invoice: GarageInvoice, job: GarageInstallerJob | null): string {
  const stage = getWorkOrderStage(invoice);
  const latest = (...isos: (string | undefined)[]) => {
    const set = isos.filter((x): x is string => !!x).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    return set[set.length - 1];
  };
  switch (stage) {
    case 'closed': return invoice.warrantyRegisteredAt ?? invoice.createdAt;
    case 'ready_for_warranty': return invoice.deliveredAt ?? invoice.createdAt;
    // Ready once both done — whichever of approval / payment came last.
    case 'ready_for_delivery': return latest(job?.approvedAt ?? job?.completedAt, invoice.paidAt) ?? invoice.createdAt;
    case 'payment_due': return job?.approvedAt ?? job?.completedAt ?? invoice.createdAt;
    case 'pending_approval': return job?.submittedForApprovalAt ?? invoice.createdAt;
    // Back in progress after a return counts from the return.
    case 'in_progress': return latest(job?.startedAt ?? job?.acceptedAt, job?.returnedAt) ?? invoice.createdAt;
    case 'installer_assigned': return job?.acceptedAt ?? invoice.createdAt;
    case 'waiting_for_installer': return job?.createdAt ?? invoice.createdAt;
    default: return invoice.createdAt;
  }
}

export function isWorkOrderClosed(invoice: GarageInvoice): boolean {
  return invoice.workStatus === 'closed';
}
