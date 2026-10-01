import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ClipboardList, Car, User, Layers, ArrowRight, Eye, Clock3, ShieldCheck, Play, Users,
} from 'lucide-react';
import GarageShell, { isGarageManager } from '../components/GarageShell';
import { useStore } from '../store';
import { listInstallerJobsForService } from '../lib/garageInstallerJobs';
import { getGarageInvoice } from '../lib/garageInvoices';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import { getTintOrder, listTintItemsForInvoices } from '../lib/garageTint';
import { GARAGE_SERVICE_MAP } from '../utils/garageServices';
import { getJobTiming } from '../utils/garageJobPriority';
import { JobPriorityBadges, JobTimingRows, useNow } from '../components/GarageJobPriority';
import { useWorkOrderActivityUpdates } from '../hooks/useWorkOrderActivityUpdates';
import { TINT_SERIES } from '../utils/tintPricing';
import { formatRM } from '../utils/format';
import type {
  GarageInstallerJob, GarageInvoice, GarageVehicle, GarageCustomer, GarageTintOrder, GarageService,
  GarageTintWorkOrderItem,
} from '../types';

const TINT_SERIES_LABEL = Object.fromEntries(TINT_SERIES.map((s) => [s.key, s.label]));

// The shared team queue. Tinted installation is team work — every
// installer sees every active car; inside a car each glass is taken by one
// installer. Stages follow the work order:
//   Waiting → In Progress → Pending Approval → Completed (approved)
type StageKey = 'waiting' | 'in_progress' | 'approval' | 'completed';
const STAGE_ORDER: StageKey[] = ['waiting', 'in_progress', 'approval', 'completed'];

const STAGE_CONFIG: Record<StageKey, { label: string; node: string; nodeActive: string; text: string }> = {
  waiting: {
    label: 'Waiting',
    node: 'bg-gold-500/15 border-gold-400/40 text-gold-400',
    nodeActive: 'bg-gold-500 border-gold-300 text-obsidian-950 shadow-[0_0_24px_rgba(212,175,55,0.55)]',
    text: 'text-gold-400',
  },
  in_progress: {
    label: 'In Progress',
    node: 'bg-blue-500/15 border-blue-400/40 text-blue-400',
    nodeActive: 'bg-blue-500 border-blue-300 text-white shadow-[0_0_24px_rgba(59,130,246,0.55)]',
    text: 'text-blue-400',
  },
  approval: {
    label: 'Pending Approval',
    node: 'bg-indigo-500/15 border-indigo-400/40 text-indigo-300',
    nodeActive: 'bg-indigo-500 border-indigo-300 text-white shadow-[0_0_24px_rgba(99,102,241,0.55)]',
    text: 'text-indigo-300',
  },
  completed: {
    label: 'Completed',
    node: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-400',
    nodeActive: 'bg-emerald-500 border-emerald-300 text-white shadow-[0_0_24px_rgba(16,185,129,0.55)]',
    text: 'text-emerald-400',
  },
};

// Which tab a car belongs in — from its work order's stage. Legacy
// installer_assigned (one installer had claimed the car) counts as In
// Progress.
function stageOf(job: GarageInstallerJob, invoice: GarageInvoice): StageKey | null {
  if (job.status === 'completed') return 'completed';
  switch (invoice.workStatus) {
    case 'waiting_for_installer': return 'waiting';
    case 'installer_assigned':
    case 'in_progress': return 'in_progress';
    case 'pending_approval': return 'approval';
    default: return null;
  }
}

interface JobCard {
  job: GarageInstallerJob;
  invoice: GarageInvoice;
  vehicle: GarageVehicle | null;
  customer: GarageCustomer | null;
  tintOrder: GarageTintOrder | null;
  glass: GarageTintWorkOrderItem[];
  stage: StageKey;
}

