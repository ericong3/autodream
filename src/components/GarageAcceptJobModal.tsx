import { useEffect, useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import Modal from './Modal';
import DayTimelinePicker from './DayTimelinePicker';
import { useStore } from '../store';
import { acceptInstallerJob, listAcceptedInstallerJobs, JobAlreadyAcceptedError } from '../lib/garageInstallerJobs';
import { getGarageInvoice } from '../lib/garageInvoices';
import type { GarageInstallerJob } from '../types';

// Car tint jobs are same-day work — accepted before 3pm means done today,
// no date to pick. Accepted at/after 3pm, the installer can choose to bring
// it forward to tomorrow instead of committing to finishing today.
const CUTOFF_HOUR = 15;

function isSameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }

// Accept Job — the installer commits to an estimated finish time, then the
// job is claimed for them atomically (see acceptInstallerJob). If another
// installer got there first, onAlreadyAccepted is called instead.
export default function GarageAcceptJobModal({
  job, invoiceNumber, serviceLabel, onClose, onAccepted, onAlreadyAccepted,
}: {
  job: GarageInstallerJob | null;
  invoiceNumber?: string;
  serviceLabel: string;
  onClose: () => void;
  onAccepted: (job: GarageInstallerJob) => void;
  onAlreadyAccepted: () => void;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const [estimateTime, setEstimateTime] = useState('');
  const [bringForward, setBringForward] = useState(false);
  const [pastCutoff, setPastCutoff] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // This installer's own already-accepted jobs — shown on the timeline so
  // they can see their existing workload while picking a finish time.
  const [myJobs, setMyJobs] = useState<{ id: string; time: Date; label: string }[]>([]);

  useEffect(() => {
    if (!job) return;
    setEstimateTime('');
    setBringForward(false);
    setPastCutoff(new Date().getHours() >= CUTOFF_HOUR);
    setError('');
    if (!currentUser) return;
    listAcceptedInstallerJobs(job.service)
      .then((jobs) => Promise.all(
        jobs
          .filter((j) => j.acceptedBy === currentUser.id && j.estimatedCompleteAt)
          .map(async (j) => ({
            id: j.id,
            time: new Date(j.estimatedCompleteAt!),
            label: (await getGarageInvoice(j.invoiceId))?.invoiceNumber ?? '',
          })),
      ))
      .then(setMyJobs)
      .catch(() => setMyJobs([]));
  }, [job?.id]);

  const timelineMarkers = useMemo(() => {
    const target = new Date();
    if (bringForward) target.setDate(target.getDate() + 1);
    return myJobs.filter((m) => isSameDay(m.time, target));
  }, [myJobs, bringForward]);

  const handleConfirm = async () => {
    if (!currentUser || !job) return;
    if (!estimateTime) { setError('Enter an estimated completion time'); return; }
    const [h, m] = estimateTime.split(':').map(Number);
    const target = new Date();
    if (bringForward) target.setDate(target.getDate() + 1);
    target.setHours(h, m, 0, 0);
    // A finish time that's already gone by means nothing to the salesman or
    // customer — e.g. picking 7:00 at 11pm without bringing it forward.
    if (target.getTime() <= Date.now()) {
      setError(bringForward || !pastCutoff
        ? 'That time has already passed — pick a later time'
        : 'That time has already passed today — pick a later time, or bring it forward to tomorrow');
      return;
    }
    setBusy(true);
    try {
      const accepted = await acceptInstallerJob(job.id, currentUser.id, target.toISOString());
      onAccepted(accepted);
    } catch (err) {
      if (err instanceof JobAlreadyAcceptedError) { onAlreadyAccepted(); return; }
      setError((err as Error)?.message ?? 'Could not accept the job — please try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={!!job} onClose={onClose} title="Accept Job">
      <p className="text-gray-400 text-sm mb-4">
        {serviceLabel} jobs are completed the same day — what time will {invoiceNumber} be done {bringForward ? 'tomorrow' : 'today'}?
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
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      <div className="flex gap-3 mt-5">
        <button onClick={onClose} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
        <button
          onClick={handleConfirm}
          disabled={busy}
          className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-60"
        >
          {busy ? 'Accepting…' : 'Accept Job'}
        </button>
      </div>
    </Modal>
  );
}
