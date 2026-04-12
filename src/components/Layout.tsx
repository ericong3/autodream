import React, { useState } from 'react';
import {
  LogOut, Bell, MoreHorizontal, X,
  LayoutDashboard, Car, Users, CalendarDays,
  FileText, Calculator, GitCompare,
  ClipboardList, Bot, TrendingUp, UsersRound,
  History, Banknote, Zap,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useStore } from '../store';

interface LayoutProps {
  children: React.ReactNode;
}

const SALESPERSON_PRIMARY = [
  { to: '/sales-dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inventory',       icon: Car,             label: 'Inventory'  },
  { to: '/customers',       icon: Users,           label: 'Leads'      },
  { to: '/calendar',        icon: CalendarDays,    label: 'Calendar'   },
];
const SALESPERSON_MORE = [
  { to: '/quotations',      icon: FileText,      label: 'Quotations'      },
  { to: '/loan-calculator', icon: Calculator,    label: 'Loan Calculator' },
  { to: '/car-compare',     icon: GitCompare,    label: 'Car Compare'     },
  { to: '/reminders',       icon: ClipboardList, label: 'Instructions'    },
  { to: '/ai-assistant',    icon: Bot,           label: 'AI Assistant'    },
];

const DIRECTOR_PRIMARY = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inventory', icon: Car,             label: 'Inventory' },
  { to: '/customers', icon: Users,           label: 'Leads'     },
  { to: '/calendar',  icon: CalendarDays,    label: 'Calendar'  },
];
const DIRECTOR_MORE = [
  { to: '/finance',         icon: TrendingUp,    label: 'Accounting'   },
  { to: '/team',            icon: UsersRound,    label: 'Team Members' },
  { to: '/quotations',      icon: FileText,      label: 'Quotations'   },
  { to: '/commission',      icon: Banknote,      label: 'Commission'   },
  { to: '/reminders',       icon: ClipboardList, label: 'Instructions' },
  { to: '/history',         icon: History,       label: 'History'      },
  { to: '/ai-assistant',    icon: Bot,           label: 'AI Assistant' },
];

const MECHANIC_PRIMARY = [
  { to: '/inventory',    icon: Car,           label: 'Inventory'    },
  { to: '/reminders',    icon: ClipboardList, label: 'Instructions' },
  { to: '/ai-assistant', icon: Bot,           label: 'AI'           },
];

export default function Layout({ children }: LayoutProps) {
  const logout = useStore((s) => s.logout);
  const currentUser = useStore((s) => s.currentUser);
  const instructions = useStore((s) => s.instructions);
  const navigate = useNavigate();
  const [showMore, setShowMore] = useState(false);

  const pendingCount = instructions.filter((i) => {
    if (currentUser?.role === 'director') return i.type === 'request' && i.status === 'pending';
    if (i.type === 'instruction' && i.status === 'pending') {
      if (i.toType === 'all') return true;
      if (i.toType === 'department') {
        if (i.toDepartment === 'salesman') return currentUser?.role === 'salesperson';
        if (i.toDepartment === 'mechanic') return currentUser?.role === 'mechanic';
      }
      if (i.toType === 'individual') return i.toIds?.includes(currentUser?.id ?? '');
    }
    return false;
  }).length;

  const handleLogout = () => { logout(); navigate('/login'); };

  const isDirector = currentUser?.role === 'director';
  const isSalesperson = currentUser?.role === 'salesperson';
  const primaryNav = isDirector ? DIRECTOR_PRIMARY : isSalesperson ? SALESPERSON_PRIMARY : MECHANIC_PRIMARY;
  const moreNav = isDirector ? DIRECTOR_MORE : isSalesperson ? SALESPERSON_MORE : [];

  return (
    <div className="flex min-h-screen bg-obsidian-950">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">

        {/* ── Topbar ─────────────────────────────────────────── */}
        <header className="bg-header-gradient border-b border-obsidian-400/80
          flex items-center justify-between px-4 md:px-6 shrink-0
          shadow-[0_2px_16px_rgba(0,0,0,0.5)]"
          style={{ minHeight: '3.5rem' }}
        >

          {/* Left: logo (mobile) + name */}
          <div className="flex items-center gap-2.5">
            <div className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center
              bg-gold-gradient shadow-gold-sm shrink-0">
              <Zap size={16} className="text-obsidian-950" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-white font-semibold text-sm md:text-base leading-none">
                {currentUser?.name ?? 'AutoDream'}
              </h2>
              <p className="text-[10px] text-gold-300 uppercase tracking-widest font-medium mt-0.5 hidden md:block capitalize">
                {currentUser?.role}
              </p>
            </div>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate('/reminders')}
              className="relative p-2 rounded-lg text-gold-400 hover:text-gold-300
                hover:bg-obsidian-600/60 transition-colors"
            >
              <Bell size={18} />
              {pendingCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full
                  text-[9px] text-white flex items-center justify-center font-bold
                  shadow-[0_0_8px_rgba(239,68,68,0.5)]">
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                text-gold-400 hover:text-gold-300 hover:bg-obsidian-600/60
                transition-colors text-sm"
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* ── Main content ────────────────────────────────────── */}
        <main className="flex-1 p-4 md:p-6 overflow-auto md:pb-6"
          style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}
        >{children}</main>
      </div>

      {/* ── Mobile Bottom Nav ───────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30
        bg-header-gradient border-t border-obsidian-400/80
        flex items-center justify-around px-1
        shadow-[0_-4px_20px_rgba(0,0,0,0.5)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: '0.25rem' }}
      >
        {primaryNav.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl transition-all ${
                isActive ? 'text-gold-300' : 'text-gray-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  size={20}
                  className={isActive
                    ? 'drop-shadow-[0_0_8px_rgba(234,184,32,0.65)]'
                    : ''}
                />
                <span className={`text-[10px] font-medium ${isActive ? 'text-gold-300' : ''}`}>
                  {item.label}
                </span>
                {isActive && (
                  <span className="w-1 h-1 rounded-full bg-gold-300 shadow-[0_0_4px_rgba(234,184,32,0.8)]" />
                )}
              </>
            )}
          </NavLink>
        ))}
        {moreNav.length > 0 && (
          <button
            onClick={() => setShowMore(true)}
            className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl transition-all ${
              showMore ? 'text-gold-300' : 'text-gray-400'
            }`}
          >
            <MoreHorizontal size={20} />
            <span className="text-[10px] font-medium">More</span>
          </button>
        )}
      </nav>

      {/* ── More Sheet (mobile) ──────────────────────────────────── */}
      {showMore && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-40"
            onClick={() => setShowMore(false)}
          />
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-50
            bg-gradient-to-b from-obsidian-800 to-obsidian-900
            border-t border-obsidian-400/80 rounded-t-2xl p-4 pb-8
            shadow-[0_-8px_40px_rgba(0,0,0,0.7)]">

            {/* Handle bar */}
            <div className="w-10 h-1 rounded-full bg-obsidian-400/60 mx-auto mb-4" />

            <div className="flex items-center justify-between mb-4">
              <p className="font-display text-white font-semibold text-sm tracking-wide">More</p>
              <button
                onClick={() => setShowMore(false)}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {moreNav.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setShowMore(false)}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                      isActive
                        ? 'bg-gradient-to-br from-gold-500/[0.15] to-transparent border-gold-400/50 text-gold-300 shadow-gold-sm'
                        : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:text-white hover:border-obsidian-300/40'
                    }`
                  }
                >
                  <item.icon size={20} />
                  <span className="text-[11px] font-medium text-center leading-tight">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
