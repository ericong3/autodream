import type { GarageInvoice, GarageInstallerJob } from '../types';

// The full work order lifecycle: paid -> installer job board -> job
// complete -> delivered -> e-warranty registered -> closed (asleep). Any
// work order not yet closed is "active" — see isWorkOrderClosed below.
export type WorkOrderStage =
  | 'awaiting_payment'
  | 'awaiting_installer'
  | 'in_progress'
  | 'payment_due'
  | 'ready_for_delivery'
  | 'ready_for_warranty'
  | 'closed';

export const WORK_ORDER_STAGE_LABEL: Record<WorkOrderStage, string> = {
  awaiting_payment: 'Awaiting Payment',
  awaiting_installer: 'Awaiting Installer',
  in_progress: 'In Progress',
  payment_due: 'Payment Due Before Delivery',
  ready_for_delivery: 'Ready for Delivery',
  ready_for_warranty: 'Delivered — Register Warranty',
  closed: 'Closed',
};

// Pay-later orders must reach paymentStatus 'paid' before delivery — a job
// can finish before or after payment, but delivery always needs both.
export function getWorkOrderStage(invoice: GarageInvoice, job: GarageInstallerJob | null): WorkOrderStage {
  if (invoice.warrantyRegisteredAt) return 'closed';
  if (invoice.deliveredAt) return 'ready_for_warranty';

  const jobStatus = job?.status;
  if (jobStatus === 'completed') {
    return invoice.paymentStatus === 'paid' ? 'ready_for_delivery' : 'payment_due';
  }
  if (jobStatus === 'accepted') return 'in_progress';
  // Job still pending in the queue, or no installer job for this service at all.
  return invoice.paymentStatus === 'paid' ? 'awaiting_installer' : 'awaiting_payment';
}

export function isWorkOrderClosed(invoice: GarageInvoice): boolean {
  return !!invoice.warrantyRegisteredAt;
}
