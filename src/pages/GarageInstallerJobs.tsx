import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ClipboardList, Car, User, Layers, CheckCircle2, ArrowRight, Eye, Clock3, Timer,
} from 'lucide-react';
import GarageShell, { isGarageManager } from '../components/GarageShell';
import { useStore } from '../store';
import {
  listPendingInstallerJobs, listAcceptedInstallerJobs, listCompletedInstallerJobs,
} from '../lib/garageInstallerJobs';
import { getGarageInvoice } from '../lib/garageInvoices';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import { getTintOrder } from '../lib/garageTint';
import { GARAGE_SERVICE_MAP } from '../utils/garageServices';
import { getJobTiming } from '../utils/garageJobPriority';
import { JobPriorityBadges, JobTimingRows, useNow } from '../components/GarageJobPriority';
import { TINT_SERIES } from '../utils/tintPricing';
import { formatRM } from '../utils/format';
import type { GarageInstallerJob, GarageInvoice, GarageVehicle, GarageCustomer, GarageTintOrder, GarageService } from '../types';

const TINT_SERIES_LABEL = Object.fromEntries(TINT_SERIES.map((s) => [s.key, s.label]));

// Installer operational pipeline: Incoming → Assigned → In Progress → Completed.
type StageKey = 'pending' | 'assigned' | 'in_progress' | 'completed';
const STAGE_ORDER: StageKey[] = ['pending', 'assigned', 'in_progress', 'completed'];

// Colors mirror the stage badges used elsewhere (My Work Orders, Work
// Order Tracking) — gold for waiting, blue for active work, green for done.
const STAGE_CONFIG: Record<StageKey, { label: string; dot: string; node: string; nodeActive: string; text: string }> = {
  pending: {
    label: 'Incoming',
    dot: 'bg-gold-400',
    node: 'bg-gold-500/15 border-gold-400/40 text-gold-400',
    nodeActive: 'bg-gold-500 border-gold-300 text-obsidian-950 shadow-[0_0_24px_rgba(212,175,55,0.55)]',
    text: 'text-gold-400',
  },
  assigned: {
    label: 'Assigned',
    dot: 'bg-violet-400',
    node: 'bg-violet-500/15 border-violet-400/40 text-violet-300',
    nodeActive: 'bg-violet-500 border-violet-300 text-white shadow-[0_0_24px_rgba(139,92,246,0.55)]',
    text: 'text-violet-300',
  },
  in_progress: {
    label: 'In Progress',
    dot: 'bg-blue-400',
    node: 'bg-blue-500/15 border-blue-400/40 text-blue-400',
    nodeActive: 'bg-blue-500 border-blue-300 text-white shadow-[0_0_24px_rgba(59,130,246,0.55)]',
    text: 'text-blue-400',
  },
  completed: {
    label: 'Completed',
    dot: 'bg-emerald-400',
    node: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-400',
    nodeActive: 'bg-emerald-500 border-emerald-300 text-white shadow-[0_0_24px_rgba(16,185,129,0.55)]',
    text: 'text-emerald-400',
  },
};

interface JobCard {
  job: GarageInstallerJob;
  invoice: GarageInvoice;
  vehicle: GarageVehicle | null;
  customer: GarageCustomer | null;
  tintOrder: GarageTintOrder | null;
}

async function buildCards(jobs: GarageInstallerJob[]): Promise<JobCard[]> {
  const built = await Promise.all(jobs.map(async (job): Promise<JobCard | null> => {
    const invoice = await getGarageInvoice(job.invoiceId);
    if (!invoice) return null;
    const [vehicle, customer, tintOrder] = await Promise.all([
      getGarageVehicle(invoice.vehicleId),
      getGarageCustomer(invoice.customerId),
      invoice.service === 'tinted' ? getTintOrder(invoice.id) : Promise.resolve(null),
    ]);
    return { job, invoice, vehicle, customer, tintOrder };
  }));
  return built.filter((c): c is JobCard => c !== null);
}

// An accepted job is In Progress once its work order is (work_status is the
// lifecycle source of truth — it also covers jobs accepted before Start
// Installation existed, which have no started_at).
function hasStarted({ invoice }: JobCard): boolean {
  return invoice.workStatus === 'in_progress';
}

