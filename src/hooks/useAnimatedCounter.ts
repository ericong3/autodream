import { useState, useEffect, useRef } from 'react';

export function useAnimatedCounter(target: number, duration = 1200, delay = 0) {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const animate = (timestamp: number) => {
        if (!startRef.current) startRef.current = timestamp;
        const elapsed = timestamp - startRef.current;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(target * eased));
        if (progress < 1) rafRef.current = requestAnimationFrame(animate);
        else setValue(target);
      };
      rafRef.current = requestAnimationFrame(animate);
    }, delay);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(rafRef.current);
      startRef.current = null;
    };
  }, [target, duration, delay]);

  return value;
}
