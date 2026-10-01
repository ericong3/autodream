import { supabase } from './supabase';
import type {
  GarageInvoice, GarageInvoiceClaim, GarageInvoiceAddon, GarageService, GarageClaimType,
  GaragePaymentMethod, GaragePaymentStatus, GarageWorkOrderActivity,
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
    receiptPath: r.receipt_path ?? undefined,
    receiptName: r.receipt_name ?? undefined,
    deliveredAt: r.delivered_at ?? undefined,
    warrantyRegisteredAt: r.warranty_registered_at ?? undefined,
    paidAt: r.paid_at ?? undefined,
    paidBy: r.paid_by ?? undefined,
    deliveredBy: r.delivered_by ?? undefined,
    warrantyRegisteredBy: r.warranty_registered_by ?? undefined,
    workStatus: r.work_status,
    appointmentAt: r.appointment_at ?? undefined,
    remark: r.remark ?? undefined,
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

// "My Work Orders" — every invoice a given salesman created, newest first.
export async function listInvoicesCreatedBy(userId: string): Promise<GarageInvoice[]> {
  const { data, error } = await supabase
    .from('garage_invoices')
    .select('*')
    .eq('created_by', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToInvoice);
}

// Work Order Tracking — every invoice for a given service, across every
// salesman, newest first. Manager-level oversight, unlike listInvoicesCreatedBy
// above which is scoped to one salesman's own orders.
export async function listInvoicesByService(service: GarageService): Promise<GarageInvoice[]> {
  const { data, error } = await supabase
    .from('garage_invoices')
    .select('*')
    .eq('service', service)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToInvoice);
}

export async function createGarageInvoice(input: {
  customerId: string; vehicleId: string; service: GarageService;
  paymentMethod?: GaragePaymentMethod; paymentStatus: GaragePaymentStatus; createdBy?: string;
  appointmentAt?: string; remark?: string;
}): Promise<GarageInvoice> {
  const row = {
    id: generateId(),
    customer_id: input.customerId,
    vehicle_id: input.vehicleId,
    service: input.service,
    payment_method: input.paymentMethod || null,
    payment_status: input.paymentStatus,
    // Confirmed orders go straight into the installer queue.
    work_status: 'waiting_for_installer',
    appointment_at: input.appointmentAt || null,
    remark: input.remark || null,
    created_by: input.createdBy || null,
    // Pay Now: collected right here, by whoever's confirming.
    ...(input.paymentStatus === 'paid'
      ? { paid_at: new Date().toISOString(), paid_by: input.createdBy || null }
      : {}),
  };
  const { data, error } = await supabase.from('garage_invoices').insert(row).select().single();
  if (error) throw error;
  return rowToInvoice(data);
}

// Undo for a work order whose confirm failed partway through. Every child
// table (tint order, work-order items, add-ons, installer job, claims)
// cascades off the invoice row, so deleting it removes all of them —
// only the receipt file lives outside that cascade, in storage.
export async function discardGarageInvoice(invoiceId: string): Promise<void> {
  const bucket = supabase.storage.from(INVOICE_FILES_BUCKET);
  const { data: files } = await bucket.list(invoiceId);
  if (files && files.length > 0) {
    await bucket.remove(files.map((f) => `${invoiceId}/${f.name}`));
  }
  const { error } = await supabase.from('garage_invoices').delete().eq('id', invoiceId);
  if (error) throw error;
}

// The salesman-side steps below are database functions: each checks the
// step is still outstanding (so a double tap / second device can't
// overwrite who did it), refuses installers, updates the work order and
// writes its activity-history entry in one atomic step.
const SALESMAN_STEP_ERRORS: Record<string, string> = {
  WORK_ORDER_CLOSED: 'This work order is closed',
  CANNOT_TAKE_PAYMENT: 'Payment can only be collected before the car is delivered',
  NOT_ALLOWED_FOR_INSTALLER: 'Installers can\'t collect payment, deliver or close a work order',
  ALREADY_PAID: 'This work order has already been paid',
  NOT_READY_FOR_DELIVERY: 'Not ready for delivery — installation must be completed and payment collected',
  NOT_READY_FOR_WARRANTY: 'Deliver the car before registering the warranty',
};

