import { Layers, Sparkles, Shield, SprayCan } from 'lucide-react';
import type { GarageService } from '../types';

export const GARAGE_SERVICES: { key: GarageService; label: string; icon: typeof Layers }[] = [
  { key: 'tinted', label: 'Tinted', icon: Layers },
  { key: 'coating', label: 'Coating', icon: Sparkles },
  { key: 'ppf', label: 'PPF', icon: Shield },
  { key: 'spray', label: 'Spray', icon: SprayCan },
];

export const GARAGE_SERVICE_MAP: Record<GarageService, { label: string; icon: typeof Layers }> =
  Object.fromEntries(GARAGE_SERVICES.map((s) => [s.key, s])) as unknown as Record<GarageService, { label: string; icon: typeof Layers }>;

// Color coding for the Garage calendar (Google Calendar style) — one color
// per service so a week/day full of appointments is scannable at a glance.
export const GARAGE_SERVICE_COLOR: Record<GarageService, { bg: string; border: string; text: string; dot: string }> = {
  tinted: { bg: 'bg-blue-500/25', border: 'border-blue-400/50', text: 'text-blue-100', dot: 'bg-blue-400' },
  coating: { bg: 'bg-emerald-500/25', border: 'border-emerald-400/50', text: 'text-emerald-100', dot: 'bg-emerald-400' },
  ppf: { bg: 'bg-amber-500/25', border: 'border-amber-400/50', text: 'text-amber-100', dot: 'bg-amber-400' },
  spray: { bg: 'bg-orange-500/25', border: 'border-orange-400/50', text: 'text-orange-100', dot: 'bg-orange-400' },
};
