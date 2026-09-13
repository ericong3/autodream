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
