import type { User } from '../types';

export type AppRole = User['role'];

export const ROLE_HOME: Record<AppRole, string> = {
  director: '/dashboard',
  shareholder: '/dashboard',
  salesperson: '/sales-dashboard',
  mechanic: '/inventory',
  admin: '/admin-dashboard',
  investor: '/investor-portal',
  banker: '/banker-dashboard',
};

export function roleHome(role: AppRole): string {
  return ROLE_HOME[role] ?? '/inventory';
}

export const STAFF_ROLES: AppRole[] = ['director', 'shareholder', 'salesperson', 'mechanic', 'admin'];
export const SALES_ROLES: AppRole[] = ['director', 'shareholder', 'salesperson'];
export const DIRECTOR_ROLES: AppRole[] = ['director', 'shareholder'];
export const DATA_ROLES: AppRole[] = ['director', 'shareholder', 'salesperson', 'admin'];
export const ADMIN_ONLY: AppRole[] = ['admin'];

export function canAccess(role: AppRole | undefined, allowed: readonly AppRole[]): boolean {
  return !!role && allowed.includes(role);
}
