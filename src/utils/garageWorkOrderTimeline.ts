import type {
  GarageInvoice, GarageInstallerJob, GarageWorkOrderActivity, GarageWorkOrderEventType, GarageTintWorkOrderItem,
} from '../types';
import { getWorkOrderStage } from './garageWorkOrderStatus';
import type { WorkOrderStage } from './garageWorkOrderStatus';
import { GLASS_LABEL, TINT_SERIES } from './tintPricing';

// The salesman's visual pipeline for one work order, plus its activity
// timeline. The timeline is the work order's recorded activity history
// (garage_work_order_activity); the pipeline nodes read the matching
// fields on the work order, which the database writes in the same step as
// each history entry, so the two always agree. Nothing here changes the
// work order; the page's single main action button does that.

// Tinted installation is team work (per-glass installers), so there's no
// single "installer accepts the car" step: Created → Installation →
// Approval (Garage Head) → Payment → Delivery → Warranty → Closed.
export type PipelineStageKey = 'created' | 'installation' | 'approval' | 'payment' | 'delivery' | 'warranty' | 'closed';
export type PipelineStageState = 'done' | 'current' | 'upcoming';

export interface PipelineFact {
  label: string;
  at?: string;
  by?: string;
}

export interface PipelineStage {
  key: PipelineStageKey;
  label: string;
  state: PipelineStageState;
  // What's shown under the node — the most relevant recorded step.
  headline: string;
  at?: string;
  by?: string;
  // Shown when the stage is clicked.
  facts: PipelineFact[];
  note: string;
  // Who acts at this stage.
  responsible: string;
}

const RESPONSIBLE: Record<PipelineStageKey, string> = {
  created: 'Salesman',
  installation: 'Installers',
  approval: 'Garage Head',
  payment: 'Salesman',
  delivery: 'Salesman',
  warranty: 'Salesman',
  closed: '—',
};

export interface ActivityEvent {
  key: string;
  type: GarageWorkOrderEventType;
  label: string;
  at: string;
  by?: string;
  detail?: string;
}

const EVENT_LABEL: Record<GarageWorkOrderEventType, string> = {
  WORK_ORDER_CREATED: 'Work order created',
  SENT_TO_INSTALLER: 'Sent to installer queue',
  INSTALLER_ACCEPTED: 'Installer accepted',
  INSTALLER_ASSIGNED: 'Installer assigned',
  INSTALLATION_STARTED: 'Installation started',
  GLASS_ITEM_CLAIMED: 'Glass taken',
  GLASS_ITEM_RELEASED: 'Glass released',
  GLASS_ITEM_ASSIGNED: 'Glass assigned',
  GLASS_ITEM_COMPLETED: 'Glass installed',
  GLASS_ITEM_REOPENED: 'Glass reopened',
  INSTALLATION_SUBMITTED: 'Submitted for approval',
  INSTALLATION_APPROVED: 'Installation approved',
  INSTALLATION_RETURNED: 'Returned for correction',
  INSTALLATION_COMPLETED: 'Installation completed',
  PAYMENT_COLLECTED: 'Payment collected',
  VEHICLE_READY: 'Vehicle ready for delivery',
  VEHICLE_DELIVERED: 'Vehicle delivered',
  WARRANTY_REGISTERED: 'Warranty registered',
  WORK_ORDER_CLOSED: 'Work order closed',
};

const SERIES_LABEL: Record<string, string> = Object.fromEntries(TINT_SERIES.map((s) => [s.key, s.label]));
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', transfer: 'Transfer', installment: 'Installment' };
const ROLE_LABEL: Record<string, string> = {
  garage_salesman: 'Salesman', garage_installer: 'Installer', garage_head: 'Garage Head',
  director: 'Director', shareholder: 'Shareholder',
};

function eventDetail(a: GarageWorkOrderActivity, nameOf: (userId?: string) => string | undefined): string | undefined {
  const m = a.metadata ?? {};
  switch (a.eventType) {
    case 'INSTALLER_ACCEPTED':
      return m.estimated_complete_at ? `Est. finish ${formatTime(m.estimated_complete_at)}` : undefined;
    case 'INSTALLER_ASSIGNED':
      return [
        `To ${nameOf(m.installer_id) ?? 'an installer'}`,
        m.estimated_complete_at && `est. finish ${formatTime(m.estimated_complete_at)}`,
      ].filter(Boolean).join(' · ');
    case 'GLASS_ITEM_CLAIMED':
    case 'GLASS_ITEM_RELEASED':
    case 'GLASS_ITEM_COMPLETED':
    case 'GLASS_ITEM_REOPENED': {
      const glass = GLASS_LABEL[m.glass_position] ?? m.glass_position;
      const series = m.installed_series ? SERIES_LABEL[m.installed_series] ?? m.installed_series : undefined;
      return [glass, series].filter(Boolean).join(' · ') || undefined;
    }
    case 'GLASS_ITEM_ASSIGNED': {
      const glass = GLASS_LABEL[m.glass_position] ?? m.glass_position;
      const to = m.to_installer ? nameOf(m.to_installer) ?? 'an installer' : 'nobody (unassigned)';
      return `${glass} → ${to}`;
    }
    case 'INSTALLATION_RETURNED':
      return m.reason ? `“${m.reason}”` : undefined;
    case 'INSTALLATION_APPROVED':
    case 'INSTALLATION_COMPLETED':
      return m.remark ? `“${m.remark}”` : undefined;
    case 'PAYMENT_COLLECTED':
      return [m.method && METHOD_LABEL[m.method], m.at_confirmation && 'at confirmation'].filter(Boolean).join(' · ') || undefined;
    default:
      return undefined;
  }
}

