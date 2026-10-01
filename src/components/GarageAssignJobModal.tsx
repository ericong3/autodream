import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { useStore } from '../store';
import { assignInstallerJob, JobAlreadyAcceptedError } from '../lib/garageInstallerJobs';
import { isGarageWorkshopRole } from '../utils/garageRoles';
import type { GarageInstallerJob } from '../types';

// Assign Installer — management gives an unclaimed job to a chosen
// installer (they never accept it as themselves). The installer becomes the
// job's owner and sees it under Assigned; the finish time is optional, the
// installer can still set the pace once they start. Claimed atomically, so
// if an installer accepts it first, onAlreadyAccepted is called instead.
export default function GarageAssignJobModal({
  job, invoiceNumber, onClose, onAssigned, onAlreadyAccepted,
}: {
  job: GarageInstallerJob | null;
  invoiceNumber?: string;
  onClose: () => void;
  onAssigned: (job: GarageInstallerJob) => void;
  onAlreadyAccepted: () => void;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const allUsers = useStore((s) => s.users);
  const installers = useMemo(
    () => allUsers
      .filter((u) => isGarageWorkshopRole(u.role) && (u.businessAccess === 'garage' || u.businessAccess === 'both'))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [allUsers],
  );
  const [installerId, setInstallerId] = useState('');
  const [eta, setEta] = useState(''); // datetime-local, optional
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!job) return;
    setInstallerId('');
    setEta('');
    setError('');
  }, [job?.id]);

  const handleAssign = async () => {
    if (!job || !currentUser) return;
    if (!installerId) { setError('Choose an installer'); return; }
    let etaIso: string | undefined;
    if (eta) {
      const d = new Date(eta);
      if (d.getTime() <= Date.now()) { setError('That finish time has already passed — pick a later one'); return; }
      etaIso = d.toISOString();
    }
    setBusy(true);
    setError('');
    try {
      const assigned = await assignInstallerJob(job.id, installerId, currentUser.id, etaIso);
      onAssigned(assigned);
    } catch (err) {
      if (err instanceof JobAlreadyAcceptedError) { onAlreadyAccepted(); return; }
      setError((err as Error)?.message ?? 'Could not assign the job — please try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={!!job} onClose={() => !busy && onClose()} title="Assign Installer">
      <p className="text-gray-400 text-sm mb-4">
        Give {invoiceNumber ?? 'this job'} to an installer. It moves to their Assigned list and leaves Incoming for everyone else.
      </p>

      <label className="block text-gray-300 text-xs font-medium mb-1.5">Installer</label>
      <select
        value={installerId}
        onChange={(e) => setInstallerId(e.target.value)}
        className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white rounded-lg px-3 py-2 text-sm mb-4
          focus:outline-none focus:border-gold-500 transition-colors"
      >
        <option value="" className="bg-obsidian-900">Select installer</option>
        {installers.map((u) => (
          <option key={u.id} value={u.id} className="bg-obsidian-900">{u.name}</option>
        ))}
      </select>
      {installers.length === 0 && (
        <p className="text-orange-300 text-xs -mt-2 mb-4">No installer accounts found — add one in Team Members.</p>
      )}

      <label className="block text-gray-300 text-xs font-medium mb-1.5">Estimated completion (optional)</label>
      <input
        type="datetime-local"
        value={eta}
        onChange={(e) => setEta(e.target.value)}
        className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white rounded-lg px-3 py-2 text-sm mb-1
          focus:outline-none focus:border-gold-500 transition-colors [color-scheme:dark]"
      />

      {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
      <div className="flex gap-3 mt-5">
        <button onClick={onClose} disabled={busy} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
        <button
          onClick={handleAssign}
          disabled={busy}
          className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-60"
        >
          {busy ? 'Assigning…' : 'Assign Installer'}
        </button>
      </div>
    </Modal>
  );
}
