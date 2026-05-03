import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface LightboxProps {
  images: string[];
  initialIndex?: number;
  isOpen: boolean;
  onClose: () => void;
}

export default function Lightbox({
  images,
  initialIndex = 0,
  isOpen,
  onClose,
}: LightboxProps) {
  const [current, setCurrent] = useState(initialIndex);

  // Sync external initialIndex changes when the lightbox (re-)opens
  useEffect(() => {
    if (isOpen) setCurrent(initialIndex);
  }, [isOpen, initialIndex]);

  const total = images.length;

  const prev = useCallback(() => {
    setCurrent(c => (c - 1 + total) % total);
  }, [total]);

  const next = useCallback(() => {
    setCurrent(c => (c + 1) % total);
  }, [total]);

  // ─── Keyboard navigation ────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); prev(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      if (e.key === 'Escape')     { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, prev, next, onClose]);

  // ─── Touch swipe ────────────────────────────────────────────────────────
  const touchStartX = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(delta) >= 50) {
      delta > 0 ? next() : prev();
    }
    touchStartX.current = null;
  };

  if (!isOpen || total === 0) return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/95 z-[90] flex flex-col"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-white/60 text-sm font-medium tabular-nums select-none">
          {current + 1} / {total}
        </span>
        <button
          onClick={onClose}
          aria-label="Close lightbox"
          className="w-9 h-9 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Main image area ──────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden p-4">
        <img
          key={current}
          src={images[current]}
          alt={`Image ${current + 1} of ${total}`}
          className="max-w-full max-h-full object-contain select-none rounded-lg"
          draggable={false}
        />

        {/* Left arrow */}
        {total > 1 && (
          <button
            onClick={prev}
            aria-label="Previous image"
            className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 border border-white/10 flex items-center justify-center text-white hover:bg-black/80 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {/* Right arrow */}
        {total > 1 && (
          <button
            onClick={next}
            aria-label="Next image"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 border border-white/10 flex items-center justify-center text-white hover:bg-black/80 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* ── Thumbnail strip ──────────────────────────────────────────────── */}
      {total > 1 && (
        <div className="flex gap-2 p-3 overflow-x-auto justify-center shrink-0 scrollbar-none">
          {images.map((src, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`Go to image ${i + 1}`}
              className="shrink-0 focus:outline-none"
            >
              <img
                src={src}
                alt={`Thumbnail ${i + 1}`}
                className={[
                  'w-14 h-10 rounded-lg object-cover cursor-pointer border-2 transition-all',
                  i === current
                    ? 'border-gold-400 opacity-100'
                    : 'border-transparent opacity-60 hover:opacity-80',
                ].join(' ')}
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
