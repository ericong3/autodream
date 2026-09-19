import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Car, User, Layers, CheckCircle2, Wrench, Clock3, CalendarClock } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import Modal from '../components/Modal';
import DayTimelinePicker from '../components/DayTimelinePicker';
import { useStore } from '../store';
import { listPendingInstallerJobs, listAcceptedInstallerJobs, acceptInstallerJob, completeInstallerJob } from '../lib/garageInstallerJobs';
import { getGarageInvoice } from '../lib/garageInvoices';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import { getTintOrder } from '../lib/garageTint';
import { GARAGE_SERVICE_MAP } from '../utils/garageServices';
import { TINT_SERIES } from '../utils/tintPricing';
import { formatRM } from '../utils/format';
import type { GarageInstallerJob, GarageInvoice, GarageVehicle, GarageCustomer, GarageTintOrder } from '../types';

const TINT_SERIES_LABEL = Object.fromEntries(TINT_SERIES.map((s) => [s.key, s.label]));

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
  const currentUser = useStore((s) => s.currentUser);
  const [pending, setPending] = useState<JobCard[]>([]);
  const [accepted, setAccepted] = useState<JobCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [acceptTarget, setAcceptTarget] = useState<JobCard | null>(null);
  const [estimateTime, setEstimateTime] = useState('');
  const [bringForward, setBringForward] = useState(false);
  const [pastCutoff, setPastCutoff] = useState(false);
  const [estimateError, setEstimateError] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([listPendingInstallerJobs(), listAcceptedInstallerJobs()])
      .then(async ([p, a]) => {
        const [pCards, aCards] = await Promise.all([buildCards(p), buildCards(a)]);
        setPending(pCards);
        setAccepted(aCards);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

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

  const handleComplete = async (jobId: string) => {
    setBusyId(jobId);
    try {
      await completeInstallerJob(jobId);
      setAccepted((prev) => prev.filter((c) => c.job.id !== jobId));
    } finally {
      setBusyId(null);
    }
  };

  const renderCard = ({ job, invoice, vehicle, customer, tintOrder }: JobCard, action: { label: string; busyLabel: string; onClick: () => void }) => {
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
          {job.estimatedCompleteAt && (
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
          <CheckCircle2 size={15} /> {busyId === job.id ? action.busyLabel : action.label}
        </button>
      </div>
    );
  };

  return (
    <GarageShell title="Job Queue" showBack>
      <div className="max-w-2xl mx-auto space-y-10">
        <div>
          <div className="flex items-center gap-2.5 mb-6">
            <ClipboardList size={18} className="text-gold-400" />
            <h2 className="font-display text-lg text-white font-semibold tracking-wide">Incoming Orders</h2>
          </div>

          {loading ? (
            <p className="text-white/40 text-sm text-center py-10">Loading…</p>
          ) : pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="relative mb-5 flex items-center justify-center">
                <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl" />
                <ClipboardList size={34} strokeWidth={1.5} className="relative text-gold-400/70" />
              </div>
              <p className="text-white/40 text-sm">No jobs waiting right now</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pending.map((c) => renderCard(c, {
                label: 'Accept Job', busyLabel: 'Accepting…', onClick: () => openAcceptModal(c),
              }))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2.5 mb-6">
            <Wrench size={18} className="text-gold-400" />
            <h2 className="font-display text-lg text-white font-semibold tracking-wide">In Progress</h2>
          </div>

          {!loading && accepted.length === 0 ? (
            <p className="text-white/30 text-sm text-center py-10">Nothing accepted yet</p>
          ) : (
            <div className="space-y-4">
              {accepted.map((c) => renderCard(c, {
                label: 'Mark Complete', busyLabel: 'Marking…', onClick: () => handleComplete(c.job.id),
              }))}
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={!!acceptTarget} onClose={() => setAcceptTarget(null)} title="Accept Job">
        <p className="text-gray-400 text-sm mb-4">
          Tint jobs are completed the same day — what time will {acceptTarget?.invoice.invoiceNumber} be done {bringForward ? 'tomorrow' : 'today'}?
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
