import React from 'react';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export default function Modal({ isOpen, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
  useBodyScrollLock(isOpen);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className={`relative w-full ${maxWidth} flex flex-col
          glass-panel
          shadow-card-lg
          rounded-xl overflow-hidden`}>

          {/* Gold top accent line */}
          <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl bg-gold-gradient opacity-80" />

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4
            border-b border-gold-500/10 shrink-0
            bg-gradient-to-r from-white/[0.03] to-transparent">
            <h2 className="font-display text-white font-semibold text-sm tracking-wide">{title}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-obsidian-500/60 transition-colors"
            >
              <X size={17} />
            </button>
          </div>

          <div className="p-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
