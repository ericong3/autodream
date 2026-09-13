import type React from 'react';
import {
  LayoutDashboard,
  Car,
  FileText,
  TrendingUp,
  UsersRound,
  ClipboardList,
  Bot,
  History,
  Users,
  Banknote,
  Calculator,
  GitCompare,
  CalendarDays,
  Database,
  Briefcase,
  FolderOpen,
  Wallet,
  Wrench,
  Receipt,
  PiggyBank,
} from 'lucide-react';
import type { AppRole } from './access';

export interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
}

const item = (to: string, icon: React.ElementType, label: string): NavItem => ({ to, icon, label });

export const DIRECTOR_OVERVIEW: NavItem[] = [
  item('/dashboard', LayoutDashboard, 'Dashboard'),
  item('/inventory', Car, 'Inventory'),
];

export const DIRECTOR_SALES: NavItem[] = [
  item('/customers', Users, 'Leads & Loan'),
  item('/loan-cases', FolderOpen, 'Loan Cases'),
  item('/quotations', FileText, 'Quotations'),
  item('/commission', Banknote, 'Commission'),
  item('/loan-calculator', Calculator, 'Loan Calculator'),
  item('/car-compare', GitCompare, 'Car Compare'),
  item('/calendar', CalendarDays, 'Calendar'),
];

export const DIRECTOR_MANAGEMENT: NavItem[] = [
  item('/finance', TrendingUp, 'Accounting'),
  item('/payroll', PiggyBank, 'Payroll'),
  item('/team', UsersRound, 'Team Members'),
  item('/investors', Briefcase, 'Investors / Consignment'),
  item('/data', Database, 'Data'),
  item('/claims', Receipt, 'Claims'),
  item('/reminders', ClipboardList, 'Instructions'),
  item('/history', History, 'Delivered'),
  item('/ai-assistant', Bot, 'AI Assistant'),
];

const SALESPERSON_ITEMS: NavItem[] = [
  item('/sales-dashboard', LayoutDashboard, 'Dashboard'),
  item('/inventory', Car, 'Inventory'),
  item('/customers', Users, 'Leads & Loan'),
  item('/loan-cases', FolderOpen, 'Loan Cases'),
  item('/quotations', FileText, 'Quotations'),
  item('/commission', Banknote, 'Commission'),
  item('/loan-calculator', Calculator, 'Loan Calculator'),
  item('/car-compare', GitCompare, 'Car Compare'),
  item('/calendar', CalendarDays, 'Calendar'),
  item('/data', Database, 'Bankers'),
  item('/history', History, 'Delivered'),
  item('/claims', Receipt, 'Claims'),
  item('/reminders', ClipboardList, 'Instructions'),
  item('/ai-assistant', Bot, 'AI Assistant'),
];

const MECHANIC_ITEMS: NavItem[] = [
  item('/inventory', Car, 'Inventory'),
  item('/history', History, 'Delivered'),
  item('/claims', Receipt, 'Claims'),
  item('/reminders', ClipboardList, 'Instructions'),
  item('/ai-assistant', Bot, 'AI Assistant'),
];

const ADMIN_ITEMS: NavItem[] = [
  item('/admin-dashboard', LayoutDashboard, 'Dashboard'),
  item('/inventory', Car, 'Inventory'),
  item('/workshop', Wrench, 'Workshop'),
  item('/data', Database, 'Register Merchant'),
  item('/payments', Wallet, 'Payments'),
  item('/claims', Receipt, 'Claims'),
  item('/history', History, 'Delivered'),
  item('/reminders', ClipboardList, 'Instructions'),
  item('/ai-assistant', Bot, 'AI Assistant'),
];

const INVESTOR_ITEMS: NavItem[] = [
  item('/investor-portal', Briefcase, 'My Portfolio'),
];

const BANKER_ITEMS: NavItem[] = [
  item('/banker-dashboard', FolderOpen, 'Cases'),
];

const DIRECTOR_ITEMS = [...DIRECTOR_OVERVIEW, ...DIRECTOR_SALES, ...DIRECTOR_MANAGEMENT];

const ROLE_NAV_ITEMS: Record<AppRole, NavItem[]> = {
  director: DIRECTOR_ITEMS,
  shareholder: DIRECTOR_ITEMS,
  salesperson: SALESPERSON_ITEMS,
  mechanic: MECHANIC_ITEMS,
  admin: ADMIN_ITEMS,
  investor: INVESTOR_ITEMS,
  banker: BANKER_ITEMS,
};

const MOBILE_PRIMARY_ROUTES: Record<AppRole, string[]> = {
  director: ['/dashboard', '/inventory', '/customers', '/calendar'],
  shareholder: ['/dashboard', '/inventory', '/customers', '/calendar'],
  salesperson: ['/sales-dashboard', '/inventory', '/customers', '/calendar'],
  mechanic: ['/inventory', '/history', '/claims', '/reminders', '/ai-assistant'],
  admin: ['/admin-dashboard', '/inventory', '/payments', '/claims'],
  investor: ['/investor-portal'],
  banker: ['/banker-dashboard'],
};

export function getRoleNavItems(role?: AppRole): NavItem[] {
  return role ? ROLE_NAV_ITEMS[role] ?? [] : [];
}

export function getMobilePrimaryNav(role?: AppRole): NavItem[] {
  if (!role) return [];
  const primary = new Set(MOBILE_PRIMARY_ROUTES[role] ?? []);
  return getRoleNavItems(role).filter((nav) => primary.has(nav.to));
}

export function getMobileMoreNav(role?: AppRole): NavItem[] {
  if (!role) return [];
  const primary = new Set(MOBILE_PRIMARY_ROUTES[role] ?? []);
  return getRoleNavItems(role).filter((nav) => !primary.has(nav.to));
}
