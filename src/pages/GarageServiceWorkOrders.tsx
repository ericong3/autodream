import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ClipboardList, Car, User, UserCheck, ChevronRight, LayoutGrid, List } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import GarageWorkOrderBoard from '../components/GarageWorkOrderBoard';
import { JobPriorityBadges, useNow } from '../components/GarageJobPriority';
import { getJobTiming } from '../utils/garageJobPriority';
import { listTintItemsForInvoices } from '../lib/garageTint';
import { useWorkOrderActivityUpdates } from '../hooks/useWorkOrderActivityUpdates';
import { useStore } from '../store';
import { listInvoicesByService } from '../lib/garageInvoices';
import { getInstallerJobForInvoice } from '../lib/garageInstallerJobs';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import { GARAGE_SERVICE_MAP } from '../utils/garageServices';
import {
  getWorkOrderStage, isWorkOrderClosed, WORK_ORDER_STAGE_LABEL, WORK_ORDER_STAGE_BADGE, WORK_ORDER_STAGE_ORDER,
} from '../utils/garageWorkOrderStatus';
import { useInstallerJobUpdates } from '../hooks/useInstallerJobUpdates';
import type { GarageInvoice, GarageVehicle, GarageCustomer, GarageInstallerJob, GarageService, GarageTintWorkOrderItem } from '../types';
import type { WorkOrderStage } from '../utils/garageWorkOrderStatus';

interface Row {
  invoice: GarageInvoice;
  vehicle: GarageVehicle | null;
  customer: GarageCustomer | null;
  job: GarageInstallerJob | null;
  stage: WorkOrderStage;
  glass: GarageTintWorkOrderItem[];
}

