import type { GarageInvoice, GarageInstallerJob, GarageWorkStatus } from '../types';

// The stages a confirmed work order can be shown in. 'draft' is never
// confirmed, and 'installation_completed' is only passed through on the way
// to payment_due / ready_for_delivery, so neither is ever displayed.
export type WorkOrderStage = Exclude<GarageWorkStatus, 'draft' | 'installation_completed'>;

export const WORK_ORDER_STAGE_LABEL: Record<WorkOrderStage, string> = {
  waiting_for_installer: 'Waiting for Installer',
  installer_assigned: 'Installer Assigned',
  in_progress: 'In Progress',
  payment_due: 'Payment Due Before Delivery',
  ready_for_delivery: 'Ready for Delivery',
  ready_for_warranty: 'Delivered — Register Warranty',
  closed: 'Closed',
};

export const WORK_ORDER_STAGE_BADGE: Record<WorkOrderStage, string> = {
  waiting_for_installer: 'bg-white/[0.03] border-white/10 text-white/60',
  installer_assigned: 'bg-violet-500/15 border-violet-500/30 text-violet-300',
  in_progress: 'bg-blue-500/15 border-blue-500/30 text-blue-400',
  payment_due: 'bg-orange-500/15 border-orange-500/30 text-orange-400',
  ready_for_delivery: 'bg-gold-500/15 border-gold-400/40 text-gold-400',
  ready_for_warranty: 'bg-gold-500/15 border-gold-400/40 text-gold-400',
  closed: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
};

// What has to happen next, and by whom — shown under the work order's
// activity timeline.
export const WORK_ORDER_NEXT_ACTION: Record<WorkOrderStage, string> = {
  waiting_for_installer: 'Installer to accept the job',
  installer_assigned: 'Installer to start installation',
  in_progress: 'Installer to confirm every glass and complete',
  payment_due: 'Salesman to collect payment',
  ready_for_delivery: 'Salesman to hand the car back to the customer',
  ready_for_warranty: 'Salesman to register the e-warranty',
  closed: 'Nothing — this work order is closed',
};

// List ordering — whatever needs someone's action leads.
export const WORK_ORDER_STAGE_ORDER: Record<WorkOrderStage, number> = {
  payment_due: 0, ready_for_delivery: 1, in_progress: 2, installer_assigned: 3,
  waiting_for_installer: 4, ready_for_warranty: 5, closed: 6,
};

// The stage to show for a work order. The stored work_status is the source
// of truth for the installer-acceptance steps; the later steps (completion,
// payment, delivery, warranty) are still recorded on the job/invoice fields
// until they're moved onto work_status too, so those fields win when set.
export function getWorkOrderStage(invoice: GarageInvoice, job: GarageInstallerJob | null): WorkOrderStage {
  if (invoice.warrantyRegisteredAt) return 'closed';
  if (invoice.deliveredAt) return 'ready_for_warranty';
  if (job?.status === 'completed') {
    return invoice.paymentStatus === 'paid' ? 'ready_for_delivery' : 'payment_due';
  }
  if (job?.status === 'accepted') {
    // Jobs accepted before Start Installation existed have no started_at
    // but were backfilled to in_progress.
    return job.startedAt || invoice.workStatus === 'in_progress' ? 'in_progress' : 'installer_assigned';
  }
  return 'waiting_for_installer';
}

// When the work order entered the stage it's in now — for "how long has it
// been sitting here". Read from the same recorded timestamps the stage
// itself is derived from (each written in the same database step as the
// matching activity-history entry).
export function stageEnteredAt(invoice: GarageInvoice, job: GarageInstallerJob | null): string {
  const stage = getWorkOrderStage(invoice, job);
  const latest = (...isos: (string | undefined)[]) => {
    const set = isos.filter((x): x is string => !!x).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    return set[set.length - 1];
  };
  switch (stage) {
    case 'closed': return invoice.warrantyRegisteredAt ?? invoice.createdAt;
    case 'ready_for_warranty': return invoice.deliveredAt ?? invoice.createdAt;
    // Ready once both done — whichever of completion / payment came last.
    case 'ready_for_delivery': return latest(job?.completedAt, invoice.paidAt) ?? invoice.createdAt;
    case 'payment_due': return job?.completedAt ?? invoice.createdAt;
    case 'in_progress': return job?.startedAt ?? job?.acceptedAt ?? invoice.createdAt;
    case 'installer_assigned': return job?.acceptedAt ?? invoice.createdAt;
    case 'waiting_for_installer': return job?.createdAt ?? invoice.createdAt;
  }
}

export function isWorkOrderClosed(invoice: GarageInvoice): boolean {
  return !!invoice.warrantyRegisteredAt;
}
