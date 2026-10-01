import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, Car, User, ChevronRight, Clock3 } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { useStore } from '../store';
import { listInvoicesCreatedBy } from '../lib/garageInvoices';
import { getInstallerJobForInvoice } from '../lib/garageInstallerJobs';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import { GARAGE_SERVICE_MAP } from '../utils/garageServices';
import {
  getWorkOrderStage, WORK_ORDER_STAGE_LABEL, WORK_ORDER_STAGE_BADGE, WORK_ORDER_STAGE_ORDER,
} from '../utils/garageWorkOrderStatus';
import { useInstallerJobUpdates } from '../hooks/useInstallerJobUpdates';
import { useWorkOrderActivityUpdates } from '../hooks/useWorkOrderActivityUpdates';
import { buildWorkOrderPipeline } from '../utils/garageWorkOrderTimeline';
import { MiniPipeline, MiniPipelineLabels } from '../components/GarageWorkOrderPipeline';
import type { GarageInvoice, GarageVehicle, GarageCustomer, GarageInstallerJob, User as AppUser } from '../types';
import type { WorkOrderStage } from '../utils/garageWorkOrderStatus';

interface Row {
  invoice: GarageInvoice;
  vehicle: GarageVehicle | null;
  customer: GarageCustomer | null;
  job: GarageInstallerJob | null;
  stage: WorkOrderStage;
}

// The salesman's pipeline — their own orders only, grouped by where the car
// physically is. Pay-later orders sit at 'awaiting_payment' while still in
// the installer's queue, so payment isn't its own column; the per-order
// stage badge still says exactly what's outstanding.
type PipelineTab = 'installer' | 'delivery' | 'warranty' | 'closed';

const PIPELINE_TABS: { key: PipelineTab; label: string; stages: WorkOrderStage[] }[] = [
  { key: 'installer', label: 'With Installer', stages: ['waiting_for_installer', 'installer_assigned', 'in_progress'] },
  { key: 'delivery', label: 'Ready for Delivery', stages: ['payment_due', 'ready_for_delivery'] },
  { key: 'warranty', label: 'Register Warranty', stages: ['ready_for_warranty'] },
  { key: 'closed', label: 'Closed', stages: ['closed'] },
];

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });

// What the salesman can tell the customer about the car's installer status.
function installerNote({ job }: Row, users: AppUser[]): string | null {
  if (!job) return null;
  if (job.status === 'completed' && job.completedAt) {
    const who = users.find((u) => u.id === (job.completedBy ?? job.acceptedBy))?.name ?? 'Installer';
    return `Installation completed · ${who} · ${formatWhen(job.completedAt)}`;
  }
  if (job.status === 'accepted') {
    const who = users.find((u) => u.id === job.acceptedBy)?.name ?? 'Installer';
    const parts = job.startedAt
      ? [`${who} · started ${formatWhen(job.startedAt)}`]
      : [`${who} · accepted ${job.acceptedAt ? formatWhen(job.acceptedAt) : ''}`.trim()];
    if (job.estimatedCompleteAt) parts.push(`est. done ${formatWhen(job.estimatedCompleteAt)}`);
    return parts.join(' · ');
  }
  if (job.status === 'pending') return 'Waiting for an installer to accept';
  return null;
}

