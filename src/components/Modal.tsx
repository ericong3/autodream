import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

export default function Modal({ isOpen, onClose, title, children, footer, maxWidth = 'max-w-lg' }: ModalProps) {
  useBodyScrollLock(isOpen);
  if (!isOpen) return null;

  // Portal to document.body so no ancestor transform can break position:fixed
  return createPortal(
    <div className="fixed inset-0 z-[500] overscroll-contain">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 modal-backdrop" onClick={onClose} />

      {/* Mobile: bottom sheet — Desktop: centered */}
      <div className="absolute inset-0 flex items-end sm:items-center justify-center sm:p-4 pointer-events-none"
        style={{ paddingTop: 'env(safe-area-inset-top, 44px)' }}>
        <div className={`relative w-full ${maxWidth} flex flex-col glass-panel shadow-card-lg
          rounded-t-2xl sm:rounded-xl overflow-hidden modal-enter pointer-events-auto transition-all duration-200`}>

          {/* Gold top accent */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gold-gradient opacity-80" />

          {/* Drag handle — mobile only */}
          <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-obsidian-400/40" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gold-500/10 shrink-0 bg-gradient-to-r from-white/[0.03] to-transparent">
            <h2 className="font-display text-white font-semibold text-sm tracking-wide">{title}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-obsidian-500/60 transition-colors"
            >
              <X size={17} />
            </button>
          </div>

          {/* Scrollable body */}
          <div
            className="p-5 overflow-y-auto max-h-[75vh] sm:max-h-[85vh]"
            style={{ paddingBottom: footer ? '1.25rem' : 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
          >
            {children}
          </div>

          {/* Sticky footer — buttons always visible, never buried under scroll */}
          {footer && (
            <div
              className="px-5 pt-3 pb-5 border-t border-obsidian-500/30 shrink-0 bg-obsidian-800/60"
              style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
