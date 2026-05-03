import { useAnimatedCounter } from './useAnimatedCounter';
import { formatRM } from '../utils/format';

export function useAnimatedRM(target: number, duration = 1400, delay = 0): string {
  const value = useAnimatedCounter(target, duration, delay);
  return formatRM(value);
}