export default function GarageMyWorkOrders() {
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const allUsers = useStore((s) => s.users);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  // Kept in the URL so coming back from an invoice lands on the same tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as PipelineTab | null;
  const activeTab: PipelineTab = PIPELINE_TABS.some((t) => t.key === tabParam) ? tabParam! : 'installer';

  const load = () => {
    if (!currentUser) return;
    listInvoicesCreatedBy(currentUser.id)
      .then(async (invoices) => {
        const built = await Promise.all(invoices.map(async (invoice): Promise<Row> => {
          const [vehicle, customer, job] = await Promise.all([
            getGarageVehicle(invoice.vehicleId),
            getGarageCustomer(invoice.customerId),
            invoice.service === 'tinted' ? getInstallerJobForInvoice(invoice.id) : Promise.resolve(null),
          ]);
          return { invoice, vehicle, customer, job, stage: getWorkOrderStage(invoice) };
        }));
        built.sort((a, b) => WORK_ORDER_STAGE_ORDER[a.stage] - WORK_ORDER_STAGE_ORDER[b.stage]);
        setRows(built);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [currentUser?.id]);
  // Any step on any of these orders (installer or salesman) shows up here
  // right away.
  useInstallerJobUpdates(load);
  useWorkOrderActivityUpdates('all', load);
  const nameOf = (id?: string) => (id ? allUsers.find((u) => u.id === id)?.name : undefined);

  const rowsFor = (tab: PipelineTab) => {
    const stages = PIPELINE_TABS.find((t) => t.key === tab)!.stages;
    return rows.filter((r) => stages.includes(r.stage));
  };
  const visible = rowsFor(activeTab);
  const activeLabel = PIPELINE_TABS.find((t) => t.key === activeTab)!.label;

  return (
    <GarageShell title="AutoDream Garage" nav>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2.5 mb-5">
          <ClipboardList size={18} className="text-gold-400" />
          <h2 className="font-display text-lg text-white font-semibold tracking-wide">My Pipeline</h2>
        </div>

        <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
          {PIPELINE_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setSearchParams({ tab: t.key }, { replace: true })}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors ${
                activeTab === t.key
                  ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                  : 'bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
              }`}
            >
              {t.label} ({loading ? '–' : rowsFor(t.key).length})
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-white/40 text-sm text-center py-20">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="relative mb-5 flex items-center justify-center">
              <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl" />
              <ClipboardList size={34} strokeWidth={1.5} className="relative text-gold-400/70" />
            </div>
            <p className="text-white/40 text-sm">Nothing in {activeLabel}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((row) => {
              const { invoice, vehicle, customer, stage } = row;
              const meta = GARAGE_SERVICE_MAP[invoice.service];
              const note = activeTab === 'installer' || activeTab === 'delivery' ? installerNote(row, allUsers) : null;
              // Same stage model as the order page's pipeline, just the dots.
              const { stages } = buildWorkOrderPipeline(invoice, row.job, [], nameOf);
              return (
                <button
                  key={invoice.id}
                  onClick={() => navigate(`/garage/invoice/${invoice.id}`)}
                  className="w-full flex items-center gap-3 text-left rounded-xl p-4
                    bg-white/[0.04] backdrop-blur-xl border border-gold-400/15
                    hover:border-gold-400/40 hover:bg-white/[0.06] transition-colors"
                >
                  <div className="shrink-0 w-9 h-9 rounded-lg bg-gold-400/10 flex items-center justify-center text-gold-400">
                    <meta.icon size={16} strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white text-sm font-medium">{invoice.invoiceNumber}</p>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${WORK_ORDER_STAGE_BADGE[stage]}`}>
                        {WORK_ORDER_STAGE_LABEL[stage]}
                      </span>
                      {/* Payment is its own track now — flag it until it's collected */}
                      {invoice.paymentStatus === 'pending' && stage !== 'payment_due' && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border bg-orange-500/15 border-orange-500/30 text-orange-400">
                          Unpaid
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-white/40 text-xs flex-wrap">
                      {vehicle && (
                        <span className="flex items-center gap-1"><Car size={11} /> {vehicle.make} {vehicle.model} · {vehicle.registrationNo}</span>
                      )}
                      {customer && (
                        <span className="flex items-center gap-1"><User size={11} /> {customer.name}</span>
                      )}
                    </div>
                    {note && (
                      <p className="flex items-center gap-1 mt-1.5 text-xs text-white/60">
                        <Clock3 size={11} className="text-gold-400/70" /> {note}
                      </p>
                    )}
                    <div className="max-w-md">
                      <MiniPipeline stages={stages} />
                      <MiniPipelineLabels stages={stages} />
                    </div>
                  </div>
                  <ChevronRight size={15} className="text-gold-400/50 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </GarageShell>
  );
}
