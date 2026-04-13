import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export default function Modal({ isOpen, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose} />

      <div className={`relative w-full ${maxWidth} flex flex-col
        bg-gradient-to-b from-obsidian-700 to-obsidian-800
        border border-obsidian-400/80
        shadow-[0_20px_80px_rgba(0,0,0,0.8),0_0_0_1px_rgba(42,35,22,0.8)]
        rounded-xl
        max-h-[90vh] overflow-hidden`}>

        {/* Gold top accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl
          bg-gold-gradient opacity-80" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4
          border-b border-obsidian-400/60 shrink-0
          bg-gradient-to-r from-obsidian-600/50 to-transparent">
          <h2 className="font-display text-white font-semibold text-sm tracking-wide">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white
              hover:bg-obsidian-500/60 transition-colors"
          >
            <X size={17} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 flex-1 pb-safe">{children}</div>
      </div>
    </div>
  );
}
