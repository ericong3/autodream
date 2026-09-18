import { supabase } from './supabase';
import type { GarageInstallerJob, GarageService } from '../types';
import { generateId } from '../utils/format';

function rowToJob(r: any): GarageInstallerJob {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    service: r.service,
    status: r.status,
    createdAt: r.created_at,
    acceptedBy: r.accepted_by ?? undefined,
    acceptedAt: r.accepted_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
  };
}

export async function createInstallerJob(input: { invoiceId: string; service: GarageService }): Promise<GarageInstallerJob> {
  const row = { id: generateId(), invoice_id: input.invoiceId, service: input.service };
  const { data, error } = await supabase.from('garage_installer_jobs').insert(row).select().single();
  if (error) throw error;
  return rowToJob(data);
}

export async function listPendingInstallerJobs(): Promise<GarageInstallerJob[]> {
  const { data, error } = await supabase
    .from('garage_installer_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToJob);
}

export async function listAcceptedInstallerJobs(): Promise<GarageInstallerJob[]> {
  const { data, error } = await supabase
    .from('garage_installer_jobs')
    .select('*')
    .eq('status', 'accepted')
    .order('accepted_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToJob);
}

export async function getInstallerJobForInvoice(invoiceId: string): Promise<GarageInstallerJob | null> {
  const { data, error } = await supabase.from('garage_installer_jobs').select('*').eq('invoice_id', invoiceId).maybeSingle();
  if (error) throw error;
  return data ? rowToJob(data) : null;
}

export async function acceptInstallerJob(jobId: string, userId: string): Promise<GarageInstallerJob> {
  const { data, error } = await supabase
    .from('garage_installer_jobs')
    .update({ status: 'accepted', accepted_by: userId, accepted_at: new Date().toISOString() })
    .eq('id', jobId)
    .select()
    .single();
  if (error) throw error;
  return rowToJob(data);
}

export async function completeInstallerJob(jobId: string): Promise<GarageInstallerJob> {
  const { data, error } = await supabase
    .from('garage_installer_jobs')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .select()
    .single();
  if (error) throw error;
  return rowToJob(data);
}
