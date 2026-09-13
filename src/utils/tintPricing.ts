import type { TintSeries, GlassPosition, ExtraGlassKey, GarageVehicleSize } from '../types';

export const TINT_SERIES: { key: TintSeries; label: string }[] = [
  { key: 'royal', label: 'Royal' },
  { key: 'unique', label: 'Unique' },
  { key: 'majestic', label: 'Majestic' },
  { key: 'classic', label: 'Classic' },
  { key: 'lite', label: 'Lite' },
  { key: 'eco', label: 'Eco' },
];

export const GLASS_POSITIONS: { key: GlassPosition; label: string }[] = [
  { key: 'front_windscreen', label: 'Front Windscreen' },
  { key: 'door_window', label: 'Door Window' },
  { key: 'rear_panel_window', label: 'Rear Panel Window' },
  { key: 'rear_windscreen', label: 'Rear Windscreen' },
];

// Optional add-ons — priced the same as a glass position (series-based, no
// size dimension) but toggled on rather than always part of the set.
export const EXTRA_GLASS_OPTIONS: { key: ExtraGlassKey; label: string; xlargeOnly?: boolean }[] = [
  { key: 'extra_rear_2pc', label: 'Extra Rear Window (2pc)', xlargeOnly: true },
  { key: 'small_window', label: 'Small Window' },
];

export const VLT_OPTIONS = ['70%', '45%', '35%', '20%', '10%'];

export const VEHICLE_SIZES: { key: GarageVehicleSize; label: string }[] = [
  { key: 'standard', label: 'Standard' },
  { key: 'large', label: 'Large' },
  { key: 'xlarge', label: 'X-Large' },
];