export default function GarageInstallerJobs() {
  const { service } = useParams<{ service: string }>();
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const allUsers = useStore((s) => s.users);
  const [cards, setCards] = useState<JobCard[]>([]);
  const [loading, setLoading] = useState(true);
  // Kept in the URL so coming back from a car lands on the same tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawStage = searchParams.get('stage');
  // Older links: 'pending' / 'assigned' / 'accepted' were whole-car tabs.
  const mapped = rawStage === 'pending' ? 'waiting'
    : rawStage === 'assigned' || rawStage === 'accepted' ? 'in_progress' : rawStage;
  const activeStage: StageKey = mapped && mapped in STAGE_CONFIG ? (mapped as StageKey) : 'waiting';
  const setActiveStage = (stage: StageKey) => setSearchParams({ stage }, { replace: true });
  const isManager = isGarageManager(currentUser?.role);
  const nameOf = (id?: string) => (id ? allUsers.find((u) => u.id === id)?.name : undefined);
  const meta = GARAGE_SERVICE_MAP[service as GarageService];

  const load = (quiet = false) => {
    if (!service) return;
    if (!quiet) setLoading(true);
    listInstallerJobsForService(service as GarageService)
      .then(async (jobs) => {
        const invoiceIds = jobs.map((j) => j.invoiceId);
        const allGlass = await listTintItemsForInvoices(invoiceIds);
        const built = await Promise.all(jobs.map(async (job): Promise<JobCard | null> => {
          const invoice = await getGarageInvoice(job.invoiceId);
          if (!invoice) return null;
          const stage = stageOf(job, invoice);
          if (!stage) return null;
          const [vehicle, customer, tintOrder] = await Promise.all([
            getGarageVehicle(invoice.vehicleId),
            getGarageCustomer(invoice.customerId),
            invoice.service === 'tinted' ? getTintOrder(invoice.id) : Promise.resolve(null),
          ]);
          return { job, invoice, vehicle, customer, tintOrder, stage, glass: allGlass.filter((g) => g.invoiceId === invoice.id) };
        }));
        const visible = built.filter((c): c is JobCard => {
          if (!c) return false;
          if (c.stage !== 'completed' || isManager) return true; // every active car is shared
          // Completed: an installer sees the cars they worked on.
          return c.glass.some((g) => g.installerId === currentUser?.id) || c.job.acceptedBy === currentUser?.id;
        });
        setCards(visible);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), [service, currentUser?.id]);
  // Live: any glass taken / installed / submitted / approved anywhere.
  useWorkOrderActivityUpdates('all', () => load(true));

  const stageCards = (stage: StageKey) => cards.filter((c) => c.stage === stage);
  const activeCards = stageCards(activeStage)
    .sort((a, b) => (activeStage === 'completed'
      ? new Date(b.job.completedAt ?? 0).getTime() - new Date(a.job.completedAt ?? 0).getTime()
      : new Date(a.job.createdAt).getTime() - new Date(b.job.createdAt).getTime()));
  // Ticks every minute so Upcoming / Due Now / Overdue / Running Late stay current.
  const now = useNow();

  const STAGE_ACTION: Record<StageKey, { label: string; icon: typeof Eye }> = {
    waiting: { label: 'Open Car', icon: Play },
    in_progress: { label: 'Open Car', icon: ArrowRight },
    approval: { label: isManager ? 'Review' : 'View', icon: isManager ? ShieldCheck : Eye },
    completed: { label: 'View', icon: Eye },
  };

  const EMPTY_TEXT: Record<StageKey, string> = {
    waiting: 'No cars waiting for installers',
    in_progress: 'No cars being worked on right now',
    approval: isManager ? 'Nothing waiting for your approval' : 'Nothing waiting for approval',
    completed: isManager ? 'No completed cars yet' : "You haven't completed any cars yet",
  };

  const renderCard = ({ job, invoice, vehicle, customer, tintOrder, glass, stage }: JobCard) => {
    const serviceMeta = GARAGE_SERVICE_MAP[invoice.service];
    const timing = getJobTiming(invoice, job, now);
    const urgent = timing.indicators.includes('overdue') || timing.indicators.includes('running_late');
    const installed = glass.filter((g) => g.status === 'installed').length;
    const taken = glass.filter((g) => g.status === 'taken').length;
    const available = glass.filter((g) => g.status === 'pending').length;
    const mine = glass.filter((g) => g.installerId === currentUser?.id).length;
    const installers = [...new Set(glass.map((g) => g.installerId).filter((x): x is string => !!x))]
      .map((id) => nameOf(id) ?? 'Installer');
    const corrections = glass.filter((g) => g.needsCorrection).length;
    const action = STAGE_ACTION[stage];
    return (
      <div
        key={job.id}
        className={`relative overflow-hidden rounded-2xl p-6 bg-white/[0.04] backdrop-blur-xl border shadow-card ${
          urgent ? 'border-red-500/35' : 'border-gold-400/15'
        }`}
      >
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gold-400/10 border border-gold-400/20 flex items-center justify-center text-gold-400 shrink-0">
              <serviceMeta.icon size={18} strokeWidth={1.5} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-white font-semibold text-sm">{invoice.invoiceNumber}</p>
                <JobPriorityBadges timing={timing} />
              </div>
              <p className="text-white/40 text-xs">{serviceMeta.label}</p>
            </div>
          </div>
          {tintOrder && (
            <span className="text-gold-400 font-display text-base font-bold">{formatRM(tintOrder.finalTotal)}</span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm mb-4">
          {vehicle && (
            <div className="flex items-center gap-2.5 text-white/70">
              <Car size={14} className="text-white/30 shrink-0" /> {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.registrationNo}
            </div>
          )}
          {customer && (
            <div className="flex items-center gap-2.5 text-white/70">
              <User size={14} className="text-white/30 shrink-0" /> {customer.name}
            </div>
          )}
          {tintOrder && (
            <div className="flex items-center gap-2.5 text-white/70 sm:col-span-2">
              <Layers size={14} className="text-white/30 shrink-0" />
              {tintOrder.packageType === 'full' ? 'Full Package' : 'Mix & Match'}
              {tintOrder.fullSeries && ` · ${TINT_SERIES_LABEL[tintOrder.fullSeries]}`}
            </div>
          )}

          {/* Team progress across the car's glass */}
          {glass.length > 0 && (
            <div className="sm:col-span-2 flex items-center gap-2 flex-wrap text-xs">
              <span className="text-emerald-400">{installed} installed</span>
              <span className="text-white/20">·</span>
              <span className="text-blue-400">{taken} taken</span>
              <span className="text-white/20">·</span>
              <span className="text-white/60">{available} available</span>
              {mine > 0 && (
                <span className="ml-1 px-2 py-0.5 rounded-full border border-gold-400/40 bg-gold-500/10 text-gold-400 font-medium">
                  You: {mine} glass
                </span>
              )}
              {corrections > 0 && (
                <span className="px-2 py-0.5 rounded-full border border-orange-500/40 bg-orange-500/10 text-orange-400 font-medium">
                  {corrections} need correction
                </span>
              )}
            </div>
          )}
          {installers.length > 0 && (
            <div className="sm:col-span-2 flex items-center gap-2.5 text-white/60 text-xs">
              <Users size={13} className="text-white/30 shrink-0" /> {installers.join(', ')}
            </div>
          )}

          {job.completedAt ? (
            <div className="flex items-center gap-2.5 text-white/70 sm:col-span-2">
              <Clock3 size={14} className="text-white/30 shrink-0" />
              Approved {new Date(job.completedAt).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          ) : (
            <div className="sm:col-span-2 pt-1">
              <JobTimingRows timing={timing} />
            </div>
          )}
        </div>

        <button
          onClick={() => navigate(`/garage/installer/job/${job.id}`)}
          className="w-full flex items-center justify-center gap-2 btn-gold py-2.5 rounded-xl text-sm"
        >
          <action.icon size={15} /> {action.label}
        </button>
      </div>
    );
  };

  return (
    <GarageShell title={`${meta?.label ?? 'Service'} Work Flow`} showBack backTo="/garage/installer">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Team pipeline — one clickable, coloured stage per step */}
        <div className="flex items-start">
          {STAGE_ORDER.map((stage, i) => {
            const cfg = STAGE_CONFIG[stage];
            const isActive = activeStage === stage;
            return (
              <div key={stage} className={i === 0 ? 'flex items-start' : 'flex items-start flex-1'}>
                {i > 0 && <div className="flex-1 h-0.5 mt-7 rounded-full bg-white/10" />}
                <button onClick={() => setActiveStage(stage)} className="flex flex-col items-center gap-2 shrink-0 px-1">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center font-display font-bold text-lg border-2 transition-all duration-200 ${isActive ? cfg.nodeActive : `${cfg.node} hover:opacity-90`}`}>
                    {stageCards(stage).length}
                  </div>
                  <span className={`text-xs font-medium whitespace-nowrap ${isActive ? cfg.text : 'text-white/40'}`}>{cfg.label}</span>
                </button>
              </div>
            );
          })}
        </div>

        <div>
          {loading ? (
            <p className="text-white/40 text-sm text-center py-10">Loading…</p>
          ) : activeCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="relative mb-5 flex items-center justify-center">
                <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl" />
                <ClipboardList size={34} strokeWidth={1.5} className="relative text-gold-400/70" />
              </div>
              <p className="text-white/40 text-sm">{EMPTY_TEXT[activeStage]}</p>
            </div>
          ) : (
            <div className="space-y-4">{activeCards.map(renderCard)}</div>
          )}
        </div>
      </div>
    </GarageShell>
  );
}
