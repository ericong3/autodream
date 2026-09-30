import type {
  TintSeries, GlassPosition, ExtraGlassKey, GarageVehicleSize, TintPriceGroup, TintGlassKey,
  TintPositionSelection,
} from '../types';

export const TINT_SERIES: { key: TintSeries; label: string }[] = [
  { key: 'royal', label: 'Royal' },
  { key: 'unique', label: 'Unique' },
  { key: 'majestic', label: 'Majestic' },
  { key: 'classic', label: 'Classic' },
  { key: 'lite', label: 'Lite' },
  { key: 'eco', label: 'Eco' },
];

// One individual piece of glass. priceGroup is the Mix & Match price-grid
// row it bills at (per window); zone drives Full Package's "Front & Rear"
// VLT shortcut.
export interface GlassPositionDef {
  key: GlassPosition;
  label: string;
  priceGroup: TintPriceGroup;
  zone: 'front' | 'rear';
}

const GLASS_DEFS: Record<GlassPosition, GlassPositionDef> = {
  front_windscreen:        { key: 'front_windscreen',        label: 'Front Windscreen',        priceGroup: 'front_windscreen',  zone: 'front' },
  front_left_window:       { key: 'front_left_window',       label: 'Front Left Window',       priceGroup: 'door_window',       zone: 'front' },
  front_right_window:      { key: 'front_right_window',      label: 'Front Right Window',      priceGroup: 'door_window',       zone: 'front' },
  rear_left_window:        { key: 'rear_left_window',        label: 'Rear Left Window',        priceGroup: 'door_window',       zone: 'rear' },
  rear_right_window:       { key: 'rear_right_window',       label: 'Rear Right Window',       priceGroup: 'door_window',       zone: 'rear' },
  rear_left_panel_window:  { key: 'rear_left_panel_window',  label: 'Rear Left Panel Window',  priceGroup: 'rear_panel_window', zone: 'rear' },
  rear_right_panel_window: { key: 'rear_right_panel_window', label: 'Rear Right Panel Window', priceGroup: 'rear_panel_window', zone: 'rear' },
  rear_windscreen:         { key: 'rear_windscreen',         label: 'Rear Windscreen',         priceGroup: 'rear_windscreen',   zone: 'rear' },
};

const STANDARD_GLASS_LAYOUT: GlassPositionDef[] = [
  GLASS_DEFS.front_windscreen,
  GLASS_DEFS.front_left_window,
  GLASS_DEFS.front_right_window,
  GLASS_DEFS.rear_left_window,
  GLASS_DEFS.rear_right_window,
  GLASS_DEFS.rear_left_panel_window,
  GLASS_DEFS.rear_right_panel_window,
  GLASS_DEFS.rear_windscreen,
];

// Glass layout per vehicle size. Every size shares the standard 8-piece
// layout for now — a Large SUV / X-Large MPV layout (e.g. a third row of
// windows) is added by giving that size its own list here, plus any new
// GlassPosition keys it needs.
const GLASS_LAYOUTS: Record<GarageVehicleSize, GlassPositionDef[]> = {
  standard: STANDARD_GLASS_LAYOUT,
  large: STANDARD_GLASS_LAYOUT,
  xlarge: STANDARD_GLASS_LAYOUT,
};

export function glassLayoutFor(size: GarageVehicleSize): GlassPositionDef[] {
  return GLASS_LAYOUTS[size] ?? STANDARD_GLASS_LAYOUT;
}

export function glassZone(position: TintGlassKey): 'front' | 'rear' | undefined {
  return GLASS_DEFS[position as GlassPosition]?.zone;
}

// The Mix & Match price grid's rows — one per-window rate each, edited on
// the Tint Pricing page.
export const TINT_PRICE_GROUPS: { key: TintPriceGroup; label: string }[] = [
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

// Display label for any glass key, including the pre-split grouped keys
// still sitting on old installation-piece rows.
export const GLASS_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.values(GLASS_DEFS).map((d) => [d.key, d.label])),
  ...Object.fromEntries(EXTRA_GLASS_OPTIONS.map((e) => [e.key, e.label])),
  door_window: 'Door Windows',
  rear_panel_window: 'Rear Panel Windows',
};

// Per-window Mix & Match price for one glass position. Extra Rear Window
// bills at the Rear Panel Window rate (no separate price to set); Small
// Window is complimentary.
export function glassPrice(position: TintGlassKey, series: TintSeries, positionPrices: Record<string, number>): number {
  if (position === 'small_window') return 0;
  const group: TintPriceGroup = position === 'extra_rear_2pc'
    ? 'rear_panel_window'
    : GLASS_DEFS[position].priceGroup;
  return positionPrices[`${group}|${series}`] ?? 0;
}

// Orders saved before left/right were split hold one grouped entry for all
// the door windows and one for both panels. Expand those into the
// individual positions they covered (same series/VLT each), splitting the
// stored price so the order's line items still add up to what was charged.
const LEGACY_EXPANSION: Record<string, GlassPosition[]> = {
  door_window: ['front_left_window', 'front_right_window', 'rear_left_window', 'rear_right_window'],
  rear_panel_window: ['rear_left_panel_window', 'rear_right_panel_window'],
};

export function normalizeTintSelections(selections: TintPositionSelection[]): TintPositionSelection[] {
  return selections.flatMap((sel) => {
    const expanded = LEGACY_EXPANSION[sel.position as string];
    if (!expanded) return [sel];
    return expanded.map((position) => ({ ...sel, position, price: sel.price / expanded.length }));
  });
}

export const VLT_OPTIONS = ['70%', '45%', '35%', '20%', '10%'];

export const VEHICLE_SIZES: { key: GarageVehicleSize; label: string }[] = [
  { key: 'standard', label: 'Standard' },
  { key: 'large', label: 'Large' },
  { key: 'xlarge', label: 'X-Large' },
];
