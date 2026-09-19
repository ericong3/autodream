import { supabase } from './supabase';
import type {
  TintSeries, GlassPosition, ExtraGlassKey, GarageVehicleSize, TintPackageType,
  TintPositionSelection, GarageTintOrder, GarageTintInstallationPiece, GarageFilmStock,
} from '../types';
import { generateId } from '../utils/format';

// Full Package price grid — keyed "series|size" for cheap client-side lookup.
export async function getFullPrices(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('garage_tint_full_prices').select('*');
  if (error) throw error;
  const map: Record<string, number> = {};
  (data ?? []).forEach((r: any) => { map[`${r.series}|${r.vehicle_size}`] = Number(r.price); });
  return map;
}

export async function setFullPrice(series: TintSeries, vehicleSize: GarageVehicleSize, price: number): Promise<void> {
  const { error } = await supabase
    .from('garage_tint_full_prices')
    .upsert({ series, vehicle_size: vehicleSize, price, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// Mix & Match / extras price grid — per piece, by series only (no size
// dimension) — keyed "position|series".
export async function getPositionPrices(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('garage_tint_position_prices').select('*');
  if (error) throw error;
  const map: Record<string, number> = {};
  (data ?? []).forEach((r: any) => { map[`${r.glass_position}|${r.series}`] = Number(r.price); });
  return map;
}

export async function setPositionPrice(
  position: GlassPosition | ExtraGlassKey, series: TintSeries, price: number,
): Promise<void> {
  const { error } = await supabase
    .from('garage_tint_position_prices')
    .upsert({ glass_position: position, series, price, updated_at: new Date().toISOString() });
  if (error) throw error;
}

function rowToTintOrder(r: any): GarageTintOrder {
  return {
    invoiceId: r.invoice_id,
    packageType: r.package_type,
    fullSeries: r.full_series ?? undefined,
    selections: r.selections ?? [],
    extras: r.extras ?? [],
    discount: Number(r.discount),
    finalTotal: Number(r.final_total),
    createdAt: r.created_at,
  };
}

export async function getTintOrder(invoiceId: string): Promise<GarageTintOrder | null> {
  const { data, error } = await supabase.from('garage_tint_orders').select('*').eq('invoice_id', invoiceId).maybeSingle();
  if (error) throw error;
  return data ? rowToTintOrder(data) : null;
}

export async function createTintOrder(input: {
  invoiceId: string; packageType: TintPackageType; fullSeries?: TintSeries;
  selections: TintPositionSelection[]; extras: TintPositionSelection[]; discount: number; finalTotal: number;
}): Promise<GarageTintOrder> {
  const row = {
    invoice_id: input.invoiceId,
    package_type: input.packageType,
    full_series: input.fullSeries || null,
    selections: input.selections,
    extras: input.extras,
    discount: input.discount,
    final_total: input.finalTotal,
  };
  const { data, error } = await supabase.from('garage_tint_orders').insert(row).select().single();
  if (error) throw error;
  return rowToTintOrder(data);
}

function rowToPiece(r: any): GarageTintInstallationPiece {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    position: r.position,
    installerId: r.installer_id ?? undefined,
    sqft: r.sqft === null ? undefined : Number(r.sqft),
    updatedAt: r.updated_at,
  };
}

export async function listInstallationPieces(invoiceId: string): Promise<GarageTintInstallationPiece[]> {
  const { data, error } = await supabase.from('garage_tint_installation_pieces').select('*').eq('invoice_id', invoiceId);
  if (error) throw error;
  return (data ?? []).map(rowToPiece);
}

// Seeds a row for every position in the tint order that doesn't have one yet
// (idempotent — ignores positions already seeded) — called when the job
// execution page first opens, not at job-accept time, so it works the same
// for jobs created before this feature existed.
export async function ensureInstallationPieces(
  invoiceId: string, positions: (GlassPosition | ExtraGlassKey)[],
): Promise<GarageTintInstallationPiece[]> {
  if (positions.length > 0) {
    const rows = positions.map((position) => ({ id: generateId(), invoice_id: invoiceId, position }));
    const { error } = await supabase
      .from('garage_tint_installation_pieces')
      .upsert(rows, { onConflict: 'invoice_id,position', ignoreDuplicates: true });
    if (error) throw error;
  }
  return listInstallationPieces(invoiceId);
}

export async function updateInstallationPiece(
  pieceId: string, updates: { installerId?: string | null; sqft?: number | null },
): Promise<GarageTintInstallationPiece> {
  const row: Record<string, any> = { updated_at: new Date().toISOString() };
  if ('installerId' in updates) row.installer_id = updates.installerId || null;
  if ('sqft' in updates) row.sqft = updates.sqft ?? null;
  const { data, error } = await supabase
    .from('garage_tint_installation_pieces')
    .update(row)
    .eq('id', pieceId)
    .select()
    .single();
  if (error) throw error;
  return rowToPiece(data);
}

function rowToFilmStock(r: any): GarageFilmStock {
  return {
    series: r.series,
    rollSqft: Number(r.roll_sqft),
    remainingSqft: Number(r.remaining_sqft),
    lowStockThreshold: Number(r.low_stock_threshold),
    updatedAt: r.updated_at,
  };
}

export async function listFilmStock(): Promise<GarageFilmStock[]> {
  const { data, error } = await supabase.from('garage_film_stock').select('*');
  if (error) throw error;
  return (data ?? []).map(rowToFilmStock);
}

// Adjusts remaining stock by however much MORE film this edit consumed
// (negative delta hands stock back — e.g. a logged sqft value was reduced
// or cleared). Done as an atomic DB-side UPDATE (adjust_film_stock RPC),
// not a client-side read-modify-write — two pieces of the same series
// logged in quick succession would otherwise race and lose an update.
export async function adjustFilmStock(series: TintSeries, deltaConsumedSqft: number): Promise<GarageFilmStock> {
  const { data, error } = await supabase.rpc('adjust_film_stock', { p_series: series, p_delta: deltaConsumedSqft });
  if (error) throw error;
  return rowToFilmStock(data);
}

export async function setFilmStockConfig(
  series: TintSeries, updates: { rollSqft?: number; remainingSqft?: number; lowStockThreshold?: number },
): Promise<GarageFilmStock> {
  const row: Record<string, any> = { updated_at: new Date().toISOString() };
  if (updates.rollSqft !== undefined) row.roll_sqft = updates.rollSqft;
  if (updates.remainingSqft !== undefined) row.remaining_sqft = updates.remainingSqft;
  if (updates.lowStockThreshold !== undefined) row.low_stock_threshold = updates.lowStockThreshold;
  const { data, error } = await supabase.from('garage_film_stock').update(row).eq('series', series).select().single();
  if (error) throw error;
  return rowToFilmStock(data);
}
