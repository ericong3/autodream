import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ClipboardList, Car, User, Layers, CheckCircle2, ArrowRight, Eye, Clock3, CalendarClock,
} from 'lucide-react';
import GarageShell from '../components/GarageShell';
import Modal from '../components/Modal';
import DayTimelinePicker from '../components/DayTimelinePicker';
import { useStore } from '../store';
import {
  listPendingInstallerJobs, listAcceptedInstallerJobs, listCompletedInstallerJobs, acceptInstallerJob,
} from '../lib/garageInstallerJobs';
import { getGarageInvoice } from '../lib/garageInvoices';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import { getTintOrder } from '../lib/garageTint';
import { GARAGE_SERVICE_MAP } from '../utils/garageServices';
import { TINT_SERIES } from '../utils/tintPricing';
import { formatRM } from '../utils/format';
import type { GarageInstallerJob, GarageInvoice, GarageVehicle, GarageCustomer, GarageTintOrder, GarageService } from '../types';

const TINT_SERIES_LABEL = Object.fromEntries(TINT_SERIES.map((s) => [s.key, s.label]));

type StageKey = 'pending' | 'accepted' | 'completed';

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
  accepted: {
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

// Car tint jobs are same-day work — accepted before 3pm means done today,
// no date to pick. Accepted at/after 3pm, the installer can choose to bring
// it forward to tomorrow instead of committing to finishing today.
const CUTOFF_HOUR = 15;

function isSameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }

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

