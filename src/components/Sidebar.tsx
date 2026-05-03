import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import ProfileModal from './ProfileModal';
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
  ChevronDown,
  ChevronRight,
  ShoppingBag,
  Database,
  Briefcase,
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
  { to: '/finance',    icon: TrendingUp,    label: 'Accounting'    },
  { to: '/team',       icon: UsersRound,    label: 'Team Members'  },
  { to: '/investors',  icon: Briefcase,     label: 'Investors / Consignment' },
  { to: '/data',       icon: Database,      label: 'Data'          },
  { to: '/reminders',  icon: ClipboardList, label: 'Instructions'  },
  { to: '/history',    icon: History,       label: 'Delivered'     },
  { to: '/ai-assistant', icon: Bot,         label: 'AI Assistant'  },
];

const investorItems: NavItem[] = [
  { to: '/investor-portal', icon: Briefcase, label: 'My Portfolio' },
];

const salesGroupItems: NavItem[] = [
  { to: '/customers', icon: Users, label: 'Leads & Loan' },
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

// Admin: same nav as director but no Finance page (no purchase price / profit access)
const adminItems: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inventory', icon: Car, label: 'Inventory' },
];

const adminBottomItems: NavItem[] = [
  { to: '/team', icon: UsersRound, label: 'Team Members' },
  { to: '/data', icon: Database, label: 'Data' },
  { to: '/reminders', icon: ClipboardList, label: 'Instructions' },
  { to: '/history', icon: History, label: 'Delivered' },
  { to: '/ai-assistant', icon: Bot, label: 'AI Assistant' },
];

const SALES_ROUTES = salesGroupItems.map(i => i.to);

function SidebarLabel({ children, collapsed }: { children: React.ReactNode; collapsed?: boolean }) {
  if (collapsed) return null;
  return (
    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-600 select-none">
      {children}
    </p>
  );
}

function NavItemLink({ item, indent = false, collapsed = false }: { item: NavItem; indent?: boolean; collapsed?: boolean }) {
  return (
    <NavLink
      to={item.to}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `flex items-center rounded-lg text-sm font-medium transition-all duration-150 group ${
          collapsed
            ? 'justify-center px-2 py-2.5'
            : indent
            ? 'gap-3 px-3 py-2 ml-3'
            : 'gap-3 px-3 py-2.5'
        } ${
          isActive
            ? collapsed
              ? 'text-gold-300 bg-gold-500/20 nav-active-right'
              : 'text-gold-300 bg-gradient-to-r from-gold-500/20 to-transparent border-l-2 border-gold-400 pl-[10px] nav-active-right'
            : 'text-white/60 hover:text-white hover:bg-white/[0.05]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <item.icon
            size={indent && !collapsed ? 15 : 18}
            className={
              isActive
                ? 'text-gold-300 drop-shadow-[0_0_6px_rgba(234,184,32,0.6)] shrink-0'
                : 'text-gray-400 group-hover:text-white/80 transition-colors shrink-0'
            }
          />
          {!collapsed && <span className={isActive ? 'font-semibold' : ''}>{item.label}</span>}
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const currentUser = useStore((s) => s.currentUser);
  const location = useLocation();
  const isDirector = currentUser?.role === 'director';
  const isShareHolder = currentUser?.role === 'shareholder';
  const isAdmin = currentUser?.role === 'admin';
  const isSalesperson = currentUser?.role === 'salesperson';
  const isInvestor = currentUser?.role === 'investor';

  const isSalesRouteActive = SALES_ROUTES.some(r => location.pathname === r);
  const [salesOpen, setSalesOpen] = useState(isSalesRouteActive);
  const [collapsed, setCollapsed] = useState(false);

  const showSalesItems = !collapsed && (salesOpen || isSalesRouteActive);

  const asideClass = `hidden md:flex flex-col min-h-screen glass-sidebar border-r border-gold-500/[0.12] transition-all duration-300 ${collapsed ? 'w-16' : 'w-64'}`;

  const salesAccordionButton = collapsed ? (
    <button
      onClick={() => setCollapsed(false)}
      title="Sales"
      className={`w-full flex justify-center px-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
        isSalesRouteActive
          ? 'text-gold-300 bg-gold-500/20'
          : 'text-white/60 hover:text-white hover:bg-white/[0.05]'
      }`}
    >
      <ShoppingBag
        size={18}
        className={isSalesRouteActive ? 'text-gold-300 drop-shadow-[0_0_6px_rgba(234,184,32,0.6)]' : 'text-gray-400'}
      />
    </button>
  ) : (
    <button
      onClick={() => setSalesOpen(v => !v)}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group ${
        isSalesRouteActive
          ? 'text-gold-300 bg-gradient-to-r from-gold-500/20 to-transparent'
          : 'text-white/60 hover:text-white hover:bg-white/[0.05]'
      }`}
    >
      <div className="flex items-center gap-3">
        <ShoppingBag
          size={18}
          className={isSalesRouteActive ? 'text-gold-300 drop-shadow-[0_0_6px_rgba(234,184,32,0.6)]' : 'text-gray-400 group-hover:text-white/80 transition-colors'}
        />
        <span className={isSalesRouteActive ? 'font-semibold' : ''}>Sales</span>
      </div>
      {showSalesItems ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
    </button>
  );

  if (isAdmin) {
    return (
      <aside className={asideClass}>
        <SidebarLogo collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
          <SidebarLabel collapsed={collapsed}>Overview</SidebarLabel>
          {adminItems.map(item => <NavItemLink key={item.to} item={item} collapsed={collapsed} />)}

          <SidebarLabel collapsed={collapsed}>Sales</SidebarLabel>
          <div>
            {salesAccordionButton}
            {showSalesItems && (
              <div className="mt-1 space-y-0.5 border-l border-obsidian-400/60 ml-5">
                {salesGroupItems.map(item => <NavItemLink key={item.to} item={item} indent collapsed={collapsed} />)}
              </div>
            )}
          </div>

          <SidebarLabel collapsed={collapsed}>Management</SidebarLabel>
          {adminBottomItems.map(item => <NavItemLink key={item.to} item={item} collapsed={collapsed} />)}
        </nav>
        <SidebarFooter collapsed={collapsed} />
      </aside>
    );
  }

  if (isDirector || isShareHolder) {
    return (
      <aside className={asideClass}>
        <SidebarLogo collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
          <SidebarLabel collapsed={collapsed}>Overview</SidebarLabel>
          {directorItems.map(item => <NavItemLink key={item.to} item={item} collapsed={collapsed} />)}

          <SidebarLabel collapsed={collapsed}>Sales</SidebarLabel>
          <div>
            {salesAccordionButton}
            {showSalesItems && (
              <div className="mt-1 space-y-0.5 border-l border-obsidian-400/60 ml-5">
                {salesGroupItems.map(item => <NavItemLink key={item.to} item={item} indent collapsed={collapsed} />)}
              </div>
            )}
          </div>

          <SidebarLabel collapsed={collapsed}>Management</SidebarLabel>
          {directorBottomItems.map(item => <NavItemLink key={item.to} item={item} collapsed={collapsed} />)}
        </nav>
        <SidebarFooter collapsed={collapsed} />
      </aside>
    );
  }

  if (isInvestor) {
    return (
      <aside className={asideClass}>
        <SidebarLogo collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {investorItems.map(item => <NavItemLink key={item.to} item={item} collapsed={collapsed} />)}
        </nav>
        <SidebarFooter collapsed={collapsed} />
      </aside>
    );
  }

  const flatItems = isSalesperson ? salespersonItems : mechanicItems;

  return (
    <aside className={asideClass}>
      <SidebarLogo collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {flatItems.map(item => <NavItemLink key={item.to} item={item} collapsed={collapsed} />)}
      </nav>
      <SidebarFooter collapsed={collapsed} />
    </aside>
  );
}

