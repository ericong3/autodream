import { useCallback, useEffect, useRef, useState } from 'react';

// Private investor finance API. Every figure comes from the server; this file
// never reads the shared store or Supabase. Mutations carry a stable requestId
// kept in sessionStorage (bound to the signed-in staff id) so an interrupted
// save is retried with the same reference instead of being recorded twice.

export type CarState = 'reserved' | 'in_stock' | 'sold' | 'settled';
export type BillCategory = 'repair' | 'petrol' | 'transport' | 'invoicing' | 'commission' | 'misc';
export type WithdrawalState = 'requested' | 'approved' | 'rejected' | 'paid' | 'cancelled';

export type Position = { potId?: string; cashCents: number; reservedCents: number; availableCents: number; investedCents: number; purchaseReservedCents?: number; billReservedCents?: number; profitHeldCents?: number };
export type Settlement = { investor_result_cents: number; company_profit_cents: number; profit_cents: number; cost_cents: number; approved_at: string };
export type CarSummary = {
  carId: string; potId?: string; make: string; model: string; year: number | null; plate: string | null; photo: string | null;
  purchaseCents?: number; purchasePaidCents?: number; investorBasisPoints?: number; saleCents?: number | null; receivedCents?: number;
  costCents?: number; unpaidBillCents?: number; pendingBills?: number; profitCents?: number | null; settledAt?: string | null;
  state?: CarState; settlement?: Settlement | null;
};
export type BillPayment = { id: string; amountCents: number; paidOn: string };
export type BillDocument = { id: string; name: string; kind: 'bill' | 'payment'; entryId?: string };
export type CarBill = { id: string; category: BillCategory; purpose: string; payee: string; amountCents: number; paidCents: number; state: 'pending' | 'approved' | 'voided'; createdAt: string; reviewedAt: string | null; payments?: BillPayment[]; documents?: BillDocument[] };
export type CarActivity = { id: string; actorName: string; action: string; createdAt: string };
export type CarDetail = CarSummary & { bills: CarBill[]; activity?: CarActivity[] };
export type Withdrawal = { id: string; amountCents: number; state: WithdrawalState; requestedAt: string; reviewedAt: string | null; note: string | null };
export type CashEntry = { id: string; kind: string; amountCents: number; paidOn: string | null; recordedAt: string };
export type Bank = { id: string; name: string; openingDate: string; openingCents: number };
export type InvestorSnapshot = { profile: { id: string; name: string; hasLogin: boolean }; position: Position; entries: CashEntry[]; withdrawals: Withdrawal[]; cars: CarSummary[] };
export type InvestorProfile = { id: string; name: string; potId: string; linkedStaffId?: string | null; position: Position; cars: CarSummary[]; withdrawals: Withdrawal[] };
export type ProfileList = { profiles: InvestorProfile[]; banks: Bank[]; companyProfitCents: number };
export type FundableCar = { id: string; make: string; model: string; year: number | null; car_plate: string | null; photo: string | null; purchase_price: number };

export class InvestorFinanceError extends Error {
  constructor(message: string, public code: string, public status: number, public retryable: boolean) { super(message); }
}

const SETUP_MESSAGE = 'Investor records are not switched on yet. Nothing was saved. Please ask the Director to finish the setup.';

export async function investorRequest<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/garage/sales', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Garage-Building': '1' }, body: JSON.stringify({ scope: 'investor_finance', action, ...data }) });
  } catch {
    throw new InvestorFinanceError('Connection lost before the server replied. Check your connection, then retry.', 'NETWORK', 0, true);
  }
  const result = await response.json().catch(() => null);
  if (response.ok && result && typeof result === 'object') return result as T;
  const code: string = result?.error?.code || (response.ok ? 'UNAVAILABLE' : response.status === 404 ? 'SETUP' : 'UNAVAILABLE');
  if (code === 'SETUP') throw new InvestorFinanceError(SETUP_MESSAGE, code, response.status, false);
  const retryable = code === 'UNAVAILABLE' || code === 'RATE_LIMITED' || response.status >= 500 || response.ok;
  const fallback = retryable ? 'The server could not confirm this. Retry the same save — it will not be recorded twice.' : 'This could not be completed. Check the details and try again.';
  throw new InvestorFinanceError(result?.error?.message || fallback, code, response.status, retryable);
}

// ── Durable retry for mutations ──────────────────────────────────────────────
export type PendingMutation = { actorId: string; slot: string; action: string; data: Record<string, unknown>; requestId: string; label: string; createdAt: string };
const REQUEST_ID = /^[A-Za-z0-9_-]{16,80}$/;
const pendingKey = (actorId: string) => `autodream-investor-pending:${actorId}`;