export default function GarageInstallerJobs() {
  const { service } = useParams<{ service: string }>();
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const [pending, setPending] = useState<JobCard[]>([]);
  const [accepted, setAccepted] = useState<JobCard[]>([]);
  const [completed, setCompleted] = useState<JobCard[]>([]);
  const [activeStage, setActiveStage] = useState<StageKey>('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [acceptTarget, setAcceptTarget] = useState<JobCard | null>(null);
  const [estimateTime, setEstimateTime] = useState('');
  const [bringForward, setBringForward] = useState(false);
  const [pastCutoff, setPastCutoff] = useState(false);
  const [estimateError, setEstimateError] = useState('');

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
        setPending(pCards);
        setAccepted(aCards);
        setCompleted(cCards);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [service]);

  const stageJobs: Record<StageKey, JobCard[]> = { pending, accepted, completed };
  const activeJobs = stageJobs[activeStage];

  const openAcceptModal = (card: JobCard) => {
    setEstimateTime('');
    setBringForward(false);
    setPastCutoff(new Date().getHours() >= CUTOFF_HOUR);
    setEstimateError('');
    setAcceptTarget(card);
  };

  const handleConfirmAccept = async () => {
    if (!currentUser || !acceptTarget) return;
    if (!estimateTime) { setEstimateError('Enter an estimated completion time'); return; }
    const [h, m] = estimateTime.split(':').map(Number);
    const target = new Date();
    if (bringForward) target.setDate(target.getDate() + 1);
    target.setHours(h, m, 0, 0);
    setBusyId(acceptTarget.job.id);
    try {
      await acceptInstallerJob(acceptTarget.job.id, currentUser.id, target.toISOString());
      setAcceptTarget(null);
      load();
    } finally {
      setBusyId(null);
    }
  };

  // This installer's own already-accepted jobs landing on the target day —
  // shown as context markers on the timeline so they can see their existing
  // workload while picking a new completion time.
  const timelineMarkers = useMemo(() => {
    if (!currentUser) return [];
    const target = new Date();
    if (bringForward) target.setDate(target.getDate() + 1);
    return accepted
      .filter((c) => c.job.acceptedBy === currentUser.id && c.job.estimatedCompleteAt)
      .map((c) => ({ id: c.job.id, time: new Date(c.job.estimatedCompleteAt!), label: c.invoice.invoiceNumber }))
      .filter((m) => isSameDay(m.time, target));
  }, [accepted, currentUser, bringForward]);

  const renderCard = ({ job, invoice, vehicle, customer, tintOrder }: JobCard, action: { label: string; busyLabel: string; icon: typeof CheckCircle2; onClick: () => void }) => {
    const meta = GARAGE_SERVICE_MAP[invoice.service];
    return (
      <div
        key={job.id}
        className="relative overflow-hidden rounded-2xl p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card"
      >
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gold-400/10 border border-gold-400/20 flex items-center justify-center text-gold-400 shrink-0">
              <meta.icon size={18} strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-white font-semibold text-sm">{invoice.invoiceNumber}</p>
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
          {job.completedAt ? (
            <div className="flex items-center gap-2.5 text-white/70 sm:col-span-2">
              <Clock3 size={14} className="text-white/30 shrink-0" />
              Completed {new Date(job.completedAt).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          ) : job.estimatedCompleteAt && (
            <div className="flex items-center gap-2.5 text-white/70 sm:col-span-2">
              <Clock3 size={14} className="text-white/30 shrink-0" />
              Est. complete {new Date(job.estimatedCompleteAt).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          )}
        </div>

        <button
          onClick={action.onClick}
          disabled={busyId === job.id}
          className="w-full flex items-center justify-center gap-2 btn-gold py-2.5 rounded-xl text-sm disabled:opacity-60"
        >
          <action.icon size={15} /> {busyId === job.id ? action.busyLabel : action.label}
        </button>
      </div>
    );
  };

  const STAGE_ORDER: StageKey[] = ['pending', 'accepted', 'completed'];

  const stageAction = (stage: StageKey, card: JobCard): { label: string; busyLabel: string; icon: typeof CheckCircle2; onClick: () => void } => {
    if (stage === 'pending') return { label: 'Accept Job', busyLabel: 'Accepting…', icon: CheckCircle2, onClick: () => openAcceptModal(card) };
    if (stage === 'accepted') return { label: 'View & Complete', busyLabel: '', icon: ArrowRight, onClick: () => navigate(`/garage/installer/job/${card.job.id}`) };
    return { label: 'View', busyLabel: '', icon: Eye, onClick: () => navigate(`/garage/installer/job/${card.job.id}`) };
  };

  const EMPTY_TEXT: Record<StageKey, string> = {
    pending: 'No jobs waiting right now',
    accepted: 'Nothing in progress right now',
    completed: 'Nothing completed yet',
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
                  <span className={`text-xs font-medium whitespace-nowrap ${isActive ? cfg.text : 'text-white/40'}`}>{cfg.label}</span>
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

      <Modal isOpen={!!acceptTarget} onClose={() => setAcceptTarget(null)} title="Accept Job">
        <p className="text-gray-400 text-sm mb-4">
          {meta?.label ?? 'This'} jobs are completed the same day — what time will {acceptTarget?.invoice.invoiceNumber} be done {bringForward ? 'tomorrow' : 'today'}?
        </p>

        {pastCutoff && (
          <button
            type="button"
            onClick={() => setBringForward((v) => !v)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border mb-4 transition-colors ${
              bringForward
                ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                : 'bg-white/[0.03] border-white/10 text-white/60 hover:text-white/90 hover:border-white/20'
            }`}
          >
            <CalendarClock size={15} /> {bringForward ? 'Bringing Forward to Next Day' : 'Bring Forward to Next Day'}
          </button>
        )}

        <label className="block text-gray-300 text-xs font-medium mb-1.5">
          Estimated Completion Time {bringForward ? '(tomorrow)' : '(today)'}
        </label>
        <DayTimelinePicker value={estimateTime} onChange={setEstimateTime} markers={timelineMarkers} />
        {estimateError && <p className="text-red-400 text-xs mt-2">{estimateError}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={() => setAcceptTarget(null)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button
            onClick={handleConfirmAccept}
            disabled={busyId === acceptTarget?.job.id}
            className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-60"
          >
            {busyId === acceptTarget?.job.id ? 'Accepting…' : 'Accept Job'}
          </button>
        </div>
      </Modal>
    </GarageShell>
  );
}
