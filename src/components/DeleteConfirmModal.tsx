import { useState, useEffect } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import Modal from './Modal';
import { useStore } from '../store';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  itemName: string;
}

export default function DeleteConfirmModal({ isOpen, onClose, onConfirm, itemName }: DeleteConfirmModalProps) {
  const currentUser = useStore((s) => s.currentUser);
  const [step, setStep] = useState<1 | 2>(1);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setPassword('');
      setError('');
      setLoading(false);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    if (password !== currentUser?.password) {
      setError('Incorrect password.');
      return;
    }
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirm Delete">
      {step === 1 ? (
        <>
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg shrink-0">
              <AlertTriangle size={18} className="text-red-400" />
            </div>
            <p className="text-gray-300 text-sm leading-relaxed">
              Are you sure you want to delete{' '}
              <span className="text-white font-semibold">{itemName}</span>?{' '}
              This action cannot be undone.
            </p>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={onClose} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">
              Cancel
            </button>
            <button
              onClick={() => setStep(2)}
              className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Proceed
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start gap-3 mb-4">
            <div className="p-2 bg-red-500/10 rounded-lg shrink-0">
              <Lock size={18} className="text-red-400" />
            </div>
            <p className="text-gray-300 text-sm leading-relaxed">
              Enter your password to confirm deleting{' '}
              <span className="text-white font-semibold">{itemName}</span>.
            </p>
          </div>
          <input
            type="password"
            className={`input w-full ${error ? '!border-red-500/50' : ''}`}
            placeholder="Your password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
            autoFocus
          />
          {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
          <div className="flex gap-3 mt-5">
            <button onClick={() => { setStep(1); setPassword(''); setError(''); }} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">
              Back
            </button>
            <button
              onClick={handleConfirm}
              disabled={!password || loading}
              className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
