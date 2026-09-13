import { supabase } from './supabase';
import type {
  TintSeries, GlassPosition, GarageVehicleSize, TintPackageType,
  TintPositionSelection, GarageTintOrder,
} from '../types';

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

// Mix & Match price grid — keyed "position|series|size".
export async function getPositionPrices(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('garage_tint_position_prices').select('*');
  if (error) throw error;
  const map: Record<string, number> = {};
  (data ?? []).forEach((r: any) => { map[`${r.glass_position}|${r.series}|${r.vehicle_size}`] = Number(r.price); });
  return map;
}

export async function setPositionPrice(
  position: GlassPosition, series: TintSeries, vehicleSize: GarageVehicleSize, price: number,
): Promise<void> {
  const { error } = await supabase
    .from('garage_tint_position_prices')
    .upsert({ glass_position: position, series, vehicle_size: vehicleSize, price, updated_at: new Date().toISOString() });
  if (error) throw error;
}

function rowToTintOrder(r: any): GarageTintOrder {
  return {
    invoiceId: r.invoice_id,
    packageType: r.package_type,
    fullSeries: r.full_series ?? undefined,
    selections: r.selections ?? [],
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
  selections: TintPositionSelection[]; discount: number; finalTotal: number;
}): Promise<GarageTintOrder> {
  const row = {
    invoice_id: input.invoiceId,
    package_type: input.packageType,
    full_series: input.fullSeries || null,
    selections: input.selections,
    discount: input.discount,
    final_total: input.finalTotal,
  };
  const { data, error } = await supabase.from('garage_tint_orders').insert(row).select().single();
  if (error) throw error;
  return rowToTintOrder(data);
}
