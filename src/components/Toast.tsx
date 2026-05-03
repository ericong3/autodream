/*
 * Toast notification system — subscribes to src/utils/toast.ts event bus.
 *
 * Add the following to src/index.css so the slide-in animation works:
 *
 * @keyframes toast-in {
 *   from { transform: translateX(110%); opacity: 0; }
 *   to   { transform: translateX(0);    opacity: 1; }
 * }
 * .toast-enter { animation: toast-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
 *
 * Usage: place <ToastContainer /> once, near the root of your app (e.g. in App.tsx).
 * Then call toast.success('Done!') / toast.error('Oops') from anywhere.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  XCircle,
  Info,
  AlertTriangle,
  X,
} from 'lucide-react';
import { toast, type ToastMessage } from '../utils/toast';

// ─── Per-toast item ──────────────────────────────────────────────────────────

const TYPE_STYLES: Record<ToastMessage['type'], string> = {
  success: 'bg-emerald-900/80 border-emerald-500/30 text-emerald-100',
  error:   'bg-red-900/80 border-red-500/30 text-red-100',
  info:    'bg-obsidian-800/90 border-gold-500/20 text-white',
  warning: 'bg-amber-900/80 border-amber-500/30 text-amber-100',
};

const TYPE_ICON_STYLES: Record<ToastMessage['type'], string> = {
  success: 'text-emerald-400',
  error:   'text-red-400',
  info:    'text-gold-400',
  warning: 'text-amber-400',
};

function ToastIcon({ type }: { type: ToastMessage['type'] }) {
  const cls = `w-4 h-4 shrink-0 ${TYPE_ICON_STYLES[type]}`;
  switch (type) {
    case 'success': return <CheckCircle2 className={cls} />;
    case 'error':   return <XCircle className={cls} />;
    case 'info':    return <Info className={cls} />;
    case 'warning': return <AlertTriangle className={cls} />;
  }
}

interface ToastItemProps {
  item: ToastMessage;
  onDismiss: (id: string) => void;
}

function ToastItem({ item, onDismiss }: ToastItemProps) {
  return (
    <div
      className={[
        'toast-enter',
        'pointer-events-auto flex items-center gap-3 px-4 py-3',
        'rounded-xl border shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
        'backdrop-blur-md min-w-[280px] max-w-[360px]',
        TYPE_STYLES[item.type],
      ].join(' ')}
      role="alert"
    >
      <ToastIcon type={item.type} />

      <p className="text-sm font-medium flex-1 leading-snug">{item.message}</p>

      <button
        onClick={() => onDismiss(item.id)}
        className="ml-1 opacity-60 hover:opacity-100 transition-opacity shrink-0"
        aria-label="Dismiss notification"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Container — mount once near the root of your app ───────────────────────

export default function ToastContainer() {
  const [items, setItems] = useState<ToastMessage[]>([]);

  useEffect(() => {
    // Subscribe to the module-level toast event bus
    const unsubscribe = toast.subscribe(setItems);
    return unsubscribe;
  }, []);

  // Allow early manual dismissal
  const dismiss = (id: string) => {
    setItems(prev => prev.filter(t => t.id !== id));
  };

  if (items.length === 0) return null;

  return createPortal(
    <div
      className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map(item => (
        <ToastItem key={item.id} item={item} onDismiss={dismiss} />
      ))}
    </div>,
    document.body,
  );
}
