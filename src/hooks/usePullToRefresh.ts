import { useState, useEffect, useRef } from 'react';

const THRESHOLD = 75;
const MAX_PULL  = 100;
const DAMPEN    = 0.45;

export function usePullToRefresh(
  containerRef: React.RefObject<HTMLElement>,
  onRefresh: () => Promise<void>,
) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startY        = useRef(0);
  const isPulling     = useRef(false);
  const distRef       = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop <= 0 && !refreshingRef.current) {
        startY.current = e.touches[0].clientY;
        isPulling.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPulling.current) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        isPulling.current = false;
        distRef.current = 0;
        setPullDistance(0);
        return;
      }
      const clamped = Math.min(delta * DAMPEN, MAX_PULL);
      distRef.current = clamped;
      setPullDistance(clamped);
      // NOTE: no e.preventDefault() — passive listener so scroll is never blocked.
      // overscroll-behavior-y:none on the container suppresses the browser's
      // native pull-to-refresh without interfering with scroll events.
    };

    const onTouchEnd = () => {
      if (!isPulling.current) return;
      isPulling.current = false;
      const dist = distRef.current;

      if (dist >= THRESHOLD) {
        refreshingRef.current = true;
        setIsRefreshing(true);
        setPullDistance(THRESHOLD);
        onRefresh().finally(() => {
          setTimeout(() => {
            refreshingRef.current = false;
            setIsRefreshing(false);
            setPullDistance(0);
            distRef.current = 0;
          }, 500);
        });
      } else {
        setPullDistance(0);
        distRef.current = 0;
      }
    };

    // ALL passive — never blocks scroll events on this container
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove',  onTouchMove,  { passive: true });
    el.addEventListener('touchend',   onTouchEnd,   { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
    };
  }, [containerRef, onRefresh]);

  return { pullDistance, isRefreshing };
}
