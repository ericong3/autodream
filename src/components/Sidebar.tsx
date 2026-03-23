import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Car,
  FileText,
  TrendingUp,
  Users,
  UsersRound,
  ClipboardList,
  Bot,
  Zap,
} from 'lucide-react';
import { useStore } from '../store';

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  directorOnly?: boolean;
}

const navItems: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', directorOnly: true },
  { to: '/inventory', icon: Car, label: 'Inventory' },
  { to: '/quotations', icon: FileText, label: 'Quotations' },
  { to: '/finance', icon: TrendingUp, label: 'Accounting', directorOnly: true },
  { to: '/salespeople', icon: Users, label: 'Salespeople', directorOnly: true },
  { to: '/team', icon: UsersRound, label: 'Team Members' },
  { to: '/reminders', icon: ClipboardList, label: 'Instructions' },
  { to: '/ai-assistant', icon: Bot, label: 'AI Assistant' },
];

export default function Sidebar() {
  const currentUser = useStore((s) => s.currentUser);
  const isDirector = currentUser?.role === 'director';

  const visibleItems = navItems.filter(
    (item) => !item.directorOnly || isDirector
  );

  return (
    <aside className="w-64 min-h-screen bg-[#111d35] border-r border-[#1a2a4a] flex flex-col">
      {/* Logo */}
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

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
                isActive
                  ? 'text-cyan-400 bg-cyan-400/10 border-l-2 border-cyan-400 pl-[10px]'
                  : 'text-gray-400 hover:text-white hover:bg-[#1a2a4a]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  size={18}
                  className={isActive ? 'text-cyan-400' : 'text-gray-500 group-hover:text-gray-300'}
                />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
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
    </aside>
  );
}
