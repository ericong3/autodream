import { useNavigate } from 'react-router-dom';
import { Car, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import { roleHome } from '../utils/landingPath';

// Shown only to accounts with businessAccess === 'both' (directors,
// shareholders) right after login — everyone else skips straight to their
// one business, see landingPath().
export default function ChooseBusiness() {
  const currentUser = useStore((s) => s.currentUser);
  const navigate = useNavigate();

  if (!currentUser) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-obsidian-950 px-6">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-10">
          <h1 className="font-display text-2xl md:text-3xl font-bold text-white tracking-wide mb-2">
            Welcome, {currentUser.name}
          </h1>
          <p className="text-white/40 text-sm">Choose which business you want to work in</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <button
            onClick={() => navigate(roleHome(currentUser.role))}
            className="group bg-black/40 border border-gold-400/12 rounded-2xl p-10 flex flex-col items-center
              gap-4 hover:border-gold-400/40 hover:bg-black/60 transition-all"
          >
            <Car size={40} className="text-gold-400" />
            <div className="text-white font-display text-lg font-semibold">AutoDream Used Car</div>
            <div className="text-white/40 text-xs">Inventory, deals, customers &amp; finance</div>
          </button>

          <button
            onClick={() => navigate('/garage')}
            className="group bg-black/40 border border-gold-400/12 rounded-2xl p-10 flex flex-col items-center
              gap-4 hover:border-gold-400/40 hover:bg-black/60 transition-all"
          >
            <Sparkles size={40} className="text-gold-400" />
            <div className="text-white font-display text-lg font-semibold">AutoDream Garage</div>
            <div className="text-white/40 text-xs">Tinting &amp; car spray</div>
          </button>
        </div>
      </div>
    </div>
  );
}