async function salesmanStep(fn: string, args: Record<string, unknown>): Promise<GarageInvoice> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const known = Object.keys(SALESMAN_STEP_ERRORS).find((code) => error.message?.includes(code));
    throw known ? new Error(SALESMAN_STEP_ERRORS[known]) : error;
  }
  return rowToInvoice(data);
}

// Collect Payment — for Pay Later orders. Records the method (none was
// chosen at confirmation), who collected it and when; a Payment Due order
// moves on to Ready for Delivery.
export function markInvoicePaid(
  invoiceId: string, paidBy?: string, paymentMethod?: GaragePaymentMethod,
): Promise<GarageInvoice> {
  return salesmanStep('mark_garage_work_order_paid', {
    p_invoice_id: invoiceId, p_actor_id: paidBy ?? null, p_method: paymentMethod ?? null,
  });
}

// The work order's activity history, oldest first.
export async function listWorkOrderActivity(invoiceId: string): Promise<GarageWorkOrderActivity[]> {
  const { data, error } = await supabase
    .from('garage_work_order_activity')
    .select('*')
    .eq('work_order_id', invoiceId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    workOrderId: r.work_order_id,
    eventType: r.event_type,
    actorId: r.actor_id ?? undefined,
    actorRole: r.actor_role ?? undefined,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
  }));
}

// Proof-of-payment upload — photo, camera capture, or PDF. Only the storage
// path is kept on the invoice row; a signed URL is generated on view since
// the bucket is private.
export async function uploadInvoiceReceipt(invoiceId: string, file: File): Promise<GarageInvoice> {
  const path = `${invoiceId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from('garage-invoice-receipts').upload(path, file);
  if (uploadError) throw uploadError;
  const { data, error } = await supabase
    .from('garage_invoices')
    .update({ receipt_path: path, receipt_name: file.name })
    .eq('id', invoiceId)
    .select()
    .single();
  if (error) throw error;
  return rowToInvoice(data);
}

// Optional installation photos, taken when the installer completes the job.
// Reuses the existing private invoice-files bucket (same upload + signed-URL
// setup as receipts), kept apart under installation/<invoiceId>/ — no table,
// the folder listing is the record.
const INVOICE_FILES_BUCKET = 'garage-invoice-receipts';
const installationPhotoFolder = (invoiceId: string) => `installation/${invoiceId}`;

export async function uploadInstallationPhoto(invoiceId: string, file: File): Promise<void> {
  const safeName = file.name.replace(/[^\w.-]+/g, '_');
  const path = `${installationPhotoFolder(invoiceId)}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(INVOICE_FILES_BUCKET).upload(path, file);
  if (error) throw error;
}

export async function listInstallationPhotos(invoiceId: string): Promise<{ name: string; url: string }[]> {
  const bucket = supabase.storage.from(INVOICE_FILES_BUCKET);
  const folder = installationPhotoFolder(invoiceId);
  const { data: files, error } = await bucket.list(folder, { sortBy: { column: 'name', order: 'asc' } });
  if (error) throw error;
  if (!files || files.length === 0) return [];
  const { data: signed, error: signError } = await bucket.createSignedUrls(files.map((f) => `${folder}/${f.name}`), 3600);
  if (signError) throw signError;
  return (signed ?? [])
    .map((s, i) => ({ name: files[i].name, url: s.signedUrl }))
    .filter((p) => !!p.url);
}

export async function getInvoiceReceiptUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('garage-invoice-receipts').createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}

// Car handed back to the customer — the database refuses unless the
// installation is completed and payment collected.
export function markInvoiceDelivered(invoiceId: string, deliveredBy?: string): Promise<GarageInvoice> {
  return salesmanStep('deliver_garage_work_order', { p_invoice_id: invoiceId, p_actor_id: deliveredBy ?? null });
}

// Final step — the tint registered with the manufacturer's e-warranty.
// Setting this is what makes a work order "closed" (asleep).
export function registerInvoiceWarranty(invoiceId: string, registeredBy?: string): Promise<GarageInvoice> {
  return salesmanStep('register_garage_work_order_warranty', { p_invoice_id: invoiceId, p_actor_id: registeredBy ?? null });
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
