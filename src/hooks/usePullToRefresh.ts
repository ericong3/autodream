import { useState, useEffect, useRef } from 'react';

const THRESHOLD = 75;   // px of pull required to trigger refresh
const MAX_PULL  = 100;  // px cap on how far the indicator stretches
const DAMPEN    = 0.45; // resistance factor so it feels heavy/natural

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
      // prevent the browser from scrolling upward while we're doing PTR
      if (delta > 8) e.preventDefault();
    };

    const onTouchEnd = () => {
      if (!isPulling.current) return;
      isPulling.current = false;
      const dist = distRef.current;

      if (dist >= THRESHOLD) {
        refreshingRef.current = true;
        setIsRefreshing(true);
        setPullDistance(THRESHOLD); // snap to a steady refresh height
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

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove',  onTouchMove,  { passive: false });
    el.addEventListener('touchend',   onTouchEnd,   { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
    };
  }, [containerRef, onRefresh]);

  return { pullDistance, isRefreshing };
}
