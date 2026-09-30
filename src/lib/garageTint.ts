import { supabase } from './supabase';
import type {
  TintSeries, TintPriceGroup, GarageVehicleSize, TintPackageType, TintItemStatus,
  TintPositionSelection, GarageTintOrder, GarageTintWorkOrderItem, GarageFilmStock,
} from '../types';
import { generateId } from '../utils/format';
import { normalizeTintSelections } from '../utils/tintPricing';

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

// Mix & Match / extras price grid — per individual window, by series only
// (no size dimension) — keyed "priceGroup|series" (see glassPrice).
export async function getPositionPrices(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('garage_tint_position_prices').select('*');
  if (error) throw error;
  const map: Record<string, number> = {};
  (data ?? []).forEach((r: any) => { map[`${r.glass_position}|${r.series}`] = Number(r.price); });
  return map;
}

export async function setPositionPrice(
  position: TintPriceGroup, series: TintSeries, price: number,
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
    // Stored as-is; orders from before the left/right split are expanded
    // here so every screen only ever sees individual glass positions.
    selections: normalizeTintSelections(r.selections ?? []),
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

// Tint work-order items live in garage_tint_installation_pieces (the table
// predates the item model — `position` is the item's glass position).
function rowToItem(r: any): GarageTintWorkOrderItem {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    glassPosition: r.position,
    requestedSeries: r.requested_series ?? undefined,
    requestedVlt: r.requested_vlt ?? undefined,
    installedSeries: r.installed_series ?? undefined,
    installerId: r.installer_id ?? undefined,
    sqft: r.sqft === null ? undefined : Number(r.sqft),
    status: r.status ?? 'pending',
    remark: r.remark ?? undefined,
    updatedAt: r.updated_at,
  };
}

export async function listTintWorkOrderItems(invoiceId: string): Promise<GarageTintWorkOrderItem[]> {
  const { data, error } = await supabase.from('garage_tint_installation_pieces').select('*').eq('invoice_id', invoiceId);
  if (error) throw error;
  return (data ?? []).map(rowToItem);
}

// Creates one item per glass in the order that doesn't have one yet
// (idempotent — positions already seeded are left untouched, so installer
// progress is never overwritten). Called when the order is confirmed, and
// again when the job page opens so orders from before items were seeded at
// confirm time still get theirs.
export async function ensureTintWorkOrderItems(
  invoiceId: string, selections: TintPositionSelection[],
): Promise<GarageTintWorkOrderItem[]> {
  if (selections.length > 0) {
    const rows = selections.map((sel) => ({
      id: generateId(),
      invoice_id: invoiceId,
      position: sel.position,
      requested_series: sel.series,
      requested_vlt: sel.vlt,
    }));
    const { error } = await supabase
      .from('garage_tint_installation_pieces')
      .upsert(rows, { onConflict: 'invoice_id,position', ignoreDuplicates: true });
    if (error) throw error;
  }
  return listTintWorkOrderItems(invoiceId);
}

// Confirm one glass as completed (or reopen it). Done by a database
// function so the change and its GLASS_ITEM_COMPLETED / _REOPENED history
// entry are one step; confirming records installed = requested series, and
// the confirming installer as the glass's installer if none was set.
export async function setTintWorkOrderItemStatus(
  itemId: string, status: TintItemStatus, actorId: string,
): Promise<GarageTintWorkOrderItem> {
  const { data, error } = await supabase.rpc('set_garage_glass_item_status', {
    p_item_id: itemId, p_status: status, p_actor_id: actorId,
  });
  if (error) throw error;
  return rowToItem(data);
}

export async function updateTintWorkOrderItem(
  itemId: string,
  updates: {
    installerId?: string | null; sqft?: number | null; installedSeries?: TintSeries | null;
    status?: TintItemStatus; remark?: string | null;
  },
): Promise<GarageTintWorkOrderItem> {
  const row: Record<string, any> = { updated_at: new Date().toISOString() };
  if ('installerId' in updates) row.installer_id = updates.installerId || null;
  if ('sqft' in updates) row.sqft = updates.sqft ?? null;
  if ('installedSeries' in updates) row.installed_series = updates.installedSeries || null;
  if ('status' in updates) row.status = updates.status;
  if ('remark' in updates) row.remark = updates.remark || null;
  const { data, error } = await supabase
    .from('garage_tint_installation_pieces')
    .update(row)
    .eq('id', itemId)
    .select()
    .single();
  if (error) throw error;
  return rowToItem(data);
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
