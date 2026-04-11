import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Car,
  FileText,
  TrendingUp,
  UsersRound,
  ClipboardList,
  Bot,
  Zap,
  History,
  Users,
  GitBranch,
  Banknote,
  Calculator,
  GitCompare,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ShoppingBag,
} from 'lucide-react';
import { useStore } from '../store';

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
}

const directorItems: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inventory', icon: Car, label: 'Inventory' },
];

const directorBottomItems: NavItem[] = [
  { to: '/finance', icon: TrendingUp, label: 'Accounting' },
  { to: '/team', icon: UsersRound, label: 'Team Members' },
  { to: '/reminders', icon: ClipboardList, label: 'Instructions' },
  { to: '/history', icon: History, label: 'History' },
  { to: '/ai-assistant', icon: Bot, label: 'AI Assistant' },
];

const salesGroupItems: NavItem[] = [
  { to: '/customers', icon: Users, label: 'Leads & Loan' },
  { to: '/pipeline', icon: GitBranch, label: 'Sales Pipeline' },
  { to: '/quotations', icon: FileText, label: 'Quotations' },
  { to: '/commission', icon: Banknote, label: 'Commission' },
  { to: '/loan-calculator', icon: Calculator, label: 'Loan Calculator' },
  { to: '/car-compare', icon: GitCompare, label: 'Car Compare' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
];

const salespersonItems: NavItem[] = [
  { to: '/sales-dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inventory', icon: Car, label: 'Inventory' },
  { to: '/customers', icon: Users, label: 'Leads & Loan' },
  { to: '/pipeline', icon: GitBranch, label: 'Sales Pipeline' },
  { to: '/quotations', icon: FileText, label: 'Quotations' },
  { to: '/loan-calculator', icon: Calculator, label: 'Loan Calculator' },
  { to: '/car-compare', icon: GitCompare, label: 'Car Compare' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { to: '/reminders', icon: ClipboardList, label: 'Instructions' },
  { to: '/ai-assistant', icon: Bot, label: 'AI Assistant' },
];

const mechanicItems: NavItem[] = [
  { to: '/inventory', icon: Car, label: 'Inventory' },
  { to: '/reminders', icon: ClipboardList, label: 'Instructions' },
  { to: '/ai-assistant', icon: Bot, label: 'AI Assistant' },
];

const SALES_ROUTES = salesGroupItems.map(i => i.to);

function NavItemLink({ item, indent = false }: { item: NavItem; indent?: boolean }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-150 group ${
          indent ? 'px-3 py-2 ml-3' : 'px-3 py-2.5'
        } ${
          isActive
            ? 'text-gold-300 bg-gradient-to-r from-gold-500/[0.14] to-transparent border-l-2 border-gold-400 pl-[10px] shadow-[inset_0_0_20px_rgba(234,184,32,0.04)]'
            : 'text-white/60 hover:text-white hover:bg-obsidian-600/60'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <item.icon
            size={indent ? 15 : 18}
            className={
              isActive
                ? 'text-gold-300 drop-shadow-[0_0_6px_rgba(234,184,32,0.5)]'
                : 'text-white/40 group-hover:text-white/80 transition-colors'
            }
          />
          <span className={isActive ? 'font-semibold' : ''}>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const currentUser = useStore((s) => s.currentUser);
  const location = useLocation();
  const isDirector = currentUser?.role === 'director';
  const isSalesperson = currentUser?.role === 'salesperson';

  const isSalesRouteActive = SALES_ROUTES.some(r => location.pathname === r);
  const [salesOpen, setSalesOpen] = useState(isSalesRouteActive);

  const showSalesItems = salesOpen || isSalesRouteActive;

  if (isDirector) {
    return (
      <aside className="hidden md:flex flex-col w-64 min-h-screen bg-sidebar-gradient border-r border-obsidian-400/80">
        <SidebarLogo />
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {directorItems.map(item => <NavItemLink key={item.to} item={item} />)}

          <div>
            <button
              onClick={() => setSalesOpen(v => !v)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group ${
                isSalesRouteActive
                  ? 'text-gold-300 bg-gradient-to-r from-gold-500/[0.14] to-transparent'
                  : 'text-white/60 hover:text-white hover:bg-obsidian-600/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <ShoppingBag
                  size={18}
                  className={
                    isSalesRouteActive
                      ? 'text-gold-300 drop-shadow-[0_0_6px_rgba(234,184,32,0.5)]'
                      : 'text-white/40 group-hover:text-white/80 transition-colors'
                  }
                />
                <span className={isSalesRouteActive ? 'font-semibold' : ''}>Sales</span>
              </div>
              {showSalesItems
                ? <ChevronDown size={13} className="text-white/40" />
                : <ChevronRight size={13} className="text-white/40" />
              }
            </button>

            {showSalesItems && (
              <div className="mt-1 space-y-0.5 border-l border-obsidian-400/60 ml-5">
                {salesGroupItems.map(item => <NavItemLink key={item.to} item={item} indent />)}
              </div>
            )}
          </div>

          {/* Subtle divider before bottom items */}
          <div className="divider-gold my-2 mx-1" />

          {directorBottomItems.map(item => <NavItemLink key={item.to} item={item} />)}
        </nav>
        <SidebarFooter />
      </aside>
    );
  }

  const flatItems = isSalesperson ? salespersonItems : mechanicItems;

  return (
    <aside className="hidden md:flex flex-col w-64 min-h-screen bg-sidebar-gradient border-r border-obsidian-400/80">
      <SidebarLogo />
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {flatItems.map(item => <NavItemLink key={item.to} item={item} />)}
      </nav>
      <SidebarFooter />
    </aside>
  );
}

function SidebarLogo() {
  return (
    <div className="px-4 py-5 border-b border-obsidian-400/80">
      <div className="flex items-center gap-3">
        <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 shadow-gold-sm">
          <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
        </div>
        <div>
          <h1 className="font-display text-white font-bold text-base leading-none tracking-wide">AutoDream</h1>
          <p className="text-[10px] mt-0.5 tracking-[0.2em] uppercase font-medium text-gold-500">
            Car Dealership
          </p>
        </div>
      </div>
    </div>
  );
}

function SidebarFooter() {
  const currentUser = useStore((s) => s.currentUser);
  return (
    <div className="p-3 border-t border-obsidian-400/80">
      <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-obsidian-700/50">
        <div className="w-8 h-8 rounded-full bg-gold-gradient flex items-center justify-center
          text-obsidian-950 font-bold text-sm uppercase shadow-gold-sm shrink-0">
          {currentUser?.name?.charAt(0) ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate leading-none">{currentUser?.name}</p>
          <p className="text-white/50 text-[11px] capitalize mt-0.5">{currentUser?.role}</p>
        </div>
      </div>
    </div>
  );
}
