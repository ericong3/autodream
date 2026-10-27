import {validGlassLayout} from '../utils/vehicleGlass';
import {installationMutation} from './garageInstallationReview';
import { supabase } from './supabase';
import type {
  TintSeries, TintPriceGroup, GarageVehicleSize, TintPackageType,
  TintPositionSelection, GarageTintOrder, GarageTintWorkOrderItem, GarageFilmStock,
} from '../types';
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
    vehicleLayout:validGlassLayout(r.vehicle_layout)?r.vehicle_layout:undefined,
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
    claimedAt: r.claimed_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
    completedBy: r.completed_by ?? undefined,
    needsCorrection: !!r.needs_correction,
    correctionNote: r.correction_note ?? undefined,
    updatedAt: r.updated_at,
  };
}

export async function listTintWorkOrderItems(invoiceId: string): Promise<GarageTintWorkOrderItem[]> {
  const { data, error } = await supabase.from('garage_tint_installation_pieces').select('*').eq('invoice_id', invoiceId);
  if (error) throw error;
  return (data ?? []).map(rowToItem);
}

// Glass items for many work orders in one request (team queue, board).
// The pre-split grouped rows are left out.
export async function listTintItemsForInvoices(invoiceIds: string[]): Promise<GarageTintWorkOrderItem[]> {
  if (invoiceIds.length === 0) return [];
  const { data, error } = await supabase
    .from('garage_tint_installation_pieces')
    .select('*')
    .in('invoice_id', invoiceIds);
  if (error) throw error;
  return (data ?? []).map(rowToItem).filter((i) => isRequiredGlass(i));
}

// The grouped 'door_window' / 'rear_panel_window' rows from before
// left/right were split don't count — individual glass replaced them.
export function isRequiredGlass(item: GarageTintWorkOrderItem): boolean {
  return item.glassPosition !== 'door_window' && item.glassPosition !== 'rear_panel_window';
}

// Creates one item per glass in the order that doesn't have one yet
// (idempotent — positions already seeded are left untouched, so installer
// progress is never overwritten). Called when the order is confirmed, and
// again when the job page opens so orders from before items were seeded at
// confirm time still get theirs.
export async function ensureTintWorkOrderItems(
  invoiceId: string, selections: TintPositionSelection[],
): Promise<GarageTintWorkOrderItem[]> {
  void selections; // Items are seeded by trusted sale confirmation; browser cannot create work pieces.
  return listTintWorkOrderItems(invoiceId);
}

// ── Per-glass work ──────────────────────────────────────────────────────
// Tinted installation is team work owned per glass: an installer claims an
// available glass and from then on only they (or a Garage Head / Director /
// Shareholder) can change or confirm it. Every step is a database function
// that checks ownership and stage and records the activity history; the
// database refuses direct writes to these fields.

// Thrown when another installer claimed the glass first — carries who.
export class GlassAlreadyTakenError extends Error {
  constructor(public takenBy?: string) { super('Someone else has just taken this glass'); }
}

async function glassStep(fn: string, args: Record<string, unknown>): Promise<GarageTintWorkOrderItem> {
  const action=fn==='claim_garage_glass_item'?'claim':fn==='release_garage_glass_item'?'release':fn==='set_garage_glass_item_status'?(args.p_status==='installed'?'complete':'reopen'):fn==='set_garage_glass_item_remark'?'remark':null;
  if(!action)throw new Error('Installers claim their own pieces. Correction work stays with the original installer.');
  const response=await installationMutation(action,{itemId:String(args.p_item_id)},fn==='set_garage_glass_item_remark'?{value:args.p_remark}:{});
  return rowToItem(response.result);
}

// An installer takes an available glass. Race-safe in the database: if two
// installers tap at once, only the first gets it (the other gets
// GlassAlreadyTakenError). Taking the first glass also starts the car.
export function claimTintWorkOrderItem(itemId: string, actorId: string) {
  return glassStep('claim_garage_glass_item', { p_item_id: itemId, p_actor_id: actorId });
}

// Hand a taken (not yet installed) glass back to the pool.
export function releaseTintWorkOrderItem(itemId: string, actorId: string) {
  return glassStep('release_garage_glass_item', { p_item_id: itemId, p_actor_id: actorId });
}

// Management assigns / reassigns / clears a glass's installer.
export function assignTintWorkOrderItem(itemId: string, installerId: string | null, actorId: string) {
  return glassStep('assign_garage_glass_item', { p_item_id: itemId, p_installer_id: installerId, p_actor_id: actorId });
}

// 'installed' — the glass's installer confirms it; 'taken' — undo / reopen.
export function setTintWorkOrderItemStatus(itemId: string, status: 'installed' | 'taken', actorId: string) {
  return glassStep('set_garage_glass_item_status', { p_item_id: itemId, p_status: status, p_actor_id: actorId });
}

export function setTintWorkOrderItemRemark(itemId: string, remark: string, actorId: string) {
  return glassStep('set_garage_glass_item_remark', { p_item_id: itemId, p_remark: remark, p_actor_id: actorId });
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

// Log how much film one glass used. The glass's sqft and the film stock it
// draws on change together in a single database transaction
// (set_garage_glass_item_sqft): the glass and stock rows are locked, the
// difference from the previous value is taken from (or, when lowered,
// returned to) that series' stock, and if anything fails neither changes.
export async function setTintWorkOrderItemSqft(
  itemId: string, sqft: number, actorId: string,
): Promise<{ item: GarageTintWorkOrderItem; stock: GarageFilmStock | null }> {
  void actorId;
  const {result:data}=await installationMutation('sqft',{itemId},{value:sqft});
  return {item:rowToItem(data.item),stock:data.stock?rowToFilmStock(data.stock):null};
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