// The recorded activity history, as timeline entries (oldest first).
export function activityToEvents(
  activity: GarageWorkOrderActivity[],
  nameOf: (userId?: string) => string | undefined,
): ActivityEvent[] {
  return activity.map((a) => {
    const name = nameOf(a.actorId);
    const role = a.actorRole ? ROLE_LABEL[a.actorRole] : undefined;
    return {
      key: a.id,
      type: a.eventType,
      label: EVENT_LABEL[a.eventType] ?? a.eventType,
      at: a.createdAt,
      by: name ? (role ? `${name} (${role})` : name) : undefined,
      detail: eventDetail(a, nameOf),
    };
  });
}

// Which pipeline stage the work order is currently sitting in.
const CURRENT_STAGE: Record<WorkOrderStage, PipelineStageKey> = {
  waiting_for_installer: 'installation',
  installer_assigned: 'installation',
  in_progress: 'installation',
  pending_approval: 'approval',
  payment_due: 'payment',
  ready_for_delivery: 'delivery',
  ready_for_warranty: 'warranty',
  closed: 'closed',
};

export function buildWorkOrderPipeline(
  invoice: GarageInvoice,
  job: GarageInstallerJob | null,
  activity: GarageWorkOrderActivity[],
  nameOf: (userId?: string) => string | undefined,
  items: GarageTintWorkOrderItem[] = [],
): { stages: PipelineStage[]; events: ActivityEvent[]; stage: WorkOrderStage; currentKey: PipelineStageKey } {
  const stage = getWorkOrderStage(invoice);
  const currentKey = CURRENT_STAGE[stage];
  const started = !!job?.startedAt || ['in_progress', 'pending_approval'].includes(invoice.workStatus);
  // Approval completes the installation (legacy orders completed directly).
  const installDone = job?.status === 'completed';
  const submitted = invoice.workStatus === 'pending_approval';
  const paid = invoice.paymentStatus === 'paid';
  // Everyone who worked a glass on this car — or, for orders from before
  // per-glass installers, the one installer who took the whole car.
  const installerIds = [...new Set(items.map((i) => i.installerId).filter((x): x is string => !!x))];
  const installerNames = (installerIds.length ? installerIds : job?.acceptedBy ? [job.acceptedBy] : [])
    .map((id) => nameOf(id)).filter(Boolean).join(', ');
  const installedCount = items.filter((i) => i.status === 'installed').length;

  const done: Record<PipelineStageKey, boolean> = {
    created: true,
    installation: installDone || submitted,
    approval: installDone,
    payment: paid,
    delivery: !!invoice.deliveredAt,
    warranty: !!invoice.warrantyRegisteredAt,
    closed: !!invoice.warrantyRegisteredAt,
  };
  const stateOf = (key: PipelineStageKey): PipelineStageState =>
    done[key] ? 'done' : key === currentKey ? 'current' : 'upcoming';

  const stages: Omit<PipelineStage, 'responsible'>[] = [
    {
      key: 'created',
      label: 'Created',
      state: stateOf('created'),
      headline: 'Created',
      at: invoice.createdAt,
      by: nameOf(invoice.createdBy),
      facts: [
        { label: 'Work order created', at: invoice.createdAt, by: nameOf(invoice.createdBy) },
        ...(job ? [{ label: 'Sent to installer queue', at: job.createdAt }] : []),
        ...(invoice.appointmentAt ? [{ label: 'Appointment', at: invoice.appointmentAt }] : []),
      ],
      note: invoice.remark ? `Remarks for installer: ${invoice.remark}` : 'Confirmed and sent to the installer queue.',
    },
    {
      key: 'installation',
      label: 'Installation',
      state: stateOf('installation'),
      headline: done.installation ? 'Installation Done'
        : started ? 'Installation Started'
        : 'Waiting for Installers',
      at: job?.submittedForApprovalAt ?? job?.startedAt,
      by: installerNames || undefined,
      facts: [
        ...(job?.startedAt ? [{ label: 'Started', at: job.startedAt }] : []),
        ...(started && !job?.startedAt ? [{ label: 'Started (time not recorded)' }] : []),
        ...(installerNames ? [{ label: 'Installers', by: installerNames }] : []),
        ...(items.length ? [{ label: `Glass installed: ${installedCount} of ${items.length}` }] : []),
        ...(job?.estimatedCompleteAt && !installDone ? [{ label: 'Estimated completion', at: job.estimatedCompleteAt }] : []),
        ...(job?.submittedForApprovalAt ? [{ label: 'Submitted for approval', at: job.submittedForApprovalAt, by: nameOf(job.submittedBy) }] : []),
      ],
      note: done.installation ? 'Every glass is installed.'
        : job?.returnReason && job.returnedAt ? `Returned for correction: ${job.returnReason}`
        : started ? 'Installers are working on the car — each glass is taken and confirmed by its installer.'
        : 'Any installer can take a glass to start the car.',
    },
    {
      key: 'approval',
      label: 'Approval',
      state: stateOf('approval'),
      headline: installDone ? 'Approved' : submitted ? 'Pending Approval' : 'Approval',
      at: job?.approvedAt ?? job?.completedAt,
      by: nameOf(job?.approvedBy ?? job?.completedBy),
      facts: [
        ...(job?.returnedAt ? [{ label: 'Last returned', at: job.returnedAt, by: nameOf(job.returnedBy) }] : []),
        ...(job?.approvedAt ? [{ label: 'Approved', at: job.approvedAt, by: nameOf(job.approvedBy) }] : []),
        ...(!job?.approvedAt && job?.completedAt ? [{ label: 'Completed', at: job.completedAt, by: nameOf(job.completedBy ?? job.acceptedBy) }] : []),
        ...(job?.finalInspectionAt ? [{ label: 'Final inspection confirmed', at: job.finalInspectionAt }] : []),
      ],
      note: installDone
        ? job?.remark ? `Remarks: ${job.remark}` : 'Installation approved after final inspection.'
        : submitted ? 'Waiting for the Garage Head to inspect and approve.'
        : 'The Garage Head approves once every glass is installed and submitted.',
    },
    {
      key: 'payment',
      label: 'Payment',
      state: stateOf('payment'),
      headline: paid ? 'Payment Collected' : stage === 'payment_due' ? 'Payment Due' : 'Unpaid',
      at: invoice.paidAt,
      by: nameOf(invoice.paidBy),
      facts: paid
        ? [{ label: invoice.paidAt ? 'Collected' : 'Collected (time not recorded)', at: invoice.paidAt, by: nameOf(invoice.paidBy) }]
        : [],
      note: paid
        ? 'Paid in full.'
        : 'Pay Later — payment must be collected before the car is delivered.',
    },
    {
      key: 'delivery',
      label: 'Delivery',
      state: stateOf('delivery'),
      headline: done.delivery ? 'Delivered' : stage === 'ready_for_delivery' ? 'Ready for Delivery' : 'Delivery',
      at: invoice.deliveredAt,
      by: nameOf(invoice.deliveredBy),
      facts: invoice.deliveredAt ? [{ label: 'Delivered to customer', at: invoice.deliveredAt, by: nameOf(invoice.deliveredBy) }] : [],
      note: done.delivery
        ? 'The car has been handed back to the customer.'
        : 'Available once installation is complete and payment is collected.',
    },
    {
      key: 'warranty',
      label: 'Warranty',
      state: stateOf('warranty'),
      headline: done.warranty ? 'Warranty Registered' : stage === 'ready_for_warranty' ? 'Register Warranty' : 'Warranty',
      at: invoice.warrantyRegisteredAt,
      by: nameOf(invoice.warrantyRegisteredBy),
      facts: invoice.warrantyRegisteredAt
        ? [{ label: 'E-warranty registered', at: invoice.warrantyRegisteredAt, by: nameOf(invoice.warrantyRegisteredBy) }]
        : [],
      note: done.warranty
        ? 'Registered with the manufacturer\'s e-warranty.'
        : 'Register the e-warranty once the car has been delivered.',
    },
    {
      key: 'closed',
      label: 'Closed',
      state: stateOf('closed'),
      headline: 'Closed',
      at: invoice.warrantyRegisteredAt,
      by: nameOf(invoice.warrantyRegisteredBy),
      facts: invoice.warrantyRegisteredAt ? [{ label: 'Work order closed', at: invoice.warrantyRegisteredAt }] : [],
      note: done.closed ? 'This work order is complete.' : 'Closes automatically when the warranty is registered.',
    },
  ];

  return {
    stages: stages.map((s) => ({ ...s, responsible: RESPONSIBLE[s.key] })),
    events: activityToEvents(activity, nameOf),
    stage,
    currentKey,
  };
}

// "2:14 PM" today, "28 Sep, 2:14 PM" otherwise.
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}, ${time}`;
}
