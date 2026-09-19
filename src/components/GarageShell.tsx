import { useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowLeftRight, LogOut } from 'lucide-react';
import { useStore } from '../store';
import Modal from './Modal';

export interface GarageTab {
  label: string;
  path: string;
}

// Shared by every page in the Salesman nav (Dashboard, Sales Tools, ...).
export const SALESMAN_TABS: GarageTab[] = [
  { label: 'Dashboard', path: '/garage/dashboard' },
  { label: 'Sales Tools', path: '/garage/sales-tools' },
  { label: 'Calendar', path: '/garage/calendar' },
];

// Shared chrome for every Garage page — cinematic background + a light
// header (back / switch-business / logout), plus an optional tab strip for
// role-specific nav (e.g. the Salesman Dashboard/Sales Tools pages).
// Deliberately separate from the Used Car Layout/Sidebar so nothing here
// can affect that side of the app.
export default function GarageShell({
  title, showBack, backTo = '/garage', tabs, children,
}: { title: string; showBack?: boolean; backTo?: string; tabs?: GarageTab[]; children: ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  const logout = useStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [confirmLogout, setConfirmLogout] = useState(false);

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
            {showBack && (
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

      <Modal isOpen={confirmLogout} onClose={() => setConfirmLogout(false)} title="Log Out?" maxWidth="max-w-sm">
        <p className="text-gray-300 text-sm leading-relaxed">
          Are you sure you want to log out?
        </p>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setConfirmLogout(false)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">
            Cancel
          </button>
          <button
            onClick={handleLogout}
            className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Log Out
          </button>
        </div>
      </Modal>
    </div>
  );
}
