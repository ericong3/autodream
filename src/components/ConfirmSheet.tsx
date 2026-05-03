import { Trash2, AlertTriangle } from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface ConfirmSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning';
}

export default function ConfirmSheet({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Delete',
  variant = 'danger',
}: ConfirmSheetProps) {
  useBodyScrollLock(isOpen);

  if (!isOpen) return null;

  const isDanger = variant === 'danger';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-gradient-to-b from-obsidian-800 to-obsidian-900 border-t border-obsidian-400/60 rounded-t-2xl p-6 shadow-card-lg">
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full bg-obsidian-400/40 mx-auto mb-5" />

        {/* Icon circle */}
        {isDanger ? (
          <div className="bg-red-500/10 border border-red-500/20 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 size={20} className="text-red-400" />
          </div>
        ) : (
          <div className="bg-amber-500/10 border border-amber-500/20 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={20} className="text-amber-400" />
          </div>
        )}

        {/* Title */}
        <p className="text-white font-bold text-lg text-center">{title}</p>

        {/* Message */}
        <p className="text-gray-400 text-sm text-center mt-2 leading-relaxed">{message}</p>

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-3 rounded-xl text-sm font-semibold text-gray-300 border border-obsidian-400/60 bg-obsidian-700/40 hover:bg-obsidian-600/60 transition-colors"
          >
            Cancel
          </button>
          {isDanger ? (
            <button
              onClick={onConfirm}
              className="px-4 py-3 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors"
            >
              {confirmLabel}
            </button>
          ) : (
            <button
              onClick={onConfirm}
              className="px-4 py-3 rounded-xl text-sm font-semibold text-obsidian-950 bg-amber-400 hover:bg-amber-500 transition-colors"
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