export function readPending(actorId: string): PendingMutation[] {
  try {
    const raw = sessionStorage.getItem(pendingKey(actorId));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as PendingMutation[]).filter((p) => p && p.actorId === actorId && typeof p.slot === 'string' && typeof p.action === 'string' && REQUEST_ID.test(p.requestId) && p.data && typeof p.data === 'object') : [];
  } catch { return []; }
}
function writePending(actorId: string, list: PendingMutation[]) {
  if (list.length) sessionStorage.setItem(pendingKey(actorId), JSON.stringify(list));
  else sessionStorage.removeItem(pendingKey(actorId));
}
export function discardPending(actorId: string, slot: string) { writePending(actorId, readPending(actorId).filter((p) => p.slot !== slot)); }
const sameData = (a: Record<string, unknown>, b: Record<string, unknown>) => JSON.stringify(a) === JSON.stringify(b);

export async function sendMutation<T>(actorId: string, slot: string, action: string, data: Record<string, unknown>, label: string): Promise<T> {
  const list = readPending(actorId);
  const existing = list.find((p) => p.slot === slot);
  if (existing && (existing.action !== action || !sameData(existing.data, data)))
    throw new InvestorFinanceError(`An earlier "${existing.label}" is still waiting to be confirmed. Retry or discard it first.`, 'PENDING', 0, false);
  const intent: PendingMutation = existing ?? { actorId, slot, action, data, requestId: crypto.randomUUID(), label, createdAt: new Date().toISOString() };
  if (!existing) {
    try { writePending(actorId, [...list, intent]); } catch { throw new InvestorFinanceError('This browser could not keep a safe save reference. Close other tabs and try again.', 'STORAGE', 0, false); }
  }
  try {
    const result = await investorRequest<T>(action, { ...data, requestId: intent.requestId });
    discardPending(actorId, slot);
    return result;
  } catch (error) {
    const known = error instanceof InvestorFinanceError ? error : new InvestorFinanceError('Something went wrong. Retry the same save.', 'UNAVAILABLE', 0, true);
    // Keep the reference when the outcome is unknown or the server says this reference was already used.
    if (!known.retryable && known.code !== 'REQUEST_CHANGED') discardPending(actorId, slot);
    throw known;
  }
}

export type ActionError = { slot: string; message: string; retryable: boolean; code: string };

/** Mutation runner bound to one signed-in staff id. Results for a previous actor are dropped. */
export function useInvestorAction(actorId: string | undefined) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, setPending] = useState<PendingMutation[]>(() => (actorId ? readPending(actorId) : []));
  const actorRef = useRef(actorId);
  useEffect(() => { actorRef.current = actorId; setPending(actorId ? readPending(actorId) : []); setError(null); setBusy(null); }, [actorId]);

  const run = useCallback(async <T,>(slot: string, action: string, data: Record<string, unknown>, label: string): Promise<T | null> => {
    if (!actorId) return null;
    setBusy(slot); setError(null);
    try {
      const result = await sendMutation<T>(actorId, slot, action, data, label);
      return actorRef.current === actorId ? result : null;
    } catch (e) {
      if (actorRef.current === actorId) {
        const err = e as InvestorFinanceError;
        setError({ slot, message: err.message, retryable: err.retryable, code: err.code });
      }
      return null;
    } finally {
      if (actorRef.current === actorId) { setBusy(null); setPending(readPending(actorId)); }
    }
  }, [actorId]);

  const retry = useCallback(async <T,>(slot: string): Promise<T | null> => {
    if (!actorId) return null;
    const intent = readPending(actorId).find((p) => p.slot === slot);
    return intent ? run<T>(slot, intent.action, intent.data, intent.label) : null;
  }, [actorId, run]);

  const discard = useCallback((slot: string) => {
    if (!actorId) return;
    discardPending(actorId, slot); setPending(readPending(actorId));
    setError((current) => (current?.slot === slot ? null : current));
  }, [actorId]);

  return { busy, error, pending, run, retry, discard, clearError: () => setError(null) };
}

/** Loader that ignores responses from an earlier actor/account/car selection. */
export function useInvestorQuery<T>(key: string | null, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<InvestorFinanceError | null>(null);
  const [loading, setLoading] = useState(false);
  const ticket = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    if (key === null) { setData(null); setError(null); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const result = await loadRef.current();
      if (mine === ticket.current) setData(result);
    } catch (e) {
      if (mine === ticket.current) setError(e instanceof InvestorFinanceError ? e : new InvestorFinanceError('Could not load. Try again.', 'UNAVAILABLE', 0, true));
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [key]);
  useEffect(() => {
    setData(null); void reload();
    const refresh=()=>{if(document.visibilityState==='visible')void reload();};
    window.addEventListener('focus',refresh);
    const timer=window.setInterval(refresh,60000);
    return()=>{++ticket.current;window.removeEventListener('focus',refresh);window.clearInterval(timer);};
  }, [reload]);
  return { data, error, loading, reload };
}