export default function GarageInstallerJobs() {
  const { service } = useParams<{ service: string }>();
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const [pending, setPending] = useState<JobCard[]>([]);
  const [assigned, setAssigned] = useState<JobCard[]>([]);
  const [inProgress, setInProgress] = useState<JobCard[]>([]);
  const [completed, setCompleted] = useState<JobCard[]>([]);
  const [loading, setLoading] = useState(true);
  // Kept in the URL so accepting a job (or coming back from one) lands on
  // the right tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawStage = searchParams.get('stage');
  // 'accepted' was the old combined tab — older links land on Assigned.
  const stageParam = (rawStage === 'accepted' ? 'assigned' : rawStage) as StageKey | null;
  const activeStage: StageKey = stageParam && stageParam in STAGE_CONFIG ? stageParam : 'pending';
  const setActiveStage = (stage: StageKey) => setSearchParams({ stage }, { replace: true });
  // Installers see unclaimed Incoming jobs plus only their own jobs in the
  // other stages; managers oversee everyone's.
  const isManager = isGarageManager(currentUser?.role);

  const meta = GARAGE_SERVICE_MAP[service as GarageService];

  const load = () => {
    if (!service) return;
    setLoading(true);
    Promise.all([
      listPendingInstallerJobs(service as GarageService),
      listAcceptedInstallerJobs(service as GarageService),
      listCompletedInstallerJobs(service as GarageService),
    ])
      .then(async ([p, a, c]) => {
        const [pCards, aCards, cCards] = await Promise.all([buildCards(p), buildCards(a), buildCards(c)]);
        const mine = (c: JobCard) => isManager || c.job.acceptedBy === currentUser?.id;
        // A completed job is the installer's if they completed it, or if they
        // accepted it — covers older jobs (no completed_by) and jobs a manager
        // pressed Complete on for them. Other installers' jobs stay hidden.
        const mineCompleted = (c: JobCard) => isManager
          || (!!currentUser && (c.job.completedBy === currentUser.id || c.job.acceptedBy === currentUser.id));
        setPending(pCards);
        setAssigned(aCards.filter((c) => mine(c) && !hasStarted(c)));
        setInProgress(aCards.filter((c) => mine(c) && hasStarted(c)));
        setCompleted(cCards.filter(mineCompleted));
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [service, currentUser?.id]);

  const stageJobs: Record<StageKey, JobCard[]> = { pending, assigned, in_progress: inProgress, completed };
  const activeJobs = stageJobs[activeStage];

  const stageLabel = (stage: StageKey) => STAGE_CONFIG[stage].label;
  // Ticks every minute so Upcoming / Due Now / Overdue / Running Late and
  // the "time since" figures stay current on an open screen.
  const now = useNow();

  const renderCard = ({ job, invoice, vehicle, customer, tintOrder }: JobCard, action: { label: string; icon: typeof CheckCircle2; onClick: () => void }) => {
    const meta = GARAGE_SERVICE_MAP[invoice.service];
    // Derived on the fly — never stored, never a status.
    const timing = getJobTiming(invoice, job, now);
    const urgent = timing.indicators.includes('overdue') || timing.indicators.includes('running_late');
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
              <meta.icon size={18} strokeWidth={1.5} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-white font-semibold text-sm">{invoice.invoiceNumber}</p>
                <JobPriorityBadges timing={timing} />
              </div>
              <p className="text-white/40 text-xs">{meta.label}</p>
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
          {job.status === 'accepted' && invoice.workStatus !== 'in_progress' && !job.startedAt && (
            <div className="flex items-center gap-2.5 text-violet-300 sm:col-span-2">
              <Timer size={14} className="text-white/30 shrink-0" /> Assigned · not started yet
            </div>
          )}
          {job.completedAt ? (
            <div className="flex items-center gap-2.5 text-white/70 sm:col-span-2">
              <Clock3 size={14} className="text-white/30 shrink-0" />
              Completed {new Date(job.completedAt).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          ) : (
            <div className="sm:col-span-2 pt-1">
              <JobTimingRows timing={timing} />
            </div>
          )}
        </div>

        <button
          onClick={action.onClick}
          className="w-full flex items-center justify-center gap-2 btn-gold py-2.5 rounded-xl text-sm"
        >
          <action.icon size={15} /> {action.label}
        </button>
      </div>
    );
  };


  // Every card opens the job page — incoming jobs are reviewed there before
  // accepting, assigned ones started there.
  const STAGE_ACTION: Record<StageKey, { label: string; icon: typeof CheckCircle2 }> = {
    pending: { label: 'View & Accept', icon: CheckCircle2 },
    assigned: { label: 'View & Start', icon: ArrowRight },
    in_progress: { label: 'Continue Job', icon: ArrowRight },
    completed: { label: 'View', icon: Eye },
  };
  const stageAction = (stage: StageKey, card: JobCard) => ({
    ...STAGE_ACTION[stage],
    ...(stage === 'pending' && isManager ? { label: 'View & Assign' } : {}),
    onClick: () => navigate(`/garage/installer/job/${card.job.id}`),
  });

  const EMPTY_TEXT: Record<StageKey, string> = isManager
    ? {
        pending: 'No jobs waiting for an installer',
        assigned: 'No assigned jobs waiting to start',
        in_progress: 'No jobs in progress',
        completed: 'No completed jobs yet',
      }
    : {
        pending: 'No jobs waiting right now',
        assigned: "You've no accepted jobs waiting to start",
        in_progress: "You've no jobs in progress",
        completed: "You haven't completed any jobs yet",
      };

  return (
    <GarageShell title={`${meta?.label ?? 'Service'} Work Flow`} showBack backTo="/garage/installer">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Pipeline — one clickable, coloured stage per step */}
        <div className="flex items-start">
          {STAGE_ORDER.map((stage, i) => {
            const cfg = STAGE_CONFIG[stage];
            const isActive = activeStage === stage;
            return (
              <div key={stage} className={i === 0 ? 'flex items-start' : 'flex items-start flex-1'}>
                {i > 0 && (
                  <div className="flex-1 h-0.5 mt-7 rounded-full bg-white/10" />
                )}
                <button
                  onClick={() => setActiveStage(stage)}
                  className="flex flex-col items-center gap-2 shrink-0 px-1"
                >
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center font-display font-bold text-lg border-2 transition-all duration-200 ${isActive ? cfg.nodeActive : `${cfg.node} hover:opacity-90`}`}>
                    {stageJobs[stage].length}
                  </div>
                  <span className={`text-xs font-medium whitespace-nowrap ${isActive ? cfg.text : 'text-white/40'}`}>{stageLabel(stage)}</span>
                </button>
              </div>
            );
          })}
        </div>

        <div>
          {loading ? (
            <p className="text-white/40 text-sm text-center py-10">Loading…</p>
          ) : activeJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="relative mb-5 flex items-center justify-center">
                <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl" />
                <ClipboardList size={34} strokeWidth={1.5} className="relative text-gold-400/70" />
              </div>
              <p className="text-white/40 text-sm">{EMPTY_TEXT[activeStage]}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeJobs.map((c) => renderCard(c, stageAction(activeStage, c)))}
            </div>
          )}
        </div>
      </div>

    </GarageShell>
  );
}