// Manager-level oversight — every work order for one service, across every
// salesman, unlike "My Pipeline" which is scoped to the logged-in
// salesman's own orders. Two views of the same work orders: an operational
// Kanban board (the default for Tinted, which has the full installer
// pipeline) and the original list.
export default function GarageServiceWorkOrders() {
  const { service } = useParams<{ service: string }>();
  const navigate = useNavigate();
  const allUsers = useStore((s) => s.users);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);
  // In the URL so opening a card and coming back keeps the chosen view.
  const [searchParams, setSearchParams] = useSearchParams();
  const hasBoard = service === 'tinted';
  const view: 'board' | 'list' = hasBoard && searchParams.get('view') !== 'list' ? 'board' : 'list';
  const setView = (v: 'board' | 'list') => setSearchParams({ view: v }, { replace: true });
  const nameOf = (id?: string) => (id ? allUsers.find((u) => u.id === id)?.name : undefined);
  // Upcoming / Due Now / Overdue / Running Late — derived, refreshed each minute.
  const now = useNow();

  const meta = GARAGE_SERVICE_MAP[service as GarageService];

  const load = (quiet = false) => {
    if (!service) return;
    if (!quiet) setLoading(true);
    listInvoicesByService(service as GarageService)
      .then(async (invoices) => {
        // Per-glass installers for every order, in one request.
        const allGlass = await listTintItemsForInvoices(invoices.filter((i) => i.service === 'tinted').map((i) => i.id)).catch(() => []);
        const built = await Promise.all(invoices.map(async (invoice): Promise<Row> => {
          const [vehicle, customer, job] = await Promise.all([
            getGarageVehicle(invoice.vehicleId),
            getGarageCustomer(invoice.customerId),
            invoice.service === 'tinted' ? getInstallerJobForInvoice(invoice.id) : Promise.resolve(null),
          ]);
          return { invoice, vehicle, customer, job, stage: getWorkOrderStage(invoice), glass: allGlass.filter((g) => g.invoiceId === invoice.id) };
        }));
        built.sort((a, b) => WORK_ORDER_STAGE_ORDER[a.stage] - WORK_ORDER_STAGE_ORDER[b.stage]);
        setRows(built);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), [service]);
  // Keep the board live: installer job changes, plus every salesman step
  // (each records an activity-history entry).
  useInstallerJobUpdates(() => load(true));
  useWorkOrderActivityUpdates('all', () => load(true));

  const active = rows.filter((r) => !isWorkOrderClosed(r.invoice));
  const closed = rows.filter((r) => isWorkOrderClosed(r.invoice));
  const visible = showClosed ? closed : active;

  return (
    <GarageShell title={`${meta?.label ?? 'Service'} Work Orders`} showBack backTo="/garage/work-order-tracking">
      <div className={view === 'board' ? '' : 'max-w-2xl mx-auto'}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
          <div className="flex items-center gap-2.5">
            <ClipboardList size={18} className="text-gold-400" />
            <h2 className="font-display text-lg text-white font-semibold tracking-wide">{meta?.label ?? 'Service'} Work Orders</h2>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
          {hasBoard && (
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              {([['board', 'Board', LayoutGrid], ['list', 'List', List]] as const).map(([v, label, Icon]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                    view === v ? 'bg-gold-500/15 text-gold-400' : 'bg-white/[0.03] text-white/50 hover:text-white/80'
                  }`}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
          )}
          {view === 'list' && (
          <div className="flex gap-1.5">
            {([[false, `Active (${active.length})`], [true, `Closed (${closed.length})`]] as [boolean, string][]).map(([val, label]) => (
              <button
                key={String(val)}
                onClick={() => setShowClosed(val)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  showClosed === val
                    ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                    : 'bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          )}
          </div>
        </div>

        {loading ? (
          <p className="text-white/40 text-sm text-center py-20">Loading…</p>
        ) : view === 'board' ? (
          // The board breaks out of the page's reading-width column to use
          // the whole screen — seven columns don't fit in a form-width frame.
          <div className="relative left-1/2 w-screen -translate-x-1/2 px-5 sm:px-8">
            <GarageWorkOrderBoard
              rows={rows}
              nameOf={nameOf}
              onOpen={(invoiceId) => navigate(`/garage/invoice/${invoiceId}`)}
            />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="relative mb-5 flex items-center justify-center">
              <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl" />
              <ClipboardList size={34} strokeWidth={1.5} className="relative text-gold-400/70" />
            </div>
            <p className="text-white/40 text-sm">{showClosed ? 'No closed work orders yet' : 'No active work orders yet'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(({ invoice, vehicle, customer, job, stage }) => {
              const rowMeta = GARAGE_SERVICE_MAP[invoice.service];
              const creator = allUsers.find((u) => u.id === invoice.createdBy);
              return (
                <button
                  key={invoice.id}
                  onClick={() => navigate(`/garage/invoice/${invoice.id}`)}
                  className="w-full flex items-center gap-3 text-left rounded-xl p-4
                    bg-white/[0.04] backdrop-blur-xl border border-gold-400/15
                    hover:border-gold-400/40 hover:bg-white/[0.06] transition-colors"
                >
                  <div className="shrink-0 w-9 h-9 rounded-lg bg-gold-400/10 flex items-center justify-center text-gold-400">
                    <rowMeta.icon size={16} strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white text-sm font-medium">{invoice.invoiceNumber}</p>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${WORK_ORDER_STAGE_BADGE[stage]}`}>
                        {WORK_ORDER_STAGE_LABEL[stage]}
                      </span>
                      <JobPriorityBadges timing={getJobTiming(invoice, job, now)} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-white/40 text-xs flex-wrap">
                      {vehicle && (
                        <span className="flex items-center gap-1"><Car size={11} /> {vehicle.make} {vehicle.model} · {vehicle.registrationNo}</span>
                      )}
                      {customer && (
                        <span className="flex items-center gap-1"><User size={11} /> {customer.name}</span>
                      )}
                      {creator && (
                        <span className="flex items-center gap-1"><UserCheck size={11} /> {creator.name}</span>
                      )}
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
