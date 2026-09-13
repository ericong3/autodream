import { supabase } from './supabase';
import type { GarageCustomer, GarageVehicle, GarageVehicleSize } from '../types';
import { generateId } from '../utils/format';

// Deliberately not wired into the main Zustand store — Garage customers/
// vehicles are their own self-contained feature with no overlap with Used
// Car's state, so there's nothing to gain from routing through loadAll().

function rowToCustomer(r: any): GarageCustomer {
  return {
    id: r.id,
    name: r.name,
    icNumber: r.ic_number,
    phone: r.phone,
    email: r.email ?? undefined,
    createdAt: r.created_at,
    createdBy: r.created_by ?? undefined,
  };
}

function rowToVehicle(r: any): GarageVehicle {
  return {
    id: r.id,
    customerId: r.customer_id,
    make: r.make,
    model: r.model,
    year: r.year,
    colour: r.colour ?? undefined,
    registrationNo: r.registration_no,
    size: r.size,
    createdAt: r.created_at,
    createdBy: r.created_by ?? undefined,
  };
}

// Postgres unique-violation code — thrown when an IC number is already on file.
export const UNIQUE_VIOLATION = '23505';

export async function findGarageCustomerByIc(icNumber: string): Promise<GarageCustomer | null> {
  const { data, error } = await supabase.from('garage_customers').select('*').eq('ic_number', icNumber).maybeSingle();
  if (error) throw error;
  return data ? rowToCustomer(data) : null;
}

export async function getGarageCustomer(id: string): Promise<GarageCustomer | null> {
  const { data, error } = await supabase.from('garage_customers').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToCustomer(data) : null;
}

export async function createGarageCustomer(input: {
  name: string; icNumber: string; phone: string; email?: string; createdBy?: string;
}): Promise<GarageCustomer> {
  const row = {
    id: generateId(),
    name: input.name,
    ic_number: input.icNumber,
    phone: input.phone,
    email: input.email || null,
    created_by: input.createdBy || null,
  };
  const { data, error } = await supabase.from('garage_customers').insert(row).select().single();
  if (error) throw error;
  return rowToCustomer(data);
}

export async function listGarageVehicles(customerId: string): Promise<GarageVehicle[]> {
  const { data, error } = await supabase
    .from('garage_vehicles')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToVehicle);
}

export async function getGarageVehicle(id: string): Promise<GarageVehicle | null> {
  const { data, error } = await supabase.from('garage_vehicles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToVehicle(data) : null;
}

export async function createGarageVehicle(input: {
  customerId: string; make: string; model: string; year: number; colour?: string;
  registrationNo: string; size: GarageVehicleSize; createdBy?: string;
}): Promise<GarageVehicle> {
  const row = {
    id: generateId(),
    customer_id: input.customerId,
    make: input.make,
    model: input.model,
    year: input.year,
    colour: input.colour || null,
    registration_no: input.registrationNo,
    size: input.size,
    created_by: input.createdBy || null,
  };
  const { data, error } = await supabase.from('garage_vehicles').insert(row).select().single();
  if (error) throw error;
  return rowToVehicle(data);
}
