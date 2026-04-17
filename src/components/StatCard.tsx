import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  borderColor: string;
  iconColor: string;
  trend?: string;
  trendUp?: boolean;
}

export default function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  borderColor,
  iconColor,
  trend,
  trendUp,
}: StatCardProps) {
  return (
    <div
      className={`relative rounded-xl p-5 border border-l-4 ${borderColor} border-gold-500/10 flex items-start gap-4 overflow-hidden
        glass-panel
        hover:border-gold-500/20 hover:shadow-card-lg transition-all duration-200 group`}
    >
      {/* Ambient corner glow — matches accent */}
      <div className={`absolute -top-6 -left-6 w-28 h-28 rounded-full blur-2xl opacity-[0.08] pointer-events-none ${iconColor}`} />

      <div className={`relative p-2.5 rounded-lg bg-white/[0.05] backdrop-blur-sm border border-white/[0.08] ${iconColor}
        group-hover:scale-110 transition-transform duration-200
        shadow-[0_2px_8px_rgba(0,0,0,0.4)]`}>
        <Icon size={22} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40 mb-2">
          {title}
        </p>
        <p className="text-white text-3xl font-bold truncate leading-none">{value}</p>
        {subtitle && (
          <p className="text-white/35 text-xs mt-2">{subtitle}</p>
        )}
        {trend && (
          <p className={`text-xs mt-2 font-semibold flex items-center gap-0.5 ${trendUp ? 'text-emerald-400' : 'text-red-400'}`}>
            <span>{trendUp ? '▲' : '▼'}</span>
            {trend}
          </p>
        )}
      </div>
    </div>
  );
}