function SidebarLogo({ collapsed, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  return (
    <div className={`border-b border-gold-500/[0.12] flex items-center gap-2 ${collapsed ? 'flex-col py-3 px-2' : 'justify-between py-4 px-3'}`}>
      <div className={`flex items-center gap-3 min-w-0 ${collapsed ? 'justify-center' : ''}`}>
        <div className="relative w-10 h-10 rounded-xl overflow-hidden shrink-0 shadow-gold-sm">
          <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="font-display text-white font-bold text-sm leading-none tracking-wide truncate">AutoDream</h1>
            <p className="text-[9px] mt-0.5 tracking-[0.18em] uppercase font-medium text-gold-300">
              Car Dealership
            </p>
          </div>
        )}
      </div>
      {onToggle && (
        <button
          onClick={onToggle}
          className={`flex items-center justify-center rounded-md text-gray-500 hover:text-gold-400 hover:bg-obsidian-600/60 transition-colors ${collapsed ? 'w-6 h-6 mt-0.5' : 'shrink-0 w-6 h-6'}`}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronRight size={13} className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} />
        </button>
      )}
    </div>
  );
}

function SidebarFooter({ collapsed }: { collapsed?: boolean }) {
  const currentUser = useStore((s) => s.currentUser);
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <>
      <div className="p-3 border-t border-gold-500/[0.12]">
        <button
          onClick={() => setProfileOpen(true)}
          title={collapsed ? (currentUser?.name ?? 'Profile') : undefined}
          className={`w-full flex items-center px-2 py-2 rounded-lg bg-obsidian-700/50 hover:bg-obsidian-600/60 hover:border hover:border-gold-500/20 transition-all group text-left ${collapsed ? 'justify-center' : 'gap-3'}`}
        >
          <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 shadow-gold-sm">
            {currentUser?.avatar ? (
              <img src={currentUser.avatar} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gold-gradient flex items-center justify-center text-obsidian-950 font-bold text-sm uppercase">
                {currentUser?.name?.charAt(0) ?? '?'}
              </div>
            )}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold truncate leading-none">{currentUser?.name}</p>
                <p className="text-gray-400 text-[11px] capitalize mt-0.5">
                  {currentUser?.position || currentUser?.role}
                </p>
              </div>
              <div className="text-gray-500 group-hover:text-gold-400 transition-colors shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="3" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                </svg>
              </div>
            </>
          )}
        </button>
      </div>

      <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
