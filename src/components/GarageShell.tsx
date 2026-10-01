import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowLeftRight, LogOut } from 'lucide-react';
import { useStore } from '../store';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { isGarageManager, isGarageSalesRole } from '../utils/garageRoles';

export interface GarageTab {
  label: string;
  path: string;
}

const SALESMAN_TABS: GarageTab[] = [
  { label: 'Dashboard', path: '/garage/dashboard' },
  { label: 'Sales Tools', path: '/garage/sales-tools' },
  { label: 'My Pipeline', path: '/garage/my-work-orders' },
  { label: 'Calendar', path: '/garage/calendar' },
];

// Management gets every Garage module in the top bar — it replaces the old
// card hub at /garage as the main control room.
const MANAGER_TABS: GarageTab[] = [
  { label: 'Dashboard', path: '/garage/dashboard' },
  { label: 'Sales Tools', path: '/garage/sales-tools' },
  { label: 'Team Members', path: '/garage/team' },
  { label: 'Calendar', path: '/garage/calendar' },
  { label: 'Work Flow', path: '/garage/installer' },
  { label: 'Work Order Tracking', path: '/garage/work-order-tracking' },
  { label: 'Tint Pricing', path: '/garage/tint-pricing' },
];

export { isGarageManager };

// Tabs follow the same role rules as the route guards (utils/garageRoles).
// Workshop roles only have their Work Flow pages, so they get no tab strip.
function garageTabsFor(role?: string): GarageTab[] | null {
  if (isGarageManager(role)) return MANAGER_TABS;
  if (isGarageSalesRole(role)) return SALESMAN_TABS;
  return null;
}

// Shared chrome for every Garage page — cinematic background + a light
// header (back / switch-business / logout), plus the role-specific tab
// strip on top-level pages (`nav`). Deliberately separate from the Used Car
// Layout/Sidebar so nothing here can affect that side of the app.
export default function GarageShell({
  title, showBack, backTo = '/garage', nav, children,
}: { title: string; showBack?: boolean; backTo?: string; nav?: boolean; children: ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  const logout = useStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [confirmLogout, setConfirmLogout] = useState(false);
  useBodyScrollLock(confirmLogout);

  const tabs = nav ? garageTabsFor(currentUser?.role) : null;
  // The tab strip is the way around, so a back arrow on a tabbed page would
  // only lead to the (now redirecting) hub.
  const backVisible = showBack && !tabs;

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="min-h-screen relative bg-obsidian-950">
      {/* Garage showroom background */}
      <div
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/garage-bg.png')" }}
      />
      <div className="fixed inset-0 bg-black/70" />
      <div className="fixed inset-0 bg-gradient-to-b from-black/40 via-transparent to-obsidian-950" />

      <div className="relative z-10 min-h-screen flex flex-col">
        <header
          className="flex items-center justify-between px-5 sm:px-8 pb-4 border-b border-white/[0.06] backdrop-blur-sm"
          style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
        >
          <div className="flex items-center gap-3">
            {backVisible && (
              <button
                onClick={() => navigate(backTo)}
                className="p-2 -ml-2 rounded-lg text-white/60 hover:text-gold-400 hover:bg-white/5 transition-colors"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <h1 className="font-display text-white text-base sm:text-lg font-semibold tracking-wide">{title}</h1>
          </div>

          <div className="flex items-center gap-2">
            {currentUser?.businessAccess === 'both' && (
              <button
                onClick={() => navigate('/choose-business')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                  text-gold-400 hover:text-gold-300 hover:bg-white/5 transition-colors text-sm"
              >
                <ArrowLeftRight size={15} />
                <span className="hidden sm:inline">Switch</span>
              </button>
            )}
            <button
              onClick={() => setConfirmLogout(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                text-gold-400 hover:text-gold-300 hover:bg-white/5 transition-colors text-sm"
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {tabs && (
          <nav className="flex items-center gap-2 px-5 sm:px-8 py-3 border-b border-white/[0.06] backdrop-blur-sm overflow-x-auto">
            {tabs.map((t) => {
              const active = location.pathname === t.path;
              return (
                <button
                  key={t.path}
                  onClick={() => navigate(t.path)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors ${
                    active
                      ? 'bg-gold-500/15 border-gold-500/30 text-gold-400'
                      : 'border-transparent text-white/50 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        )}

        <main className="flex-1 px-5 sm:px-8 py-8 max-w-5xl w-full mx-auto">
          {children}
        </main>
      </div>

      {confirmLogout && createPortal(
        <div
          className="fixed inset-0 z-[600] flex flex-col bg-obsidian-950"
          style={{
            paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))',
            paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div
            className="fixed inset-0 bg-cover bg-center"
            style={{ backgroundImage: "url('/garage-bg.png')" }}
          />
          <div className="fixed inset-0 bg-black/80" />

          <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center">
            <div className="relative mb-6 flex items-center justify-center">
              <div className="absolute w-24 h-24 rounded-full bg-red-500/10 blur-xl" />
              <div className="relative w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <LogOut size={26} className="text-red-400" strokeWidth={1.5} />
              </div>
            </div>
            <h2 className="font-display text-white text-2xl font-semibold tracking-wide mb-2">Log Out?</h2>
            <p className="text-white/50 text-sm max-w-xs">
              You'll need to sign in again to access Garage.
            </p>
          </div>

          <div className="relative z-10 w-full max-w-sm mx-auto px-6 space-y-3">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white rounded-xl py-3.5 text-sm font-semibold transition-colors"
            >
              <LogOut size={16} /> Log Out
            </button>
            <button
              onClick={() => setConfirmLogout(false)}
              className="w-full btn-ghost rounded-xl py-3.5 text-sm font-medium !text-white/90"
            >
              Cancel
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
