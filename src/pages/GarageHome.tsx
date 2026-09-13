import { useNavigate } from 'react-router-dom';
import { Sparkles, LogOut, ArrowLeftRight } from 'lucide-react';
import { useStore } from '../store';

// Placeholder landing spot for the Garage side — real Garage pages (job
// intake form, etc.) replace this as they're built. Login/access routing
// works end to end already; this is just what it routes to for now.
export default function GarageHome() {
  const currentUser = useStore((s) => s.currentUser);
  const logout = useStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  if (!currentUser) return null;

  return (
    <div className="min-h-screen relative overflow-hidden bg-obsidian-950">
      {/* Desktop background video */}
      <video
        className="absolute inset-0 w-full h-full object-cover md:block hidden"
        src="/background.mp4?v=2"
        autoPlay loop muted playsInline preload="none"
      />
      {/* Mobile background video */}
      <video
        className="absolute inset-0 w-full h-full object-cover md:hidden block"
        src="/preview_phone.mp4"
        autoPlay loop muted playsInline preload="none"
      />

      <div className="absolute inset-0 bg-black/60" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-obsidian-950" />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 py-16">
        <div className="relative overflow-hidden rounded-[28px] px-8 sm:px-12 py-12 sm:py-14 max-w-md w-full text-center
          bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">

          {/* Liquid-glass sheen */}
          <div className="pointer-events-none absolute -inset-x-10 -top-24 h-40 rotate-[-18deg]
            bg-gradient-to-b from-white/[0.14] to-transparent blur-md opacity-60" />

          <div className="absolute top-5 left-5 w-5 h-5 border-l border-t border-gold-400/25" />
          <div className="absolute bottom-5 right-5 w-5 h-5 border-r border-b border-gold-400/25" />

          <div className="relative mb-6 flex items-center justify-center">
            <div className="absolute w-20 h-20 rounded-full bg-gold-400/15 blur-xl" />
            <Sparkles size={38} strokeWidth={1.5} className="relative text-gold-400" />
          </div>

          <h1 className="font-display text-2xl font-bold text-white tracking-wide mb-2">AutoDream Garage</h1>
          <p className="text-white/50 text-sm mb-1">Welcome, {currentUser.name}</p>
          <p className="text-white/30 text-xs mb-10">Tinting &amp; car spray — pages coming soon</p>

          <div className="flex items-center justify-center gap-3 flex-wrap">
            {currentUser.businessAccess === 'both' && (
              <button
                onClick={() => navigate('/choose-business')}
                className="flex items-center gap-2 text-white/60 hover:text-gold-400 text-sm
                  border border-white/10 hover:border-gold-400/40 rounded-xl px-4 py-2.5 transition-colors"
              >
                <ArrowLeftRight size={15} /> Switch business
              </button>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-white/60 hover:text-gold-400 text-sm
                border border-white/10 hover:border-gold-400/40 rounded-xl px-4 py-2.5 transition-colors"
            >
              <LogOut size={15} /> Log out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
