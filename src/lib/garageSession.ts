import type { User } from '../types';
export const secureGarageLoginEnabled = () => import.meta.env.VITE_AUTODREAM_SECURE_LOGIN === '1';
export type GarageIdentity = Pick<User, 'id' | 'name' | 'username' | 'role'> & { businessAccess: 'used_car'|'garage'|'both' };
const roles = new Set(['director','shareholder','salesperson','mechanic','admin','investor','banker','garage_head','garage_salesman','garage_installer','garage_detailer','garage_spray']);
export async function garageSessionRequest(method: 'GET'|'POST'|'DELETE', body?: unknown): Promise<GarageIdentity | null> {
  const res = await fetch('/api/auth/session', { method, credentials: 'same-origin', cache: 'no-store', headers: { 'X-Garage-Building':'1', ...(body ? {'Content-Type':'application/json'} : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (method === 'GET' && res.status === 401) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || 'Garage sign-in is unavailable. Please try again.');
  if (method === 'DELETE') return null;
  const u = data?.user;
  if (!u || !['id','name','username','role'].every(k => typeof u[k] === 'string') || !roles.has(u.role) || !['used_car','garage','both'].includes(u.businessAccess)) throw new Error('AutoDream returned an invalid account. Please try again.');
  return {id:u.id,name:u.name,username:u.username,role:u.role,businessAccess:u.businessAccess};
}
export function garageAppUser(identity: GarageIdentity): User {
  // Business access comes only from the verified private account.
  return { ...identity, authSource: 'server', password: '', phone:'', monthlyTarget:0, carsInMonth:0 };
}

export async function confirmOwnSessionPassword(password: string): Promise<string> {
  const res = await fetch('/api/auth/session', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'X-Garage-Building': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'confirm_password', password }) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || 'Could not confirm your password. Please try again.');
  if (data?.confirmed !== true || typeof data?.userId !== 'string') throw new Error('Could not confirm your account. Sign in again.');
  return data.userId;
}
