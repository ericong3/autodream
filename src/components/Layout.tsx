import { useState, useEffect, useRef, useCallback } from 'react';
import type { AppNotification } from '../types';
import { createPortal } from 'react-dom';
import {
  LogOut, Bell, MoreHorizontal, X,
  LayoutDashboard, Car, Users, CalendarDays,
  FileText, Calculator, GitCompare,
  ClipboardList, Bot, TrendingUp, UsersRound,
  History, Banknote, Briefcase, Search,
  Loader2, RefreshCw, Database, FolderOpen, Settings, Wallet, Receipt,
} from 'lucide-react';
import { NavLink, useNavigate, useLocation, Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ProfileModal from './ProfileModal';
import CommandPalette from './CommandPalette';
import QuickActions from './QuickActions';
import { useStore } from '../store';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { usePushNotifications } from '../hooks/usePushNotifications';

const SALESPERSON_PRIMARY = [
  { to: '/sales-dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inventory',       icon: Car,             label: 'Inventory'  },
  { to: '/customers',       icon: Users,           label: 'Leads'      },
  { to: '/calendar',        icon: CalendarDays,    label: 'Calendar'   },
];
const SALESPERSON_MORE = [
  { to: '/loan-cases',      icon: FolderOpen,    label: 'Loan Cases'      },
  { to: '/quotations',      icon: FileText,      label: 'Quotations'      },
  { to: '/loan-calculator', icon: Calculator,    label: 'Loan Calculator' },
  { to: '/car-compare',     icon: GitCompare,    label: 'Car Compare'     },
  { to: '/data',            icon: Database,      label: 'Bankers'         },
  { to: '/history',         icon: History,       label: 'Delivered'       },
  { to: '/claims',          icon: Receipt,       label: 'Claims'          },
  { to: '/reminders',       icon: ClipboardList, label: 'Instructions'    },
  { to: '/ai-assistant',    icon: Bot,           label: 'AI Assistant'    },
];

const BANKER_PRIMARY = [
  { to: '/banker-dashboard', icon: FolderOpen, label: 'Cases' },
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
  { to: '/investors',       icon: Briefcase,     label: 'Investors / Consignment' },
  { to: '/quotations',      icon: FileText,      label: 'Quotations'   },
  { to: '/commission',      icon: Banknote,      label: 'Commission'   },
  { to: '/data',            icon: Database,      label: 'Data'         },
  { to: '/claims',          icon: Receipt,       label: 'Claims'       },
  { to: '/reminders',       icon: ClipboardList, label: 'Instructions' },
  { to: '/history',         icon: History,       label: 'History'      },
  { to: '/ai-assistant',    icon: Bot,           label: 'AI Assistant' },
];

const INVESTOR_PRIMARY = [
  { to: '/investor-portal', icon: Briefcase, label: 'Portfolio' },
];

const MECHANIC_PRIMARY = [
  { to: '/inventory',    icon: Car,           label: 'Inventory'    },
  { to: '/history',      icon: History,       label: 'Delivered'    },
  { to: '/claims',       icon: Receipt,       label: 'Claims'       },
  { to: '/reminders',    icon: ClipboardList, label: 'Instructions' },
  { to: '/ai-assistant', icon: Bot,           label: 'AI'           },
];

const ADMIN_PRIMARY = [
  { to: '/admin-dashboard', icon: Settings, label: 'Dashboard' },
  { to: '/inventory',       icon: Car,      label: 'Inventory' },
  { to: '/payments',        icon: Wallet,   label: 'Payments'  },
  { to: '/claims',          icon: Receipt,  label: 'Claims'    },
  { to: '/history',         icon: History,  label: 'Delivered' },
];

export default function Layout() {
  const logout = useStore((s) => s.logout);
  const currentUser = useStore((s) => s.currentUser);
  const instructions = useStore((s) => s.instructions);
  const notifications = useStore((s) => s.notifications);
  const markNotificationsReadByRef = useStore((s) => s.markNotificationsReadByRef);
  const markNotificationReadById = useStore((s) => s.markNotificationReadById);
  const setBankerOpenCaseId = useStore((s) => s.setBankerOpenCaseId);
  const toastQueue = useStore((s) => s.toastQueue);
  const drainToastQueue = useStore((s) => s.drainToastQueue);
  const navigate = useNavigate();
  const location = useLocation();
  const [showMore, setShowMore] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showCmd, setShowCmd] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifBellRef = useRef<HTMLButtonElement>(null);
  const [notifPanelTop, setNotifPanelTop] = useState(64);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const isDirectorOrAdmin = currentUser?.role === 'director' || currentUser?.role === 'shareholder' || currentUser?.role === 'admin';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowCmd(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Show toast alerts for real-time notification arrivals
  useEffect(() => {
    if (!toastQueue.length) return;
    const incoming = [...toastQueue];
    drainToastQueue();
    setToasts(prev => [...prev, ...incoming]);
    const timers = incoming.map(n =>
      window.setTimeout(() => setToasts(p => p.filter(t => t.id !== n.id)), 6000)
    );
    return () => timers.forEach(clearTimeout);
  }, [toastQueue]);


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

  const { status: pushStatus, requestPermission } = usePushNotifications();
  const loadAll = useStore((s) => s.loadAll);
  const mainRef = useRef<HTMLElement>(null);
  const handleRefresh = useCallback(() => loadAll(true), [loadAll]);
  const { pullDistance, isRefreshing } = usePullToRefresh(mainRef, handleRefresh);

  const isDirector = currentUser?.role === 'director';
  const isShareHolder = currentUser?.role === 'shareholder';
  const isSalesperson = currentUser?.role === 'salesperson';
  const isInvestor = currentUser?.role === 'investor';
  const isBanker = currentUser?.role === 'banker';
  const isAdmin = currentUser?.role === 'admin';
  const unreadNotifs = notifications.filter(n => !n.isRead);
  const primaryNav = (isDirector || isShareHolder) ? DIRECTOR_PRIMARY : isSalesperson ? SALESPERSON_PRIMARY : isInvestor ? INVESTOR_PRIMARY : isBanker ? BANKER_PRIMARY : isAdmin ? ADMIN_PRIMARY : MECHANIC_PRIMARY;
  const moreNav = (isDirector || isShareHolder) ? DIRECTOR_MORE : isSalesperson ? SALESPERSON_MORE : [];

  return (
    <div className="flex min-h-screen bg-obsidian-950">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">

        {/* ── Topbar ─────────────────────────────────────────── */}
        <header className="safe-area-top glass-header border-b border-gold-500/20
          flex items-center justify-between px-4 md:px-6 shrink-0
          shadow-card sticky top-0 z-20"
          style={{ minHeight: 'calc(3.5rem + env(safe-area-inset-top, 0px))' }}
        >

          {/* Left: logo (mobile) + name */}
          <button
            className="flex items-center gap-2.5 md:cursor-default text-left"
            onClick={() => setShowProfile(true)}
          >
            {/* Logo + Avatar — mobile only */}
            <div className="md:hidden flex items-center gap-2 shrink-0">
              <img src="/logo.png?v=2" alt="AutoDream" className="h-8 w-auto" />
              {currentUser?.avatar ? (
                <img src={currentUser.avatar} alt={currentUser.name} className="h-8 w-8 rounded-full object-cover border border-gold-400/40" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-gold-gradient flex items-center justify-center text-obsidian-950 font-bold text-sm uppercase">
                  {currentUser?.name?.charAt(0) ?? '?'}
                </div>
              )}
            </div>
            <div>
              <h2 className="text-white font-semibold text-sm md:text-base leading-none">
                {currentUser?.name ?? 'AutoDream'}
              </h2>
              <p className="text-[10px] text-gold-300 uppercase tracking-widest font-medium mt-0.5 md:hidden capitalize">
                {currentUser?.position || currentUser?.role}
              </p>
              <p className="text-[10px] text-gold-300 uppercase tracking-widest font-medium mt-0.5 hidden md:block capitalize">
                {currentUser?.role}
              </p>
            </div>
          </button>

          {/* Right: actions */}
          <div className="flex items-center gap-1">
            {/* Search / Command Palette trigger */}
            <button
              onClick={() => setShowCmd(true)}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg
                border border-obsidian-400/50 bg-obsidian-700/40
                text-gray-500 hover:text-gray-300 hover:border-obsidian-400/80
                transition-colors text-xs"
            >
              <Search size={13} />
              <span>Search</span>
              <span className="ml-1 text-[10px] text-gray-600 border border-obsidian-400/40 rounded px-1">⌘K</span>
            </button>
            <button
              onClick={() => setShowCmd(true)}
              className="md:hidden p-2 rounded-lg text-gray-500 hover:text-white hover:bg-obsidian-600/60 transition-colors"
            >
              <Search size={18} />
            </button>
            {isBanker ? (
              <button
                ref={notifBellRef}
                onClick={() => {
                  if (!showNotifPanel && notifBellRef.current) {
                    const rect = notifBellRef.current.getBoundingClientRect();
                    setNotifPanelTop(rect.bottom + 8);
                  }
                  setShowNotifPanel(v => !v);
                }}
                className="relative p-2 rounded-lg text-gold-400 hover:text-gold-300 hover:bg-obsidian-600/60 transition-colors"
              >
                <Bell size={18} />
                {unreadNotifs.length > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold shadow-[0_0_8px_rgba(239,68,68,0.5)]">
                    {unreadNotifs.length}
                  </span>
                )}
              </button>
            ) : (
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
            )}
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

        {/* ── Enable notifications banner ─────────────────────── */}
        {pushStatus !== 'granted' && pushStatus !== 'unavailable' && (
          <div className="md:hidden flex items-center justify-between gap-3 px-4 py-2.5 bg-gold-500/10 border-b border-gold-500/20">
            <p className="text-xs text-gold-300 font-medium">Enable notifications to stay updated</p>
            <button
              onClick={requestPermission}
              className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-gold-500 text-obsidian-950 active:bg-gold-600 transition-colors"
            >
              Enable
            </button>
          </div>
        )}

        {/* ── Pull-to-refresh indicator (mobile only) ─────────── */}
        <div
          className="md:hidden flex justify-center items-end overflow-hidden transition-all duration-200 ease-out"
          style={{ height: isRefreshing ? 48 : pullDistance > 0 ? pullDistance : 0 }}
        >
          <div className="mb-2 w-8 h-8 rounded-full bg-obsidian-800 border border-gold-500/30
            flex items-center justify-center shadow-gold-sm">
            {isRefreshing ? (
              <Loader2 size={15} className="text-gold-400 animate-spin" />
            ) : (
              <RefreshCw
                size={15}
                className="text-gold-400 transition-transform duration-100"
                style={{ transform: `rotate(${Math.min((pullDistance / 75) * 180, 180)}deg)` }}
              />
            )}
          </div>
        </div>

        {/* ── Main content ────────────────────────────────────── */}
        <main
          ref={mainRef}
          key={location.pathname}
          className="flex-1 min-h-0 p-4 md:p-6 overflow-auto md:pb-6 animate-page-in"
          style={{
            paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))',
            overscrollBehaviorY: 'none',
          }}
        ><Outlet /></main>
      </div>

      {/* ── Quick actions sidebar (xl+, director/admin) ──────── */}
      {isDirectorOrAdmin && (
        <QuickActions onSearch={() => setShowCmd(true)} />
      )}

      {/* ── Mobile Bottom Nav ───────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30
        glass-header border-t border-gold-500/20
        flex items-center justify-around px-1
        shadow-card-lg"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)', paddingTop: '0.25rem' }}
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
                    ? 'drop-shadow-[0_0_8px_rgba(234,184,32,0.6)]'
                    : ''}
                />
                <span className={`text-[10px] font-medium ${isActive ? 'text-gold-300' : ''}`}>
                  {item.label}
                </span>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-gold-300 shadow-[0_0_6px_rgba(234,184,32,0.7)]" />
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
      <div
        className={`md:hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-40 transition-opacity duration-300 ${showMore ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setShowMore(false)}
      />
      <div
        className={`md:hidden fixed bottom-0 left-0 right-0 z-50
          bg-gradient-to-b from-obsidian-800 to-obsidian-900
          border-t border-gold-500/10 rounded-t-3xl shadow-[0_-8px_40px_rgba(0,0,0,0.6)]
          transition-transform duration-300 ease-out
          ${showMore ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-obsidian-400/50" />
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-b border-obsidian-400/20">
          <p className="font-display text-white font-semibold text-sm tracking-wide">Quick Access</p>
          <button
            onClick={() => setShowMore(false)}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-obsidian-700/60 text-gray-400 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2.5 p-4">
          {moreNav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setShowMore(false)}
              className={({ isActive }) =>
                `flex flex-col items-center gap-2 p-3.5 rounded-2xl border transition-all active:scale-95 ${
                  isActive
                    ? 'bg-gradient-to-br from-gold-500/[0.18] to-transparent border-gold-400/40 text-gold-300 shadow-gold-sm'
                    : 'bg-obsidian-700/50 border-obsidian-400/50 text-gray-400 hover:text-white hover:border-obsidian-300/40 hover:bg-obsidian-600/60'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={22} className={isActive ? 'drop-shadow-[0_0_8px_rgba(234,184,32,0.5)]' : ''} />
                  <span className="text-[11px] font-medium text-center leading-tight">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>
      <ProfileModal isOpen={showProfile} onClose={() => setShowProfile(false)} />
      <CommandPalette isOpen={showCmd} onClose={() => setShowCmd(false)} />

      {/* Toast alerts for new real-time notifications */}
      {toasts.length > 0 && createPortal(
        <div className="fixed bottom-24 md:bottom-6 right-4 flex flex-col gap-2 z-[600] pointer-events-none">
          {toasts.map(t => (
            <div
              key={t.id}
              className="pointer-events-auto flex w-80 bg-obsidian-800 border border-obsidian-400/30 rounded-2xl shadow-card-xl overflow-hidden animate-toast-in"
            >
              <div className="w-1 shrink-0 bg-gold-400" />
              <div className="flex-1 relative min-w-0">
                <button
                  className="w-full text-left px-4 py-3 pr-8 hover:bg-obsidian-700/50 active:bg-obsidian-600 transition-colors"
                  onClick={() => {
                    if (isBanker && t.referenceId) {
                      markNotificationsReadByRef(t.referenceId);
                      setBankerOpenCaseId(t.referenceId);
                    } else {
                      markNotificationReadById(t.id);
                    }
                    setToasts(p => p.filter(toast => toast.id !== t.id));
                  }}
                >
                  <p className="text-[10px] font-bold text-gold-400 uppercase tracking-wider mb-0.5">New Notification</p>
                  <p className="text-sm font-semibold text-white leading-snug">{t.title}</p>
                  {t.body && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{t.body}</p>}
                </button>
                <button
                  onClick={() => setToasts(p => p.filter(toast => toast.id !== t.id))}
                  className="absolute top-2.5 right-2.5 p-1 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-obsidian-600 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>,
        document.body
      )}

      {/* Banker notification panel */}
      {isBanker && showNotifPanel && createPortal(
        <>
          {/* Backdrop — click anywhere outside panel to close */}
          <div className="fixed inset-0 z-[498]" onClick={() => setShowNotifPanel(false)} />

          {/* Panel */}
          <div
            className="fixed w-80 max-h-96 overflow-y-auto bg-obsidian-800 border border-obsidian-400/30 rounded-2xl shadow-2xl z-[499]"
            style={{ top: notifPanelTop, right: 16 }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-obsidian-400/20 sticky top-0 bg-obsidian-800">
              <h3 className="text-sm font-semibold text-white">Notifications</h3>
              {unreadNotifs.length > 0 && (
                <button
                  onClick={async () => {
                    await Promise.all(unreadNotifs.map(n =>
                      n.referenceId ? markNotificationsReadByRef(n.referenceId) : markNotificationReadById(n.id)
                    ));
                    setShowNotifPanel(false);
                  }}
                  className="text-xs text-gold-400 hover:text-gold-300 transition-colors cursor-pointer"
                >
                  Mark all read
                </button>
              )}
            </div>
            {unreadNotifs.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500 text-sm">All caught up</div>
            ) : (
              <div className="divide-y divide-obsidian-400/10">
                {unreadNotifs.map(n => (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (n.referenceId) {
                        markNotificationsReadByRef(n.referenceId);
                        setBankerOpenCaseId(n.referenceId);
                      } else {
                        markNotificationReadById(n.id);
                      }
                      setShowNotifPanel(false);
                    }}
                    className="w-full text-left px-4 py-3 hover:bg-obsidian-700/50 active:bg-obsidian-600 transition-colors cursor-pointer"
                  >
                    <p className="text-sm text-white font-medium leading-snug">{n.title}</p>
                    {n.body && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{n.body}</p>}
                    <p className="text-[10px] text-gray-600 mt-1.5">
                      {new Date(n.createdAt).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
