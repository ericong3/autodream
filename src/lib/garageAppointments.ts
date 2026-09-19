import { supabase } from './supabase';
import type { GarageAppointment, GarageService } from '../types';
import { generateId } from '../utils/format';

function rowToAppointment(r: any): GarageAppointment {
  return {
    id: r.id,
    customerId: r.customer_id,
    vehicleId: r.vehicle_id ?? undefined,
    service: r.service,
    title: r.title ?? undefined,
    notes: r.notes ?? undefined,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at,
  };
}

// Fetches everything overlapping [rangeStart, rangeEnd) — used to fill
// whichever view (day/week/month) is currently on screen.
export async function listAppointmentsInRange(rangeStart: string, rangeEnd: string): Promise<GarageAppointment[]> {
  const { data, error } = await supabase
    .from('garage_appointments')
    .select('*')
    .lt('starts_at', rangeEnd)
    .gt('ends_at', rangeStart)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToAppointment);
}

export async function createGarageAppointment(input: {
  customerId: string; vehicleId?: string; service: GarageService;
  title?: string; notes?: string; startsAt: string; endsAt: string; createdBy?: string;
}): Promise<GarageAppointment> {
  const row = {
    id: generateId(),
    customer_id: input.customerId,
    vehicle_id: input.vehicleId || null,
    service: input.service,
    title: input.title || null,
    notes: input.notes || null,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    created_by: input.createdBy || null,
  };
  const { data, error } = await supabase.from('garage_appointments').insert(row).select().single();
  if (error) throw error;
  return rowToAppointment(data);
}

export async function updateGarageAppointment(id: string, input: {
  customerId: string; vehicleId?: string; service: GarageService;
  title?: string; notes?: string; startsAt: string; endsAt: string;
}): Promise<GarageAppointment> {
  const row = {
    customer_id: input.customerId,
    vehicle_id: input.vehicleId || null,
    service: input.service,
    title: input.title || null,
    notes: input.notes || null,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
  };
  const { data, error } = await supabase.from('garage_appointments').update(row).eq('id', id).select().single();
  if (error) throw error;
  return rowToAppointment(data);
}

export async function deleteGarageAppointment(id: string): Promise<void> {
  const { error } = await supabase.from('garage_appointments').delete().eq('id', id);
  if (error) throw error;
}
