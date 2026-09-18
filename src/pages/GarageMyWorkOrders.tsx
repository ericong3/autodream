import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Car, User, ChevronRight } from 'lucide-react';
import GarageShell, { SALESMAN_TABS } from '../components/GarageShell';
import { useStore } from '../store';
import { listInvoicesCreatedBy } from '../lib/garageInvoices';
import { getInstallerJobForInvoice } from '../lib/garageInstallerJobs';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import { GARAGE_SERVICE_MAP } from '../utils/garageServices';
import { getWorkOrderStage, isWorkOrderClosed, WORK_ORDER_STAGE_LABEL } from '../utils/garageWorkOrderStatus';
import type { GarageInvoice, GarageVehicle, GarageCustomer, GarageInstallerJob } from '../types';
import type { WorkOrderStage } from '../utils/garageWorkOrderStatus';

interface Row {
  invoice: GarageInvoice;
  vehicle: GarageVehicle | null;
  customer: GarageCustomer | null;
  job: GarageInstallerJob | null;
  stage: WorkOrderStage;
}

// Closed stages don't need attention — active ones lead, most-recent first
// within each group.
const STAGE_ORDER: Record<WorkOrderStage, number> = {
  payment_due: 0, ready_for_delivery: 1, in_progress: 2, awaiting_installer: 3,
  awaiting_payment: 4, ready_for_warranty: 5, closed: 6,
};

const STAGE_BADGE: Record<WorkOrderStage, string> = {
  awaiting_payment: 'bg-orange-500/15 border-orange-500/30 text-orange-400',
  awaiting_installer: 'bg-white/[0.03] border-white/10 text-white/60',
  in_progress: 'bg-blue-500/15 border-blue-500/30 text-blue-400',
  payment_due: 'bg-orange-500/15 border-orange-500/30 text-orange-400',
  ready_for_delivery: 'bg-gold-500/15 border-gold-400/40 text-gold-400',
  ready_for_warranty: 'bg-gold-500/15 border-gold-400/40 text-gold-400',
  closed: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
};

export default function GarageMyWorkOrders() {
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    listInvoicesCreatedBy(currentUser.id)
      .then(async (invoices) => {
        const built = await Promise.all(invoices.map(async (invoice): Promise<Row> => {
          const [vehicle, customer, job] = await Promise.all([
            getGarageVehicle(invoice.vehicleId),
            getGarageCustomer(invoice.customerId),
            invoice.service === 'tinted' ? getInstallerJobForInvoice(invoice.id) : Promise.resolve(null),
          ]);
          return { invoice, vehicle, customer, job, stage: getWorkOrderStage(invoice, job) };
        }));
        built.sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]);
        setRows(built);
      })
      .finally(() => setLoading(false));
  }, [currentUser?.id]);

  const active = rows.filter((r) => !isWorkOrderClosed(r.invoice));
  const closed = rows.filter((r) => isWorkOrderClosed(r.invoice));
  const visible = showClosed ? closed : active;

  return (
    <GarageShell title="AutoDream Garage" tabs={SALESMAN_TABS} showBack>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
          <div className="flex items-center gap-2.5">
            <ClipboardList size={18} className="text-gold-400" />
            <h2 className="font-display text-lg text-white font-semibold tracking-wide">My Work Orders</h2>
          </div>
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
        </div>

        {loading ? (
          <p className="text-white/40 text-sm text-center py-20">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="relative mb-5 flex items-center justify-center">
              <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl" />
              <ClipboardList size={34} strokeWidth={1.5} className="relative text-gold-400/70" />
            </div>
            <p className="text-white/40 text-sm">{showClosed ? 'No closed work orders yet' : 'No active work orders'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(({ invoice, vehicle, customer, stage }) => {
              const meta = GARAGE_SERVICE_MAP[invoice.service];
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
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STAGE_BADGE[stage]}`}>
                        {WORK_ORDER_STAGE_LABEL[stage]}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-white/40 text-xs flex-wrap">
                      {vehicle && (
                        <span className="flex items-center gap-1"><Car size={11} /> {vehicle.make} {vehicle.model} · {vehicle.registrationNo}</span>
                      )}
                      {customer && (
                        <span className="flex items-center gap-1"><User size={11} /> {customer.name}</span>
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
