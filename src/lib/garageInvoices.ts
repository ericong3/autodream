import { supabase } from './supabase';
import type {
  GarageInvoice, GarageInvoiceClaim, GarageInvoiceAddon, GarageService, GarageClaimType,
  GaragePaymentMethod, GaragePaymentStatus,
} from '../types';
import { generateId } from '../utils/format';

function rowToInvoice(r: any): GarageInvoice {
  return {
    id: r.id,
    invoiceNumber: r.invoice_number,
    customerId: r.customer_id,
    vehicleId: r.vehicle_id,
    service: r.service,
    invoiceDate: r.invoice_date,
    paymentMethod: r.payment_method ?? undefined,
    paymentStatus: r.payment_status,
    createdAt: r.created_at,
    createdBy: r.created_by ?? undefined,
  };
}

function rowToAddon(r: any): GarageInvoiceAddon {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    name: r.name,
    price: Number(r.price),
    qty: r.qty,
    createdAt: r.created_at,
  };
}

function rowToClaim(r: any): GarageInvoiceClaim {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    type: r.type,
    bearBy: r.bear_by,
    reason: r.reason ?? undefined,
    createdAt: r.created_at,
    createdBy: r.created_by ?? undefined,
  };
}

export async function listInvoicesForVehicle(vehicleId: string): Promise<GarageInvoice[]> {
  const { data, error } = await supabase
    .from('garage_invoices')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('invoice_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToInvoice);
}

export async function getGarageInvoice(id: string): Promise<GarageInvoice | null> {
  const { data, error } = await supabase.from('garage_invoices').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToInvoice(data) : null;
}

export async function createGarageInvoice(input: {
  customerId: string; vehicleId: string; service: GarageService;
  paymentMethod?: GaragePaymentMethod; paymentStatus: GaragePaymentStatus; createdBy?: string;
}): Promise<GarageInvoice> {
  const row = {
    id: generateId(),
    customer_id: input.customerId,
    vehicle_id: input.vehicleId,
    service: input.service,
    payment_method: input.paymentMethod || null,
    payment_status: input.paymentStatus,
    created_by: input.createdBy || null,
  };
  const { data, error } = await supabase.from('garage_invoices').insert(row).select().single();
  if (error) throw error;
  return rowToInvoice(data);
}

export async function markInvoicePaid(invoiceId: string): Promise<GarageInvoice> {
  const { data, error } = await supabase
    .from('garage_invoices')
    .update({ payment_status: 'paid' })
    .eq('id', invoiceId)
    .select()
    .single();
  if (error) throw error;
  return rowToInvoice(data);
}

export async function listInvoiceAddons(invoiceId: string): Promise<GarageInvoiceAddon[]> {
  const { data, error } = await supabase
    .from('garage_invoice_addons')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToAddon);
}

export async function createInvoiceAddon(input: {
  invoiceId: string; name: string; price: number; qty: number;
}): Promise<GarageInvoiceAddon> {
  const row = {
    id: generateId(),
    invoice_id: input.invoiceId,
    name: input.name,
    price: input.price,
    qty: input.qty,
  };
  const { data, error } = await supabase.from('garage_invoice_addons').insert(row).select().single();
  if (error) throw error;
  return rowToAddon(data);
}

export async function listInvoiceClaims(invoiceId: string): Promise<GarageInvoiceClaim[]> {
  const { data, error } = await supabase
    .from('garage_invoice_claims')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToClaim);
}

// Warranty is always the supplier's cost, replacement is always the
// company's — bear_by is derived from type, never a free choice.
export async function createInvoiceClaim(input: {
  invoiceId: string; type: GarageClaimType; reason?: string; createdBy?: string;
}): Promise<GarageInvoiceClaim> {
  const row = {
    id: generateId(),
    invoice_id: input.invoiceId,
    type: input.type,
    bear_by: input.type === 'warranty' ? 'supplier' : 'company',
    reason: input.reason || null,
    created_by: input.createdBy || null,
  };
  const { data, error } = await supabase.from('garage_invoice_claims').insert(row).select().single();
  if (error) throw error;
  return rowToClaim(data);
}
