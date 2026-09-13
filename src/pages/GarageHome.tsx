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
    <div className="min-h-screen flex flex-col items-center justify-center bg-obsidian-950 px-6 text-center">
      <Sparkles size={44} className="text-gold-400 mb-5" />
      <h1 className="font-display text-2xl font-bold text-white tracking-wide mb-2">AutoDream Garage</h1>
      <p className="text-white/40 text-sm mb-1">Welcome, {currentUser.name}</p>
      <p className="text-white/30 text-xs mb-10">Tinting &amp; car spray — pages coming soon</p>

      <div className="flex items-center gap-3">
        {currentUser.businessAccess === 'both' && (
          <button
            onClick={() => navigate('/choose-business')}
            className="flex items-center gap-2 text-white/60 hover:text-white text-sm border border-white/10
              rounded-xl px-4 py-2.5 transition-colors"
          >
            <ArrowLeftRight size={15} /> Switch business
          </button>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-white/60 hover:text-white text-sm border border-white/10
            rounded-xl px-4 py-2.5 transition-colors"
        >
          <LogOut size={15} /> Log out
        </button>
      </div>
    </div>
  );
}
