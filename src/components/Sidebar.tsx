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

// Items always shown flat (non-sales)
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

// Sales group items (shown under collapsible "Sales" for director)
const salesGroupItems: NavItem[] = [
  { to: '/customers', icon: Users, label: 'Leads' },
  { to: '/pipeline', icon: GitBranch, label: 'Sales Pipeline' },
  { to: '/quotations', icon: FileText, label: 'Quotations' },
  { to: '/commission', icon: Banknote, label: 'Commission' },
  { to: '/loan-calculator', icon: Calculator, label: 'Loan Calculator' },
  { to: '/car-compare', icon: GitCompare, label: 'Car Compare' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
];

// Salesperson flat items
const salespersonItems: NavItem[] = [
  { to: '/sales-dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inventory', icon: Car, label: 'Inventory' },
  { to: '/customers', icon: Users, label: 'Leads' },
  { to: '/pipeline', icon: GitBranch, label: 'Sales Pipeline' },
  { to: '/quotations', icon: FileText, label: 'Quotations' },
  { to: '/loan-calculator', icon: Calculator, label: 'Loan Calculator' },
  { to: '/car-compare', icon: GitCompare, label: 'Car Compare' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { to: '/reminders', icon: ClipboardList, label: 'Instructions' },
  { to: '/ai-assistant', icon: Bot, label: 'AI Assistant' },
];

// Mechanic flat items
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
        `flex items-center gap-3 rounded-lg text-sm font-medium transition-all group ${
          indent ? 'px-3 py-2 ml-3' : 'px-3 py-2.5'
        } ${
          isActive
            ? 'text-cyan-400 bg-cyan-400/10 border-l-2 border-cyan-400 pl-[10px]'
            : 'text-gray-400 hover:text-white hover:bg-[#1a2a4a]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <item.icon
            size={indent ? 15 : 18}
            className={isActive ? 'text-cyan-400' : 'text-gray-500 group-hover:text-gray-300'}
          />
          {item.label}
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
      <aside className="w-64 min-h-screen bg-[#111d35] border-r border-[#1a2a4a] flex flex-col">
        <SidebarLogo />
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {directorItems.map(item => <NavItemLink key={item.to} item={item} />)}

          {/* Sales collapsible group */}
          <div>
            <button
              onClick={() => setSalesOpen(v => !v)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
                isSalesRouteActive
                  ? 'text-cyan-400 bg-cyan-400/10'
                  : 'text-gray-400 hover:text-white hover:bg-[#1a2a4a]'
              }`}
            >
              <div className="flex items-center gap-3">
                <ShoppingBag
                  size={18}
                  className={isSalesRouteActive ? 'text-cyan-400' : 'text-gray-500 group-hover:text-gray-300'}
                />
                Sales
              </div>
              {showSalesItems
                ? <ChevronDown size={14} className="text-gray-500" />
                : <ChevronRight size={14} className="text-gray-500" />
              }
            </button>

            {showSalesItems && (
              <div className="mt-1 space-y-0.5 border-l border-[#1a2a4a] ml-5">
                {salesGroupItems.map(item => <NavItemLink key={item.to} item={item} indent />)}
              </div>
            )}
          </div>

          {directorBottomItems.map(item => <NavItemLink key={item.to} item={item} />)}
        </nav>
        <SidebarFooter />
      </aside>
    );
  }

  const flatItems = isSalesperson ? salespersonItems : mechanicItems;

  return (
    <aside className="w-64 min-h-screen bg-[#111d35] border-r border-[#1a2a4a] flex flex-col">
      <SidebarLogo />
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {flatItems.map(item => <NavItemLink key={item.to} item={item} />)}
      </nav>
      <SidebarFooter />
    </aside>
  );
}

function SidebarLogo() {
  return (
    <div className="p-6 border-b border-[#1a2a4a]">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-cyan-500 rounded-lg flex items-center justify-center">
          <Zap size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-white font-bold text-lg leading-none">AutoDream</h1>
          <p className="text-cyan-400 text-xs mt-0.5">Car Dealership</p>
        </div>
      </div>
    </div>
  );
}

function SidebarFooter() {
  const currentUser = useStore((s) => s.currentUser);
  return (
    <div className="p-4 border-t border-[#1a2a4a]">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-bold text-sm uppercase">
          {currentUser?.name?.charAt(0) ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{currentUser?.name}</p>
          <p className="text-gray-500 text-xs capitalize">{currentUser?.role}</p>
        </div>
      </div>
    </div>
  );
}
