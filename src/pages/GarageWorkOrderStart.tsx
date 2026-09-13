import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, UserSearch, ChevronRight } from 'lucide-react';
import GarageShell from '../components/GarageShell';

// First step of Create Work Order — decide whether this job is for a brand
// new customer or one already in the system. Both options lead to stub
// pages for now; the actual profile/search flow gets built next.
export default function GarageWorkOrderStart() {
  const navigate = useNavigate();

  return (
    <GarageShell title="New Work Order" showBack backTo="/garage/sales-tools">
      <div className="text-center mb-10">
        <p className="text-white/40 text-sm tracking-wide">Is this for a new or existing customer?</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6 max-w-2xl mx-auto">
        <OptionCard
          icon={<UserPlus size={32} strokeWidth={1.5} />}
          title="New Customer"
          subtitle="Create new customer profile & work order"
          onClick={() => navigate('/garage/work-order/new-customer')}
        />
        <OptionCard
          icon={<UserSearch size={32} strokeWidth={1.5} />}
          title="Existing Customer"
          subtitle="Search customer profile & vehicles"
          onClick={() => navigate('/garage/work-order/existing-customer')}
        />
      </div>
    </GarageShell>
  );
}

function OptionCard({
  icon, title, subtitle, onClick,
}: { icon: ReactNode; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-[28px] p-8 flex flex-col items-center text-center
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

      <div className="relative mb-6 flex items-center justify-center">
        <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl
          group-hover:bg-gold-400/25 transition-colors duration-500" />
        <div className="relative text-gold-400">{icon}</div>
      </div>

      <h2 className="font-display text-lg md:text-xl font-semibold text-white tracking-wide mb-2">{title}</h2>
      <p className="text-white/40 text-xs md:text-sm mb-8">{subtitle}</p>

      <span className="relative flex items-center justify-center w-11 h-11 rounded-full border border-gold-400/40
        text-gold-400 group-hover:bg-gold-400 group-hover:text-obsidian-950 group-hover:border-gold-400
        group-hover:shadow-gold transition-all duration-300">
        <ChevronRight size={18} />
      </span>
    </button>
  );
}
