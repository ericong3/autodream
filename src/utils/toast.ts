type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

type Listener = (toasts: ToastMessage[]) => void;

let toasts: ToastMessage[] = [];
const listeners = new Set<Listener>();

const notify = () => listeners.forEach(l => l([...toasts]));

function add(type: ToastType, message: string) {
  const id = Math.random().toString(36).slice(2);
  toasts = [...toasts, { id, type, message }];
  notify();
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id);
    notify();
  }, 3500);
}

export const toast = {
  success: (message: string) => add('success', message),
  error:   (message: string) => add('error', message),
  info:    (message: string) => add('info', message),
  warning: (message: string) => add('warning', message),
  subscribe: (fn: Listener) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