// ── Money and dates ──────────────────────────────────────────────────────────
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  const sign = cents < 0 ? '-' : '';
  return `${sign}RM ${(Math.abs(cents) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** Strict RM input → integer cents. Returns null for anything that isn't a plain positive amount. */
export function parseRinggit(input: string): number | null {
  const clean = input.replace(/[,\s]/g, '').replace(/^RM/i, '');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return cents > 0 && Number.isSafeInteger(cents) ? cents : null;
}
export const basisPointsLabel = (bp: number | undefined) => (bp === undefined ? '—' : `${(bp / 100).toLocaleString('en-MY', { maximumFractionDigits: 2 })}%`);
export function parsePercentToBasisPoints(input: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(input.trim())) return null;
  const bp = Math.round(Number(input) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}
export function malaysiaToday(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export const formatDay = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00+08:00` : iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }) : '—');

/** Investor's share of a figure, rounded down to the cent (estimate only until the Director confirms profit). */
export const investorShare = (cents: number | null | undefined, bp: number | undefined) => (cents === null || cents === undefined || bp === undefined ? null : Math.trunc((cents * bp) / 10000));
export function earnedProfit(car: CarSummary) { return car.settlement ? car.settlement.investor_result_cents : null; }
export const carTitle = (c: Pick<CarSummary, 'year' | 'make' | 'model'>) => [c.year, c.make, c.model].filter(Boolean).join(' ');
export const isInStock = (c: CarSummary) => c.state === 'reserved' || c.state === 'in_stock';

export const BILL_CATEGORIES: { value: BillCategory; label: string }[] = [
  { value: 'repair', label: 'Repair' }, { value: 'petrol', label: 'Petrol' }, { value: 'transport', label: 'Transport' },
  { value: 'invoicing', label: 'Invoicing' }, { value: 'commission', label: 'Commission' }, { value: 'misc', label: 'Other' },
];
export const CAR_STATE_LABEL: Record<CarState, string> = { reserved: 'Waiting for purchase payment', in_stock: 'In stock', sold: 'Sold', settled: 'Profit confirmed' };
export const WITHDRAWAL_LABEL: Record<WithdrawalState, string> = { requested: 'Waiting for Director', approved: 'Approved — payment not yet recorded', rejected: 'Not approved', paid: 'Paid', cancelled: 'Cancelled' };
const ENTRY_LABEL: Record<string, string> = { capital_in: 'Capital received', withdrawal_out: 'Withdrawal paid', car_purchase: 'Car purchase paid', car_sale: 'Sale money received', car_expense: 'Car bill paid', profit_in: 'Profit confirmed', profit_out: 'Loss confirmed' };
export const entryLabel = (kind: string) => ENTRY_LABEL[kind] ?? kind.replace(/_/g, ' ').replace(/^./, (s) => s.toUpperCase());

// ── Proof files ──────────────────────────────────────────────────────────────
export const PROOF_MAX_BYTES = 1_400_000; // base64 of this stays below the 2.1 MB request limit
type ProofMime = 'image/png' | 'image/jpeg' | 'application/pdf';
async function sniff(blob: Blob): Promise<ProofMime | null> {
  const b = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  return null;
}
async function shrinkImage(file: Blob): Promise<Blob | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  for (const [edge, quality] of [[2000, 0.82], [1600, 0.75], [1200, 0.7]] as const) {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (out && out.size <= PROOF_MAX_BYTES) { bitmap.close(); return out; }
  }
  bitmap.close();
  return null;
}
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
/** Checks type by file content, shrinks large photos, and refuses anything over the safe size. */
export async function prepareProof(file: File): Promise<{ fileName: string; mimeType: ProofMime; base64: string }> {
  const mime = await sniff(file);
  if (!mime) throw new InvestorFinanceError('Choose a PNG or JPEG photo, or a PDF.', 'INVALID', 0, false);
  let blob: Blob = file, type: ProofMime = mime, name = file.name || 'receipt';
  if (file.size > PROOF_MAX_BYTES) {
    const smaller = mime === 'application/pdf' ? null : await shrinkImage(file);
    if (!smaller) throw new InvestorFinanceError(mime === 'application/pdf' ? 'This PDF is larger than 1.4 MB. Save a smaller copy and try again.' : 'This photo could not be made small enough. Try a clearer, closer photo.', 'TOO_LARGE', 0, false);
    blob = smaller; type = 'image/jpeg'; name = name.replace(/\.[^.]+$/, '') + '.jpg';
  }
  return { fileName: name.slice(0, 120), mimeType: type, base64: await toBase64(blob) };
}
