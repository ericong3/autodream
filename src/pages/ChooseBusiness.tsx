import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import { roleHome, garageHome } from '../utils/landingPath';

// Shown only to accounts with businessAccess === 'both' (directors,
// shareholders) right after login — everyone else skips straight to their
// one business, see landingPath().
export default function ChooseBusiness() {
  const currentUser = useStore((s) => s.currentUser);
  const navigate = useNavigate();

  if (!currentUser) return null;

  return (
    <div className="min-h-screen relative overflow-hidden bg-obsidian-950">
      {/* Garage showroom background */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/garage-bg.png')" }}
      />

      {/* Darkening + vignette so the glass cards read clearly */}
      <div className="absolute inset-0 bg-black/45" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-obsidian-950" />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 py-16">
        {/* Logo */}
        <div className="relative mb-4 sm:mb-6 flex items-center justify-center">
          <div className="absolute w-[900px] max-w-[95vw] aspect-square rounded-full
            bg-[radial-gradient(ellipse_at_center,rgba(234,184,32,0.16)_0%,transparent_70%)] pointer-events-none" />
          <img
            src="/logo.png?v=3"
            alt="AutoDream"
            className="relative z-10 w-[620px] max-w-[85vw] sm:w-[720px]
              drop-shadow-[0_0_40px_rgba(234,184,32,0.25)]
              drop-shadow-[0_8px_30px_rgba(0,0,0,0.9)]"
            draggable={false}
          />
        </div>

        <div className="text-center mb-12">
          <h1 className="font-display text-2xl md:text-3xl font-bold text-white tracking-[0.03em] mb-3">
            Welcome, <span className="text-gold-400">{currentUser.name}</span>
          </h1>
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="h-px w-12 bg-gradient-to-r from-transparent to-gold-400/50" />
            <div className="w-1.5 h-1.5 rounded-full bg-gold-400/80 shadow-gold-sm" />
            <div className="h-px w-12 bg-gradient-to-l from-transparent to-gold-400/50" />
          </div>
          <p className="text-white/45 text-sm tracking-wide">Choose which business you want to work in</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-10 w-full max-w-4xl">
          <BusinessCard
            icon={<Car size={44} strokeWidth={1.5} />}
            title="AutoDream Used Car"
            subtitle="Inventory, deals, customers & finance"
            onClick={() => navigate(roleHome(currentUser.role))}
          />
          <BusinessCard
            icon={<Sparkles size={44} strokeWidth={1.5} />}
            title="AutoDream Garage"
            subtitle="Tinting, coating & car spray"
            onClick={() => navigate(garageHome(currentUser.role))}
          />
        </div>
      </div>
    </div>
  );
}

function BusinessCard({
  icon, title, subtitle, onClick,
}: { icon: ReactNode; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-[28px] p-10 sm:p-14 flex flex-col items-center justify-center text-center
        sm:aspect-square
        bg-white/[0.04] backdrop-blur-xl border border-gold-400/15
        shadow-card-lg hover:shadow-gold-lg hover:border-gold-400/50 hover:bg-white/[0.06]
        hover:-translate-y-1.5 active:translate-y-0 active:scale-[0.99]
        transition-all duration-500 ease-out"
    >
      {/* Liquid-glass sheen */}
      <div className="pointer-events-none absolute -inset-x-10 -top-24 h-40 rotate-[-18deg]
        bg-gradient-to-b from-white/[0.14] to-transparent blur-md
        opacity-50 group-hover:opacity-90 transition-opacity duration-500" />

      {/* Corner brackets */}
      <div className="absolute top-5 left-5 w-5 h-5 border-l border-t border-gold-400/25
        group-hover:border-gold-400/70 transition-colors duration-500" />
      <div className="absolute bottom-5 right-5 w-5 h-5 border-r border-b border-gold-400/25
        group-hover:border-gold-400/70 transition-colors duration-500" />

      <div className="relative mb-8 flex items-center justify-center">
        <div className="absolute w-28 h-28 rounded-full bg-gold-400/10 blur-xl
          group-hover:bg-gold-400/25 transition-colors duration-500" />
        <div className="relative text-gold-400">{icon}</div>
      </div>

      <h2 className="font-display text-xl md:text-2xl font-semibold text-white tracking-wide mb-3">{title}</h2>
      <p className="text-white/40 text-sm md:text-base">{subtitle}</p>
    </button>
  );
}
