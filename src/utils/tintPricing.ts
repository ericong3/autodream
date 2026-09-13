import type { TintSeries, GlassPosition, GarageVehicleSize } from '../types';

export const TINT_SERIES: { key: TintSeries; label: string }[] = [
  { key: 'eco', label: 'Eco' },
  { key: 'lite', label: 'Lite' },
  { key: 'classic', label: 'Classic' },
  { key: 'majestic', label: 'Majestic' },
  { key: 'unique', label: 'Unique' },
  { key: 'royal', label: 'Royal' },
];

export const GLASS_POSITIONS: { key: GlassPosition; label: string }[] = [
  { key: 'front_windscreen', label: 'Front Windscreen' },
  { key: 'front_side', label: 'Front Side' },
  { key: 'rear_side', label: 'Rear Side' },
  { key: 'rear_windscreen', label: 'Rear Windscreen' },
];

export const VLT_OPTIONS = ['80%', '70%', '60%', '50%', '40%', '35%', '20%', '5%'];

export const VEHICLE_SIZES: { key: GarageVehicleSize; label: string }[] = [
  { key: 'standard', label: 'Standard' },
  { key: 'large', label: 'Large' },
  { key: 'xlarge', label: 'X-Large' },
];
